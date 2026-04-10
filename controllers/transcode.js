/**
 * Controlador de Transcodificación
 *
 * Maneja las operaciones relacionadas con el pipeline de transcodificación:
 *  - Encolar jobs de transcodificación
 *  - Consultar estado de un video
 *  - Obtener estadísticas de la cola
 *  - Generar presigned URL para subida directa a B2
 */

import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { v4 as uuidv4 } from 'uuid'
import { s3Client, B2_CONFIG } from '../config/b2.js'
import { enqueueTranscodeJob, getJobStatus, getQueueStats } from '../queues/transcodeQueue.js'
import { createError } from '../err.js'
import Video from '../models/Video.js'

// TTL de la presigned URL en segundos (15 minutos)
const PRESIGNED_URL_TTL = 900

// Tamaño máximo del video en bytes (800 MB — beta stream-in.com)
const MAX_VIDEO_SIZE = 800 * 1024 * 1024

/**
 * POST /api/transcode/presigned-upload
 *
 * Genera una presigned URL para que el cliente suba el MP4 directamente a B2.
 * El archivo se guarda en raw/{userId}/{uuid}.mp4
 *
 * Body: { fileName, contentType, fileSize }
 * Response: { uploadUrl, fileKey, expiresIn }
 */
export const generateVideoUploadUrl = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id
    if (!userId) return next(createError(401, 'Token inválido'))

    const { fileName, contentType, fileSize } = req.body

    if (!fileName || !contentType) {
      return next(createError(400, 'fileName y contentType son requeridos'))
    }

    // Validar que sea un video
    if (!contentType.startsWith('video/')) {
      return next(createError(400, 'Solo se permiten archivos de video'))
    }

    // Validar tamaño
    if (fileSize && fileSize > MAX_VIDEO_SIZE) {
      return next(createError(400, `Archivo demasiado grande. Máximo ${MAX_VIDEO_SIZE / (1024 * 1024)} MB`))
    }

    // Generar key único para el archivo raw
    const uuid = uuidv4()
    const ext = fileName.split('.').pop()?.toLowerCase() || 'mp4'
    const rawKey = `raw/${userId}/${Date.now()}-${uuid}.${ext}`

    // Generar presigned URL para PUT (subida directa)
    const command = new PutObjectCommand({
      Bucket: B2_CONFIG.bucket,
      Key: rawKey,
      ContentType: contentType,
    })

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: PRESIGNED_URL_TTL,
    })

    return res.status(200).json({
      success: true,
      data: {
        uploadUrl,
        rawKey,
        expiresIn: PRESIGNED_URL_TTL,
        maxFileSize: MAX_VIDEO_SIZE,
      },
    })
  } catch (error) {
    console.error('[Transcode] generateVideoUploadUrl error:', error.message)
    return next(createError(500, 'Error al generar URL de subida'))
  }
}

/**
 * POST /api/transcode/enqueue
 *
 * Crea el documento Video en MongoDB y encola el job de transcodificación.
 * Llamar DESPUÉS de que el cliente haya subido el MP4 a B2.
 *
 * Body: {
 *   rawKey,       // Key del MP4 en B2 (obtenido de /presigned-upload)
 *   title,
 *   description,
 *   tags,
 *   imgUrl,       // URL de la miniatura (ya subida)
 *   imgKey,       // Key de la miniatura en B2
 *   fileSize,     // Tamaño del archivo en bytes
 * }
 */
export const enqueueTranscode = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id
    if (!userId) return next(createError(401, 'Token inválido'))

    const { rawKey, title, description, classification = 'A', tags, imgUrl, imgKey, fileSize } = req.body

    // Validaciones
    if (!rawKey) return next(createError(400, 'rawKey es requerido'))
    if (!title) return next(createError(400, 'title es requerido'))
    if (!description) return next(createError(400, 'description es requerido'))
    if (!imgUrl) return next(createError(400, 'imgUrl es requerido'))
    const normalizedClassification = String(classification).toUpperCase()
    if (!['A', 'B', 'C', 'D'].includes(normalizedClassification)) {
      return next(createError(400, 'classification debe ser A, B, C o D'))
    }

    // Verificar que el rawKey pertenezca al usuario
    if (!rawKey.includes(String(userId))) {
      return next(createError(403, 'No tienes permiso para transcodificar este archivo'))
    }

    // Crear documento Video en MongoDB con status 'pending'
    const video = new Video({
      userId,
      title,
      description,
      classification: normalizedClassification,
      tags: tags || [],
      imgUrl,
      imgKey: imgKey || null,
      rawKey,
      fileSize: fileSize || 0,
      uploadedBy: userId,
      uploadedAt: new Date(),
      status: 'pending',
      // Campos legacy para compatibilidad
      videoUrl: null,
      videoKey: null,
      fileType: 'video',
    })

    await video.save()

    // Encolar job de transcodificación
    const job = await enqueueTranscodeJob({
      videoId: video._id.toString(),
      rawKey,
      userId: String(userId),
      title,
    })

    // Guardar el jobId en el documento
    await Video.findByIdAndUpdate(video._id, {
      transcodeJobId: job.id,
    })

    console.log(`[Transcode] Video ${video._id} encolado. Job: ${job.id}`)

    return res.status(201).json({
      success: true,
      data: {
        videoId: video._id,
        jobId: job.id,
        status: 'pending',
        message: 'Video encolado para transcodificación',
      },
    })
  } catch (error) {
    console.error('[Transcode] enqueueTranscode error:', error.message)
    return next(createError(500, 'Error al encolar transcodificación'))
  }
}

/**
 * GET /api/transcode/status/:videoId
 *
 * Consulta el estado de transcodificación de un video.
 * El frontend puede hacer polling a este endpoint.
 *
 * Response: {
 *   videoId,
 *   status,        // 'pending' | 'processing' | 'ready' | 'error'
 *   progress,      // 0-100 (solo cuando status === 'processing')
 *   hlsMasterUrl,  // URL del master.m3u8 (solo cuando status === 'ready')
 *   qualities,     // ['1080p', '720p', '480p'] (solo cuando status === 'ready')
 *   error,         // Mensaje de error (solo cuando status === 'error')
 * }
 */
export const getTranscodeStatus = async (req, res, next) => {
  try {
    const { videoId } = req.params

    const video = await Video.findById(videoId).select(
      'status hlsMasterUrl qualities duration transcodeJobId transcodeError transcodedAt'
    )

    if (!video) {
      return next(createError(404, 'Video no encontrado'))
    }

    // Si hay un jobId, consultar progreso en tiempo real desde BullMQ
    let jobProgress = null
    if (video.transcodeJobId && video.status === 'processing') {
      try {
        const jobStatus = await getJobStatus(video.transcodeJobId)
        jobProgress = jobStatus.progress
      } catch (err) {
        // No fallar si Redis no está disponible
        console.warn('[Transcode] No se pudo consultar progreso del job:', err.message)
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        videoId,
        status: video.status,
        progress: jobProgress,
        hlsMasterUrl: video.hlsMasterUrl,
        qualities: video.qualities,
        duration: video.duration,
        transcodedAt: video.transcodedAt,
        error: video.transcodeError,
      },
    })
  } catch (error) {
    console.error('[Transcode] getTranscodeStatus error:', error.message)
    return next(createError(500, 'Error al consultar estado'))
  }
}

/**
 * GET /api/transcode/queue-stats
 *
 * Retorna estadísticas de la cola de transcodificación.
 * Solo accesible por administradores.
 */
export const getQueueStatistics = async (req, res, next) => {
  try {
    const stats = await getQueueStats()

    return res.status(200).json({
      success: true,
      data: stats,
    })
  } catch (error) {
    console.error('[Transcode] getQueueStatistics error:', error.message)
    return next(createError(500, 'Error al obtener estadísticas de la cola'))
  }
}

/**
 * POST /api/transcode/retry/:videoId
 *
 * Reintenta la transcodificación de un video que falló.
 * Solo el propietario puede reintentar.
 */
export const retryTranscode = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id
    const { videoId } = req.params

    const video = await Video.findById(videoId)

    if (!video) return next(createError(404, 'Video no encontrado'))
    if (String(video.userId) !== String(userId)) {
      return next(createError(403, 'No tienes permiso para reintentar este video'))
    }
    if (video.status !== 'error') {
      return next(createError(400, `No se puede reintentar un video con status: ${video.status}`))
    }
    if (!video.rawKey) {
      return next(createError(400, 'El archivo original ya fue eliminado. No se puede reintentar.'))
    }

    // Resetear estado
    await Video.findByIdAndUpdate(videoId, {
      status: 'pending',
      transcodeError: null,
      transcodeJobId: null,
    })

    // Re-encolar
    const job = await enqueueTranscodeJob({
      videoId,
      rawKey: video.rawKey,
      userId: String(userId),
      title: video.title,
    })

    await Video.findByIdAndUpdate(videoId, { transcodeJobId: job.id })

    return res.status(200).json({
      success: true,
      data: {
        videoId,
        jobId: job.id,
        status: 'pending',
        message: 'Transcodificación re-encolada',
      },
    })
  } catch (error) {
    console.error('[Transcode] retryTranscode error:', error.message)
    return next(createError(500, 'Error al reintentar transcodificación'))
  }
}

export default {
  generateVideoUploadUrl,
  enqueueTranscode,
  getTranscodeStatus,
  getQueueStatistics,
  retryTranscode,
}
