function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readDebounceConfig() {
  const debounceMs = parseNonNegativeInt(process.env.MESSAGE_DEBOUNCE_MS, 4000);
  const maxRaw = parseNonNegativeInt(process.env.MESSAGE_DEBOUNCE_MAX_MS, 8000);
  return {
    debounceMs,
    maxMs: Math.max(debounceMs, maxRaw)
  };
}

class MessageDebounceManager {
  constructor({
    firebaseService,
    openAIManager,
    ultraMsgManager,
    ownSystemManager,
    getClientConfig,
    documentStore,
    sweepIntervalMs = 2000
  } = {}) {
    this.firebaseService = firebaseService;
    this.openAIManager = openAIManager;
    this.ultraMsgManager = ultraMsgManager;
    this.ownSystemManager = ownSystemManager;
    this.getClientConfig = typeof getClientConfig === 'function' ? getClientConfig : () => ({});
    this.documentStore = documentStore || null;
    this.sweepIntervalMs = sweepIntervalMs;
    this.timers = new Map();
    this.sweepTimer = null;
    this.flushing = new Set();
  }

  getConfig() {
    return readDebounceConfig();
  }

  /**
   * Encola chat para flush, o procesa al momento si debounce=0.
   * @returns {Promise<{ accepted: boolean, reason: string, flushAt?: Date, reply?: string|Object }>}
   */
  async queueChatMessage({
    userId,
    clientCode,
    text,
    flushContext = {},
    processContext = {}
  }) {
    const { debounceMs, maxMs } = this.getConfig();

    if (debounceMs <= 0) {
      const locked = await this.firebaseService.isBotSessionLocked(userId, clientCode);
      if (locked) {
        return { accepted: false, reason: 'locked' };
      }
      const reply = await this.openAIManager.processMessage(
        userId,
        text,
        clientCode,
        processContext
      );
      return { accepted: true, reason: 'processed', reply };
    }

    const result = await this.firebaseService.enqueuePendingChatMessage(
      userId,
      clientCode,
      text,
      flushContext,
      { debounceMs, maxMs }
    );

    if (!result.accepted) {
      return { accepted: false, reason: result.reason || 'locked' };
    }

    this.scheduleFlush(userId, clientCode, result.flushAt);
    return { accepted: true, reason: 'queued', flushAt: result.flushAt };
  }

  scheduleFlush(userId, clientCode, flushAt) {
    const id = this.firebaseService.sessionId(userId, clientCode);
    const delay = Math.max(0, new Date(flushAt).getTime() - Date.now());
    this.clearTimer(id);
    const timer = setTimeout(() => {
      this.timers.delete(id);
      this.flushSession(userId, clientCode).catch((error) => {
        console.error('Error en flush de debounce:', error.message);
      });
    }, delay);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.timers.set(id, timer);
  }

  clearTimer(sessionId) {
    const timer = this.timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
  }

  startSweep() {
    if (this.sweepTimer) {
      return;
    }
    this.sweepOverdueFlushes().catch((error) => {
      console.error('Error en sweep inicial de debounce:', error.message);
    });
    this.sweepTimer = setInterval(() => {
      this.sweepOverdueFlushes().catch((error) => {
        console.error('Error en sweep de debounce:', error.message);
      });
    }, this.sweepIntervalMs);
    if (typeof this.sweepTimer.unref === 'function') {
      this.sweepTimer.unref();
    }
  }

  stopSweep() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const sessionId of [...this.timers.keys()]) {
      this.clearTimer(sessionId);
    }
  }

  async sweepOverdueFlushes() {
    if (typeof this.firebaseService.listSessionsDueForFlush !== 'function') {
      return;
    }
    const due = await this.firebaseService.listSessionsDueForFlush(new Date());
    for (const session of due) {
      if (!session?.userId || !session?.clientCode) {
        continue;
      }
      await this.flushSession(session.userId, session.clientCode);
    }
  }

  async flushSession(userId, clientCode) {
    const id = this.firebaseService.sessionId(userId, clientCode);
    if (this.flushing.has(id)) {
      return;
    }
    this.flushing.add(id);
    try {
      const claim = await this.firebaseService.claimPendingChatFlush(userId, clientCode);
      if (!claim.claimed) {
        if (claim.reason === 'too_early' && claim.flushAt) {
          this.scheduleFlush(userId, clientCode, claim.flushAt);
        }
        return;
      }

      const text = (claim.messages || []).join('\n');
      const flushContext = claim.flushContext || {};
      try {
        await this.openAIManager.processMessage(userId, text, clientCode, {
          alreadyLocked: true,
          instanceId: flushContext.instanceId || null,
          ultraMsgManager: this.buildFlushTransport(flushContext),
          documentStore: this.documentStore,
          returnTrace: flushContext.origin === 'playground',
          sendReply: this.buildSendReply(flushContext)
        });
      } catch (error) {
        console.error('Error procesando lote debounce:', error.message);
        try {
          await this.firebaseService.unlockBotSession(userId, clientCode);
        } catch (unlockError) {
          console.error('Error liberando lock tras fallo de flush:', unlockError.message);
        }
      }
    } finally {
      this.flushing.delete(id);
    }
  }

  buildFlushTransport(flushContext = {}) {
    if (flushContext.origin === 'playground') {
      return {
        sendDocument: async () => ({ mocked: true })
      };
    }
    return this.ultraMsgManager;
  }

  buildSendReply(flushContext = {}) {
    if (flushContext.origin === 'playground') {
      return async () => {};
    }

    if (flushContext.origin === 'own') {
      return async (text) => {
        const client = this.getClientConfig()?.[flushContext.clientId] || {};
        const apiKey = client.OWN_API_KEY;
        if (!this.ownSystemManager) {
          throw new Error('OwnSystemManager no disponible');
        }
        await this.ownSystemManager.sendMessage({
          deviceId: flushContext.deviceId,
          tenantId: flushContext.tenantId,
          apiKey,
          to: flushContext.fromJid,
          text
        });
      };
    }

    return async (text) => {
      await this.ultraMsgManager.sendMessage(
        flushContext.from,
        text,
        flushContext.instanceId,
        { requestOrigin: 'UltraMsg' }
      );
    };
  }
}

module.exports = MessageDebounceManager;
module.exports.readDebounceConfig = readDebounceConfig;
