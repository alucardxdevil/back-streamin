/**
 * Autenticación para el panel de administración y automatizaciones de confianza.
 * Envía el mismo secreto en header `X-Teleprt-Panel-Key` o `Authorization: Bearer <clave>`.
 */
export function verifyPanelApiKey(req, res, next) {
  const expected = process.env.TELEPRT_PANEL_API_KEY;
  if (!expected || expected.length < 16) {
    return res.status(503).json({
      success: false,
      message: 'TELEPRT_PANEL_API_KEY no está configurada o es demasiado corta (mín. 16 caracteres).',
    });
  }

  const headerKey = req.headers['x-teleprt-panel-key'];
  const auth = req.headers.authorization;
  const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : null;
  const provided = (typeof headerKey === 'string' && headerKey) || bearer;

  if (!provided || provided !== expected) {
    return res.status(401).json({ success: false, message: 'Credenciales de panel inválidas' });
  }

  next();
}
