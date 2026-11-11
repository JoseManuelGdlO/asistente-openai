const { AGENDA_TOOL_NAMES, DEFAULT_TIMEZONE } = require('./constants');
const { localDate } = require('./time');

function toolName(tool) {
  if (!tool || typeof tool !== 'object') return '';
  if (typeof tool.name === 'string') return tool.name;
  if (typeof tool.function?.name === 'string') return tool.function.name;
  return '';
}

function isAgendaTool(name) {
  return AGENDA_TOOL_NAMES.includes(name);
}

function toolDefinitions() {
  const nullable = (description) => ({ type: ['string', 'null'], description });
  return [
    {
      type: 'function',
      name: 'listBookingServices',
      description: 'Lista los servicios que este bot puede agendar, con su duración real en minutos.',
      strict: true,
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] }
    },
    {
      type: 'function',
      name: 'getAvailableSlots',
      description: 'Consulta disponibilidad real de la agenda. La primera llamada va con date null y devuelve solo los días libres, sin horas. Responde con esos días y detente. Cuando la persona elija un día, llama otra vez con ese date para traer solo los horarios de ese día. Prohibido pedir los horarios de un día en el mismo turno en que date fue null.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          serviceId: { type: 'string', description: 'Identificador del servicio configurado' },
          date: nullable('Día YYYY-MM-DD cuando ya eligieron un día. null para pedir la lista de días libres'),
          preferredStart: nullable('Inicio pedido como YYYY-MM-DDTHH:mm en la zona de la agenda, o null')
        },
        required: ['serviceId', 'date', 'preferredStart']
      }
    },
    {
      type: 'function',
      name: 'createAppointment',
      description: 'Crea una sola cita cuando la persona ya eligió un horario y ya dijo su nombre completo y la dirección del servicio. Si falta el nombre o el domicilio, no la llames: pídelos y espera. Copia esos datos tal como los escribió. Una sola llamada por turno.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          serviceId: { type: 'string', description: 'Identificador del servicio' },
          start: { type: 'string', description: 'Inicio YYYY-MM-DDTHH:mm en la zona de la agenda' },
          customerName: { type: 'string', description: 'Nombre completo que la persona escribió. No lo inventes.' },
          customerAddress: { type: 'string', description: 'Dirección completa del servicio, copiada de lo que escribió la persona. No la inventes.' },
          notes: nullable('Notas breves o null')
        },
        required: ['serviceId', 'start', 'customerName', 'customerAddress', 'notes']
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
          start: { type: 'string', description: 'Nuevo inicio YYYY-MM-DDTHH:mm en la zona de la agenda' }
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

function mergeTools(storedTools, agendaTools) {
  const stored = Array.isArray(storedTools) ? storedTools : [];
  const extra = Array.isArray(agendaTools) ? agendaTools : [];
  const names = new Set(stored.map(toolName).filter(Boolean));
  return stored.concat(extra.filter((tool) => !names.has(toolName(tool))));
}

function formatSubprompt(timezone, today) {
  return [
    'Subprompt de formatos de la agenda:',
    today
      ? `Hoy es ${today} en ${timezone}. Si dicen un día y un mes sin año, usa ${today.slice(0, 4)}, o el año siguiente si ese día ya pasó.`
      : `Zona horaria de las herramientas: ${timezone}.`,
    'Campo date: YYYY-MM-DD.',
    'Campos start y preferredStart: copia exactamente startLocal (YYYY-MM-DDTHH:mm en la zona de la agenda). Prohibido Z, desfases o la hora UTC. Ej. si startLocal es 09:00, envía …T09:00; nunca …T15:00.',
    'Si date va vacío, getAvailableSlots devuelve solo fechas en date y label, sin horas. Ofrece solo esas fechas. Cuando elijan una, vuelve a llamar con ese date: responde con offerText completo (todos los libres del día). Prohibido mencionar un solo horario si slotCount > 1. Para reservar, copia startLocal.'
  ].join('\n');
}

function callArguments(call) {
  if (call?.arguments && typeof call.arguments === 'object') return call.arguments;
  try {
    return JSON.parse(call?.arguments || '{}');
  } catch (_error) {
    return {};
  }
}

function isDayListSlotsCall(call) {
  if (call?.name !== 'getAvailableSlots') return false;
  const date = callArguments(call).date;
  return date == null || String(date).trim() === '';
}

/**
 * Lista de días: solo corre esa consulta.
 * Si en el mismo lote se piden horarios y la persona no dijo una hora, no se reserva.
 * Una cita ya pedida en un turno posterior (aunque elijan con el número de la lista) sí se crea, una sola vez.
 * @returns {{ call: object, action: 'run'|'skip-for-days'|'skip-until-choice'|'skip-extra-booking' }[]}
 */
function planAgendaToolRound(functionCalls, options = {}) {
  const calls = Array.isArray(functionCalls) ? functionCalls : [];
  const userNamedTime = options.userNamedTime === true;
  const firstDayList = calls.findIndex(isDayListSlotsCall);
  const askedSlots = calls.some((call) => call?.name === 'getAvailableSlots');
  const blockCreates = firstDayList >= 0 || (askedSlots && !userNamedTime);
  let createKept = false;
  return calls.map((call, index) => {
    if (call?.name === 'createAppointment' || call?.name === 'rescheduleAppointment') {
      if (blockCreates) return { call, action: 'skip-until-choice' };
      if (createKept) return { call, action: 'skip-extra-booking' };
      createKept = true;
      return { call, action: 'run' };
    }
    if (firstDayList < 0 || call?.name !== 'getAvailableSlots') return { call, action: 'run' };
    if (index === firstDayList) return { call, action: 'run' };
    return { call, action: 'skip-for-days' };
  });
}

const DAYS_ONLY_SKIP = {
  success: false,
  skipped: true,
  mode: 'days',
  instruction: 'Ignora esta llamada. En este turno ya se pidió la lista de días. Responde solo con esas fechas, sin horas. Cuando la persona elija un día, vuelve a consultar ese date.'
};

const WAIT_FOR_TIME_SKIP = {
  success: false,
  skipped: true,
  instruction: 'No reserves. La persona todavía no eligió un horario. Enumera TODOS los horarios de offerText y espera a que elija uno. No confirmes ninguna cita.'
};

const EXTRA_BOOKING_SKIP = {
  success: false,
  skipped: true,
  instruction: 'Ignora esta llamada. Solo se reserva el horario que la persona eligió, una vez. No confirmes otras citas.'
};

function replyOffersAppointmentTime(text) {
  const value = String(text || '');
  if (/\b\d{1,2}:\d{2}\b/.test(value)) return true;
  return /\b\d{1,2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)\b/i.test(value);
}

function normalizeClock(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Última oferta con horarios. Si en el turno también hubo una consulta solo de fechas, no tapa a la de horas. */
function latestAvailabilityOffer(toolTrace) {
  const rows = Array.isArray(toolTrace) ? toolTrace : [];
  let datesOnly = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const entry = rows[index];
    if (entry?.name !== 'getAvailableSlots' || !entry.result?.success) continue;
    const slots = Array.isArray(entry.result.slots) ? entry.result.slots : [];
    const timed = entry.result.mode === 'times' || slots.some((slot) => (
      slot?.startLocal || /\d{1,2}:\d{2}/.test(String(slot?.label || ''))
    ));
    if (timed) return entry.result;
    if (!datesOnly) datesOnly = entry.result;
  }
  return datesOnly;
}

/**
 * Relojes HH:mm permitidos según slots con startLocal/endLocal/label.
 * Si la oferta solo trae fechas (sin horas), devuelve null (= no validar relojes).
 */
function allowedClocksFromOffer(offer) {
  const slots = Array.isArray(offer?.slots) ? offer.slots : [];
  const hasTimedSlots = slots.some((slot) => slot?.startLocal || slot?.endLocal
    || /\d{1,2}:\d{2}/.test(String(slot?.label || '')));
  if (!hasTimedSlots) return null;
  const allowed = new Set();
  for (const slot of slots) {
    for (const raw of [slot.startLocal, slot.endLocal, slot.label, slot.start, slot.end]) {
      for (const hit of String(raw || '').match(/\d{1,2}:\d{2}/g) || []) {
        const clock = normalizeClock(hit);
        if (clock) allowed.add(clock);
      }
    }
  }
  if (offer?.offerText) {
    for (const hit of String(offer.offerText).match(/\d{1,2}:\d{2}/g) || []) {
      const clock = normalizeClock(hit);
      if (clock) allowed.add(clock);
    }
  }
  return allowed;
}

/**
 * true si el reply menciona horas HH:mm que no están en la oferta de la tool.
 * Si no hay oferta con horas, o el reply no trae HH:mm, no se considera inventado por este check.
 */
function replyInventedOfferedTimes(replyText, offer) {
  const allowed = allowedClocksFromOffer(offer);
  if (!allowed) return false;
  const mentioned = String(replyText || '').match(/\d{1,2}:\d{2}/g) || [];
  if (!mentioned.length) return false;
  return mentioned.some((hit) => {
    const clock = normalizeClock(hit);
    return clock && !allowed.has(clock);
  });
}

/** true si la oferta era solo fechas y el reply ya metió horas. */
function replyInventedHoursOnDateOffer(replyText, offer) {
  if (!offer?.success) return false;
  const allowed = allowedClocksFromOffer(offer);
  if (allowed) return false;
  const slots = Array.isArray(offer.slots) ? offer.slots : [];
  if (!slots.length) return false;
  return replyOffersAppointmentTime(replyText);
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
    'getAvailableSlots calcula disponibilidad solo con nuestra agenda (citas ya reservadas + horarios, duración del servicio, citas por bloque globales y excepciones). Ofrece únicamente lo que devuelva la tool.',
    'La primera consulta va sin date y devuelve solo fechas. Ofrece solo esos date y label, sin horas, y no vuelvas a llamar getAvailableSlots en ese turno. Cuando la persona elija un día, en el turno siguiente consulta ese date: la tool trae slotCount, offerText y slots con TODOS los huecos libres de ese día.',
    'OBLIGATORIO: copia offerText tal cual o enumera cada label de slots. Prohibido inventar, interpolar o “rellenar” horas aunque el prompt hable de horario operativo. Si la tool dio 09:00–11:00 y 09:30–11:30, di solo esos; nunca inventes otros.',
    'No inventes horarios, días, duraciones ni disponibilidad. La duración es la del servicio, en minutos; el cupo es global (citas por bloque / columnas), no por servicio.',
    'Pide confirmación explícita antes de reservar, reprogramar o cancelar.',
    'Solo confirma una cita cuando createAppointment, rescheduleAppointment o cancelAppointment devuelva success true y un identificador. Si la respuesta trae dryRun o testMode, explica que es una simulación y que la cita no quedó agendada.',
    'Si no hay disponibilidad, ofrece únicamente los horarios alternativos devueltos por la herramienta (slots u offerList).',
    'Si getAvailableSlots devolvió solo fechas, responde con esas fechas y termina. Si devolvió los horarios de un día, copia todos y termina. Cuando la persona elija un horario, pide el nombre completo y la dirección del servicio si aún no los dijo. No llames createAppointment sin esos dos datos, copiados de sus mensajes. Después responde en el formato de salida del bot.',
    'Si la respuesta del bot es JSON, conserva ese contrato y escribe el mensaje para la persona en el campo reply.',
    `Zona horaria: ${timezone}.`,
    `Anticipación mínima: ${rules.minNoticeMinutes} minutos. Horizonte: ${rules.maxDaysAhead} días. Preparación entre citas: ${rules.bufferMinutes} minutos.`,
    `Los inicios se ofrecen cada ${Number(rules.slotIntervalMinutes) || 30} minutos; cada cita dura la duración del servicio (p. ej. 120 min con inicio 09:00 ocupa hasta 11:00). El cupo simultáneo por horario es appointmentsPerBlock.`,
    `Cancelaciones: ${rules.allowCancel ? 'permitidas' : 'no permitidas'}. Reprogramaciones: ${rules.allowReschedule ? 'permitidas' : 'no permitidas'}.`,
    formatSubprompt(timezone, today),
    'Servicios activos:',
    catalog || '- Ninguno.'
  ].join('\n');
}

module.exports = {
  toolName,
  isAgendaTool,
  toolDefinitions,
  mergeTools,
  formatSubprompt,
  replyOffersAppointmentTime,
  normalizeClock,
  latestAvailabilityOffer,
  allowedClocksFromOffer,
  replyInventedOfferedTimes,
  replyInventedHoursOnDateOffer,
  isDayListSlotsCall,
  planAgendaToolRound,
  DAYS_ONLY_SKIP,
  WAIT_FOR_TIME_SKIP,
  EXTRA_BOOKING_SKIP,
  buildInstructions
};
