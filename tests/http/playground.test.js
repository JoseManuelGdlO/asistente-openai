const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');

describe('Playground', () => {
  it('GET /playground/:clientId incluye pending y debounce', async () => {
    const flushAt = new Date(Date.now() + 2000);
    const { app } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', prompt: 'hola' })
      },
      openAIManager: {
        getSession: jest.fn().mockResolvedValue({
          items: [{ type: 'message', role: 'user', content: 'previo' }],
          pendingMessages: ['sii', 'perdon'],
          flushAt,
          lockedUntil: null
        })
      }
    });

    const res = await request(app)
      .get('/playground/C1')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('playground_C1');
    expect(res.body.pendingMessages).toEqual(['sii', 'perdon']);
    expect(res.body.flushAt).toBe(flushAt.toISOString());
    expect(res.body.locked).toBe(false);
    expect(typeof res.body.debounceMs).toBe('number');
  });

  it('POST /playground/:clientId/chat encola con debounce', async () => {
    const flushAt = new Date(Date.now() + 2500);
    const queueChatMessage = jest.fn().mockResolvedValue({
      accepted: true,
      reason: 'queued',
      flushAt
    });
    const { app, deps } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1' })
      },
      webhookManager: {
        debounceManager: { queueChatMessage }
      }
    });

    const res = await request(app)
      .post('/playground/C1/chat')
      .set(authHeader())
      .send({ message: 'sii perdoname' });

    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(true);
    expect(res.body.reason).toBe('ai_queued');
    expect(queueChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'playground_C1',
      clientCode: 'C1',
      text: 'sii perdoname',
      flushContext: { origin: 'playground', clientId: 'C1' }
    }));
    expect(deps.openAIManager.processMessage).not.toHaveBeenCalled();
  });

  it('POST /playground/:clientId/chat ignora si hay lock', async () => {
    const queueChatMessage = jest.fn().mockResolvedValue({
      accepted: false,
      reason: 'locked'
    });
    const { app } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1' })
      },
      webhookManager: {
        debounceManager: { queueChatMessage }
      }
    });

    const res = await request(app)
      .post('/playground/C1/chat')
      .set(authHeader())
      .send({ message: 'otro' });

    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(true);
    expect(res.body.reason).toBe('ignored_locked');
    expect(res.body.reply).toBe('');
  });
});
