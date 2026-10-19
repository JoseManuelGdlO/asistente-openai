const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');

function editorHeader(id = 'editor-a') {
  return { ...authHeader(), 'X-Editor-Id': id };
}

describe('Edit lock del panel', () => {
  it('POST acquire devuelve isHolder', async () => {
    const acquireEditLock = jest.fn().mockResolvedValue({
      clientId: 'C1',
      held: true,
      isHolder: true,
      expiresAt: '2099-01-01T00:00:00.000Z'
    });
    const { app } = createTestApp({
      firebaseService: { acquireEditLock }
    });

    const res = await request(app)
      .post('/bots/C1/edit-lock/acquire')
      .set(editorHeader('editor-a'))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.lock.isHolder).toBe(true);
    expect(acquireEditLock).toHaveBeenCalledWith('C1', 'editor-a', expect.any(Object));
  });

  it('POST acquire 400 sin X-Editor-Id', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post('/bots/C1/edit-lock/acquire')
      .set(authHeader())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_EDITOR');
  });

  it('PUT /assistants/:id 409 si no eres holder', async () => {
    const err = new Error('Otro usuario está editando este bot');
    err.code = 'EDIT_LOCK_NOT_HOLDER';
    const updateAssistant = jest.fn();
    const { app } = createTestApp({
      firebaseService: {
        assertEditLockHolder: jest.fn().mockRejectedValue(err)
      },
      commandManager: { updateAssistant }
    });

    const res = await request(app)
      .put('/assistants/C1')
      .set(editorHeader('editor-b'))
      .send({ prompt: 'hola' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EDIT_LOCK_NOT_HOLDER');
    expect(updateAssistant).not.toHaveBeenCalled();
  });

  it('PUT /clients/:id exige holder', async () => {
    const err = new Error('Otro usuario está editando este bot');
    err.code = 'EDIT_LOCK_NOT_HOLDER';
    const updateClient = jest.fn();
    const { app } = createTestApp({
      firebaseService: {
        assertEditLockHolder: jest.fn().mockRejectedValue(err)
      },
      commandManager: { updateClient }
    });

    const res = await request(app)
      .put('/clients/C1')
      .set(editorHeader('editor-b'))
      .send({ name: 'X' });

    expect(res.status).toBe(409);
    expect(updateClient).not.toHaveBeenCalled();
  });
});
