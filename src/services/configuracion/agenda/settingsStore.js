const { DEFAULT_TIMEZONE, defaultHours, defaultRules } = require('./constants');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function defaultConnection() {
  return {
    status: 'disconnected',
    email: '',
    calendarId: '',
    calendarSummary: '',
    connectedAt: null,
    lastError: ''
  };
}

function defaultDocument() {
  return {
    enabled: false,
    playgroundWriteEnabled: false,
    connection: defaultConnection(),
    timezone: DEFAULT_TIMEZONE,
    hours: defaultHours(),
    exceptions: [],
    services: [],
    rules: defaultRules(),
    encryptedTokens: null,
    oauthNonce: null,
    oauthNonceExpiresAt: null,
    oauthVia: null,
    adminNotice: null
  };
}

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
      ...clone(connection),
      connectedAt: asIso(connection.connectedAt)
    },
    timezone: typeof data.timezone === 'string' && data.timezone ? data.timezone : base.timezone,
    hours: data.hours && typeof data.hours === 'object' ? clone(data.hours) : base.hours,
    exceptions: Array.isArray(data.exceptions) ? clone(data.exceptions) : [],
    services: Array.isArray(data.services) ? clone(data.services) : [],
    rules: data.rules && typeof data.rules === 'object'
      ? { ...base.rules, ...clone(data.rules) }
      : base.rules,
    enabled: data.enabled === true,
    playgroundWriteEnabled: data.playgroundWriteEnabled === true,
    encryptedTokens: typeof data.encryptedTokens === 'string' ? data.encryptedTokens : null,
    oauthNonce: data.oauthNonce || null,
    oauthNonceExpiresAt: Number(data.oauthNonceExpiresAt) || null,
    oauthVia: data.oauthVia === 'invite' ? 'invite' : null,
    adminNotice: data.adminNotice && data.adminNotice.pending === true
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
    this.queues = new Map();
  }

  async getRaw(clientId) {
    if (!this.docs.has(clientId)) return defaultDocument();
    return clone(this.docs.get(clientId));
  }

  /** Lee-modifica-escribe serializado por cliente. mutator(doc) devuelve el documento nuevo. */
  async transaction(clientId, mutator) {
    const prev = this.queues.get(clientId) || Promise.resolve();
    const run = prev.catch(() => {}).then(() => {
      const current = this.docs.has(clientId) ? clone(this.docs.get(clientId)) : defaultDocument();
      const next = mutator(current);
      this.docs.set(clientId, clone(next));
      return clone(next);
    });
    this.queues.set(clientId, run);
    return run;
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
      tx.set(ref, { ...saved, updatedAt: this.FieldValue.serverTimestamp() });
    });
    return saved;
  }
}

module.exports = {
  MemorySettingsStore,
  FirestoreSettingsStore,
  defaultDocument,
  defaultConnection,
  normalizeDoc,
  clone
};
