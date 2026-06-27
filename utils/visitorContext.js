/**
 * Extrae país e identidad de visitante desde la petición HTTP.
 */

const BOT_UA =
  /bot|crawl|spider|slurp|facebookexternalhit|twitterbot|linkedinbot|whatsapp|preview|headless/i;

export function isLikelyBot(userAgent = '') {
  return BOT_UA.test(String(userAgent));
}

export function resolveVisitorCountry(req) {
  const cf = req.headers['cf-ipcountry'];
  if (cf && cf !== 'XX' && cf !== 'T1') {
    return String(cf).toUpperCase().slice(0, 2);
  }
  return 'XX';
}

export function resolveVisitorId(req, bodyVisitorId) {
  const fromBody = bodyVisitorId ? String(bodyVisitorId).trim().slice(0, 64) : '';
  if (fromBody) return fromBody;

  const cookie = req.cookies?.stream_session;
  if (cookie) return `s:${String(cookie).slice(-32)}`;

  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  return `ip:${ip}`;
}
