const { clone } = require('./constants');

function normalizeAppointment(id, data) {
  const source = data && typeof data === 'object' ? data : {};
  return {
    id,
    serviceId: source.serviceId || '',
    start: source.start || '',
    end: source.end || '',
    customerName: source.customerName || '',
    customerPhone: source.customerPhone || '',
    notes: source.notes || '',
    status: source.status === 'cancelled' ? 'cancelled' : 'confirmed',
    sync: ['pending', 'synced', 'retry'].includes(source.sync) ? source.sync : 'pending',
    eventId: source.eventId || '',
    syncAttempts: Number(source.syncAttempts) || 0,
    nextRetryAt: Number(source.nextRetryAt) || 0,
    lastSyncError: source.lastSyncError || '',
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null
  };
}

class MemoryAppointmentsStore {
  constructor() {
    this.byClient = new Map();
  }

  _bag(clientId) {
    if (!this.byClient.has(clientId)) this.byClient.set(clientId, new Map());
    return this.byClient.get(clientId);
  }

  async get(clientId, appointmentId) {
    const item = this._bag(clientId).get(appointmentId);
    return item ? clone(item) : null;
  }

  async listConfirmedInRange(clientId, timeMinIso, timeMaxIso) {
    const min = Date.parse(timeMinIso);
    const max = Date.parse(timeMaxIso);
    const items = [];
    for (const item of this._bag(clientId).values()) {
      if (item.status !== 'confirmed') continue;
      const start = Date.parse(item.start);
      const end = Date.parse(item.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (end < min || start > max) continue;
      items.push(clone(item));
    }
    return items;
  }

  async listSyncDue(clientId, nowMs, limit = 20) {
    const due = [];
    for (const item of this._bag(clientId).values()) {
      if (item.status === 'cancelled' && item.sync === 'synced' && !item.eventId) continue;
      const needs = item.sync === 'pending'
        || item.sync === 'retry'
        || (item.status === 'cancelled' && item.eventId && item.sync !== 'synced');
      if (!needs) continue;
      if (item.sync === 'retry' && Number(item.nextRetryAt) > nowMs) continue;
      due.push(clone(item));
    }
    due.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    return due.slice(0, limit);
  }

  async listAllClientIds() {
    return [...this.byClient.keys()];
  }

  async runTransaction(clientId, fn) {
    const bag = this._bag(clientId);
    const api = {
      get: async (id) => (bag.has(id) ? clone(bag.get(id)) : null),
      set: async (id, value) => {
        bag.set(id, clone({ ...value, id }));
      },
      listConfirmed: async () => [...bag.values()].filter((item) => item.status === 'confirmed').map(clone)
    };
    return fn(api);
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

  items(clientId) {
    return this.root.doc(clientId).collection('items');
  }

  async get(clientId, appointmentId) {
    const snap = await this.items(clientId).doc(appointmentId).get();
    if (!snap.exists) return null;
    return normalizeAppointment(snap.id, snap.data());
  }

  async listConfirmedInRange(clientId, timeMinIso, timeMaxIso) {
    // Solo filtra por status en Firestore (evita índice compuesto status+start).
    // El rango se aplica en memoria; el volumen por bot es pequeño.
    const snap = await this.items(clientId)
      .where('status', '==', 'confirmed')
      .get();
    const min = Date.parse(timeMinIso);
    const max = Date.parse(timeMaxIso);
    return snap.docs
      .map((doc) => normalizeAppointment(doc.id, doc.data()))
      .filter((item) => {
        const start = Date.parse(item.start);
        const end = Date.parse(item.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        return end >= min && start <= max;
      });
  }

  async listSyncDue(clientId, nowMs, limit = 20) {
    const snap = await this.items(clientId).get();
    const due = snap.docs
      .map((doc) => normalizeAppointment(doc.id, doc.data()))
      .filter((item) => {
        if (item.sync === 'pending') return true;
        if (item.sync === 'retry' && Number(item.nextRetryAt) <= nowMs) return true;
        if (item.status === 'cancelled' && item.eventId && item.sync !== 'synced') return true;
        return false;
      })
      .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
      .slice(0, limit);
    return due;
  }

  async listAllClientIds() {
    const snap = await this.root.get();
    return snap.docs.map((doc) => doc.id);
  }

  async runTransaction(clientId, fn) {
    const col = this.items(clientId);
    return this.db.runTransaction(async (tx) => {
      const api = {
        get: async (id) => {
          const snap = await tx.get(col.doc(id));
          return snap.exists ? normalizeAppointment(snap.id, snap.data()) : null;
        },
        set: async (id, value) => {
          tx.set(col.doc(id), {
            ...value,
            updatedAt: this.FieldValue.serverTimestamp()
          }, { merge: true });
        },
        listConfirmed: async () => {
          const snap = await tx.get(col.where('status', '==', 'confirmed'));
          return snap.docs.map((doc) => normalizeAppointment(doc.id, doc.data()));
        }
      };
      return fn(api);
    });
  }
}

module.exports = {
  normalizeAppointment,
  MemoryAppointmentsStore,
  FirestoreAppointmentsStore
};
