const crypto = require('crypto');
const request = require('supertest');
const { createTestApp } = require('../helpers/createTestApp');

function sign(body) {
  return `sha256=${crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex')}`;
}

describe('Webhook Meta', () => {
  it('GET /api/webhooks/meta challenge ok', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .get('/api/webhooks/meta')
      .query({
        'hub.mode': 'subscribe',
        'hub.challenge': '12345',
        'hub.verify_token': process.env.META_WEBHOOK_VERIFY_TOKEN
      });
    expect(res.status).toBe(200);
    expect(res.text).toBe('12345');
  });

  it('GET /api/webhooks/meta 403 con token inválido', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .get('/api/webhooks/meta/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.challenge': '12345',
        'hub.verify_token': 'nope'
      });
    expect(res.status).toBe(403);
  });

  it('POST /api/webhooks/meta 401 si la firma no coincide', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post('/api/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=deadbeef')
      .send({ object: 'whatsapp_business_account' });
    expect(res.status).toBe(401);
  });

  it('POST /api/webhooks/meta enruta por phone_number_id', async () => {
    const handleMetaWebhook = jest.fn().mockResolvedValue({
      processed: true,
      reason: 'ai_queued',
      clientId: 'C1'
    });
    const { app, deps } = createTestApp({
      webhookManager: { handleMetaWebhook }
    });
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: '555', display_phone_number: '52618' },
            messages: [{ id: 'wamid.1', from: '52111', type: 'text', text: { body: 'hola' } }]
          }
        }]
      }]
    };
    const raw = JSON.stringify(payload);
    const res = await request(app)
      .post('/api/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(raw))
      .send(raw);
    expect(res.status).toBe(200);
    expect(handleMetaWebhook).toHaveBeenCalled();
    expect(deps.webhookManager.handleWebhook).not.toHaveBeenCalled();
  });
});
