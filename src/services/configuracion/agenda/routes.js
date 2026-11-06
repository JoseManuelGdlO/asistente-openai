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

const connectPage = path.join(__dirname, '../../../../public/calendar-conectar.html');

const OAUTH_CALLBACK_PATH = '/configuracion/agenda/oauth/callback';

function appBase(req, env = process.env) {
  const configured = env.APP_BASE_URL || env.PUBLIC_BASE_URL || '';
  if (configured) return configured.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function redirectUriFor(req, env = process.env) {
  if (env.GOOGLE_CALENDAR_REDIRECT_URI) return env.GOOGLE_CALENDAR_REDIRECT_URI;
  return `${appBase(req, env)}${OAUTH_CALLBACK_PATH}`;
}

function panelUrl(req, clientId, code) {
  return `${appBase(req)}/#/clients/${encodeURIComponent(clientId)}/assistant?calendar=${encodeURIComponent(code)}`;
}

function httpErr(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendAgendaError(res, error, fallback) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  const unexpected = status >= 500 && status !== 503;
  if (unexpected) console.error(fallback, error);
  res.status(status).json({
    ok: false,
    error: unexpected ? fallback : error.message,
    code: error.code || undefined
  });
}

function mountAgendaRoutes(app, deps) {
  const {
    agendaService,
    requireAdminAuth,
    requireEditLock,
    commandManager,
    firebaseService
  } = deps;
  const base = '/clients/:clientId/configuracion/agenda';

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
    res.status(503).json({ ok: false, error: 'La agenda no está disponible en este servidor.' });
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

  /** Envuelve un handler: servicio disponible, assistant válido, edit-lock opcional. */
  function route(method, suffix, { lock = false, fallback }, handler) {
    app[method](`${base}${suffix}`, requireAdminAuth, async (req, res) => {
      try {
        if (!agendaService) return unavailable(res);
        const { clientId } = req.params;
        if (!(await assertAssistant(res, clientId))) return;
        if (lock && !(await requireEditLock(req, res, clientId))) return;
        await handler(req, res, clientId);
      } catch (error) {
        sendAgendaError(res, error, fallback);
      }
    });
  }

  route('get', '', { fallback: 'Error leyendo la agenda' }, async (_req, res, clientId) => {
    res.json({ ok: true, agenda: await agendaService.getPanel(clientId) });
  });

  route('put', '/settings', { lock: true, fallback: 'Error guardando la agenda' }, async (req, res, clientId) => {
    res.json({ ok: true, agenda: await agendaService.saveAgenda(clientId, req.body || {}) });
  });

  route('put', '/enabled', { lock: true, fallback: 'Error actualizando la agenda' }, async (req, res, clientId) => {
    res.json({ ok: true, agenda: await agendaService.setEnabled(clientId, req.body?.enabled === true) });
  });

  route('put', '/playground-write', { lock: true, fallback: 'Error actualizando el modo de prueba' }, async (req, res, clientId) => {
    res.json({ ok: true, agenda: await agendaService.setPlaygroundWrite(clientId, req.body?.enabled === true) });
  });

  route('get', '/calendars', { fallback: 'Error listando calendarios' }, async (_req, res, clientId) => {
    res.json({ ok: true, calendars: await agendaService.listCalendars(clientId) });
  });

  route('post', '/select-calendar', { lock: true, fallback: 'Error cambiando el calendario' }, async (req, res, clientId) => {
    res.json({ ok: true, agenda: await agendaService.selectCalendar(clientId, req.body || {}) });
  });

  route('post', '/oauth/start', { lock: true, fallback: 'Error iniciando la conexión con Google' }, async (req, res, clientId) => {
    const result = await agendaService.beginOAuth(clientId, redirectUriFor(req));
    res.json({ ok: true, url: result.url });
  });

  route('post', '/disconnect', { lock: true, fallback: 'Error desconectando Google Calendar' }, async (_req, res, clientId) => {
    res.json({ ok: true, agenda: await agendaService.disconnect(clientId) });
  });

  route('post', '/notice/dismiss', { fallback: 'Error cerrando el aviso' }, async (_req, res, clientId) => {
    res.json({ ok: true, agenda: await agendaService.dismissNotice(clientId) });
  });

  route('post', '/invite', { lock: true, fallback: 'Error generando el link de Google Calendar' }, async (req, res, clientId) => {
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
  });

  async function loadPublicInvite(token) {
    if (!firebaseService?.getClientByCalendarInviteToken) {
      throw httpErr('Servicio no disponible', 503);
    }
    const client = await firebaseService.getClientByCalendarInviteToken(token);
    if (!client) throw httpErr('El link no es válido.', 404);
    const panel = await agendaService.getPanel(client.id);
    const botName = client.name || client.id;
    if (panel.connection.status === 'connected' && panel.connection.email) {
      return { status: 'connected', botName, email: panel.connection.email, clientId: client.id };
    }
    const linkStatus = calendarInviteStatus(client);
    if (linkStatus === 'expired') {
      throw httpErr('Este link ya venció. Pide uno nuevo a quien administra el bot.', 410);
    }
    if (linkStatus !== 'pending') throw httpErr('El link no es válido.', 404);
    return {
      status: 'pending',
      botName,
      expiresAt: client.CALENDAR_INVITE_EXPIRES_AT || null,
      oauthConfigured: panel.oauthConfigured,
      clientId: client.id
    };
  }

  // Páginas y API públicas del link de conexión (sin auth admin; el token del link es la credencial).
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
      if (!agendaService) return unavailable(res);
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
      sendAgendaError(res, error, 'No se pudo abrir el link');
    }
  });

  app.post('/public/calendar/invite/:token/start', async (req, res) => {
    try {
      if (!agendaService) return unavailable(res);
      const invite = await loadPublicInvite(req.params.token);
      if (invite.status === 'connected') {
        return res.status(409).json({ ok: false, error: 'Este calendario ya está conectado.' });
      }
      const result = await agendaService.beginOAuth(invite.clientId, redirectUriFor(req), { via: 'invite' });
      res.json({ ok: true, url: result.url });
    } catch (error) {
      sendAgendaError(res, error, 'Error iniciando la conexión con Google');
    }
  });

  // Callback público de Google (sin auth admin; se valida con el state firmado).
  app.get(OAUTH_CALLBACK_PATH, async (req, res) => {
    if (!agendaService) return unavailable(res);
    const queryError = typeof req.query.error === 'string' ? req.query.error : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const payload = verifyState(state, stateSecret(process.env));
    const clientId = payload?.clientId || '';
    const viaInvite = payload?.via === 'invite';
    if (!clientId) {
      return res.status(400).type('html').send('No se pudo completar la conexión con Google. Pide un link nuevo a quien administra el bot.');
    }
    const inviteDone = async (kind, email, id) => res.redirect(inviteResultUrl(req, {
      kind,
      email: email || '',
      botName: await botNameFor(id)
    }));
    if (queryError) {
      if (viaInvite) return inviteDone(queryError === 'access_denied' ? 'denied' : 'error', '', clientId);
      return res.redirect(panelUrl(req, clientId, queryError === 'access_denied' ? 'denied' : 'error'));
    }
    try {
      const result = await agendaService.completeOAuth(
        typeof req.query.code === 'string' ? req.query.code : '',
        state,
        redirectUriFor(req)
      );
      if (result.via === 'invite') return inviteDone('connected', result.email, result.clientId);
      return res.redirect(panelUrl(req, result.clientId, 'connected'));
    } catch (error) {
      console.error('Error completando OAuth de Google Calendar:', error.message);
      if (viaInvite) return inviteDone('error', '', clientId);
      return res.redirect(panelUrl(req, clientId, 'error'));
    }
  });
}

module.exports = { mountAgendaRoutes, redirectUriFor, OAUTH_CALLBACK_PATH };
