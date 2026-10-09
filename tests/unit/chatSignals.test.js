const ChatSignals = require('../../src/services/chatSignals');

function createSignals() {
  const ultraMsgManager = {
    markChatRead: jest.fn().mockResolvedValue({ ok: true }),
    showTyping: jest.fn().mockResolvedValue({ supported: false })
  };
  const metaWhatsappManager = {
    markRead: jest.fn().mockResolvedValue({ success: true }),
    showTyping: jest.fn().mockResolvedValue({ success: true })
  };
  const ownSystemManager = {
    markRead: jest.fn().mockResolvedValue({ ok: true }),
    setPresence: jest.fn().mockResolvedValue({ ok: true })
  };
  const signals = new ChatSignals({
    ultraMsgManager,
    metaWhatsappManager,
    ownSystemManager,
    getClientConfig: () => ({
      C1: {
        META_PHONE_NUMBER_ID: 'pn-1',
        META_ACCESS_TOKEN: 'tok-1',
        OWN_API_KEY: 'key-1'
      }
    })
  });
  return { signals, ultraMsgManager, metaWhatsappManager, ownSystemManager };
}

describe('ChatSignals', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('marca leído en Meta, UltraMsg y el sistema propio', async () => {
    const { signals, ultraMsgManager, metaWhatsappManager, ownSystemManager } = createSignals();

    await signals.markRead({
      origin: 'meta',
      messageId: 'wamid.1',
      clientId: 'C1'
    });
    await signals.markRead({
      origin: 'ultramsg',
      chatId: '521555@c.us',
      instanceId: 'inst-1'
    });
    await signals.markRead({
      origin: 'own',
      clientId: 'C1',
      deviceId: 'dev-1',
      tenantId: 'ten-1',
      fromJid: '521555@s.whatsapp.net'
    });

    expect(metaWhatsappManager.markRead).toHaveBeenCalledWith(
      'wamid.1',
      expect.objectContaining({ META_PHONE_NUMBER_ID: 'pn-1' })
    );
    expect(ultraMsgManager.markChatRead).toHaveBeenCalledWith('521555@c.us', 'inst-1');
    expect(ownSystemManager.markRead).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      tenantId: 'ten-1',
      apiKey: 'key-1',
      to: '521555@s.whatsapp.net'
    });
  });

  it('pide typing en los tres canales', async () => {
    const { signals, ultraMsgManager, metaWhatsappManager, ownSystemManager } = createSignals();

    await signals.showTyping({ origin: 'meta', messageId: 'wamid.1', clientId: 'C1' });
    await signals.showTyping({ origin: 'ultramsg', chatId: '521555@c.us', instanceId: 'inst-1' });
    await signals.showTyping({
      origin: 'own',
      clientId: 'C1',
      deviceId: 'dev-1',
      tenantId: 'ten-1',
      fromJid: '521555@s.whatsapp.net'
    });

    expect(metaWhatsappManager.showTyping).toHaveBeenCalledWith(
      'wamid.1',
      expect.objectContaining({ META_ACCESS_TOKEN: 'tok-1' })
    );
    expect(ultraMsgManager.showTyping).toHaveBeenCalledWith('521555@c.us', 'inst-1');
    expect(ownSystemManager.setPresence).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      tenantId: 'ten-1',
      apiKey: 'key-1',
      to: '521555@s.whatsapp.net',
      presence: 'composing'
    });
  });

  it('no propaga un fallo de presencia', async () => {
    const { signals, metaWhatsappManager } = createSignals();
    metaWhatsappManager.markRead.mockRejectedValue(new Error('meta down'));
    await expect(signals.markRead({
      origin: 'meta',
      messageId: 'wamid.1',
      clientId: 'C1'
    })).resolves.toBeUndefined();
  });

  it('refresca el typing y permite apagarlo', async () => {
    jest.useFakeTimers();
    const { signals, metaWhatsappManager } = createSignals();
    const ctx = { origin: 'meta', messageId: 'wamid.1', clientId: 'C1' };

    signals.trackTyping(ctx);
    expect(metaWhatsappManager.showTyping).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(20000);
    expect(metaWhatsappManager.showTyping).toHaveBeenCalledTimes(2);

    expect(signals.stopTyping(ctx)).toBe(true);
    await jest.advanceTimersByTimeAsync(20000);
    expect(metaWhatsappManager.showTyping).toHaveBeenCalledTimes(2);
  });

  it('al apagar el typing del sistema propio manda presencia paused', async () => {
    const { signals, ownSystemManager } = createSignals();
    const ctx = {
      origin: 'own',
      clientId: 'C1',
      deviceId: 'dev-1',
      tenantId: 'ten-1',
      fromJid: '521555@s.whatsapp.net'
    };

    signals.trackTyping(ctx);
    expect(signals.stopTyping(ctx)).toBe(true);
    await signals.clearTyping(ctx);

    expect(ownSystemManager.setPresence).toHaveBeenLastCalledWith(
      expect.objectContaining({ presence: 'paused' })
    );
  });

  it('ignora playground', async () => {
    const { signals, ultraMsgManager, metaWhatsappManager, ownSystemManager } = createSignals();
    await signals.markRead({ origin: 'playground' });
    await signals.showTyping({ origin: 'playground' });
    expect(ultraMsgManager.markChatRead).not.toHaveBeenCalled();
    expect(metaWhatsappManager.showTyping).not.toHaveBeenCalled();
    expect(ownSystemManager.setPresence).not.toHaveBeenCalled();
  });
});
