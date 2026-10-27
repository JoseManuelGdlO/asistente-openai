const path = require('path');
const { verifyState, stateSecret } = require('./oauthState');
const {
  createCalendarInviteToken,
  calendarInviteFields,
  calendarInviteStatus,
  calendarInviteUrlFor,
  inviteResultUrl,
  readInviteResult
} = require('./invite');

const connectPage = path.join(__dirname, '../../../public/calendar-conectar.html');

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
    commandManager,
    firebaseService
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

  function inviteRedirect(req, payload) {
    return inviteResultUrl(req, payload);
  }

  async function botNameFor(clientId) {
    if (!firebaseService?.getClientById || !clientId) return '';
    try {
      const client = await firebaseService.getClientById(clientId);
      return client?.name || '';
    } catch (_error) {
      return '';
    }
  }

  async function loadPublicInvite(token) {
    if (!firebaseService?.getClientByCalendarInviteToken) {
      const error = new Error('Servicio no disponible');
      error.status = 503;
      throw error;
    }
    const client = await firebaseService.getClientByCalendarInviteToken(token);
    if (!client) {
      const error = new Error('El link no es válido.');
      error.status = 404;
      throw error;
    }
    const panel = await calendarService.getPanel(client.id);
    const botName = client.name || client.id;
    if (panel.connection.status === 'connected' && panel.connection.email) {
      return {
        status: 'connected',
        botName,
        email: panel.connection.email,
        clientId: client.id
      };
    }
    const linkStatus = calendarInviteStatus(client);
    if (linkStatus === 'expired') {
      const error = new Error('Este link ya venció. Pide uno nuevo a quien administra el bot.');
      error.status = 410;
      throw error;
    }
    if (linkStatus !== 'pending') {
      const error = new Error('El link no es válido.');
      error.status = 404;
      throw error;
    }
    return {
      status: 'pending',
      botName,
      expiresAt: client.CALENDAR_INVITE_EXPIRES_AT || null,
      oauthConfigured: panel.oauthConfigured,
      clientId: client.id
    };
  }

  app.get('/calendar/conectar/listo', (_req, res) => {
    res.sendFile(connectPage);
  });

  app.get('/calendar/conectar/:token', (_req, res) => {
    res.sendFile(connectPage);
  });

  app.get('/public/calendar/result', (req, res) => {
    const result = readInviteResult(typeof req.query.r === 'string' ? req.query.r : '', stateSecret(process.env));
    if (!result) {
      return res.status(400).json({ ok: false, error: 'Este resultado ya no está disponible.' });
    }
    res.json({ ok: true, ...result });
  });

  app.get('/public/calendar/invite/:token', async (req, res) => {
    try {
      if (!calendarService) return unavailable(res);
      const invite = await loadPublicInvite(req.params.token);
      res.json({
        ok: true,
        status: invite.status,
        botName: invite.botName,
        email: invite.email || '',
        expiresAt: invite.expiresAt || null,
        oauthConfigured: invite.status === 'pending' ? invite.oauthConfigured : true
      });
    } catch (error) {
      sendCalendarError(res, error, 'No se pudo abrir el link');
    }
  });

  app.post('/public/calendar/invite/:token/start', async (req, res) => {
    try {
      if (!calendarService) return unavailable(res);
      const invite = await loadPublicInvite(req.params.token);
      if (invite.status === 'connected') {
        return res.status(409).json({ ok: false, error: 'Este calendario ya está conectado.' });
      }
      const result = await calendarService.beginOAuth(invite.clientId, redirectUriFor(req), { via: 'invite' });
      res.json({ ok: true, url: result.url });
    } catch (error) {
      sendCalendarError(res, error, 'Error iniciando la conexión con Google');
    }
  });

  app.get('/calendar/oauth/callback', async (req, res) => {
    if (!calendarService) return unavailable(res);
    const queryError = typeof req.query.error === 'string' ? req.query.error : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const payload = verifyState(state, stateSecret(process.env));
    const clientId = payload?.clientId || '';
    const viaInvite = payload?.via === 'invite';
    if (!clientId) {
      return res.status(400).type('html').send('No se pudo completar la conexión con Google. Pide un link nuevo a quien administra el bot.');
    }
    if (queryError) {
      if (viaInvite) {
        return res.redirect(inviteRedirect(req, {
          kind: queryError === 'access_denied' ? 'denied' : 'error',
          email: '',
          botName: await botNameFor(clientId)
        }));
      }
      return res.redirect(panelUrl(req, clientId, queryError === 'access_denied' ? 'denied' : 'error'));
    }
    try {
      const result = await calendarService.completeOAuth(
        typeof req.query.code === 'string' ? req.query.code : '',
        state,
        redirectUriFor(req)
      );
      if (result.via === 'invite') {
        return res.redirect(inviteRedirect(req, {
          kind: 'connected',
          email: result.email || '',
          botName: await botNameFor(result.clientId)
        }));
      }
      return res.redirect(panelUrl(req, result.clientId, 'connected'));
    } catch (error) {
      console.error('Error completando OAuth de Google Calendar:', error.message);
      if (viaInvite) {
        return res.redirect(inviteRedirect(req, {
          kind: 'error',
          email: '',
          botName: await botNameFor(clientId)
        }));
      }
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

  app.post('/clients/:clientId/calendar/invite', requireAdminAuth, async (req, res) => {
    try {
      if (!calendarService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      if (!commandManager?.updateClient) {
        return res.status(503).json({ ok: false, error: 'No se pudo guardar el link.' });
      }
      const invite = createCalendarInviteToken();
      await commandManager.updateClient(clientId, calendarInviteFields(invite));
      res.json({
        ok: true,
        calendarInviteUrl: calendarInviteUrlFor(req, invite.token),
        calendarInviteExpiresAt: invite.expiresAt
      });
    } catch (error) {
      sendCalendarError(res, error, 'Error generando el link de Google Calendar');
    }
  });

  app.post('/clients/:clientId/calendar/notice/dismiss', requireAdminAuth, async (req, res) => {
    try {
      if (!calendarService) return unavailable(res);
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      const calendar = await calendarService.dismissNotice(clientId);
      res.json({ ok: true, calendar });
    } catch (error) {
      sendCalendarError(res, error, 'Error cerrando el aviso');
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
