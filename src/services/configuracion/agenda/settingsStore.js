const { defaultSettings, clone } = require('./constants');

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

function normalizeSettings(data) {
  const base = defaultSettings();
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
    services: Array.isArray(data.services)
      ? clone(data.services).map((service) => ({
        ...service,
        capacity: Math.max(1, Number(service.capacity) || 1)
      }))
      : [],
    exceptions: Array.isArray(data.exceptions) ? clone(data.exceptions) : [],
    rules: data.rules && typeof data.rules === 'object' ? { ...base.rules, ...clone(data.rules) } : base.rules,
    enabled: data.enabled === true,
    playgroundWriteEnabled: data.playgroundWriteEnabled === true,
    encryptedTokens: typeof data.encryptedTokens === 'string' ? data.encryptedTokens : null,
    oauthNonce: data.oauthNonce || null,
    oauthNonceExpiresAt: Number(data.oauthNonceExpiresAt) || null,
    oauthVia: data.oauthVia === 'invite' ? 'invite' : null,
    adminNotice: data.adminNotice?.pending === true
      ? {
        pending: true,
        email: typeof data.adminNotice.email === 'string' ? data.adminNotice.email : '',
        connectedAt: asIso(data.adminNotice.connectedAt)
      }
      : null
  };
}

class MemorySettingsStore {
  constructor() {
    this.docs = new Map();
  }

  async getRaw(clientId) {
    if (!this.docs.has(clientId)) return defaultSettings();
    return clone(this.docs.get(clientId));
  }

  async listClientIds() {
    return [...this.docs.keys()];
  }

  async transaction(clientId, mutator) {
    const current = this.docs.has(clientId) ? clone(this.docs.get(clientId)) : defaultSettings();
    const next = mutator(current);
    this.docs.set(clientId, clone(next));
    return clone(next);
  }
}

class FirestoreSettingsStore {
  constructor(firebaseService) {
    if (!firebaseService?.agendaSettingsCollection || !firebaseService.db) {
      throw new Error('FirestoreSettingsStore requiere FirebaseService con agenda_settings');
    }
    this.collection = firebaseService.agendaSettingsCollection;
    this.db = firebaseService.db;
    this.FieldValue = require('firebase-admin').firestore.FieldValue;
  }

  async getRaw(clientId) {
    const snap = await this.collection.doc(clientId).get();
    if (!snap.exists) return defaultSettings();
    return normalizeSettings(snap.data());
  }

  async listClientIds() {
    const snap = await this.collection.get();
    return snap.docs.map((doc) => doc.id);
  }

  async transaction(clientId, mutator) {
    const ref = this.collection.doc(clientId);
    let saved = null;
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? normalizeSettings(snap.data()) : defaultSettings();
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

module.exports = {
  normalizeSettings,
  MemorySettingsStore,
  FirestoreSettingsStore
};
