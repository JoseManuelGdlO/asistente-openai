jest.mock('firebase-admin', () => {
  const { createInMemoryFirestore, createFirebaseAdminMock } = require('../helpers/mockFirebase');
  const firestore = createInMemoryFirestore();
  const admin = createFirebaseAdminMock(firestore);
  admin.__db = firestore;
  return admin;
});

const FirebaseService = require('../../src/services/firebaseService');

describe('FirebaseService bot_sessions', () => {
  let service;

  beforeEach(() => {
    const admin = require('firebase-admin');
    admin.__db._reset();
    service = new FirebaseService();
  });

  it('sessionId combina userId y clientCode', () => {
    expect(service.sessionId('521', 'CLIENTE001')).toBe('521_CLIENTE001');
  });

  it('getOrCreate crea y reutiliza sesión', async () => {
    const created = await service.getOrCreateBotSession('521', 'C1');
    expect(created.userId).toBe('521');
    expect(created.items).toEqual([]);
    const again = await service.getOrCreateBotSession('521', 'C1');
    expect(again.id).toBe(created.id);
  });

  it('tryLock adquiere lock y rechaza si está ocupado', async () => {
    const first = await service.tryLockBotSession('521', 'C1', 180000);
    expect(first).toBe(true);
    const second = await service.tryLockBotSession('521', 'C1', 180000);
    expect(second).toBe(false);
  });

  it('refreshBotSessionLock renueva lockedUntil', async () => {
    await service.tryLockBotSession('521', 'C1', 1000);
    await service.refreshBotSessionLock('521', 'C1', 180000);
    const session = await service.getBotSession('521', 'C1');
    expect(new Date(session.lockedUntil).getTime()).toBeGreaterThan(Date.now() + 1000);
  });

  it('summarizeBotSession reporta isLocked', () => {
    const locked = service.summarizeBotSession({
      id: '521_C1',
      data: () => ({
        userId: '521',
        clientCode: 'C1',
        items: [1, 2],
        lockedUntil: new Date(Date.now() + 60000)
      })
    });
    expect(locked.isLocked).toBe(true);
    expect(locked.itemsCount).toBe(2);

    const free = service.summarizeBotSession({
      id: '521_C1',
      data: () => ({ userId: '521', clientCode: 'C1', items: [], lockedUntil: null })
    });
    expect(free.isLocked).toBe(false);
  });

  it('lista, borra por usuario/consultorio y resetea', async () => {
    await service.saveBotSession('u1', 'C1', { items: [{ type: 'message' }] });
    await service.saveBotSession('u2', 'C1', { items: [] });
    await service.saveBotSession('u1', 'C2', { items: [] });

    const byClient = await service.listBotSessions({ clientCode: 'C1' });
    expect(byClient).toHaveLength(2);

    const deletedClient = await service.deleteBotSessionsByClientCode('C1');
    expect(deletedClient).toBe(2);

    const remaining = await service.listBotSessions();
    expect(remaining).toHaveLength(1);

    await service.deleteBotSessionsByUserId('u1');
    expect(await service.listBotSessions()).toHaveLength(0);

    await service.saveBotSession('u3', 'C3', { items: [] });
    expect(await service.resetAllBotSessions()).toBe(1);
  });
});
