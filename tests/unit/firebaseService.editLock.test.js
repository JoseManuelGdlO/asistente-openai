jest.mock('firebase-admin', () => {
  const { createInMemoryFirestore, createFirebaseAdminMock } = require('../helpers/mockFirebase');
  const firestore = createInMemoryFirestore();
  const admin = createFirebaseAdminMock(firestore);
  admin.__db = firestore;
  return admin;
});

const FirebaseService = require('../../src/services/firebaseService');

describe('FirebaseService assistant edit locks', () => {
  let service;

  beforeEach(() => {
    const admin = require('firebase-admin');
    admin.__db._reset();
    service = new FirebaseService();
  });

  it('acquire otorga el lease al primero y rechaza al segundo', async () => {
    const first = await service.acquireEditLock('C1', 'editor-a');
    expect(first.isHolder).toBe(true);
    expect(first.held).toBe(true);

    const second = await service.acquireEditLock('C1', 'editor-b');
    expect(second.isHolder).toBe(false);
    expect(second.held).toBe(true);
  });

  it('acquire renueva si es el mismo holder', async () => {
    await service.acquireEditLock('C1', 'editor-a', { ttlMs: 1000 });
    const again = await service.acquireEditLock('C1', 'editor-a', { ttlMs: 120000 });
    expect(again.isHolder).toBe(true);
    expect(new Date(again.expiresAt).getTime()).toBeGreaterThan(Date.now() + 1000);
  });

  it('acquire toma lease vencido', async () => {
    await service.acquireEditLock('C1', 'editor-a', { ttlMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const next = await service.acquireEditLock('C1', 'editor-b', { ttlMs: 120000 });
    expect(next.isHolder).toBe(true);
  });

  it('heartbeat falla si no eres holder', async () => {
    await service.acquireEditLock('C1', 'editor-a');
    await expect(service.heartbeatEditLock('C1', 'editor-b')).rejects.toMatchObject({
      code: 'EDIT_LOCK_NOT_HOLDER'
    });
  });

  it('release solo libera al holder', async () => {
    await service.acquireEditLock('C1', 'editor-a');
    await service.releaseEditLock('C1', 'editor-b');
    const stillHeld = await service.getEditLock('C1', 'editor-a');
    expect(stillHeld.isHolder).toBe(true);

    await service.releaseEditLock('C1', 'editor-a');
    const free = await service.getEditLock('C1', 'editor-b');
    expect(free.held).toBe(false);
  });

  it('assertEditLockHolder exige holder vigente', async () => {
    await service.acquireEditLock('C1', 'editor-a');
    await expect(service.assertEditLockHolder('C1', 'editor-a')).resolves.toMatchObject({
      isHolder: true
    });
    await expect(service.assertEditLockHolder('C1', 'editor-b')).rejects.toMatchObject({
      code: 'EDIT_LOCK_NOT_HOLDER'
    });
    await expect(service.assertEditLockHolder('C1', '')).rejects.toMatchObject({
      code: 'INVALID_EDITOR'
    });
  });
});
