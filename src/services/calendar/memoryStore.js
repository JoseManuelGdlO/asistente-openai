const { defaultDocument, clone } = require('./constants');

class MemoryCalendarStore {
  constructor() {
    this.docs = new Map();
  }

  async getRaw(clientId) {
    if (!this.docs.has(clientId)) return defaultDocument();
    return clone(this.docs.get(clientId));
  }

  async transaction(clientId, mutator) {
    const current = this.docs.has(clientId) ? clone(this.docs.get(clientId)) : defaultDocument();
    const next = mutator(current);
    this.docs.set(clientId, clone(next));
    return clone(next);
  }
}

module.exports = { MemoryCalendarStore };
