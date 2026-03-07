/**
 * Rate Limiting para Endpoints de Video — Stream-In
 *
 * Capa de protección: LIMITACIÓN DE TASA (Capa 6)
 * Amenaza cubierta: Scraping automatizado, extracción masiva de contenido,
 *   ataques de fuerza bruta contra el proxy de streaming.
 *
 * Configuración:
 *  - Proxy de streaming: 120 req / 15 min por IP
 *  - Emisión de tokens de sesión: 20 req / 15 min por IP
 *  - Endpoints de video (metadata): 200 req / 15 min por IP
 *
 * Retorna 429 Too Many Requests cuando se excede el límite.
 *
 * Requiere: npm install express-rate-limit
 * Si no está instalado, los limiters son no-ops (sin restricción).
 */

import { createRequire } from 'module'
import { logRateLimit } from '../config/logger.js'

const require = createRequire(import.meta.url)

// ── Intentar cargar express-rate-limit ────────────────────────────────────────
let rateLimit = null
try {
  rateLimit = require('express-rate-limit')
  // express-rate-limit v7 exporta como default
  if (rateLimit && rateLimit.default) {
    rateLimit = rateLimit.default
  }
} catch {
  console.warn('[RateLimiter] express-rate-limit no disponible. Rate limiting desactivado. Ejecutar: npm install express-rate-limit')
}

/**
 * Middleware no-op para cuando express-rate-limit no está disponible.
 */
const noopMiddleware = (req, res, next) => next()

/**
 * Manejador personalizado para cuando se excede el límite.
 * Registra el evento y retorna 429.
 */
const rateLimitHandler = (req, res, next, options) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown'
  const userAgent = req.headers['user-agent'] || 'unknown'

  logRateLimit({
    ip,
    endpoint: req.path,
    userAgent,
  })

  res.status(429).json({
    success: false,
    message: 'Demasiadas solicitudes. Por favor espera antes de continuar.',
    retryAfter: Math.ceil((options?.windowMs || 900000) / 1000),
  })
}

/**
 * Crea un rate limiter o retorna un no-op si express-rate-limit no está disponible.
 */
const createLimiter = (options) => {
  if (!rateLimit) return noopMiddleware
  if (process.env.DISABLE_RATE_LIMIT === 'true') return noopMiddleware

  return rateLimit({
    ...options,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown'
    },
    handler: rateLimitHandler,
  })
}

/**
 * Rate limiter para el proxy de streaming de video.
 *
 * Límite: 120 solicitudes por IP cada 15 minutos.
 * Justificación: Un usuario legítimo viendo un video HLS genera ~1 solicitud
 * por fragmento (cada 6s), lo que equivale a ~150 req/15min para 1 video.
 * El límite de 120 permite reproducción normal pero bloquea scraping masivo.
 */
export const streamRateLimiter = createLimiter({
  windowMs: parseInt(process.env.STREAM_RATE_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max: parseInt(process.env.STREAM_RATE_MAX) || 120,
})

/**
 * Rate limiter para emisión de tokens de sesión.
 *
 * Límite: 20 solicitudes por IP cada 15 minutos.
 */
export const sessionRateLimiter = createLimiter({
  windowMs: parseInt(process.env.SESSION_RATE_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max: parseInt(process.env.SESSION_RATE_MAX) || 20,
})

/**
 * Rate limiter general para endpoints de metadata de video.
 *
 * Límite: 200 solicitudes por IP cada 15 minutos.
 */
export const videoMetaRateLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 min
  max: parseInt(process.env.VIDEO_META_RATE_MAX) || 200,
})

export default { streamRateLimiter, sessionRateLimiter, videoMetaRateLimiter }
