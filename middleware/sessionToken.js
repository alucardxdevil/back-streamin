/**
 * Sistema de Tokens de Sesión Anónimos — stream-in
 *
 * Capa de protección: SESIÓN ANÓNIMA (Capa 3)
 * Amenaza cubierta: Solicitudes realizadas fuera del contexto de la aplicación.
 *   Un atacante que copie una URL de video no tendrá un token de sesión válido
 *   emitido por el servidor, por lo que su solicitud será rechazada.
 *
 * Flujo:
 *  1. El cliente carga la aplicación → GET /api/stream/session
 *  2. El servidor emite un JWT firmado con vida corta (30 min)
 *  3. El frontend almacena el token en memoria (no en localStorage)
 *  4. Cada solicitud de video incluye el token en el header X-Session-Token
 *  5. El middleware verifica el token antes de procesar la solicitud
 *
 * El token NO contiene información de usuario — solo un ID de sesión aleatorio
 * y metadatos de emisión. Su propósito es demostrar que la solicitud proviene
 * de una sesión iniciada dentro de la aplicación.
 */

import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { logVideoAccess, logSessionIssued } from '../config/logger.js'

// Duración del token de sesión anónimo (30 minutos)
const SESSION_TOKEN_TTL = parseInt(process.env.SESSION_TOKEN_TTL_SECONDS) || 1800

// Secret para firmar tokens de sesión (diferente al JWT de autenticación)
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'session-secret-change-in-production'

/**
 * Genera un nuevo token de sesión anónimo.
 *
 * @param {string} ip - IP del cliente (para binding opcional)
 * @returns {{ token: string, sessionId: string, expiresIn: number }}
 */
export const generateSessionToken = (ip = null) => {
  const sessionId = uuidv4()
  const issuedAt = Math.floor(Date.now() / 1000)

  const payload = {
    sid: sessionId,
    iat: issuedAt,
    type: 'anon_session',
    // Incluir IP parcial como contexto (no como validación estricta)
    // Solo los primeros 2 octetos para no ser demasiado restrictivo con IPs dinámicas
    ipHint: ip ? ip.split('.').slice(0, 2).join('.') : null,
  }

  const token = jwt.sign(payload, SESSION_SECRET, {
    expiresIn: SESSION_TOKEN_TTL,
    algorithm: 'HS256',
  })

  return {
    token,
    sessionId,
    expiresIn: SESSION_TOKEN_TTL,
  }
}

/**
 * Verifica un token de sesión anónimo.
 *
 * @param {string} token
 * @returns {{ valid: boolean, payload: object|null, reason: string|null }}
 */
export const verifySessionToken = (token) => {
  if (!token) {
    return { valid: false, payload: null, reason: 'Token ausente' }
  }

  try {
    const payload = jwt.verify(token, SESSION_SECRET, {
      algorithms: ['HS256'],
    })

    // Verificar que sea un token de sesión anónima (no un JWT de usuario)
    if (payload.type !== 'anon_session') {
      return { valid: false, payload: null, reason: 'Tipo de token inválido' }
    }

    return { valid: true, payload, reason: null }
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { valid: false, payload: null, reason: 'Token expirado' }
    }
    if (err.name === 'JsonWebTokenError') {
      return { valid: false, payload: null, reason: 'Token malformado' }
    }
    return { valid: false, payload: null, reason: 'Error de verificación' }
  }
}

/**
 * Controlador: POST /api/stream/session
 *
 * Emite un nuevo token de sesión anónimo.
 * El frontend debe llamar a este endpoint al cargar la aplicación.
 */
export const issueSessionToken = (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown'
  const userAgent = req.headers['user-agent'] || 'unknown'

  const { token, sessionId, expiresIn } = generateSessionToken(ip)

  logSessionIssued({ ip, sessionId: sessionId.substring(0, 8), userAgent })

  return res.status(200).json({
    success: true,
    data: {
      sessionToken: token,
      expiresIn,
      // Indicar al cliente cuándo renovar (5 minutos antes de expirar)
      renewBefore: expiresIn - 300,
    },
  })
}

/**
 * Middleware: Valida el token de sesión anónimo en solicitudes de video.
 *
 * El token puede venir en:
 *  - Header: X-Session-Token
 *  - Cookie: stream_session (como fallback)
 *
 * En desarrollo, si no hay SESSION_SECRET configurado, permite el acceso
 * con una advertencia.
 */
export const requireSessionToken = (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown'
  const resource = req.params?.videoId || req.query?.key || req.path
  const origin = req.headers['origin']
  const referer = req.headers['referer']
  const userAgent = req.headers['user-agent']

  // Obtener token del header, cookie o query param (Safari fallback)
  // El query param _st se usa como fallback para Safari que no soporta
  // headers personalizados en solicitudes de media nativas
  const token =
    req.headers['x-session-token'] ||
    req.cookies?.stream_session ||
    req.query?._st ||
    null

  const { valid, payload, reason } = verifySessionToken(token)

  if (!valid) {
    // En desarrollo, advertir pero no bloquear si no hay SESSION_SECRET configurado
    if (process.env.NODE_ENV !== 'production' && !process.env.SESSION_SECRET) {
      console.warn(`[SessionToken] Advertencia: token inválido en desarrollo (${reason}). Permitiendo acceso.`)
      req.sessionPayload = null
      req.sessionValid = false
      return next()
    }

    logVideoAccess({
      ip,
      resource,
      authorized: false,
      reason: `Token de sesión inválido: ${reason}`,
      origin,
      referer,
      tokenValid: false,
      sessionId: null,
      userAgent,
      statusCode: 401,
    })

    return res.status(401).json({
      success: false,
      message: 'Sesión inválida o expirada. Recarga la aplicación.',
      code: 'SESSION_INVALID',
    })
  }

  // Adjuntar payload al request para uso posterior
  req.sessionPayload = payload
  req.sessionValid = true
  next()
}

export default { issueSessionToken, requireSessionToken, generateSessionToken, verifySessionToken }
