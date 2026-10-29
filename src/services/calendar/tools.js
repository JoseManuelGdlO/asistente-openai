const { CALENDAR_TOOL_NAMES, DEFAULT_TIMEZONE, defaultFormats } = require('./constants');
const { localDate } = require('./time');

function toolName(tool) {
  if (!tool || typeof tool !== 'object') return '';
  if (typeof tool.name === 'string') return tool.name;
  if (typeof tool.function?.name === 'string') return tool.function.name;
  return '';
}

function isCalendarTool(name) {
  return CALENDAR_TOOL_NAMES.includes(name);
}

function toolDefinitions() {
  const nullable = (description) => ({
    type: ['string', 'null'],
    description
  });
  return [
    {
      type: 'function',
      name: 'listBookingServices',
      description: 'Lista los servicios que este bot puede agendar, con su duración real en minutos.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
        required: []
      }
    },
    {
      type: 'function',
      name: 'getAvailableSlots',
      description: 'Consulta disponibilidad real en Google Calendar. Si date es null, devuelve solo fechas libres (date y label), sin horas. Si date trae un día, devuelve los horarios de ese día. Ofrece primero las fechas y, cuando elijan una, vuelve a llamar con ese date.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          serviceId: { type: 'string', description: 'Identificador del servicio configurado' },
          date: nullable('Día YYYY-MM-DD cuando ya eligieron un día. null para pedir la lista de días libres'),
          preferredStart: nullable('Inicio pedido como YYYY-MM-DDTHH:mm en la zona del calendario, o null')
        },
        required: ['serviceId', 'date', 'preferredStart']
      }
    },
    {
      type: 'function',
      name: 'createAppointment',
      description: 'Crea una cita solo después de que la persona confirmó el servicio y el horario. El éxito depende de esta respuesta, no de tu texto.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          serviceId: { type: 'string', description: 'Identificador del servicio' },
          start: { type: 'string', description: 'Inicio YYYY-MM-DDTHH:mm en la zona del calendario' },
          customerName: { type: 'string', description: 'Nombre de quien reserva' },
          notes: nullable('Notas breves o null')
        },
        required: ['serviceId', 'start', 'customerName', 'notes']
      }
    },
    {
      type: 'function',
      name: 'rescheduleAppointment',
      description: 'Mueve una cita existente a otro horario después de confirmación explícita.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          appointmentId: { type: 'string', description: 'Identificador devuelto al crear la cita' },
          start: { type: 'string', description: 'Nuevo inicio YYYY-MM-DDTHH:mm en la zona del calendario' }
        },
        required: ['appointmentId', 'start']
      }
    },
    {
      type: 'function',
      name: 'cancelAppointment',
      description: 'Cancela una cita existente después de confirmación explícita.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          appointmentId: { type: 'string', description: 'Identificador devuelto al crear la cita' }
        },
        required: ['appointmentId']
      }
    }
  ];
}

function mergeTools(storedTools, calendarTools) {
  const stored = Array.isArray(storedTools) ? storedTools : [];
  const extra = Array.isArray(calendarTools) ? calendarTools : [];
  const names = new Set(stored.map(toolName).filter(Boolean));
  const appended = extra.filter((tool) => !names.has(toolName(tool)));
  return stored.concat(appended);
}

function formatSubprompt(rules, timezone, today) {
  const formats = { ...defaultFormats(), ...(rules.formats || {}) };
  const lines = [
    'Subprompt de formatos de Google Calendar:',
    today
      ? `Hoy es ${today} en ${timezone}. Si dicen un día y un mes sin año, usa ${today.slice(0, 4)}, o el año siguiente si ese día ya pasó.`
      : `Zona horaria de las herramientas: ${timezone}.`
  ];
  lines.push(`Campo date: ${formats.date}.`);
  if (formats.dateTime === 'YYYY-MM-DDTHH:mm:ssZ') {
    lines.push('Campos start y preferredStart: YYYY-MM-DDTHH:mm, o un ISO con Z. La hora del reloj se lee en la zona del calendario y no se convierte desde UTC.');
  } else {
    lines.push('Campos start y preferredStart: YYYY-MM-DDTHH:mm en la zona del calendario. Copia startLocal. No envíes Z ni desfase.');
  }
  lines.push('Si date va vacío, getAvailableSlots devuelve solo fechas en date y label, sin horas. Ofrece solo esas fechas. Cuando elijan una, vuelve a llamar con ese date y ofrece los horarios usando label. Para reservar, copia startLocal.');
  if (formats.notes) lines.push(`Notas de formato: ${formats.notes}`);
  return lines.join('\n');
}

function replyOffersAppointmentTime(text) {
  const value = String(text || '');
  if (/\b\d{1,2}:\d{2}\b/.test(value)) return true;
  return /\b\d{1,2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)\b/i.test(value);
}

function buildInstructions(runtime) {
  const services = (runtime.services || []).filter((service) => service.active);
  const catalog = services.map((service) => (
    `- ${service.id}: ${service.name}, ${service.durationMinutes} minutos.${service.description ? ` ${service.description}` : ''}`
  )).join('\n');
  const rules = runtime.rules || {};
  const timezone = runtime.timezone || DEFAULT_TIMEZONE;
  const today = runtime.today || localDate(new Date(), timezone);
  return [
    'Instrucciones de agendamiento de este bot (sistema):',
    `Hoy es ${today} en ${timezone}. El año en curso es ${today.slice(0, 4)}. Si preguntan la fecha o el año, responde con este dato. No uses ningún otro año.`,
    'Tienes acceso solo a los servicios configurados abajo. Identifica cuál pidió la persona antes de ofrecer un horario.',
    'Antes de proponer, confirmar o dar por disponible cualquier hora o día de cita, llama getAvailableSlots en este turno. El horario operativo del prompt no es disponibilidad.',
    'La primera consulta va sin date y devuelve solo fechas. Ofrece solo esos date y label, sin horas. Cuando elijan un día, consulta ese date y ofrece solo esos horarios. No inventes horarios, días, duraciones ni disponibilidad. La duración es la del servicio, en minutos.',
    'Pide confirmación explícita antes de reservar, reprogramar o cancelar.',
    'Solo confirma una cita cuando createAppointment, rescheduleAppointment o cancelAppointment devuelva success true y un identificador. Si la respuesta trae dryRun o testMode, explica que es una simulación y que la cita no quedó agendada.',
    'Si no hay disponibilidad, ofrece únicamente los horarios alternativos devueltos por la herramienta.',
    'Puedes llamar las herramientas necesarias en este turno. Después responde en el formato de salida del bot, sin volver a llamar herramientas.',
    'Si la respuesta del bot es JSON, conserva ese contrato y escribe el mensaje para la persona en el campo reply.',
    `Zona horaria: ${timezone}.`,
    `Anticipación mínima: ${rules.minNoticeMinutes} minutos. Horizonte: ${rules.maxDaysAhead} días. Intervalo ofrecido: ${rules.slotIntervalMinutes} minutos. Preparación entre citas: ${rules.bufferMinutes} minutos.`,
    `Cancelaciones: ${rules.allowCancel ? 'permitidas' : 'no permitidas'}. Reprogramaciones: ${rules.allowReschedule ? 'permitidas' : 'no permitidas'}.`,
    formatSubprompt(rules, timezone, today),
    'Servicios activos:',
    catalog || '- Ninguno.'
  ].join('\n');
}

module.exports = {
  toolName,
  isCalendarTool,
  toolDefinitions,
  mergeTools,
  formatSubprompt,
  replyOffersAppointmentTime,
  buildInstructions
};
