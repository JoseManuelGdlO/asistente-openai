function mountBlacklistRoutes(app, deps) {
  const { firebaseService, requireAdminAuth, requireEditLock, commandManager } = deps;

  async function assertAssistant(res, clientId) {
    if (!commandManager || typeof commandManager.getAssistantConfig !== 'function') return true;
    const assistant = await commandManager.getAssistantConfig(clientId);
    if (!assistant || assistant.status === 'deleted') {
      res.status(404).json({ ok: false, error: 'Assistant no encontrado' });
      return false;
    }
    return true;
  }

  function normalizePhoneInput(phone) {
    if (phone == null) return '';
    return String(phone).replace('@c.us', '').trim();
  }

  app.get('/clients/:clientId/blacklist', requireAdminAuth, async (req, res) => {
    try {
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      const phones = await firebaseService.getBlacklist(clientId);
      res.json({ ok: true, phones });
    } catch (error) {
      console.error('Error leyendo blacklist:', error);
      res.status(500).json({ ok: false, error: 'Error leyendo la lista de bloqueados' });
    }
  });

  app.post('/clients/:clientId/blacklist', requireAdminAuth, async (req, res) => {
    try {
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const phone = normalizePhoneInput(req.body?.phone);
      if (!phone) {
        return res.status(400).json({ ok: false, error: 'Indica un número de teléfono' });
      }
      const result = await firebaseService.addToBlacklist(clientId, req.body.phone);
      const phones = await firebaseService.getBlacklist(clientId);
      res.json({
        ok: true,
        added: Boolean(result?.added),
        message: result?.message,
        phones
      });
    } catch (error) {
      console.error('Error agregando a blacklist:', error);
      res.status(500).json({ ok: false, error: 'Error agregando el número' });
    }
  });

  app.delete('/clients/:clientId/blacklist/:phone', requireAdminAuth, async (req, res) => {
    try {
      const { clientId, phone } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const normalized = normalizePhoneInput(decodeURIComponent(phone));
      if (!normalized) {
        return res.status(400).json({ ok: false, error: 'Indica un número de teléfono' });
      }
      const removed = await firebaseService.removeFromBlacklist(clientId, normalized);
      const phones = await firebaseService.getBlacklist(clientId);
      res.json({ ok: true, removed: Boolean(removed), phones });
    } catch (error) {
      console.error('Error quitando de blacklist:', error);
      res.status(500).json({ ok: false, error: 'Error quitando el número' });
    }
  });
}

module.exports = { mountBlacklistRoutes };
