/**
 * Autenticación para el panel de administración y automatizaciones de confianza.
 * Envía el mismo secreto en header `X-Teleprt-Panel-Key` o `Authorization: Bearer <clave>`.
 */
export function verifyPanelApiKey(req, res, next) {
  const expected = String(
    process.env.TELEPRT_PANEL_API_KEY || process.env.STREAM_IN_PANEL_API_KEY || '',
  ).trim();
  if (!expected || expected.length < 16) {
    return res.status(503).json({
      success: false,
      message:
        'TELEPRT_PANEL_API_KEY (o STREAM_IN_PANEL_API_KEY legacy) no está configurada o es demasiado corta (mín. 16 caracteres).',
    });
  }

  const headerKey =
    req.headers['x-teleprt-panel-key'] || req.headers['x-stream-in-panel-key'];
  const auth = req.headers.authorization;
  const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : null;
  const provided = String((typeof headerKey === 'string' && headerKey) || bearer || '').trim();

  if (!provided || provided !== expected) {
    return res.status(401).json({ success: false, message: 'Credenciales de panel inválidas' });
  }

  next();
}
