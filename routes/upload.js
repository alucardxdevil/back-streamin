/**
 * Rutas para manejo de uploads con Backblaze B2
 *
 * Modo actual: Proxy (el archivo pasa por el servidor en memoria, nunca en disco)
 * Modo ideal:  Subida directa cliente→B2 (requiere CORS en B2)
 *              Ejecutar: node server/scripts/setup-b2-cors.js
 *
 * Rutas disponibles:
 *  POST   /api/upload/image                  → sube imagen vía proxy
 *  POST   /api/upload/video                  → sube video vía proxy
 *  POST   /api/upload/generate-presigned-post → genera token para subida directa
 *  DELETE /api/upload/file                   → elimina archivo de B2
 */

import express from 'express'
import multer from 'multer'
import { verifyToken } from '../verifyToken.js'
import {
  generatePresignedPost,
  uploadImage,
  uploadVideo,
  deleteFile,
} from '../controllers/upload.js'

const router = express.Router()

// Multer en memoria — los bytes nunca tocan el disco del servidor
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 800 * 1024 * 1024, // 800 MB máximo (vídeo vía proxy)
  },
})

/**
 * POST /api/upload/image
 * Sube imagen a B2 a través del servidor (proxy).
 * Body: multipart/form-data con campo "file"
 */
router.post('/image', verifyToken, upload.single('file'), uploadImage)

/**
 * POST /api/upload/video
 * Sube video a B2 a través del servidor (proxy).
 * Body: multipart/form-data con campo "file"
 */
router.post('/video', verifyToken, upload.single('file'), uploadVideo)

/**
 * POST /api/upload/generate-presigned-post
 * Genera presigned POST para subida directa cliente→B2.
 * Requiere CORS configurado en B2 (node server/scripts/setup-b2-cors.js)
 * Body: { fileName, contentType, fileSize }
 */
router.post('/generate-presigned-post', verifyToken, generatePresignedPost)

/**
 * DELETE /api/upload/file
 * Elimina archivo de B2.
 * Body: { fileKey }
 */
router.delete('/file', verifyToken, deleteFile)

export default router
