const SYNC_PENDING = ['pending', 'retry'];

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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

function normalizeAppointment(id, data) {
  if (!data || typeof data !== 'object') return null;
  return {
    ...clone(data),
    id,
    start: asIso(data.start),
    end: asIso(data.end),
    nextRetryAt: asIso(data.nextRetryAt),
    createdAt: asIso(data.createdAt),
    updatedAt: asIso(data.updatedAt)
  };
}

function inRange(row, fromMs, toMs) {
  const start = Date.parse(row.start);
  const end = Date.parse(row.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return start < toMs && end > fromMs;
}

function isSyncDue(row, nowMs) {
  if (!SYNC_PENDING.includes(row.sync)) return false;
  if (row.sync === 'retry' && row.nextRetryAt) {
    const due = Date.parse(row.nextRetryAt);
    if (Number.isFinite(due) && due > nowMs) return false;
  }
  return true;
}

/**
 * Almacén en memoria. Mismo contrato que FirestoreAppointmentsStore:
 *  runTransaction(clientId, fn) — fn recibe tx { get(id), set(id,row), listConfirmed(), listCancelledWithEventId() }.
 *  Las transacciones se serializan por cliente; las escrituras se aplican al terminar fn.
 */
class MemoryAppointmentsStore {
  constructor() {
    this.items = new Map(); // clientId → Map(id → row)
    this.queues = new Map();
  }

  _bucket(clientId) {
    if (!this.items.has(clientId)) this.items.set(clientId, new Map());
    return this.items.get(clientId);
  }

  async get(clientId, id) {
    const row = this.items.get(clientId)?.get(id);
    return row ? clone(row) : null;
  }

  async listConfirmedInRange(clientId, fromMs, toMs) {
    const rows = [...(this.items.get(clientId)?.values() || [])];
    return rows
      .filter((row) => row.status === 'confirmed' && inRange(row, fromMs, toMs))
      .map(clone);
  }

  async listSyncDue(clientId, nowMs = Date.now()) {
    const rows = [...(this.items.get(clientId)?.values() || [])];
    return rows.filter((row) => isSyncDue(row, nowMs)).map(clone);
  }

  async listAllClientIds() {
    return [...this.items.entries()].filter(([, map]) => map.size > 0).map(([id]) => id);
  }

  /** Escritura directa (sync worker). Fusiona campos sobre la fila existente. */
  async update(clientId, id, patch) {
    return this.runTransaction(clientId, async (tx) => {
      const current = await tx.get(id);
      if (!current) return null;
      const next = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
      tx.set(id, next);
      return next;
    });
  }

  async runTransaction(clientId, fn) {
    const prev = this.queues.get(clientId) || Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      const bucket = this._bucket(clientId);
      const writes = new Map();
      const tx = {
        get: async (id) => {
          const row = writes.get(id) || bucket.get(id);
          return row ? clone(row) : null;
        },
        set: (id, row) => {
          writes.set(id, clone({ ...row, id }));
        },
        listConfirmed: async () => {
          const merged = new Map(bucket);
          for (const [id, row] of writes) merged.set(id, row);
          return [...merged.values()].filter((row) => row.status === 'confirmed').map(clone);
        },
        listCancelledWithEventId: async () => {
          const merged = new Map(bucket);
          for (const [id, row] of writes) merged.set(id, row);
          return [...merged.values()]
            .filter((row) => row.status === 'cancelled' && row.eventId)
            .map(clone);
        }
      };
      const result = await fn(tx);
      for (const [id, row] of writes) bucket.set(id, row);
      return result;
    });
    this.queues.set(clientId, run);
    return run;
  }
}

class FirestoreAppointmentsStore {
  constructor(firebaseService) {
    if (!firebaseService?.agendaAppointmentsCollection || !firebaseService.db) {
      throw new Error('FirestoreAppointmentsStore requiere FirebaseService con agenda_appointments');
    }
    this.root = firebaseService.agendaAppointmentsCollection;
    this.db = firebaseService.db;
    this.FieldValue = require('firebase-admin').firestore.FieldValue;
  }

  _items(clientId) {
    return this.root.doc(clientId).collection('items');
  }

  async get(clientId, id) {
    const snap = await this._items(clientId).doc(id).get();
    return snap.exists ? normalizeAppointment(snap.id, snap.data()) : null;
  }

  async listConfirmedInRange(clientId, fromMs, toMs) {
    const snap = await this._items(clientId).where('status', '==', 'confirmed').get();
    return snap.docs
      .map((doc) => normalizeAppointment(doc.id, doc.data()))
      .filter((row) => row && inRange(row, fromMs, toMs));
  }

  async listSyncDue(clientId, nowMs = Date.now()) {
    const snap = await this._items(clientId).where('sync', 'in', SYNC_PENDING).get();
    return snap.docs
      .map((doc) => normalizeAppointment(doc.id, doc.data()))
      .filter((row) => row && isSyncDue(row, nowMs));
  }

  /** Incluye clientes cuyo doc padre no existe (solo tienen subcolección items). */
  async listAllClientIds() {
    const refs = await this.root.listDocuments();
    return refs.map((ref) => ref.id);
  }

  async update(clientId, id, patch) {
    return this.runTransaction(clientId, async (tx) => {
      const current = await tx.get(id);
      if (!current) return null;
      const next = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
      tx.set(id, next);
      return next;
    });
  }

  /**
   * Transacción Firestore: todas las lecturas ocurren antes de aplicar escrituras.
   * fn puede reejecutarse si hay contención, por lo que debe ser idempotente.
   */
  async runTransaction(clientId, fn) {
    const items = this._items(clientId);
    return this.db.runTransaction(async (t) => {
      const writes = [];
      const tx = {
        get: async (id) => {
          const snap = await t.get(items.doc(id));
          return snap.exists ? normalizeAppointment(snap.id, snap.data()) : null;
        },
        set: (id, row) => {
          writes.push([id, row]);
        },
        listConfirmed: async () => {
          const snap = await t.get(items.where('status', '==', 'confirmed'));
          return snap.docs.map((doc) => normalizeAppointment(doc.id, doc.data())).filter(Boolean);
        },
        listCancelledWithEventId: async () => {
          const snap = await t.get(items.where('status', '==', 'cancelled'));
          return snap.docs
            .map((doc) => normalizeAppointment(doc.id, doc.data()))
            .filter((row) => row && row.eventId);
        }
      };
      const result = await fn(tx);
      for (const [id, row] of writes) {
        t.set(items.doc(id), { ...clone(row), id, updatedAtServer: this.FieldValue.serverTimestamp() });
      }
      return result;
    });
  }
}

module.exports = {
  MemoryAppointmentsStore,
  FirestoreAppointmentsStore,
  normalizeAppointment,
  isSyncDue
};
