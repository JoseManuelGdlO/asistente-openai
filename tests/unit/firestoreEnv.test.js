const {
  QA_DATABASE_ID,
  QA_COLLECTION_PREFIX,
  resolveFirestoreTarget,
  collectionName,
  describeFirestoreTarget
} = require('../../src/services/firestoreEnv');

describe('firestoreEnv', () => {
  it('deja producción en (default) y sin prefijo cuando no hay variables', () => {
    const target = describeFirestoreTarget({});
    expect(target).toEqual({
      environment: 'production',
      databaseId: '(default)',
      collectionPrefix: '',
      collections: {
        clients: 'clients',
        Assistants: 'Assistants',
        bot_sessions: 'bot_sessions',
        'blacklist-phone': 'blacklist-phone',
        webhook_dedup: 'webhook_dedup',
        login_confirmations: 'login_confirmations',
        assistant_edit_locks: 'assistant_edit_locks'
      }
    });
  });

  it('en qa-db aplica el prefijo QA_ aunque no se defina el prefijo', () => {
    const target = resolveFirestoreTarget({ FIRESTORE_DATABASE_ID: QA_DATABASE_ID });
    expect(target).toEqual({
      databaseId: QA_DATABASE_ID,
      prefix: QA_COLLECTION_PREFIX,
      environment: 'qa'
    });
    expect(collectionName('Assistants', target.prefix)).toBe('QA_Assistants');
    expect(collectionName('QA_clients', target.prefix)).toBe('QA_clients');
  });

  it('rechaza un prefijo dentro de la base de producción', () => {
    expect(() => resolveFirestoreTarget({
      FIRESTORE_DATABASE_ID: '(default)',
      FIRESTORE_COLLECTION_PREFIX: 'QA_'
    })).toThrow(/no puede usarse con la base \(default\)/);
  });

  it('rechaza un prefijo que no identifica QA', () => {
    expect(() => resolveFirestoreTarget({
      FIRESTORE_DATABASE_ID: QA_DATABASE_ID,
      FIRESTORE_COLLECTION_PREFIX: 'staging_'
    })).toThrow(/empezar por QA/);
  });
});
