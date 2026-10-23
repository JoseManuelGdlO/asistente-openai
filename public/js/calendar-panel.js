(function () {
  const DAYS = [
    ['monday', 'Lunes'],
    ['tuesday', 'Martes'],
    ['wednesday', 'Miércoles'],
    ['thursday', 'Jueves'],
    ['friday', 'Viernes'],
    ['saturday', 'Sábado'],
    ['sunday', 'Domingo']
  ];

  const TIMEZONES = [
    'America/Mexico_City',
    'America/Cancun',
    'America/Tijuana',
    'America/Hermosillo',
    'America/Bogota',
    'America/Lima',
    'America/Santiago',
    'America/Argentina/Buenos_Aires',
    'America/Sao_Paulo',
    'Europe/Madrid',
    'UTC'
  ];

  const MISSING = {
    connection: 'Conecta una cuenta de Google.',
    calendar: 'Selecciona un calendario.',
    hours: 'Abre al menos un día con horario de atención.',
    services: 'Agrega un servicio activo.'
  };

  function newServiceId() {
    const bytes = new Uint8Array(6);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
    return `svc_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  function badgeClass(phase) {
    if (phase === 'ready') return 'badge badge-ok';
    if (phase === 'error' || phase === 'revoked') return 'badge badge-off';
    if (phase === 'disabled') return 'badge badge-muted';
    return 'badge badge-warn';
  }

  function durationLabel(minutes) {
    const value = Number(minutes) || 0;
    if (value >= 60 && value % 60 === 0) {
      const hours = value / 60;
      return `${value} minutos (${hours} ${hours === 1 ? 'hora' : 'horas'})`;
    }
    return `${value} minutos`;
  }

  function icon() {
    return `<svg class="calendar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"></rect>
      <path d="M8 3.5v3.5M16 3.5v3.5M3.5 9.5h17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
    </svg>`;
  }

  function mount(container, options) {
    const { clientId, canEdit, api, escapeHtml, onState, onError } = options;
    let state = null;
    let configOpen = false;
    let choosingCalendar = false;
    let calendars = [];
    let serviceDraft = null;
    let busy = false;

    function flash(message, kind) {
      const el = document.getElementById('form-flash');
      if (!el) return;
      el.hidden = false;
      el.className = `flash flash-${kind === 'ok' ? 'ok' : 'err'}`;
      el.textContent = message;
    }

    function fail(err) {
      if (onError && onError(err)) return;
      flash(err.message || 'No se pudo actualizar la agenda', 'err');
    }

    function emit() {
      if (onState && state) onState(state);
    }

    function ruleField(name, label, value) {
      return `<label>${label}<input type="number" data-rule="${name}" min="0" step="1" value="${escapeHtml(value)}" ${canEdit ? '' : 'disabled'}></label>`;
    }

    function timezoneOptions(current) {
      const values = TIMEZONES.includes(current) ? TIMEZONES : TIMEZONES.concat(current);
      return values.map((zone) => (
        `<option value="${escapeHtml(zone)}"${zone === current ? ' selected' : ''}>${escapeHtml(zone)}</option>`
      )).join('');
    }

    function readHours() {
      const hours = {};
      DAYS.forEach(([key]) => {
        const enabled = Boolean(container.querySelector(`[data-day-enabled="${key}"]`)?.checked);
        const intervals = [...container.querySelectorAll(`[data-interval-row="${key}"]`)].map((row) => ({
          start: row.querySelector('[data-start]')?.value || '',
          end: row.querySelector('[data-end]')?.value || ''
        })).filter((interval) => interval.start || interval.end);
        hours[key] = { enabled, intervals };
      });
      return hours;
    }

    function readRules() {
      const value = (name) => container.querySelector(`[data-rule="${name}"]`)?.value;
      const checked = (name) => Boolean(container.querySelector(`[data-rule-check="${name}"]`)?.checked);
      const format = (name) => container.querySelector(`[data-rule-format="${name}"]`)?.value || '';
      return {
        minNoticeMinutes: Number(value('minNoticeMinutes')),
        maxDaysAhead: Number(value('maxDaysAhead')),
        slotIntervalMinutes: Number(value('slotIntervalMinutes')),
        bufferMinutes: Number(value('bufferMinutes')),
        allowCancel: checked('allowCancel'),
        allowReschedule: checked('allowReschedule'),
        formats: {
          date: format('date') || 'YYYY-MM-DD',
          dateTime: format('dateTime') || 'YYYY-MM-DDTHH:mm',
          availability: format('availability') || 'times',
          notes: format('notes')
        }
      };
    }

    function syncFromDom() {
      if (!state || !container.querySelector('[data-day-enabled]')) return;
      state.hours = readHours();
      state.rules = readRules();
      const zone = container.querySelector('[data-timezone]');
      if (zone) state.connection.timezone = zone.value;
    }

    function render() {
      if (!state) {
        container.innerHTML = '<section class="card calendar-card"><p class="muted">Cargando Google Calendar…</p></section>';
        return;
      }
      const enabled = Boolean(state.enabled);
      const phase = state.phase || 'disabled';
      const missing = (state.missing || []).map((key) => MISSING[key]).filter(Boolean);
      const connected = state.connection?.status === 'connected' && state.connection.email;
      container.innerHTML = `
        <section class="card calendar-card stack" aria-labelledby="calendar-heading">
          <div class="calendar-head">
            <div class="calendar-title-row">
              ${icon()}
              <div>
                <div class="calendar-title-line">
                  <h2 id="calendar-heading">Google Calendar</h2>
                  <span class="${badgeClass(phase)}">${escapeHtml(state.phaseLabel || 'Agenda desactivada')}</span>
                </div>
                <p class="muted">Permite que este Assistant consulte disponibilidad y agende citas automáticamente desde WhatsApp.</p>
              </div>
            </div>
            <div class="calendar-switch">
              <span id="calendar-switch-label">Habilitar agenda</span>
              <label class="switch">
                <span class="sr-only">Habilitar agenda</span>
                <input type="checkbox" id="calendar-enabled" aria-labelledby="calendar-switch-label" ${enabled ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
                <span class="switch-track"></span>
              </label>
            </div>
          </div>
          <div class="calendar-expand ${enabled ? 'open' : ''}">
            <div class="calendar-expand-inner stack" ${enabled ? '' : 'inert'}>
              ${connectionBlock()}
              <div id="calendar-config" class="stack" ${configOpen ? '' : 'hidden'}>
                ${configBlock()}
              </div>
            </div>
          </div>
        </section>
      `;
      bind();
      emit();

      function connectionBlock() {
        if (!enabled) return '';
        if (!connected) {
          const detail = phase === 'revoked' || phase === 'error'
            ? `<p class="error">${escapeHtml(state.detail || state.phaseLabel)}</p>`
            : '<p class="muted">Conecta una cuenta de Google para que tu asistente pueda administrar citas.</p>';
          const label = connected ? 'Conectar con Google' : (phase === 'revoked' || phase === 'error' ? 'Volver a conectar' : 'Conectar con Google');
          return `
            <div class="calendar-status stack">
              <strong>${escapeHtml(phase === 'disconnected' || !state.connection?.email ? 'Google Calendar no conectado' : state.phaseLabel)}</strong>
              ${detail}
              ${state.oauthConfigured ? '' : '<p class="error">El servidor todavía no tiene las credenciales de Google OAuth.</p>'}
              <div class="actions">
                <button type="button" id="calendar-connect" ${canEdit ? '' : 'disabled'}>${label}</button>
              </div>
            </div>
          `;
        }
        return `
          <div class="calendar-status stack">
            <strong>${escapeHtml(state.phaseLabel)}</strong>
            <p class="muted">Cuenta conectada: ${escapeHtml(state.connection.email)}</p>
            <p class="muted">Calendario: ${escapeHtml(state.connection.calendarSummary || state.connection.calendarId || 'Sin calendario')}</p>
            <p class="muted">Estado: ${escapeHtml(state.connection.status === 'connected' ? 'Conectado' : state.phaseLabel)}</p>
            ${missing.length ? `<ul class="calendar-missing">${missing.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
            ${choosingCalendar ? calendarPicker() : ''}
            <div class="actions">
              <button type="button" class="btn-secondary" id="calendar-change" ${canEdit ? '' : 'disabled'}>Cambiar calendario</button>
              <button type="button" class="btn-secondary" id="calendar-disconnect" ${canEdit ? '' : 'disabled'}>Desconectar</button>
              <button type="button" class="btn-secondary" id="calendar-configure" aria-expanded="${configOpen ? 'true' : 'false'}">Configurar agenda</button>
            </div>
          </div>
        `;
      }

      function calendarPicker() {
        const optionsHtml = calendars.map((item) => (
          `<option value="${escapeHtml(item.id)}"${item.id === state.connection.calendarId ? ' selected' : ''}>${escapeHtml(item.summary || item.id)}</option>`
        )).join('');
        return `
          <label>
            Calendario disponible
            <select data-calendar-picker ${canEdit ? '' : 'disabled'}>
              ${optionsHtml || `<option value="${escapeHtml(state.connection.calendarId)}">${escapeHtml(state.connection.calendarSummary || 'Calendario actual')}</option>`}
            </select>
          </label>
        `;
      }

      function configBlock() {
        const zone = state.connection?.timezone || 'America/Mexico_City';
        return `
          <details class="calendar-fold" open>
            <summary>Cuenta y calendario</summary>
            <div class="stack">
              <p class="muted">Cuenta: ${escapeHtml(state.connection.email || 'Sin cuenta')}</p>
              <p class="muted">Estado: ${escapeHtml(state.phaseLabel)}</p>
              <label>Zona horaria
                <select data-timezone ${canEdit ? '' : 'disabled'}>${timezoneOptions(zone)}</select>
              </label>
            </div>
          </details>
          <details class="calendar-fold" open>
            <summary>Horarios de atención</summary>
            <div class="stack">${DAYS.map(([key, label]) => dayRow(key, label)).join('')}</div>
          </details>
          <details class="calendar-fold" open>
            <summary>Servicios disponibles</summary>
            <div class="stack">
              <div class="actions">
                <button type="button" id="calendar-add-service" ${canEdit ? '' : 'disabled'}>+ Agregar servicio</button>
              </div>
              ${serviceForm()}
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Servicio</th><th>Descripción</th><th>Duración</th><th>Estado</th><th>Acciones</th></tr></thead>
                  <tbody>
                    ${(state.services || []).length ? state.services.map(serviceRow).join('') : '<tr><td colspan="5" class="muted">Aún no hay servicios.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
          <details class="calendar-fold">
            <summary>Reglas de agendamiento</summary>
            <div class="grid grid-2">
              ${ruleField('minNoticeMinutes', 'Anticipación mínima (minutos)', state.rules.minNoticeMinutes)}
              ${ruleField('maxDaysAhead', 'Máximo de días a futuro', state.rules.maxDaysAhead)}
              ${ruleField('slotIntervalMinutes', 'Intervalo de horarios (minutos)', state.rules.slotIntervalMinutes)}
              ${ruleField('bufferMinutes', 'Tiempo de preparación (minutos)', state.rules.bufferMinutes)}
            </div>
            <label class="check"><input type="checkbox" data-rule-check="allowCancel" ${state.rules.allowCancel ? 'checked' : ''} ${canEdit ? '' : 'disabled'}><span>Permitir cancelaciones</span></label>
            <label class="check"><input type="checkbox" data-rule-check="allowReschedule" ${state.rules.allowReschedule ? 'checked' : ''} ${canEdit ? '' : 'disabled'}><span>Permitir reprogramaciones</span></label>
            ${formatFields(state.rules.formats)}
          </details>
          <div class="actions">
            <button type="button" id="calendar-save" ${canEdit && !busy ? '' : 'disabled'}>Guardar agenda</button>
          </div>
        `;
      }

      function formatFields(formats) {
        const current = formats || {};
        const dateTime = current.dateTime || 'YYYY-MM-DDTHH:mm';
        const availability = current.availability || 'times';
        const notes = current.notes || '';
        return `
          <div class="stack">
            <h3>Subprompt de Google Calendar</h3>
            <p class="muted">Estas reglas se agregan al bot solo al agendar. El prompt del assistant no cambia.</p>
            <label>Formato de fecha
              <select data-rule-format="date" ${canEdit ? '' : 'disabled'}>
                <option value="YYYY-MM-DD" selected>YYYY-MM-DD (date)</option>
              </select>
            </label>
            <label>Formato de hora
              <select data-rule-format="dateTime" ${canEdit ? '' : 'disabled'}>
                <option value="YYYY-MM-DDTHH:mm"${dateTime === 'YYYY-MM-DDTHH:mm' ? ' selected' : ''}>YYYY-MM-DDTHH:mm, hora local sin Z</option>
                <option value="YYYY-MM-DDTHH:mm:ssZ"${dateTime === 'YYYY-MM-DDTHH:mm:ssZ' ? ' selected' : ''}>ISO con Z: se lee la hora del reloj, no se convierte a UTC</option>
              </select>
            </label>
            <label>Qué mostrar
              <select data-rule-format="availability" ${canEdit ? '' : 'disabled'}>
                <option value="times"${availability === 'times' ? ' selected' : ''}>Horarios del día</option>
                <option value="days"${availability === 'days' ? ' selected' : ''}>Un horario por día, para elegir el día</option>
              </select>
            </label>
            <label>Notas del subprompt
              <textarea data-rule-format="notes" maxlength="400" rows="3" ${canEdit ? '' : 'disabled'}>${escapeHtml(notes)}</textarea>
            </label>
          </div>
        `;
      }

      function dayRow(key, label) {
        const day = state.hours?.[key] || { enabled: false, intervals: [] };
        const intervals = day.intervals?.length ? day.intervals : [{ start: '09:00', end: '18:00' }];
        return `
          <div class="calendar-day">
            <label class="check">
              <input type="checkbox" data-day-enabled="${key}" ${day.enabled ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
              <span>${label}</span>
            </label>
            <div class="stack">
              ${day.enabled ? '' : '<p class="muted">Cerrado</p>'}
              <div class="${day.enabled ? 'stack' : 'stack calendar-day-closed'}">
              ${intervals.map((interval, index) => `
                <div class="calendar-interval" data-interval-row="${key}">
                  <input class="calendar-time" data-start type="time" value="${escapeHtml(interval.start)}" aria-label="Apertura ${label}" ${canEdit ? '' : 'disabled'}>
                  <span aria-hidden="true">–</span>
                  <input class="calendar-time" data-end type="time" value="${escapeHtml(interval.end)}" aria-label="Cierre ${label}" ${canEdit ? '' : 'disabled'}>
                  <button type="button" class="btn-sm btn-secondary" data-remove-interval="${key}:${index}" ${canEdit ? '' : 'disabled'}>Quitar</button>
                </div>
              `).join('')}
              <button type="button" class="btn-sm btn-secondary" data-add-interval="${key}" ${canEdit ? '' : 'disabled'}>Agregar horario</button>
              </div>
            </div>
          </div>
        `;
      }

      function serviceRow(service) {
        return `
          <tr>
            <td>${escapeHtml(service.name)}</td>
            <td>${escapeHtml(service.description || '—')}</td>
            <td>${escapeHtml(durationLabel(service.durationMinutes))}</td>
            <td><span class="${service.active ? 'badge badge-ok' : 'badge badge-off'}">${service.active ? 'Activo' : 'Inactivo'}</span></td>
            <td class="actions">
              <button type="button" class="btn-sm btn-secondary" data-edit-service="${escapeHtml(service.id)}" ${canEdit ? '' : 'disabled'}>Editar</button>
              <button type="button" class="btn-sm btn-secondary" data-toggle-service="${escapeHtml(service.id)}" ${canEdit ? '' : 'disabled'}>${service.active ? 'Desactivar' : 'Activar'}</button>
            </td>
          </tr>
        `;
      }

      function serviceForm() {
        if (!serviceDraft) return '';
        return `
          <div class="calendar-service-form stack">
            <label>Nombre<input type="text" data-service-name maxlength="80" value="${escapeHtml(serviceDraft.name)}" ${canEdit ? '' : 'disabled'}></label>
            <label>Descripción<textarea data-service-description maxlength="400" rows="2" ${canEdit ? '' : 'disabled'}>${escapeHtml(serviceDraft.description)}</textarea></label>
            <label>Duración (minutos)<input type="number" data-service-duration min="5" max="480" step="5" value="${escapeHtml(serviceDraft.durationMinutes)}" ${canEdit ? '' : 'disabled'}></label>
            <label class="check"><input type="checkbox" data-service-active ${serviceDraft.active ? 'checked' : ''} ${canEdit ? '' : 'disabled'}><span>Servicio activo</span></label>
            <div class="actions">
              <button type="button" id="calendar-service-save" ${canEdit ? '' : 'disabled'}>${serviceDraft.id ? 'Guardar servicio' : 'Agregar a la lista'}</button>
              <button type="button" class="btn-secondary" id="calendar-service-cancel">Cancelar</button>
            </div>
          </div>
        `;
      }
    }

    function bind() {
      container.querySelector('#calendar-enabled')?.addEventListener('change', async (event) => {
        const enabled = event.target.checked;
        event.target.disabled = true;
        try {
          const res = await api(`/clients/${encodeURIComponent(clientId)}/calendar/enabled`, {
            method: 'PUT',
            body: { enabled }
          });
          state = res.calendar;
          if (!enabled) configOpen = false;
          render();
        } catch (err) {
          event.target.checked = !enabled;
          event.target.disabled = !canEdit;
          fail(err);
        }
      });

      container.querySelector('#calendar-connect')?.addEventListener('click', async () => {
        try {
          const res = await api(`/clients/${encodeURIComponent(clientId)}/calendar/oauth/start`, { method: 'POST', body: {} });
          if (res.url) window.location.assign(res.url);
        } catch (err) {
          fail(err);
        }
      });

      container.querySelector('#calendar-disconnect')?.addEventListener('click', async () => {
        if (!window.confirm('¿Desconectar la cuenta de Google de este bot? Se conservan horarios, servicios y citas ya creadas.')) return;
        try {
          const res = await api(`/clients/${encodeURIComponent(clientId)}/calendar/disconnect`, { method: 'POST', body: {} });
          state = res.calendar;
          configOpen = false;
          choosingCalendar = false;
          render();
          flash('Cuenta de Google desconectada', 'ok');
        } catch (err) {
          fail(err);
        }
      });

      container.querySelector('#calendar-configure')?.addEventListener('click', () => {
        syncFromDom();
        configOpen = !configOpen;
        render();
      });

      container.querySelector('#calendar-change')?.addEventListener('click', async () => {
        choosingCalendar = !choosingCalendar;
        if (choosingCalendar) {
          try {
            const res = await api(`/clients/${encodeURIComponent(clientId)}/calendar/calendars`);
            calendars = Array.isArray(res.calendars) ? res.calendars : [];
          } catch (err) {
            choosingCalendar = false;
            fail(err);
            return;
          }
        }
        render();
      });

      container.querySelector('[data-calendar-picker]')?.addEventListener('change', async (event) => {
        const option = event.target.selectedOptions[0];
        try {
          const res = await api(`/clients/${encodeURIComponent(clientId)}/calendar/selection`, {
            method: 'PUT',
            body: {
              calendarId: event.target.value,
              calendarSummary: option ? option.textContent : ''
            }
          });
          state = res.calendar;
          render();
          flash('Calendario actualizado', 'ok');
        } catch (err) {
          fail(err);
        }
      });

      container.querySelectorAll('[data-day-enabled]').forEach((input) => {
        input.addEventListener('change', () => {
          syncFromDom();
          render();
        });
      });

      container.querySelectorAll('[data-add-interval]').forEach((button) => {
        button.addEventListener('click', () => {
          syncFromDom();
          const key = button.getAttribute('data-add-interval');
          state.hours[key] = state.hours[key] || { enabled: true, intervals: [] };
          state.hours[key].intervals.push({ start: '09:00', end: '18:00' });
          render();
        });
      });

      container.querySelectorAll('[data-remove-interval]').forEach((button) => {
        button.addEventListener('click', () => {
          syncFromDom();
          const [key, indexRaw] = button.getAttribute('data-remove-interval').split(':');
          const index = Number(indexRaw);
          const intervals = state.hours[key]?.intervals || [];
          if (intervals.length <= 1) return;
          intervals.splice(index, 1);
          render();
        });
      });

      container.querySelector('#calendar-add-service')?.addEventListener('click', () => {
        syncFromDom();
        serviceDraft = { id: '', name: '', description: '', durationMinutes: 30, active: true };
        render();
      });

      container.querySelector('#calendar-service-cancel')?.addEventListener('click', () => {
        syncFromDom();
        serviceDraft = null;
        render();
      });

      container.querySelector('#calendar-service-save')?.addEventListener('click', () => {
        syncFromDom();
        const name = container.querySelector('[data-service-name]')?.value.trim() || '';
        const description = container.querySelector('[data-service-description]')?.value.trim() || '';
        const durationMinutes = Number(container.querySelector('[data-service-duration]')?.value);
        const active = Boolean(container.querySelector('[data-service-active]')?.checked);
        if (!name) {
          flash('El servicio necesita un nombre', 'err');
          return;
        }
        if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
          flash('La duración debe estar entre 5 y 480 minutos', 'err');
          return;
        }
        const next = {
          id: serviceDraft.id || newServiceId(),
          name,
          description,
          durationMinutes,
          active
        };
        const index = state.services.findIndex((service) => service.id === next.id);
        if (index >= 0) state.services[index] = next;
        else state.services.push(next);
        serviceDraft = null;
        render();
      });

      container.querySelectorAll('[data-edit-service]').forEach((button) => {
        button.addEventListener('click', () => {
          syncFromDom();
          const found = state.services.find((service) => service.id === button.getAttribute('data-edit-service'));
          if (!found) return;
          serviceDraft = { ...found };
          render();
        });
      });

      container.querySelectorAll('[data-toggle-service]').forEach((button) => {
        button.addEventListener('click', () => {
          syncFromDom();
          const found = state.services.find((service) => service.id === button.getAttribute('data-toggle-service'));
          if (!found) return;
          found.active = !found.active;
          render();
        });
      });

      container.querySelector('#calendar-save')?.addEventListener('click', async () => {
        syncFromDom();
        busy = true;
        render();
        try {
          const res = await api(`/clients/${encodeURIComponent(clientId)}/calendar`, {
            method: 'PUT',
            body: {
              timezone: state.connection.timezone,
              calendarId: state.connection.calendarId,
              calendarSummary: state.connection.calendarSummary,
              hours: state.hours,
              services: state.services,
              rules: state.rules
            }
          });
          state = res.calendar;
          serviceDraft = null;
          busy = false;
          render();
          flash(state.ready ? 'Agenda lista' : 'Agenda guardada. Aún falta configuración.', state.ready ? 'ok' : 'err');
        } catch (err) {
          busy = false;
          render();
          fail(err);
        }
      });
    }

    container.innerHTML = '<section class="card calendar-card"><p class="muted">Cargando Google Calendar…</p></section>';
    api(`/clients/${encodeURIComponent(clientId)}/calendar`)
      .then((res) => {
        state = res.calendar;
        render();
      })
      .catch((err) => {
        container.innerHTML = `<section class="card calendar-card"><p class="error">${escapeHtml(err.message || 'No se pudo cargar Google Calendar')}</p></section>`;
        fail(err);
      });
  }

  window.CalendarPanel = { mount };
})();
