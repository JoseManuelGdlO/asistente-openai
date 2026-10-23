const crypto = require('crypto');

function encode(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64').toString('utf8');
}

function signState(payload, secret) {
  const body = encode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', String(secret)).update(body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${body}.${sig}`;
}

function verifyState(state, secret, now = Date.now()) {
  if (!secret || typeof state !== 'string' || !state.includes('.')) return null;
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', String(secret)).update(body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  let payload;
  try {
    payload = JSON.parse(decode(body));
  } catch {
    return null;
  }
  if (!payload || typeof payload.clientId !== 'string' || !payload.nonce) return null;
  if (!Number.isFinite(payload.exp) || payload.exp < now) return null;
  return payload;
}

function stateSecret(env = process.env) {
  return env.CREDENTIALS_ENCRYPTION_KEY || env.ADMIN_API_TOKEN || '';
}

module.exports = {
  signState,
  verifyState,
  stateSecret
};
