const request = require('supertest');
const { createTestApp } = require('../helpers/createTestApp');

describe('Webhooks', () => {
  it('GET /webhook 200 con token válido', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .get('/webhook')
      .query({ token: process.env.ULTRAMSG_WEBHOOK_TOKEN });
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
  });

  it('GET /webhook 403 con token inválido', async () => {
    const { app } = createTestApp();
    await request(app).get('/webhook').query({ token: 'nope' }).expect(403);
  });

  it('POST /webhook 200 con already_processed', async () => {
    const { app, deps } = createTestApp({
      webhookManager: {
        handleWebhook: jest.fn().mockResolvedValue({
          processed: false,
          reason: 'already_processed'
        })
      }
    });
    const res = await request(app)
      .post('/webhook')
      .send({ data: { id: 'm1', from: '521@c.us', to: '522@c.us', body: 'hola' } });
    expect(res.status).toBe(200);
    expect(deps.webhookManager.handleWebhook).toHaveBeenCalled();
  });

  it('POST /webhook 200 con grupo ignorado', async () => {
    const { app } = createTestApp({
      webhookManager: {
        handleWebhook: jest.fn().mockResolvedValue({
          processed: true,
          reason: 'group_message_ignored'
        })
      }
    });
    await request(app)
      .post('/webhook')
      .send({ data: { id: 'g1', from: '120@g.us', to: '522@c.us', body: 'hola' } })
      .expect(200);
  });

  it('POST /webhook-own formato inválido', async () => {
    const { app, deps } = createTestApp({
      webhookManager: {
        handleOwnWebhook: jest.fn().mockResolvedValue({
          processed: false,
          reason: 'invalid_message_format'
        })
      }
    });
    const res = await request(app).post('/webhook-own').send({ foo: 1 });
    expect(res.status).toBe(200);
    expect(deps.webhookManager.handleOwnWebhook).toHaveBeenCalled();
  });

  it('POST /webhook-own missing message id', async () => {
    const { app } = createTestApp({
      webhookManager: {
        handleOwnWebhook: jest.fn().mockResolvedValue({
          processed: false,
          reason: 'missing_message_id'
        })
      }
    });
    await request(app)
      .post('/webhook-own')
      .send({ type: 'message.inbound', normalized: { from: 'a', to: 'b' } })
      .expect(200);
  });
});
