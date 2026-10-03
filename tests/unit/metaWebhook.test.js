const crypto = require('crypto');
const {
  verifyMetaWebhookChallenge,
  verifyMetaSignature,
  extractMetaInboundMessages
} = require('../../src/services/metaWebhook');

describe('metaWebhook helpers', () => {
  it('acepta el challenge correcto', () => {
    const result = verifyMetaWebhookChallenge({
      'hub.mode': 'subscribe',
      'hub.challenge': '99',
      'hub.verify_token': process.env.META_WEBHOOK_VERIFY_TOKEN
    });
    expect(result).toEqual({ ok: true, challenge: '99' });
  });

  it('verifica HMAC', () => {
    const raw = Buffer.from('{"ok":true}');
    const header = `sha256=${crypto.createHmac('sha256', process.env.META_APP_SECRET).update(raw).digest('hex')}`;
    expect(verifyMetaSignature(raw, header).ok).toBe(true);
    expect(verifyMetaSignature(raw, 'sha256=nope').ok).toBe(false);
  });

  it('extrae mensajes de texto por phone_number_id', () => {
    const messages = extractMetaInboundMessages({
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: '555', display_phone_number: '+52 618' },
            messages: [{ id: 'm1', from: '52111', type: 'text', text: { body: 'hola' } }]
          }
        }]
      }]
    });
    expect(messages).toEqual([
      {
        id: 'm1',
        from: '52111',
        to: '52618',
        body: 'hola',
        type: 'text',
        phoneNumberId: '555',
        displayPhone: '52618'
      }
    ]);
  });
});
