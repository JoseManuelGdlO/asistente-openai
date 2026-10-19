const TOKEN_KEY = 'admin_api_token';
const EDITOR_ID_KEY = 'panel_editor_id';
const EDITOR_EMAIL_KEY = 'panel_editor_email';

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

function getEditorId() {
  let id = sessionStorage.getItem(EDITOR_ID_KEY) || '';
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `editor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(EDITOR_ID_KEY, id);
  }
  return id;
}

function getEditorEmail() {
  return sessionStorage.getItem(EDITOR_EMAIL_KEY) || '';
}

function setEditorEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (value) {
    sessionStorage.setItem(EDITOR_EMAIL_KEY, value);
  } else {
    sessionStorage.removeItem(EDITOR_EMAIL_KEY);
  }
}

function clearEditorIdentity() {
  sessionStorage.removeItem(EDITOR_EMAIL_KEY);
}

class ApiError extends Error {
  constructor(status, body) {
    super((body && (body.error || body.message)) || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body || {};
    this.code = body && body.code ? body.code : undefined;
  }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  headers['X-Editor-Id'] = getEditorId();
  const email = getEditorEmail();
  if (email) {
    headers['X-Editor-Email'] = email;
  }

  let body = options.body;
  if (body && !(body instanceof FormData)) {
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    body = JSON.stringify(body);
  }

  const res = await fetch(path, { ...options, headers, body });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 || res.status === 503) {
    window.dispatchEvent(new CustomEvent('auth:required', { detail: { status: res.status, data } }));
  }

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }

  return data;
}

async function acquireEditLock(clientId) {
  return api(`/bots/${encodeURIComponent(clientId)}/edit-lock/acquire`, { method: 'POST' });
}

async function heartbeatEditLock(clientId) {
  return api(`/bots/${encodeURIComponent(clientId)}/edit-lock/heartbeat`, { method: 'POST' });
}

async function releaseEditLock(clientId) {
  return api(`/bots/${encodeURIComponent(clientId)}/edit-lock/release`, { method: 'POST' });
}

async function getEditLock(clientId) {
  return api(`/bots/${encodeURIComponent(clientId)}/edit-lock`);
}

window.AdminApi = {
  getToken,
  setToken,
  clearToken,
  getEditorId,
  getEditorEmail,
  setEditorEmail,
  clearEditorIdentity,
  api,
  ApiError,
  acquireEditLock,
  heartbeatEditLock,
  releaseEditLock,
  getEditLock
};
