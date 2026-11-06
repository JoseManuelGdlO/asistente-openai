const OpenAIManager = require('../../src/managers/openAIManager');
const {
  mergeTools, toolDefinitions, buildInstructions, isAgendaTool, replyOffersAppointmentTime
} = require('../../src/services/configuracion/agenda/tools');
const { defaultRules } = require('../../src/services/configuracion/agenda/constants');

function agendaStub(runtime, execute = jest.fn()) {
  return {
    loadRuntime: jest.fn().mockResolvedValue(runtime),
    buildInstructions,
    toolDefinitions,
    mergeTools,
    isAgendaTool,
    execute
  };
}

function managerWith(booking, tools) {
  const firebase = {
    getAssistantByClientId: jest.fn().mockResolvedValue({
      prompt: 'PROMPT ORIGINAL',
      tools,
      status: 'active'
    }),
    tryLockBotSession: jest.fn().mockResolvedValue(true),
    getOrCreateBotSession: jest.fn().mockResolvedValue({ items: [] }),
    refreshBotSessionLock: jest.fn(),
    saveBotSession: jest.fn(),
    unlockBotSession: jest.fn()
  };
  const manager = new OpenAIManager(firebase);
  manager.calendarBooking = booking;
  manager.openai = {
    responses: {
      create: jest.fn().mockResolvedValue({
        output_text: '{"reply":"listo"}',
        output: [{ type: 'message', role: 'assistant', content: [] }]
      })
    }
  };
  return manager;
}

const READY_RUNTIME = {
  ready: true,
  timezone: 'America/Mexico_City',
  services: [{ id: 'svc_premium01', name: 'Servicio premium', description: '', durationMinutes: 180, active: true }],
  rules: defaultRules()
};

describe('OpenAIManager y agenda', () => {
  it('inyecta instrucciones y tools sin modificar el prompt ni el JSON guardado', async () => {
    const tools = [{ type: 'function', name: 'enviar_pdf' }];
    const manager = managerWith(agendaStub(READY_RUNTIME), tools);

    await manager.processMessage('521', 'hola', 'bot-1', { origin: 'meta' });
    const request = manager.openai.responses.create.mock.calls[0][0];
    expect(request.instructions).toContain('PROMPT ORIGINAL');
    expect(request.instructions).toContain('No inventes horarios');
    expect(request.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['listBookingServices', 'createAppointment']));
    expect(request.tools.find((tool) => tool.name === 'enviar_pdf')).toBeUndefined();
    expect(tools).toEqual([{ type: 'function', name: 'enviar_pdf' }]);
  });

  it('consulta la agenda antes de ofrecer un horario', async () => {
    expect(replyOffersAppointmentTime('Hay lugar a las 9:00')).toBe(true);
    expect(replyOffersAppointmentTime('El servicio dura 2 horas')).toBe(false);

    const execute = jest.fn().mockResolvedValue({
      success: true,
      slots: [{ startLocal: '2026-10-26T12:00', label: 'lunes 26 de oct, 12:00–12:30' }],
      instruction: 'Ofrece solo los horarios devueltos.'
    });
    const manager = managerWith(agendaStub(READY_RUNTIME, execute), []);
    manager.openai.responses.create
      .mockResolvedValueOnce({
        output_text: '{"reply":"Puedes venir a las 9:00"}',
        output: [{ type: 'message', role: 'assistant', content: [] }]
      })
      .mockResolvedValueOnce({
        output_text: '',
        output: [{
          type: 'function_call',
          name: 'getAvailableSlots',
          arguments: '{"serviceId":"svc_premium01","date":"2026-10-26","preferredStart":null}',
          call_id: 'call_1'
        }]
      })
      .mockResolvedValueOnce({
        output_text: '{"reply":"El lunes 26 hay lugar a las 12:00"}',
        output: [{ type: 'message', role: 'assistant', content: [] }]
      });

    const result = await manager.processMessage('521', 'quiero el lunes a las 9', 'bot-1', { origin: 'meta' });
    expect(execute).toHaveBeenCalledWith(
      'getAvailableSlots',
      expect.any(Object),
      expect.objectContaining({ clientId: 'bot-1' })
    );
    const forced = manager.openai.responses.create.mock.calls[1][0];
    expect(forced.tool_choice).toEqual({ type: 'function', name: 'getAvailableSlots' });
    expect(result).toContain('12:00');
  });

  it('con la agenda apagada no manda las tools de agenda', async () => {
    const stored = [
      { type: 'function', name: 'getAvailableSlots' },
      { type: 'function', name: 'enviar_pdf' }
    ];
    const manager = managerWith(agendaStub({ ready: false, phase: 'disabled' }), stored);
    await manager.processMessage('521', 'hola', 'bot-1', { origin: 'meta' });
    const request = manager.openai.responses.create.mock.calls[0][0];
    expect(request.instructions).not.toContain('No inventes horarios');
    expect(request.tools || []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'getAvailableSlots' })
    ]));
    expect(stored).toEqual([
      { type: 'function', name: 'getAvailableSlots' },
      { type: 'function', name: 'enviar_pdf' }
    ]);
  });
});
