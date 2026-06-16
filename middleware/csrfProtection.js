/**
 * Protección CSRF — double-submit cookie + validación de Origin.
 *
 * Diseñado para producción:
 *  - Frontend: Cloudflare Pages (https://teleprt.com)
 *  - API: VPS Hetzner (https://api.teleprt.com) con COOKIE_DOMAIN=.teleprt.com
 *
 * Clientes móviles (Flutter) usan Bearer sin cookie → exentos de CSRF.
 */

import crypto from 'crypto'
import { getAllowedOrigins, extractOriginFromUrl, isOriginAllowed } from '../config/allowedOrigins.js'

export const CSRF_COOKIE_NAME = 'csrf_token'
export const CSRF_HEADER_NAME = 'x-csrf-token'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex')
}

export function getCsrfCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production'
  const maxAge = 24 * 60 * 60 * 1000 // 24 h

  if (!isProd) {
    return {
      httpOnly: false,
      secure: false,
      sameSite: 'lax',
      maxAge,
      path: '/',
    }
  }

  const domain = process.env.COOKIE_DOMAIN || '.teleprt.com'
  return {
    httpOnly: false,
    secure: true,
    sameSite: 'none',
    domain: domain || undefined,
    maxAge,
    path: '/',
  }
}

function getClearCsrfCookieOptions() {
  return { ...getCsrfCookieOptions(), maxAge: 0 }
}

export function setCsrfToken(res, token = generateCsrfToken()) {
  res.cookie(CSRF_COOKIE_NAME, token, getCsrfCookieOptions())
  return token
}

export function clearCsrfToken(res) {
  res.cookie(CSRF_COOKIE_NAME, '', getClearCsrfCookieOptions())
}

function tokensMatch(a, b) {
  if (!a || !b) return false
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function usesBearerOnlyAuth(req) {
  const auth = req.headers.authorization
  const hasBearer = typeof auth === 'string' && /^Bearer\s+/i.test(auth)
  const hasAuthCookie = Boolean(req.cookies?.access_token)
  return hasBearer && !hasAuthCookie
}

function isCsrfExemptPath(path) {
  const exemptPrefixes = ['/api/stream', '/api/panel', '/api/og', '/api/auth/csrf']
  return exemptPrefixes.some((prefix) => path.startsWith(prefix))
}

function validateMutationOrigin(req) {
  if (process.env.NODE_ENV !== 'production') return true

  const allowedOrigins = getAllowedOrigins()
  if (allowedOrigins.length === 0) return false

  const origin = req.headers.origin
  const refererOrigin = extractOriginFromUrl(req.headers.referer)

  if (origin && isOriginAllowed(origin, allowedOrigins)) return true
  if (refererOrigin && isOriginAllowed(refererOrigin, allowedOrigins)) return true

  return false
}

/** GET /api/auth/csrf — emite token CSRF (sin exigir CSRF previo) */
export function issueCsrfToken(req, res) {
  const token = setCsrfToken(res)
  return res.status(200).json({ success: true, csrfToken: token })
}

/** Middleware global para métodos que modifican estado */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next()
  }

  if (req.path === '/health' || !req.path.startsWith('/api')) {
    return next()
  }

  if (isCsrfExemptPath(req.path)) {
    return next()
  }

  // App móvil Flutter: Bearer sin cookie httpOnly
  if (usesBearerOnlyAuth(req)) {
    return next()
  }

  // Bloquea formularios cross-site simples (no pueden enviar headers custom)
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    return res.status(403).json({
      success: false,
      message: 'Solicitud bloqueada por protección CSRF',
      code: 'CSRF_INVALID',
    })
  }

  if (process.env.NODE_ENV === 'production' && !validateMutationOrigin(req)) {
    return res.status(403).json({
      success: false,
      message: 'Origen de solicitud no permitido',
      code: 'CSRF_INVALID',
    })
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME]
  const headerToken = req.headers[CSRF_HEADER_NAME]

  if (!tokensMatch(cookieToken, headerToken)) {
    return res.status(403).json({
      success: false,
      message: 'Token CSRF inválido o ausente',
      code: 'CSRF_INVALID',
    })
  }

  next()
}
