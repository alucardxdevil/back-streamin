/**
 * Cola de transcodificación con BullMQ
 *
 * Esta cola gestiona los jobs de transcodificación de video.
 * Los workers consumen esta cola en procesos separados.
 *
 * Flujo:
 *  1. API encola job con { videoId, rawKey, userId }
 *  2. Worker descarga MP4, transcodifica con FFmpeg, sube HLS a B2
 *  3. Worker actualiza MongoDB con hlsMasterUrl y status: 'ready'
 *  4. Worker elimina MP4 original de B2
 */

import { Queue, QueueEvents } from 'bullmq'
import { createRedisConnection } from '../config/redis.js'

// Nombre de la cola — debe coincidir con el worker
export const QUEUE_NAME = 'transcode'

// Opciones por defecto para todos los jobs
export const DEFAULT_JOB_OPTIONS = {
  // Reintentos automáticos en caso de fallo
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 10000, // 10s, 20s, 40s entre reintentos
  },
  // Limpieza automática de jobs completados
  removeOnComplete: {
    age: 86400,   // Mantener 24 horas
    count: 200,   // Máximo 200 jobs completados en memoria Redis
  },
  // Mantener jobs fallidos 7 días para debugging
  removeOnFail: {
    age: 604800,
  },
}

// Instancia singleton de la cola
let transcodeQueue = null

/**
 * Obtiene (o crea) la instancia de la cola de transcodificación.
 * Patrón singleton para evitar múltiples conexiones Redis.
 */
export const getTranscodeQueue = () => {
  if (!transcodeQueue) {
    transcodeQueue = new Queue(QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    })

    transcodeQueue.on('error', (err) => {
      console.error('[TranscodeQueue] Error en la cola:', err.message)
    })

    console.log(`[TranscodeQueue] Cola "${QUEUE_NAME}" inicializada`)
  }

  return transcodeQueue
}

/**
 * Encola un job de transcodificación.
 *
 * @param {Object} jobData
 * @param {string} jobData.videoId     - ID del documento Video en MongoDB
 * @param {string} jobData.rawKey      - Key del MP4 en B2 (raw/{userId}/{uuid}.mp4)
 * @param {string} jobData.userId      - ID del usuario propietario
 * @param {string} [jobData.title]     - Título del video (para logs)
 * @param {Object} [options]           - Opciones adicionales de BullMQ
 * @returns {Promise<Job>}             - Job encolado
 */
export const enqueueTranscodeJob = async (jobData, options = {}) => {
  const queue = getTranscodeQueue()

  const job = await queue.add(
    'transcode-video',
    {
      videoId: jobData.videoId,
      rawKey: jobData.rawKey,
      userId: jobData.userId,
      title: jobData.title || 'Sin título',
      enqueuedAt: new Date().toISOString(),
    },
    {
      ...DEFAULT_JOB_OPTIONS,
      ...options,
      // Usar videoId como jobId para evitar duplicados
      jobId: `video-${jobData.videoId}`,
    }
  )

  console.log(`[TranscodeQueue] Job encolado: ${job.id} para video ${jobData.videoId}`)
  return job
}

/**
 * Obtiene el estado de un job por su ID.
 *
 * @param {string} jobId - ID del job en BullMQ
 * @returns {Promise<Object>} - Estado del job
 */
export const getJobStatus = async (jobId) => {
  const queue = getTranscodeQueue()
  const job = await queue.getJob(jobId)

  if (!job) {
    return { found: false, jobId }
  }

  const state = await job.getState()
  const progress = job.progress

  return {
    found: true,
    jobId: job.id,
    state,           // 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
    progress,        // 0-100
    data: job.data,
    failedReason: job.failedReason || null,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    attemptsMade: job.attemptsMade,
  }
}

/**
 * Obtiene estadísticas de la cola.
 * Útil para el dashboard de monitoreo.
 */
export const getQueueStats = async () => {
  const queue = getTranscodeQueue()

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ])

  return { waiting, active, completed, failed, delayed }
}

/**
 * Crea un QueueEvents para escuchar eventos de la cola.
 * Útil para WebSockets o notificaciones en tiempo real.
 */
export const createQueueEvents = () => {
  return new QueueEvents(QUEUE_NAME, {
    connection: createRedisConnection(),
  })
}

export default getTranscodeQueue
