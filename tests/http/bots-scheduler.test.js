const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');

describe('Bots y scheduler', () => {
  it('GET /bots/status', async () => {
    const { app } = createTestApp({
      commandManager: {
        getAllBotsStatus: jest.fn(() => ({ C1: { status: 'active' } }))
      }
    });
    const res = await request(app).get('/bots/status').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.bots.C1.status).toBe('active');
  });

  it('POST /bots/command 400 sin campos', async () => {
    const { app } = createTestApp();
    const res = await request(app).post('/bots/command').set(authHeader()).send({});
    expect(res.status).toBe(400);
  });

  it('POST /bots/command ejecuta', async () => {
    const { app, deps } = createTestApp({
      commandManager: {
        executeCommand: jest.fn().mockResolvedValue('🤖 ENCENDIDO')
      }
    });
    const res = await request(app)
      .post('/bots/command')
      .set(authHeader())
      .send({ clientId: 'C1', command: '/on' });
    expect(res.status).toBe(200);
    expect(deps.commandManager.executeCommand).toHaveBeenCalledWith('C1', '/on', 'admin@system');
  });

  it('GET /scheduler/status', async () => {
    const { app } = createTestApp({
      schedulerController: {
        getTasksStatus: jest.fn(() => ({ ok: true, tasks: { daily: {} } }))
      }
    });
    const res = await request(app).get('/scheduler/status').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
