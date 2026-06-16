const isProd = process.env.NODE_ENV === 'production';

/**
 * Opciones de cookie `access_token` compatibles con local y producción.
 * En VPS: NODE_ENV=production, COOKIE_DOMAIN=.teleprt.com (opcional).
 */
export function getAccessTokenCookieOptions() {
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 días
  if (!isProd) {
    return {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge,
      path: '/',
    };
  }
  const domain = process.env.COOKIE_DOMAIN || '.teleprt.com';
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    domain: domain || undefined,
    maxAge,
    path: '/',
  };
}

/**
 * Opciones de cookie para el token de sesión de streaming anónimo.
 *
 * Esta cookie reemplaza al query param `_st=<jwt>` en las URLs de
 * fragmentos HLS. Al usar cookie en lugar de query param, todos los
 * usuarios consumen la MISMA URL para el mismo segmento, lo que permite
 * a Cloudflare reutilizar el cache entre viewers sin necesidad de
 * configurar cache keys custom (que requieren plan Enterprise).
 *
 * Requisitos para compartir cross-origin entre teleprt.com y
 * api.teleprt.com:
 *   - SameSite=None (cookie cross-site)
 *   - Secure=true   (obligatorio cuando SameSite=None)
 *   - Domain=.teleprt.com (compartida entre apex y subdominios)
 *   - HttpOnly      (no leíble por JS — defensa contra XSS)
 *
 * @param {number} ttlSeconds - TTL del JWT (para alinear cookie maxAge)
 */
export function getStreamSessionCookieOptions(ttlSeconds) {
  const maxAge = Math.max(60, Number(ttlSeconds) || 1800) * 1000;
  if (!isProd) {
    return {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge,
      path: '/',
    };
  }
  const domain = process.env.COOKIE_DOMAIN || '.teleprt.com';
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    domain: domain || undefined,
    maxAge,
    path: '/',
  };
}

export const STREAM_SESSION_COOKIE_NAME = 'stream_session';
