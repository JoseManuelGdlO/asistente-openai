const crypto = require('crypto');
const { signState, openSigned, stateSecret } = require('./oauthState');

const CALENDAR_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const RESULT_TTL_MS = 15 * 60 * 1000;

function hashCalendarInviteToken(token) {
  return crypto.createHash('sha256').update(String(token || '').trim()).digest('hex');
}

function createCalendarInviteToken(now = Date.now()) {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    hash: hashCalendarInviteToken(token),
    expiresAt: new Date(now + CALENDAR_INVITE_TTL_MS).toISOString()
  };
}

function publicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const proto = req?.get?.('x-forwarded-proto') || req?.protocol || 'http';
  const host = req?.get?.('x-forwarded-host') || req?.get?.('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

function calendarInviteUrlFor(req, token) {
  return `${publicBaseUrl(req)}/calendar/conectar/${encodeURIComponent(token)}`;
}

function parseExpiry(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function calendarInviteStatus(client, now = Date.now()) {
  if (!client?.CALENDAR_INVITE_TOKEN_HASH) return 'none';
  const exp = parseExpiry(client.CALENDAR_INVITE_EXPIRES_AT);
  if (Number.isFinite(exp) && exp < now) return 'expired';
  return 'pending';
}

function describeCalendarInvite(client, now = Date.now()) {
  return {
    status: calendarInviteStatus(client, now),
    expiresAt: client?.CALENDAR_INVITE_EXPIRES_AT || null
  };
}

function calendarInviteFields(invite) {
  return {
    CALENDAR_INVITE_TOKEN_HASH: invite.hash,
    CALENDAR_INVITE_EXPIRES_AT: invite.expiresAt
  };
}

function redactCalendarInvite(client) {
  if (!client || typeof client !== 'object') return client;
  delete client.CALENDAR_INVITE_TOKEN_HASH;
  return client;
}

function publicCalendarSummary(panel) {
  const notice = panel?.adminNotice || null;
  const email = panel?.connection?.email || '';
  return {
    connected: panel?.connection?.status === 'connected' && Boolean(email),
    email,
    noticePending: Boolean(notice),
    noticeEmail: notice?.email || '',
    noticeAt: notice?.connectedAt || null
  };
}

function signInviteResult(payload, secret, now = Date.now()) {
  return signState({ ...payload, exp: now + RESULT_TTL_MS }, secret);
}

function readInviteResult(token, secret, now = Date.now()) {
  const payload = openSigned(token, secret, now);
  if (!payload || (payload.kind !== 'connected' && payload.kind !== 'denied' && payload.kind !== 'error')) {
    return null;
  }
  return {
    kind: payload.kind,
    email: typeof payload.email === 'string' ? payload.email : '',
    botName: typeof payload.botName === 'string' ? payload.botName : ''
  };
}

function inviteResultUrl(req, payload, env = process.env, now = Date.now()) {
  const signed = signInviteResult(payload, stateSecret(env), now);
  return `${publicBaseUrl(req)}/calendar/conectar/listo?r=${encodeURIComponent(signed)}`;
}

module.exports = {
  CALENDAR_INVITE_TTL_MS,
  hashCalendarInviteToken,
  createCalendarInviteToken,
  calendarInviteUrlFor,
  calendarInviteStatus,
  describeCalendarInvite,
  calendarInviteFields,
  redactCalendarInvite,
  publicCalendarSummary,
  signInviteResult,
  readInviteResult,
  inviteResultUrl
};
