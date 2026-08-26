const MessageDebounceManager = require('../../src/services/messageDebounceManager');

function createManager(overrides = {}) {
  const firebaseService = {
    sessionId: (userId, clientCode) => `${userId}_${clientCode}`,
    isBotSessionLocked: jest.fn().mockResolvedValue(false),
    enqueuePendingChatMessage: jest.fn().mockResolvedValue({
      accepted: true,
      flushAt: new Date(Date.now() + 2500)
    }),
    claimPendingChatFlush: jest.fn().mockResolvedValue({
      claimed: true,
      messages: ['a', 'b', 'c'],
      flushContext: {
        origin: 'ultramsg',
        from: '521',
        clientId: 'C1',
        instanceId: 'inst-1'
      }
    }),
    listSessionsDueForFlush: jest.fn().mockResolvedValue([]),
    unlockBotSession: jest.fn().mockResolvedValue(undefined),
    ...overrides.firebaseService
  };

  const openAIManager = {
    processMessage: jest.fn().mockResolvedValue('ok'),
    ...overrides.openAIManager
  };

  const ultraMsgManager = {
    sendMessage: jest.fn().mockResolvedValue({ sent: true }),
    ...overrides.ultraMsgManager
  };

  const ownSystemManager = {
    sendMessage: jest.fn().mockResolvedValue({ sent: true }),
    ...overrides.ownSystemManager
  };

  const mgr = new MessageDebounceManager({
    firebaseService,
    openAIManager,
    ultraMsgManager,
    ownSystemManager,
    getClientConfig: () => ({ C1: { OWN_API_KEY: 'key-1' } }),
    documentStore: {},
    sweepIntervalMs: 60_000
  });

  return { mgr, firebaseService, openAIManager, ultraMsgManager, ownSystemManager };
}

describe('MessageDebounceManager', () => {
  const prevDebounce = process.env.MESSAGE_DEBOUNCE_MS;
  const prevMax = process.env.MESSAGE_DEBOUNCE_MAX_MS;

  afterEach(() => {
    process.env.MESSAGE_DEBOUNCE_MS = prevDebounce;
    process.env.MESSAGE_DEBOUNCE_MAX_MS = prevMax;
    jest.useRealTimers();
  });

  it('con debounce 0 procesa al momento si no hay lock', async () => {
    process.env.MESSAGE_DEBOUNCE_MS = '0';
    const { mgr, openAIManager, firebaseService } = createManager();
    const result = await mgr.queueChatMessage({
      userId: '521',
      clientCode: 'C1',
      text: 'hola',
      processContext: { instanceId: 'inst-1' }
    });
    expect(result.reason).toBe('processed');
    expect(openAIManager.processMessage).toHaveBeenCalledWith(
      '521',
      'hola',
      'C1',
      expect.objectContaining({ instanceId: 'inst-1' })
    );
    expect(firebaseService.enqueuePendingChatMessage).not.toHaveBeenCalled();
  });

  it('con debounce 0 ignora si hay lock', async () => {
    process.env.MESSAGE_DEBOUNCE_MS = '0';
    const { mgr, openAIManager } = createManager({
      firebaseService: {
        isBotSessionLocked: jest.fn().mockResolvedValue(true)
      }
    });
    const result = await mgr.queueChatMessage({
      userId: '521',
      clientCode: 'C1',
      text: 'hola'
    });
    expect(result).toEqual({ accepted: false, reason: 'locked' });
    expect(openAIManager.processMessage).not.toHaveBeenCalled();
  });

  it('junta tres mensajes y hace un solo flush a la IA', async () => {
    process.env.MESSAGE_DEBOUNCE_MS = '2500';
    jest.useFakeTimers();
    const { mgr, openAIManager, firebaseService, ultraMsgManager } = createManager();

    await mgr.queueChatMessage({
      userId: '521',
      clientCode: 'C1',
      text: 'sii perdoname',
      flushContext: { origin: 'ultramsg', from: '521', clientId: 'C1', instanceId: 'inst-1' }
    });
    await mgr.queueChatMessage({
      userId: '521',
      clientCode: 'C1',
      text: 'perdon perdon',
      flushContext: { origin: 'ultramsg', from: '521', clientId: 'C1', instanceId: 'inst-1' }
    });
    await mgr.queueChatMessage({
      userId: '521',
      clientCode: 'C1',
      text: 'si',
      flushContext: { origin: 'ultramsg', from: '521', clientId: 'C1', instanceId: 'inst-1' }
    });

    expect(openAIManager.processMessage).not.toHaveBeenCalled();
    expect(firebaseService.enqueuePendingChatMessage).toHaveBeenCalledTimes(3);

    await jest.advanceTimersByTimeAsync(2500);

    expect(firebaseService.claimPendingChatFlush).toHaveBeenCalledWith('521', 'C1');
    expect(openAIManager.processMessage).toHaveBeenCalledTimes(1);
    expect(openAIManager.processMessage).toHaveBeenCalledWith(
      '521',
      'a\nb\nc',
      'C1',
      expect.objectContaining({ alreadyLocked: true })
    );

    const sendReply = openAIManager.processMessage.mock.calls[0][3].sendReply;
    await sendReply('ok');
    expect(ultraMsgManager.sendMessage).toHaveBeenCalledWith(
      '521',
      'ok',
      'inst-1',
      expect.objectContaining({ requestOrigin: 'UltraMsg' })
    );
  });

  it('no llama a la IA si enqueue viene locked', async () => {
    process.env.MESSAGE_DEBOUNCE_MS = '2500';
    const { mgr, openAIManager } = createManager({
      firebaseService: {
        enqueuePendingChatMessage: jest.fn().mockResolvedValue({
          accepted: false,
          reason: 'locked'
        })
      }
    });
    const result = await mgr.queueChatMessage({
      userId: '521',
      clientCode: 'C1',
      text: 'hola'
    });
    expect(result).toEqual({ accepted: false, reason: 'locked' });
    expect(openAIManager.processMessage).not.toHaveBeenCalled();
  });

  it('el flush de playground no envía WhatsApp y pasa returnTrace', async () => {
    process.env.MESSAGE_DEBOUNCE_MS = '2500';
    jest.useFakeTimers();
    const { mgr, openAIManager, ultraMsgManager, firebaseService } = createManager({
      firebaseService: {
        claimPendingChatFlush: jest.fn().mockResolvedValue({
          claimed: true,
          messages: ['a', 'b'],
          flushContext: { origin: 'playground', clientId: 'C1' }
        })
      }
    });

    await mgr.queueChatMessage({
      userId: 'playground_C1',
      clientCode: 'C1',
      text: 'a',
      flushContext: { origin: 'playground', clientId: 'C1' }
    });

    await jest.advanceTimersByTimeAsync(2500);

    expect(firebaseService.claimPendingChatFlush).toHaveBeenCalledWith('playground_C1', 'C1');
    expect(openAIManager.processMessage).toHaveBeenCalledWith(
      'playground_C1',
      'a\nb',
      'C1',
      expect.objectContaining({
        alreadyLocked: true,
        returnTrace: true
      })
    );

    const ctx = openAIManager.processMessage.mock.calls[0][3];
    await ctx.sendReply('no debe ir a WhatsApp');
    expect(ultraMsgManager.sendMessage).not.toHaveBeenCalled();
    expect(typeof ctx.ultraMsgManager.sendDocument).toBe('function');
    await expect(ctx.ultraMsgManager.sendDocument()).resolves.toEqual({ mocked: true });
  });
});
