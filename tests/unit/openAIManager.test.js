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

  it('isCourseIntent solo acepta intención explícita de curso', () => {
    expect(manager.isCourseIntent('Quiero información del curso')).toBe(true);
    expect(manager.isCourseIntent('¿Dan capacitación?')).toBe(true);
    expect(manager.isCourseIntent('Quiero aprender a depilar')).toBe(true);
    expect(manager.isCourseIntent('¿Qué tipos de depilaciones tienes?')).toBe(false);
    expect(manager.isCourseIntent('Precio de bikini')).toBe(false);
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

    const reply = await manager.processMessage('521', 'información del curso', 'CLIENTE001', {
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

  it('no reenvía el mismo PDF y bloquea tools tras el primer éxito', async () => {
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
        documentoId: 'pdfhani',
        filename: 'pdfhani.pdf',
        buffer: Buffer.from('%PDF-1.4')
      }),
      list: jest.fn().mockResolvedValue([{ documentoId: 'pdfhani' }])
    };
    const ultraMsgManager = { sendDocument: jest.fn().mockResolvedValue({}) };

    const pdfCall = (callId) => ({
      output: [{
        type: 'function_call',
        call_id: callId,
        name: 'enviar_pdf',
        arguments: JSON.stringify({ documento_id: 'pdfhani' })
      }]
    });

    const create = jest.fn()
      .mockResolvedValueOnce(pdfCall('call_1'))
      .mockResolvedValueOnce(pdfCall('call_2'))
      .mockResolvedValue({
        output_text: '{"reply":"Listo"}',
        output: [{ type: 'message', role: 'assistant', content: [] }]
      });
    manager.openai = { responses: { create } };

    const reply = await manager.processMessage('521', 'información del curso', 'CLIENTE001', {
      documentStore,
      ultraMsgManager,
      instanceId: 'inst1'
    });

    expect(reply).toBe('Listo');
    expect(ultraMsgManager.sendDocument).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].tool_choice).toBeUndefined();
    expect(create.mock.calls[1][0].tool_choice).toBe('none');
  });

  it('no reenvía un PDF ya enviado en la conversación', async () => {
    const firebase = createFirebaseStub({
      getAssistantByClientId: jest.fn().mockResolvedValue({
        prompt: 'bot',
        tools: [{ type: 'function', name: 'enviar_pdf' }],
        status: 'active'
      }),
      getOrCreateBotSession: jest.fn().mockResolvedValue({
        items: [],
        sentDocumentIds: ['pdfhani']
      })
    });
    const manager = new OpenAIManager(firebase);
    const documentStore = {
      get: jest.fn().mockResolvedValue({
        documentoId: 'pdfhani',
        filename: 'pdfhani.pdf',
        buffer: Buffer.from('%PDF-1.4')
      }),
      list: jest.fn().mockResolvedValue([{ documentoId: 'pdfhani' }])
    };
    const ultraMsgManager = { sendDocument: jest.fn().mockResolvedValue({}) };

    const create = jest.fn()
      .mockResolvedValueOnce({
        output: [{
          type: 'function_call',
          call_id: 'call_1',
          name: 'enviar_pdf',
          arguments: JSON.stringify({ documento_id: 'pdfhani' })
        }]
      })
      .mockResolvedValue({
        output_text: '{"reply":"Tenemos zonas faciales, corporales e íntimas"}',
        output: [{ type: 'message', role: 'assistant', content: [] }]
      });
    manager.openai = { responses: { create } };

    const reply = await manager.processMessage('521', 'que tipos de depilaciones tienes?', 'CLIENTE001', {
      documentStore,
      ultraMsgManager,
      instanceId: 'inst1'
    });

    expect(reply).toMatch(/zonas faciales/);
    expect(ultraMsgManager.sendDocument).not.toHaveBeenCalled();
    expect(documentStore.get).not.toHaveBeenCalled();
    // La tool ni se ofrece: no hace falta tool_choice=none para cerrar
    expect(create.mock.calls[1][0].tools).toBeUndefined();
  });

  it('bloquea enviar_pdf si el mensaje actual no tiene intención de curso o reenvío', async () => {
    const firebase = createFirebaseStub({
      getAssistantByClientId: jest.fn().mockResolvedValue({
        prompt: 'bot',
        tools: [{ type: 'function', name: 'enviar_pdf' }],
        status: 'active'
      })
    });
    const manager = new OpenAIManager(firebase);
    const documentStore = {
      get: jest.fn(),
      list: jest.fn().mockResolvedValue([{ documentoId: 'pdfhani' }])
    };
    const ultraMsgManager = { sendDocument: jest.fn() };
    const create = jest.fn()
      .mockResolvedValueOnce({
        output: [{
          type: 'function_call',
          call_id: 'call_1',
          name: 'enviar_pdf',
          arguments: JSON.stringify({ documento_id: 'lista_precios' })
        }]
      })
      .mockResolvedValue({
        output_text: '{"reply":"Tenemos opciones faciales, corporales e íntimas"}',
        output: [{ type: 'message', role: 'assistant', content: [] }]
      });
    manager.openai = { responses: { create } };

    const reply = await manager.processMessage(
      '521',
      '¿Qué tipos de depilaciones tienes?',
      'CLIENTE001',
      { documentStore, ultraMsgManager }
    );

    expect(reply).toMatch(/faciales/);
    expect(documentStore.get).not.toHaveBeenCalled();
    expect(ultraMsgManager.sendDocument).not.toHaveBeenCalled();
    expect(create.mock.calls[1][0].tools).toBeUndefined();
    const toolOutput = create.mock.calls[1][0].input.find((item) => item.type === 'function_call_output');
    expect(JSON.parse(toolOutput.output)).toMatchObject({
      blocked: true,
      documento_id: 'lista_precios'
    });
  });

  it('no ofrece enviar_pdf al modelo si el mensaje no es de curso ni reenvío', async () => {
    const firebase = createFirebaseStub({
      getAssistantByClientId: jest.fn().mockResolvedValue({
        prompt: 'bot',
        tools: [{ type: 'function', name: 'enviar_pdf' }],
        status: 'active'
      })
    });
    const manager = new OpenAIManager(firebase);
    const documentStore = {
      get: jest.fn(),
      list: jest.fn().mockResolvedValue([{ documentoId: 'pdfhani' }])
    };
    const create = jest.fn().mockResolvedValue({
      output_text: '{"reply":"Estamos en Aguascalientes"}',
      output: [{ type: 'message', role: 'assistant', content: [] }]
    });
    manager.openai = { responses: { create } };

    await manager.processMessage('521', '¿dónde están ubicados?', 'CLIENTE001', {
      documentStore,
      ultraMsgManager: { sendDocument: jest.fn() }
    });

    expect(create.mock.calls[0][0].tools).toBeUndefined();
  });

  it('ofrece enviar_pdf cuando hay intención de curso y documentos sin enviar', async () => {
    const firebase = createFirebaseStub({
      getAssistantByClientId: jest.fn().mockResolvedValue({
        prompt: 'bot',
        tools: [{ type: 'function', name: 'enviar_pdf' }],
        status: 'active'
      })
    });
    const manager = new OpenAIManager(firebase);
    const documentStore = {
      get: jest.fn(),
      list: jest.fn().mockResolvedValue([{ documentoId: 'dossier_2026' }])
    };
    const create = jest.fn().mockResolvedValue({
      output_text: '{"reply":"Info del curso"}',
      output: [{ type: 'message', role: 'assistant', content: [] }]
    });
    manager.openai = { responses: { create } };

    await manager.processMessage('521', 'me interesa el curso', 'CLIENTE001', {
      documentStore,
      ultraMsgManager: { sendDocument: jest.fn() }
    });

    expect(create.mock.calls[0][0].tools).toEqual([
      expect.objectContaining({ name: 'enviar_pdf' })
    ]);
  });

  it('no ofrece enviar_pdf si todos los documentos ya se enviaron en la sesión', async () => {
    const firebase = createFirebaseStub({
      getAssistantByClientId: jest.fn().mockResolvedValue({
        prompt: 'bot',
        tools: [{ type: 'function', name: 'enviar_pdf' }],
        status: 'active'
      }),
      getOrCreateBotSession: jest.fn().mockResolvedValue({
        items: [],
        sentDocumentIds: ['dossier_2026']
      })
    });
    const manager = new OpenAIManager(firebase);
    const documentStore = {
      get: jest.fn(),
      list: jest.fn().mockResolvedValue([{ documentoId: 'dossier_2026' }])
    };
    const create = jest.fn().mockResolvedValue({
      output_text: '{"reply":"El curso incluye temario completo"}',
      output: [{ type: 'message', role: 'assistant', content: [] }]
    });
    manager.openai = { responses: { create } };

    await manager.processMessage('521', 'otra duda del curso', 'CLIENTE001', {
      documentStore,
      ultraMsgManager: { sendDocument: jest.fn() }
    });

    expect(create.mock.calls[0][0].tools).toBeUndefined();
  });

  it('ofrece enviar_pdf ante reenvío explícito aunque ya se haya enviado', async () => {
    const firebase = createFirebaseStub({
      getAssistantByClientId: jest.fn().mockResolvedValue({
        prompt: 'bot',
        tools: [{ type: 'function', name: 'enviar_pdf' }],
        status: 'active'
      }),
      getOrCreateBotSession: jest.fn().mockResolvedValue({
        items: [],
        sentDocumentIds: ['dossier_2026']
      })
    });
    const manager = new OpenAIManager(firebase);
    const documentStore = {
      get: jest.fn(),
      list: jest.fn().mockResolvedValue([{ documentoId: 'dossier_2026' }])
    };
    const create = jest.fn().mockResolvedValue({
      output_text: '{"reply":"Te lo reenvío"}',
      output: [{ type: 'message', role: 'assistant', content: [] }]
    });
    manager.openai = { responses: { create } };

    await manager.processMessage('521', 'mándame el pdf otra vez', 'CLIENTE001', {
      documentStore,
      ultraMsgManager: { sendDocument: jest.fn() }
    });

    expect(create.mock.calls[0][0].tools).toEqual([
      expect.objectContaining({ name: 'enviar_pdf' })
    ]);
  });

  it('canOfferEnviarPdf soporta varios documentos sin ids hardcodeados', async () => {
    const manager = new OpenAIManager(createFirebaseStub());
    const documentStore = {
      list: jest.fn().mockResolvedValue([
        { documentoId: 'dossier_curso' },
        { documentoId: 'temario_avanzado' }
      ])
    };

    const partial = await manager.canOfferEnviarPdf(
      'info del curso',
      { sessionSentDocuments: new Set(['dossier_curso']) },
      documentStore,
      'CLIENTE001'
    );
    expect(partial).toBe(true);

    const exhausted = await manager.canOfferEnviarPdf(
      'info del curso',
      { sessionSentDocuments: new Set(['dossier_curso', 'temario_avanzado']) },
      documentStore,
      'CLIENTE001'
    );
    expect(exhausted).toBe(false);
  });

  it('canOfferEnviarPdf es false si el cliente no tiene documentos', async () => {
    const manager = new OpenAIManager(createFirebaseStub());
    const result = await manager.canOfferEnviarPdf(
      'info del curso',
      { sessionSentDocuments: new Set() },
      { list: jest.fn().mockResolvedValue([]) },
      'CLIENTE001'
    );
    expect(result).toBe(false);
  });

  it('no revela documentos disponibles cuando el documento_id no existe', async () => {
    const manager = new OpenAIManager(createFirebaseStub());
    const documentStore = {
      get: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue([{ documentoId: 'pdfhani' }])
    };

    const result = await manager.executeEnviarPdf(
      { documento_id: 'lista_precios' },
      {
        clientId: 'CLIENTE001',
        documentStore,
        ultraMsgManager: { sendDocument: jest.fn() },
        allowDocumentSend: true
      }
    );

    expect(result.blocked).toBe(true);
    expect(result.disponibles).toBeUndefined();
    expect(result.instruction).toMatch(/solo con texto/i);
    expect(documentStore.list).not.toHaveBeenCalled();
  });

  it('permite reenviar el PDF si el usuario lo pide explícitamente', async () => {
    const firebase = createFirebaseStub({
      getAssistantByClientId: jest.fn().mockResolvedValue({
        prompt: 'bot',
        tools: [{ type: 'function', name: 'enviar_pdf' }],
        status: 'active'
      }),
      getOrCreateBotSession: jest.fn().mockResolvedValue({
        items: [],
        sentDocumentIds: ['pdfhani']
      })
    });
    const manager = new OpenAIManager(firebase);
    const documentStore = {
      get: jest.fn().mockResolvedValue({
        documentoId: 'pdfhani',
        filename: 'pdfhani.pdf',
        buffer: Buffer.from('%PDF-1.4')
      }),
      list: jest.fn().mockResolvedValue([{ documentoId: 'pdfhani' }])
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
              arguments: JSON.stringify({ documento_id: 'pdfhani' })
            }]
          })
          .mockResolvedValue({
            output_text: '{"reply":"Te lo reenvío"}',
            output: [{ type: 'message', role: 'assistant', content: [] }]
          })
      }
    };

    const reply = await manager.processMessage('521', 'me puedes mandar el pdf otra vez?', 'CLIENTE001', {
      documentStore,
      ultraMsgManager,
      instanceId: 'inst1'
    });

    expect(reply).toBe('Te lo reenvío');
    expect(ultraMsgManager.sendDocument).toHaveBeenCalledTimes(1);
  });

  it('persiste los documento_id enviados en la sesión', async () => {
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
        documentoId: 'pdfhani',
        filename: 'pdfhani.pdf',
        buffer: Buffer.from('%PDF-1.4')
      }),
      list: jest.fn().mockResolvedValue([{ documentoId: 'pdfhani' }])
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
              arguments: JSON.stringify({ documento_id: 'pdfhani' })
            }]
          })
          .mockResolvedValue({
            output_text: '{"reply":"Listo"}',
            output: [{ type: 'message', role: 'assistant', content: [] }]
          })
      }
    };

    await manager.processMessage('521', 'cursos', 'CLIENTE001', {
      documentStore,
      ultraMsgManager,
      instanceId: 'inst1'
    });

    const saved = firebase.saveBotSession.mock.calls[0][2];
    expect(saved.sentDocumentIds).toContain('pdfhani');
  });

  it('el output de la tool instruye a no resumir el reply', async () => {
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
        documentoId: 'pdfhani',
        filename: 'pdfhani.pdf',
        buffer: Buffer.from('%PDF-1.4')
      }),
      list: jest.fn().mockResolvedValue([{ documentoId: 'pdfhani' }])
    };
    const ultraMsgManager = { sendDocument: jest.fn().mockResolvedValue({}) };

    const create = jest.fn()
      .mockResolvedValueOnce({
        output: [{
          type: 'function_call',
          call_id: 'call_1',
          name: 'enviar_pdf',
          arguments: JSON.stringify({ documento_id: 'pdfhani' })
        }]
      })
      .mockResolvedValue({
        output_text: '{"reply":"Listo"}',
        output: [{ type: 'message', role: 'assistant', content: [] }]
      });
    manager.openai = { responses: { create } };

    await manager.processMessage('521', 'cursos', 'CLIENTE001', {
      documentStore,
      ultraMsgManager,
      instanceId: 'inst1'
    });

    const secondInput = create.mock.calls[1][0].input;
    const toolOutput = secondInput.find((i) => i.type === 'function_call_output');
    expect(JSON.parse(toolOutput.output).instruction).toMatch(/COMPLETO/);
  });

  it('envía el reply de texto antes que el PDF cuando hay sendReply', async () => {
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
        documentoId: 'pdfhani',
        filename: 'pdfhani.pdf',
        buffer: Buffer.from('%PDF-1.4')
      }),
      list: jest.fn().mockResolvedValue([{ documentoId: 'pdfhani' }])
    };
    const order = [];
    const ultraMsgManager = {
      sendDocument: jest.fn().mockImplementation(async () => {
        order.push('document');
      })
    };
    const sendReply = jest.fn().mockImplementation(async () => {
      order.push('reply');
    });

    manager.openai = {
      responses: {
        create: jest.fn()
          .mockResolvedValueOnce({
            output: [{
              type: 'function_call',
              call_id: 'call_1',
              name: 'enviar_pdf',
              arguments: JSON.stringify({ documento_id: 'pdfhani' })
            }]
          })
          .mockResolvedValueOnce({
            output_text: '{"reply":"Aquí va el dossier"}',
            output: [{ type: 'message', role: 'assistant', content: [] }]
          })
      }
    };

    const reply = await manager.processMessage('521', 'cursos', 'CLIENTE001', {
      documentStore,
      ultraMsgManager,
      instanceId: 'inst1',
      sendReply
    });

    expect(reply).toBe('Aquí va el dossier');
    expect(sendReply).toHaveBeenCalledWith('Aquí va el dossier');
    expect(ultraMsgManager.sendDocument).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['reply', 'document']);
  });

  it('si OpenAI falla tras encolar PDF, no envía el documento', async () => {
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
        documentoId: 'pdfhani',
        filename: 'pdfhani.pdf',
        buffer: Buffer.from('%PDF-1.4')
      }),
      list: jest.fn().mockResolvedValue([{ documentoId: 'pdfhani' }])
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
              arguments: JSON.stringify({ documento_id: 'pdfhani' })
            }]
          })
          .mockRejectedValueOnce(new Error('boom'))
      }
    };

    const reply = await manager.processMessage('521', 'información del curso', 'CLIENTE001', {
      documentStore,
      ultraMsgManager,
      instanceId: 'inst1'
    });

    expect(reply).toMatch(/error procesando/i);
    expect(ultraMsgManager.sendDocument).not.toHaveBeenCalled();
    const saved = firebase.saveBotSession.mock.calls[0][2];
    expect(saved.sentDocumentIds).toContain('pdfhani');
  });

  it('si se agotan los loops sin texto, cierra con una llamada sin tools', async () => {
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
        documentoId: 'pdfhani',
        filename: 'pdfhani.pdf',
        buffer: Buffer.from('%PDF-1.4')
      }),
      list: jest.fn().mockResolvedValue([{ documentoId: 'pdfhani' }])
    };
    const ultraMsgManager = { sendDocument: jest.fn().mockResolvedValue({}) };

    let call = 0;
    const create = jest.fn().mockImplementation((request) => {
      call += 1;
      if (!request.tools) {
        return Promise.resolve({
          output_text: '{"reply":"Te envié el PDF"}',
          output: [{ type: 'message', role: 'assistant', content: [] }]
        });
      }
      return Promise.resolve({
        output: [{
          type: 'function_call',
          call_id: `call_${call}`,
          name: 'enviar_pdf',
          arguments: JSON.stringify({ documento_id: 'pdfhani' })
        }]
      });
    });
    manager.openai = { responses: { create } };

    const reply = await manager.processMessage('521', 'información del curso', 'CLIENTE001', {
      documentStore,
      ultraMsgManager,
      instanceId: 'inst1'
    });

    expect(reply).toBe('Te envié el PDF');
    expect(ultraMsgManager.sendDocument).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[create.mock.calls.length - 1][0].tools).toBeUndefined();
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
