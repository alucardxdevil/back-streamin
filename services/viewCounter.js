/**
 * Contador de vistas con buffer en Redis y flush periódico a MongoDB.
 *
 * Problema que resuelve (F-14 / N-02): antes cada reproducción disparaba DOS
 * writes en Mongo (views del video + totalViews del dueño), sin dedup. Con el
 * streaming ya cacheado en el edge, ese era el write más caliente del backend.
 *
 * Diseño:
 *  - En cada vista: 1 SET NX EX (dedup por viewer+video, ventana de 30 min) y,
 *    si es nueva, 1 HINCRBY. Cero writes a Mongo en el camino caliente.
 *  - Un flusher corre cada FLUSH_INTERVAL (default 30 s), drena el hash de
 *    pendientes de forma atómica (RENAME) y aplica los incrementos a Mongo en
 *    un único bulkWrite por colección.
 *
 * Si Redis no está disponible, recordView degrada a no-op (la vista no se
 * cuenta, pero la reproducción nunca falla).
 */

import { createRedisConnection } from '../config/redis.js'
import Video from '../models/Video.js'
import User from '../models/User.js'
import logger from '../config/logger.js'

const PENDING_VIDEOS_KEY = 'views:pending:videos'
const DEDUP_TTL_SECONDS = parseInt(process.env.VIEW_DEDUP_TTL_SECONDS) || 1800
const FLUSH_INTERVAL_MS = parseInt(process.env.VIEW_FLUSH_INTERVAL_MS) || 30000

let redis = null
let flushTimer = null

/** Conexión Redis dedicada (lazy). */
const getRedis = () => {
  if (!redis) {
    redis = createRedisConnection()
  }
  return redis
}

/**
 * Registra una vista. Deduplica por (viewer, video) durante DEDUP_TTL_SECONDS.
 *
 * @param {Object} args
 * @param {string} args.videoId
 * @param {string} args.viewerId - Identificador estable del espectador (sesión o IP).
 * @returns {Promise<boolean>} true si la vista se contó como nueva.
 */
export const recordView = async ({ videoId, viewerId }) => {
  if (!videoId) return false
  try {
    const r = getRedis()
    const dedupKey = `views:seen:${videoId}:${viewerId || 'anon'}`

    // SET NX: sólo tiene éxito si la clave no existía → vista nueva en la ventana.
    const set = await r.set(dedupKey, '1', 'EX', DEDUP_TTL_SECONDS, 'NX')
    if (set !== 'OK') {
      return false // Ya contamos a este viewer recientemente
    }

    await r.hincrby(PENDING_VIDEOS_KEY, String(videoId), 1)
    return true
  } catch (err) {
    logger.warn('[viewCounter] recordView falló (Redis?)', { error: err.message })
    return false
  }
}

/**
 * Devuelve cuántas vistas pendientes (aún no flusheadas) tiene un video, para
 * sumarlas al valor almacenado y mostrar un contador "en vivo".
 *
 * @param {string} videoId
 * @returns {Promise<number>}
 */
export const getPendingViews = async (videoId) => {
  if (!videoId) return 0
  try {
    const r = getRedis()
    const val = await r.hget(PENDING_VIDEOS_KEY, String(videoId))
    return val ? parseInt(val, 10) || 0 : 0
  } catch {
    return 0
  }
}

/**
 * Drena los contadores pendientes y los aplica a MongoDB en bulk.
 * Seguro ante múltiples instancias: RENAME es atómico, sólo una gana el lote.
 */
export const flushViews = async () => {
  let counts
  const tmpKey = `views:flushing:${Date.now()}`
  try {
    const r = getRedis()
    // RENAME atómico: aislamos el lote actual. Si no hay clave, no hay nada.
    try {
      await r.rename(PENDING_VIDEOS_KEY, tmpKey)
    } catch (e) {
      if (/no such key/i.test(e.message)) return
      throw e
    }
    counts = await r.hgetall(tmpKey)
    await r.del(tmpKey)
  } catch (err) {
    logger.error('[viewCounter] No se pudo drenar el buffer de vistas', { error: err.message })
    return
  }

  const entries = Object.entries(counts || {}).filter(([, n]) => parseInt(n, 10) > 0)
  if (entries.length === 0) return

  try {
    // 1) Incrementar views de cada video en un solo bulkWrite.
    const videoOps = entries.map(([videoId, n]) => ({
      updateOne: {
        filter: { _id: videoId },
        update: { $inc: { views: parseInt(n, 10) } },
      },
    }))
    await Video.bulkWrite(videoOps, { ordered: false })

    // 2) Acumular totalViews por dueño. Un único find para mapear video→userId.
    const videoIds = entries.map(([videoId]) => videoId)
    const owners = await Video.find({ _id: { $in: videoIds } })
      .select('userId')
      .lean()

    const countByVideo = new Map(entries.map(([id, n]) => [String(id), parseInt(n, 10)]))
    const viewsByUser = new Map()
    for (const v of owners) {
      if (!v.userId) continue
      const add = countByVideo.get(String(v._id)) || 0
      viewsByUser.set(v.userId, (viewsByUser.get(v.userId) || 0) + add)
    }

    if (viewsByUser.size > 0) {
      const userOps = [...viewsByUser.entries()].map(([userId, n]) => ({
        updateOne: {
          filter: { _id: userId },
          update: { $inc: { totalViews: n } },
        },
      }))
      await User.bulkWrite(userOps, { ordered: false })
    }
  } catch (err) {
    // Re-encolar los conteos para no perderlos si Mongo falló a mitad.
    logger.error('[viewCounter] Flush a Mongo falló, re-encolando', { error: err.message })
    try {
      const r = getRedis()
      const pipeline = r.pipeline()
      for (const [videoId, n] of entries) {
        pipeline.hincrby(PENDING_VIDEOS_KEY, videoId, parseInt(n, 10))
      }
      await pipeline.exec()
    } catch (reErr) {
      logger.error('[viewCounter] Re-encolado de vistas falló', { error: reErr.message })
    }
  }
}

/** Arranca el flusher periódico. Idempotente. */
export const startViewFlusher = () => {
  if (flushTimer) return
  flushTimer = setInterval(() => {
    flushViews().catch((err) =>
      logger.error('[viewCounter] flushViews lanzó', { error: err.message }),
    )
  }, FLUSH_INTERVAL_MS)
  // No bloquear el cierre del proceso por este timer.
  if (flushTimer.unref) flushTimer.unref()
  logger.info(`[viewCounter] Flusher activo cada ${FLUSH_INTERVAL_MS}ms`)
}

/** Detiene el flusher y hace un último flush. Útil en shutdown/tests. */
export const stopViewFlusher = async () => {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  await flushViews()
}

/**
 * Resumen de vistas pendientes de flush (para panel de infraestructura).
 * @returns {Promise<{ videosWithPending: number, pendingViewsTotal: number, error?: string }>}
 */
export const getPendingViewsSummary = async () => {
  try {
    const r = getRedis()
    const all = await r.hgetall(PENDING_VIDEOS_KEY)
    const entries = Object.entries(all || {})
    let pendingViewsTotal = 0
    for (const [, n] of entries) {
      pendingViewsTotal += parseInt(n, 10) || 0
    }
    return { videosWithPending: entries.length, pendingViewsTotal }
  } catch (err) {
    return { videosWithPending: 0, pendingViewsTotal: 0, error: err.message }
  }
}

export default { recordView, getPendingViews, flushViews, startViewFlusher, stopViewFlusher, getPendingViewsSummary }
