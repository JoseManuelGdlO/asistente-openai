/**
 * Autenticación por token admin (Bearer o x-admin-token).
 * Requiere process.env.ADMIN_API_TOKEN.
 * Protege el panel y los endpoints de gestión (clientes, assistants, documentos, etc.).
 */
function requireAdminAuth(req, res, next) {
  const expected = process.env.ADMIN_API_TOKEN;

  if (!expected) {
    return res.status(503).json({
      ok: false,
      error: 'ADMIN_API_TOKEN no está configurado en el servidor'
    });
  }

  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const headerToken = (req.headers['x-admin-token'] || '').toString().trim();
  const provided = bearer || headerToken;

  if (!provided || provided !== expected) {
    return res.status(401).json({
      ok: false,
      error: 'No autorizado. Usa Authorization: Bearer <ADMIN_API_TOKEN> o header x-admin-token'
    });
  }

  return next();
}

module.exports = requireAdminAuth;
