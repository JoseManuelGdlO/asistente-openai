const TYPING_REFRESH_MS = 20000;

class ChatSignals {
  constructor({
    ultraMsgManager = null,
    metaWhatsappManager = null,
    ownSystemManager = null,
    getClientConfig = () => ({})
  } = {}) {
    this.ultraMsgManager = ultraMsgManager;
    this.metaWhatsappManager = metaWhatsappManager;
    this.ownSystemManager = ownSystemManager;
    this.getClientConfig = typeof getClientConfig === 'function' ? getClientConfig : () => ({});
    this.typingTimers = new Map();
  }

  clientFor(ctx) {
    if (ctx?.client) return ctx.client;
    const clientId = ctx?.clientId;
    if (!clientId) return null;
    return this.getClientConfig()?.[clientId] || null;
  }

  presenceKey(ctx) {
    return [
      ctx.origin,
      ctx.clientId || '',
      ctx.chatId || ctx.fromJid || ctx.from || ctx.messageId || ''
    ].join('|');
  }

  canSignal(ctx) {
    if (!ctx || ctx.origin === 'playground') return false;
    if (ctx.origin === 'meta') return Boolean(ctx.messageId);
    if (ctx.origin === 'own') return Boolean(ctx.deviceId && (ctx.fromJid || ctx.to));
    if (ctx.origin === 'ultramsg') return Boolean(ctx.chatId || ctx.from);
    return false;
  }

  async markRead(ctx) {
    try {
      await this.dispatchRead(ctx);
    } catch (error) {
      console.error('No se pudo marcar como leído:', error.message);
    }
  }

  async showTyping(ctx) {
    try {
      await this.dispatchTyping(ctx);
    } catch (error) {
      console.error('No se pudo mostrar typing:', error.message);
    }
  }

  async dispatchRead(ctx) {
    if (!this.canSignal(ctx)) return;

    if (ctx.origin === 'meta') {
      await this.metaWhatsappManager.markRead(ctx.messageId, this.clientFor(ctx));
      return;
    }

    if (ctx.origin === 'ultramsg') {
      await this.ultraMsgManager.markChatRead(ctx.chatId || ctx.from, ctx.instanceId || null);
      return;
    }

    if (ctx.origin === 'own') {
      const client = this.clientFor(ctx) || {};
      await this.ownSystemManager.markRead({
        deviceId: ctx.deviceId,
        tenantId: ctx.tenantId,
        apiKey: client.OWN_API_KEY,
        to: ctx.fromJid || ctx.to
      });
    }
  }

  async dispatchTyping(ctx) {
    if (!this.canSignal(ctx)) return;

    if (ctx.origin === 'meta') {
      await this.metaWhatsappManager.showTyping(ctx.messageId, this.clientFor(ctx));
      return;
    }

    if (ctx.origin === 'ultramsg') {
      await this.ultraMsgManager.showTyping(ctx.chatId || ctx.from, ctx.instanceId || null);
      return;
    }

    if (ctx.origin === 'own') {
      const client = this.clientFor(ctx) || {};
      await this.ownSystemManager.setPresence({
        deviceId: ctx.deviceId,
        tenantId: ctx.tenantId,
        apiKey: client.OWN_API_KEY,
        to: ctx.fromJid || ctx.to,
        presence: 'composing'
      });
    }
  }

  trackTyping(ctx) {
    if (!this.canSignal(ctx)) return () => false;
    this.stopTyping(ctx);
    const key = this.presenceKey(ctx);
    const tick = () => {
      this.showTyping(ctx);
    };
    tick();
    const timer = setInterval(tick, TYPING_REFRESH_MS);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.typingTimers.set(key, timer);
    return () => this.stopTyping(ctx);
  }

  stopTyping(ctx) {
    if (!ctx) return false;
    const timer = this.typingTimers.get(this.presenceKey(ctx));
    if (!timer) return false;
    clearInterval(timer);
    this.typingTimers.delete(this.presenceKey(ctx));
    return true;
  }

  stopAll() {
    for (const timer of this.typingTimers.values()) {
      clearInterval(timer);
    }
    this.typingTimers.clear();
  }

  async clearTyping(ctx) {
    if (!ctx || ctx.origin !== 'own') return;
    try {
      const client = this.clientFor(ctx) || {};
      await this.ownSystemManager.setPresence({
        deviceId: ctx.deviceId,
        tenantId: ctx.tenantId,
        apiKey: client.OWN_API_KEY,
        to: ctx.fromJid || ctx.to,
        presence: 'paused'
      });
    } catch (error) {
      console.error('No se pudo apagar typing:', error.message);
    }
  }
}

module.exports = ChatSignals;
module.exports.TYPING_REFRESH_MS = TYPING_REFRESH_MS;
