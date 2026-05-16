/**
 * Obtiene el JWT de sesión de la app: cookie httpOnly (navegador) o Authorization Bearer (móvil / herramientas).
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function extractAccessToken(req) {
  const fromCookie = req.cookies?.access_token;
  if (fromCookie && String(fromCookie).trim()) {
    return String(fromCookie).trim();
  }
  const auth = req.headers?.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    const t = auth.replace(/^Bearer\s+/i, '').trim();
    return t || null;
  }
  return null;
}
