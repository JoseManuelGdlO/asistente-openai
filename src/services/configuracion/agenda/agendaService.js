const crypto = require('crypto');
const { encryptCredentialsPayload, decryptCredentialsPayload } = require('../../../utils/credentialsCrypto');
const { DEFAULT_TIMEZONE, LIVE_ORIGINS, clone } = require('./constants');
const { signState, verifyState, stateSecret } = require('../../calendar/oauthState');
const { describePhase } = require('./readiness');
const { normalizeAgenda } = require('./normalize');
const { isAgendaTool, toolDefinitions, mergeTools, buildInstructions } = require('./tools');
const {
  localDate,
  addDays,
  interpretSlotStart,
  formatSlotLabel,
  formatLocal,
  fitsDayWindows
} = require('./time');
const { buildAvailableSlots } = require('./availability');
const {
  bookAppointment,
  rescheduleAppointmentRecord,
  cancelAppointmentRecord
} = require('./booking');
const { processClientSyncQueue } = require('./syncWorker');

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanPhone(userId) {
  return String(userId || '').replace(/@.+$/, '').trim();
}

class AgendaService {
  constructor({
    settingsStore,
    appointmentsStore,
    google,
    now = () => new Date(),
    env = process.env,
    tokenOverride = ''
  }) {
    this.settingsStore = settingsStore;
    this.appointmentsStore = appointmentsStore;
    this.google = google;
    this.now = now;
    this.env = env;
    this.tokenOverride = tokenOverride;
  }

  toolDefinitions() {
    return toolDefinitions();
  }

  mergeTools(storedTools, agendaTools) {
    return mergeTools(storedTools, agendaTools);
  }

  isAgendaTool(name) {
    return isAgendaTool(name);
  }

  // Compatibilidad con OpenAIManager (antes calendarBooking.isCalendarTool)
  isCalendarTool(name) {
    return isAgendaTool(name);
  }

  buildInstructions(runtime) {
    return buildInstructions(runtime);
  }

  toPanel(doc) {
    const phase = describePhase(doc);
    return {
      enabled: doc.enabled === true,
      phase: phase.phase,
      phaseLabel: phase.label,
      ready: phase.ready,
      missing: phase.missing,
      detail: phase.detail || '',
      oauthConfigured: Boolean(this.google?.configured?.()),
      connection: {
        status: doc.connection?.status || 'disconnected',
        email: doc.connection?.email || '',
        calendarId: doc.connection?.calendarId || '',
        calendarSummary: doc.connection?.calendarSummary || '',
        timezone: doc.connection?.timezone || DEFAULT_TIMEZONE,
        connectedAt: doc.connection?.connectedAt || null,
        lastError: doc.connection?.lastError || ''
      },
      hours: doc.hours,
      services: doc.services || [],
      exceptions: doc.exceptions || [],
      rules: doc.rules,
      playgroundWriteEnabled: doc.playgroundWriteEnabled === true,
      adminNotice: doc.adminNotice?.pending
        ? {
          email: doc.adminNotice.email || '',
          connectedAt: doc.adminNotice.connectedAt || null
        }
        : null
    };
  }

  async getPanel(clientId) {
    return this.toPanel(await this.settingsStore.getRaw(clientId));
  }

  async publicSummary(clientId) {
    const panel = await this.getPanel(clientId);
    const notice = panel.adminNotice;
    return {
      connected: panel.connection.status === 'connected' && Boolean(panel.connection.email),
      email: panel.connection.email || '',
      noticePending: Boolean(notice),
      noticeEmail: notice?.email || '',
      noticeAt: notice?.connectedAt || null,
      engine: 'v2'
    };
  }

  async loadRuntime(clientId) {
    const doc = await this.settingsStore.getRaw(clientId);
    const phase = describePhase(doc);
    return {
      clientId,
      ready: phase.ready,
      phase: phase.phase,
      phaseLabel: phase.label,
      hours: doc.hours,
      exceptions: doc.exceptions || [],
      services: doc.services || [],
      rules: doc.rules,
      timezone: doc.connection?.timezone || DEFAULT_TIMEZONE,
      today: localDate(this.now(), doc.connection?.timezone || DEFAULT_TIMEZONE),
      calendarId: doc.connection?.calendarId || '',
      playgroundWriteEnabled: doc.playgroundWriteEnabled === true,
      enabled: doc.enabled === true
    };
  }

  async setEnabled(clientId, enabled) {
    const saved = await this.settingsStore.transaction(clientId, (doc) => ({
      ...doc,
      enabled: Boolean(enabled)
    }));
    return this.toPanel(saved);
  }

  async saveAgenda(clientId, input) {
    const parsed = normalizeAgenda(input);
    if (!parsed.ok) throw httpError(parsed.error, 400);
    const saved = await this.settingsStore.transaction(clientId, (doc) => ({
      ...doc,
      hours: parsed.value.hours,
      services: parsed.value.services,
      exceptions: parsed.value.exceptions,
      rules: parsed.value.rules,
      connection: {
        ...doc.connection,
        timezone: parsed.value.timezone,
        calendarId: parsed.value.calendarId || doc.connection.calendarId,
        calendarSummary: parsed.value.calendarId
          ? (parsed.value.calendarSummary || doc.connection.calendarSummary)
          : doc.connection.calendarSummary
      }
    }));
    return this.toPanel(saved);
  }

  async selectCalendar(clientId, input) {
    const calendarId = typeof input?.calendarId === 'string' ? input.calendarId.trim() : '';
    const calendarSummary = typeof input?.calendarSummary === 'string' ? input.calendarSummary.trim() : '';
    if (!calendarId || calendarId.length > 512) throw httpError('Selecciona un calendario.', 400);
    const saved = await this.settingsStore.transaction(clientId, (doc) => {
      if (doc.connection?.status !== 'connected') {
        throw httpError('Conecta Google Calendar antes de elegir un calendario.', 409);
      }
      return {
        ...doc,
        connection: {
          ...doc.connection,
          calendarId,
          calendarSummary: calendarSummary || calendarId
        }
      };
    });
    return this.toPanel(saved);
  }

  async setPlaygroundWrite(clientId, enabled) {
    const saved = await this.settingsStore.transaction(clientId, (doc) => ({
      ...doc,
      playgroundWriteEnabled: Boolean(enabled)
    }));
    return this.toPanel(saved);
  }

  async disconnect(clientId) {
    const current = await this.settingsStore.getRaw(clientId);
    if (current.encryptedTokens && typeof this.google?.revoke === 'function') {
      try {
        const tokens = decryptCredentialsPayload(current.encryptedTokens);
        if (tokens?.refreshToken) await this.google.revoke(tokens.refreshToken);
      } catch (_error) {
        // keep local disconnect
      }
    }
    const saved = await this.settingsStore.transaction(clientId, (doc) => ({
      ...doc,
      encryptedTokens: null,
      oauthNonce: null,
      oauthNonceExpiresAt: null,
      connection: {
        ...doc.connection,
        status: 'disconnected',
        email: '',
        calendarId: '',
        calendarSummary: '',
        connectedAt: null,
        lastError: ''
      },
      oauthVia: null,
      adminNotice: null
    }));
    return this.toPanel(saved);
  }

  async dismissNotice(clientId) {
    const saved = await this.settingsStore.transaction(clientId, (doc) => ({
      ...doc,
      adminNotice: null
    }));
    return this.toPanel(saved);
  }

  async beginOAuth(clientId, redirectUri, options = {}) {
    if (!this.google?.configured?.()) {
      throw httpError(
        'Falta configurar GOOGLE_CALENDAR_CLIENT_ID y GOOGLE_CALENDAR_CLIENT_SECRET en el servidor.',
        503
      );
    }
    const secret = stateSecret(this.env);
    if (!secret) throw httpError('Falta ADMIN_API_TOKEN para firmar la conexión con Google.', 503);
    const via = options.via === 'invite' ? 'invite' : 'panel';
    const nonce = crypto.randomBytes(16).toString('hex');
    const exp = this.now().getTime() + (10 * 60 * 1000);
    await this.settingsStore.transaction(clientId, (doc) => ({
      ...doc,
      oauthNonce: nonce,
      oauthNonceExpiresAt: exp,
      oauthVia: via
    }));
    const state = signState({ clientId, nonce, exp, via }, secret);
    return { url: this.google.authorizationUrl({ redirectUri, state }), via };
  }

  async completeOAuth(code, state, redirectUri) {
    const payload = verifyState(state, stateSecret(this.env), this.now().getTime());
    if (!payload) throw httpError('La autorización venció o no es válida. Vuelve a conectar.', 400);
    const current = await this.settingsStore.getRaw(payload.clientId);
    if (!current.oauthNonce || current.oauthNonce !== payload.nonce) {
      throw httpError('La autorización ya se usó o venció. Vuelve a conectar.', 400);
    }
    const tokens = await this.google.exchangeCode(code, redirectUri);
    const refreshToken = tokens?.refresh_token || '';
    const accessToken = tokens?.access_token || '';
    if (!refreshToken || !accessToken) {
      throw httpError('Google no entregó un permiso duradero. Vuelve a conectar y acepta el acceso.', 400);
    }
    const email = await this.google.userEmail(accessToken);
    const calendars = await this.google.listCalendars(accessToken);
    const primary = calendars.find((item) => item.primary) || calendars[0] || null;
    const encryptedTokens = encryptCredentialsPayload({
      refreshToken,
      accessToken,
      expiry: this.now().getTime() + (Number(tokens.expires_in) || 3600) * 1000
    });
    const via = current.oauthVia === 'invite' ? 'invite' : 'panel';
    const connectedAt = this.now().toISOString();
    const connectedEmail = email || current.connection.email || '';
    await this.settingsStore.transaction(payload.clientId, (doc) => ({
      ...doc,
      oauthNonce: null,
      oauthNonceExpiresAt: null,
      oauthVia: null,
      encryptedTokens,
      adminNotice: via === 'invite'
        ? { pending: true, email: connectedEmail, connectedAt }
        : null,
      connection: {
        ...doc.connection,
        status: 'connected',
        email: connectedEmail,
        calendarId: primary?.id || '',
        calendarSummary: primary?.summary || '',
        timezone: primary?.timeZone || doc.connection.timezone || DEFAULT_TIMEZONE,
        connectedAt,
        lastError: ''
      }
    }));
    return { clientId: payload.clientId, email: connectedEmail, via };
  }

  async listCalendars(clientId) {
    const token = await this.ensureAccessToken(clientId);
    try {
      return await this.google.listCalendars(token);
    } catch (error) {
      if (error.code === 'revoked') await this.markRevoked(clientId, error.message);
      throw error;
    }
  }

  async ensureAccessToken(clientId) {
    if (this.tokenOverride) return this.tokenOverride;
    const doc = await this.settingsStore.getRaw(clientId);
    if (!doc.encryptedTokens) throw httpError('Google Calendar no está conectado.', 409);
    const tokens = decryptCredentialsPayload(doc.encryptedTokens);
    const expiry = Number(tokens.expiry) || 0;
    if (tokens.accessToken && expiry > this.now().getTime() + 60000) return tokens.accessToken;
    try {
      const refreshed = await this.google.refresh(tokens.refreshToken);
      const next = {
        refreshToken: tokens.refreshToken,
        accessToken: refreshed.access_token,
        expiry: this.now().getTime() + (Number(refreshed.expires_in) || 3600) * 1000
      };
      await this.settingsStore.transaction(clientId, (current) => ({
        ...current,
        encryptedTokens: encryptCredentialsPayload(next)
      }));
      return next.accessToken;
    } catch (error) {
      if (error.code === 'revoked') await this.markRevoked(clientId, error.message);
      throw error;
    }
  }

  async markRevoked(clientId, message) {
    await this.settingsStore.transaction(clientId, (doc) => ({
      ...doc,
      connection: {
        ...doc.connection,
        status: 'revoked',
        lastError: message || 'Autorización vencida o revocada'
      }
    }));
  }

  serviceById(runtime, serviceId) {
    return (runtime.services || []).find((service) => service.id === serviceId && service.active) || null;
  }

  mutationMode(origin, runtime) {
    if (LIVE_ORIGINS.has(origin)) return 'live';
    if (runtime.playgroundWriteEnabled) return 'live';
    return 'dry';
  }

  resolveSlot(runtime, service, startValue) {
    const start = interpretSlotStart(startValue, runtime.timezone);
    if (!start) return { ok: false, error: 'El horario debe ir como YYYY-MM-DDTHH:mm.' };
    const end = new Date(start.getTime() + service.durationMinutes * 60000);
    const now = this.now().getTime();
    if (start.getTime() < now + (runtime.rules.minNoticeMinutes * 60000)) {
      return { ok: false, error: 'Ese horario no cumple la anticipación mínima.' };
    }
    if (start.getTime() > now + (runtime.rules.maxDaysAhead * 86400000)) {
      return { ok: false, error: 'Ese horario supera el máximo de días a futuro.' };
    }
    if (!fitsDayWindows(start, end, runtime.timezone, runtime.hours, runtime.exceptions || [])) {
      return { ok: false, error: 'Ese horario está fuera del horario de atención.' };
    }
    return { ok: true, start, end };
  }

  async fetchGoogleBusy(runtime, fromDate, toDate) {
    const from = `${fromDate}T00:00:00`;
    const toExclusive = addDays(toDate, 1);
    const token = await this.ensureAccessToken(runtime.clientId);
    return this.google.freeBusy(token, {
      calendarId: runtime.calendarId,
      timeMin: new Date(`${fromDate}T00:00:00.000Z`).toISOString(),
      timeMax: new Date(`${toExclusive}T00:00:00.000Z`).toISOString(),
      timeZone: runtime.timezone
    });
  }

  async suggest(runtime, service, fromDate, toDate, options = {}) {
    const appointments = await this.appointmentsStore.listConfirmedInRange(
      runtime.clientId,
      new Date(`${fromDate}T00:00:00.000Z`).toISOString(),
      new Date(`${addDays(toDate, 1)}T00:00:00.000Z`).toISOString()
    );
    let googleBusy = [];
    try {
      googleBusy = await this.fetchGoogleBusy(runtime, fromDate, toDate);
    } catch (error) {
      if (error.code === 'revoked') {
        await this.markRevoked(runtime.clientId, error.message);
        return { revoked: true, slots: [] };
      }
      if (error.code === 'denied' || error.code === 'revoked') {
        // revoked ya se manejó arriba; denied no tumba permanentemente la fase ready
        // (un 403 puntual no debe dejar la agenda inutilizable hasta reconectar).
        return {
          denied: error.code === 'denied',
          googleError: true,
          error: error.message || 'No se pudo consultar Google Calendar',
          slots: []
        };
      }
      // No inventar disponibilidad si Google falla: el diagrama exige consultar eventos/bloqueos.
      return { googleError: true, error: error.message || 'No se pudo consultar Google Calendar', slots: [] };
    }
    return {
      revoked: false,
      slots: buildAvailableSlots({
        now: this.now(),
        timeZone: runtime.timezone,
        hours: runtime.hours,
        exceptions: runtime.exceptions || [],
        service,
        rules: runtime.rules,
        fromDate,
        toDate,
        appointments,
        googleBusy,
        limit: options.limit || 8,
        onePerDay: Boolean(options.onePerDay),
        excludeAppointmentId: options.excludeAppointmentId || null
      })
    };
  }

  async execute(name, args, context = {}) {
    const clientId = context.clientId || '';
    if (!clientId) {
      return { success: false, error: 'Falta clientId.', instruction: 'No confirmes la cita.' };
    }
    const runtime = await this.loadRuntime(clientId);
    if (!runtime.ready) {
      return {
        success: false,
        error: 'La agenda no está lista.',
        phase: runtime.phase,
        instruction: 'No ofrezcas horarios ni confirmes una cita. Di que ahora no es posible agendar, sin inventar disponibilidad.'
      };
    }
    if (name === 'listBookingServices') return this.listServices(runtime);
    if (name === 'getAvailableSlots') return this.getAvailableSlots(runtime, args || {});
    if (name === 'createAppointment') return this.createAppointment(runtime, args || {}, context);
    if (name === 'rescheduleAppointment') return this.rescheduleAppointment(runtime, args || {}, context);
    if (name === 'cancelAppointment') return this.cancelAppointment(runtime, args || {}, context);
    return { success: false, error: 'Herramienta desconocida.' };
  }

  listServices(runtime) {
    const services = (runtime.services || [])
      .filter((service) => service.active)
      .map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description || '',
        durationMinutes: service.durationMinutes,
        capacity: service.capacity || 1
      }));
    return {
      success: true,
      services,
      timezone: runtime.timezone,
      today: runtime.today,
      instruction: 'Ofrece solo estos servicios activos.'
    };
  }

  async getAvailableSlots(runtime, args) {
    const service = this.serviceById(runtime, args.serviceId);
    if (!service) {
      return {
        success: false,
        error: 'Servicio no disponible.',
        instruction: 'Llama listBookingServices y usa un servicio activo.'
      };
    }
    const today = runtime.today;
    const horizon = addDays(today, runtime.rules.maxDaysAhead);
    if (!args.date) {
      const suggestion = await this.suggest(runtime, service, today, horizon, { onePerDay: true, limit: 14 });
      if (suggestion.revoked || suggestion.denied || suggestion.googleError) {
        return {
          success: false,
          error: suggestion.revoked
            ? 'La autorización de Google venció o fue revocada.'
            : (suggestion.error || 'No se pudo consultar Google Calendar.'),
          phase: suggestion.revoked ? 'revoked' : (suggestion.denied ? 'error' : runtime.phase),
          instruction: 'No inventes horarios ni disponibilidad. Pide reintentar o reconectar Google Calendar.'
        };
      }
      const dates = suggestion.slots.map((slot) => ({
        date: localDate(new Date(slot.start), runtime.timezone),
        label: slot.dayLabel
      }));
      return {
        success: true,
        dates,
        instruction: dates.length
          ? 'Ofrece solo estas fechas (date y label), sin horas. Cuando elijan una, vuelve a llamar getAvailableSlots con ese date.'
          : 'No hay fechas libres en el horizonte. Sugiere otra fecha o servicio.'
      };
    }
    const date = String(args.date).trim();
    const suggestion = await this.suggest(runtime, service, date, date, { limit: 16 });
    if (suggestion.revoked || suggestion.denied || suggestion.googleError) {
      return {
        success: false,
        error: suggestion.revoked
          ? 'La autorización de Google venció o fue revocada.'
          : (suggestion.error || 'No se pudo consultar Google Calendar.'),
        phase: suggestion.revoked ? 'revoked' : (suggestion.denied ? 'error' : runtime.phase),
        instruction: 'No inventes horarios ni disponibilidad. Pide reintentar o reconectar Google Calendar.'
      };
    }
    let slots = suggestion.slots;
    if (args.preferredStart) {
      const preferred = interpretSlotStart(args.preferredStart, runtime.timezone);
      if (preferred) {
        const wanted = formatLocal(preferred, runtime.timezone);
        const exact = slots.find((slot) => slot.startLocal === wanted);
        if (exact) slots = [exact].concat(slots.filter((slot) => slot.start !== exact.start));
      }
    }
    return {
      success: true,
      date,
      slots: slots.slice(0, 8),
      instruction: slots.length
        ? 'Ofrece solo estos horarios usando label. Para reservar copia startLocal.'
        : 'No hay cupo ese día. Ofrece buscar otra fecha.'
    };
  }

  async createAppointment(runtime, args, context) {
    const service = this.serviceById(runtime, args.serviceId);
    if (!service) {
      return { success: false, error: 'Ese servicio no está disponible.', instruction: 'No reserves un servicio que no esté activo.' };
    }
    const customerName = typeof args.customerName === 'string' ? args.customerName.trim() : '';
    if (!customerName) {
      return { success: false, error: 'Falta el nombre de quien reserva.', instruction: 'Pide el nombre antes de crear la cita.' };
    }
    const slot = this.resolveSlot(runtime, service, args.start);
    if (!slot.ok) {
      return {
        success: false,
        error: slot.error,
        instruction: slot.error.includes('YYYY-MM-DD')
          ? 'No pidas el formato a la persona. Vuelve a llamar createAppointment copiando startLocal del horario ofrecido.'
          : 'No confirmes ese horario. Ofrece alternativas reales.'
      };
    }
    const mode = this.mutationMode(context.origin, runtime);
    if (mode === 'blocked') {
      return { success: false, error: 'Este canal no puede modificar la agenda.', instruction: 'No confirmes la cita.' };
    }
    const day = localDate(slot.start, runtime.timezone);
    let googleBusy = [];
    try {
      googleBusy = await this.fetchGoogleBusy(runtime, day, day);
    } catch (error) {
      if (error.code === 'revoked') {
        await this.markRevoked(runtime.clientId, error.message);
        return { success: false, error: 'La autorización de Google venció o fue revocada.', phase: 'revoked', instruction: 'No confirmes la cita.' };
      }
      throw error;
    }
    if (mode === 'dry') {
      const open = buildAvailableSlots({
        now: this.now(),
        timeZone: runtime.timezone,
        hours: runtime.hours,
        exceptions: runtime.exceptions || [],
        service,
        rules: runtime.rules,
        fromDate: day,
        toDate: day,
        appointments: await this.appointmentsStore.listConfirmedInRange(
          runtime.clientId,
          slot.start.toISOString(),
          slot.end.toISOString()
        ),
        googleBusy,
        limit: 20
      }).some((item) => item.start === slot.start.toISOString());
      if (!open) {
        return { success: false, error: 'Ese horario ya está ocupado.', instruction: 'No confirmes la cita. Ofrece alternativas.' };
      }
      return {
        success: false,
        dryRun: true,
        testMode: true,
        service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes, capacity: service.capacity },
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        label: formatSlotLabel(slot.start, slot.end, runtime.timezone),
        customerName,
        instruction: 'Modo de prueba sin escritura. No digas que la cita quedó agendada.'
      };
    }
    const notes = typeof args.notes === 'string' ? args.notes.trim() : '';
    const booked = await bookAppointment({
      appointmentsStore: this.appointmentsStore,
      clientId: runtime.clientId,
      service,
      start: slot.start,
      end: slot.end,
      customerName,
      customerPhone: cleanPhone(context.userId),
      notes,
      googleBusy,
      rules: runtime.rules,
      timeZone: runtime.timezone
    });
    if (!booked.ok) {
      const alternatives = await this.suggest(runtime, service, day, day, { limit: 8 });
      return {
        success: false,
        error: 'Ese horario ya no tiene cupo.',
        slots: alternatives.slots || [],
        instruction: 'No confirmes la cita. Ofrece solo los horarios alternativos.'
      };
    }
    return {
      success: true,
      appointmentId: booked.appointment.id,
      sync: 'pending',
      service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes, capacity: service.capacity },
      start: booked.appointment.start,
      end: booked.appointment.end,
      label: formatSlotLabel(slot.start, slot.end, runtime.timezone),
      customerName,
      instruction: 'La cita quedó reservada. Confirma solo estos datos. La sincronización con Google puede completarse en segundo plano.'
    };
  }

  async rescheduleAppointment(runtime, args, context) {
    if (!runtime.rules.allowReschedule) {
      return { success: false, error: 'Este bot no permite reprogramar citas.', instruction: 'No muevas la cita.' };
    }
    const appointmentId = typeof args.appointmentId === 'string' ? args.appointmentId.trim() : '';
    const current = await this.appointmentsStore.get(runtime.clientId, appointmentId);
    if (!current || current.status !== 'confirmed') {
      return { success: false, error: 'No encontré esa cita.', instruction: 'No confirmes un cambio.' };
    }
    const service = this.serviceById(runtime, current.serviceId)
      || (runtime.services || []).find((item) => item.id === current.serviceId);
    if (!service) return { success: false, error: 'El servicio de esa cita ya no está disponible.', instruction: 'No muevas la cita.' };
    const slot = this.resolveSlot(runtime, service, args.start);
    if (!slot.ok) return { success: false, error: slot.error, instruction: 'No confirmes ese horario.' };
    const mode = this.mutationMode(context.origin, runtime);
    if (mode === 'dry') {
      return {
        success: false,
        dryRun: true,
        testMode: true,
        appointmentId,
        label: formatSlotLabel(slot.start, slot.end, runtime.timezone),
        instruction: 'Modo de prueba sin escritura. No digas que la cita se reprogramó.'
      };
    }
    const day = localDate(slot.start, runtime.timezone);
    let googleBusy = [];
    try {
      googleBusy = await this.fetchGoogleBusy(runtime, day, day);
    } catch (error) {
      if (error.code === 'revoked') {
        return { success: false, error: 'La autorización de Google venció o fue revocada.', instruction: 'No confirmes el cambio.' };
      }
      throw error;
    }
    const moved = await rescheduleAppointmentRecord({
      appointmentsStore: this.appointmentsStore,
      clientId: runtime.clientId,
      appointmentId,
      service,
      start: slot.start,
      end: slot.end,
      googleBusy,
      rules: runtime.rules,
      timeZone: runtime.timezone
    });
    if (!moved.ok) {
      return { success: false, error: 'No se pudo reprogramar ese horario.', instruction: 'No confirmes el cambio.' };
    }
    return {
      success: true,
      appointmentId,
      sync: 'pending',
      label: formatSlotLabel(slot.start, slot.end, runtime.timezone),
      start: moved.appointment.start,
      end: moved.appointment.end,
      instruction: 'La cita quedó reprogramada. Confirma solo este horario.'
    };
  }

  async cancelAppointment(runtime, args, context) {
    if (!runtime.rules.allowCancel) {
      return { success: false, error: 'Este bot no permite cancelar citas.', instruction: 'No canceles la cita.' };
    }
    const appointmentId = typeof args.appointmentId === 'string' ? args.appointmentId.trim() : '';
    const mode = this.mutationMode(context.origin, runtime);
    if (mode === 'dry') {
      return {
        success: false,
        dryRun: true,
        testMode: true,
        appointmentId,
        instruction: 'Modo de prueba sin escritura. No digas que la cita quedó cancelada.'
      };
    }
    const cancelled = await cancelAppointmentRecord({
      appointmentsStore: this.appointmentsStore,
      clientId: runtime.clientId,
      appointmentId
    });
    if (!cancelled.ok) {
      return { success: false, error: 'No encontré esa cita.', instruction: 'No confirmes la cancelación.' };
    }
    return {
      success: true,
      appointmentId,
      sync: cancelled.appointment.sync,
      instruction: 'La cita ya se canceló. Confirma solo eso.'
    };
  }

  async processSyncQueue({ limitPerClient = 20 } = {}) {
    // Preferir bots con agenda_settings: el doc padre de appointments puede no existir aún.
    const fromSettings = typeof this.settingsStore.listClientIds === 'function'
      ? await this.settingsStore.listClientIds()
      : [];
    const fromAppointments = await this.appointmentsStore.listAllClientIds();
    const clientIds = [...new Set(fromSettings.concat(fromAppointments))];
    const summary = [];
    for (const clientId of clientIds) {
      const settings = await this.settingsStore.getRaw(clientId);
      if (!settings.enabled || settings.connection?.status !== 'connected') continue;
      if (typeof this.appointmentsStore.ensureParent === 'function') {
        try { await this.appointmentsStore.ensureParent(clientId); } catch (_error) { /* ignore */ }
      }
      try {
        const result = await processClientSyncQueue({
          clientId,
          settings,
          appointmentsStore: this.appointmentsStore,
          google: this.google,
          ensureAccessToken: (id) => this.ensureAccessToken(id),
          nowMs: this.now().getTime(),
          limit: limitPerClient
        });
        if (result.processed) summary.push({ clientId, ...result });
      } catch (error) {
        summary.push({ clientId, error: error.message });
      }
    }
    return summary;
  }
}

module.exports = { AgendaService, httpError, clone };
