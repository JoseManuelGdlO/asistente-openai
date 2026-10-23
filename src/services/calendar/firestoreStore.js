const { defaultDocument, clone } = require('./constants');

function asIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function normalizeDoc(data) {
  const base = defaultDocument();
  if (!data || typeof data !== 'object') return base;
  const connection = data.connection && typeof data.connection === 'object' ? data.connection : {};
  return {
    ...base,
    ...clone(data),
    connection: {
      ...base.connection,
      ...connection,
      connectedAt: asIso(connection.connectedAt)
    },
    hours: data.hours && typeof data.hours === 'object' ? clone(data.hours) : base.hours,
    services: Array.isArray(data.services) ? clone(data.services) : [],
    rules: data.rules && typeof data.rules === 'object' ? { ...base.rules, ...clone(data.rules) } : base.rules,
    busy: Array.isArray(data.busy) ? clone(data.busy) : [],
    enabled: data.enabled === true,
    playgroundWriteEnabled: data.playgroundWriteEnabled === true,
    encryptedTokens: typeof data.encryptedTokens === 'string' ? data.encryptedTokens : null,
    oauthNonce: data.oauthNonce || null,
    oauthNonceExpiresAt: Number(data.oauthNonceExpiresAt) || null
  };
}

class FirestoreCalendarStore {
  constructor(firebaseService) {
    if (!firebaseService?.calendarSettingsCollection || !firebaseService.db) {
      throw new Error('FirestoreCalendarStore requiere FirebaseService con calendar_settings');
    }
    this.collection = firebaseService.calendarSettingsCollection;
    this.db = firebaseService.db;
    this.FieldValue = require('firebase-admin').firestore.FieldValue;
  }

  async getRaw(clientId) {
    const snap = await this.collection.doc(clientId).get();
    if (!snap.exists) return defaultDocument();
    return normalizeDoc(snap.data());
  }

  async transaction(clientId, mutator) {
    const ref = this.collection.doc(clientId);
    let saved = null;
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? normalizeDoc(snap.data()) : defaultDocument();
      const next = mutator(current);
      saved = clone(next);
      tx.set(ref, {
        ...saved,
        updatedAt: this.FieldValue.serverTimestamp()
      });
    });
    return saved;
  }
}

module.exports = { FirestoreCalendarStore, normalizeDoc };
