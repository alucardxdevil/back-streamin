/**
 * Proxy de Streaming de Video — Stream-In
 *
 * Capa de protección: PROXY BACKEND (Capa 4)
 * Amenaza cubierta: Exposición directa de URLs de Backblaze B2.
 *   El cliente NUNCA recibe la URL real de B2. Todo el contenido pasa
 *   a través de este proxy, que actúa como intermediario transparente.
 *
 * Flujo de una solicitud de video:
 *  1. Cliente solicita: GET /api/stream/video/:videoId
 *  2. Middleware valida Origin/Referer (Capa 2)
 *  3. Middleware valida token de sesión (Capa 3)
 *  4. Rate limiter verifica límites (Capa 6)
 *  5. Este controlador genera una URL firmada temporal (Capa 1)
 *  6. Hace fetch a B2 y hace pipe del stream al cliente
 *  7. La URL de B2 NUNCA aparece en la respuesta al cliente
 *
 * Para HLS (.m3u8 + .ts):
 *  - El master.m3u8 se reescribe para que las URLs de los playlists
 *    apunten al proxy en lugar de a B2 directamente.
 *  - Los playlists de calidad también se reescriben para que los
 *    fragmentos .ts apunten al proxy.
 */

import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Readable } from 'stream'
import { s3Client, B2_CONFIG } from '../config/b2.js'
import { logVideoAccess } from '../config/logger.js'
import Video from '../models/Video.js'

// TTL de las URLs firmadas internas (20 minutos — solo para uso del proxy)
const SIGNED_URL_TTL = parseInt(process.env.SIGNED_URL_TTL_SECONDS) || 1200

// ── Configuración de Cache TTLs ──────────────────────────────────────────────
// Estos valores controlan las cabeceras Cache-Control y CDN-Cache-Control
// que le indican a Cloudflare cuánto tiempo cachear cada tipo de recurso.
// Se pueden sobreescribir con variables de entorno.

// Fragmentos .ts — Inmutables, cacheo agresivo
const CACHE_TS_BROWSER  = parseInt(process.env.CACHE_TS_BROWSER)  || 86400   // 24h navegador
const CACHE_TS_CDN      = parseInt(process.env.CACHE_TS_CDN)      || 604800  // 7 días Cloudflare edge

// Playlists de calidad .m3u8 — Semi-estáticos, cacheo corto
const CACHE_M3U8_BROWSER = parseInt(process.env.CACHE_M3U8_BROWSER) || 5     // 5s navegador
const CACHE_M3U8_CDN     = parseInt(process.env.CACHE_M3U8_CDN)     || 60    // 60s Cloudflare edge

// Video directo (legacy/fallback) — Estático, cacheo moderado
const CACHE_VIDEO_BROWSER = parseInt(process.env.CACHE_VIDEO_BROWSER) || 3600  // 1h navegador
const CACHE_VIDEO_CDN     = parseInt(process.env.CACHE_VIDEO_CDN)     || 86400 // 24h Cloudflare edge

/**
 * Genera una URL firmada para un objeto en B2.
 *
 * @param {string} key - Key del objeto en B2
 * @returns {Promise<string>} URL firmada
 */
const generateSignedUrl = async (key) => {
  const command = new GetObjectCommand({
    Bucket: B2_CONFIG.bucket,
    Key: key,
  })

  return getSignedUrl(s3Client, command, {
    expiresIn: SIGNED_URL_TTL,
  })
}

/**
 * Extrae el key de B2 a partir de una URL pública de B2.
 *
 * Ejemplo:
 *  "https://f005.backblazeb2.com/file/streamin-videos/hls/abc/master.m3u8"
 *  → "hls/abc/master.m3u8"
 *
 * @param {string} url
 * @returns {string|null}
 */
const extractB2Key = (url) => {
  if (!url) return null
  try {
    const parsed = new URL(url)
    // El path tiene formato: /file/{bucket}/{key}
    const parts = parsed.pathname.split('/')
    // Encontrar el índice después de "file" y el nombre del bucket
    const fileIdx = parts.indexOf('file')
    if (fileIdx === -1) return null
    // El key empieza después de /file/{bucket}/
    return parts.slice(fileIdx + 2).join('/')
  } catch {
    return null
  }
}

/**
 * Reescribe un archivo .m3u8 reemplazando todas las URLs con URLs del proxy.
 * Maneja tanto URLs absolutas como rutas relativas.
 *
 * @param {string} content - Contenido del .m3u8
 * @param {string} baseProxyUrl - URL base del proxy
 * @param {string} videoId - ID del video
 * @param {string} hlsBaseKey - Prefijo base en B2 (ej: "hls/videoId/")
 * @returns {string}
 */
const rewriteM3U8WithBase = (content, baseProxyUrl, videoId, hlsBaseKey) => {
  const lines = content.split('\n')
  const baseKey = hlsBaseKey ? hlsBaseKey.replace(/\/$/, '') : null

  const rewritten = lines.map(line => {
    const trimmed = line.trim()

    if (trimmed.startsWith('#') || trimmed === '') return line

    let key = null

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      // URL absoluta de B2
      key = extractB2Key(trimmed)
    } else if (baseKey && !trimmed.startsWith('/')) {
      // Ruta relativa: construir key completo
      key = `${baseKey}/${trimmed}`
    } else if (trimmed.startsWith('/')) {
      // Ruta absoluta relativa al bucket
      key = trimmed.replace(/^\//, '')
    }

    if (key) {
      const vidParam = videoId ? `&vid=${videoId}` : ''
      return `${baseProxyUrl}?key=${encodeURIComponent(key)}${vidParam}`
    }

    return line
  })

  return rewritten.join('\n')
}

/**
 * Obtiene el directorio base de un key de archivo.
 * Ejemplo: "hls/abc123/720p/index.m3u8" → "hls/abc123/720p"
 *
 * @param {string} key
 * @returns {string}
 */
const getBaseKey = (key) => {
  const parts = key.split('/')
  parts.pop()
  return parts.join('/')
}

/**
 * Valida que un key de HLS sea seguro (previene path traversal y acceso
 * a archivos fuera del directorio HLS).
 *
 * @param {string} key
 * @returns {boolean}
 */
const isValidHLSKey = (key) => {
  if (!key) return false
  // No permitir path traversal
  if (key.includes('..') || key.includes('//')) return false
  // Solo permitir keys que empiecen con hls/ o thumbnails/
  if (!key.startsWith('hls/') && !key.startsWith('thumbnails/')) return false
  // Solo permitir extensiones válidas
  const validExtensions = ['.m3u8', '.ts', '.jpg', '.jpeg', '.png', '.webp']
  const hasValidExt = validExtensions.some(ext => key.toLowerCase().endsWith(ext))
  if (!hasValidExt) return false
  // No permitir caracteres peligrosos
  if (/[<>"|?*\x00-\x1f]/.test(key)) return false
  return true
}

/**
 * Hace fetch a una URL y retorna la respuesta.
 * Usa fetch nativo (Node 18+) o node-fetch como fallback.
 *
 * @param {string} url
 * @param {Object} options
 * @returns {Promise<Response>}
 */
const fetchUrl = async (url, options = {}) => {
  // Node 18+ tiene fetch nativo
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(url, options)
  }
  // Fallback a node-fetch
  const { default: nodeFetch } = await import('node-fetch')
  return nodeFetch(url, options)
}

/**
 * GET /api/stream/video/:videoId
 *
 * Proxy principal para el master.m3u8 de un video HLS.
 * Valida el video, genera URL firmada, y hace proxy del contenido.
 */
export const proxyVideoMaster = async (req, res, next) => {
  const { videoId } = req.params
  const ip = req.ip || req.connection?.remoteAddress || 'unknown'
  const origin = req.headers['origin']
  const referer = req.headers['referer']
  const userAgent = req.headers['user-agent']
  const sessionId = req.sessionPayload?.sid?.substring(0, 8) || null

  try {
    // Buscar el video en la base de datos
    const video = await Video.findById(videoId).select('hlsMasterUrl hlsBaseKey status videoUrl videoKey')

    if (!video) {
      logVideoAccess({
        ip, resource: videoId, authorized: false,
        reason: 'Video no encontrado', origin, referer,
        tokenValid: req.sessionValid || false, sessionId, userAgent, statusCode: 404,
      })
      return res.status(404).json({ success: false, message: 'Video no encontrado' })
    }

    // Verificar que el video tenga algún archivo reproducible.
    // Solo rechazar si el video está en estado 'processing' (transcodificación activa)
    // y NO tiene un archivo de video directo como fallback.
    // Videos con videoUrl/videoKey siempre pueden reproducirse (son archivos directos en B2).
    // Videos con hlsMasterUrl y status 'ready' se reproducen via HLS.
    const hasDirectVideo = video.videoUrl || video.videoKey
    const hasHLS = video.hlsMasterUrl && video.status === 'ready'
    
    if (!hasDirectVideo && !hasHLS) {
      // El video está en proceso de transcodificación y no tiene archivo directo
      logVideoAccess({
        ip, resource: videoId, authorized: false,
        reason: `Video no disponible (status: ${video.status})`, origin, referer,
        tokenValid: req.sessionValid || false, sessionId, userAgent, statusCode: 409,
      })
      return res.status(409).json({
        success: false,
        message: 'El video aún no está disponible para reproducción',
        status: video.status,
      })
    }

    // Determinar el key del archivo a servir
    // Priorizar HLS si está disponible y listo, sino usar video directo
    let fileKey = null

    if (hasHLS) {
      fileKey = extractB2Key(video.hlsMasterUrl)
    } else if (video.videoKey) {
      // Video directo en B2 (legacy o fallback mientras se transcodifica)
      fileKey = video.videoKey
    }

    if (!fileKey) {
      logVideoAccess({
        ip, resource: videoId, authorized: false,
        reason: 'Key de archivo no encontrado', origin, referer,
        tokenValid: req.sessionValid || false, sessionId, userAgent, statusCode: 500,
      })
      return res.status(500).json({ success: false, message: 'Error interno: archivo no localizable' })
    }

    // Generar URL firmada (solo para uso interno del proxy)
    const signedUrl = await generateSignedUrl(fileKey)

    // Hacer fetch a B2 con la URL firmada
    const fetchOptions = {}
    if (req.headers['range']) {
      fetchOptions.headers = { Range: req.headers['range'] }
    }

    const b2Response = await fetchUrl(signedUrl, fetchOptions)

    if (!b2Response.ok) {
      logVideoAccess({
        ip, resource: videoId, authorized: false,
        reason: `Error de B2: ${b2Response.status}`, origin, referer,
        tokenValid: req.sessionValid || false, sessionId, userAgent, statusCode: b2Response.status,
      })
      return res.status(b2Response.status).json({ success: false, message: 'Error al obtener el archivo' })
    }

    const contentType = b2Response.headers.get('content-type') || 'application/octet-stream'
    const isM3U8 = fileKey.endsWith('.m3u8') || contentType.includes('mpegurl')

    // Registrar acceso exitoso
    logVideoAccess({
      ip, resource: videoId, authorized: true,
      reason: null, origin, referer,
      tokenValid: req.sessionValid || false, sessionId, userAgent, statusCode: 200,
    })

    if (isM3U8) {
      // Para archivos .m3u8: leer, reescribir URLs, y enviar
      const m3u8Content = await b2Response.text()
      const baseProxyUrl = `${req.protocol}://${req.get('host')}/api/stream/hls`
      const rewritten = rewriteM3U8WithBase(m3u8Content, baseProxyUrl, videoId, video.hlsBaseKey)

      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
        // Cabeceras de seguridad adicionales
        'X-Frame-Options': 'SAMEORIGIN',
      })
      return res.send(rewritten)
    }

    // Para archivos de video directo (legacy): hacer pipe del stream
    const statusCode = b2Response.status === 206 ? 206 : 200
    res.status(statusCode)

    const responseHeaders = {
      'Content-Type': contentType,
      // Browser & Edge Cache: video directo cacheable por Cloudflare
      'Cache-Control': `public, max-age=${CACHE_VIDEO_BROWSER}, s-maxage=${CACHE_VIDEO_CDN}`,
      'CDN-Cache-Control': `max-age=${CACHE_VIDEO_CDN}`,
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Accept-Encoding, Range',
    }

    const contentLength = b2Response.headers.get('content-length')
    if (contentLength) responseHeaders['Content-Length'] = contentLength

    const contentRange = b2Response.headers.get('content-range')
    if (contentRange) responseHeaders['Content-Range'] = contentRange

    const acceptRanges = b2Response.headers.get('accept-ranges')
    if (acceptRanges) responseHeaders['Accept-Ranges'] = acceptRanges

    res.set(responseHeaders)

    // Pipe del body de B2 al cliente usando Node.js streams
    const nodeReadable = Readable.fromWeb
      ? Readable.fromWeb(b2Response.body)
      : b2Response.body

    nodeReadable.pipe(res)

  } catch (err) {
    console.error('[StreamProxy] Error en proxyVideoMaster:', err.message)
    logVideoAccess({
      ip, resource: videoId, authorized: false,
      reason: `Error interno: ${err.message}`, origin, referer,
      tokenValid: req.sessionValid || false, sessionId, userAgent, statusCode: 500,
    })
    return res.status(500).json({ success: false, message: 'Error interno del servidor' })
  }
}

/**
 * GET /api/stream/hls?key={b2Key}&vid={videoId}
 *
 * Proxy para fragmentos HLS (.ts) y playlists de calidad (.m3u8).
 * El key de B2 viene codificado en el query parameter.
 */
export const proxyHLSSegment = async (req, res, next) => {
  const { key: encodedKey, vid: videoId } = req.query
  const ip = req.ip || req.connection?.remoteAddress || 'unknown'
  const origin = req.headers['origin']
  const referer = req.headers['referer']
  const userAgent = req.headers['user-agent']
  const sessionId = req.sessionPayload?.sid?.substring(0, 8) || null

  if (!encodedKey) {
    return res.status(400).json({ success: false, message: 'Parámetro key requerido' })
  }

  let fileKey
  try {
    fileKey = decodeURIComponent(encodedKey)
  } catch {
    return res.status(400).json({ success: false, message: 'Parámetro key inválido' })
  }

  // Validar que el key sea un path de HLS válido (prevenir path traversal)
  if (!isValidHLSKey(fileKey)) {
    logVideoAccess({
      ip, resource: fileKey, authorized: false,
      reason: 'Key de HLS inválido o sospechoso', origin, referer,
      tokenValid: req.sessionValid || false, sessionId, userAgent, statusCode: 400,
    })
    return res.status(400).json({ success: false, message: 'Recurso inválido' })
  }

  try {
    // Generar URL firmada para el fragmento
    const signedUrl = await generateSignedUrl(fileKey)

    // Fetch del fragmento desde B2
    const fetchOptions = {}
    if (req.headers['range']) {
      fetchOptions.headers = { Range: req.headers['range'] }
    }

    const b2Response = await fetchUrl(signedUrl, fetchOptions)

    if (!b2Response.ok) {
      return res.status(b2Response.status).json({ success: false, message: 'Fragmento no disponible' })
    }

    const contentType = b2Response.headers.get('content-type') || 'video/mp2t'
    const isM3U8 = fileKey.endsWith('.m3u8') || contentType.includes('mpegurl')

    if (isM3U8) {
      // Reescribir el playlist de calidad
      const m3u8Content = await b2Response.text()
      const baseProxyUrl = `${req.protocol}://${req.get('host')}/api/stream/hls`
      const rewritten = rewriteM3U8WithBase(m3u8Content, baseProxyUrl, videoId, getBaseKey(fileKey))

      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        // Browser & Edge Cache: playlists de calidad — cacheo corto
        // Se refrescan rápido si se re-transcodifica, pero evitan hits repetidos a B2
        'Cache-Control': `public, max-age=${CACHE_M3U8_BROWSER}, s-maxage=${CACHE_M3U8_CDN}`,
        'CDN-Cache-Control': `max-age=${CACHE_M3U8_CDN}`,
        'X-Content-Type-Options': 'nosniff',
        'Vary': 'Accept-Encoding',
      })
      return res.send(rewritten)
    }

    // Fragmento .ts: hacer pipe directo
    const statusCode = b2Response.status === 206 ? 206 : 200
    res.status(statusCode)

    const responseHeaders = {
      'Content-Type': contentType,
      // Browser & Edge Cache: fragmentos .ts — INMUTABLES, cacheo agresivo máximo
      // Una vez creados por el transcodificador, NUNCA cambian.
      // Esto es el ~95% del tráfico de video y el mayor ahorro en B2.
      'Cache-Control': `public, max-age=${CACHE_TS_BROWSER}, immutable`,
      'CDN-Cache-Control': `max-age=${CACHE_TS_CDN}`,
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Accept-Encoding',
    }

    const contentLength = b2Response.headers.get('content-length')
    if (contentLength) responseHeaders['Content-Length'] = contentLength

    const contentRange = b2Response.headers.get('content-range')
    if (contentRange) responseHeaders['Content-Range'] = contentRange

    const acceptRanges = b2Response.headers.get('accept-ranges')
    if (acceptRanges) responseHeaders['Accept-Ranges'] = acceptRanges

    res.set(responseHeaders)

    // Pipe del body de B2 al cliente
    const nodeReadable = Readable.fromWeb
      ? Readable.fromWeb(b2Response.body)
      : b2Response.body

    nodeReadable.pipe(res)

  } catch (err) {
    console.error('[StreamProxy] Error en proxyHLSSegment:', err.message)
    return res.status(500).json({ success: false, message: 'Error al obtener fragmento' })
  }
}

export default { proxyVideoMaster, proxyHLSSegment }
