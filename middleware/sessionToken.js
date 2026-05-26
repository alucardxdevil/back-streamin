/**
 * Sistema de Tokens de Sesi?n An?nimos  stream-in
 *
 * Capa de protecci?n: SESIN ANNIMA (Capa 3)
 * Amenaza cubierta: Solicitudes realizadas fuera del contexto de la aplicaci?n.
 *   Un atacante que copie una URL de video no tendr? un token de sesi?n v?lido
 *   emitido por el servidor, por lo que su solicitud ser? rechazada.
 *
 * Flujo:
 *  1. El cliente carga la aplicaci?n  GET /api/stream/session
 *  2. El servidor emite un JWT firmado con vida corta (30 min)
 *  3. El frontend almacena el token en memoria (no en localStorage)
 *  4. Cada solicitud de video incluye el token en el header X-Session-Token
 *  5. El middleware verifica el token antes de procesar la solicitud
 *
 * El token NO contiene informaci?n de usuario  solo un ID de sesi?n aleatorio
 * y metadatos de emisi?n. Su prop?sito es demostrar que la solicitud proviene
 * de una sesi?n iniciada dentro de la aplicaci?n.
 */

import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { logVideoAccess, logSessionIssued } from '../config/logger.js'
import { getSessionSecret } from '../utils/secrets.js'
import {
  getStreamSessionCookieOptions,
  STREAM_SESSION_COOKIE_NAME,
} from '../utils/cookieOptions.js'

// Duraci?n del token de sesi?n an?nimo (30 minutos)
const SESSION_TOKEN_TTL = parseInt(process.env.SESSION_TOKEN_TTL_SECONDS) || 1800

// Secret para firmar tokens de sesi?n (diferente al JWT de autenticaci?n)
const SESSION_SECRET = getSessionSecret()

/**
 * Genera un nuevo token de sesi?n an?nimo.
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
    // Incluir IP parcial como contexto (no como validaci?n estricta)
    // Solo los primeros 2 octetos para no ser demasiado restrictivo con IPs din?micas
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
 * Verifica un token de sesi?n an?nimo.
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

    // Verificar que sea un token de sesi?n an?nima (no un JWT de usuario)
    if (payload.type !== 'anon_session') {
      return { valid: false, payload: null, reason: 'Tipo de token inv?lido' }
    }

    return { valid: true, payload, reason: null }
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { valid: false, payload: null, reason: 'Token expirado' }
    }
    if (err.name === 'JsonWebTokenError') {
      return { valid: false, payload: null, reason: 'Token malformado' }
    }
    return { valid: false, payload: null, reason: 'Error de verificaci?n' }
  }
}

/**
 * Controlador: POST /api/stream/session
 *
 * Emite un nuevo token de sesi?n an?nimo.
 * El frontend debe llamar a este endpoint al cargar la aplicaci?n.
 */
export const issueSessionToken = (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown'
  const userAgent = req.headers['user-agent'] || 'unknown'

  const { token, sessionId, expiresIn } = generateSessionToken(ip)

  logSessionIssued({ ip, sessionId: sessionId.substring(0, 8), userAgent })

  // Emitir la cookie cross-domain `stream_session` (Domain=.stream-in.com).
  // El navegador la enviar automticamente en cada peticin a api.stream-in.com
  // que tenga withCredentials=true. Esto reemplaza al query param `_st` en las
  // URLs de fragmentos HLS, lo que permite que Cloudflare comparta el cache
  // entre todos los usuarios que ven el mismo video (sin necesidad de configurar
  // cache keys custom, que son plan Enterprise).
  res.cookie(
    STREAM_SESSION_COOKIE_NAME,
    token,
    getStreamSessionCookieOptions(expiresIn),
  )

  return res.status(200).json({
    success: true,
    data: {
      sessionToken: token,
      expiresIn,
      // Indicar al cliente cundo renovar (5 minutos antes de expirar)
      renewBefore: expiresIn - 300,
    },
  })
}

/**
 * Middleware: Valida el token de sesi?n an?nimo en solicitudes de video.
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
    logVideoAccess({
      ip,
      resource,
      authorized: false,
      reason: `Token de sesi?n inv?lido: ${reason}`,
      origin,
      referer,
      tokenValid: false,
      sessionId: null,
      userAgent,
      statusCode: 401,
    })

    return res.status(401).json({
      success: false,
      message: 'Sesi?n inv?lida o expirada. Recarga la aplicaci?n.',
      code: 'SESSION_INVALID',
    })
  }

  // Adjuntar payload al request para uso posterior
  req.sessionPayload = payload
  req.sessionValid = true
  next()
}

export default { issueSessionToken, requireSessionToken, generateSessionToken, verifySessionToken }
