/**
 * Orígenes permitidos para CORS y validación CSRF.
 * Producción: Cloudflare Pages (stream-in.com) → API en VPS (api.stream-in.com).
 */

const isProduction = process.env.NODE_ENV === 'production'

export function getAllowedOrigins() {
  const origins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  if (isProduction) {
    const defaultProdOrigins = [
      'https://stream-in.com',
      'https://www.stream-in.com',
    ]
    for (const o of defaultProdOrigins) {
      if (!origins.includes(o)) origins.push(o)
    }
  } else {
    origins.push(
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5000',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:5000'
    )
  }

  return [...new Set(origins)]
}

export function extractOriginFromUrl(url) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`.toLowerCase()
  } catch {
    return null
  }
}

export function isOriginAllowed(origin, allowedOrigins = getAllowedOrigins()) {
  if (!origin) return false
  const normalized = origin.toLowerCase().replace(/\/$/, '')
  return allowedOrigins.some((allowed) => normalized === allowed.replace(/\/$/, ''))
}
