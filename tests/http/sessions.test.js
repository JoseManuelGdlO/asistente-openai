const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');

describe('Endpoints de sesiones', () => {
  it('GET /sessions pasa filtros', async () => {
    const { app, deps } = createTestApp({
      openAIManager: {
        listSessions: jest.fn().mockResolvedValue([
          { id: 'u1_C1', userId: 'u1', clientCode: 'C1', itemsCount: 2 }
        ])
      }
    });

    const res = await request(app)
      .get('/sessions')
      .query({ userId: 'u1', clientCode: 'C1' })
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(deps.openAIManager.listSessions).toHaveBeenCalledWith({
      userId: 'u1',
      clientCode: 'C1'
    });
  });

  it('POST /reset_sessions', async () => {
    const { app, deps } = createTestApp({
      openAIManager: { resetSessions: jest.fn().mockResolvedValue(3) }
    });
    const res = await request(app).post('/reset_sessions').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(3);
    expect(deps.openAIManager.resetSessions).toHaveBeenCalled();
  });

  it('DELETE /sessions/user/:userId', async () => {
    const { app, deps } = createTestApp({
      openAIManager: { deleteSessionsByUserId: jest.fn().mockResolvedValue(2) }
    });
    const res = await request(app).delete('/sessions/user/521').set(authHeader());
    expect(res.body.deleted).toBe(2);
    expect(deps.openAIManager.deleteSessionsByUserId).toHaveBeenCalledWith('521');
  });

  it('DELETE /sessions/client/:clientCode', async () => {
    const { app, deps } = createTestApp({
      openAIManager: { deleteSessionsByClientCode: jest.fn().mockResolvedValue(4) }
    });
    const res = await request(app).delete('/sessions/client/CLIENTE001').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(4);
    expect(deps.openAIManager.deleteSessionsByClientCode).toHaveBeenCalledWith('CLIENTE001');
  });

  it('DELETE /sessions/:userId/:clientCode', async () => {
    const { app, deps } = createTestApp({
      openAIManager: { deleteSession: jest.fn().mockResolvedValue(true) }
    });
    const res = await request(app).delete('/sessions/521/CLIENTE001').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/521_CLIENTE001/);
    expect(deps.openAIManager.deleteSession).toHaveBeenCalledWith('521', 'CLIENTE001');
  });
});
