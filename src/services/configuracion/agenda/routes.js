function sendAgendaError(res, error, fallback) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(fallback, error);
  res.status(status).json({
    ok: false,
    error: status >= 500 ? fallback : error.message,
    code: error.code || undefined
  });
}

function redirectUriFor(req) {
  if (process.env.GOOGLE_CALENDAR_REDIRECT_URI) return process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  const configured = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || '';
  if (configured) return `${configured.replace(/\/$/, '')}/calendar/oauth/callback`;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}/calendar/oauth/callback`;
}

function mountAgendaRoutes(app, deps) {
  const {
    agendaService,
    requireAdminAuth,
    requireEditLock,
    commandManager,
    migrateClient
  } = deps;

  async function assertAssistant(res, clientId) {
    if (!commandManager || typeof commandManager.getAssistantConfig !== 'function') return true;
    const assistant = await commandManager.getAssistantConfig(clientId);
    if (!assistant || assistant.status === 'deleted') {
      res.status(404).json({ ok: false, error: 'Assistant no encontrado' });
      return false;
    }
    return true;
  }

  function unavailable(res) {
    res.status(503).json({ ok: false, error: 'Agenda v2 no está disponible en este servidor.' });
    return false;
  }

  app.get('/clients/:clientId/configuracion/agenda', requireAdminAuth, async (req, res) => {
    try {
      if (!agendaService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      const agenda = await agendaService.getPanel(clientId);
      const assistant = await commandManager?.getAssistantConfig?.(clientId);
      res.json({
        ok: true,
        agenda,
        agendaEngine: assistant?.agendaEngine === 'v2' ? 'v2' : 'v1'
      });
    } catch (error) {
      sendAgendaError(res, error, 'Error leyendo la agenda');
    }
  });

  app.put('/clients/:clientId/configuracion/agenda/settings', requireAdminAuth, async (req, res) => {
    try {
      if (!agendaService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const agenda = await agendaService.saveAgenda(clientId, req.body || {});
      res.json({ ok: true, agenda });
    } catch (error) {
      sendAgendaError(res, error, 'Error guardando la agenda');
    }
  });

  app.put('/clients/:clientId/configuracion/agenda/enabled', requireAdminAuth, async (req, res) => {
    try {
      if (!agendaService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const agenda = await agendaService.setEnabled(clientId, req.body?.enabled === true);
      res.json({ ok: true, agenda });
    } catch (error) {
      sendAgendaError(res, error, 'Error actualizando la agenda');
    }
  });

  app.put('/clients/:clientId/configuracion/agenda/playground-write', requireAdminAuth, async (req, res) => {
    try {
      if (!agendaService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const agenda = await agendaService.setPlaygroundWrite(clientId, req.body?.enabled === true);
      res.json({ ok: true, agenda });
    } catch (error) {
      sendAgendaError(res, error, 'Error actualizando el modo de prueba');
    }
  });

  app.post('/clients/:clientId/configuracion/agenda/select-calendar', requireAdminAuth, async (req, res) => {
    try {
      if (!agendaService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const agenda = await agendaService.selectCalendar(clientId, req.body || {});
      res.json({ ok: true, agenda });
    } catch (error) {
      sendAgendaError(res, error, 'Error seleccionando el calendario');
    }
  });

  app.get('/clients/:clientId/configuracion/agenda/calendars', requireAdminAuth, async (req, res) => {
    try {
      if (!agendaService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      const calendars = await agendaService.listCalendars(clientId);
      res.json({ ok: true, calendars });
    } catch (error) {
      sendAgendaError(res, error, 'Error listando calendarios');
    }
  });

  app.post('/clients/:clientId/configuracion/agenda/oauth/start', requireAdminAuth, async (req, res) => {
    try {
      if (!agendaService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const result = await agendaService.beginOAuth(clientId, redirectUriFor(req));
      res.json({ ok: true, url: result.url });
    } catch (error) {
      sendAgendaError(res, error, 'Error iniciando OAuth');
    }
  });

  app.post('/clients/:clientId/configuracion/agenda/disconnect', requireAdminAuth, async (req, res) => {
    try {
      if (!agendaService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const agenda = await agendaService.disconnect(clientId);
      res.json({ ok: true, agenda });
    } catch (error) {
      sendAgendaError(res, error, 'Error desconectando Google');
    }
  });

  app.post('/clients/:clientId/configuracion/agenda/notice/dismiss', requireAdminAuth, async (req, res) => {
    try {
      if (!agendaService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const agenda = await agendaService.dismissNotice(clientId);
      res.json({ ok: true, agenda });
    } catch (error) {
      sendAgendaError(res, error, 'Error descartando el aviso');
    }
  });

  app.post('/clients/:clientId/configuracion/agenda/migrate', requireAdminAuth, async (req, res) => {
    try {
      if (!agendaService || typeof migrateClient !== 'function') return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const result = await migrateClient(clientId);
      res.json({ ok: true, ...result });
    } catch (error) {
      sendAgendaError(res, error, 'Error migrando la agenda');
    }
  });
}

module.exports = { mountAgendaRoutes };
