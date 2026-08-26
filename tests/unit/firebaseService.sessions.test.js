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

  it('enqueue appendea y reinicia flushAt', async () => {
    const t0 = 1_000_000;
    const first = await service.enqueuePendingChatMessage(
      '521',
      'C1',
      'sii perdoname',
      { origin: 'ultramsg', from: '521', clientId: 'C1' },
      { debounceMs: 2500, maxMs: 8000, now: t0 }
    );
    expect(first.accepted).toBe(true);
    expect(first.flushAt.getTime()).toBe(t0 + 2500);

    const second = await service.enqueuePendingChatMessage(
      '521',
      'C1',
      'perdon perdon',
      { origin: 'ultramsg', instanceId: 'inst-2' },
      { debounceMs: 2500, maxMs: 8000, now: t0 + 400 }
    );
    expect(second.accepted).toBe(true);
    expect(second.flushAt.getTime()).toBe(t0 + 400 + 2500);

    const session = await service.getBotSession('521', 'C1');
    expect(session.pendingMessages).toEqual(['sii perdoname', 'perdon perdon']);
    expect(session.pendingFlushContext.instanceId).toBe('inst-2');
    expect(session.pendingFlushContext.from).toBe('521');
  });

  it('enqueue respeta el máximo desde el primer mensaje del lote', async () => {
    const t0 = 5_000_000;
    await service.enqueuePendingChatMessage('521', 'C1', 'a', {}, {
      debounceMs: 2500,
      maxMs: 8000,
      now: t0
    });
    const late = await service.enqueuePendingChatMessage('521', 'C1', 'b', {}, {
      debounceMs: 2500,
      maxMs: 8000,
      now: t0 + 7000
    });
    expect(late.flushAt.getTime()).toBe(t0 + 8000);
  });

  it('enqueue ignora el mensaje si el lock está ocupado', async () => {
    await service.tryLockBotSession('521', 'C1', 180000);
    const result = await service.enqueuePendingChatMessage('521', 'C1', 'si', {});
    expect(result).toEqual({ accepted: false, reason: 'locked' });
    const session = await service.getBotSession('521', 'C1');
    expect(session.pendingMessages).toEqual([]);
  });

  it('claim too_early si flushAt no ha vencido', async () => {
    const t0 = 8_000_000;
    await service.enqueuePendingChatMessage('521', 'C1', 'hola', {}, {
      debounceMs: 2500,
      maxMs: 8000,
      now: t0
    });
    const tooEarly = await service.claimPendingChatFlush('521', 'C1', { now: t0 + 100 });
    expect(tooEarly.claimed).toBe(false);
    expect(tooEarly.reason).toBe('too_early');
    const session = await service.getBotSession('521', 'C1');
    expect(session.pendingMessages).toEqual(['hola']);
    expect(session.lockedUntil).toBeFalsy();
  });

  it('claim toma el lote y el lock; enqueue posterior se ignora', async () => {
    const t0 = Date.now();
    await service.enqueuePendingChatMessage(
      '521',
      'C1',
      'sii perdoname',
      { origin: 'ultramsg', from: '521', clientId: 'C1', apiKey: 'secret' },
      { debounceMs: 2500, maxMs: 8000, now: t0 }
    );
    await service.enqueuePendingChatMessage('521', 'C1', 'si', {}, {
      debounceMs: 2500,
      maxMs: 8000,
      now: t0 + 200
    });

    const claimed = await service.claimPendingChatFlush('521', 'C1', {
      now: t0 + 3000,
      lockMs: 180000
    });
    expect(claimed.claimed).toBe(true);
    expect(claimed.messages).toEqual(['sii perdoname', 'si']);
    expect(claimed.flushContext.apiKey).toBeUndefined();
    expect(claimed.flushContext.from).toBe('521');

    expect(await service.isBotSessionLocked('521', 'C1')).toBe(true);

    const ignored = await service.enqueuePendingChatMessage('521', 'C1', 'otro', {});
    expect(ignored.reason).toBe('locked');

    const session = await service.getBotSession('521', 'C1');
    expect(session.pendingMessages).toEqual([]);
    expect(session.flushAt).toBeNull();
  });

  it('listSessionsDueForFlush solo incluye lotes vencidos con pending', async () => {
    const now = Date.now();
    await service.enqueuePendingChatMessage('u1', 'C1', 'ya', {}, {
      debounceMs: 0,
      maxMs: 0,
      now: now - 10
    });
    await service.enqueuePendingChatMessage('u2', 'C1', 'luego', {}, {
      debounceMs: 60_000,
      maxMs: 60_000,
      now
    });

    const due = await service.listSessionsDueForFlush(new Date());
    expect(due).toEqual([
      expect.objectContaining({ userId: 'u1', clientCode: 'C1' })
    ]);
  });
});
