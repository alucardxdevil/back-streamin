/**
 * Rutas del Sistema de Protección de Video — stream-in
 *
 * Todas las rutas de este módulo están protegidas por múltiples capas:
 *
 *  POST /api/stream/session
 *    → Emite un token de sesión anónimo (Capa 3)
 *    → Rate limited: 20 req/15min por IP (Capa 6)
 *
 *  GET /api/stream/video/:videoId
 *    → Proxy del master.m3u8 o video directo (Capa 4)
 *    → Validación de origen (Capa 2)
 *    → Validación de token de sesión (Capa 3)
 *    → Rate limited: 120 req/15min por IP (Capa 6)
 *
 *  GET /api/stream/hls
 *    → Proxy de fragmentos HLS (.ts) y playlists de calidad (Capa 4)
 *    → Validación de origen (Capa 2)
 *    → Validación de token de sesión (Capa 3)
 *    → Rate limited: 120 req/15min por IP (Capa 6)
 */

import express from 'express'
import { issueSessionToken, requireSessionToken } from '../middleware/sessionToken.js'
import { validateOrigin } from '../middleware/originValidator.js'
import { streamRateLimiter, sessionRateLimiter } from '../middleware/rateLimiter.js'
import { proxyVideoMaster, proxyHLSSegment } from '../controllers/streamProxy.js'

const router = express.Router()

// ── Emisión de token de sesión anónimo ────────────────────────────────────────
// No requiere Origin validation (es el primer endpoint que llama el cliente)
// Sí requiere rate limiting para prevenir abuso
router.post('/session', sessionRateLimiter, issueSessionToken)

// También permitir GET para facilitar la integración desde el frontend
router.get('/session', sessionRateLimiter, issueSessionToken)

// ── Proxy de video principal (master.m3u8 o video directo) ────────────────────
// Orden de middlewares: Origin → Session → RateLimit → Proxy
router.get(
  '/video/:videoId',
  validateOrigin,
  requireSessionToken,
  streamRateLimiter,
  proxyVideoMaster
)

// ── Proxy de fragmentos HLS (.ts y playlists de calidad) ──────────────────────
// Mismo stack de protección que el endpoint principal
router.get(
  '/hls',
  validateOrigin,
  requireSessionToken,
  streamRateLimiter,
  proxyHLSSegment
)

export default router
