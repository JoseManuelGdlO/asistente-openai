(function () {
  const { getToken, setToken, clearToken, api } = window.AdminApi;

  const loginView = document.getElementById('login-view');
  const appView = document.getElementById('app-view');
  const content = document.getElementById('content');
  const loginForm = document.getElementById('login-form');
  const loginEmail = document.getElementById('login-email');
  const loginPassword = document.getElementById('login-password');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function prettyJson(value, fallback) {
    try {
      return JSON.stringify(value ?? fallback, null, 2);
    } catch {
      return JSON.stringify(fallback, null, 2);
    }
  }

  function parseJsonField(text, label, emptyValue) {
    const raw = (text || '').trim();
    if (!raw) return { ok: true, value: emptyValue };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (err) {
      return { ok: false, error: `${label}: JSON inválido (${err.message})` };
    }
  }

  function formatBytes(size) {
    const n = Number(size) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function statusBadge(status) {
    const active = status === 'active';
    return `<span class="badge ${active ? 'badge-ok' : 'badge-off'}">${active ? 'Activo' : 'Inactivo'}</span>`;
  }

  function formatSessionDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  }

  function sessionLockBadge(session) {
    return session.isLocked
      ? '<span class="badge badge-warn">Locked</span>'
      : '<span class="badge badge-ok">Libre</span>';
  }

  function sessionDetailHref(session, fromClientId) {
    const userId = encodeURIComponent(session.userId || '');
    const clientCode = encodeURIComponent(session.clientCode || fromClientId || '');
    if (fromClientId) {
      return `#/clients/${encodeURIComponent(fromClientId)}/sesiones/${userId}`;
    }
    return `#/sessions/${userId}/${clientCode}`;
  }

  function sessionsTableHtml(sessions, { showClient = true, fromClientId = '' } = {}) {
    if (!sessions.length) return '<p class="empty">No hay conversaciones guardadas.</p>';
    return `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Usuario</th>
          ${showClient ? '<th>Bot</th>' : ''}
          <th>Último mensaje</th>
          <th>Lock</th>
          <th>Actualizado</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${sessions.map((session) => `
            <tr>
              <td>
                <a href="${sessionDetailHref(session, fromClientId)}">${escapeHtml(sessionLabel(session.userId))}</a>
                <div class="hint">${escapeHtml(session.userId || '')}</div>
              </td>
              ${showClient ? `<td>${escapeHtml(session.clientCode || '')}</td>` : ''}
              <td class="session-preview">${escapeHtml(session.lastUser || session.lastAssistant || '—')}</td>
              <td>${sessionLockBadge(session)}</td>
              <td>${escapeHtml(formatSessionDate(session.updatedAt))}</td>
              <td class="actions">
                <a class="btn btn-sm btn-secondary" href="${sessionDetailHref(session, fromClientId)}">Ver</a>
                <button type="button" class="btn btn-sm btn-danger"
                  data-del-user="${escapeHtml(session.userId || '')}"
                  data-del-client="${escapeHtml(session.clientCode || fromClientId || '')}">Eliminar</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>`;
  }

  function sessionLabel(userId) {
    if (!userId) return 'Sin usuario';
    if (String(userId).startsWith('playground_')) return 'Prueba del panel';
    return String(userId);
  }

  function sessionsPagerHtml(payload, hrefForPage) {
    const total = Number(payload.total ?? (payload.sessions || []).length);
    const page = Number(payload.page) || 1;
    const totalPages = Number(payload.totalPages) || 1;
    const start = total === 0 ? 0 : ((page - 1) * (Number(payload.limit) || 20)) + 1;
    const end = Math.min(total, start + (payload.sessions || []).length - 1);
    const prev = page > 1
      ? `<a class="btn btn-sm btn-secondary" href="${hrefForPage(page - 1)}">Anterior</a>`
      : '<span class="btn btn-sm btn-secondary" aria-disabled="true">Anterior</span>';
    const next = page < totalPages
      ? `<a class="btn btn-sm btn-secondary" href="${hrefForPage(page + 1)}">Siguiente</a>`
      : '<span class="btn btn-sm btn-secondary" aria-disabled="true">Siguiente</span>';
    return `
      <div class="pager">
        <p class="muted">${total === 0 ? 'Sin conversaciones' : `${start}–${end} de ${total}`}</p>
        <div class="pager-actions">${prev}<span class="muted">Página ${page} de ${totalPages}</span>${next}</div>
      </div>`;
  }

  function bindSessionDeletes(root, onDone) {
    root.querySelectorAll('[data-del-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.delUser;
        const clientCode = btn.dataset.delClient;
        if (!confirm(`¿Eliminar la sesión ${userId}_${clientCode}? El historial de esa conversación se perderá.`)) return;
        try {
          await api(
            `/sessions/${encodeURIComponent(userId)}/${encodeURIComponent(clientCode)}`,
            { method: 'DELETE' }
          );
          await onDone();
        } catch (err) {
          const flash = document.getElementById('sess-flash') || document.getElementById('form-flash');
          showFlash(flash, err.message, 'err');
        }
      });
    });
  }

  function showFlash(el, message, type) {
    if (!el) return;
    el.className = `flash ${type === 'ok' ? 'flash-ok' : 'flash-err'}`;
    el.textContent = message;
    el.hidden = false;
  }

  function playgroundUserId(clientId) {
    return `playground_${clientId}`;
  }

  function parseAssistantText(content) {
    const text = typeof content === 'string' ? content : '';
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.reply === 'string') return parsed.reply;
    } catch {
      // texto plano
    }
    return text;
  }

  function playgroundItemsToEvents(items) {
    const events = [];
    const pending = new Map();
    for (const item of items || []) {
      if (item.type === 'message') {
        const role = item.role === 'user' ? 'user' : 'assistant';
        let raw = '';
        if (typeof item.content === 'string') raw = item.content;
        else if (Array.isArray(item.content)) {
          raw = item.content.map((part) => (
            typeof part === 'string' ? part : (part?.text || '')
          )).join('');
        }
        const text = role === 'assistant' ? parseAssistantText(raw) : raw;
        events.push({ kind: 'message', role, text });
      } else if (item.type === 'function_call') {
        let args = {};
        try {
          args = JSON.parse(item.arguments || '{}');
        } catch {
          args = {};
        }
        pending.set(item.call_id, { name: item.name, arguments: args });
      } else if (item.type === 'function_call_output') {
        const call = pending.get(item.call_id) || { name: 'tool', arguments: {} };
        pending.delete(item.call_id);
        let result = {};
        try {
          result = JSON.parse(item.output || '{}');
        } catch {
          result = { error: String(item.output || 'error') };
        }
        events.push({ kind: 'tool', name: call.name, arguments: call.arguments, result });
      }
    }
    // Tools se ejecutan antes del reply en el historial; mostrar texto y luego PDF
    return reorderPlaygroundEvents(events);
  }

  function reorderPlaygroundEvents(events) {
    const out = [];
    let pendingTools = [];
    for (const event of events) {
      if (event.kind === 'tool') {
        pendingTools.push(event);
        continue;
      }
      if (event.kind === 'message' && event.role === 'assistant') {
        out.push(event);
        out.push(...pendingTools);
        pendingTools = [];
        continue;
      }
      if (pendingTools.length) {
        out.push(...pendingTools);
        pendingTools = [];
      }
      out.push(event);
    }
    if (pendingTools.length) out.push(...pendingTools);
    return out;
  }

  function toolBadgeHtml(event) {
    const result = event.result || {};
    if (result.success) {
      const label = result.filename || result.documento_id || event.arguments?.documento_id || event.name;
      return `<div class="playground-badge playground-badge-ok">PDF simulado: ${escapeHtml(label)}</div>`;
    }
    const err = result.error || 'error';
    return `<div class="playground-badge playground-badge-err">${escapeHtml(event.name || 'tool')}: ${escapeHtml(err)}</div>`;
  }

  function playgroundEventHtml(event) {
    if (event.kind === 'status') {
      return `<div class="playground-status-msg">${escapeHtml(event.text || '')}</div>`;
    }
    if (event.kind === 'tool') return toolBadgeHtml(event);
    const pending = event.pending ? ' pending' : '';
    const cls = event.role === 'user' ? 'playground-msg user' : 'playground-msg assistant';
    return `<div class="${cls}${pending}">${escapeHtml(event.text || '')}</div>`;
  }

  function renderPlaygroundLog(logEl, events) {
    if (!logEl) return;
    if (!events.length) {
      logEl.innerHTML = '<p class="muted playground-empty">Aún no hay mensajes. Prueba el Assistant guardado.</p>';
      return;
    }
    logEl.innerHTML = events.map(playgroundEventHtml).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function appendPlaygroundEvents(logEl, events) {
    if (!logEl || !events.length) return;
    const empty = logEl.querySelector('.playground-empty');
    if (empty) empty.remove();
    logEl.insertAdjacentHTML('beforeend', events.map(playgroundEventHtml).join(''));
    logEl.scrollTop = logEl.scrollHeight;
  }

  function parseRoute() {
    const hash = (location.hash || '#/').replace(/^#/, '') || '/';
    const qIndex = hash.indexOf('?');
    const path = qIndex >= 0 ? hash.slice(0, qIndex) : hash;
    const query = new URLSearchParams(qIndex >= 0 ? hash.slice(qIndex + 1) : '');
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return { name: 'dashboard' };
    if (parts[0] === 'sessions' && parts[1] && parts[2]) {
      return {
        name: 'session-detail',
        userId: decodeURIComponent(parts[1]),
        clientCode: decodeURIComponent(parts[2])
      };
    }
    if (parts[0] === 'sessions') {
      return {
        name: 'sessions',
        userId: (query.get('userId') || '').trim(),
        clientCode: (query.get('clientCode') || '').trim(),
        page: query.get('page') || '1'
      };
    }
    if (parts[0] === 'clients' && parts[1] === 'new') return { name: 'client-new' };
    if (parts[0] === 'clients' && parts[1] && parts[2] === 'sesiones' && parts[3]) {
      return {
        name: 'session-detail',
        clientId: decodeURIComponent(parts[1]),
        userId: decodeURIComponent(parts[3]),
        clientCode: decodeURIComponent(parts[1])
      };
    }
    if (parts[0] === 'clients' && parts[1]) {
      return {
        name: 'client-detail',
        clientId: decodeURIComponent(parts[1]),
        tab: parts[2] || 'consultorio',
        page: query.get('page') || '1'
      };
    }
    if (parts[0] === 'clients') return { name: 'clients' };
    return { name: 'dashboard' };
  }

  function setActiveNav(name) {
    let nav = name;
    if (name === 'client-detail' || name === 'client-new') nav = 'clients';
    if (name === 'session-detail') {
      nav = location.hash.includes('/clients/') ? 'clients' : 'sessions';
    }
    document.querySelectorAll('[data-nav]').forEach((link) => {
      link.classList.toggle('active', link.dataset.nav === nav);
    });
  }

  function showLogin(message) {
    appView.hidden = true;
    loginView.hidden = false;
    loginError.hidden = !message;
    loginError.textContent = message || '';
  }

  function showApp() {
    loginView.hidden = true;
    appView.hidden = false;
  }

  function clearHash() {
    if (location.hash) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function goToHash(hash) {
    if (location.hash === hash) {
      render();
      return;
    }
    location.hash = hash;
  }

  function requireAuth() {
    if (!getToken()) {
      showLogin();
      return false;
    }
    showApp();
    return true;
  }

  async function probeAuth() {
    await api('/clients/status');
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    if (!email || !password) return;
    try {
      const res = await fetch('/auth/login/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        clearToken();
        showLogin(data.error || 'Correo o contraseña incorrectos');
        return;
      }
      setToken(data.token);
      await probeAuth();
      loginPassword.value = '';
      loginError.hidden = true;
      showApp();
      goToHash('#/');
    } catch (err) {
      clearToken();
      showLogin(err.status === 503
        ? 'El inicio de sesión no está configurado en el servidor'
        : (err.message || 'No se pudo iniciar sesión'));
    }
  });

  logoutBtn.addEventListener('click', () => {
    clearToken();
    clearHash();
    showLogin();
  });

  window.addEventListener('auth:required', () => {
    clearToken();
    clearHash();
    showLogin('Sesión expirada. Vuelve a iniciar sesión.');
  });

  window.addEventListener('hashchange', render);

  async function render() {
    if (!requireAuth()) return;
    const route = parseRoute();
    setActiveNav(route.name);
    content.innerHTML = '<p class="muted">Cargando…</p>';
    try {
      if (route.name === 'dashboard') await renderDashboard();
      else if (route.name === 'sessions') await renderSessions(route);
      else if (route.name === 'session-detail') await renderSessionDetail(route);
      else if (route.name === 'clients') await renderClients();
      else if (route.name === 'client-new') renderClientForm();
      else if (route.name === 'client-detail') await renderClientDetail(route.clientId, route.tab, route.page);
      else await renderDashboard();
    } catch (err) {
      if (err.status === 401 || err.status === 503) return;
      content.innerHTML = `<div class="card"><p class="error">${escapeHtml(err.message)}</p></div>`;
    }
  }

  async function settledValue(promise, fallback) {
    const result = await Promise.allSettled([promise]);
    if (result[0].status === 'fulfilled') return result[0].value;
    return fallback;
  }

  async function renderDashboard() {
    const [health, botsRes, scheduler, ultramsg, clientsStatus] = await Promise.all([
      settledValue(api('/health'), { status: '—' }),
      settledValue(api('/bots/status'), { bots: {} }),
      settledValue(api('/scheduler/status'), {}),
      settledValue(api('/ultramsg/instances'), { instances: [], error: 'No se pudo consultar UltraMsg' }),
      settledValue(api('/clients/status'), { clients: [] })
    ]);

    const bots = botsRes.bots || {};
    const botRows = Object.entries(bots);
    const instances = ultramsg.instances || [];
    const clients = clientsStatus.clients || [];
    const tasks = scheduler.tasks || scheduler || {};
    const ultramsgNote = ultramsg.error || '';

    content.innerHTML = `
      <div class="page-head">
        <h1>Dashboard</h1>
        <div class="actions">
          <button type="button" id="reload-clients" class="btn-secondary">Recargar clientes</button>
        </div>
      </div>
      <div id="dash-flash" hidden></div>
      <div class="grid grid-3" style="margin-bottom:1rem">
        <div class="card stat">
          <span class="label">API</span>
          <span class="value">${escapeHtml(health.status || 'OK')}</span>
        </div>
        <div class="card stat">
          <span class="label">Bots</span>
          <span class="value">${clients.length}</span>
        </div>
        <div class="card stat">
          <span class="label">Instancias UltraMsg</span>
          <span class="value">${instances.length}</span>
        </div>
      </div>
      <div class="grid grid-2">
        <div class="card">
          <h2>Bots</h2>
          ${botRows.length === 0 ? '<p class="empty">No hay bots cargados.</p>' : `
            <div class="table-wrap"><table>
              <thead><tr><th>Bot</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                ${botRows.map(([id, bot]) => `
                  <tr>
                    <td><a href="#/clients/${encodeURIComponent(id)}">${escapeHtml(bot.name || id)}</a><div class="hint">${escapeHtml(id)}</div></td>
                    <td>${statusBadge(bot.status)}</td>
                    <td class="actions">
                      <button type="button" class="btn-sm btn-secondary" data-bot="${escapeHtml(id)}" data-cmd="/on" data-phone="${escapeHtml(bot.adminPhone || '')}">On</button>
                      <button type="button" class="btn-sm btn-secondary" data-bot="${escapeHtml(id)}" data-cmd="/off" data-phone="${escapeHtml(bot.adminPhone || '')}">Off</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table></div>`}
        </div>
        <div class="card">
          <h2>UltraMsg</h2>
          ${ultramsgNote ? `<p class="hint">${escapeHtml(ultramsgNote)}</p>` : ''}
          ${instances.length === 0 ? '<p class="empty">Sin instancias.</p>' : `
            <div class="table-wrap"><table>
              <thead><tr><th>Instancia</th><th>Estado</th></tr></thead>
              <tbody>
                ${instances.map((inst) => {
                  const connected = inst.status && inst.status.connected;
                  const reason = inst.status && inst.status.error;
                  return `<tr>
                    <td>${escapeHtml(inst.name || inst.instanceId)}<div class="hint">${escapeHtml(inst.instanceId)}</div></td>
                    <td>${connected
                      ? '<span class="badge badge-ok">Conectado</span>'
                      : `<span class="badge badge-off">Desconectado</span>${reason ? `<div class="hint">${escapeHtml(reason)}</div>` : ''}`}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table></div>`}
        </div>
      </div>
      <div class="card" style="margin-top:1rem">
        <h2>Scheduler</h2>
        <pre class="muted" style="white-space:pre-wrap;font-family:var(--mono);font-size:0.82rem">${escapeHtml(prettyJson(tasks, {}))}</pre>
      </div>
    `;

    document.getElementById('reload-clients').addEventListener('click', async () => {
      const flash = document.getElementById('dash-flash');
      try {
        const result = await api('/clients/reload', { method: 'POST' });
        showFlash(flash, result.message || 'Clientes recargados', 'ok');
        setTimeout(render, 600);
      } catch (err) {
        showFlash(flash, err.message, 'err');
      }
    });

    content.querySelectorAll('[data-bot]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const flash = document.getElementById('dash-flash');
        try {
          await api('/bots/command', {
            method: 'POST',
            body: {
              clientId: btn.dataset.bot,
              command: btn.dataset.cmd,
              phoneNumber: btn.dataset.phone
            }
          });
          showFlash(flash, `Comando ${btn.dataset.cmd} enviado`, 'ok');
          setTimeout(render, 400);
        } catch (err) {
          showFlash(flash, err.message, 'err');
        }
      });
    });
  }

  async function renderSessions(route) {
    const userId = route.userId || '';
    const clientCode = route.clientCode || '';
    const query = new URLSearchParams();
    if (userId) query.set('userId', userId);
    if (clientCode) query.set('clientCode', clientCode);
    if (route.page && String(route.page) !== '1') query.set('page', String(route.page));
    query.set('limit', '20');
    const payload = await api(`/sessions?${query}`);
    const sessions = payload.sessions || [];
    const hrefForPage = (page) => {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (clientCode) params.set('clientCode', clientCode);
      if (page > 1) params.set('page', String(page));
      const q = params.toString();
      return q ? `#/sessions?${q}` : '#/sessions';
    };

    content.innerHTML = `
      <div class="page-head">
        <h1>Sesiones</h1>
        <div class="actions">
          <button type="button" id="reset-all-sessions" class="btn-danger">Resetear todas</button>
        </div>
      </div>
      <div id="sess-flash" hidden></div>
      <form id="sess-filters" class="card stack" style="margin-bottom:1rem">
        <div class="grid grid-2">
          <div>
            <label for="filter-user">Usuario</label>
            <input id="filter-user" type="text" value="${escapeHtml(userId)}" placeholder="52155…">
          </div>
          <div>
            <label for="filter-client">Bot</label>
            <input id="filter-client" type="text" value="${escapeHtml(clientCode)}" placeholder="CLIENTE001">
          </div>
        </div>
        <div class="actions">
          <button type="submit">Filtrar</button>
          <a class="btn btn-secondary" href="#/sessions">Limpiar</a>
        </div>
      </form>
      <div class="card">
        ${sessionsPagerHtml(payload, hrefForPage)}
        ${sessionsTableHtml(sessions, { showClient: true })}
        ${sessionsPagerHtml(payload, hrefForPage)}
      </div>
    `;

    document.getElementById('sess-filters').addEventListener('submit', (event) => {
      event.preventDefault();
      const params = new URLSearchParams();
      const nextUser = document.getElementById('filter-user').value.trim();
      const nextClient = document.getElementById('filter-client').value.trim();
      if (nextUser) params.set('userId', nextUser);
      if (nextClient) params.set('clientCode', nextClient);
      const q = params.toString();
      goToHash(q ? `#/sessions?${q}` : '#/sessions');
    });

    document.getElementById('reset-all-sessions').addEventListener('click', async () => {
      if (!confirm('¿Borrar TODAS las sesiones de todos los bots? Esta acción no se puede deshacer.')) return;
      const flash = document.getElementById('sess-flash');
      try {
        const result = await api('/reset_sessions', { method: 'POST' });
        showFlash(flash, result.message || `Sesiones reseteadas (${result.deleted ?? 0})`, 'ok');
        setTimeout(render, 400);
      } catch (err) {
        showFlash(flash, err.message, 'err');
      }
    });

    bindSessionDeletes(content, render);
  }

  async function renderSessionDetail(route) {
    const userId = route.userId;
    const clientCode = route.clientCode || route.clientId;
    const backHref = route.clientId
      ? `#/clients/${encodeURIComponent(route.clientId)}/sesiones`
      : '#/sessions';
    const payload = await api(`/sessions/${encodeURIComponent(userId)}/${encodeURIComponent(clientCode)}`);
    const session = payload.session || {};
    const events = playgroundItemsToEvents(session.items || []);
    const pending = (session.pendingMessages || []).map((text) => ({
      kind: 'message',
      role: 'user',
      text,
      pending: true
    }));
    const allEvents = events.concat(pending);
    let botName = clientCode;
    try {
      const clientRes = await api(`/clients/${encodeURIComponent(clientCode)}`);
      botName = clientRes.client?.name || clientCode;
    } catch {
      // el listado global puede no tener ficha si el bot se borró
    }

    content.innerHTML = `
      <div class="page-head">
        <div>
          <h1>${escapeHtml(sessionLabel(userId))}</h1>
          <p class="muted">${escapeHtml(botName)} · ${escapeHtml(userId)}</p>
        </div>
        <div class="actions">
          <a class="btn btn-secondary" href="${backHref}">Volver</a>
          <button type="button" id="delete-this-session" class="btn-danger">Eliminar conversación</button>
        </div>
      </div>
      <div id="sess-flash" hidden></div>
      <div class="card stack session-meta">
        <p>Actualizada ${escapeHtml(formatSessionDate(session.updatedAt))} · ${session.locked ? 'Sesión ocupada' : 'Libre'} · ${escapeHtml(String((session.items || []).length))} mensajes en historial</p>
      </div>
      <div class="card transcript-card">
        ${allEvents.length
          ? `<div class="playground-log transcript-log">${allEvents.map(playgroundEventHtml).join('')}</div>`
          : '<p class="empty">Esta conversación no tiene mensajes todavía.</p>'}
      </div>
    `;

    document.getElementById('delete-this-session').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar la conversación de ${userId}? El historial se perderá.`)) return;
      try {
        await api(`/sessions/${encodeURIComponent(userId)}/${encodeURIComponent(clientCode)}`, { method: 'DELETE' });
        location.hash = backHref;
      } catch (err) {
        showFlash(document.getElementById('sess-flash'), err.message, 'err');
      }
    });
  }

  function clientsFromPayload(payload) {
    const raw = payload.clients || {};
    if (Array.isArray(raw)) return raw;
    return Object.entries(raw).map(([id, client]) => ({ id, ...client }));
  }

  async function renderClients() {
    const payload = await api('/clients');
    const clients = clientsFromPayload(payload);

    content.innerHTML = `
      <div class="page-head">
        <h1>Bots</h1>
        <a class="btn" href="#/clients/new">Nuevo bot</a>
      </div>
      <div class="card">
        ${clients.length === 0 ? '<p class="empty">No hay bots.</p>' : `
          <div class="table-wrap"><table>
            <thead><tr><th>Nombre</th><th>Admin</th><th>WhatsApp</th><th>Bot</th><th></th></tr></thead>
            <tbody>
              ${clients.map((client) => `
                <tr>
                  <td><a href="#/clients/${encodeURIComponent(client.id)}">${escapeHtml(client.name || client.id)}</a><div class="hint">${escapeHtml(client.id)}</div></td>
                  <td>${escapeHtml(client.adminPhone || '')}</td>
                  <td>${escapeHtml(channelLabel(client))}</td>
                  <td>${statusBadge(client.botStatus)}</td>
                  <td class="actions">
                    <a class="btn btn-sm btn-secondary" href="#/clients/${encodeURIComponent(client.id)}">Editar</a>
                    <button type="button" class="btn btn-sm btn-danger" data-delete="${escapeHtml(client.id)}" data-name="${escapeHtml(client.name || client.id)}">Eliminar</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table></div>`}
      </div>
    `;

    content.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar el bot "${btn.dataset.name}"? Esta acción hace soft-delete del par cliente + Assistant.`)) return;
        try {
          await api(`/clients/${encodeURIComponent(btn.dataset.delete)}`, { method: 'DELETE' });
          render();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function channelLabel(client) {
    if (client.meta?.connected) {
      return client.meta.displayPhone || 'Meta';
    }
    if (client.hasUltraMsg) return 'UltraMsg';
    if (client.meta?.inviteStatus === 'expired') return 'Link vencido';
    return 'Pendiente de vincular';
  }

  function clientFormFields(client = {}, isEdit) {
    const hasUltraMsg = Boolean(client.hasUltraMsg || client.ULTRAMSG_INSTANCE_ID);
    const hasToken = Boolean(client.ULTRAMSG_TOKEN);
    const hasInstance = Boolean(client.ULTRAMSG_INSTANCE_ID);
    const hasWebhook = Boolean(client.ULTRAMSG_WEBHOOK_TOKEN);
    return `
      ${isEdit ? '' : `
        <div>
          <label for="client-id">ID (opcional)</label>
          <input id="client-id" type="text" placeholder="DEMO001">
          <p class="hint">Si lo dejas vacío, Firestore genera el ID.</p>
        </div>`}
      <div>
        <label for="client-name">Nombre</label>
        <input id="client-name" type="text" required value="${escapeHtml(client.name || '')}">
      </div>
      <div class="grid grid-2">
        <div>
          <label for="client-admin">Teléfono admin</label>
          <input id="client-admin" type="text" required value="${escapeHtml(client.adminPhone || '')}">
        </div>
        <div>
          <label for="client-assistant">Teléfono del bot</label>
          <input id="client-assistant" type="text" value="${escapeHtml(client.assistantPhone || '')}" placeholder="${isEdit ? '' : 'Se llena al vincular WhatsApp'}">
        </div>
      </div>
      <div>
        <label for="client-bot-status">Estado del bot</label>
        <select id="client-bot-status">
          <option value="active" ${client.botStatus !== 'inactive' ? 'selected' : ''}>Activo</option>
          <option value="inactive" ${client.botStatus === 'inactive' ? 'selected' : ''}>Inactivo</option>
        </select>
      </div>
      ${isEdit && hasUltraMsg ? `
      <div>
        <label for="client-instance">UltraMsg instance ID</label>
        <input id="client-instance" type="text" value="" placeholder="${hasInstance ? 'Configurado — deja vacío para no cambiar' : ''}">
      </div>
      <div class="grid grid-2">
        <div>
          <label for="client-token">UltraMsg token</label>
          <input id="client-token" type="password" autocomplete="new-password" placeholder="${hasToken ? 'Configurado — deja vacío para no cambiar' : ''}">
        </div>
        <div>
          <label for="client-webhook">UltraMsg webhook token</label>
          <input id="client-webhook" type="password" autocomplete="new-password" placeholder="${hasWebhook ? 'Configurado — deja vacío para no cambiar' : ''}">
        </div>
      </div>` : ''}
      ${isEdit ? '' : `
        <div>
          <label for="client-prompt">Prompt inicial (opcional)</label>
          <textarea id="client-prompt" class="prompt" placeholder="Se puede editar después en la pestaña Assistant"></textarea>
        </div>`}
    `;
  }

  function readClientForm(isEdit) {
    const body = {
      name: document.getElementById('client-name').value.trim(),
      adminPhone: document.getElementById('client-admin').value.trim(),
      botStatus: document.getElementById('client-bot-status').value
    };
    const assistantPhone = document.getElementById('client-assistant').value.trim();
    if (assistantPhone) body.assistantPhone = assistantPhone;
    if (!isEdit) {
      const id = document.getElementById('client-id').value.trim();
      if (id) body.id = id;
      const prompt = document.getElementById('client-prompt').value;
      if (prompt) body.prompt = prompt;
    }
    const instanceEl = document.getElementById('client-instance');
    const tokenEl = document.getElementById('client-token');
    const webhookEl = document.getElementById('client-webhook');
    const instanceId = instanceEl ? instanceEl.value.trim() : '';
    const token = tokenEl ? tokenEl.value.trim() : '';
    const webhook = webhookEl ? webhookEl.value.trim() : '';
    if (instanceId) body.ULTRAMSG_INSTANCE_ID = instanceId;
    if (token) body.ULTRAMSG_TOKEN = token;
    if (webhook) body.ULTRAMSG_WEBHOOK_TOKEN = webhook;
    return body;
  }

  function renderClientForm() {
    content.innerHTML = `
      <div class="page-head">
        <h1>Nuevo bot</h1>
        <a class="btn-secondary btn" href="#/clients">Volver</a>
      </div>
      <div id="form-flash" hidden></div>
      <form id="client-form" class="card stack">
        ${clientFormFields({}, false)}
        <div class="actions">
          <button type="submit">Crear bot</button>
        </div>
      </form>
    `;

    document.getElementById('client-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const flash = document.getElementById('form-flash');
      const body = readClientForm(false);
      try {
        const result = await api('/clients', { method: 'POST', body });
        if (result.inviteUrl) {
          sessionStorage.setItem(`inviteUrl:${result.client.id}`, result.inviteUrl);
        }
        location.hash = `#/clients/${encodeURIComponent(result.client.id)}`;
      } catch (err) {
        showFlash(flash, err.message, 'err');
      }
    });
  }

  async function renderClientDetail(clientId, tab, page) {
    const currentTab = ['consultorio', 'assistant', 'documentos', 'sesiones'].includes(tab) ? tab : 'consultorio';
    const clientRes = await api(`/clients/${encodeURIComponent(clientId)}`);
    const client = clientRes.client;

    content.innerHTML = `
      <div class="page-head">
        <div>
          <h1>${escapeHtml(client.name || clientId)}</h1>
          <p class="muted">${escapeHtml(clientId)}</p>
        </div>
        <a class="btn-secondary btn" href="#/clients">Volver</a>
      </div>
      <nav class="tabs">
        <a href="#/clients/${encodeURIComponent(clientId)}" class="${currentTab === 'consultorio' ? 'active' : ''}">Bot</a>
        <a href="#/clients/${encodeURIComponent(clientId)}/assistant" class="${currentTab === 'assistant' ? 'active' : ''}">Assistant</a>
        <a href="#/clients/${encodeURIComponent(clientId)}/documentos" class="${currentTab === 'documentos' ? 'active' : ''}">Documentos</a>
        <a href="#/clients/${encodeURIComponent(clientId)}/sesiones" class="${currentTab === 'sesiones' ? 'active' : ''}">Sesiones</a>
      </nav>
      <div id="detail-body"></div>
    `;

    const body = document.getElementById('detail-body');
    if (currentTab === 'assistant') {
      await renderAssistantTab(body, clientId);
    } else if (currentTab === 'documentos') {
      await renderDocumentsTab(body, clientId);
    } else if (currentTab === 'sesiones') {
      await renderSessionsTab(body, clientId, page);
    } else {
      renderConsultorioTab(body, client);
    }
  }

  function metaStatusCopy(client) {
    const meta = client.meta || {};
    if (meta.connected) {
      return {
        title: 'WhatsApp conectado',
        body: `${meta.displayPhone || 'Número vinculado'}${meta.coexistenceEnabled ? ' · coexistencia activa' : ''}`
      };
    }
    if (meta.inviteStatus === 'expired') {
      return { title: 'Link vencido', body: 'Genera un link nuevo para que el dueño del WhatsApp lo vincule.' };
    }
    return { title: 'Pendiente de vincular', body: 'Comparte el link con el dueño del WhatsApp para conectar Meta.' };
  }

  function renderConsultorioTab(container, client) {
    const storedInvite = sessionStorage.getItem(`inviteUrl:${client.id}`) || '';
    const status = metaStatusCopy(client);
    container.innerHTML = `
      <div id="form-flash" hidden></div>
      <div class="card stack">
        <h2>${escapeHtml(status.title)}</h2>
        <p class="muted">${escapeHtml(status.body)}</p>
        ${storedInvite && !client.meta?.connected ? `
          <div class="invite-box">
            <code id="invite-url">${escapeHtml(storedInvite)}</code>
            <div class="actions">
              <button type="button" class="btn-secondary" id="copy-invite">Copiar link</button>
            </div>
          </div>` : ''}
        <div class="actions">
          ${client.meta?.connected
            ? '<button type="button" class="btn-secondary" id="disconnect-meta">Desconectar WhatsApp</button>'
            : '<button type="button" id="regen-invite">Generar link de vinculación</button>'}
        </div>
      </div>
      <form id="client-form" class="card stack">
        ${clientFormFields(client, true)}
        <div class="actions">
          <button type="submit">Guardar bot</button>
          <button type="button" id="delete-client" class="btn-danger">Eliminar</button>
        </div>
      </form>
    `;

    document.getElementById('client-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const flash = document.getElementById('form-flash');
      const body = readClientForm(true);
      try {
        await api(`/clients/${encodeURIComponent(client.id)}`, { method: 'PUT', body });
        showFlash(flash, 'Bot actualizado', 'ok');
      } catch (err) {
        showFlash(flash, err.message, 'err');
      }
    });

    document.getElementById('delete-client').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar el bot "${client.name}"?`)) return;
      try {
        await api(`/clients/${encodeURIComponent(client.id)}`, { method: 'DELETE' });
        location.hash = '#/clients';
      } catch (err) {
        showFlash(document.getElementById('form-flash'), err.message, 'err');
      }
    });

    const copyBtn = document.getElementById('copy-invite');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const url = document.getElementById('invite-url')?.textContent || '';
        try {
          await navigator.clipboard.writeText(url);
          showFlash(document.getElementById('form-flash'), 'Link copiado', 'ok');
        } catch {
          showFlash(document.getElementById('form-flash'), 'No se pudo copiar el link', 'err');
        }
      });
    }

    const regenBtn = document.getElementById('regen-invite');
    if (regenBtn) {
      regenBtn.addEventListener('click', async () => {
        try {
          const result = await api(`/clients/${encodeURIComponent(client.id)}/meta/invite`, { method: 'POST' });
          if (result.inviteUrl) {
            sessionStorage.setItem(`inviteUrl:${client.id}`, result.inviteUrl);
          }
          showFlash(document.getElementById('form-flash'), 'Link generado. Copia y envíalo al dueño del WhatsApp.', 'ok');
          render();
        } catch (err) {
          showFlash(document.getElementById('form-flash'), err.message, 'err');
        }
      });
    }

    const disconnectBtn = document.getElementById('disconnect-meta');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', async () => {
        if (!confirm('¿Desconectar WhatsApp de este bot? El dueño tendrá que volver a vincular.')) return;
        try {
          const result = await api(`/clients/${encodeURIComponent(client.id)}/meta/disconnect`, { method: 'POST' });
          if (result.inviteUrl) {
            sessionStorage.setItem(`inviteUrl:${client.id}`, result.inviteUrl);
          }
          render();
        } catch (err) {
          showFlash(document.getElementById('form-flash'), err.message, 'err');
        }
      });
    }
  }

  async function renderAssistantTab(container, clientId) {
    let assistant;
    try {
      const res = await api(`/assistants/${encodeURIComponent(clientId)}`);
      assistant = res.assistant;
    } catch (err) {
      container.innerHTML = `<div class="card"><p class="error">${escapeHtml(err.message)}</p></div>`;
      return;
    }

    container.innerHTML = `
      <div id="form-flash" hidden></div>
      <div class="assistant-layout">
        <form id="assistant-form" class="card stack">
          <p class="muted">El prompt es el cerebro del bot. Tools, config y responseSchema se editan como JSON.</p>
          <div>
            <label for="asst-prompt">Prompt</label>
            <textarea id="asst-prompt" class="prompt">${escapeHtml(assistant.prompt || '')}</textarea>
          </div>
          <div>
            <div class="page-head" style="margin:0">
              <label for="asst-tools">Tools (JSON)</label>
              <button type="button" class="btn-sm btn-secondary" data-pretty="asst-tools">Formatear JSON</button>
            </div>
            <textarea id="asst-tools" class="json">${escapeHtml(prettyJson(assistant.tools || [], []))}</textarea>
          </div>
          <div>
            <div class="page-head" style="margin:0">
              <label for="asst-config">Config (JSON)</label>
              <button type="button" class="btn-sm btn-secondary" data-pretty="asst-config">Formatear JSON</button>
            </div>
            <textarea id="asst-config" class="json">${escapeHtml(prettyJson(assistant.config || {}, {}))}</textarea>
          </div>
          <div>
            <div class="page-head" style="margin:0">
              <label for="asst-schema">responseSchema (JSON)</label>
              <button type="button" class="btn-sm btn-secondary" data-pretty="asst-schema">Formatear JSON</button>
            </div>
            <textarea id="asst-schema" class="json">${escapeHtml(prettyJson(assistant.responseSchema || {}, {}))}</textarea>
          </div>
          <label class="check">
            <input type="checkbox" id="asst-reset-sessions">
            <span>Resetear conversaciones de este bot al guardar</span>
          </label>
          <div class="actions">
            <button type="submit">Guardar Assistant</button>
            <button type="button" id="asst-reset-only" class="btn-secondary">Solo resetear sesiones</button>
          </div>
        </form>
        <aside class="card playground-card stack">
          <div class="page-head" style="margin:0">
            <h2 class="playground-title">Probar Assistant</h2>
            <button type="button" id="playground-reset" class="btn-sm btn-secondary">Nueva conversación</button>
          </div>
          <p class="muted">Usa el Assistant guardado. Gasta tokens de OpenAI. No envía WhatsApp. Varios mensajes seguidos se juntan (debounce) como en WhatsApp.</p>
          <div id="playground-log" class="playground-log"></div>
          <form id="playground-form" class="playground-composer">
            <textarea id="playground-input" rows="3" placeholder="Escribe un mensaje de prueba…"></textarea>
            <button type="submit" id="playground-send">Enviar</button>
          </form>
        </aside>
      </div>
    `;

    container.querySelectorAll('[data-pretty]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const textarea = document.getElementById(btn.dataset.pretty);
        const parsed = parseJsonField(textarea.value, 'JSON', textarea.id === 'asst-tools' ? [] : {});
        const flash = document.getElementById('form-flash');
        if (!parsed.ok) {
          showFlash(flash, parsed.error, 'err');
          return;
        }
        textarea.value = prettyJson(parsed.value, parsed.value);
        showFlash(flash, 'JSON formateado', 'ok');
      });
    });

    const playgroundLog = document.getElementById('playground-log');
    const playgroundInput = document.getElementById('playground-input');
    let playgroundWatchId = 0;

    function playgroundEventsFromState(res) {
      const events = playgroundItemsToEvents(res.items || []);
      for (const text of res.pendingMessages || []) {
        events.push({ kind: 'message', role: 'user', text, pending: true });
      }
      if ((res.pendingMessages || []).length) {
        const waitMs = Number(res.debounceMs) || 2500;
        events.push({
          kind: 'status',
          text: `En cola: se mandará a la IA tras ~${Math.round(waitMs / 1000)}s de silencio (lote unido).`
        });
      } else if (res.locked) {
        events.push({ kind: 'status', text: 'La IA está respondiendo… los mensajes de ahora se ignoran.' });
      }
      return events;
    }

    function clearPlaygroundLog() {
      playgroundWatchId += 1;
      renderPlaygroundLog(playgroundLog, []);
    }

    async function refreshPlaygroundView() {
      const res = await api(`/playground/${encodeURIComponent(clientId)}`);
      renderPlaygroundLog(playgroundLog, playgroundEventsFromState(res));
      return res;
    }

    async function loadPlayground() {
      try {
        const res = await refreshPlaygroundView();
        if ((res.pendingMessages || []).length || res.locked) {
          watchPlaygroundUntilIdle();
        }
      } catch (err) {
        renderPlaygroundLog(playgroundLog, []);
        showFlash(document.getElementById('form-flash'), err.message, 'err');
      }
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function watchPlaygroundUntilIdle() {
      const id = ++playgroundWatchId;
      while (id === playgroundWatchId) {
        try {
          const res = await refreshPlaygroundView();
          const pending = res.pendingMessages || [];
          if (!pending.length && !res.locked) {
            break;
          }
        } catch (err) {
          showFlash(document.getElementById('form-flash'), err.message, 'err');
          break;
        }
        await sleep(400);
      }
    }

    document.getElementById('assistant-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const flash = document.getElementById('form-flash');
      const tools = parseJsonField(document.getElementById('asst-tools').value, 'Tools', []);
      const config = parseJsonField(document.getElementById('asst-config').value, 'Config', {});
      const schema = parseJsonField(document.getElementById('asst-schema').value, 'responseSchema', {});
      if (!tools.ok || !config.ok || !schema.ok) {
        showFlash(flash, [tools, config, schema].filter((x) => !x.ok).map((x) => x.error).join(' · '), 'err');
        return;
      }
      if (!Array.isArray(tools.value)) {
        showFlash(flash, 'Tools debe ser un array JSON', 'err');
        return;
      }
      try {
        const saved = await api(`/assistants/${encodeURIComponent(clientId)}`, {
          method: 'PUT',
          body: {
            prompt: document.getElementById('asst-prompt').value,
            tools: tools.value,
            config: config.value,
            responseSchema: schema.value
          }
        });
        if (saved.playgroundReset) {
          clearPlaygroundLog();
        }
        if (document.getElementById('asst-reset-sessions').checked) {
          try {
            const result = await api(`/sessions/client/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
            showFlash(flash, `Assistant actualizado. Sesiones reseteadas: ${result.deleted ?? 0}`, 'ok');
          } catch (resetErr) {
            showFlash(flash, `Assistant actualizado, pero no se pudieron resetear sesiones: ${resetErr.message}`, 'err');
          }
        } else {
          showFlash(flash, saved.playgroundReset
            ? 'Assistant actualizado. Playground reiniciado.'
            : 'Assistant actualizado', 'ok');
        }
      } catch (err) {
        showFlash(flash, err.message, 'err');
      }
    });

    document.getElementById('asst-reset-only').addEventListener('click', async () => {
      if (!confirm(`¿Borrar todas las sesiones del bot "${clientId}"? El historial de todas las conversaciones se perderá.`)) return;
      const flash = document.getElementById('form-flash');
      try {
        const result = await api(`/sessions/client/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
        clearPlaygroundLog();
        showFlash(flash, result.message || `Sesiones reseteadas: ${result.deleted ?? 0}`, 'ok');
      } catch (err) {
        showFlash(flash, err.message, 'err');
      }
    });

    document.getElementById('playground-reset').addEventListener('click', async () => {
      if (!confirm('¿Empezar una nueva conversación de prueba? Se borra solo el historial del playground.')) return;
      try {
        await api(
          `/sessions/${encodeURIComponent(playgroundUserId(clientId))}/${encodeURIComponent(clientId)}`,
          { method: 'DELETE' }
        );
        clearPlaygroundLog();
      } catch (err) {
        showFlash(document.getElementById('form-flash'), err.message, 'err');
      }
    });

    document.getElementById('playground-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = playgroundInput.value.trim();
      if (!message) return;

      playgroundInput.value = '';

      try {
        const result = await api(`/playground/${encodeURIComponent(clientId)}/chat`, {
          method: 'POST',
          body: { message }
        });

        if (result.reason === 'ignored_locked' || result.locked) {
          showFlash(
            document.getElementById('form-flash'),
            'Mensaje ignorado: la sesión está ocupada (igual que en WhatsApp).',
            'err'
          );
          watchPlaygroundUntilIdle();
          return;
        }

        if (result.queued) {
          watchPlaygroundUntilIdle();
          playgroundInput.focus();
          return;
        }

        await refreshPlaygroundView();
      } catch (err) {
        appendPlaygroundEvents(playgroundLog, [{
          kind: 'message',
          role: 'assistant',
          text: err.message || 'Error enviando el mensaje'
        }]);
      } finally {
        playgroundInput.focus();
      }
    });

    playgroundInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        document.getElementById('playground-form').requestSubmit();
      }
    });

    await loadPlayground();
  }

  async function renderSessionsTab(container, clientId, page) {
    const query = new URLSearchParams({
      clientCode: clientId,
      limit: '20'
    });
    if (page && String(page) !== '1') query.set('page', String(page));
    const payload = await api(`/sessions?${query}`);
    const sessions = payload.sessions || [];
    const hrefForPage = (nextPage) => {
      const params = new URLSearchParams();
      if (nextPage > 1) params.set('page', String(nextPage));
      const q = params.toString();
      return q
        ? `#/clients/${encodeURIComponent(clientId)}/sesiones?${q}`
        : `#/clients/${encodeURIComponent(clientId)}/sesiones`;
    };

    container.innerHTML = `
      <div id="form-flash" hidden></div>
      <div class="page-head" style="margin-top:0">
        <p class="muted" style="margin:0">Conversaciones de este bot. Ábrela para ver qué se dijo y dónde falló.</p>
        <div class="actions">
          <button type="button" id="reset-client-sessions" class="btn-danger">Resetear este bot</button>
        </div>
      </div>
      <div class="card">
        ${sessionsPagerHtml(payload, hrefForPage)}
        ${sessionsTableHtml(sessions, { showClient: false, fromClientId: clientId })}
        ${sessionsPagerHtml(payload, hrefForPage)}
      </div>
    `;

    document.getElementById('reset-client-sessions').addEventListener('click', async () => {
      if (!confirm(`¿Borrar todas las sesiones del bot "${clientId}"? El historial de todas las conversaciones se perderá.`)) return;
      try {
        const result = await api(`/sessions/client/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
        await renderClientDetail(clientId, 'sesiones');
        showFlash(document.getElementById('form-flash'), result.message || `Sesiones reseteadas: ${result.deleted ?? 0}`, 'ok');
      } catch (err) {
        showFlash(document.getElementById('form-flash'), err.message, 'err');
      }
    });

    bindSessionDeletes(container, () => renderClientDetail(clientId, 'sesiones'));
  }

  async function renderDocumentsTab(container, clientId) {
    const res = await api(`/clients/${encodeURIComponent(clientId)}/documents`);
    const docs = res.documents || [];

    container.innerHTML = `
      <div id="form-flash" hidden></div>
      <form id="upload-form" class="card stack">
        <h2>Subir PDF</h2>
        <div class="grid grid-2">
          <div>
            <label for="doc-id">documento_id</label>
            <input id="doc-id" type="text" required placeholder="lista_precios">
            <p class="hint">Solo letras, números y guion bajo.</p>
          </div>
          <div>
            <label for="doc-file">Archivo PDF</label>
            <input id="doc-file" type="file" accept="application/pdf,.pdf" required>
          </div>
        </div>
        <div class="actions"><button type="submit">Subir</button></div>
      </form>
      <div class="card" style="margin-top:1rem">
        <h2>Documentos</h2>
        ${docs.length === 0 ? '<p class="empty">No hay PDFs.</p>' : `
          <div class="table-wrap"><table>
            <thead><tr><th>ID</th><th>Archivo</th><th>Tamaño</th><th></th></tr></thead>
            <tbody>
              ${docs.map((doc) => `
                <tr>
                  <td><code>${escapeHtml(doc.documentoId)}</code></td>
                  <td>${escapeHtml(doc.filename)}</td>
                  <td>${escapeHtml(formatBytes(doc.size))}</td>
                  <td><button type="button" class="btn btn-sm btn-danger" data-del-doc="${escapeHtml(doc.documentoId)}">Eliminar</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table></div>`}
      </div>
    `;

    document.getElementById('upload-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const flash = document.getElementById('form-flash');
      const documentoId = document.getElementById('doc-id').value.trim();
      const file = document.getElementById('doc-file').files[0];
      if (!file) {
        showFlash(flash, 'Selecciona un PDF', 'err');
        return;
      }
      const form = new FormData();
      form.append('documento_id', documentoId);
      form.append('file', file);
      try {
        await api(`/clients/${encodeURIComponent(clientId)}/documents`, { method: 'POST', body: form });
        await renderClientDetail(clientId, 'documentos');
      } catch (err) {
        showFlash(flash, err.message, 'err');
      }
    });

    container.querySelectorAll('[data-del-doc]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar el documento "${btn.dataset.delDoc}"?`)) return;
        try {
          await api(
            `/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(btn.dataset.delDoc)}`,
            { method: 'DELETE' }
          );
          await renderClientDetail(clientId, 'documentos');
        } catch (err) {
          showFlash(document.getElementById('form-flash'), err.message, 'err');
        }
      });
    });
  }

  if (getToken()) {
    probeAuth().then(() => {
      showApp();
      goToHash(location.hash && location.hash !== '#' ? location.hash : '#/');
    }).catch(() => {
      clearToken();
      clearHash();
      showLogin('Token inválido o no configurado');
    });
  } else {
    showLogin();
  }
})();
