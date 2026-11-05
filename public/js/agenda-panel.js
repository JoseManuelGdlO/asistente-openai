(function () {
  const DAYS = [
    ['monday', 'Lunes'], ['tuesday', 'Martes'], ['wednesday', 'Miércoles'],
    ['thursday', 'Jueves'], ['friday', 'Viernes'], ['saturday', 'Sábado'], ['sunday', 'Domingo']
  ];

  function mount(container, options) {
    const { clientId, canEdit, api, escapeHtml, onState, onError } = options;
    let state = null;
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
      flash(err.message || 'Error en la agenda', 'err');
    }

    async function load() {
      const res = await api(`/clients/${encodeURIComponent(clientId)}/configuracion/agenda`);
      state = res.agenda;
      render();
      if (onState) onState(state);
    }

    function serviceRows() {
      return (state.services || []).map((service, index) => `
        <div class="stack" data-service-row="${index}">
          <label>Nombre <input data-svc-name value="${escapeHtml(service.name || '')}" ${canEdit ? '' : 'disabled'}></label>
          <label>Duración (min) <input type="number" min="5" data-svc-duration value="${escapeHtml(service.durationMinutes || 30)}" ${canEdit ? '' : 'disabled'}></label>
          <label>Cupo <input type="number" min="1" data-svc-capacity value="${escapeHtml(service.capacity || 1)}" ${canEdit ? '' : 'disabled'}></label>
          <label class="check"><input type="checkbox" data-svc-active ${service.active !== false ? 'checked' : ''} ${canEdit ? '' : 'disabled'}><span>Activo</span></label>
          <input type="hidden" data-svc-id value="${escapeHtml(service.id || '')}">
        </div>
      `).join('') || '<p class="muted">Sin servicios. Agrega uno.</p>';
    }

    function exceptionRows() {
      return (state.exceptions || []).map((item, index) => `
        <div class="stack" data-ex-row="${index}">
          <label>Fecha <input type="date" data-ex-date value="${escapeHtml(item.date || '')}" ${canEdit ? '' : 'disabled'}></label>
          <label class="check"><input type="checkbox" data-ex-closed ${item.closed !== false ? 'checked' : ''} ${canEdit ? '' : 'disabled'}><span>Cerrado todo el día</span></label>
          <label>Horario especial (si no está cerrado) inicio
            <input data-ex-start value="${escapeHtml(item.intervals?.[0]?.start || '')}" placeholder="09:00" ${canEdit ? '' : 'disabled'}>
          </label>
          <label>Fin
            <input data-ex-end value="${escapeHtml(item.intervals?.[0]?.end || '')}" placeholder="13:00" ${canEdit ? '' : 'disabled'}>
          </label>
        </div>
      `).join('') || '<p class="muted">Sin excepciones.</p>';
    }

    function hoursBlock() {
      return DAYS.map(([key, label]) => {
        const day = state.hours?.[key] || { enabled: false, intervals: [] };
        const interval = day.intervals?.[0] || { start: '09:00', end: '18:00' };
        return `
          <div class="stack" data-day="${key}">
            <label class="check">
              <input type="checkbox" data-day-enabled="${key}" ${day.enabled ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
              <span>${label}</span>
            </label>
            <div class="actions">
              <input data-day-start="${key}" value="${escapeHtml(interval.start || '')}" ${canEdit ? '' : 'disabled'}>
              <input data-day-end="${key}" value="${escapeHtml(interval.end || '')}" ${canEdit ? '' : 'disabled'}>
            </div>
          </div>
        `;
      }).join('');
    }

    function readPayload() {
      const hours = {};
      DAYS.forEach(([key]) => {
        const enabled = Boolean(container.querySelector(`[data-day-enabled="${key}"]`)?.checked);
        const start = container.querySelector(`[data-day-start="${key}"]`)?.value || '';
        const end = container.querySelector(`[data-day-end="${key}"]`)?.value || '';
        hours[key] = { enabled, intervals: enabled && start && end ? [{ start, end }] : [] };
      });
      const services = [...container.querySelectorAll('[data-service-row]')].map((row) => ({
        id: row.querySelector('[data-svc-id]')?.value || undefined,
        name: row.querySelector('[data-svc-name]')?.value || '',
        durationMinutes: Number(row.querySelector('[data-svc-duration]')?.value || 30),
        capacity: Number(row.querySelector('[data-svc-capacity]')?.value || 1),
        active: Boolean(row.querySelector('[data-svc-active]')?.checked)
      }));
      const exceptions = [...container.querySelectorAll('[data-ex-row]')].map((row) => {
        const date = row.querySelector('[data-ex-date]')?.value || '';
        const closed = Boolean(row.querySelector('[data-ex-closed]')?.checked);
        const start = row.querySelector('[data-ex-start]')?.value || '';
        const end = row.querySelector('[data-ex-end]')?.value || '';
        if (closed || !start || !end) return { date, closed: true };
        return { date, closed: false, intervals: [{ start, end }] };
      }).filter((item) => item.date);
      return {
        timezone: state.connection?.timezone || 'America/Mexico_City',
        hours,
        services,
        exceptions,
        rules: state.rules || {}
      };
    }

    function render() {
      if (!state) {
        container.innerHTML = '<section class="card stack"><p class="muted">Cargando agenda…</p></section>';
        return;
      }
      container.innerHTML = `
        <section class="card stack calendar-card">
          <h2>Agendar citas</h2>
          <p class="muted">${escapeHtml(state.phaseLabel || '')}</p>
          <label class="check">
            <input type="checkbox" id="agenda-enabled" ${state.enabled ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
            <span>Habilitar agenda</span>
          </label>
          <p class="muted">Google: ${escapeHtml(state.connection?.email || 'no conectado')} · ${escapeHtml(state.connection?.calendarSummary || '')}</p>
          <div class="actions">
            <button type="button" id="agenda-oauth" class="btn-secondary" ${canEdit ? '' : 'disabled'}>Conectar Google</button>
            <button type="button" id="agenda-disconnect" class="btn-secondary" ${canEdit ? '' : 'disabled'}>Desconectar</button>
            <button type="button" id="agenda-migrate" class="btn-secondary" ${canEdit ? '' : 'disabled'}>Migrar desde Calendar</button>
          </div>
          <h3>Horarios</h3>
          ${hoursBlock()}
          <h3>Servicios (con cupo)</h3>
          ${serviceRows()}
          <div class="actions">
            <button type="button" id="agenda-add-service" class="btn-secondary" ${canEdit ? '' : 'disabled'}>Agregar servicio</button>
          </div>
          <h3>Excepciones</h3>
          ${exceptionRows()}
          <div class="actions">
            <button type="button" id="agenda-add-exception" class="btn-secondary" ${canEdit ? '' : 'disabled'}>Agregar excepción</button>
            <button type="button" id="agenda-save" ${canEdit ? '' : 'disabled'}>Guardar agenda</button>
          </div>
        </section>
      `;
      bind();
    }

    function bind() {
      container.querySelector('#agenda-enabled')?.addEventListener('change', async (event) => {
        if (busy) return;
        busy = true;
        try {
          const res = await api(`/clients/${encodeURIComponent(clientId)}/configuracion/agenda/enabled`, {
            method: 'PUT',
            body: { enabled: event.target.checked }
          });
          state = res.agenda;
          flash('Agenda actualizada', 'ok');
          render();
          if (onState) onState(state);
        } catch (err) {
          fail(err);
          await load();
        } finally {
          busy = false;
        }
      });

      container.querySelector('#agenda-save')?.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        try {
          const res = await api(`/clients/${encodeURIComponent(clientId)}/configuracion/agenda/settings`, {
            method: 'PUT',
            body: readPayload()
          });
          state = res.agenda;
          flash('Configuración guardada', 'ok');
          render();
          if (onState) onState(state);
        } catch (err) {
          fail(err);
        } finally {
          busy = false;
        }
      });

      container.querySelector('#agenda-add-service')?.addEventListener('click', () => {
        state.services = (state.services || []).concat([{
          name: 'Nuevo servicio',
          durationMinutes: 30,
          capacity: 1,
          active: true
        }]);
        render();
      });

      container.querySelector('#agenda-add-exception')?.addEventListener('click', () => {
        state.exceptions = (state.exceptions || []).concat([{ date: '', closed: true }]);
        render();
      });

      container.querySelector('#agenda-oauth')?.addEventListener('click', async () => {
        try {
          const res = await api(`/clients/${encodeURIComponent(clientId)}/configuracion/agenda/oauth/start`, { method: 'POST' });
          if (res.url) window.location.href = res.url;
        } catch (err) {
          fail(err);
        }
      });

      container.querySelector('#agenda-disconnect')?.addEventListener('click', async () => {
        if (!window.confirm('¿Desconectar Google Calendar de esta agenda?')) return;
        try {
          const res = await api(`/clients/${encodeURIComponent(clientId)}/configuracion/agenda/disconnect`, { method: 'POST' });
          state = res.agenda;
          flash('Desconectado', 'ok');
          render();
        } catch (err) {
          fail(err);
        }
      });

      container.querySelector('#agenda-migrate')?.addEventListener('click', async () => {
        if (!window.confirm('Migrar datos del Calendar actual a la agenda v2 y activar el motor nuevo?')) return;
        try {
          await api(`/clients/${encodeURIComponent(clientId)}/configuracion/agenda/migrate`, { method: 'POST' });
          flash('Migración completada. Recarga el Assistant.', 'ok');
          await load();
        } catch (err) {
          fail(err);
        }
      });
    }

    load().catch(fail);
  }

  window.AgendaPanel = { mount };
})();
