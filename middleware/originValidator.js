/**
 * Middleware de Validación de Origen — stream-in
 *
 * Capa de protección: VALIDACIÓN DE ORIGEN (Capa 2)
 * Amenaza cubierta: Acceso directo desde navegadores externos, aplicaciones de
 *   terceros, gestores de descarga, o cualquier cliente que no sea la aplicación.
 *
 * Valida los headers `Origin` y `Referer` en cada solicitud de reproducción.
 * Rechaza con 403 Forbidden cualquier solicitud que no provenga del dominio
 * autorizado de la aplicación.
 *
 * IMPORTANTE: Esta validación ocurre ANTES de generar cualquier URL firmada
 * o procesar el token de sesión.
 */

import { logVideoAccess } from '../config/logger.js'

/**
 * Obtiene la lista de orígenes permitidos desde variables de entorno.
 * Soporta múltiples dominios separados por coma.
 *
 * @returns {string[]} Lista de orígenes permitidos
 */
const getAllowedOrigins = () => {
  const raw = process.env.ALLOWED_ORIGINS || ''
  const origins = raw
    .split(',')
    .map(o => o.trim().toLowerCase())
    .filter(Boolean)

  // En desarrollo, permitir localhost por defecto
  if (process.env.NODE_ENV !== 'production') {
    const devOrigins = [
      'http://localhost:3000',
      'http://localhost:5000',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5000',
    ]
    return [...new Set([...origins, ...devOrigins])]
  }

  return origins
}

/**
 * Extrae el origen base de una URL completa.
 * Ejemplo: "https://example.com/path?q=1" → "https://example.com"
 *
 * @param {string} url
 * @returns {string|null}
 */
const extractOrigin = (url) => {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Verifica si un origen está en la lista de permitidos.
 *
 * @param {string} origin
 * @param {string[]} allowedOrigins
 * @returns {boolean}
 */
const isOriginAllowed = (origin, allowedOrigins) => {
  if (!origin) return false
  const normalizedOrigin = origin.toLowerCase().replace(/\/$/, '')
  return allowedOrigins.some(allowed => normalizedOrigin === allowed.replace(/\/$/, ''))
}

/**
 * Middleware de validación de origen para endpoints de video.
 *
 * Rechaza solicitudes que no provengan del dominio autorizado.
 * En modo desarrollo, permite solicitudes sin Origin (herramientas como Postman).
 */
export const validateOrigin = (req, res, next) => {
  const allowedOrigins = getAllowedOrigins()
  const origin = req.headers['origin']
  const referer = req.headers['referer']
  const ip = req.ip || req.connection?.remoteAddress || 'unknown'
  const resource = req.params?.videoId || req.query?.key || req.path

  // En desarrollo sin ALLOWED_ORIGINS configurado, ser permisivo
  if (process.env.NODE_ENV !== 'production' && allowedOrigins.length === 0) {
    return next()
  }

  // Verificar Origin header (presente en solicitudes cross-origin del navegador)
  if (origin) {
    if (isOriginAllowed(origin, allowedOrigins)) {
      return next()
    }

    logVideoAccess({
      ip,
      resource,
      authorized: false,
      reason: `Origin no permitido: ${origin}`,
      origin,
      referer,
      tokenValid: false,
      userAgent: req.headers['user-agent'],
      statusCode: 403,
    })

    return res.status(403).json({
      success: false,
      message: 'Acceso denegado: origen no autorizado',
    })
  }

  // Si no hay Origin, verificar Referer como fallback
  if (referer) {
    const refererOrigin = extractOrigin(referer)
    if (refererOrigin && isOriginAllowed(refererOrigin, allowedOrigins)) {
      return next()
    }

    logVideoAccess({
      ip,
      resource,
      authorized: false,
      reason: `Referer no permitido: ${referer}`,
      origin,
      referer,
      tokenValid: false,
      userAgent: req.headers['user-agent'],
      statusCode: 403,
    })

    return res.status(403).json({
      success: false,
      message: 'Acceso denegado: referer no autorizado',
    })
  }

  // Sin Origin ni Referer: en producción rechazar, en desarrollo permitir
  if (process.env.NODE_ENV === 'production') {
    logVideoAccess({
      ip,
      resource,
      authorized: false,
      reason: 'Sin headers Origin ni Referer',
      origin: null,
      referer: null,
      tokenValid: false,
      userAgent: req.headers['user-agent'],
      statusCode: 403,
    })

    return res.status(403).json({
      success: false,
      message: 'Acceso denegado: solicitud sin origen identificable',
    })
  }

  // Desarrollo: permitir sin Origin/Referer
  next()
}

export default validateOrigin
