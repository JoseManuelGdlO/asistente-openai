const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');

describe('Versiones del Assistant', () => {
  it('POST /assistants/:id/versions 200 publica y devuelve el hito', async () => {
    const saveAssistantVersion = jest.fn().mockResolvedValue({
      assistant: { clientId: 'C1', prompt: 'nuevo' },
      version: {
        id: 'v1',
        label: 'nota',
        createdAt: '2026-10-15T16:00:00.000Z',
        promptExcerpt: 'nuevo'
      }
    });
    const deleteSession = jest.fn().mockResolvedValue(true);
    const { app, deps } = createTestApp({
      commandManager: { saveAssistantVersion },
      openAIManager: { deleteSession }
    });

    const res = await request(app)
      .post('/assistants/C1/versions')
      .set(authHeader())
      .send({
        prompt: 'nuevo',
        label: ' nota ',
        tools: [],
        config: {},
        responseSchema: { type: 'object' }
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toBe('Versión guardada');
    expect(res.body.playgroundReset).toBe(true);
    expect(res.body.version.id).toBe('v1');
    expect(res.body.assistant.prompt).toBe('nuevo');
    expect(saveAssistantVersion).toHaveBeenCalledWith('C1', {
      label: 'nota',
      prompt: 'nuevo',
      tools: [],
      config: {},
      responseSchema: { type: 'object' }
    });
    expect(deleteSession).toHaveBeenCalledWith('playground_C1', 'C1');
    expect(deps.commandManager.updateAssistant).not.toHaveBeenCalled();
  });

  it('POST /assistants/:id/versions 400 si tools no es un array', async () => {
    const saveAssistantVersion = jest.fn();
    const { app } = createTestApp({
      commandManager: { saveAssistantVersion }
    });
    const res = await request(app)
      .post('/assistants/C1/versions')
      .set(authHeader())
      .send({ tools: { name: 'no' } });
    expect(res.status).toBe(400);
    expect(saveAssistantVersion).not.toHaveBeenCalled();
  });

  it('POST /assistants/:id/versions 400 si la nota supera 120 caracteres', async () => {
    const saveAssistantVersion = jest.fn();
    const { app } = createTestApp({
      commandManager: { saveAssistantVersion }
    });
    const res = await request(app)
      .post('/assistants/C1/versions')
      .set(authHeader())
      .send({ label: 'a'.repeat(121) });
    expect(res.status).toBe(400);
    expect(saveAssistantVersion).not.toHaveBeenCalled();
  });

  it('POST /assistants/:id/versions 404 si el Assistant no existe', async () => {
    const err = new Error('Assistant no encontrado');
    err.code = 'ASSISTANT_NOT_FOUND';
    const { app } = createTestApp({
      commandManager: { saveAssistantVersion: jest.fn().mockRejectedValue(err) }
    });
    const res = await request(app)
      .post('/assistants/C1/versions')
      .set(authHeader())
      .send({ prompt: 'nuevo' });
    expect(res.status).toBe(404);
  });

  it('POST deja playgroundReset en false si el reinicio falla', async () => {
    const { app } = createTestApp({
      commandManager: {
        saveAssistantVersion: jest.fn().mockResolvedValue({
          assistant: { clientId: 'C1' },
          version: { id: 'v1', label: '', createdAt: '2026-10-15T16:00:00.000Z', promptExcerpt: '' }
        })
      },
      openAIManager: { deleteSession: jest.fn().mockRejectedValue(new Error('playground')) }
    });
    const res = await request(app)
      .post('/assistants/C1/versions')
      .set(authHeader())
      .send({ prompt: 'nuevo' });
    expect(res.status).toBe(200);
    expect(res.body.playgroundReset).toBe(false);
    expect(res.body.message).toBe('Versión guardada');
  });

  it('GET /assistants/:id/versions conserva el orden del manager', async () => {
    const versions = [
      { id: 'v2', label: 'nueva', createdAt: '2026-10-15T18:00:00.000Z', promptExcerpt: 'b' },
      { id: 'v1', label: '', createdAt: '2026-10-15T17:00:00.000Z', promptExcerpt: 'a' }
    ];
    const { app } = createTestApp({
      commandManager: { listAssistantVersions: jest.fn().mockResolvedValue(versions) }
    });
    const res = await request(app).get('/assistants/C1/versions').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.versions.map((version) => version.id)).toEqual(['v2', 'v1']);
  });

  it('GET /assistants/:id/versions/:versionId devuelve el snapshot', async () => {
    const version = {
      id: 'v1',
      label: 'nota',
      createdAt: '2026-10-15T16:00:00.000Z',
      prompt: 'texto',
      tools: [],
      config: { tone: 'calm' },
      responseSchema: { type: 'object' }
    };
    const { app } = createTestApp({
      commandManager: { getAssistantVersion: jest.fn().mockResolvedValue(version) }
    });
    const res = await request(app).get('/assistants/C1/versions/v1').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.version).toEqual(version);
  });

  it('GET y POST restore responden 404 si la versión no existe', async () => {
    const err = new Error('Versión no encontrada');
    err.code = 'VERSION_NOT_FOUND';
    const { app } = createTestApp({
      commandManager: {
        getAssistantVersion: jest.fn().mockRejectedValue(err),
        restoreAssistantVersion: jest.fn().mockRejectedValue(err)
      }
    });
    const getRes = await request(app).get('/assistants/C1/versions/missing').set(authHeader());
    const postRes = await request(app).post('/assistants/C1/versions/missing/restore').set(authHeader());
    expect(getRes.status).toBe(404);
    expect(postRes.status).toBe(404);
  });

  it('POST restore actualiza el Assistant y no crea un hito', async () => {
    const restoreAssistantVersion = jest.fn().mockResolvedValue({ clientId: 'C1', prompt: 'viejo' });
    const saveAssistantVersion = jest.fn();
    const { app } = createTestApp({
      commandManager: { restoreAssistantVersion, saveAssistantVersion },
      openAIManager: { deleteSession: jest.fn().mockResolvedValue(true) }
    });
    const res = await request(app)
      .post('/assistants/C1/versions/v1/restore')
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Versión restaurada');
    expect(res.body.playgroundReset).toBe(true);
    expect(res.body.assistant.prompt).toBe('viejo');
    expect(restoreAssistantVersion).toHaveBeenCalledWith('C1', 'v1');
    expect(saveAssistantVersion).not.toHaveBeenCalled();
  });

  it('PUT /assistants/:id no guarda una versión', async () => {
    const updateAssistant = jest.fn().mockResolvedValue({ clientId: 'C1', prompt: 'nuevo' });
    const saveAssistantVersion = jest.fn();
    const { app } = createTestApp({
      commandManager: { updateAssistant, saveAssistantVersion }
    });
    const res = await request(app)
      .put('/assistants/C1')
      .set(authHeader())
      .send({ prompt: 'nuevo' });
    expect(res.status).toBe(200);
    expect(updateAssistant).toHaveBeenCalled();
    expect(saveAssistantVersion).not.toHaveBeenCalled();
  });
});
