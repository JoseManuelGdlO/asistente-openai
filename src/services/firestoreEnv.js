/**
 * Producción usa la base Firestore `(default)` y los nombres de colección actuales.
 * QA usa otra base del mismo proyecto (`qa-db`) y el prefijo `QA_` en cada colección raíz.
 * EasyPanel no debe definir estas variables.
 */

const QA_DATABASE_ID = 'qa-db';
const QA_COLLECTION_PREFIX = 'QA_';

const ROOT_COLLECTIONS = Object.freeze([
  'clients',
  'Assistants',
  'bot_sessions',
  'blacklist-phone',
  'webhook_dedup',
  'login_confirmations',
  'assistant_edit_locks'
]);

function resolveFirestoreTarget(env = process.env) {
  const rawId = typeof env.FIRESTORE_DATABASE_ID === 'string' ? env.FIRESTORE_DATABASE_ID.trim() : '';
  const databaseId = !rawId || rawId === '(default)' ? '(default)' : rawId;
  let prefix = typeof env.FIRESTORE_COLLECTION_PREFIX === 'string'
    ? env.FIRESTORE_COLLECTION_PREFIX.trim()
    : '';

  if (databaseId === '(default)') {
    if (prefix) {
      throw new Error(
        'FIRESTORE_COLLECTION_PREFIX no puede usarse con la base (default). ' +
        'En producción deja vacías FIRESTORE_DATABASE_ID y FIRESTORE_COLLECTION_PREFIX.'
      );
    }
    return { databaseId, prefix: '', environment: 'production' };
  }

  if (!/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(databaseId)) {
    throw new Error(
      `FIRESTORE_DATABASE_ID="${databaseId}" no es válido. Usa "${QA_DATABASE_ID}".`
    );
  }

  if (!prefix) prefix = QA_COLLECTION_PREFIX;
  if (!prefix.startsWith('QA')) {
    throw new Error(
      `FIRESTORE_COLLECTION_PREFIX="${prefix}" tiene que empezar por QA ` +
      'para no confundir esas colecciones con las de producción.'
    );
  }

  return { databaseId, prefix, environment: 'qa' };
}

function collectionName(baseName, prefix = '') {
  if (!prefix) return baseName;
  if (baseName.startsWith(prefix)) return baseName;
  return `${prefix}${baseName}`;
}

function describeFirestoreTarget(env = process.env) {
  const target = resolveFirestoreTarget(env);
  const collections = {};
  for (const name of ROOT_COLLECTIONS) {
    collections[name] = collectionName(name, target.prefix);
  }
  return {
    environment: target.environment,
    databaseId: target.databaseId,
    collectionPrefix: target.prefix,
    collections
  };
}

module.exports = {
  QA_DATABASE_ID,
  QA_COLLECTION_PREFIX,
  ROOT_COLLECTIONS,
  resolveFirestoreTarget,
  collectionName,
  describeFirestoreTarget
};
