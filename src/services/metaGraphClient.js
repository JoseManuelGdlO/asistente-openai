const { httpError } = require('../utils/httpError');
const { metaEnv } = require('./metaConfig');

function graphBase() {
  return `https://graph.facebook.com/${metaEnv().graphVersion}`;
}

function attachMetaError(err, details = {}) {
  err.meta = {
    httpStatus: details.httpStatus ?? err.status ?? null,
    code: details.code ?? null,
    subcode: details.subcode ?? null,
    message: details.message ?? err.message,
    fbtraceId: details.fbtraceId ?? null
  };
  return err;
}

function parseGraphErrorPayload(payload = {}, httpStatus = 500) {
  const error = payload?.error && typeof payload.error === 'object' ? payload.error : {};
  return {
    httpStatus,
    code: error.code ?? error.error_code ?? null,
    subcode: error.error_subcode ?? null,
    message: String(error.message || error.error_user_msg || payload?.error || 'Error de Graph API').trim(),
    fbtraceId: error.fbtrace_id || null
  };
}

function graphErrorFromResponse(httpStatus, payload) {
  const details = parseGraphErrorPayload(payload, httpStatus);
  const err = httpError(
    httpStatus >= 400 && httpStatus < 600 ? httpStatus : 502,
    details.message
  );
  return attachMetaError(err, details);
}

async function parseResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 300) } };
  }
}

async function graphRequest({
  method = 'GET',
  path,
  token,
  query = {},
  body,
  timeoutMs = 15000
} = {}) {
  const url = new URL(`${graphBase()}/${String(path || '').replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body != null) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    const err = httpError(502, 'No se pudo contactar la API de Meta.');
    attachMetaError(err, { httpStatus: 502, message: error.message });
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const payload = await parseResponse(res);
  if (!res.ok) {
    throw graphErrorFromResponse(res.status, payload);
  }
  return payload;
}

function describeGraphToken(token) {
  const value = String(token || '').trim();
  const platform = metaEnv().accessToken;
  if (!value) return { source: 'missing', preview: null, equalsPlatform: false };
  return {
    source: platform && value === platform ? 'META_SYSTEM_USER_TOKEN' : 'clientAccessToken',
    preview: `${value.slice(0, 8)}…len=${value.length}`,
    equalsPlatform: Boolean(platform && value === platform)
  };
}

function isBenignWabaLinkError(error) {
  const details = [error?.message, error?.meta?.message].filter(Boolean).join(' ');
  return /\balready\b|\bduplicate\b|\blinked\b|\bshared\b/i.test(details);
}

async function exchangeEmbeddedSignupCode(code) {
  const { appId, appSecret } = metaEnv();
  if (!appId || !appSecret) {
    throw httpError(500, 'Faltan META_APP_ID o META_APP_SECRET en el servidor.');
  }
  const payload = await graphRequest({
    method: 'GET',
    path: 'oauth/access_token',
    query: {
      client_id: appId,
      client_secret: appSecret,
      code: String(code || '').trim()
    }
  });
  const accessToken = String(payload.access_token || '').trim();
  if (!accessToken) throw httpError(502, 'Meta no devolvió un access token intercambiable.');
  return {
    accessToken,
    tokenType: payload.token_type || null,
    expiresIn: payload.expires_in ?? null
  };
}

async function inspectGraphToken(inputToken) {
  const { appId, appSecret } = metaEnv();
  if (!appId || !appSecret) {
    throw httpError(500, 'Faltan META_APP_ID o META_APP_SECRET en el servidor.');
  }
  const payload = await graphRequest({
    method: 'GET',
    path: 'debug_token',
    token: `${appId}|${appSecret}`,
    query: { input_token: String(inputToken || '').trim() }
  });
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return {
    type: data?.type || null,
    isValid: data?.is_valid !== false,
    expiresAt: data?.expires_at ?? null,
    dataAccessExpiresAt: data?.data_access_expires_at ?? null,
    scopes: Array.isArray(data?.scopes) ? data.scopes : []
  };
}

async function subscribeWabaApp(wabaId, token) {
  return graphRequest({
    method: 'POST',
    path: `${wabaId}/subscribed_apps`,
    token
  });
}

async function unsubscribeWabaApp(wabaId, token) {
  return graphRequest({
    method: 'DELETE',
    path: `${wabaId}/subscribed_apps`,
    token
  });
}

async function listWabaPhoneNumbers(wabaId, token) {
  const payload = await graphRequest({
    method: 'GET',
    path: `${wabaId}/phone_numbers`,
    token,
    query: {
      fields: 'id,display_phone_number,verified_name,quality_rating,is_on_biz_app,platform_type'
    }
  });
  return Array.isArray(payload.data) ? payload.data : [];
}

async function getPhoneNumberDetails(phoneNumberId, token) {
  return graphRequest({
    method: 'GET',
    path: phoneNumberId,
    token,
    query: {
      fields: 'id,display_phone_number,verified_name,quality_rating,is_on_biz_app,platform_type'
    }
  });
}

async function sendCloudMessage({ phoneNumberId, token, payload }) {
  return graphRequest({
    method: 'POST',
    path: `${phoneNumberId}/messages`,
    token,
    body: payload
  });
}

async function initiateCoexistenceSync({ phoneNumberId, token, syncType }) {
  return graphRequest({
    method: 'POST',
    path: `${phoneNumberId}/smb_app_data`,
    token,
    body: {
      messaging_product: 'whatsapp',
      sync_type: syncType
    }
  });
}

async function shareClientWhatsappBusinessAccount({ wabaId, businessId, token } = {}) {
  const env = metaEnv();
  const id = String(businessId || env.businessId || '').trim();
  const waba = String(wabaId || '').trim();
  const access = String(token || env.accessToken || '').trim();
  if (!id) throw httpError(500, 'Falta META_BUSINESS_ID para vincular el WABA al portafolio.');
  if (!waba) throw httpError(400, 'Falta el WABA ID.');
  if (!access) throw httpError(400, 'Falta META_SYSTEM_USER_TOKEN.');
  return graphRequest({
    method: 'POST',
    path: `${id}/client_whatsapp_business_accounts`,
    token: access,
    query: { waba_id: waba }
  });
}

async function assignSystemUserToWaba({ wabaId, systemUserId, token } = {}) {
  const env = metaEnv();
  const waba = String(wabaId || '').trim();
  const user = String(systemUserId || env.systemUserId || '').trim();
  const access = String(token || '').trim();
  if (!waba) throw httpError(400, 'Falta el WABA ID.');
  if (!user) throw httpError(400, 'Falta el system user ID.');
  if (!access) throw httpError(400, 'Falta el token para asignar el system user.');
  return graphRequest({
    method: 'POST',
    path: `${waba}/assigned_users`,
    token: access,
    query: {
      user,
      tasks: JSON.stringify(['MANAGE'])
    }
  });
}

async function ensurePlatformCanManageWaba({ wabaId, plannerAccessToken } = {}) {
  const env = metaEnv();
  const platformToken = env.accessToken;
  if (!platformToken) {
    return { skipped: true, reason: 'no_platform_token', shared: false, assigned: false };
  }
  const waba = String(wabaId || '').trim();
  if (!waba) {
    return { skipped: true, reason: 'no_waba', shared: false, assigned: false };
  }

  let shared = false;
  if (env.businessId) {
    try {
      await shareClientWhatsappBusinessAccount({
        wabaId: waba,
        businessId: env.businessId,
        token: String(plannerAccessToken || platformToken).trim()
      });
      shared = true;
    } catch (error) {
      if (isBenignWabaLinkError(error)) {
        shared = true;
      } else {
        console.warn('OBO: no se pudo vincular el WABA', error.message);
      }
    }
  }

  let assigned = false;
  try {
    let systemUserId = env.systemUserId;
    if (!systemUserId) {
      const me = await graphRequest({
        method: 'GET',
        path: 'me',
        token: platformToken,
        query: { fields: 'id' }
      });
      systemUserId = String(me.id || '').trim();
    }
    if (systemUserId) {
      await assignSystemUserToWaba({
        wabaId: waba,
        systemUserId,
        token: String(plannerAccessToken || '').trim() || platformToken
      });
      assigned = true;
    }
  } catch (error) {
    if (isBenignWabaLinkError(error)) {
      assigned = true;
    } else {
      console.warn('OBO: no se pudo asignar el system user', error.message);
    }
  }

  return { skipped: false, shared, assigned };
}

async function uploadWhatsappMedia({ phoneNumberId, token, filename, document, mimeType = 'application/pdf' }) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  const blob = document instanceof Blob
    ? document
    : new Blob([document], { type: mimeType });
  form.append('file', blob, filename || 'documento.pdf');

  const url = `${graphBase()}/${encodeURIComponent(phoneNumberId)}/media`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const payload = await parseResponse(res);
  if (!res.ok) throw graphErrorFromResponse(res.status, payload);
  const mediaId = String(payload.id || '').trim();
  if (!mediaId) throw httpError(502, 'Meta no devolvió un media id.');
  return mediaId;
}

async function downloadWhatsappMedia({ mediaId, token }) {
  const meta = await graphRequest({
    method: 'GET',
    path: mediaId,
    token
  });
  const fileUrl = String(meta.url || '').trim();
  if (!fileUrl) throw httpError(502, 'Meta no devolvió la URL del archivo.');
  const res = await fetch(fileUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw httpError(502, 'No se pudo descargar el archivo de Meta.');
  return Buffer.from(await res.arrayBuffer());
}

module.exports = {
  attachMetaError,
  describeGraphToken,
  exchangeEmbeddedSignupCode,
  inspectGraphToken,
  subscribeWabaApp,
  unsubscribeWabaApp,
  listWabaPhoneNumbers,
  getPhoneNumberDetails,
  sendCloudMessage,
  initiateCoexistenceSync,
  ensurePlatformCanManageWaba,
  uploadWhatsappMedia,
  downloadWhatsappMedia,
  graphRequest
};
