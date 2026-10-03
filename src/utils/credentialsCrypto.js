const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const KEY_LEN = 32;

function getKey() {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY || process.env.ADMIN_API_TOKEN || 'dev-credentials-key';
  return crypto.createHash('sha256').update(String(raw)).digest().subarray(0, KEY_LEN);
}

function encryptCredentialsPayload(payload) {
  const iv = crypto.randomBytes(IV_LEN);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: 16 });
  const json = JSON.stringify(payload);
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    data: enc.toString('base64'),
    tag: authTag.toString('base64')
  });
}

function decryptCredentialsPayload(stored) {
  if (stored && typeof stored === 'object') {
    return stored;
  }
  const parsed = JSON.parse(stored);
  if (parsed.v !== 1 || !parsed.iv || !parsed.data || !parsed.tag) {
    throw new Error('Paquete de cifrado inválido');
  }
  const iv = Buffer.from(parsed.iv, 'base64');
  const data = Buffer.from(parsed.data, 'base64');
  const tag = Buffer.from(parsed.tag, 'base64');
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

function decryptMetaAccessToken(stored) {
  if (!stored) return '';
  try {
    const payload = decryptCredentialsPayload(stored);
    return String(payload.accessToken || payload.token || '').trim();
  } catch {
    return String(stored).trim();
  }
}

module.exports = {
  encryptCredentialsPayload,
  decryptCredentialsPayload,
  decryptMetaAccessToken
};
