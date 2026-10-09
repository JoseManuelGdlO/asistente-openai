const WebhookManager = require('../../src/controllers/webhookManager');
const ConfirmationManager = require('../../src/services/confirmationManager');
const UserContextManager = require('../../src/services/userContextManager');

function createManager(overrides = {}) {
  const firebaseService = {
    getAllClients: jest.fn().mockResolvedValue({}),
    tryClaimWebhookMessage: jest.fn().mockResolvedValue(true),
    markWebhookMessageCompleted: jest.fn().mockResolvedValue(undefined),
    releaseWebhookMessage: jest.fn().mockResolvedValue(undefined),
    isBotSessionLocked: jest.fn().mockResolvedValue(false),
    enqueuePendingChatMessage: jest.fn().mockResolvedValue({
      accepted: true,
      flushAt: new Date(Date.now() + 2500)
    }),
    claimPendingChatFlush: jest.fn().mockResolvedValue({ claimed: false, reason: 'empty' }),
    sessionId: (userId, clientCode) => `${userId}_${clientCode}`,
    ...overrides.firebaseService
  };

  const ultraMsgManager = {
    instances: new Map(),
    sendMessage: jest.fn().mockResolvedValue({ sent: true }),
    markChatRead: jest.fn().mockResolvedValue({ ok: true }),
    showTyping: jest.fn().mockResolvedValue({ ok: true }),
    getDefaultInstance: jest.fn(() => ({ instanceId: 'default' })),
    getInstanceIdByClientId: jest.fn(() => 'default'),
    ...overrides.ultraMsgManager
  };

  const metaWhatsappManager = {
    sendMessage: jest.fn().mockResolvedValue({ sent: true }),
    markRead: jest.fn().mockResolvedValue({ success: true }),
    showTyping: jest.fn().mockResolvedValue({ success: true }),
    ...overrides.metaWhatsappManager
  };

  const ownSystemManager = {
    sendMessage: jest.fn().mockResolvedValue({ sent: true }),
    markRead: jest.fn().mockResolvedValue({ ok: true }),
    setPresence: jest.fn().mockResolvedValue({ ok: true }),
    ...overrides.ownSystemManager
  };

  const openAIManager = {
    firebaseService,
    processMessage: jest.fn().mockResolvedValue('respuesta IA'),
    ...overrides.openAIManager
  };

  const wm = new WebhookManager(
    ultraMsgManager,
    openAIManager,
    new ConfirmationManager(),
    overrides.userContextManager || new UserContextManager(),
    { list: jest.fn().mockResolvedValue([]) },
    metaWhatsappManager,
    ownSystemManager
  );

  wm.commandManager = {
    getClientByAssistantPhone: jest.fn().mockResolvedValue('CLIENTE001'),
    isPhoneBlacklisted: jest.fn().mockResolvedValue(false),
    processMessage: jest.fn().mockResolvedValue({ isCommand: false }),
    isCommand: jest.fn(() => false),
    isBotActive: jest.fn(() => true),
    getAssistantConfig: jest.fn().mockResolvedValue({ prompt: 'ok' }),
    clientConfig: {},
    ...overrides.commandManager
  };

  return { wm, firebaseService, ultraMsgManager, openAIManager, metaWhatsappManager, ownSystemManager };
}

describe('WebhookManager', () => {
  const originalToken = process.env.ULTRAMSG_WEBHOOK_TOKEN;

  afterEach(() => {
    process.env.ULTRAMSG_WEBHOOK_TOKEN = originalToken;
  });

  it('verifyWebhookToken acepta el token de entorno', () => {
    process.env.ULTRAMSG_WEBHOOK_TOKEN = 'hook-secret';
    const { wm } = createManager();
    expect(wm.verifyWebhookToken('hook-secret')).toBe(true);
    expect(wm.verifyWebhookToken('nope')).toBe(false);
  });

  it('detecta grupos @g.us', () => {
    const { wm } = createManager();
    expect(wm.isGroupMessage({ from: '120363@g.us' })).toBe(true);
    expect(wm.isGroupMessage({ from: '521555@c.us' })).toBe(false);
  });

  it('withWebhookDedup ignora si no hay claim', async () => {
    const { wm, firebaseService } = createManager({
      firebaseService: {
        tryClaimWebhookMessage: jest.fn().mockResolvedValue(false),
        markWebhookMessageCompleted: jest.fn(),
        releaseWebhookMessage: jest.fn()
      }
    });
    const result = await wm.withWebhookDedup('ultra:1', async () => ({ processed: true }));
    expect(result).toEqual({ processed: false, reason: 'already_processed' });
    expect(firebaseService.markWebhookMessageCompleted).not.toHaveBeenCalled();
  });

  it('withWebhookDedup libera el claim si fn lanza', async () => {
    const { wm, firebaseService } = createManager();
    await expect(wm.withWebhookDedup('ultra:2', async () => {
      throw new Error('fail');
    })).rejects.toThrow('fail');
    expect(firebaseService.releaseWebhookMessage).toHaveBeenCalledWith('ultra:2');
  });

  it('ignora mensaje de grupo sin llamar a OpenAI', async () => {
    const { wm, openAIManager } = createManager();
    const result = await wm.processMessage({
      from: '120363@g.us',
      to: '521000@c.us',
      body: 'hola'
    });
    expect(result.reason).toBe('group_message_ignored');
    expect(openAIManager.processMessage).not.toHaveBeenCalled();
  });

  it('procesa confirmación corta sin OpenAI', async () => {
    const userContextManager = new UserContextManager();
    userContextManager.markAgendaSent('521555');
    const { wm, openAIManager, ultraMsgManager } = createManager({ userContextManager });
    const result = await wm.processMessage({
      from: '521555@c.us',
      to: '521000@c.us',
      body: 'ok'
    });
    expect(result.reason).toBe('confirmation_processed');
    expect(openAIManager.processMessage).not.toHaveBeenCalled();
    expect(ultraMsgManager.sendMessage).toHaveBeenCalled();
  });

  it('responde agradecimiento sin OpenAI aunque no haya agenda pendiente', async () => {
    const { wm, openAIManager, ultraMsgManager } = createManager();
    const result = await wm.processMessage({
      from: '521555@c.us',
      to: '521000@c.us',
      body: 'Muchas gracias'
    });
    expect(result.reason).toBe('confirmation_processed');
    expect(openAIManager.processMessage).not.toHaveBeenCalled();
    expect(ultraMsgManager.sendMessage).toHaveBeenCalledWith(
      '521555',
      expect.stringMatching(/Con gusto/),
      expect.anything(),
      expect.anything()
    );
  });

  it('deja "sí" sin agenda pendiente para que lo procese OpenAI', async () => {
    const { wm, openAIManager } = createManager();
    const result = await wm.processMessage({
      from: '521555@c.us',
      to: '521000@c.us',
      body: 'sí'
    });
    expect(result.reason).toBe('ai_reply');
    expect(openAIManager.processMessage).toHaveBeenCalled();
  });

  it('envía aviso si no hay consultorio', async () => {
    const { wm, ultraMsgManager } = createManager({
      commandManager: {
        getClientByAssistantPhone: jest.fn().mockResolvedValue(null),
        isPhoneBlacklisted: jest.fn().mockResolvedValue(false),
        processMessage: jest.fn().mockResolvedValue({ isCommand: false }),
        isCommand: jest.fn(() => false)
      }
    });
    const result = await wm.processMessage({
      from: '521555@c.us',
      to: '521000@c.us',
      body: 'hola'
    });
    expect(result.reason).toBe('client_not_found');
    expect(ultraMsgManager.sendMessage).toHaveBeenCalled();
    expect(result.response).toMatch(/consultorio/);
  });

  it('ignora el mensaje si el bot está apagado (cliente normal)', async () => {
    const { wm, ultraMsgManager } = createManager({
      commandManager: {
        getClientByAssistantPhone: jest.fn().mockResolvedValue('CLIENTE001'),
        isPhoneBlacklisted: jest.fn().mockResolvedValue(false),
        processMessage: jest.fn().mockResolvedValue({ isCommand: false }),
        isCommand: jest.fn(() => false),
        isBotActive: jest.fn(() => false),
        isAuthorizedNumber: jest.fn(() => false),
        getAssistantConfig: jest.fn()
      }
    });
    const result = await wm.processMessage({
      from: '521555@c.us',
      to: '521000@c.us',
      body: 'hola'
    });
    expect(result.reason).toBe('bot_inactive');
    expect(result.response).toBeNull();
    expect(ultraMsgManager.sendMessage).not.toHaveBeenCalled();
  });

  it('avisa al admin si el bot está apagado', async () => {
    const { wm, ultraMsgManager } = createManager({
      commandManager: {
        getClientByAssistantPhone: jest.fn().mockResolvedValue('CLIENTE001'),
        isPhoneBlacklisted: jest.fn().mockResolvedValue(false),
        processMessage: jest.fn().mockResolvedValue({ isCommand: false }),
        isCommand: jest.fn(() => false),
        isBotActive: jest.fn(() => false),
        isAuthorizedNumber: jest.fn(() => true),
        getAssistantConfig: jest.fn()
      }
    });
    const result = await wm.processMessage({
      from: '521555@c.us',
      to: '521000@c.us',
      body: 'hola'
    });
    expect(result.reason).toBe('bot_inactive');
    expect(result.response).toMatch(/apagado/);
    expect(ultraMsgManager.sendMessage).toHaveBeenCalled();
  });

  it('envía aviso si falta Assistant', async () => {
    const { wm, ultraMsgManager } = createManager({
      commandManager: {
        getClientByAssistantPhone: jest.fn().mockResolvedValue('CLIENTE001'),
        isPhoneBlacklisted: jest.fn().mockResolvedValue(false),
        processMessage: jest.fn().mockResolvedValue({ isCommand: false }),
        isCommand: jest.fn(() => false),
        isBotActive: jest.fn(() => true),
        getAssistantConfig: jest.fn().mockResolvedValue(null)
      }
    });
    const result = await wm.processMessage({
      from: '521555@c.us',
      to: '521000@c.us',
      body: 'hola'
    });
    expect(result.reason).toBe('assistant_missing');
    expect(ultraMsgManager.sendMessage).toHaveBeenCalled();
  });

  it('encola chat y no llama a OpenAI en el request (debounce > 0)', async () => {
    const prev = process.env.MESSAGE_DEBOUNCE_MS;
    process.env.MESSAGE_DEBOUNCE_MS = '2500';
    const { wm, openAIManager, firebaseService } = createManager();
    try {
      const result = await wm.processMessage({
        from: '521555@c.us',
        to: '521000@c.us',
        body: 'hola'
      });
      expect(result.reason).toBe('ai_queued');
      expect(openAIManager.processMessage).not.toHaveBeenCalled();
      expect(firebaseService.enqueuePendingChatMessage).toHaveBeenCalled();
    } finally {
      wm.debounceManager.stopSweep();
      wm.chatSignals.stopAll();
      process.env.MESSAGE_DEBOUNCE_MS = prev;
    }
  });

  it('en la respuesta de IA marca leído y typing por UltraMsg', async () => {
    const { wm, ultraMsgManager } = createManager();
    const result = await wm.processMessage({
      id: 'm1',
      from: '521555@c.us',
      to: '521000@c.us',
      body: 'hola'
    });
    expect(result.reason).toBe('ai_reply');
    expect(ultraMsgManager.markChatRead).toHaveBeenCalledWith('521555@c.us', 'default');
    expect(ultraMsgManager.showTyping).toHaveBeenCalledWith('521555@c.us', 'default');
  });

  it('marca leído al confirmar y no muestra typing', async () => {
    const userContextManager = new UserContextManager();
    userContextManager.markAgendaSent('521555');
    const { wm, ultraMsgManager } = createManager({ userContextManager });
    await wm.processMessage({
      id: 'm-ok',
      from: '521555@c.us',
      to: '521000@c.us',
      body: 'ok'
    });
    expect(ultraMsgManager.markChatRead).toHaveBeenCalledWith('521555@c.us', 'default');
    expect(ultraMsgManager.showTyping).not.toHaveBeenCalled();
  });

  it('no marca leído en un grupo ni en un contacto bloqueado', async () => {
    const { wm, ultraMsgManager } = createManager({
      commandManager: {
        getClientByAssistantPhone: jest.fn().mockResolvedValue('CLIENTE001'),
        isPhoneBlacklisted: jest.fn().mockResolvedValue(true),
        processMessage: jest.fn().mockResolvedValue({ isCommand: false }),
        isCommand: jest.fn(() => false),
        isBotActive: jest.fn(() => true),
        getAssistantConfig: jest.fn().mockResolvedValue({ prompt: 'ok' })
      }
    });
    await wm.processMessage({
      from: '120363@g.us',
      to: '521000@c.us',
      body: 'hola'
    });
    await wm.processMessage({
      from: '521555@c.us',
      to: '521000@c.us',
      body: 'hola'
    });
    expect(ultraMsgManager.markChatRead).not.toHaveBeenCalled();
    expect(ultraMsgManager.showTyping).not.toHaveBeenCalled();
  });

  it('en la respuesta de IA marca leído y typing por Meta', async () => {
    const { wm, metaWhatsappManager, openAIManager } = createManager();
    wm.commandManager.clientConfig = {
      CLIENTE001: { META_PHONE_NUMBER_ID: 'pn-1', META_ACCESS_TOKEN: 'tok-1' }
    };
    const result = await wm.processMessage({
      id: 'wamid.1',
      from: '521555',
      to: '521000',
      body: 'hola',
      phoneNumberId: 'pn-1'
    }, null, {
      origin: 'meta',
      clientId: 'CLIENTE001',
      client: wm.commandManager.clientConfig.CLIENTE001
    });
    expect(result.reason).toBe('ai_reply');
    expect(metaWhatsappManager.markRead).toHaveBeenCalledWith(
      'wamid.1',
      expect.objectContaining({ META_PHONE_NUMBER_ID: 'pn-1' })
    );
    expect(metaWhatsappManager.showTyping).toHaveBeenCalledWith(
      'wamid.1',
      expect.objectContaining({ META_PHONE_NUMBER_ID: 'pn-1' })
    );
    expect(openAIManager.processMessage).toHaveBeenCalled();
  });

  it('en la respuesta de IA marca leído y typing por el sistema propio', async () => {
    const { wm, ownSystemManager } = createManager();
    wm.commandManager.clientConfig = {
      CLIENTE001: { OWN_SYSTEM: true, OWN_API_KEY: 'key-1' }
    };
    const result = await wm.handleOwnWebhook({
      type: 'message.inbound',
      tenantId: 'ten-1',
      deviceId: 'dev-1',
      normalized: {
        messageId: 'm1',
        from: '521555@s.whatsapp.net',
        to: '521000:21@s.whatsapp.net',
        content: { type: 'text', text: 'hola' }
      }
    });
    expect(result.reason).toBe('ai_reply');
    expect(ownSystemManager.markRead).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      tenantId: 'ten-1',
      apiKey: 'key-1',
      to: '521555@s.whatsapp.net'
    });
    expect(ownSystemManager.setPresence).toHaveBeenCalledWith(expect.objectContaining({
      presence: 'composing',
      to: '521555@s.whatsapp.net'
    }));
  });

  it('ignora chat si la sesión está locked', async () => {
    const { wm, openAIManager } = createManager({
      firebaseService: {
        isBotSessionLocked: jest.fn().mockResolvedValue(true)
      }
    });
    const result = await wm.processMessage({
      from: '521555@c.us',
      to: '521000@c.us',
      body: 'hola'
    });
    expect(result.reason).toBe('ignored_locked');
    expect(openAIManager.processMessage).not.toHaveBeenCalled();
  });
});
