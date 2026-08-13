jest.mock('firebase-admin', () => {
  const { createInMemoryFirestore, createFirebaseAdminMock } = require('../helpers/mockFirebase');
  const firestore = createInMemoryFirestore();
  const admin = createFirebaseAdminMock(firestore);
  admin.__db = firestore;
  return admin;
});

const FirebaseService = require('../../src/services/firebaseService');

describe('FirebaseService webhook_dedup', () => {
  let service;

  beforeEach(() => {
    const admin = require('firebase-admin');
    admin.__db._reset();
    service = new FirebaseService();
  });

  it('primer claim ok y segundo falla', async () => {
    await expect(service.tryClaimWebhookMessage('ultra:1')).resolves.toBe(true);
    await expect(service.tryClaimWebhookMessage('ultra:1')).resolves.toBe(false);
  });

  it('completed vigente no se reclama', async () => {
    await service.tryClaimWebhookMessage('ultra:2');
    await service.markWebhookMessageCompleted('ultra:2');
    await expect(service.tryClaimWebhookMessage('ultra:2')).resolves.toBe(false);
  });

  it('expirado permite reclamar de nuevo', async () => {
    await service.tryClaimWebhookMessage('ultra:3', -1000);
    await expect(service.tryClaimWebhookMessage('ultra:3')).resolves.toBe(true);
  });

  it('releaseWebhookMessage permite reintento', async () => {
    await service.tryClaimWebhookMessage('own:9');
    await service.releaseWebhookMessage('own:9');
    await expect(service.tryClaimWebhookMessage('own:9')).resolves.toBe(true);
  });
});
