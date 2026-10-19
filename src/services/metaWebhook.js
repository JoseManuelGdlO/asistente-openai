const crypto = require('crypto');
const { digitsOnly } = require('./metaConfig');

function readHubParam(query, key) {
  if (!query) return '';
  const value = query[key] ?? query[key.replace('.', '_')];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function verifyMetaWebhookChallenge(query) {
  const mode = readHubParam(query, 'hub.mode');
  const challenge = readHubParam(query, 'hub.challenge');
  const token = readHubParam(query, 'hub.verify_token');
  const expected = String(process.env.META_WEBHOOK_VERIFY_TOKEN || '').trim();
  if (mode === 'subscribe' && challenge && expected && token === expected) {
    return { ok: true, challenge };
  }
  return { ok: false, challenge: null };
}

function verifyMetaSignature(raw, header) {
  const secret = String(process.env.META_APP_SECRET || '').trim();
  if (!secret) return { ok: true, skipped: true };
  const rawBuffer = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''), 'utf8');
  const received = String(header || '').trim();
  if (!received) return { ok: false, skipped: false };
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBuffer).digest('hex')}`;
  const receivedBuf = Buffer.from(received);
  const expectedBuf = Buffer.from(expected);
  if (receivedBuf.length !== expectedBuf.length) return { ok: false, skipped: false };
  return { ok: crypto.timingSafeEqual(receivedBuf, expectedBuf), skipped: false };
}

function parseMetaRawBody(body) {
  if (Buffer.isBuffer(body)) {
    const text = body.toString('utf8');
    return text ? JSON.parse(text) : {};
  }
  if (typeof body === 'string') {
    return body ? JSON.parse(body) : {};
  }
  return body && typeof body === 'object' ? body : {};
}

function extractMetaInboundMessages(payload) {
  const messages = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change?.field && change.field !== 'messages') continue;
      const value = change?.value || {};
      const metadata = value.metadata || {};
      const phoneNumberId = String(metadata.phone_number_id || '').trim();
      const displayPhone = digitsOnly(metadata.display_phone_number);
      const inbound = Array.isArray(value.messages) ? value.messages : [];
      for (const message of inbound) {
        const type = String(message.type || 'text').toLowerCase();
        if (type === 'text') {
          messages.push({
            id: String(message.id || ''),
            from: String(message.from || ''),
            to: displayPhone || phoneNumberId,
            body: String(message.text?.body || ''),
            type,
            phoneNumberId,
            displayPhone
          });
          continue;
        }
        if (type === 'document') {
          messages.push({
            id: String(message.id || ''),
            from: String(message.from || ''),
            to: displayPhone || phoneNumberId,
            body: String(message.document?.caption || ''),
            type,
            mediaId: message.document?.id || null,
            filename: message.document?.filename || '',
            phoneNumberId,
            displayPhone
          });
        }
      }
    }
  }
  return messages;
}

module.exports = {
  readHubParam,
  verifyMetaWebhookChallenge,
  verifyMetaSignature,
  parseMetaRawBody,
  extractMetaInboundMessages
};
