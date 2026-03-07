/**
 * Rutas de Transcodificación HLS
 *
 * Endpoints:
 *  POST   /api/transcode/presigned-upload  → Genera URL para subida directa a B2
 *  POST   /api/transcode/enqueue           → Encola job de transcodificación
 *  GET    /api/transcode/status/:videoId   → Consulta estado de transcodificación
 *  GET    /api/transcode/queue-stats       → Estadísticas de la cola (admin)
 *  POST   /api/transcode/retry/:videoId    → Reintenta transcodificación fallida
 */

import express from 'express'
import { verifyToken } from '../verifyToken.js'
import {
  generateVideoUploadUrl,
  enqueueTranscode,
  getTranscodeStatus,
  getQueueStatistics,
  retryTranscode,
} from '../controllers/transcode.js'

const router = express.Router()

/**
 * POST /api/transcode/presigned-upload
 *
 * Paso 1 del flujo: Genera presigned URL para subida directa del MP4 a B2.
 * El cliente sube el archivo directamente a B2 sin pasar por el servidor.
 *
 * Body: { fileName, contentType, fileSize }
 * Response: { uploadUrl, rawKey, expiresIn }
 */
router.post('/presigned-upload', verifyToken, generateVideoUploadUrl)

/**
 * POST /api/transcode/enqueue
 *
 * Paso 2 del flujo: Después de subir el MP4 a B2, encolar la transcodificación.
 * Crea el documento Video en MongoDB y agrega el job a la cola BullMQ.
 *
 * Body: { rawKey, title, description, tags, imgUrl, imgKey, fileSize }
 * Response: { videoId, jobId, status }
 */
router.post('/enqueue', verifyToken, enqueueTranscode)

/**
 * GET /api/transcode/status/:videoId
 *
 * Consulta el estado de transcodificación de un video.
 * El frontend puede hacer polling cada 3-5 segundos.
 *
 * Response: { status, progress, hlsMasterUrl, qualities, error }
 */
router.get('/status/:videoId', verifyToken, getTranscodeStatus)

/**
 * GET /api/transcode/queue-stats
 *
 * Estadísticas de la cola (waiting, active, completed, failed).
 * Útil para monitoreo y dashboard de administración.
 */
router.get('/queue-stats', verifyToken, getQueueStatistics)

/**
 * POST /api/transcode/retry/:videoId
 *
 * Reintenta la transcodificación de un video con status 'error'.
 * Solo el propietario del video puede reintentar.
 */
router.post('/retry/:videoId', verifyToken, retryTranscode)

export default router
