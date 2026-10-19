const crypto = require('crypto');
const { digitsOnly } = require('./metaConfig');

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CLIENT_SECRET_KEYS = [
  'META_ACCESS_TOKEN',
  'META_INVITE_TOKEN_HASH',
  'ULTRAMSG_TOKEN',
  'ULTRAMSG_WEBHOOK_TOKEN',
  'OWN_API_KEY'
];

function hashInviteToken(token) {
  return crypto.createHash('sha256').update(String(token || '').trim()).digest('hex');
}

function createInviteToken(now = Date.now()) {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    hash: hashInviteToken(token),
    expiresAt: new Date(now + INVITE_TTL_MS).toISOString()
  };
}

function publicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const proto = req?.get?.('x-forwarded-proto') || req?.protocol || 'http';
  const host = req?.get?.('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

function inviteUrlFor(req, token) {
  return `${publicBaseUrl(req)}/vincular/${encodeURIComponent(token)}`;
}

function parseExpiry(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inviteStatus(client, now = Date.now()) {
  if (client?.META_PHONE_NUMBER_ID) return 'connected';
  if (!client?.META_INVITE_TOKEN_HASH) return 'none';
  if (client.META_INVITE_USED_AT) return 'used';
  const exp = parseExpiry(client.META_INVITE_EXPIRES_AT);
  if (Number.isFinite(exp) && exp < now) return 'expired';
  return 'pending';
}

function describeMetaConnection(client) {
  const status = inviteStatus(client);
  return {
    connected: status === 'connected',
    inviteStatus: status,
    displayPhone: client?.META_DISPLAY_PHONE || client?.assistantPhone || null,
    coexistenceEnabled: Boolean(client?.META_COEXISTENCE_ENABLED),
    wabaId: client?.META_WABA_ID || null,
    phoneNumberId: client?.META_PHONE_NUMBER_ID || null,
    expiresAt: client?.META_INVITE_EXPIRES_AT || null
  };
}

function sanitizeClient(client) {
  if (!client || typeof client !== 'object') return client;
  const next = { ...client };
  CLIENT_SECRET_KEYS.forEach((key) => {
    delete next[key];
  });
  next.meta = describeMetaConnection(client);
  next.hasUltraMsg = Boolean(client.ULTRAMSG_INSTANCE_ID && client.ULTRAMSG_TOKEN);
  return next;
}

function sanitizeClientsMap(clients) {
  const source = clients && typeof clients === 'object' ? clients : {};
  const out = {};
  for (const [id, client] of Object.entries(source)) {
    out[id] = sanitizeClient({ id, ...client });
  }
  return out;
}

function assertInviteUsable(client, now = Date.now()) {
  const status = inviteStatus(client, now);
  if (!client || status === 'none') {
    const err = new Error('El link de vinculación no es válido.');
    err.status = 404;
    throw err;
  }
  if (status === 'connected' || status === 'used') {
    const err = new Error('Este número ya está vinculado. Pide un link nuevo si necesitas reconectar.');
    err.status = 410;
    throw err;
  }
  if (status === 'expired') {
    const err = new Error('Este link ya venció. Pide uno nuevo a quien administra el bot.');
    err.status = 410;
    throw err;
  }
  return status;
}

function inviteFields(invite) {
  return {
    META_INVITE_TOKEN_HASH: invite.hash,
    META_INVITE_EXPIRES_AT: invite.expiresAt,
    META_INVITE_USED_AT: null
  };
}

function clearMetaCredentialFields() {
  return {
    META_WABA_ID: null,
    META_PHONE_NUMBER_ID: null,
    META_BUSINESS_ID: null,
    META_DISPLAY_PHONE: null,
    META_ACCESS_TOKEN: null,
    META_COEXISTENCE_ENABLED: false
  };
}

function normalizeAssistantPhone(displayPhone) {
  return digitsOnly(displayPhone) || null;
}

module.exports = {
  INVITE_TTL_MS,
  hashInviteToken,
  createInviteToken,
  publicBaseUrl,
  inviteUrlFor,
  inviteStatus,
  describeMetaConnection,
  sanitizeClient,
  sanitizeClientsMap,
  assertInviteUsable,
  inviteFields,
  clearMetaCredentialFields,
  normalizeAssistantPhone
};
