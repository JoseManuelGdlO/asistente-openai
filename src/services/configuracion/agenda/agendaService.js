const crypto = require('crypto');
const { encryptCredentialsPayload, decryptCredentialsPayload } = require('../../../utils/credentialsCrypto');
const { DEFAULT_TIMEZONE, LIVE_ORIGINS, CAPACITY_MIN, CAPACITY_MAX } = require('./constants');
const { normalizeAgenda, isValidTimeZone } = require('./normalize');
const { describePhase } = require('./readiness');
const { countOccupancy, buildAvailableSlots } = require('./availability');
const {
  bookAppointment,
  rescheduleAppointmentRecord,
  cancelAppointmentRecord
} = require('./booking');
const { syncOneAppointment, processSyncQueue } = require('./syncWorker');
const { signState, verifyState, stateSecret } = require('./oauthState');
const {
  localDate,
  addDays,
  zonedToUtc,
  formatLocal,
  formatDayLabel,
  formatSlotLabel,
  weekdayKeyFromDate,
  mondayOfWeek,
  dayWindows,
  rollPastDate,
  parseLocalDateTime,
  interpretSlotStart,
  fitsHours
} = require('./time');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const { publicCalendarSummary } = require('./invite');
const { isAgendaTool, toolDefinitions, mergeTools, buildInstructions } = require('./tools');

const OAUTH_TTL_MS = 10 * 60 * 1000;

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanPhone(userId) {
  return String(userId || '').replace(/@.+$/, '').trim();
}

function appointmentsPerBlockOf(rules) {
  const number = Number(rules?.appointmentsPerBlock ?? 1);
  if (!Number.isInteger(number)) return CAPACITY_MIN;
  return Math.min(CAPACITY_MAX, Math.max(CAPACITY_MIN, number));
}

function bufferMsOf(rules) {
  return Math.max(0, Number(rules?.bufferMinutes) || 0) * 60000;
}

function brief(service) {
  return { id: service.id, name: service.name, durationMinutes: service.durationMinutes };
}

const REVOKED_RESULT = {
  success: false,
  error: 'La autorización de Google venció o fue revocada.',
  phase: 'revoked',
  instruction: 'No confirmes la cita ni inventes horarios. Pide que se vuelva a conectar Google Calendar.'
};

const UNVERIFIED_RESULT = {
  success: false,
  error: 'No se pudo verificar la disponibilidad en este momento.',
  instruction: 'No confirmes ni ofrezcas horarios. Di que ahora no es posible agendar y que intenten más tarde.'
};

class AgendaService {
  constructor({
    settingsStore, appointmentsStore, google, now = () => new Date(), env = process.env, tokenOverride = ''
  }) {
    this.settingsStore = settingsStore;
    this.appointmentsStore = appointmentsStore;
    this.google = google;
    this.now = now;
    this.env = env;
    this.tokenOverride = tokenOverride;
  }

  // ── Herramientas del bot (delegadas) ────────────────────────────────────
  toolDefinitions() { return toolDefinitions(); }

  mergeTools(storedTools, agendaTools) { return mergeTools(storedTools, agendaTools); }

  isAgendaTool(name) { return isAgendaTool(name); }

  buildInstructions(runtime) { return buildInstructions(runtime); }

  // ── Panel ───────────────────────────────────────────────────────────────
  toPanel(doc, syncIssues = null) {
    const phase = describePhase(doc);
    const issues = syncIssues || { retryCount: 0, failedCount: 0, lastError: '' };
    return {
      syncIssues: issues,
      lastSyncError: issues.lastError || '',
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
        connectedAt: doc.connection?.connectedAt || null,
        lastError: doc.connection?.lastError || ''
      },
      timezone: doc.timezone || DEFAULT_TIMEZONE,
      hours: doc.hours,
      exceptions: doc.exceptions || [],
      services: doc.services || [],
      rules: doc.rules,
      playgroundWriteEnabled: doc.playgroundWriteEnabled === true,
      adminNotice: doc.adminNotice?.pending
        ? { email: doc.adminNotice.email || '', connectedAt: doc.adminNotice.connectedAt || null }
        : null
    };
  }

  /** Citas en retry/failed: el dueño las ve en el panel aunque la reserva siga confirmada. */
  async loadSyncIssues(clientId) {
    const empty = { retryCount: 0, failedCount: 0, lastError: '' };
    if (typeof this.appointmentsStore?.listSyncIssues !== 'function') return empty;
    const rows = await this.appointmentsStore.listSyncIssues(clientId);
    let latest = null;
    for (const row of rows) {
      if (row.sync === 'retry') empty.retryCount += 1;
      if (row.sync === 'failed') empty.failedCount += 1;
      if (!row.lastSyncError) continue;
      const at = Date.parse(row.updatedAt) || 0;
      if (!latest || at >= latest.at) latest = { at, error: row.lastSyncError };
    }
    empty.lastError = latest?.error || '';
    return empty;
  }

  /** Panel completo (incluye errores de sync). Toda respuesta al panel pasa por aquí. */
  async panelFor(clientId, doc) {
    return this.toPanel(doc, await this.loadSyncIssues(clientId));
  }

  async getPanel(clientId) {
    return this.panelFor(clientId, await this.settingsStore.getRaw(clientId));
  }

  /** Resumen mínimo para el listado de clientes. */
  async publicSummary(clientId) {
    return publicCalendarSummary(await this.getPanel(clientId));
  }

  async loadRuntime(clientId) {
    const doc = await this.settingsStore.getRaw(clientId);
    const phase = describePhase(doc);
    const timezone = doc.timezone || DEFAULT_TIMEZONE;
    return {
      clientId,
      ready: phase.ready,
      phase: phase.phase,
      phaseLabel: phase.label,
      enabled: doc.enabled === true,
      hours: doc.hours,
      exceptions: doc.exceptions || [],
      services: doc.services || [],
      rules: doc.rules,
      timezone,
      today: localDate(this.now(), timezone),
      calendarId: doc.connection?.calendarId || '',
      playgroundWriteEnabled: doc.playgroundWriteEnabled === true
    };
  }

  async setEnabled(clientId, enabled) {
    const saved = await this.settingsStore.transaction(clientId, (doc) => ({ ...doc, enabled: Boolean(enabled) }));
    return this.panelFor(clientId, saved);
  }

  async setPlaygroundWrite(clientId, enabled) {
    const saved = await this.settingsStore.transaction(clientId, (doc) => ({
      ...doc,
      playgroundWriteEnabled: Boolean(enabled)
    }));
    return this.panelFor(clientId, saved);
  }

  async saveAgenda(clientId, input) {
    const parsed = normalizeAgenda(input);
    if (!parsed.ok) throw httpError(parsed.error, 400);
    const { value } = parsed;
    const saved = await this.settingsStore.transaction(clientId, (doc) => ({
      ...doc,
      timezone: value.timezone,
      hours: value.hours,
      exceptions: value.exceptions,
      services: value.services,
      rules: value.rules,
      connection: {
        ...doc.connection,
        calendarId: value.calendarId || doc.connection.calendarId,
        calendarSummary: value.calendarId
          ? (value.calendarSummary || doc.connection.calendarSummary)
          : doc.connection.calendarSummary
      }
    }));
    return this.panelFor(clientId, saved);
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
        connection: { ...doc.connection, calendarId, calendarSummary: calendarSummary || calendarId }
      };
    });
    return this.panelFor(clientId, saved);
  }

  async dismissNotice(clientId) {
    const saved = await this.settingsStore.transaction(clientId, (doc) => ({ ...doc, adminNotice: null }));
    return this.panelFor(clientId, saved);
  }

  // ── OAuth y tokens ──────────────────────────────────────────────────────
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
    const exp = this.now().getTime() + OAUTH_TTL_MS;
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
      // La zona del calendario solo se adopta si el dueño aún no eligió una propia.
      timezone: doc.timezone === DEFAULT_TIMEZONE && primary?.timeZone && isValidTimeZone(primary.timeZone)
        ? primary.timeZone
        : doc.timezone,
      adminNotice: via === 'invite' ? { pending: true, email: connectedEmail, connectedAt } : null,
      connection: {
        ...doc.connection,
        status: 'connected',
        email: connectedEmail,
        calendarId: primary?.id || '',
        calendarSummary: primary?.summary || '',
        connectedAt,
        lastError: ''
      }
    }));
    return { clientId: payload.clientId, email: connectedEmail, via };
  }

  async disconnect(clientId) {
    const current = await this.settingsStore.getRaw(clientId);
    if (current.encryptedTokens && typeof this.google?.revoke === 'function') {
      try {
        const tokens = decryptCredentialsPayload(current.encryptedTokens);
        if (tokens?.refreshToken) await this.google.revoke(tokens.refreshToken);
      } catch (_error) {
        // La desconexión local sigue aunque Google no responda.
      }
    }
    const saved = await this.settingsStore.transaction(clientId, (doc) => ({
      ...doc,
      encryptedTokens: null,
      oauthNonce: null,
      oauthNonceExpiresAt: null,
      oauthVia: null,
      adminNotice: null,
      connection: {
        ...doc.connection,
        status: 'disconnected',
        email: '',
        calendarId: '',
        calendarSummary: '',
        connectedAt: null,
        lastError: ''
      }
    }));
    return this.panelFor(clientId, saved);
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
      await this.settingsStore.transaction(clientId, (latest) => ({
        ...latest,
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

  // ── Sincronización ──────────────────────────────────────────────────────
  /** Para el scheduler: reintenta las citas pendientes de todos los clientes. */
  async processSyncQueue(options = {}) {
    return processSyncQueue({
      settingsStore: this.settingsStore,
      appointmentsStore: this.appointmentsStore,
      google: this.google,
      ensureAccessToken: (clientId) => this.ensureAccessToken(clientId),
      now: this.now,
      logger: options.logger
    });
  }

  /** Mejor esfuerzo: nunca lanza ni cambia el resultado de la reserva. */
  async syncAfterWrite(runtime, appointment, service) {
    try {
      const token = await this.ensureAccessToken(runtime.clientId);
      return await syncOneAppointment({
        google: this.google,
        token,
        calendarId: runtime.calendarId,
        timeZone: runtime.timezone,
        clientId: runtime.clientId,
        service,
        appointment,
        appointmentsStore: this.appointmentsStore,
        nowMs: this.now().getTime()
      });
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  /**
   * Vista previa semanal (solo lectura): franjas abiertas + bloques del servicio
   * + citas confirmadas + eventos del Google Calendar conectado
   * (excepto los que ya son espejo de una cita).
   * weekStart / serviceId opcionales.
   */
  async getWeekPreview(clientId, weekStartInput = '', serviceIdInput = '') {
    const doc = await this.settingsStore.getRaw(clientId);
    const timezone = doc.timezone || DEFAULT_TIMEZONE;
    const today = localDate(this.now(), timezone);
    const seed = DATE_RE.test(String(weekStartInput || '')) ? String(weekStartInput) : today;
    const weekStart = mondayOfWeek(seed);
    const weekEnd = addDays(weekStart, 6);
    const days = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(weekStart, offset);
      const windows = dayWindows({
        date,
        hours: doc.hours,
        exceptions: doc.exceptions || []
      });
      days.push({
        date,
        weekday: weekdayKeyFromDate(date),
        label: formatDayLabel(zonedToUtc(date, '12:00', timezone), timezone),
        closed: Boolean(windows.closed),
        intervals: windows.intervals || []
      });
    }
    const fromMs = zonedToUtc(weekStart, '00:00', timezone).getTime();
    const toMs = zonedToUtc(addDays(weekEnd, 1), '00:00', timezone).getTime();
    const rows = typeof this.appointmentsStore.listConfirmedInRange === 'function'
      ? await this.appointmentsStore.listConfirmedInRange(clientId, fromMs, toMs)
      : [];
    const ownEventIds = new Set();
    const appointments = (rows || []).map((row) => {
      if (row.eventId) ownEventIds.add(row.eventId);
      const start = new Date(row.start);
      const end = new Date(row.end);
      return {
        id: row.id,
        serviceName: row.serviceName || '',
        customerName: row.customerName || '',
        start: row.start,
        end: row.end,
        startLocal: Number.isFinite(start.getTime()) ? formatLocal(start, timezone) : '',
        endLocal: Number.isFinite(end.getTime()) ? formatLocal(end, timezone) : '',
        sync: row.sync || '',
        eventId: row.eventId || ''
      };
    });

    const activeServices = (doc.services || []).filter((service) => service.active);
    const serviceList = activeServices.map((service) => ({
      id: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes
    }));
    const selectedService = activeServices.find((service) => service.id === serviceIdInput)
      || activeServices[0]
      || null;
    // Cupo = columnas verticales del calendario (citas simultáneas por horario de inicio).
    const capacity = appointmentsPerBlockOf(doc.rules);
    const calendarColumns = Math.min(12, Math.max(1, capacity));
    const bufferMs = Math.max(0, Number(doc.rules?.bufferMinutes) || 0) * 60000;
    const durationMinutes = Math.max(5, Number(selectedService?.durationMinutes) || 30);
    const durationMs = durationMinutes * 60000;
    const stepMinutes = Math.max(5, Number(doc.rules?.slotIntervalMinutes) || 30);
    const stepMs = stepMinutes * 60000;
    // Filas del calendario: cada 30 min desde la apertura hasta el cierre inclusive
    // (p. ej. 09:00 … 15:00). bookable=false si la duración del servicio ya no cabe.
    const blocks = [];
    if (selectedService) {
      for (const day of days) {
        for (const interval of day.intervals || []) {
          let cursor = zonedToUtc(day.date, interval.start, timezone).getTime();
          const close = zonedToUtc(day.date, interval.end, timezone).getTime();
          while (cursor <= close) {
            const startMs = cursor;
            const bookable = startMs + durationMs <= close;
            const endMs = bookable ? startMs + durationMs : Math.min(startMs + stepMs, close);
            cursor += stepMs;
            const occupied = bookable
              ? countOccupancy({
                startMs,
                endMs,
                appointments: rows || [],
                googleBusy: [],
                ownEventIds,
                bufferMs
              })
              : 0;
            const start = new Date(startMs);
            const end = new Date(bookable ? endMs : startMs);
            blocks.push({
              date: day.date,
              start: start.toISOString(),
              end: end.toISOString(),
              startLocal: formatLocal(start, timezone),
              endLocal: formatLocal(end, timezone),
              occupied,
              capacity,
              bookable,
              full: bookable && occupied >= capacity
            });
          }
        }
      }
    }

    let googleEvents = [];
    let googleStatus = { connected: false, ok: false, error: '' };
    const calendarId = doc.connection?.calendarId || '';
    const connected = doc.connection?.status === 'connected' && Boolean(calendarId);
    if (connected) {
      googleStatus.connected = true;
      try {
        const token = await this.ensureAccessToken(clientId);
        const raw = typeof this.google.listEvents === 'function'
          ? await this.google.listEvents(token, {
            calendarId,
            timeMin: new Date(fromMs).toISOString(),
            timeMax: new Date(toMs).toISOString(),
            timeZone: timezone
          })
          : [];
        googleEvents = (Array.isArray(raw) ? raw : [])
          .filter((item) => item?.id && !ownEventIds.has(item.id))
          .map((item) => {
            let start = item.start;
            let end = item.end;
            if (item.allDay || (/^\d{4}-\d{2}-\d{2}$/.test(String(start)) && /^\d{4}-\d{2}-\d{2}$/.test(String(end)))) {
              const startDate = String(start).slice(0, 10);
              const endDate = String(end).slice(0, 10);
              start = zonedToUtc(startDate, '00:00', timezone).toISOString();
              end = zonedToUtc(endDate, '00:00', timezone).toISOString();
            } else {
              start = new Date(start).toISOString();
              end = new Date(end).toISOString();
            }
            const startDate = new Date(start);
            const endDate = new Date(end);
            return {
              id: item.id,
              summary: item.summary || '(sin título)',
              start,
              end,
              startLocal: Number.isFinite(startDate.getTime()) ? formatLocal(startDate, timezone) : '',
              endLocal: Number.isFinite(endDate.getTime()) ? formatLocal(endDate, timezone) : '',
              allDay: Boolean(item.allDay)
            };
          })
          .filter((item) => item.startLocal && item.endLocal);
        googleStatus.ok = true;
      } catch (error) {
        if (error.code === 'revoked') await this.markRevoked(clientId, error.message);
        googleStatus.error = String(error?.message || error);
        console.warn(
          `Agenda ${clientId}: preview Google no disponible (${error.code || error.message})`
        );
      }
    }

    return {
      timezone,
      weekStart,
      weekEnd,
      days,
      appointments,
      googleEvents,
      google: googleStatus,
      services: serviceList,
      serviceId: selectedService?.id || '',
      serviceName: selectedService?.name || '',
      durationMinutes: selectedService ? durationMinutes : null,
      slotIntervalMinutes: stepMinutes,
      appointmentsPerBlock: capacity,
      calendarColumns,
      blocks
    };
  }

  // ── Disponibilidad ──────────────────────────────────────────────────────
  /** Citas confirmadas + ids de eventos propios (incluye canceladas con borrado pendiente en Google). */
  async occupancySnapshot(clientId) {
    return this.appointmentsStore.runTransaction(clientId, async (tx) => {
      const appointments = await tx.listConfirmed();
      const ownEventIds = new Set();
      for (const row of appointments) if (row?.eventId) ownEventIds.add(row.eventId);
      const cancelled = typeof tx.listCancelledWithEventId === 'function'
        ? await tx.listCancelledWithEventId()
        : [];
      for (const row of cancelled) if (row?.eventId) ownEventIds.add(row.eventId);
      return { appointments, ownEventIds };
    });
  }

  /**
   * Bloques ocupados de Google en [fromMs, toMs].
   * Si la auth está revocada → { revoked:true }.
   * Otros errores de Google no tumban la consulta: se sigue con citas locales (busy []).
   */
  async loadGoogleBusy(runtime, fromMs, toMs) {
    try {
      const token = await this.ensureAccessToken(runtime.clientId);
      const raw = await this.google.freeBusy(token, {
        calendarId: runtime.calendarId,
        timeMin: new Date(fromMs).toISOString(),
        timeMax: new Date(toMs).toISOString(),
        timeZone: runtime.timezone
      });
      return { revoked: false, busy: Array.isArray(raw) ? raw : [] };
    } catch (error) {
      if (error.code === 'revoked') {
        await this.markRevoked(runtime.clientId, error.message);
        return { revoked: true, busy: [] };
      }
      console.warn(
        `Agenda ${runtime.clientId}: freeBusy no disponible (${error.code || error.message}); uso solo citas locales.`
      );
      return { revoked: false, busy: [] };
    }
  }

  /**
   * Horarios libres entre dos fechas locales.
   * Fuente de verdad: nuestra agenda (citas confirmadas en Firestore) + horarios/cupos/excepciones.
   * Google Calendar solo se usa después para sincronizar eventos; no filtra la oferta.
   */
  async findSlots(runtime, service, fromDate, toDate, options = {}) {
    const { appointments, ownEventIds } = await this.occupancySnapshot(runtime.clientId);
    const result = buildAvailableSlots({
      now: this.now(),
      timeZone: runtime.timezone,
      hours: runtime.hours,
      exceptions: runtime.exceptions,
      service,
      rules: runtime.rules,
      fromDate,
      toDate,
      appointments,
      googleBusy: [],
      ownEventIds,
      limit: options.limit,
      onePerDay: Boolean(options.onePerDay),
      excludeAppointmentId: options.excludeAppointmentId || null
    });
    return { revoked: false, ...result };
  }

  /** Alternativas frescas del día de un horario que acaba de ocuparse. Nunca lanza. */
  async freshOfferList(runtime, service, startDate, excludeAppointmentId = null) {
    try {
      const day = localDate(startDate, runtime.timezone);
      const found = await this.findSlots(runtime, service, day, day, { limit: 288, excludeAppointmentId });
      return found.revoked ? [] : (found.slots || []);
    } catch (_error) {
      return [];
    }
  }

  serviceById(runtime, serviceId) {
    return (runtime.services || []).find((service) => service.id === serviceId && service.active) || null;
  }

  mutationMode(origin, runtime) {
    if (LIVE_ORIGINS.has(origin)) return 'live';
    if (origin === 'playground') return runtime.playgroundWriteEnabled ? 'live' : 'dry';
    return 'blocked';
  }

  resolveSlot(runtime, service, startValue) {
    const start = interpretSlotStart(startValue, runtime.timezone);
    if (!start) return { ok: false, error: 'El horario debe ir como YYYY-MM-DDTHH:mm.', format: true };
    const end = new Date(start.getTime() + service.durationMinutes * 60000);
    const nowMs = this.now().getTime();
    if (start.getTime() < nowMs + (runtime.rules.minNoticeMinutes * 60000)) {
      return { ok: false, error: 'Ese horario no cumple la anticipación mínima.' };
    }
    if (start.getTime() > nowMs + (runtime.rules.maxDaysAhead * 86400000)) {
      return { ok: false, error: 'Ese horario supera el máximo de días a futuro.' };
    }
    if (!fitsHours(start, end, runtime)) {
      return { ok: false, error: 'Ese horario está fuera del horario de atención.' };
    }
    return { ok: true, start, end };
  }

  slotFailure(slot) {
    return {
      success: false,
      error: slot.error,
      instruction: slot.format
        ? 'No pidas el formato a la persona. Vuelve a llamar copiando startLocal del horario ofrecido.'
        : 'No confirmes ese horario. Ofrece alternativas reales consultando getAvailableSlots.'
    };
  }

  async slotIsFull(runtime, service, slot, googleBusy, excludeAppointmentId = null) {
    const { appointments, ownEventIds } = await this.occupancySnapshot(runtime.clientId);
    const occupied = countOccupancy({
      startMs: slot.start.getTime(),
      endMs: slot.end.getTime(),
      appointments,
      googleBusy,
      ownEventIds,
      bufferMs: bufferMsOf(runtime.rules),
      excludeAppointmentId
    });
    return occupied >= appointmentsPerBlockOf(runtime.rules);
  }

  /** Busy de Google alrededor de un horario concreto (para verificar antes de escribir). */
  busyAround(runtime, slot) {
    const buffer = bufferMsOf(runtime.rules);
    return this.loadGoogleBusy(runtime, slot.start.getTime() - buffer - 60000, slot.end.getTime() + buffer + 60000);
  }

  ownsAppointment(appointment, context) {
    if (context.origin === 'playground') return true;
    const caller = cleanPhone(context.userId);
    if (!caller || !appointment.customerPhone) return true;
    return caller === appointment.customerPhone;
  }

  // ── Ejecución de herramientas ───────────────────────────────────────────
  async execute(name, args, context = {}) {
    const runtime = await this.loadRuntime(context.clientId);
    if (!runtime.ready) {
      return {
        success: false,
        error: 'La agenda de este bot no está disponible.',
        phase: runtime.phase,
        instruction: 'No ofrezcas horarios ni confirmes una cita. Di que ahora no es posible agendar, sin inventar disponibilidad.'
      };
    }
    try {
      if (name === 'listBookingServices') return this.listServices(runtime);
      if (name === 'getAvailableSlots') return await this.getAvailableSlots(runtime, args || {});
      if (name === 'createAppointment') return await this.createAppointment(runtime, args || {}, context);
      if (name === 'rescheduleAppointment') return await this.rescheduleAppointment(runtime, args || {}, context);
      if (name === 'cancelAppointment') return await this.cancelAppointment(runtime, args || {}, context);
    } catch (error) {
      return { success: false, error: error?.message || 'No se pudo completar la acción.', instruction: 'No digas que la acción se completó.' };
    }
    return { success: false, error: `Función ${name} no implementada.` };
  }

  listServices(runtime) {
    const services = (runtime.services || []).filter((service) => service.active).map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description || '',
      durationMinutes: service.durationMinutes
    }));
    return {
      success: true,
      timezone: runtime.timezone,
      services,
      instruction: 'Usa solo estos servicios y estas duraciones.'
    };
  }

  async getAvailableSlots(runtime, args) {
    const service = this.serviceById(runtime, args.serviceId);
    if (!service) {
      return {
        success: false,
        error: 'Ese servicio no está disponible.',
        instruction: 'Llama listBookingServices y usa un servicio activo.'
      };
    }
    const today = localDate(this.now(), runtime.timezone);
    const preferredText = typeof args.preferredStart === 'string' ? args.preferredStart.trim() : '';
    let preferred = preferredText ? interpretSlotStart(preferredText, runtime.timezone) : null;
    if (preferredText && !preferred) {
      return {
        success: false,
        error: 'Usa YYYY-MM-DDTHH:mm en la zona de la agenda. Copia startLocal del horario ofrecido.',
        instruction: 'No se lo pidas a la persona. Vuelve a consultar copiando startLocal.'
      };
    }
    let requestedDate = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
      ? args.date
      : (preferred ? localDate(preferred, runtime.timezone) : '');
    const horizon = addDays(today, runtime.rules.maxDaysAhead);
    let correctedFrom = null;
    if (requestedDate) {
      const rolled = rollPastDate(requestedDate, today);
      if (rolled?.past) {
        return {
          success: false,
          error: `La fecha ${requestedDate} ya pasó. Hoy es ${today}.`,
          today,
          instruction: 'No digas que no hay disponibilidad. Esa fecha ya pasó. Pide un día a partir de hoy.'
        };
      }
      if (rolled?.correctedFrom) {
        if (rolled.date > horizon) {
          return {
            success: false,
            error: `La fecha ${rolled.correctedFrom} ya pasó. Hoy es ${today}.`,
            today,
            correctedDate: rolled.date,
            instruction: `No digas que no hay disponibilidad. El día equivalente ${rolled.date} queda fuera de los ${runtime.rules.maxDaysAhead} días que se pueden agendar.`
          };
        }
        correctedFrom = rolled.correctedFrom;
        requestedDate = rolled.date;
        if (preferredText) {
          preferred = parseLocalDateTime(`${requestedDate}T${preferredText.slice(11, 16)}`, runtime.timezone);
        }
      }
    }
    const dayMode = !requestedDate;
    let found;
    try {
      // Día concreto: devolver todos los huecos libres de la jornada (tope alto por intervalo mínimo 5 min).
      // Modo fechas: hasta 10 días con al menos un hueco.
      found = await this.findSlots(runtime, service, requestedDate || today, requestedDate || horizon, {
        limit: dayMode ? 10 : 288,
        onePerDay: dayMode
      });
    } catch (_error) {
      return UNVERIFIED_RESULT;
    }
    if (found.revoked) {
      return {
        success: false,
        error: REVOKED_RESULT.error,
        phase: 'revoked',
        instruction: 'No inventes horarios. Pide que se vuelva a conectar Google Calendar.'
      };
    }

    let exact = null;
    let slots;
    if (dayMode) {
      slots = (found.dates || []).map((item) => ({ date: item.date, label: item.dayLabel }));
    } else {
      const all = found.slots || [];
      if (preferred) {
        const wanted = formatLocal(preferred, runtime.timezone);
        exact = all.find((slot) => slot.startLocal === wanted) || null;
      }
      slots = exact
        ? [exact].concat(all.filter((slot) => slot.start !== exact.start))
        : all;
    }
    const slotCount = slots.length;
    const offerText = dayMode
      ? slots.map((item, index) => `${index + 1}. ${item.label} (${item.date})`).join('\n')
      : slots.map((item, index) => `${index + 1}. ${item.label}`).join('\n');
    let instruction = exact
      ? (
        slotCount > 1
          ? `El horario pedido está libre. Hoy es ${today}. Confirma ese horario si lo quieren, y además enumera TODOS los ${slotCount} horarios libres de offerText / slots (no digas solo uno).`
          : `Ese horario está libre. Hoy es ${today}. Pide confirmación antes de reservar.`
      )
      : dayMode
        ? (slotCount
          ? `Hoy es ${today}. El año es ${today.slice(0, 4)}. Esta respuesta solo trae fechas libres. Ofrece las ${slotCount} fechas de offerText / slots, sin horas. Cuando elijan una, vuelve a llamar getAvailableSlots con ese date. No menciones otro año.`
          : `Hoy es ${today}. No hay días con horario libre en los próximos ${runtime.rules.maxDaysAhead} días. No inventes días ni horarios.`)
        : (slotCount
          ? `Hoy es ${today}. El año es ${today.slice(0, 4)}. Hay ${slotCount} horarios libres este día. Debes copiar offerText completo o cada label de slots (TODOS). PROHIBIDO inventar horarios que no estén en la lista. Solo los bloques devueltos. No menciones otro año.`
          : `Hoy es ${today}. No hay horarios libres ese día. No inventes horarios.`);
    if (correctedFrom) {
      const outcome = slotCount
        ? `Enumera TODOS los ${slotCount} horarios del ${requestedDate} (offerText).`
        : `El ${requestedDate} no tiene horarios. No digas que no hay disponibilidad en general.`;
      instruction = `La fecha ${correctedFrom} ya pasó. Hoy es ${today}. El año es ${today.slice(0, 4)}. Busqué ${requestedDate}. ${outcome} No digas ${correctedFrom.slice(0, 4)}.`;
    }
    return {
      success: true,
      service: brief(service),
      timezone: runtime.timezone,
      today,
      correctedFrom,
      mode: dayMode ? 'days' : 'times',
      exact: Boolean(exact),
      slotCount,
      offerText,
      slots,
      instruction
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
    if (!slot.ok) return this.slotFailure(slot);
    const mode = this.mutationMode(context.origin, runtime);
    if (mode === 'blocked') {
      return { success: false, error: 'Este canal no puede modificar la agenda.', instruction: 'No confirmes la cita.' };
    }

    const view = {
      service: brief(service),
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      label: formatSlotLabel(slot.start, slot.end, runtime.timezone),
      customerName
    };

    if (mode === 'dry') {
      if (await this.slotIsFull(runtime, service, slot, [])) {
        return this.slotFullResult(runtime, service, slot);
      }
      return {
        success: false,
        dryRun: true,
        testMode: true,
        ...view,
        instruction: 'Modo de prueba sin escritura. No digas que la cita quedó agendada. Explica que hace falta activar la escritura de prueba para crear la cita real.'
      };
    }

    const booked = await bookAppointment({
      appointmentsStore: this.appointmentsStore,
      clientId: runtime.clientId,
      service,
      start: slot.start,
      end: slot.end,
      customerName,
      customerPhone: cleanPhone(context.userId),
      notes: typeof args.notes === 'string' ? args.notes.trim() : '',
      googleBusy: [],
      rules: runtime.rules
    });
    if (!booked.ok) {
      if (booked.code === 'slot_full') return this.slotFullResult(runtime, service, slot);
      return { success: false, error: 'No se pudo crear la cita.', code: booked.code, instruction: 'No digas que la cita quedó agendada.' };
    }

    const synced = await this.syncAfterWrite(runtime, booked.appointment, service);
    return {
      success: true,
      appointmentId: booked.appointment.id,
      eventId: synced.ok ? (synced.eventId || '') : '',
      syncPending: !synced.ok,
      ...view,
      instruction: synced.ok
        ? 'La cita quedó agendada. Confirma solo estos datos.'
        : 'La cita quedó agendada. Confirma solo estos datos; la copia en el calendario se completa sola en segundo plano. No menciones errores técnicos.'
    };
  }

  async slotFullResult(runtime, service, slot, excludeAppointmentId = null) {
    const offerList = await this.freshOfferList(runtime, service, slot.start, excludeAppointmentId);
    return {
      success: false,
      code: 'slot_full',
      error: 'Ese horario ya está ocupado.',
      offerList,
      offerText: offerList.map((item, index) => `${index + 1}. ${item.label}`).join('\n'),
      slotCount: offerList.length,
      instruction: offerList.length
        ? `No confirmes la cita. Hay ${offerList.length} alternativas. Enumera TODAS (offerText / offerList), sin dejar solo la última.`
        : 'No confirmes la cita. Ese día ya no tiene horarios; consulta getAvailableSlots para otro día.'
    };
  }

  async rescheduleAppointment(runtime, args, context) {
    if (!runtime.rules.allowReschedule) {
      return { success: false, error: 'Este bot no permite reprogramar citas.', instruction: 'No muevas la cita.' };
    }
    const appointmentId = typeof args.appointmentId === 'string' ? args.appointmentId.trim() : '';
    const current = appointmentId ? await this.appointmentsStore.get(runtime.clientId, appointmentId) : null;
    if (!current || current.status !== 'confirmed' || !this.ownsAppointment(current, context)) {
      return { success: false, error: 'No encontré esa cita.', instruction: 'No confirmes un cambio.' };
    }
    const service = (runtime.services || []).find((item) => item.id === current.serviceId);
    if (!service) {
      return { success: false, error: 'El servicio de esa cita ya no está disponible.', instruction: 'No muevas la cita.' };
    }
    const slot = this.resolveSlot(runtime, service, args.start);
    if (!slot.ok) return this.slotFailure(slot);
    const mode = this.mutationMode(context.origin, runtime);
    if (mode === 'blocked') {
      return { success: false, error: 'Este canal no puede modificar la agenda.', instruction: 'No confirmes el cambio.' };
    }
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

    const moved = await rescheduleAppointmentRecord({
      appointmentsStore: this.appointmentsStore,
      clientId: runtime.clientId,
      appointmentId,
      service,
      start: slot.start,
      end: slot.end,
      googleBusy: [],
      rules: runtime.rules
    });
    if (!moved.ok) {
      if (moved.code === 'slot_full') return this.slotFullResult(runtime, service, slot, appointmentId);
      if (moved.code === 'not_found') {
        return { success: false, error: 'No encontré esa cita.', instruction: 'No confirmes un cambio.' };
      }
      return { success: false, error: 'No se pudo reprogramar.', code: moved.code, instruction: 'No digas que la cita se movió.' };
    }
    const synced = await this.syncAfterWrite(runtime, moved.appointment, service);
    return {
      success: true,
      appointmentId,
      eventId: synced.ok ? (synced.eventId || moved.appointment.eventId || '') : (moved.appointment.eventId || ''),
      syncPending: !synced.ok,
      service: brief(service),
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      label: formatSlotLabel(slot.start, slot.end, runtime.timezone),
      instruction: 'La cita quedó movida. Confirma solo este horario.'
    };
  }

  async cancelAppointment(runtime, args, context) {
    if (!runtime.rules.allowCancel) {
      return { success: false, error: 'Este bot no permite cancelar citas.', instruction: 'No canceles la cita.' };
    }
    const appointmentId = typeof args.appointmentId === 'string' ? args.appointmentId.trim() : '';
    const current = appointmentId ? await this.appointmentsStore.get(runtime.clientId, appointmentId) : null;
    if (!current || current.status !== 'confirmed' || !this.ownsAppointment(current, context)) {
      return { success: false, error: 'No encontré esa cita.', instruction: 'No confirmes la cancelación.' };
    }
    const mode = this.mutationMode(context.origin, runtime);
    if (mode === 'blocked') {
      return { success: false, error: 'Este canal no puede modificar la agenda.', instruction: 'No confirmes la cancelación.' };
    }
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
    const service = (runtime.services || []).find((item) => item.id === current.serviceId) || null;
    const synced = await this.syncAfterWrite(runtime, cancelled.appointment, service);
    return {
      success: true,
      appointmentId,
      syncPending: !synced.ok,
      instruction: 'La cita quedó cancelada. Confirma solo eso.'
    };
  }
}

module.exports = { AgendaService };
