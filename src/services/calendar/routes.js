const { verifyState, stateSecret } = require('./oauthState');

function appBase(req) {
  const configured = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || '';
  if (configured) return configured.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function redirectUriFor(req) {
  if (process.env.GOOGLE_CALENDAR_REDIRECT_URI) return process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  return `${appBase(req)}/calendar/oauth/callback`;
}

function panelUrl(req, clientId, code) {
  return `${appBase(req)}/#/clients/${encodeURIComponent(clientId)}/assistant?calendar=${encodeURIComponent(code)}`;
}

function sendCalendarError(res, error, fallback) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(fallback, error);
  res.status(status).json({
    ok: false,
    error: status >= 500 ? fallback : error.message,
    code: error.code || undefined
  });
}

function mountCalendarRoutes(app, deps) {
  const {
    calendarService,
    requireAdminAuth,
    requireEditLock,
    commandManager
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
    res.status(503).json({ ok: false, error: 'Google Calendar no está disponible en este servidor.' });
    return false;
  }

  app.get('/calendar/oauth/callback', async (req, res) => {
    if (!calendarService) return unavailable(res);
    const queryError = typeof req.query.error === 'string' ? req.query.error : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const payload = verifyState(state, stateSecret(process.env));
    const clientId = payload?.clientId || '';
    if (!clientId) {
      return res.status(400).type('html').send('No se pudo completar la conexión con Google. Vuelve al Assistant e inténtalo de nuevo.');
    }
    if (queryError) {
      return res.redirect(panelUrl(req, clientId, queryError === 'access_denied' ? 'denied' : 'error'));
    }
    try {
      const result = await calendarService.completeOAuth(
        typeof req.query.code === 'string' ? req.query.code : '',
        state,
        redirectUriFor(req)
      );
      return res.redirect(panelUrl(req, result.clientId, 'connected'));
    } catch (error) {
      console.error('Error completando OAuth de Google Calendar:', error.message);
      return res.redirect(panelUrl(req, clientId, 'error'));
    }
  });

  app.get('/clients/:clientId/calendar', requireAdminAuth, async (req, res) => {
    try {
      if (!calendarService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      const calendar = await calendarService.getPanel(clientId);
      res.json({ ok: true, calendar });
    } catch (error) {
      sendCalendarError(res, error, 'Error leyendo la agenda');
    }
  });

  app.put('/clients/:clientId/calendar/enabled', requireAdminAuth, async (req, res) => {
    try {
      if (!calendarService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const calendar = await calendarService.setEnabled(clientId, req.body?.enabled === true);
      res.json({ ok: true, calendar });
    } catch (error) {
      sendCalendarError(res, error, 'Error actualizando la agenda');
    }
  });

  app.put('/clients/:clientId/calendar', requireAdminAuth, async (req, res) => {
    try {
      if (!calendarService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const calendar = await calendarService.saveAgenda(clientId, req.body || {});
      res.json({ ok: true, calendar });
    } catch (error) {
      sendCalendarError(res, error, 'Error guardando la agenda');
    }
  });

  app.put('/clients/:clientId/calendar/selection', requireAdminAuth, async (req, res) => {
    try {
      if (!calendarService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const calendar = await calendarService.selectCalendar(clientId, req.body || {});
      res.json({ ok: true, calendar });
    } catch (error) {
      sendCalendarError(res, error, 'Error cambiando el calendario');
    }
  });

  app.post('/clients/:clientId/calendar/disconnect', requireAdminAuth, async (req, res) => {
    try {
      if (!calendarService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const calendar = await calendarService.disconnect(clientId);
      res.json({ ok: true, calendar });
    } catch (error) {
      sendCalendarError(res, error, 'Error desconectando Google Calendar');
    }
  });

  app.get('/clients/:clientId/calendar/calendars', requireAdminAuth, async (req, res) => {
    try {
      if (!calendarService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      const calendars = await calendarService.listCalendars(clientId);
      res.json({ ok: true, calendars });
    } catch (error) {
      sendCalendarError(res, error, 'Error listando calendarios');
    }
  });

  app.post('/clients/:clientId/calendar/oauth/start', requireAdminAuth, async (req, res) => {
    try {
      if (!calendarService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const result = await calendarService.beginOAuth(clientId, redirectUriFor(req));
      res.json({ ok: true, url: result.url });
    } catch (error) {
      sendCalendarError(res, error, 'Error iniciando la conexión con Google');
    }
  });

  app.put('/clients/:clientId/calendar/playground-write', requireAdminAuth, async (req, res) => {
    try {
      if (!calendarService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const calendar = await calendarService.setPlaygroundWrite(clientId, req.body?.enabled === true);
      res.json({ ok: true, calendar });
    } catch (error) {
      sendCalendarError(res, error, 'Error actualizando el modo de prueba');
    }
  });
}

module.exports = { mountCalendarRoutes, redirectUriFor };
