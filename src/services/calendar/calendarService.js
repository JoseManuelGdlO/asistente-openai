const crypto = require('crypto');
const { encryptCredentialsPayload, decryptCredentialsPayload } = require('../../utils/credentialsCrypto');
const {
  HOLD_MS,
  LIVE_ORIGINS,
  DEFAULT_TIMEZONE
} = require('./constants');
const { signState, verifyState, stateSecret } = require('./oauthState');
const { describePhase, normalizeAgenda } = require('./readiness');
const { isCalendarTool, toolDefinitions, mergeTools, buildInstructions } = require('./tools');
const {
  localDate,
  addDays,
  parseLocalDateTime,
  hasExplicitZone,
  rollPastDate,
  fitsHours,
  rangesOverlap,
  generateSlots,
  formatSlotLabel,
  formatLocal
} = require('./time');

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanPhone(userId) {
  return String(userId || '').replace(/@.+$/, '').trim();
}

function pruneBusy(busy, nowMs) {
  return (Array.isArray(busy) ? busy : []).filter((item) => {
    if (!item || item.status === 'cancelled') return false;
    if (item.status === 'pending' && Number(item.expiresAt) < nowMs) return false;
    const end = Date.parse(item.end);
    if (Number.isFinite(end) && end < nowMs - 86400000) return false;
    return item.status === 'confirmed' || item.status === 'pending';
  });
}

function localBusyMs(busy, excludeId, nowMs) {
  return pruneBusy(busy, nowMs)
    .filter((item) => item.id !== excludeId)
    .map((item) => ({ start: Date.parse(item.start), end: Date.parse(item.end) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end));
}

function googleBusyMs(raw, own) {
  const ownStart = own ? Date.parse(own.start) : NaN;
  const ownEnd = own ? Date.parse(own.end) : NaN;
  return (raw || []).map((item) => ({
    start: Date.parse(item.start),
    end: Date.parse(item.end)
  })).filter((item) => {
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end)) return false;
    if (Number.isFinite(ownStart) && item.start === ownStart && item.end === ownEnd) return false;
    return true;
  });
}

class CalendarService {
  constructor({ store, google, now = () => new Date(), env = process.env, tokenOverride = '' }) {
    this.store = store;
    this.google = google;
    this.now = now;
    this.env = env;
    this.tokenOverride = tokenOverride;
  }

  toolDefinitions() {
    return toolDefinitions();
  }

  mergeTools(storedTools, calendarTools) {
    return mergeTools(storedTools, calendarTools);
  }

  isCalendarTool(name) {
    return isCalendarTool(name);
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
      rules: doc.rules,
      playgroundWriteEnabled: doc.playgroundWriteEnabled === true
    };
  }

  async getPanel(clientId) {
    return this.toPanel(await this.store.getRaw(clientId));
  }

  async loadRuntime(clientId) {
    const doc = await this.store.getRaw(clientId);
    const phase = describePhase(doc);
    return {
      clientId,
      ready: phase.ready,
      phase: phase.phase,
      phaseLabel: phase.label,
      hours: doc.hours,
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
    const saved = await this.store.transaction(clientId, (doc) => ({
      ...doc,
      enabled: Boolean(enabled)
    }));
    return this.toPanel(saved);
  }

  async saveAgenda(clientId, input) {
    const parsed = normalizeAgenda(input);
    if (!parsed.ok) throw httpError(parsed.error, 400);
    const saved = await this.store.transaction(clientId, (doc) => ({
      ...doc,
      hours: parsed.value.hours,
      services: parsed.value.services,
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
    const saved = await this.store.transaction(clientId, (doc) => {
      if (doc.connection?.status !== 'connected') {
        const error = httpError('Conecta Google Calendar antes de elegir un calendario.', 409);
        throw error;
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
    const saved = await this.store.transaction(clientId, (doc) => ({
      ...doc,
      playgroundWriteEnabled: Boolean(enabled)
    }));
    return this.toPanel(saved);
  }

  async disconnect(clientId) {
    const current = await this.store.getRaw(clientId);
    if (current.encryptedTokens && typeof this.google?.revoke === 'function') {
      try {
        const tokens = decryptCredentialsPayload(current.encryptedTokens);
        if (tokens?.refreshToken) await this.google.revoke(tokens.refreshToken);
      } catch (_error) {
        // La desconexión local sigue aunque Google no responda.
      }
    }
    const saved = await this.store.transaction(clientId, (doc) => ({
      ...doc,
      encryptedTokens: null,
      oauthNonce: null,
      oauthNonceExpiresAt: null,
      busy: [],
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
    return this.toPanel(saved);
  }

  async beginOAuth(clientId, redirectUri) {
    if (!this.google?.configured?.()) {
      throw httpError(
        'Falta configurar GOOGLE_CALENDAR_CLIENT_ID y GOOGLE_CALENDAR_CLIENT_SECRET en el servidor.',
        503
      );
    }
    const secret = stateSecret(this.env);
    if (!secret) throw httpError('Falta ADMIN_API_TOKEN para firmar la conexión con Google.', 503);
    const nonce = crypto.randomBytes(16).toString('hex');
    const exp = this.now().getTime() + (10 * 60 * 1000);
    await this.store.transaction(clientId, (doc) => ({
      ...doc,
      oauthNonce: nonce,
      oauthNonceExpiresAt: exp
    }));
    const state = signState({ clientId, nonce, exp }, secret);
    return { url: this.google.authorizationUrl({ redirectUri, state }) };
  }

  async completeOAuth(code, state, redirectUri) {
    const payload = verifyState(state, stateSecret(this.env), this.now().getTime());
    if (!payload) throw httpError('La autorización venció o no es válida. Vuelve a conectar.', 400);
    const current = await this.store.getRaw(payload.clientId);
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
    await this.store.transaction(payload.clientId, (doc) => ({
      ...doc,
      oauthNonce: null,
      oauthNonceExpiresAt: null,
      encryptedTokens,
      connection: {
        ...doc.connection,
        status: 'connected',
        email: email || doc.connection.email,
        calendarId: primary?.id || '',
        calendarSummary: primary?.summary || '',
        timezone: primary?.timeZone || doc.connection.timezone || DEFAULT_TIMEZONE,
        connectedAt: this.now().toISOString(),
        lastError: ''
      }
    }));
    return { clientId: payload.clientId };
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
    const doc = await this.store.getRaw(clientId);
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
      await this.store.transaction(clientId, (current) => ({
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
    await this.store.transaction(clientId, (doc) => ({
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
    if (origin === 'playground') return runtime.playgroundWriteEnabled ? 'live' : 'dry';
    return 'blocked';
  }

  async suggest(doc, runtime, service, fromDate, toDate, excludeId) {
    const from = parseLocalDateTime(`${fromDate}T00:00`, runtime.timezone);
    const to = parseLocalDateTime(`${addDays(toDate, 1)}T00:00`, runtime.timezone);
    let remote = [];
    try {
      const token = await this.ensureAccessToken(runtime.clientId);
      const own = (doc.busy || []).find((item) => item.id === excludeId);
      const raw = await this.google.freeBusy(token, {
        calendarId: runtime.calendarId,
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        timeZone: runtime.timezone
      });
      remote = googleBusyMs(raw, own);
    } catch (error) {
      if (error.code === 'revoked') {
        await this.markRevoked(runtime.clientId, error.message);
        return { revoked: true, slots: [] };
      }
      throw error;
    }
    const local = localBusyMs(doc.busy, excludeId, this.now().getTime());
    const busy = remote.concat(local);
    return {
      revoked: false,
      slots: generateSlots({
        now: this.now(),
        timeZone: runtime.timezone,
        hours: runtime.hours,
        durationMinutes: service.durationMinutes,
        rules: runtime.rules,
        fromDate,
        toDate,
        busy,
        limit: 6
      })
    };
  }

  slotConflict(doc, start, end, excludeId) {
    const bufferMs = (doc.rules?.bufferMinutes || 0) * 60000;
    return pruneBusy(doc.busy, this.now().getTime())
      .filter((item) => item.id !== excludeId)
      .some((item) => rangesOverlap(start.getTime(), end.getTime(), Date.parse(item.start), Date.parse(item.end), bufferMs));
  }

  async execute(name, args, context = {}) {
    const clientId = context.clientId;
    const runtime = await this.loadRuntime(clientId);
    if (!runtime.ready) {
      return {
        success: false,
        error: 'La agenda de este bot no está disponible.',
        phase: runtime.phase,
        instruction: 'No ofrezcas horarios ni confirmes una cita. Di que ahora no es posible agendar, sin inventar disponibilidad.'
      };
    }
    if (name === 'listBookingServices') return this.listServices(runtime);
    if (name === 'getAvailableSlots') return this.getAvailableSlots(runtime, args || {});
    if (name === 'createAppointment') return this.createAppointment(runtime, args || {}, context);
    if (name === 'rescheduleAppointment') return this.rescheduleAppointment(runtime, args || {}, context);
    if (name === 'cancelAppointment') return this.cancelAppointment(runtime, args || {}, context);
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
    const doc = await this.store.getRaw(runtime.clientId);
    const today = localDate(this.now(), runtime.timezone);
    const preferredText = typeof args.preferredStart === 'string' ? args.preferredStart.trim() : '';
    if (preferredText && !parseLocalDateTime(preferredText, runtime.timezone)) {
      return {
        success: false,
        error: 'Usa YYYY-MM-DDTHH:mm en la zona del calendario. Copia startLocal del horario ofrecido.',
        instruction: hasExplicitZone(preferredText)
          ? 'No envíes una hora con Z ni con desfase. Vuelve a consultar copiando startLocal.'
          : 'El horario debe ir como YYYY-MM-DDTHH:mm. Copia startLocal del horario ofrecido.'
      };
    }
    let preferred = preferredText ? parseLocalDateTime(preferredText, runtime.timezone) : null;
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
    const fromDate = requestedDate || today;
    const toDate = requestedDate || (addDays(today, 7) < horizon ? addDays(today, 7) : horizon);
    const suggestion = await this.suggest(doc, runtime, service, fromDate, toDate, null);
    if (suggestion.revoked) {
      return {
        success: false,
        error: 'La autorización de Google venció o fue revocada.',
        phase: 'revoked',
        instruction: 'No inventes horarios. Pide que se vuelva a conectar Google Calendar.'
      };
    }
    let exact = null;
    if (preferred) {
      const wanted = formatLocal(preferred, runtime.timezone);
      exact = suggestion.slots.find((slot) => slot.startLocal === wanted) || null;
    }
    const slots = exact
      ? [exact].concat(suggestion.slots.filter((slot) => slot.start !== exact.start)).slice(0, 6)
      : suggestion.slots;
    let instruction = exact
      ? `Ese horario está libre. Hoy es ${today}. Pide confirmación antes de reservar.`
      : `Hoy es ${today}. El año es ${today.slice(0, 4)}. Ofrece solo los horarios devueltos. No menciones otro año.`;
    if (correctedFrom) {
      const found = slots.length
        ? `Ofrece solo los horarios del ${requestedDate}.`
        : `El ${requestedDate} no tiene horarios. No digas que no hay disponibilidad en general.`;
      instruction = `La fecha ${correctedFrom} ya pasó. Hoy es ${today}. El año es ${today.slice(0, 4)}. Busqué ${requestedDate}. ${found} No digas ${correctedFrom.slice(0, 4)}.`;
    }
    return {
      success: true,
      service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes },
      timezone: runtime.timezone,
      today,
      correctedFrom,
      exact: Boolean(exact),
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
    if (!slot.ok) return { success: false, error: slot.error, instruction: 'No confirmes ese horario. Ofrece alternativas reales.' };
    const mode = this.mutationMode(context.origin, runtime);
    if (mode === 'blocked') {
      return { success: false, error: 'Este canal no puede modificar la agenda.', instruction: 'No confirmes la cita.' };
    }
    const doc = await this.store.getRaw(runtime.clientId);
    if (this.slotConflict(doc, slot.start, slot.end, null)) {
      const alternatives = await this.suggest(doc, runtime, service, localDate(slot.start, runtime.timezone), localDate(slot.start, runtime.timezone), null);
      return {
        success: false,
        error: 'Ese horario ya está ocupado.',
        slots: alternatives.slots || [],
        instruction: 'No confirmes la cita. Ofrece solo los horarios alternativos.'
      };
    }
    const notes = typeof args.notes === 'string' ? args.notes.trim() : '';
    if (mode === 'dry') {
      const remotePeek = await this.remoteConflict(runtime, slot.start, slot.end, null);
      if (remotePeek.revoked) {
        return {
          success: false,
          error: 'La autorización de Google venció o fue revocada.',
          phase: 'revoked',
          instruction: 'No confirmes la cita.'
        };
      }
      if (remotePeek.conflict) {
        const alternatives = await this.suggest(doc, runtime, service, localDate(slot.start, runtime.timezone), localDate(slot.start, runtime.timezone), null);
        return {
          success: false,
          error: 'Ese horario ya está ocupado en Google Calendar.',
          slots: alternatives.slots || [],
          instruction: 'No confirmes la cita. Ofrece solo los horarios alternativos.'
        };
      }
      return {
        success: false,
        dryRun: true,
        testMode: true,
        service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes },
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        label: formatSlotLabel(slot.start, slot.end, runtime.timezone),
        customerName,
        instruction: 'Modo de prueba sin escritura. No digas que la cita quedó agendada. Explica que hace falta activar la escritura de prueba para crear el evento real.'
      };
    }
    const appointmentId = `apt_${crypto.randomBytes(8).toString('hex')}`;
    const held = await this.hold(runtime.clientId, {
      id: appointmentId,
      start: slot.start,
      end: slot.end,
      serviceId: service.id,
      customerName
    }, null);
    if (!held.ok) {
      return { success: false, error: 'Ese horario acaba de ocuparse.', instruction: 'No confirmes la cita. Consulta disponibilidad de nuevo.' };
    }
    try {
      const remote = await this.remoteConflict(runtime, slot.start, slot.end, null);
      if (remote.revoked) {
        await this.release(runtime.clientId, appointmentId);
        return { success: false, error: 'La autorización de Google venció o fue revocada.', phase: 'revoked', instruction: 'No confirmes la cita.' };
      }
      if (remote.conflict) {
        await this.release(runtime.clientId, appointmentId);
        const alternatives = await this.suggest(held.doc, runtime, service, localDate(slot.start, runtime.timezone), localDate(slot.start, runtime.timezone), appointmentId);
        return { success: false, error: 'Ese horario ya está ocupado en Google Calendar.', slots: alternatives.slots || [], instruction: 'No confirmes la cita. Ofrece solo los horarios alternativos.' };
      }
      const token = await this.ensureAccessToken(runtime.clientId);
      const created = await this.google.createEvent(token, runtime.calendarId, this.eventBody({
        service,
        start: slot.start,
        end: slot.end,
        timeZone: runtime.timezone,
        customerName,
        notes,
        clientId: runtime.clientId,
        appointmentId,
        phone: cleanPhone(context.userId)
      }));
      await this.confirmHold(runtime.clientId, appointmentId, created.id || '');
      return {
        success: true,
        appointmentId,
        eventId: created.id || '',
        htmlLink: created.htmlLink || '',
        service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes },
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        label: formatSlotLabel(slot.start, slot.end, runtime.timezone),
        customerName,
        instruction: 'La cita ya existe en Google Calendar. Confirma solo estos datos.'
      };
    } catch (error) {
      await this.release(runtime.clientId, appointmentId);
      if (error.code === 'revoked') await this.markRevoked(runtime.clientId, error.message);
      return {
        success: false,
        error: error.message || 'No se pudo crear la cita.',
        instruction: 'No digas que la cita quedó agendada.'
      };
    }
  }

  async rescheduleAppointment(runtime, args, context) {
    if (!runtime.rules.allowReschedule) {
      return { success: false, error: 'Este bot no permite reprogramar citas.', instruction: 'No muevas la cita.' };
    }
    const appointmentId = typeof args.appointmentId === 'string' ? args.appointmentId.trim() : '';
    const doc = await this.store.getRaw(runtime.clientId);
    const current = (doc.busy || []).find((item) => item.id === appointmentId && item.status === 'confirmed');
    if (!current) return { success: false, error: 'No encontré esa cita.', instruction: 'No confirmes un cambio.' };
    const service = this.serviceById(runtime, current.serviceId) || (runtime.services || []).find((item) => item.id === current.serviceId);
    if (!service) return { success: false, error: 'El servicio de esa cita ya no está disponible.', instruction: 'No muevas la cita.' };
    const slot = this.resolveSlot(runtime, service, args.start);
    if (!slot.ok) return { success: false, error: slot.error, instruction: 'No confirmes ese horario.' };
    const mode = this.mutationMode(context.origin, runtime);
    if (mode === 'blocked') return { success: false, error: 'Este canal no puede modificar la agenda.', instruction: 'No confirmes el cambio.' };
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
    const moved = await this.moveHold(runtime.clientId, appointmentId, slot.start, slot.end);
    if (!moved.ok) return { success: false, error: moved.error, instruction: 'No confirmes el cambio.' };
    try {
      const remote = await this.remoteConflict(runtime, slot.start, slot.end, current);
      if (remote.conflict || remote.revoked) {
        await this.restoreHold(runtime.clientId, appointmentId);
        return {
          success: false,
          error: remote.revoked ? 'La autorización de Google venció o fue revocada.' : 'Ese horario ya está ocupado.',
          instruction: 'No confirmes la reprogramación.'
        };
      }
      const token = await this.ensureAccessToken(runtime.clientId);
      const updated = await this.google.updateEvent(token, runtime.calendarId, current.eventId, {
        start: { dateTime: slot.start.toISOString(), timeZone: runtime.timezone },
        end: { dateTime: slot.end.toISOString(), timeZone: runtime.timezone }
      });
      await this.confirmHold(runtime.clientId, appointmentId, updated.id || current.eventId);
      return {
        success: true,
        appointmentId,
        eventId: updated.id || current.eventId,
        label: formatSlotLabel(slot.start, slot.end, runtime.timezone),
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        instruction: 'La cita ya quedó movida en Google Calendar. Confirma solo este horario.'
      };
    } catch (error) {
      await this.restoreHold(runtime.clientId, appointmentId);
      return { success: false, error: error.message || 'No se pudo reprogramar.', instruction: 'No digas que la cita se movió.' };
    }
  }

  async cancelAppointment(runtime, args, context) {
    if (!runtime.rules.allowCancel) {
      return { success: false, error: 'Este bot no permite cancelar citas.', instruction: 'No canceles la cita.' };
    }
    const appointmentId = typeof args.appointmentId === 'string' ? args.appointmentId.trim() : '';
    const doc = await this.store.getRaw(runtime.clientId);
    const current = (doc.busy || []).find((item) => item.id === appointmentId && item.status === 'confirmed');
    if (!current) return { success: false, error: 'No encontré esa cita.', instruction: 'No confirmes la cancelación.' };
    const mode = this.mutationMode(context.origin, runtime);
    if (mode === 'blocked') return { success: false, error: 'Este canal no puede modificar la agenda.', instruction: 'No confirmes la cancelación.' };
    if (mode === 'dry') {
      return {
        success: false,
        dryRun: true,
        testMode: true,
        appointmentId,
        instruction: 'Modo de prueba sin escritura. No digas que la cita quedó cancelada.'
      };
    }
    try {
      const token = await this.ensureAccessToken(runtime.clientId);
      if (current.eventId) await this.google.deleteEvent(token, runtime.calendarId, current.eventId);
      await this.release(runtime.clientId, appointmentId);
      return {
        success: true,
        appointmentId,
        instruction: 'La cita ya se canceló en Google Calendar. Confirma solo eso.'
      };
    } catch (error) {
      if (error.code === 'revoked') await this.markRevoked(runtime.clientId, error.message);
      return { success: false, error: error.message || 'No se pudo cancelar.', instruction: 'No digas que la cita quedó cancelada.' };
    }
  }

  resolveSlot(runtime, service, startValue) {
    const text = typeof startValue === 'string' ? startValue.trim() : '';
    if (!/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.test(text)) {
      return {
        ok: false,
        error: hasExplicitZone(text)
          ? 'Usa YYYY-MM-DDTHH:mm en la zona del calendario. Copia startLocal del horario ofrecido.'
          : 'El horario debe ir como YYYY-MM-DDTHH:mm.'
      };
    }
    const start = parseLocalDateTime(text, runtime.timezone);
    if (!start) return { ok: false, error: 'El horario debe ir como YYYY-MM-DDTHH:mm.' };
    const end = new Date(start.getTime() + service.durationMinutes * 60000);
    const now = this.now().getTime();
    if (start.getTime() < now + (runtime.rules.minNoticeMinutes * 60000)) {
      return { ok: false, error: 'Ese horario no cumple la anticipación mínima.' };
    }
    if (start.getTime() > now + (runtime.rules.maxDaysAhead * 86400000)) {
      return { ok: false, error: 'Ese horario supera el máximo de días a futuro.' };
    }
    if (!fitsHours(start, end, runtime.hours, runtime.timezone)) {
      return { ok: false, error: 'Ese horario está fuera del horario de atención.' };
    }
    return { ok: true, start, end };
  }

  async remoteConflict(runtime, start, end, own) {
    try {
      const token = await this.ensureAccessToken(runtime.clientId);
      const raw = await this.google.freeBusy(token, {
        calendarId: runtime.calendarId,
        timeMin: new Date(start.getTime() - 60000).toISOString(),
        timeMax: new Date(end.getTime() + (runtime.rules.bufferMinutes * 60000) + 60000).toISOString(),
        timeZone: runtime.timezone
      });
      const bufferMs = runtime.rules.bufferMinutes * 60000;
      const conflict = googleBusyMs(raw, own).some((item) => rangesOverlap(start.getTime(), end.getTime(), item.start, item.end, bufferMs));
      return { conflict, revoked: false };
    } catch (error) {
      if (error.code === 'revoked') {
        await this.markRevoked(runtime.clientId, error.message);
        return { conflict: false, revoked: true };
      }
      throw error;
    }
  }

  eventBody({ service, start, end, timeZone, customerName, notes, clientId, appointmentId, phone }) {
    return {
      summary: `${service.name} · ${customerName}`,
      description: [
        'Cita creada por Intelekia.',
        `Servicio: ${service.name} (${service.durationMinutes} min)`,
        `Cliente: ${customerName}`,
        phone ? `WhatsApp: ${phone}` : '',
        notes ? `Notas: ${notes}` : ''
      ].filter(Boolean).join('\n'),
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
      extendedProperties: {
        private: {
          intelekiaClientId: String(clientId),
          appointmentId: String(appointmentId),
          serviceId: String(service.id)
        }
      }
    };
  }

  async hold(clientId, slot, excludeId) {
    const nowMs = this.now().getTime();
    const saved = await this.store.transaction(clientId, (doc) => {
      const busy = pruneBusy(doc.busy, nowMs).filter((item) => item.id !== excludeId);
      const bufferMs = (doc.rules?.bufferMinutes || 0) * 60000;
      const hit = busy.some((item) => rangesOverlap(
        slot.start.getTime(),
        slot.end.getTime(),
        Date.parse(item.start),
        Date.parse(item.end),
        bufferMs
      ));
      if (hit) return { ...doc, busy };
      busy.push({
        id: slot.id,
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        status: 'pending',
        eventId: '',
        serviceId: slot.serviceId,
        customerName: slot.customerName || '',
        expiresAt: nowMs + HOLD_MS
      });
      return { ...doc, busy };
    });
    const item = (saved.busy || []).find((entry) => entry.id === slot.id && entry.status === 'pending');
    return { ok: Boolean(item), doc: saved };
  }

  async moveHold(clientId, appointmentId, start, end) {
    const nowMs = this.now().getTime();
    const startIso = start.toISOString();
    const saved = await this.store.transaction(clientId, (doc) => {
      const busy = pruneBusy(doc.busy, nowMs);
      const index = busy.findIndex((item) => item.id === appointmentId && item.status === 'confirmed');
      if (index < 0) return { ...doc, busy };
      const bufferMs = (doc.rules?.bufferMinutes || 0) * 60000;
      const others = busy.filter((item) => item.id !== appointmentId);
      const hit = others.some((item) => rangesOverlap(start.getTime(), end.getTime(), Date.parse(item.start), Date.parse(item.end), bufferMs));
      if (hit) return { ...doc, busy };
      const current = busy[index];
      busy[index] = {
        ...current,
        start: startIso,
        end: end.toISOString(),
        status: 'pending',
        expiresAt: nowMs + HOLD_MS,
        previousStart: current.start,
        previousEnd: current.end
      };
      return { ...doc, busy };
    });
    const item = (saved.busy || []).find((entry) => entry.id === appointmentId);
    if (!item) return { ok: false, error: 'No encontré esa cita.' };
    if (item.status !== 'pending' || item.start !== startIso) {
      return { ok: false, error: 'Ese horario acaba de ocuparse.' };
    }
    return { ok: true };
  }

  async confirmHold(clientId, appointmentId, eventId) {
    await this.store.transaction(clientId, (doc) => ({
      ...doc,
      busy: (doc.busy || []).map((item) => {
        if (item.id !== appointmentId) return item;
        return {
          ...item,
          status: 'confirmed',
          eventId: eventId || item.eventId || '',
          expiresAt: null,
          previousStart: null,
          previousEnd: null
        };
      })
    }));
  }

  async restoreHold(clientId, appointmentId) {
    await this.store.transaction(clientId, (doc) => ({
      ...doc,
      busy: (doc.busy || []).map((item) => {
        if (item.id !== appointmentId || !item.previousStart) return item;
        return {
          ...item,
          start: item.previousStart,
          end: item.previousEnd,
          status: 'confirmed',
          expiresAt: null,
          previousStart: null,
          previousEnd: null
        };
      })
    }));
  }

  async release(clientId, appointmentId) {
    await this.store.transaction(clientId, (doc) => ({
      ...doc,
      busy: (doc.busy || []).filter((item) => item.id !== appointmentId)
    }));
  }
}

module.exports = {
  CalendarService
};
