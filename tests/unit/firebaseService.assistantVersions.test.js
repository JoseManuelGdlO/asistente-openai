jest.mock('firebase-admin', () => {
  const { createInMemoryFirestore, createFirebaseAdminMock } = require('../helpers/mockFirebase');
  const firestore = createInMemoryFirestore();
  const admin = createFirebaseAdminMock(firestore);
  admin.__db = firestore;
  return admin;
});

const FirebaseService = require('../../src/services/firebaseService');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('FirebaseService assistant versions', () => {
  let service;

  beforeEach(() => {
    const admin = require('firebase-admin');
    admin.__db._reset();
    service = new FirebaseService();
  });

  async function seedAssistant() {
    await service.clientsCollection.doc('C1').set({ name: 'Clínica', status: 'active' });
    await service.assistantsCollection.doc('C1').set({
      clientId: 'C1',
      prompt: 'prompt vivo',
      tools: [{ type: 'function', name: 'enviar_pdf' }],
      config: { tone: 'calm' },
      responseSchema: { type: 'object', properties: { reply: { type: 'string' } } }
    });
  }

  it('publica el documento vivo y crea el hito con snapshot completo y nota vacía', async () => {
    await seedAssistant();

    const result = await service.publishAssistantVersion('C1', {
      prompt: 'prompt nuevo',
      tools: [{ type: 'function', name: 'otra' }]
    });

    expect(result.assistant.prompt).toBe('prompt nuevo');
    expect(result.assistant.tools).toEqual([{ type: 'function', name: 'otra' }]);
    expect(result.assistant.config).toEqual({ tone: 'calm' });
    expect(result.version.label).toBe('');
    expect(result.version.promptExcerpt).toBe('prompt nuevo');

    const stored = await service.getAssistantVersion('C1', result.version.id);
    expect(stored.prompt).toBe('prompt nuevo');
    expect(stored.tools).toEqual([{ type: 'function', name: 'otra' }]);
    expect(stored.config).toEqual({ tone: 'calm' });
    expect(stored.responseSchema).toEqual({ type: 'object', properties: { reply: { type: 'string' } } });
    expect(stored.label).toBe('');
  });

  it('no escribe nada si el Assistant no existe', async () => {
    await service.clientsCollection.doc('C2').set({ name: 'Sin assistant', status: 'active' });

    await expect(service.publishAssistantVersion('C2', { prompt: 'x' }))
      .rejects.toMatchObject({ code: 'ASSISTANT_NOT_FOUND' });

    const versions = await service.db.collection('Assistants/C2/versions').get();
    expect(versions.size).toBe(0);
    const assistant = await service.getAssistantByClientId('C2');
    expect(assistant).toBeNull();
  });

  it('rechaza una nota de más de 120 caracteres', async () => {
    await seedAssistant();
    await expect(service.publishAssistantVersion('C1', { label: `  ${'a'.repeat(121)}` }))
      .rejects.toMatchObject({ code: 'LABEL_TOO_LONG' });
    const versions = await service.listAssistantVersions('C1');
    expect(versions).toEqual([]);
  });

  it('lista de la más nueva a la más vieja con extracto de hasta 160 caracteres', async () => {
    await seedAssistant();
    const longPrompt = `linea uno\nlinea dos ${'x'.repeat(200)}`;
    await service.publishAssistantVersion('C1', { prompt: 'primero', label: 'vieja' });
    await wait(5);
    await service.publishAssistantVersion('C1', { prompt: longPrompt, label: 'nueva' });

    const versions = await service.listAssistantVersions('C1');
    expect(versions.map((version) => version.label)).toEqual(['nueva', 'vieja']);
    expect(versions[0].promptExcerpt.length).toBeLessThanOrEqual(160);
    expect(versions[0].promptExcerpt.startsWith('linea uno linea dos')).toBe(true);
    expect(versions[0].prompt).toBeUndefined();
  });

  it('restaurar copia los cuatro campos y no crea otro hito', async () => {
    await seedAssistant();
    const first = await service.publishAssistantVersion('C1', {
      prompt: 'version uno',
      tools: [],
      config: { step: 1 },
      responseSchema: { type: 'object' },
      label: 'uno'
    });
    await service.publishAssistantVersion('C1', {
      prompt: 'version dos',
      tools: [{ type: 'function', name: 'b' }],
      config: { step: 2 },
      responseSchema: { type: 'object', properties: { reply: { type: 'string' } } },
      label: 'dos'
    });

    const restored = await service.restoreAssistantVersion('C1', first.version.id);
    expect(restored.prompt).toBe('version uno');
    expect(restored.tools).toEqual([]);
    expect(restored.config).toEqual({ step: 1 });
    expect(restored.responseSchema).toEqual({ type: 'object' });

    const versions = await service.listAssistantVersions('C1');
    expect(versions).toHaveLength(2);
  });
});
