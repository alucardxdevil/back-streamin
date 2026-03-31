/**
 * Controller para manejo de uploads con Backblaze B2
 *
 * Arquitectura: Proxy de subida en el servidor.
 * El cliente envía el archivo al servidor (multipart/form-data en memoria),
 * el servidor genera el presigned POST internamente y hace la subida a B2.
 * Los bytes NO se escriben en disco — se mantienen en buffer de memoria.
 *
 * Ventajas:
 *  - No requiere configuración de CORS en B2
 *  - El servidor valida tipo, tamaño y autenticación antes de subir
 *  - Escalable horizontalmente (sin estado en disco)
 *
 * Para subida directa cliente→B2 (sin proxy), configurar CORS en B2:
 *   node server/scripts/setup-b2-cors.js
 *
 * Flujo actual (proxy):
 *  Cliente → POST /api/upload/image|video (multipart) → Servidor → B2
 *
 * Flujo ideal (directo, requiere CORS en B2):
 *  Cliente → POST /api/upload/generate-presigned-post → Servidor (solo token)
 *  Cliente → POST {b2_url} (multipart con fields) → B2 directamente
 *
 * Seguridad:
 *  - JWT verificado antes de cualquier operación
 *  - fileKey = uploads/{userId}/{uuid}.{ext} — generado por el servidor
 *  - Validación de MIME type y tamaño antes de subir
 *  - DELETE verifica que fileKey pertenezca al userId
 */

import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import {
  s3Client,
  B2_CONFIG,
  generateFileKey,
  getPublicUrl,
  getFileType,
  getAllowedMimeTypes,
} from '../config/b2.js'
import { createError } from '../err.js'
import { convertToWebP, shouldConvertToWebP } from '../utils/convertToWebP.js'

// Límites de tamaño por tipo de archivo
const SIZE_LIMITS = {
  image: 10 * 1024 * 1024,   // 10 MB
  video: 500 * 1024 * 1024,  // 500 MB
}

// Expiración del presigned POST en segundos (15 minutos)
const PRESIGNED_POST_EXPIRATION = 900

/**
 * POST /api/upload/generate-presigned-post
 *
 * Genera un presigned POST para subida directa cliente→B2.
 * REQUIERE que el bucket B2 tenga CORS configurado.
 * Ejecutar: node server/scripts/setup-b2-cors.js
 *
 * Body: { fileName, contentType, fileSize }
 * Response: { url, fields, fileKey, publicUrl, expiresIn }
 */
export const generatePresignedPost = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id
    if (!userId) return next(createError(401, 'Token inválido'))

    const { fileName, contentType, fileSize } = req.body

    if (!fileName || !contentType) {
      return next(createError(400, 'fileName y contentType son requeridos'))
    }

    const allowedMimeTypes = getAllowedMimeTypes()
    if (!allowedMimeTypes.includes(contentType)) {
      return next(createError(400, `Tipo de archivo no permitido: ${contentType}`))
    }

    const fileType = getFileType(contentType)
    const maxSize = SIZE_LIMITS[fileType] ?? SIZE_LIMITS.image

    if (fileSize && fileSize > maxSize) {
      return next(
        createError(400, `Archivo demasiado grande. Máximo ${maxSize / (1024 * 1024)} MB`)
      )
    }

    const fileKey = generateFileKey(userId, fileName, contentType)

    const { url, fields } = await createPresignedPost(s3Client, {
      Bucket: B2_CONFIG.bucket,
      Key: fileKey,
      Expires: PRESIGNED_POST_EXPIRATION,
      Conditions: [
        ['content-length-range', 1, maxSize],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: {
        'Content-Type': contentType,
      },
    })

    const publicUrl = getPublicUrl(fileKey)

    return res.status(200).json({
      success: true,
      data: {
        url,
        fields,
        fileKey,
        publicUrl,
        fileType,
        expiresIn: PRESIGNED_POST_EXPIRATION,
        maxFileSize: maxSize,
        contentType,
      },
    })
  } catch (error) {
    console.error('[Upload] generatePresignedPost error:', error.message)
    return next(createError(500, 'Error al generar presigned POST'))
  }
}

/**
 * POST /api/upload/image
 * Sube imagen a B2 a través del servidor (proxy).
 * Multer almacena el archivo en memoria (buffer), nunca en disco.
 */
export const uploadImage = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id
    if (!userId) return next(createError(401, 'Usuario no autenticado'))

    if (!req.file) return next(createError(400, 'No se recibió imagen'))

    const { originalname, mimetype, size, buffer } = req.file

    if (!mimetype.startsWith('image/')) {
      return next(createError(400, 'Debe ser una imagen'))
    }

    if (size > SIZE_LIMITS.image) {
      return next(createError(400, `Imagen muy grande (máx ${SIZE_LIMITS.image / (1024 * 1024)} MB)`))
    }

    const allowedMimeTypes = getAllowedMimeTypes()
    if (!allowedMimeTypes.includes(mimetype)) {
      return next(createError(400, 'Tipo de imagen no permitido'))
    }

    // ── Conversión automática a WebP ──────────────────────────────────────
    // Si la imagen es JPEG, PNG, GIF, BMP, TIFF o AVIF, se convierte a WebP.
    // SVG y WebP se suben tal cual (SVG es vectorial, WebP ya está optimizado).
    let finalBuffer = buffer
    let finalMimeType = mimetype
    let finalOriginalName = originalname

    if (shouldConvertToWebP(mimetype)) {
      try {
        const converted = await convertToWebP(buffer, { quality: 80 })
        finalBuffer = converted.buffer
        finalMimeType = converted.contentType // 'image/webp'
        // Cambiar extensión del nombre original para generar fileKey correcto
        finalOriginalName = originalname.replace(/\.[^.]+$/, '.webp')
        console.log(`[UploadImage] Convertido ${mimetype} → WebP (${size} → ${finalBuffer.length} bytes, ${Math.round((1 - finalBuffer.length / size) * 100)}% reducción)`)
      } catch (conversionError) {
        // Si la conversión falla, subir la imagen original sin convertir
        console.warn('[UploadImage] Conversión WebP falló, subiendo original:', conversionError.message)
      }
    }

    const fileKey = generateFileKey(userId, finalOriginalName, finalMimeType)

    await s3Client.send(
      new PutObjectCommand({
        Bucket: B2_CONFIG.bucket,
        Key: fileKey,
        Body: finalBuffer,
        ContentType: finalMimeType,
      })
    )

    const publicUrl = getPublicUrl(fileKey)

    return res.status(200).json({
      success: true,
      data: {
        fileKey,
        publicUrl,
        fileType: 'image',
        contentType: finalMimeType,
        size: finalBuffer.length,
        originalSize: size,
        converted: finalMimeType !== mimetype,
      },
    })
  } catch (error) {
    console.error('[UploadImage] Error completo:', error)
    const msg = error?.Code || error?.message || 'Error al subir imagen'
    return next(createError(500, msg))
  }
}

/**
 * POST /api/upload/video
 * Sube video a B2 a través del servidor (proxy).
 * Multer almacena el archivo en memoria (buffer), nunca en disco.
 *
 * ⚠️ Para videos grandes (>100 MB) se recomienda usar subida directa
 * con presigned POST una vez configurado CORS en B2.
 */
export const uploadVideo = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id
    if (!userId) return next(createError(401, 'Usuario no autenticado'))

    if (!req.file) return next(createError(400, 'No se recibió video'))

    const { originalname, mimetype, size, buffer } = req.file

    if (!mimetype.startsWith('video/')) {
      return next(createError(400, 'Debe ser un video'))
    }

    if (size > SIZE_LIMITS.video) {
      return next(
        createError(400, `Video muy grande (máx ${SIZE_LIMITS.video / (1024 * 1024)} MB)`)
      )
    }

    const allowedMimeTypes = getAllowedMimeTypes()
    if (!allowedMimeTypes.includes(mimetype)) {
      return next(createError(400, 'Tipo de video no permitido'))
    }

    const fileKey = generateFileKey(userId, originalname, mimetype)

    await s3Client.send(
      new PutObjectCommand({
        Bucket: B2_CONFIG.bucket,
        Key: fileKey,
        Body: buffer,
        ContentType: mimetype,
      })
    )

    const publicUrl = getPublicUrl(fileKey)

    return res.status(200).json({
      success: true,
      data: { fileKey, publicUrl, fileType: 'video', contentType: mimetype, size },
    })
  } catch (error) {
    console.error('[UploadVideo] Error:', error.message)
    return next(createError(500, 'Error al subir video'))
  }
}

/**
 * DELETE /api/upload/file
 * Body: { fileKey }
 * Elimina un objeto de B2. Solo el propietario puede hacerlo.
 */
export const deleteFile = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id
    if (!userId) return next(createError(401, 'Usuario no autenticado'))

    const { fileKey } = req.body
    if (!fileKey) return next(createError(400, 'fileKey requerido'))

    if (!fileKey.includes(String(userId))) {
      return next(createError(403, 'No tienes permiso para eliminar este archivo'))
    }

    await s3Client.send(
      new DeleteObjectCommand({ Bucket: B2_CONFIG.bucket, Key: fileKey })
    )

    return res.status(200).json({ success: true, message: 'Archivo eliminado' })
  } catch (error) {
    console.error('[DeleteFile] Error:', error.message)
    return next(createError(500, 'Error al eliminar el archivo'))
  }
}

export default { generatePresignedPost, uploadImage, uploadVideo, deleteFile }
