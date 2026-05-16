const isProd = process.env.NODE_ENV === 'production';

/**
 * Opciones de cookie `access_token` compatibles con local y producción.
 * En VPS: NODE_ENV=production, COOKIE_DOMAIN=.stream-in.com (opcional).
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
  const domain = process.env.COOKIE_DOMAIN || '.stream-in.com';
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    domain: domain || undefined,
    maxAge,
    path: '/',
  };
}
