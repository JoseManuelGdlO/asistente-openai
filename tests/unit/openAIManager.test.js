const OpenAIManager = require('../../src/managers/openAIManager');

function createFirebaseStub(overrides = {}) {
  return {
    getAssistantByClientId: jest.fn().mockResolvedValue({
      clientId: 'CLIENTE001',
      prompt: 'Eres un asistente.',
      tools: [],
      config: {},
      status: 'active'
    }),
    tryLockBotSession: jest.fn().mockResolvedValue(true),
    getOrCreateBotSession: jest.fn().mockResolvedValue({ items: [] }),
    refreshBotSessionLock: jest.fn().mockResolvedValue(undefined),
    saveBotSession: jest.fn().mockResolvedValue({}),
    unlockBotSession: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('OpenAIManager helpers', () => {
  const manager = new OpenAIManager(createFirebaseStub());

  it('trimHistoryItems no rompe pares function_call / output', () => {
    const items = [];
    for (let i = 0; i < 50; i += 1) {
      items.push({ type: 'message', role: 'user', content: `u${i}` });
    }
    items.push(
      { type: 'function_call', call_id: 'c1', name: 'enviar_pdf', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: '{}' }
    );
    const trimmed = manager.trimHistoryItems(items, 10);
    expect(trimmed.length).toBeLessThanOrEqual(10);
    const firstOutput = trimmed.findIndex((i) => i.type === 'function_call_output');
    if (firstOutput >= 0) {
      expect(trimmed[firstOutput - 1].type).toBe('function_call');
    }
  });

  it('dropIncompleteToolCalls quita function_call sin output', () => {
    const items = [
      { type: 'message', role: 'user', content: 'hola' },
      { type: 'function_call', call_id: 'c1', name: 'enviar_pdf', arguments: '{}' },
      { type: 'function_call', call_id: 'c2', name: 'enviar_pdf', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c2', output: '{}' }
    ];
    const cleaned = manager.dropIncompleteToolCalls(items);
    expect(cleaned.find((i) => i.call_id === 'c1')).toBeUndefined();
    expect(cleaned.find((i) => i.call_id === 'c2' && i.type === 'function_call')).toBeTruthy();
  });

  it('normalizeToolsForResponses mete properties faltantes en required (strict)', () => {
    const tools = [{
      type: 'function',
      name: 'enviar_pdf',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          documento_id: { type: 'string' },
          caption: { type: 'string', description: 'opcional' }
        },
        required: ['documento_id'],
        additionalProperties: false
      }
    }];
    const normalized = manager.normalizeToolsForResponses(tools);
    expect(normalized[0].parameters.required).toEqual(['documento_id', 'caption']);
    expect(normalized[0].parameters.properties.caption.type).toEqual(['string', 'null']);
    expect(normalized[0].parameters.properties.documento_id.type).toBe('string');
  });

  it('parseReply extrae { reply } o texto plano', () => {
    expect(manager.parseReply({ output_text: '{"reply":"Hola"}' })).toBe('Hola');
    expect(manager.parseReply({ output_text: 'texto plano' })).toBe('texto plano');
    expect(manager.parseReply({ output: [] })).toMatch(/no pude generar/);
  });
});

describe('OpenAIManager.processMessage', () => {
  it('devuelve aviso si el Assistant no existe', async () => {
    const firebase = createFirebaseStub({
      getAssistantByClientId: jest.fn().mockResolvedValue(null)
    });
    const manager = new OpenAIManager(firebase);
    const reply = await manager.processMessage('521', 'hola', 'CLIENTE001');
    expect(reply).toMatch(/Configuración del asistente incompleta/);
    expect(firebase.tryLockBotSession).not.toHaveBeenCalled();
  });

  it('devuelve espera si el lock está ocupado', async () => {
    const firebase = createFirebaseStub({
      tryLockBotSession: jest.fn().mockResolvedValue(false)
    });
    const manager = new OpenAIManager(firebase);
    const reply = await manager.processMessage('521', 'hola', 'CLIENTE001');
    expect(reply).toMatch(/espera/);
  });

  it('renueva lock, persiste y desbloquea en un turno simple', async () => {
    const firebase = createFirebaseStub();
    const manager = new OpenAIManager(firebase);
    manager.openai = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: '{"reply":"Claro"}',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"reply":"Claro"}' }] }]
        })
      }
    };

    const reply = await manager.processMessage('521', 'hola', 'CLIENTE001', {});
    expect(reply).toBe('Claro');
    expect(firebase.refreshBotSessionLock).toHaveBeenCalled();
    expect(firebase.saveBotSession).toHaveBeenCalled();
    expect(firebase.unlockBotSession).toHaveBeenCalled();
  });

  it('ejecuta tool loop y persiste pares completos', async () => {
    const firebase = createFirebaseStub({
      getAssistantByClientId: jest.fn().mockResolvedValue({
        prompt: 'bot',
        tools: [{ type: 'function', name: 'enviar_pdf' }],
        status: 'active'
      })
    });
    const manager = new OpenAIManager(firebase);
    const documentStore = {
      get: jest.fn().mockResolvedValue({
        documentoId: 'lista_precios',
        filename: 'lista_precios.pdf',
        buffer: Buffer.from('%PDF-1.4')
      }),
      list: jest.fn().mockResolvedValue([{ documentoId: 'lista_precios' }])
    };
    const ultraMsgManager = { sendDocument: jest.fn().mockResolvedValue({}) };

    manager.openai = {
      responses: {
        create: jest.fn()
          .mockResolvedValueOnce({
            output: [{
              type: 'function_call',
              call_id: 'call_1',
              name: 'enviar_pdf',
              arguments: JSON.stringify({ documento_id: 'lista_precios' })
            }]
          })
          .mockResolvedValueOnce({
            output_text: '{"reply":"Te envío el PDF"}',
            output: [{ type: 'message', role: 'assistant', content: [] }]
          })
      }
    };

    const reply = await manager.processMessage('521', 'precios', 'CLIENTE001', {
      documentStore,
      ultraMsgManager,
      instanceId: 'inst1'
    });

    expect(reply).toBe('Te envío el PDF');
    expect(ultraMsgManager.sendDocument).toHaveBeenCalled();
    expect(firebase.refreshBotSessionLock).toHaveBeenCalledTimes(2);
    const savedItems = firebase.saveBotSession.mock.calls[0][2].items;
    expect(savedItems.some((i) => i.type === 'function_call')).toBe(true);
    expect(savedItems.some((i) => i.type === 'function_call_output')).toBe(true);
  });

  it('si OpenAI falla, persiste parcial, desbloquea y devuelve error', async () => {
    const firebase = createFirebaseStub();
    const manager = new OpenAIManager(firebase);
    manager.openai = {
      responses: {
        create: jest.fn().mockRejectedValue(new Error('boom'))
      }
    };

    const reply = await manager.processMessage('521', 'hola', 'CLIENTE001');
    expect(reply).toMatch(/error procesando/);
    expect(firebase.saveBotSession).toHaveBeenCalled();
    const savedItems = firebase.saveBotSession.mock.calls[0][2].items;
    expect(savedItems.some((i) => i.role === 'user')).toBe(true);
    expect(firebase.unlockBotSession).toHaveBeenCalled();
  });
});
