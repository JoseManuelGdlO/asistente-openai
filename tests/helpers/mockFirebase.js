/**
 * Firestore in-memory para tests de FirebaseService (bot_sessions + webhook_dedup).
 */

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function createInMemoryFirestore() {
  const collections = new Map();

  function getCol(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name);
  }

  function snapshotFor(id, data) {
    const exists = data !== undefined && data !== null;
    return {
      id,
      exists,
      data: () => (exists ? clone(data) : undefined),
      ref: null
    };
  }

  class DocRef {
    constructor(db, collectionName, id) {
      this.db = db;
      this.collectionName = collectionName;
      this.id = id;
    }

    async get() {
      const col = getCol(this.collectionName);
      const snap = snapshotFor(this.id, col.get(this.id));
      snap.ref = this;
      return snap;
    }

    async set(data, options = {}) {
      const col = getCol(this.collectionName);
      if (options.merge && col.has(this.id)) {
        col.set(this.id, { ...col.get(this.id), ...clone(data) });
      } else {
        col.set(this.id, clone(data));
      }
    }

    async update(data) {
      const col = getCol(this.collectionName);
      if (!col.has(this.id)) {
        throw new Error('NOT_FOUND');
      }
      col.set(this.id, { ...col.get(this.id), ...clone(data) });
    }

    async delete() {
      getCol(this.collectionName).delete(this.id);
    }
  }

  class Query {
    constructor(db, collectionName, filters = []) {
      this.db = db;
      this.collectionName = collectionName;
      this.filters = filters;
    }

    where(field, op, value) {
      return new Query(this.db, this.collectionName, [...this.filters, { field, op, value }]);
    }

    limit(n) {
      this._limit = n;
      return this;
    }

    async get() {
      const col = getCol(this.collectionName);
      let docs = [];
      for (const [id, data] of col.entries()) {
        const matches = this.filters.every(({ field, op, value }) => {
          if (op === '==') return data[field] === value;
          return false;
        });
        if (matches) {
          const snap = snapshotFor(id, data);
          snap.ref = new DocRef(this.db, this.collectionName, id);
          docs.push(snap);
        }
      }
      if (this._limit) {
        docs = docs.slice(0, this._limit);
      }
      return {
        empty: docs.length === 0,
        docs,
        size: docs.length
      };
    }
  }

  class CollectionRef extends Query {
    constructor(db, collectionName) {
      super(db, collectionName, []);
    }

    doc(id) {
      return new DocRef(this.db, this.collectionName, id);
    }
  }

  class WriteBatch {
    constructor(db) {
      this.db = db;
      this.ops = [];
    }

    delete(ref) {
      this.ops.push({ type: 'delete', ref });
      return this;
    }

    set(ref, data, options) {
      this.ops.push({ type: 'set', ref, data, options });
      return this;
    }

    async commit() {
      for (const op of this.ops) {
        if (op.type === 'delete') {
          await op.ref.delete();
        } else if (op.type === 'set') {
          await op.ref.set(op.data, op.options || {});
        }
      }
    }
  }

  class Transaction {
    constructor(db) {
      this.db = db;
      this.ops = [];
    }

    async get(ref) {
      return ref.get();
    }

    set(ref, data, options) {
      this.ops.push({ type: 'set', ref, data, options });
    }

    update(ref, data) {
      this.ops.push({ type: 'update', ref, data });
    }

    delete(ref) {
      this.ops.push({ type: 'delete', ref });
    }

    async commit() {
      for (const op of this.ops) {
        if (op.type === 'set') await op.ref.set(op.data, op.options || {});
        if (op.type === 'update') await op.ref.update(op.data);
        if (op.type === 'delete') await op.ref.delete();
      }
    }
  }

  const db = {
    collection(name) {
      return new CollectionRef(db, name);
    },
    batch() {
      return new WriteBatch(db);
    },
    async runTransaction(fn) {
      const tx = new Transaction(db);
      await fn(tx);
      await tx.commit();
    },
    _collections: collections,
    _reset() {
      collections.clear();
    }
  };

  return db;
}

function createFirebaseAdminMock(firestore) {
  const db = firestore || createInMemoryFirestore();
  const admin = {
    apps: [{}],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn(() => ({})) },
    firestore: Object.assign(() => db, {
      FieldValue: {
        serverTimestamp: () => new Date()
      }
    })
  };
  return admin;
}

module.exports = {
  createInMemoryFirestore,
  createFirebaseAdminMock
};
