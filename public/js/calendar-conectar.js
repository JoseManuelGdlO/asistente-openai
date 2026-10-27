(function () {
  const root = document.getElementById('calendar-connect-root');

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function route() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('conectar');
    const next = idx >= 0 ? decodeURIComponent(parts[idx + 1] || '') : '';
    if (next === 'listo') {
      return { kind: 'result', token: new URLSearchParams(window.location.search).get('r') || '' };
    }
    return { kind: 'invite', token: next };
  }

  function renderError(message) {
    root.innerHTML = `
      <h1>No se puede conectar</h1>
      <p class="error">${escapeHtml(message)}</p>
      <p class="muted">Si el link venció, pide uno nuevo a quien administra el bot.</p>
    `;
  }

  function tutorial(botName) {
    return `
      <h1>Conectar Google Calendar</h1>
      <p class="muted">Vas a conectar el calendario del negocio <strong>${escapeHtml(botName)}</strong>. No necesitas usuario del panel.</p>
      <div class="card vincular-card stack">
        <h2>Qué vas a ver en Google</h2>
        <p>Al pulsar el botón se abre Google. Sigue estos pasos y no cierres la ventana antes de volver aquí.</p>
        <ol class="connect-steps">
          <li>
            <span class="connect-step-num">1</span>
            <div>
              <strong>Elige la cuenta del negocio</strong>
              <p>En “Elige una cuenta”, pulsa el Gmail donde está la agenda. Si no aparece, pulsa <span class="connect-key">Usar otra cuenta</span> e inicia sesión.</p>
            </div>
          </li>
          <li>
            <span class="connect-step-num">2</span>
            <div>
              <strong>Si Google dice que no verificó la aplicación</strong>
              <p>Es normal mientras la app está en prueba. Pulsa <span class="connect-key">Configuración avanzada</span>. Si no ves ese texto, pulsa <span class="connect-key">Avanzado</span>.</p>
              <p>Después pulsa <span class="connect-key">Ir a … (no seguro)</span>. El nombre es el de la aplicación que muestra Google. No pulses Cancelar.</p>
            </div>
          </li>
          <li>
            <span class="connect-step-num">3</span>
            <div>
              <strong>Acepta el acceso al calendario</strong>
              <p>Google pide ver tu correo y administrar eventos del calendario. Si hay casillas, déjalas marcadas o pulsa <span class="connect-key">Seleccionar todo</span>.</p>
              <p>Pulsa <span class="connect-key">Continuar</span>. En algunas cuentas el botón dice <span class="connect-key">Permitir</span>.</p>
            </div>
          </li>
          <li>
            <span class="connect-step-num">4</span>
            <div>
              <strong>Espera a volver a esta página</strong>
              <p>Cuando termine, aquí dirá que el calendario quedó conectado y mostrará el correo. Hasta entonces no cierres la pestaña.</p>
            </div>
          </li>
        </ol>
      </div>
    `;
  }

  function renderPending(invite, token) {
    root.innerHTML = `
      ${tutorial(invite.botName || 'tu negocio')}
      <form id="calendar-connect-form" class="card stack">
        ${invite.oauthConfigured ? '' : '<p class="error">Quien administra el bot todavía no terminó la configuración de Google. Pídele que lo revise y vuelve a abrir este link.</p>'}
        <p id="calendar-connect-error" class="error" hidden></p>
        <div class="actions">
          <button type="submit" id="calendar-connect-btn" ${invite.oauthConfigured ? '' : 'disabled'}>Conectar mi Google Calendar</button>
        </div>
        <p class="muted">Al continuar, Google pedirá permiso para ver el calendario y crear citas. <a href="/privacidad">Aviso de privacidad</a>.</p>
      </form>
    `;

    const form = document.getElementById('calendar-connect-form');
    const errorEl = document.getElementById('calendar-connect-error');
    const button = document.getElementById('calendar-connect-btn');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!invite.oauthConfigured) return;
      errorEl.hidden = true;
      button.disabled = true;
      button.textContent = 'Abriendo Google…';
      try {
        const res = await fetch(`/public/calendar/invite/${encodeURIComponent(token)}/start`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error || 'No se pudo abrir Google');
        window.location.assign(data.url);
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
        button.disabled = false;
        button.textContent = 'Conectar mi Google Calendar';
      }
    });
  }

  function renderConnected(botName, email) {
    root.innerHTML = `
      <h1>Calendario conectado</h1>
      <div class="card vincular-card stack">
        <p>La cuenta <strong>${escapeHtml(email || 'de Google')}</strong> ya quedó ligada${botName ? ` al bot <strong>${escapeHtml(botName)}</strong>` : ''}.</p>
        <p class="muted">Ya puedes cerrar esta página. Quien administra el bot recibe el aviso en su panel.</p>
      </div>
    `;
  }

  function renderDenied() {
    root.innerHTML = `
      <h1>No se conectó</h1>
      <p>Google canceló el permiso. Vuelve a abrir el link y, en la última pantalla, pulsa <span class="connect-key">Continuar</span> o <span class="connect-key">Permitir</span>.</p>
    `;
  }

  function renderFailed() {
    root.innerHTML = `
      <h1>No se pudo conectar</h1>
      <p class="error">Google no terminó la autorización. Vuelve a abrir el link e inténtalo de nuevo.</p>
    `;
  }

  async function start() {
    const current = route();
    if (!current.token) {
      renderError(current.kind === 'result' ? 'Este resultado ya no está disponible.' : 'Falta el token del link.');
      return;
    }

    if (current.kind === 'result') {
      try {
        const res = await fetch(`/public/calendar/result?r=${encodeURIComponent(current.token)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Este resultado ya no está disponible.');
        if (data.kind === 'connected') renderConnected(data.botName, data.email);
        else if (data.kind === 'denied') renderDenied();
        else renderFailed();
      } catch (error) {
        renderError(error.message);
      }
      return;
    }

    try {
      const res = await fetch(`/public/calendar/invite/${encodeURIComponent(current.token)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Link inválido');
      if (data.status === 'connected') renderConnected(data.botName, data.email);
      else renderPending(data, current.token);
    } catch (error) {
      renderError(error.message);
    }
  }

  start();
})();
