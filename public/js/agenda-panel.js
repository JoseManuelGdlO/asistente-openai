(function () {
  const DAYS = [
    ['monday', 'Lunes'], ['tuesday', 'Martes'], ['wednesday', 'Miércoles'],
    ['thursday', 'Jueves'], ['friday', 'Viernes'], ['saturday', 'Sábado'], ['sunday', 'Domingo']
  ];
  const TIMEZONES = [
    'America/Mexico_City', 'America/Cancun', 'America/Tijuana', 'America/Hermosillo',
    'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires',
    'America/Sao_Paulo', 'Europe/Madrid', 'UTC'
  ];
  const PHASE_BADGES = {
    ready: 'badge-ok',
    disabled: 'badge-muted',
    incomplete: 'badge-warn',
    disconnected: 'badge-warn',
    revoked: 'badge-off',
    error: 'badge-off'
  };
  const MISSING_LABELS = {
    connection: 'Conectar Google Calendar',
    calendar: 'Elegir un calendario',
    hours: 'Definir al menos un día con horario',
    services: 'Agregar al menos un servicio activo'
  };

  function mount(container, options) {
    const {
      clientId, canEdit, api, escapeHtml, onState, onError, inviteUrl: initialInviteUrl, onInviteUrl
    } = options;
    const dis = canEdit ? '' : 'disabled';
    let state = null;
    let inviteUrl = initialInviteUrl || '';
    let calendars = null;
    let busy = false;
    let destroyed = false;
    let previewWeekStart = '';
    let previewServiceId = '';

    const path = (suffix = '') => `/clients/${encodeURIComponent(clientId)}/configuracion/agenda${suffix}`;
    const WEEKDAY_SHORT = {
      monday: 'Lun', tuesday: 'Mar', wednesday: 'Mié', thursday: 'Jue',
      friday: 'Vie', saturday: 'Sáb', sunday: 'Dom'
    };

    function previewRangeLabel(preview) {
      if (!preview?.weekStart || !preview?.weekEnd) return '';
      const a = preview.weekStart.slice(8, 10);
      const b = preview.weekEnd.slice(8, 10);
      const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
      const m1 = months[Number(preview.weekStart.slice(5, 7)) - 1] || '';
      const m2 = months[Number(preview.weekEnd.slice(5, 7)) - 1] || '';
      const year = preview.weekEnd.slice(0, 4);
      if (m1 === m2) return `${Number(a)}–${Number(b)} ${m1} ${year}`;
      return `${Number(a)} ${m1} – ${Number(b)} ${m2} ${year}`;
    }

    function buildPreviewHtml(preview) {
      const days = preview.days || [];
      const lanes = Math.max(1, Math.min(12, Number(preview.appointmentsPerBlock) || Number(preview.calendarColumns) || 1));
      let anyOpen = false;
      for (const day of days) {
        if ((day.intervals || []).length) {
          anyOpen = true;
          break;
        }
      }

      const aptsByDate = {};
      for (const apt of preview.appointments || []) {
        const date = String(apt.startLocal || '').slice(0, 10);
        if (!date) continue;
        if (!aptsByDate[date]) aptsByDate[date] = [];
        aptsByDate[date].push(apt);
      }
      const googleByDate = {};
      for (const event of preview.googleEvents || []) {
        const date = String(event.startLocal || '').slice(0, 10);
        if (!date) continue;
        if (!googleByDate[date]) googleByDate[date] = [];
        googleByDate[date].push(event);
      }
      const slotsByDate = {};
      for (const slot of preview.blocks || []) {
        const date = String(slot.date || slot.startLocal || '').slice(0, 10);
        if (!date) continue;
        if (!slotsByDate[date]) slotsByDate[date] = [];
        slotsByDate[date].push(slot);
      }

      const dayColumns = days.map((day) => {
        const blocks = (slotsByDate[day.date] || []).slice().sort((a, b) => (
          String(a.startLocal).localeCompare(String(b.startLocal))
        ));
        const dayApts = aptsByDate[day.date] || [];
        const dayGoogle = googleByDate[day.date] || [];
        const laneCols = [];
        for (let lane = 0; lane < lanes; lane += 1) {
          const cells = blocks.map((block) => {
            const startHm = String(block.startLocal || '').slice(11, 16);
            const aptEndHm = (apt) => String(apt.endLocal || block.endLocal || '').slice(11, 16);
            // Anclar cada cita solo a la fila de su inicio.
            const inBlock = dayApts
              .filter((apt) => String(apt.start || '') === String(block.start || '')
                || String(apt.startLocal || '').slice(0, 16) === String(block.startLocal || '').slice(0, 16))
              .sort((a, b) => (
                String(a.start).localeCompare(String(b.start))
                || String(a.id || '').localeCompare(String(b.id || ''))
              ));
            const apt = inBlock[lane] || null;
            if (apt) {
              const label = [apt.customerName, apt.serviceName].filter(Boolean).join(' · ') || 'Cita';
              const endHm = aptEndHm(apt);
              const title = `${startHm}–${endHm} · ${label}${apt.sync ? ` · sync: ${apt.sync}` : ''}`;
              return `<div class="agenda-preview-cell is-booked" title="${escapeHtml(title)}">
                <strong>${escapeHtml(startHm)}</strong>
                <span>${escapeHtml(label)}</span>
              </div>`;
            }
            if (block.bookable === false) {
              return `<div class="agenda-preview-cell is-past" title="${escapeHtml(startHm)} · fuera de reserva">
                <strong>${escapeHtml(startHm)}</strong>
                <span>—</span>
              </div>`;
            }
            const kind = block.full ? 'is-full' : 'is-free';
            const title = `${startHm} · cupo ${lane + 1}/${lanes}${block.full ? ' (lleno)' : ' libre'}`;
            return `<div class="agenda-preview-cell ${kind}" title="${escapeHtml(title)}">
              <strong>${escapeHtml(startHm)}</strong>
              <span>${block.full ? 'Lleno' : 'Libre'}</span>
            </div>`;
          }).join('');
          laneCols.push(`
            <div class="agenda-preview-lane">
              <div class="agenda-preview-lane-head">Cupo ${lane + 1}</div>
              <div class="agenda-preview-lane-body">
                ${cells || '<p class="muted agenda-preview-empty">Sin bloques</p>'}
              </div>
            </div>
          `);
        }
        const googleBits = dayGoogle.map((event) => {
          const startHm = String(event.startLocal || '').slice(11, 16);
          const endHm = String(event.endLocal || '').slice(11, 16);
          const label = event.summary || 'Google';
          return `<div class="agenda-preview-google-chip" title="${escapeHtml(`${startHm}–${endHm} · ${label}`)}">${escapeHtml(startHm)} ${escapeHtml(label)}</div>`;
        }).join('');
        const head = `${WEEKDAY_SHORT[day.weekday] || day.weekday} ${Number(String(day.date).slice(8, 10))}`;
        return `
          <div class="agenda-preview-day ${day.closed ? 'is-closed' : ''}">
            <div class="agenda-preview-day-head" title="${escapeHtml(day.label || '')}">${escapeHtml(head)}</div>
            <div class="agenda-preview-lanes" style="grid-template-columns: repeat(${lanes}, minmax(0, 1fr))">
              ${laneCols.join('')}
            </div>
            ${googleBits ? `<div class="agenda-preview-google-row">${googleBits}</div>` : ''}
          </div>
        `;
      }).join('');

      const google = preview.google || {};
      let googleNote = '';
      if (!google.connected) {
        googleNote = '<p class="muted">Conecta Google Calendar para ver también esos eventos en la vista previa.</p>';
      } else if (!google.ok) {
        googleNote = `<p class="calendar-warning">No se pudieron leer eventos de Google${google.error ? `: ${escapeHtml(google.error)}` : ''}.</p>`;
      }

      const services = preview.services || [];
      const serviceOptions = services.map((service) => `
        <option value="${escapeHtml(service.id)}" ${service.id === preview.serviceId ? 'selected' : ''}>
          ${escapeHtml(service.name)} (${escapeHtml(String(service.durationMinutes))} min)
        </option>
      `).join('');
      const servicePicker = services.length
        ? `<label class="agenda-preview-service">Servicio
            <select data-preview-service>${serviceOptions}</select>
          </label>`
        : '<p class="muted">Agrega un servicio activo para ver los bloques.</p>';
      const durationNote = preview.durationMinutes
        ? `<p class="muted">Columnas = citas simultáneas (${escapeHtml(String(lanes))}). Filas cada ${escapeHtml(String(preview.slotIntervalMinutes || 30))} min hasta el cierre. Reserva hasta donde quepa el servicio (${escapeHtml(String(preview.durationMinutes))} min).</p>`
        : '';

      return `
        <div class="agenda-preview-toolbar">
          <button type="button" class="btn-sm btn-secondary" data-preview-nav="-7">←</button>
          <strong>${escapeHtml(previewRangeLabel(preview))}</strong>
          <button type="button" class="btn-sm btn-secondary" data-preview-nav="7">→</button>
          <button type="button" class="btn-sm btn-secondary" data-preview-nav="today">Hoy</button>
          ${servicePicker}
        </div>
        ${durationNote}
        <div class="agenda-preview-legend muted">
          <span><i class="agenda-preview-swatch slot-free"></i> Libre</span>
          <span><i class="agenda-preview-swatch apt"></i> Cita</span>
          <span><i class="agenda-preview-swatch slot-full"></i> Lleno</span>
          <span><i class="agenda-preview-swatch google"></i> Google</span>
        </div>
        ${googleNote}
        ${anyOpen ? '' : '<p class="muted">Esta semana no tiene horarios de atención abiertos.</p>'}
        <div class="agenda-preview-scroll">
          <div class="agenda-preview-week">
            ${dayColumns}
          </div>
        </div>
      `;
    }

    async function refreshPreview(weekStart, serviceId) {
      if (destroyed) return;
      const root = container.querySelector('[data-agenda-preview]');
      if (!root) return;
      root.innerHTML = '<p class="muted">Cargando vista previa…</p>';
      try {
        const params = new URLSearchParams();
        if (weekStart) params.set('weekStart', weekStart);
        const sid = serviceId !== undefined ? serviceId : previewServiceId;
        if (sid) params.set('serviceId', sid);
        const query = params.toString() ? `?${params.toString()}` : '';
        const res = await api(`${path('/preview')}${query}`);
        if (destroyed) return;
        const preview = res.preview;
        previewWeekStart = preview.weekStart || weekStart || '';
        previewServiceId = preview.serviceId || sid || '';
        root.innerHTML = buildPreviewHtml(preview);
        root.querySelectorAll('[data-preview-nav]').forEach((button) => {
          button.addEventListener('click', () => {
            const action = button.getAttribute('data-preview-nav');
            if (action === 'today') {
              previewWeekStart = '';
              refreshPreview('', previewServiceId).catch(fail);
              return;
            }
            const delta = Number(action);
            if (!Number.isFinite(delta) || !previewWeekStart) {
              refreshPreview(previewWeekStart, previewServiceId).catch(fail);
              return;
            }
            const [y, m, d] = previewWeekStart.split('-').map(Number);
            const next = new Date(Date.UTC(y, m - 1, d + delta));
            const nextStart = next.toISOString().slice(0, 10);
            refreshPreview(nextStart, previewServiceId).catch(fail);
          });
        });
        root.querySelector('[data-preview-service]')?.addEventListener('change', (event) => {
          previewServiceId = event.target.value || '';
          refreshPreview(previewWeekStart, previewServiceId).catch(fail);
        });
      } catch (err) {
        if (destroyed) return;
        root.innerHTML = `<p class="calendar-warning">${escapeHtml((err && err.message) || 'No se pudo cargar la vista previa')}</p>`;
      }
    }

    function flash(message, kind) {
      const el = document.getElementById('form-flash');
      if (!el) return;
      el.hidden = false;
      el.className = `flash flash-${kind === 'ok' ? 'ok' : 'err'}`;
      el.textContent = message;
    }

    function fail(err) {
      if (onError && onError(err)) return;
      flash((err && err.message) || 'Error en la agenda', 'err');
    }

    // ── Borrador (campos editables) ───────────────────────────────────────
    function emptyDay() {
      return { enabled: false, intervals: [] };
    }

    function getIntervals(scope) {
      if (scope.startsWith('day:')) return (state.hours[scope.slice(4)] || emptyDay()).intervals;
      return state.exceptions[Number(scope.slice(3))]?.intervals || [];
    }

    function setIntervals(scope, intervals) {
      if (scope.startsWith('day:')) {
        const key = scope.slice(4);
        state.hours[key] = { ...(state.hours[key] || emptyDay()), intervals };
      } else {
        const item = state.exceptions[Number(scope.slice(3))];
        if (item) item.intervals = intervals;
      }
    }

    function readIntervals(scope) {
      return [...container.querySelectorAll(`[data-intervals="${scope}"] [data-interval-row]`)]
        .map((row) => ({
          start: row.querySelector('[data-start]')?.value || '',
          end: row.querySelector('[data-end]')?.value || ''
        }))
        .filter((interval) => interval.start || interval.end);
    }

    /** Lee el formulario actual y lo guarda en `state` (sin tocar el servidor). */
    function syncFromDom() {
      if (!state || !container.querySelector('[data-agenda-form]')) return;
      const tz = container.querySelector('#agenda-timezone')?.value;
      if (tz) state.timezone = tz;
      DAYS.forEach(([key]) => {
        state.hours[key] = {
          enabled: Boolean(container.querySelector(`[data-day-enabled="${key}"]`)?.checked),
          intervals: readIntervals(`day:${key}`)
        };
      });
      state.services = [...container.querySelectorAll('[data-service-row]')].map((row) => {
        const service = {
          name: row.querySelector('[data-svc-name]')?.value || '',
          description: row.querySelector('[data-svc-description]')?.value || '',
          durationMinutes: Number(row.querySelector('[data-svc-duration]')?.value || 30),
          active: Boolean(row.querySelector('[data-svc-active]')?.checked)
        };
        const id = row.querySelector('[data-svc-id]')?.value;
        if (id) service.id = id;
        return service;
      });
      state.exceptions = [...container.querySelectorAll('[data-ex-row]')].map((row, index) => {
        const closed = Boolean(row.querySelector('[data-ex-closed]')?.checked);
        return {
          date: row.querySelector('[data-ex-date]')?.value || '',
          closed,
          note: row.querySelector('[data-ex-note]')?.value || '',
          intervals: closed ? [] : readIntervals(`ex:${index}`)
        };
      });
      const num = (selector, fallback) => {
        const value = container.querySelector(selector)?.value;
        return value === undefined || value === '' ? fallback : Number(value);
      };
      state.rules = {
        minNoticeMinutes: num('[data-rule="minNoticeMinutes"]', state.rules?.minNoticeMinutes),
        maxDaysAhead: num('[data-rule="maxDaysAhead"]', state.rules?.maxDaysAhead),
        slotIntervalMinutes: num('[data-rule="slotIntervalMinutes"]', state.rules?.slotIntervalMinutes ?? 30),
        bufferMinutes: num('[data-rule="bufferMinutes"]', state.rules?.bufferMinutes),
        appointmentsPerBlock: num('[data-rule="appointmentsPerBlock"]', state.rules?.appointmentsPerBlock ?? 1),
        calendarColumns: num('[data-rule="appointmentsPerBlock"]', state.rules?.appointmentsPerBlock ?? 1),
        allowCancel: Boolean(container.querySelector('[data-rule="allowCancel"]')?.checked),
        allowReschedule: Boolean(container.querySelector('[data-rule="allowReschedule"]')?.checked)
      };
    }

    function draftPayload() {
      return {
        timezone: state.timezone,
        hours: state.hours,
        services: state.services,
        exceptions: state.exceptions.map((item) => (item.closed
          ? { date: item.date, closed: true, note: item.note || '' }
          : { date: item.date, closed: false, intervals: item.intervals || [], note: item.note || '' })),
        rules: state.rules
      };
    }

    /** Aplica la respuesta del servidor; con keepDraft conserva lo que el usuario está editando. */
    function applyServer(agenda, keepDraft) {
      if (keepDraft && state) {
        const { timezone, hours, services, exceptions, rules } = state;
        state = { ...agenda, timezone, hours, services, exceptions, rules };
      } else {
        state = agenda;
      }
      if (onState) onState(agenda);
    }

    async function guarded(fn) {
      if (busy) return;
      busy = true;
      try {
        await fn();
      } catch (err) {
        fail(err);
      } finally {
        busy = false;
      }
    }

    async function load() {
      if (destroyed) return;
      const res = await api(path());
      if (destroyed) return;
      state = res.agenda;
      render();
      if (onState) onState(state);
    }

    // ── Vistas ────────────────────────────────────────────────────────────
    function intervalsEditor(scope, intervals) {
      const rows = intervals.length ? intervals : [];
      return `
        <div class="stack" data-intervals="${escapeHtml(scope)}">
          ${rows.map((interval, index) => `
            <div class="calendar-interval" data-interval-row>
              <input class="calendar-time" data-start type="time" value="${escapeHtml(interval.start || '')}" aria-label="Apertura" ${dis}>
              <span aria-hidden="true">–</span>
              <input class="calendar-time" data-end type="time" value="${escapeHtml(interval.end || '')}" aria-label="Cierre" ${dis}>
              <button type="button" class="btn-sm btn-secondary" data-remove-interval="${escapeHtml(scope)}|${index}" ${dis}>Quitar</button>
            </div>
          `).join('')}
          <div><button type="button" class="btn-sm btn-secondary" data-add-interval="${escapeHtml(scope)}" ${dis}>Agregar horario</button></div>
        </div>
      `;
    }

    function dayRow([key, label]) {
      const day = state.hours?.[key] || emptyDay();
      return `
        <div class="calendar-day">
          <label class="check">
            <input type="checkbox" data-day-enabled="${key}" ${day.enabled ? 'checked' : ''} ${dis}>
            <span>${label}</span>
          </label>
          <div class="stack">
            ${day.enabled ? '' : '<p class="muted">Cerrado</p>'}
            <div class="${day.enabled ? 'stack' : 'stack calendar-day-closed'}">
              ${intervalsEditor(`day:${key}`, day.intervals || [])}
            </div>
          </div>
        </div>
      `;
    }

    function serviceRow(service, index) {
      return `
        <div class="calendar-service-form stack" data-service-row="${index}">
          <input type="hidden" data-svc-id value="${escapeHtml(service.id || '')}">
          <label>Nombre
            <input type="text" data-svc-name maxlength="80" value="${escapeHtml(service.name || '')}" ${dis}>
          </label>
          <label>Descripción
            <textarea data-svc-description maxlength="400" rows="2" ${dis}>${escapeHtml(service.description || '')}</textarea>
          </label>
          <label>Duración (minutos)
            <input type="number" data-svc-duration min="5" max="480" step="5" value="${escapeHtml(service.durationMinutes ?? 30)}" ${dis}>
          </label>
          <label class="check">
            <input type="checkbox" data-svc-active ${service.active !== false ? 'checked' : ''} ${dis}>
            <span>Servicio activo</span>
          </label>
          <div class="actions">
            <button type="button" class="btn-sm btn-secondary" data-remove-service="${index}" ${dis}>Quitar servicio</button>
          </div>
        </div>
      `;
    }

    function exceptionRow(item, index) {
      return `
        <div class="calendar-service-form stack" data-ex-row="${index}">
          <label>Fecha
            <input type="date" data-ex-date value="${escapeHtml(item.date || '')}" ${dis}>
          </label>
          <label class="check">
            <input type="checkbox" data-ex-closed ${item.closed !== false ? 'checked' : ''} ${dis}>
            <span>Cerrado todo el día</span>
          </label>
          ${item.closed !== false ? '' : `
            <div>
              <span class="muted">Horario especial de ese día</span>
              ${intervalsEditor(`ex:${index}`, item.intervals || [])}
            </div>
          `}
          <label>Nota (opcional)
            <input type="text" data-ex-note maxlength="200" value="${escapeHtml(item.note || '')}" ${dis}>
          </label>
          <div class="actions">
            <button type="button" class="btn-sm btn-secondary" data-remove-exception="${index}" ${dis}>Quitar excepción</button>
          </div>
        </div>
      `;
    }

    function ruleNumber(key, label, min, max, step = 1, fallback = '') {
      const raw = state.rules?.[key];
      const value = raw === undefined || raw === null || raw === '' ? fallback : raw;
      return `
        <label>${label}
          <input type="number" data-rule="${key}" min="${min}" max="${max}" step="${step}" value="${escapeHtml(value)}" ${dis}>
        </label>
      `;
    }

    function connectionBlock() {
      const conn = state.connection || {};
      const connected = conn.status === 'connected';
      const calendarLine = connected
        ? `${escapeHtml(conn.email || 'cuenta conectada')} · ${escapeHtml(conn.calendarSummary || 'sin calendario elegido')}`
        : 'Google Calendar no está conectado.';
      const picker = calendars ? `
        <label>Calendario de la agenda
          <select data-calendar-picker ${dis}>
            ${calendars.map((item) => `
              <option value="${escapeHtml(item.id)}" ${item.id === conn.calendarId ? 'selected' : ''}>${escapeHtml(item.summary || item.id)}</option>
            `).join('')}
          </select>
        </label>
      ` : '';
      return `
        <h3>Google Calendar</h3>
        ${state.oauthConfigured ? '' : '<p class="calendar-warning">El servidor no tiene configurado Google (GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET). No se puede conectar.</p>'}
        <p class="muted">${calendarLine}</p>
        ${conn.lastError ? `<p class="calendar-warning">Último error de conexión: ${escapeHtml(conn.lastError)}</p>` : ''}
        ${picker}
        ${!connected && inviteUrl ? `
          <div class="stack">
            <p class="muted">Link para que el cliente conecte su calendario:</p>
            <code id="agenda-invite-url">${escapeHtml(inviteUrl)}</code>
            <div class="actions"><button type="button" class="btn-sm btn-secondary" id="agenda-copy-invite">Copiar link</button></div>
          </div>
        ` : ''}
        <div class="actions">
          ${connected ? `
            <button type="button" class="btn-secondary" id="agenda-change-calendar">${calendars ? 'Ocultar calendarios' : 'Cambiar calendario'}</button>
            <button type="button" class="btn-secondary" id="agenda-disconnect" ${dis}>Desconectar</button>
          ` : `
            <button type="button" id="agenda-oauth" ${canEdit && state.oauthConfigured ? '' : 'disabled'}>Conectar Google</button>
            <button type="button" class="btn-secondary" id="agenda-invite" ${canEdit && state.oauthConfigured ? '' : 'disabled'}>${inviteUrl ? 'Generar link nuevo' : 'Generar link para el cliente'}</button>
          `}
        </div>
      `;
    }

    function render() {
      if (destroyed) return;
      if (!state) {
        container.innerHTML = '<section class="card stack"><p class="muted">Cargando agenda…</p></section>';
        return;
      }
      const phaseBadge = PHASE_BADGES[state.phase] || 'badge-muted';
      const missing = (state.missing || []).map((key) => MISSING_LABELS[key]).filter(Boolean);
      const timezones = TIMEZONES.includes(state.timezone) ? TIMEZONES : [state.timezone].concat(TIMEZONES);
      const issues = state.syncIssues || {};
      const syncError = state.lastSyncError || '';
      const retryCount = Number(issues.retryCount) || 0;
      const failedCount = Number(issues.failedCount) || 0;
      const syncParts = [];
      if (failedCount) syncParts.push(`${failedCount} sin copiar al calendario tras varios intentos`);
      if (retryCount) syncParts.push(`${retryCount} reintentando`);
      const syncSummary = syncParts.length ? ` (${syncParts.join(', ')})` : '';
      const ready = Boolean(state.ready);
      container.innerHTML = `
        <section class="card stack calendar-card" data-agenda-form>
          <h2>Agendar citas</h2>
          <p><span class="badge ${phaseBadge}">${escapeHtml(state.phaseLabel || '')}</span></p>
          ${state.detail ? `<p class="muted">${escapeHtml(state.detail)}</p>` : ''}
          ${missing.length && state.enabled ? `
            <ul class="calendar-missing">${missing.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
          ` : ''}
          ${syncError || syncSummary ? `<p class="calendar-warning">Error de sincronización con Google${escapeHtml(syncSummary)}${syncError ? `: ${escapeHtml(syncError)}` : ''}. Las citas siguen confirmadas.</p>` : ''}
          ${state.adminNotice ? `
            <div class="notice-banner stack">
              <p>El cliente conectó Google Calendar${state.adminNotice.email ? `: ${escapeHtml(state.adminNotice.email)}` : ''}.</p>
              <div class="actions"><button type="button" class="btn-sm" id="agenda-dismiss-notice">Listo, ya lo vi</button></div>
            </div>
          ` : ''}
          <label class="check">
            <input type="checkbox" id="agenda-enabled" ${state.enabled ? 'checked' : ''} ${dis}>
            <span>Habilitar agenda de citas</span>
          </label>

          ${connectionBlock()}

          <h3>Zona horaria</h3>
          <label>Zona horaria de la agenda
            <select id="agenda-timezone" ${dis}>
              ${timezones.map((tz) => `<option value="${escapeHtml(tz)}" ${tz === state.timezone ? 'selected' : ''}>${escapeHtml(tz)}</option>`).join('')}
            </select>
          </label>

          <h3>Horarios de atención</h3>
          ${DAYS.map(dayRow).join('')}

          <h3>Vista previa</h3>
          <p class="muted">Semana laboral: cada día se parte en columnas verticales (una por cupo de “Citas por bloque”), como varios calendarios en uno. Sin eje de horas.</p>
          <div class="agenda-preview" data-agenda-preview>
            <p class="muted">Cargando vista previa…</p>
          </div>

          <h3>Servicios</h3>
          ${(state.services || []).map(serviceRow).join('') || '<p class="muted">Sin servicios. Agrega uno.</p>'}
          <div class="actions">
            <button type="button" class="btn-secondary" id="agenda-add-service" ${dis}>Agregar servicio</button>
          </div>

          <h3>Excepciones</h3>
          ${(state.exceptions || []).map(exceptionRow).join('') || '<p class="muted">Sin excepciones (feriados, vacaciones, horarios especiales).</p>'}
          <div class="actions">
            <button type="button" class="btn-secondary" id="agenda-add-exception" ${dis}>Agregar excepción</button>
          </div>

          <h3>Reglas</h3>
          <div class="stack">
            ${ruleNumber('minNoticeMinutes', 'Anticipación mínima (minutos)', 0, 10080)}
            ${ruleNumber('maxDaysAhead', 'Máximo de días a futuro', 1, 365)}
            ${ruleNumber('slotIntervalMinutes', 'Incremento del calendario (minutos)', 5, 120, 5, 30)}
            <p class="muted">Cada cuántos minutos avanza el calendario y los horarios ofrecidos (default 30: 09:00, 09:30, 10:00…). Cada cita ocupa la <strong>duración del servicio</strong>.</p>
            ${ruleNumber('appointmentsPerBlock', 'Citas por bloque / columnas del calendario', 1, 12)}
            <p class="muted">Cupo simultáneo por horario de inicio y número de columnas verticales en la vista previa. Ej. 3 = hasta 3 citas a las 09:00 (3 columnas).</p>
            ${ruleNumber('bufferMinutes', 'Tiempo de preparación entre citas (minutos)', 0, 240, 5)}
            <label class="check">
              <input type="checkbox" data-rule="allowCancel" ${state.rules?.allowCancel !== false ? 'checked' : ''} ${dis}>
              <span>Permitir cancelar citas</span>
            </label>
            <label class="check">
              <input type="checkbox" data-rule="allowReschedule" ${state.rules?.allowReschedule !== false ? 'checked' : ''} ${dis}>
              <span>Permitir reprogramar citas</span>
            </label>
          </div>

          <div class="actions">
            <button type="button" id="agenda-save" ${dis}>Guardar agenda</button>
          </div>

          <h3>Prueba en el playground</h3>
          <label class="check">
            <input type="checkbox" id="agenda-playground-write" ${state.playgroundWriteEnabled ? 'checked' : ''} ${canEdit && ready ? '' : 'disabled'}>
            <span>Permitir que el playground cree citas reales</span>
          </label>
          <p class="muted">${ready
            ? 'Si está apagado, el playground solo consulta disponibilidad y no crea citas.'
            : 'Disponible cuando la agenda esté lista.'}</p>
        </section>
      `;
      bind();
      refreshPreview(previewWeekStart).catch(fail);
    }

    // ── Eventos ───────────────────────────────────────────────────────────
    function bind() {
      const on = (selector, event, handler) => container.querySelector(selector)?.addEventListener(event, handler);

      on('#agenda-enabled', 'change', (event) => guarded(async () => {
        syncFromDom();
        try {
          const res = await api(path('/enabled'), { method: 'PUT', body: { enabled: event.target.checked } });
          applyServer(res.agenda, true);
          flash(res.agenda.enabled ? 'Agenda habilitada' : 'Agenda desactivada', 'ok');
          render();
        } catch (err) {
          event.target.checked = !event.target.checked;
          throw err;
        }
      }));

      on('#agenda-save', 'click', () => guarded(async () => {
        syncFromDom();
        const res = await api(path('/settings'), { method: 'PUT', body: draftPayload() });
        applyServer(res.agenda, false);
        flash('Agenda guardada', 'ok');
        render();
      }));

      on('#agenda-oauth', 'click', () => guarded(async () => {
        const res = await api(path('/oauth/start'), { method: 'POST', body: {} });
        if (res.url) window.location.assign(res.url);
      }));

      on('#agenda-invite', 'click', () => guarded(async () => {
        if (inviteUrl && !window.confirm('El link anterior dejará de servir. ¿Generar uno nuevo?')) return;
        syncFromDom();
        const res = await api(path('/invite'), { method: 'POST', body: {} });
        inviteUrl = res.calendarInviteUrl || '';
        if (inviteUrl && typeof onInviteUrl === 'function') onInviteUrl(inviteUrl);
        render();
        flash('Link generado. Cópialo y envíaselo al cliente.', 'ok');
      }));

      on('#agenda-copy-invite', 'click', async () => {
        try {
          await navigator.clipboard.writeText(inviteUrl);
          flash('Link copiado', 'ok');
        } catch (_err) {
          flash('No se pudo copiar el link', 'err');
        }
      });

      on('#agenda-disconnect', 'click', () => guarded(async () => {
        if (!window.confirm('¿Desconectar la cuenta de Google de este bot? Se conservan horarios, servicios y citas ya creadas.')) return;
        syncFromDom();
        const res = await api(path('/disconnect'), { method: 'POST', body: {} });
        calendars = null;
        applyServer(res.agenda, true);
        flash('Cuenta de Google desconectada', 'ok');
        render();
      }));

      on('#agenda-change-calendar', 'click', () => guarded(async () => {
        syncFromDom();
        if (calendars) {
          calendars = null;
        } else {
          const res = await api(path('/calendars'));
          calendars = Array.isArray(res.calendars) ? res.calendars : [];
        }
        render();
      }));

      on('[data-calendar-picker]', 'change', (event) => guarded(async () => {
        syncFromDom();
        const option = event.target.selectedOptions[0];
        const res = await api(path('/select-calendar'), {
          method: 'POST',
          body: { calendarId: event.target.value, calendarSummary: option ? option.textContent : '' }
        });
        applyServer(res.agenda, true);
        flash('Calendario actualizado', 'ok');
        render();
      }));

      on('#agenda-dismiss-notice', 'click', () => guarded(async () => {
        syncFromDom();
        const res = await api(path('/notice/dismiss'), { method: 'POST', body: {} });
        applyServer(res.agenda, true);
        render();
      }));

      on('#agenda-playground-write', 'change', (event) => guarded(async () => {
        const next = event.target.checked;
        if (next && !window.confirm('Se crearán eventos reales en el Google Calendar conectado. ¿Activar la escritura de prueba?')) {
          event.target.checked = false;
          return;
        }
        try {
          syncFromDom();
          const res = await api(path('/playground-write'), { method: 'PUT', body: { enabled: next } });
          applyServer(res.agenda, true);
          flash(next ? 'Escritura de prueba activada' : 'Escritura de prueba desactivada', 'ok');
        } catch (err) {
          event.target.checked = !next;
          throw err;
        }
      }));

      container.querySelectorAll('[data-day-enabled]').forEach((input) => {
        input.addEventListener('change', () => {
          syncFromDom();
          const key = input.getAttribute('data-day-enabled');
          const day = state.hours[key];
          if (day.enabled && !day.intervals.length) day.intervals = [{ start: '09:00', end: '18:00' }];
          render();
        });
      });

      container.querySelectorAll('[data-add-interval]').forEach((button) => {
        button.addEventListener('click', () => {
          syncFromDom();
          const scope = button.getAttribute('data-add-interval');
          setIntervals(scope, getIntervals(scope).concat([{ start: '09:00', end: '18:00' }]));
          render();
        });
      });

      container.querySelectorAll('[data-remove-interval]').forEach((button) => {
        button.addEventListener('click', () => {
          syncFromDom();
          const [scope, index] = button.getAttribute('data-remove-interval').split('|');
          setIntervals(scope, getIntervals(scope).filter((_item, i) => i !== Number(index)));
          render();
        });
      });

      on('#agenda-add-service', 'click', () => {
        syncFromDom();
        state.services = state.services.concat([{
          name: '', description: '', durationMinutes: 30, active: true
        }]);
        render();
      });

      container.querySelectorAll('[data-remove-service]').forEach((button) => {
        button.addEventListener('click', () => {
          syncFromDom();
          const index = Number(button.getAttribute('data-remove-service'));
          state.services = state.services.filter((_item, i) => i !== index);
          render();
        });
      });

      on('#agenda-add-exception', 'click', () => {
        syncFromDom();
        state.exceptions = state.exceptions.concat([{ date: '', closed: true, intervals: [], note: '' }]);
        render();
      });

      container.querySelectorAll('[data-remove-exception]').forEach((button) => {
        button.addEventListener('click', () => {
          syncFromDom();
          const index = Number(button.getAttribute('data-remove-exception'));
          state.exceptions = state.exceptions.filter((_item, i) => i !== index);
          render();
        });
      });

      container.querySelectorAll('[data-ex-closed]').forEach((input) => {
        input.addEventListener('change', () => {
          syncFromDom();
          const index = Number(input.closest('[data-ex-row]').getAttribute('data-ex-row'));
          const item = state.exceptions[index];
          if (!item.closed && !item.intervals.length) item.intervals = [{ start: '09:00', end: '13:00' }];
          render();
        });
      });
    }

    render();
    load().catch(fail);

    return {
      /** Sincroniza el panel cuando otra parte de la UI cambió la agenda (p. ej. el playground). */
      setState(agenda) {
        if (destroyed || !agenda) return;
        syncFromDom();
        const { timezone, hours, services, exceptions, rules } = state || agenda;
        state = { ...agenda, timezone, hours, services, exceptions, rules };
        render();
      },
      /** Marca el panel como destruido: render/load/setState pasan a ser no-ops. */
      destroy() {
        destroyed = true;
      },
      isDestroyed() {
        return destroyed;
      }
    };
  }

  window.AgendaPanel = { mount };
})();
