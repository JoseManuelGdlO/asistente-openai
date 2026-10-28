const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');

function editorHeaders(id = 'editor-a') {
  return { ...authHeader(), 'X-Editor-Id': id };
}

describe('API blacklist por bot', () => {
  it('GET lista números del bot', async () => {
    const { app, deps } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' })
      },
      firebaseService: {
        getBlacklist: jest.fn().mockResolvedValue([{ id: '1', phone: '5211111111111' }])
      }
    });
    const res = await request(app).get('/clients/C1/blacklist').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.phones).toEqual([{ id: '1', phone: '5211111111111' }]);
    expect(deps.firebaseService.getBlacklist).toHaveBeenCalledWith('C1');
  });

  it('GET 404 si assistant no existe', async () => {
    const { app } = createTestApp({
      commandManager: { getAssistantConfig: jest.fn().mockResolvedValue(null) }
    });
    const res = await request(app).get('/clients/MISSING/blacklist').set(authHeader());
    expect(res.status).toBe(404);
  });

  it('POST agrega número con edit-lock', async () => {
    const { app, deps } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' })
      },
      firebaseService: {
        addToBlacklist: jest.fn().mockResolvedValue({ added: true, id: 'bl2' }),
        getBlacklist: jest.fn().mockResolvedValue([{ id: 'bl2', phone: '5222222222222' }])
      }
    });
    const res = await request(app)
      .post('/clients/C1/blacklist')
      .set(editorHeaders())
      .send({ phone: '5222222222222@c.us' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.added).toBe(true);
    expect(deps.firebaseService.addToBlacklist).toHaveBeenCalledWith('C1', '5222222222222@c.us');
    expect(res.body.phones).toHaveLength(1);
  });

  it('POST 400 sin teléfono', async () => {
    const { app } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' })
      }
    });
    const res = await request(app)
      .post('/clients/C1/blacklist')
      .set(editorHeaders())
      .send({});
    expect(res.status).toBe(400);
  });

  it('POST 409 sin edit-lock', async () => {
    const err = new Error('Otro usuario está editando este bot');
    err.code = 'EDIT_LOCK_NOT_HOLDER';
    const { app } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' })
      },
      firebaseService: {
        assertEditLockHolder: jest.fn().mockRejectedValue(err)
      }
    });
    const res = await request(app)
      .post('/clients/C1/blacklist')
      .set(editorHeaders())
      .send({ phone: '5211111111111' });
    expect(res.status).toBe(409);
  });

  it('DELETE quita número', async () => {
    const { app, deps } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' })
      },
      firebaseService: {
        removeFromBlacklist: jest.fn().mockResolvedValue(true),
        getBlacklist: jest.fn().mockResolvedValue([])
      }
    });
    const res = await request(app)
      .delete('/clients/C1/blacklist/5211111111111')
      .set(editorHeaders());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.removed).toBe(true);
    expect(deps.firebaseService.removeFromBlacklist).toHaveBeenCalledWith('C1', '5211111111111');
  });
});
