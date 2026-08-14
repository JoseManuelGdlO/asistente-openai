const TOKEN_KEY = 'admin_api_token';

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  constructor(status, body) {
    super((body && (body.error || body.message)) || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body || {};
  }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
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

window.AdminApi = { getToken, setToken, clearToken, api, ApiError };
