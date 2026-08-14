const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');

describe('Clientes y assistants', () => {
  it('POST /clients 400 si faltan campos', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post('/clients')
      .set(authHeader())
      .send({ name: 'Solo nombre' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/adminPhone/);
  });

  it('POST /clients 201 con mock', async () => {
    const { app, deps } = createTestApp({
      commandManager: {
        createClient: jest.fn().mockResolvedValue({
          client: { id: 'C1', name: 'Test' },
          assistant: { clientId: 'C1' }
        })
      }
    });
    const res = await request(app)
      .post('/clients')
      .set(authHeader())
      .send({
        name: 'Test',
        adminPhone: '521111',
        assistantPhone: '521222'
      });
    expect(res.status).toBe(201);
    expect(res.body.client.id).toBe('C1');
    expect(deps.commandManager.createClient).toHaveBeenCalled();
  });

  it('GET /clients/:id 404', async () => {
    const { app } = createTestApp({
      firebaseService: { getClientById: jest.fn().mockResolvedValue(null) }
    });
    const res = await request(app).get('/clients/NOPE').set(authHeader());
    expect(res.status).toBe(404);
  });

  it('GET /clients/:id 200', async () => {
    const { app } = createTestApp({
      firebaseService: {
        getClientById: jest.fn().mockResolvedValue({ id: 'C1', name: 'Test' })
      }
    });
    const res = await request(app).get('/clients/C1').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.client.name).toBe('Test');
  });

  it('PUT /clients/:id', async () => {
    const { app, deps } = createTestApp({
      commandManager: {
        updateClient: jest.fn().mockResolvedValue({ id: 'C1', name: 'Nuevo' })
      }
    });
    const res = await request(app)
      .put('/clients/C1')
      .set(authHeader())
      .send({ name: 'Nuevo' });
    expect(res.status).toBe(200);
    expect(deps.commandManager.updateClient).toHaveBeenCalledWith('C1', { name: 'Nuevo' });
  });

  it('DELETE /clients/:id', async () => {
    const { app } = createTestApp({
      commandManager: { deleteClient: jest.fn().mockResolvedValue({ id: 'C1' }) }
    });
    const res = await request(app).delete('/clients/C1').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /assistants/:id 404', async () => {
    const { app } = createTestApp({
      commandManager: { getAssistantConfig: jest.fn().mockResolvedValue(null) }
    });
    const res = await request(app).get('/assistants/C1').set(authHeader());
    expect(res.status).toBe(404);
  });

  it('PUT /assistants/:id 404 si no existe', async () => {
    const err = new Error('Cliente no encontrado');
    err.code = 'CLIENT_NOT_FOUND';
    const { app } = createTestApp({
      commandManager: { updateAssistant: jest.fn().mockRejectedValue(err) }
    });
    const res = await request(app)
      .put('/assistants/C1')
      .set(authHeader())
      .send({ prompt: 'nuevo' });
    expect(res.status).toBe(404);
  });

  it('PUT /assistants/:id 200', async () => {
    const { app } = createTestApp({
      commandManager: {
        updateAssistant: jest.fn().mockResolvedValue({ clientId: 'C1', prompt: 'nuevo' })
      }
    });
    const res = await request(app)
      .put('/assistants/C1')
      .set(authHeader())
      .send({ prompt: 'nuevo' });
    expect(res.status).toBe(200);
    expect(res.body.assistant.prompt).toBe('nuevo');
  });

  it('GET /clients/status y POST /clients/reload', async () => {
    const clients = {
      C1: { name: 'A', adminPhone: '1', assistantPhone: '2', botStatus: 'active', status: 'active' }
    };
    const { app, deps } = createTestApp({
      commandManager: {
        getClientConfig: jest.fn(() => clients),
        reloadClients: jest.fn().mockResolvedValue(undefined)
      }
    });

    const status = await request(app).get('/clients/status').set(authHeader());
    expect(status.status).toBe(200);
    expect(status.body.count).toBe(1);

    const reload = await request(app).post('/clients/reload').set(authHeader());
    expect(reload.status).toBe(200);
    expect(deps.commandManager.reloadClients).toHaveBeenCalled();
  });
});
