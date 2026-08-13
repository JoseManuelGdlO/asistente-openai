(function () {
  const { getToken, setToken, clearToken, api } = window.AdminApi;

  const loginView = document.getElementById('login-view');
  const appView = document.getElementById('app-view');
  const content = document.getElementById('content');
  const loginForm = document.getElementById('login-form');
  const loginToken = document.getElementById('login-token');
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

  function showFlash(el, message, type) {
    if (!el) return;
    el.className = `flash ${type === 'ok' ? 'flash-ok' : 'flash-err'}`;
    el.textContent = message;
    el.hidden = false;
  }

  function parseRoute() {
    const hash = (location.hash || '#/').replace(/^#/, '') || '/';
    const parts = hash.split('/').filter(Boolean);
    if (parts.length === 0) return { name: 'dashboard' };
    if (parts[0] === 'clients' && parts[1] === 'new') return { name: 'client-new' };
    if (parts[0] === 'clients' && parts[1]) {
      return { name: 'client-detail', clientId: decodeURIComponent(parts[1]), tab: parts[2] || 'consultorio' };
    }
    if (parts[0] === 'clients') return { name: 'clients' };
    return { name: 'dashboard' };
  }

  function setActiveNav(name) {
    document.querySelectorAll('[data-nav]').forEach((link) => {
      link.classList.toggle('active', link.dataset.nav === (name === 'dashboard' ? 'dashboard' : 'clients'));
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
    const token = loginToken.value.trim();
    if (!token) return;
    setToken(token);
    try {
      await probeAuth();
      loginToken.value = '';
      loginError.hidden = true;
      showApp();
      goToHash('#/');
    } catch (err) {
      clearToken();
      showLogin(err.status === 503
        ? 'ADMIN_API_TOKEN no está configurado en el servidor'
        : 'Token inválido');
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
    showLogin('Sesión expirada o token inválido');
  });

  window.addEventListener('hashchange', render);

  async function render() {
    if (!requireAuth()) return;
    const route = parseRoute();
    setActiveNav(route.name);
    content.innerHTML = '<p class="muted">Cargando…</p>';
    try {
      if (route.name === 'dashboard') await renderDashboard();
      else if (route.name === 'clients') await renderClients();
      else if (route.name === 'client-new') renderClientForm();
      else if (route.name === 'client-detail') await renderClientDetail(route.clientId, route.tab);
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
          <span class="label">Consultorios</span>
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
              <thead><tr><th>Consultorio</th><th>Estado</th><th></th></tr></thead>
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
        <h1>Consultorios</h1>
        <a class="btn" href="#/clients/new">Nuevo consultorio</a>
      </div>
      <div class="card">
        ${clients.length === 0 ? '<p class="empty">No hay consultorios.</p>' : `
          <div class="table-wrap"><table>
            <thead><tr><th>Nombre</th><th>Admin</th><th>Asistente</th><th>Bot</th><th></th></tr></thead>
            <tbody>
              ${clients.map((client) => `
                <tr>
                  <td><a href="#/clients/${encodeURIComponent(client.id)}">${escapeHtml(client.name || client.id)}</a><div class="hint">${escapeHtml(client.id)}</div></td>
                  <td>${escapeHtml(client.adminPhone || '')}</td>
                  <td>${escapeHtml(client.assistantPhone || '')}</td>
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
        if (!confirm(`¿Eliminar el consultorio "${btn.dataset.name}"? Esta acción hace soft-delete del par cliente + Assistant.`)) return;
        try {
          await api(`/clients/${encodeURIComponent(btn.dataset.delete)}`, { method: 'DELETE' });
          render();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function clientFormFields(client = {}, isEdit) {
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
          <input id="client-assistant" type="text" required value="${escapeHtml(client.assistantPhone || '')}">
        </div>
      </div>
      <div>
        <label for="client-bot-status">Estado del bot</label>
        <select id="client-bot-status">
          <option value="active" ${client.botStatus !== 'inactive' ? 'selected' : ''}>Activo</option>
          <option value="inactive" ${client.botStatus === 'inactive' ? 'selected' : ''}>Inactivo</option>
        </select>
      </div>
      <div>
        <label for="client-instance">UltraMsg instance ID</label>
        <input id="client-instance" type="text" value="${escapeHtml(isEdit ? '' : (client.ULTRAMSG_INSTANCE_ID || ''))}" placeholder="${isEdit && hasInstance ? 'Configurado — deja vacío para no cambiar' : ''}">
      </div>
      <div class="grid grid-2">
        <div>
          <label for="client-token">UltraMsg token</label>
          <input id="client-token" type="password" autocomplete="new-password" placeholder="${isEdit && hasToken ? 'Configurado — deja vacío para no cambiar' : ''}">
        </div>
        <div>
          <label for="client-webhook">UltraMsg webhook token</label>
          <input id="client-webhook" type="password" autocomplete="new-password" placeholder="${isEdit && hasWebhook ? 'Configurado — deja vacío para no cambiar' : ''}">
        </div>
      </div>
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
      assistantPhone: document.getElementById('client-assistant').value.trim(),
      botStatus: document.getElementById('client-bot-status').value
    };
    if (!isEdit) {
      const id = document.getElementById('client-id').value.trim();
      if (id) body.id = id;
      const prompt = document.getElementById('client-prompt').value;
      if (prompt) body.prompt = prompt;
    }
    const instanceId = document.getElementById('client-instance').value.trim();
    const token = document.getElementById('client-token').value.trim();
    const webhook = document.getElementById('client-webhook').value.trim();
    if (instanceId) body.ULTRAMSG_INSTANCE_ID = instanceId;
    if (token) body.ULTRAMSG_TOKEN = token;
    if (webhook) body.ULTRAMSG_WEBHOOK_TOKEN = webhook;
    return body;
  }

  function renderClientForm() {
    content.innerHTML = `
      <div class="page-head">
        <h1>Nuevo consultorio</h1>
        <a class="btn-secondary btn" href="#/clients">Volver</a>
      </div>
      <div id="form-flash" hidden></div>
      <form id="client-form" class="card stack">
        ${clientFormFields({}, false)}
        <div class="actions">
          <button type="submit">Crear consultorio</button>
        </div>
      </form>
    `;

    document.getElementById('client-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const flash = document.getElementById('form-flash');
      const body = readClientForm(false);
      try {
        const result = await api('/clients', { method: 'POST', body });
        location.hash = `#/clients/${encodeURIComponent(result.client.id)}`;
      } catch (err) {
        showFlash(flash, err.message, 'err');
      }
    });
  }

  async function renderClientDetail(clientId, tab) {
    const currentTab = ['consultorio', 'assistant', 'documentos'].includes(tab) ? tab : 'consultorio';
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
        <a href="#/clients/${encodeURIComponent(clientId)}" class="${currentTab === 'consultorio' ? 'active' : ''}">Consultorio</a>
        <a href="#/clients/${encodeURIComponent(clientId)}/assistant" class="${currentTab === 'assistant' ? 'active' : ''}">Assistant</a>
        <a href="#/clients/${encodeURIComponent(clientId)}/documentos" class="${currentTab === 'documentos' ? 'active' : ''}">Documentos</a>
      </nav>
      <div id="detail-body"></div>
    `;

    const body = document.getElementById('detail-body');
    if (currentTab === 'assistant') {
      await renderAssistantTab(body, clientId);
    } else if (currentTab === 'documentos') {
      await renderDocumentsTab(body, clientId);
    } else {
      renderConsultorioTab(body, client);
    }
  }

  function renderConsultorioTab(container, client) {
    container.innerHTML = `
      <div id="form-flash" hidden></div>
      <form id="client-form" class="card stack">
        ${clientFormFields(client, true)}
        <div class="actions">
          <button type="submit">Guardar consultorio</button>
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
        showFlash(flash, 'Consultorio actualizado', 'ok');
      } catch (err) {
        showFlash(flash, err.message, 'err');
      }
    });

    document.getElementById('delete-client').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar el consultorio "${client.name}"?`)) return;
      try {
        await api(`/clients/${encodeURIComponent(client.id)}`, { method: 'DELETE' });
        location.hash = '#/clients';
      } catch (err) {
        showFlash(document.getElementById('form-flash'), err.message, 'err');
      }
    });
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
        <div class="actions">
          <button type="submit">Guardar Assistant</button>
        </div>
      </form>
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
        await api(`/assistants/${encodeURIComponent(clientId)}`, {
          method: 'PUT',
          body: {
            prompt: document.getElementById('asst-prompt').value,
            tools: tools.value,
            config: config.value,
            responseSchema: schema.value
          }
        });
        showFlash(flash, 'Assistant actualizado', 'ok');
      } catch (err) {
        showFlash(flash, err.message, 'err');
      }
    });
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
