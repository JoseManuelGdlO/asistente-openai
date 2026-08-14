const OpenAI = require('openai');
const FirebaseService = require('../services/firebaseService');

const MAX_HISTORY_ITEMS = 40;
const MAX_TOOL_LOOPS = 8;

// El PDF solo se reenvía si el usuario lo pide: menciona el documento + una intención de repetir
const DOC_MENTION_REGEX = /(pdf|dossier|documento|archivo|folleto|temario|catalogo|catálogo)/;
const RESEND_INTENT_REGEX = /(reenv|de nuevo|otra vez|nuevamente|repite|repíte|no me lleg|no lo recib|no me lo mand|volver a|vuelve a|mandalo|mándalo|enviamelo|envíamelo)/;
const COURSE_INTENT_REGEX = /(curso|capacitaci[oó]n|certificaci[oó]n|dossier|aprender\s+a\s+depilar)/;

const REPLY_AFTER_PDF_INSTRUCTION = 'PDF encolado: se enviará al usuario justo después de tu texto. '
  + 'Ahora responde con el JSON final y escribe en "reply" el texto COMPLETO que exige el prompt para este flujo '
  + '(mensaje íntegro, sin resumir ni acortar). PROHIBIDO responder solo "te comparto el dossier", '
  + '"aquí tienes la información" o cualquier resumen equivalente. No vuelvas a llamar enviar_pdf.';

class OpenAIManager {
  constructor(firebaseService = null) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.firebaseService = firebaseService || new FirebaseService();
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  /**
   * Construye instrucciones de documentos disponibles
   * @param {string} clientCode
   * @param {Object} documentStore
   * @returns {Promise<string>}
   */
  async buildDocumentsInstructions(clientCode, documentStore) {
    if (!documentStore) {
      return 'No hay DocumentStore configurado. No llames enviar_pdf.';
    }

    try {
      const docs = await documentStore.list(clientCode);
      if (!docs.length) {
        return 'Documentos disponibles para este consultorio: ninguno. No llames enviar_pdf hasta que haya PDFs subidos.';
      }
      const ids = docs.map((d) => d.documentoId).join(', ');
      return `Documentos disponibles para este consultorio: ${ids}. Usa solo estos documento_id al llamar enviar_pdf.`;
    } catch (error) {
      console.error('Error listando documentos para instructions:', error.message);
      return 'No se pudieron listar documentos. Si llamas enviar_pdf y falla, informa al usuario.';
    }
  }

  /**
   * Ajusta tools al contrato strict de Responses: required incluye todas las properties.
   * Las keys que no estaban en required se vuelven nullable (siguen siendo opcionales).
   * @param {Array} tools
   * @returns {Array}
   */
  normalizeToolsForResponses(tools) {
    if (!Array.isArray(tools)) {
      return [];
    }

    return tools.map((tool) => {
      if (!tool || tool.type !== 'function' || !tool.parameters || typeof tool.parameters !== 'object') {
        return tool;
      }
      if (tool.strict !== true) {
        return tool;
      }

      const properties = tool.parameters.properties && typeof tool.parameters.properties === 'object'
        ? { ...tool.parameters.properties }
        : {};
      const required = Array.isArray(tool.parameters.required)
        ? [...tool.parameters.required]
        : [];

      for (const key of Object.keys(properties)) {
        if (required.includes(key)) {
          continue;
        }
        required.push(key);
        properties[key] = this.makeJsonSchemaNullable(properties[key]);
      }

      return {
        ...tool,
        parameters: {
          ...tool.parameters,
          properties,
          required,
          additionalProperties: tool.parameters.additionalProperties === undefined
            ? false
            : tool.parameters.additionalProperties
        }
      };
    });
  }

  /**
   * Añade null al type de un schema JSON (campo opcional en strict)
   * @param {Object} schema
   * @returns {Object}
   */
  makeJsonSchemaNullable(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return { type: ['string', 'null'] };
    }
    const next = { ...schema };
    if (Array.isArray(next.type)) {
      if (!next.type.includes('null')) {
        next.type = [...next.type, 'null'];
      }
    } else if (typeof next.type === 'string') {
      next.type = [next.type, 'null'];
    } else {
      next.type = ['string', 'null'];
    }
    return next;
  }

  /**
   * Quita function_call sin function_call_output (pares rotos no se pueden reanudar)
   * @param {Array} items
   * @returns {Array}
   */
  dropIncompleteToolCalls(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return Array.isArray(items) ? items : [];
    }

    const callIdsWithOutput = new Set();
    for (const item of items) {
      if (item?.type === 'function_call_output' && item.call_id) {
        callIdsWithOutput.add(item.call_id);
      }
    }

    return items.filter((item) => {
      if (item?.type === 'function_call' && item.call_id && !callIdsWithOutput.has(item.call_id)) {
        return false;
      }
      return true;
    });
  }

  /**
   * Recorta historial sin romper pares function_call / function_call_output
   * @param {Array} items
   * @param {number} maxItems
   * @returns {Array}
   */
  trimHistoryItems(items, maxItems = MAX_HISTORY_ITEMS) {
    if (!Array.isArray(items) || items.length <= maxItems) {
      return Array.isArray(items) ? items : [];
    }

    let start = items.length - maxItems;

    // Si el corte cae en un function_call_output, retroceder para incluir su function_call
    while (start > 0 && items[start]?.type === 'function_call_output') {
      start -= 1;
    }

    // Si aún queda un output huérfano al inicio (no hay call que incluir), descartarlo
    while (start < items.length && items[start]?.type === 'function_call_output') {
      start += 1;
    }

    return items.slice(start);
  }

  /**
   * Serializa un Item de output para reenviarlo en input
   * @param {Object} item
   * @returns {Object|null}
   */
  serializeOutputItem(item) {
    if (!item || !item.type) {
      return null;
    }

    if (item.type === 'function_call') {
      return {
        type: 'function_call',
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments
      };
    }

    if (item.type === 'message') {
      const text = this.extractMessageText(item);
      return {
        type: 'message',
        role: item.role || 'assistant',
        content: text
      };
    }

    // reasoning y otros tipos no se persisten en historial propio
    return null;
  }

  /**
   * Extrae texto de un Item message
   * @param {Object} item
   * @returns {string}
   */
  extractMessageText(item) {
    if (!item) return '';
    if (typeof item.content === 'string') return item.content;
    if (!Array.isArray(item.content)) return '';

    return item.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'output_text' || part?.type === 'text') {
          return part.text || '';
        }
        return '';
      })
      .join('')
      .trim();
  }

  /**
   * Envía documentos encolados tras el reply de texto
   * @param {Object|null} runContext
   * @returns {Promise<void>}
   */
  async flushPendingDocuments(runContext) {
    const pending = runContext?.pendingDocuments;
    if (!pending || !pending.length || !runContext.ultraMsgManager) {
      return;
    }

    for (const item of pending) {
      console.log(`📤 Enviando documento pendiente: ${item.filename || item.documentoId}`);
      await runContext.ultraMsgManager.sendDocument(
        item.userId,
        {
          filename: item.filename,
          document: item.document,
          caption: item.caption || ''
        },
        item.instanceId
      );
    }
    runContext.pendingDocuments = [];
  }

  /**
   * Entrega reply (opcional) y luego los PDFs encolados
   * @param {Object} context
   * @param {Object|null} runContext
   * @param {string} reply
   * @param {Object} [extra]
   * @returns {Promise<string|Object>}
   */
  async deliverReplyThenDocuments(context, runContext, reply, extra = {}) {
    if (typeof context?.sendReply === 'function') {
      await context.sendReply(reply);
    }
    await this.flushPendingDocuments(runContext);
    return this.wrapProcessResult(context, reply, extra);
  }

  /**
   * Detecta si el usuario pide explícitamente que le reenvíen el documento
   * @param {string} message
   * @returns {boolean}
   */
  isResendRequest(message) {
    if (typeof message !== 'string' || !message.trim()) {
      return false;
    }
    const text = message.toLowerCase();
    return DOC_MENTION_REGEX.test(text) && RESEND_INTENT_REGEX.test(text);
  }

  /**
   * Detecta intención explícita de curso en el mensaje actual
   * @param {string} message
   * @returns {boolean}
   */
  isCourseIntent(message) {
    return typeof message === 'string'
      && COURSE_INTENT_REGEX.test(message.toLowerCase());
  }

  /**
   * Ejecuta enviar_pdf (encola; el envío real es tras el reply)
   * @param {Object} args
   * @param {Object|null} runContext
   * @returns {Promise<Object>}
   */
  async executeEnviarPdf(args, runContext = null) {
    const ctx = runContext;
    if (!ctx || !ctx.documentStore || !ctx.ultraMsgManager) {
      return { error: 'Contexto de envío no disponible' };
    }

    const documentoId = args.documento_id || args.documentoId;
    if (!documentoId) {
      return {
        success: false,
        blocked: true,
        error: 'documento_id es requerido',
        instruction: 'Responde solo con texto. No vuelvas a llamar enviar_pdf en este turno.'
      };
    }

    if (!ctx.allowDocumentSend) {
      console.log(`🚫 enviar_pdf bloqueado (sin intención de curso o reenvío): ${documentoId}`);
      return {
        success: false,
        blocked: true,
        documento_id: documentoId,
        error: 'El mensaje actual no pide información de un curso ni el reenvío explícito de un documento.',
        instruction: 'Responde solo con texto a la consulta actual. No vuelvas a llamar enviar_pdf '
          + 'ni menciones que enviarás un documento.'
      };
    }

    if (ctx.sentDocuments && ctx.sentDocuments.has(documentoId)) {
      console.log(`↩️ enviar_pdf omitido (ya encolado en este turno): ${documentoId}`);
      return {
        success: true,
        already_sent: true,
        documento_id: documentoId,
        message: 'Este PDF ya se envió en este turno. No vuelvas a llamar enviar_pdf: responde ahora con el JSON final.',
        instruction: REPLY_AFTER_PDF_INSTRUCTION
      };
    }

    if (!ctx.allowResend && ctx.sessionSentDocuments && ctx.sessionSentDocuments.has(documentoId)) {
      console.log(`🚫 enviar_pdf bloqueado (ya enviado en esta conversación): ${documentoId}`);
      return {
        success: false,
        blocked: true,
        already_sent_session: true,
        documento_id: documentoId,
        error: 'Este PDF ya se envió antes en esta conversación y el usuario no pidió que se lo reenvíes.',
        instruction: 'No vuelvas a llamar enviar_pdf. Responde con texto la pregunta actual del usuario, '
          + 'sin mencionar el documento ni decir que lo estás enviando.'
      };
    }

    const doc = await ctx.documentStore.get(ctx.clientId, documentoId);
    if (!doc) {
      return {
        success: false,
        blocked: true,
        error: `Documento "${documentoId}" no encontrado`,
        instruction: 'Responde solo con texto. No vuelvas a llamar enviar_pdf en este turno '
          + 'ni intentes otro documento_id.'
      };
    }

    if (!ctx.pendingDocuments) {
      ctx.pendingDocuments = [];
    }
    ctx.pendingDocuments.push({
      userId: ctx.userId,
      documentoId: doc.documentoId,
      filename: doc.filename,
      document: doc.buffer.toString('base64'),
      caption: args.caption || '',
      instanceId: ctx.instanceId
    });

    if (ctx.sentDocuments) {
      ctx.sentDocuments.add(documentoId);
      ctx.sentDocuments.add(doc.documentoId);
    }
    if (ctx.sessionSentDocuments) {
      ctx.sessionSentDocuments.add(documentoId);
      ctx.sessionSentDocuments.add(doc.documentoId);
    }

    console.log(`📄 enviar_pdf encolado (después del reply): ${doc.documentoId}`);

    return {
      success: true,
      documento_id: doc.documentoId,
      filename: doc.filename,
      queued: true,
      instruction: REPLY_AFTER_PDF_INSTRUCTION
    };
  }

  /**
   * Ejecuta una function_call de Responses
   * @param {Object} functionCall
   * @param {Object|null} runContext
   * @returns {Promise<Object>}
   */
  async executeFunctionCall(functionCall, runContext = null) {
    const functionName = functionCall.name;
    let args = {};
    try {
      args = JSON.parse(functionCall.arguments || '{}');
    } catch (_error) {
      args = {};
    }

    if (functionName === 'enviar_pdf') {
      try {
        console.log('📄 Ejecutando enviar_pdf:', args);
        return await this.executeEnviarPdf(args, runContext);
      } catch (error) {
        console.error('❌ Error en enviar_pdf:', error.message);
        return { error: error.message || 'Error enviando PDF' };
      }
    }

    return { error: `Función ${functionName} no implementada.` };
  }

  /**
   * Texto crudo de una respuesta ('' si solo trae function_calls)
   * @param {Object} response
   * @returns {string}
   */
  extractResponseText(response) {
    if (!response) {
      return '';
    }
    return response.output_text
      || (response.output || [])
        .filter((item) => item.type === 'message')
        .map((item) => this.extractMessageText(item))
        .join('')
        .trim();
  }

  /**
   * Parsea reply desde output_text o message Items
   * @param {Object} response
   * @returns {string}
   */
  parseReply(response) {
    const raw = this.extractResponseText(response);

    if (!raw) {
      return 'Lo siento, no pude generar una respuesta. ¿Puedes intentar de nuevo?';
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.reply === 'string') {
        return parsed.reply;
      }
    } catch (_error) {
      // Si no es JSON, devolver texto plano
    }

    return raw;
  }

  /**
   * Arma el body de responses.create para un turno
   * @param {Object} params
   * @returns {Object}
   */
  buildResponsesRequest({ instructions, items, tools, responseSchema, config = {}, toolChoice = null }) {
    const request = {
      model: this.model,
      instructions,
      input: items,
      store: false,
      tools: tools && tools.length ? tools : undefined,
      text: {
        format: {
          type: 'json_schema',
          name: 'whatsapp_reply',
          strict: true,
          schema: responseSchema
        }
      }
    };

    if (toolChoice && tools && tools.length) {
      request.tool_choice = toolChoice;
    }

    if (config.temperature !== undefined) {
      request.temperature = config.temperature;
    }
    if (config.max_output_tokens !== undefined) {
      request.max_output_tokens = config.max_output_tokens;
    } else if (config.max_tokens !== undefined) {
      request.max_output_tokens = config.max_tokens;
    }

    return request;
  }

  /**
   * Devuelve string (webhook) u objeto con traza (playground)
   * @param {Object} context
   * @param {string} reply
   * @param {Object} [extra]
   * @returns {string|Object}
   */
  wrapProcessResult(context, reply, extra = {}) {
    if (!context || !context.returnTrace) {
      return reply;
    }
    return {
      reply,
      tools: Array.isArray(extra.tools) ? extra.tools : [],
      locked: Boolean(extra.locked),
      items: Array.isArray(extra.items) ? extra.items : []
    };
  }

  /**
   * Lee una sesión (incluye items). Null si no existe.
   * @param {string} userId
   * @param {string} clientCode
   * @returns {Promise<Object|null>}
   */
  async getSession(userId, clientCode) {
    return this.firebaseService.getBotSession(userId, clientCode);
  }

  /**
   * Procesa un mensaje con Responses API + historial en Firestore
   * @param {string} userId
   * @param {string} message
   * @param {string} clientCode
   * @param {Object} context
   * @returns {Promise<string|Object>}
   */
  async processMessage(userId, message, clientCode = 'default', context = {}) {
    const assistant = await this.firebaseService.getAssistantByClientId(clientCode);
    if (!assistant || assistant.status === 'deleted') {
      return this.deliverReplyThenDocuments(
        context,
        null,
        '❌ Error: Configuración del asistente incompleta. Contacta al administrador.'
      );
    }

    const locked = await this.firebaseService.tryLockBotSession(userId, clientCode);
    if (!locked) {
      return this.deliverReplyThenDocuments(
        context,
        null,
        'Por favor espera a que termine la respuesta anterior.',
        { locked: true }
      );
    }

    // Contexto local por request: evita que peticiones concurrentes se pisen
    const allowResend = this.isResendRequest(message);
    const runContext = {
      userId,
      clientId: clientCode,
      instanceId: context.instanceId || null,
      ultraMsgManager: context.ultraMsgManager || null,
      documentStore: context.documentStore || null,
      sentDocuments: new Set(),
      sessionSentDocuments: new Set(),
      allowResend,
      allowDocumentSend: allowResend || this.isCourseIntent(message),
      pendingDocuments: [],
      toolTrace: []
    };

    let items = null;

    try {
      const session = await this.firebaseService.getOrCreateBotSession(userId, clientCode);
      items = Array.isArray(session.items) ? [...session.items] : [];
      if (Array.isArray(session.sentDocumentIds)) {
        runContext.sessionSentDocuments = new Set(session.sentDocumentIds);
      }

      const userItem = { type: 'message', role: 'user', content: message };
      items.push(userItem);

      const docsInstructions = await this.buildDocumentsInstructions(
        clientCode,
        context.documentStore
      );
      const instructions = [assistant.prompt || '', docsInstructions]
        .filter(Boolean)
        .join('\n\n');

      const tools = this.normalizeToolsForResponses(
        Array.isArray(assistant.tools) ? assistant.tools : []
      );
      const responseSchema = assistant.responseSchema
        || FirebaseService.DEFAULT_RESPONSE_SCHEMA;
      const config = assistant.config || {};

      let loops = 0;
      let finalResponse = null;
      // Tras una tool exitosa el modelo pierde el acceso a tools: solo puede cerrar con JSON
      let toolsLocked = false;

      while (loops < MAX_TOOL_LOOPS) {
        loops += 1;
        await this.firebaseService.refreshBotSessionLock(userId, clientCode);

        const request = this.buildResponsesRequest({
          instructions,
          items,
          tools,
          responseSchema,
          config,
          toolChoice: toolsLocked ? 'none' : null
        });

        console.log(
          `Responses create (loop ${loops}${toolsLocked ? ', tool_choice=none' : ''}) para ${userId}_${clientCode}`
        );
        const response = await this.openai.responses.create(request);
        finalResponse = response;

        const output = Array.isArray(response.output) ? response.output : [];
        const functionCalls = output.filter((item) => item.type === 'function_call');

        // Persistir todos los items serializables (mensajes + function_calls; sin reasoning)
        for (const item of output) {
          const serialized = this.serializeOutputItem(item);
          if (serialized) {
            items.push(serialized);
          }
        }

        if (functionCalls.length === 0) {
          break;
        }

        for (const call of functionCalls) {
          const result = await this.executeFunctionCall(call, runContext);
          if (result && (result.success || result.blocked)) {
            toolsLocked = true;
          }
          let args = {};
          try {
            args = JSON.parse(call.arguments || '{}');
          } catch (_error) {
            args = {};
          }
          runContext.toolTrace.push({
            name: call.name,
            arguments: args,
            result
          });
          items.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(result)
          });
        }
      }

      if (!finalResponse) {
        await this.persistSessionItems(userId, clientCode, items, runContext);
        // Sin reply válido: no enviar PDFs encolados
        runContext.pendingDocuments = [];
        return this.deliverReplyThenDocuments(
          context,
          runContext,
          'Hubo un error procesando tu mensaje. Intenta de nuevo.',
          { tools: runContext.toolTrace, items }
        );
      }

      // Se agotaron los loops sin texto: última llamada sin tools para obtener el reply
      if (!this.extractResponseText(finalResponse)) {
        try {
          console.log(`Responses create (cierre sin tools) para ${userId}_${clientCode}`);
          await this.firebaseService.refreshBotSessionLock(userId, clientCode);
          const closingResponse = await this.openai.responses.create(
            this.buildResponsesRequest({
              instructions,
              items,
              tools: [],
              responseSchema,
              config
            })
          );
          if (this.extractResponseText(closingResponse)) {
            finalResponse = closingResponse;
            for (const item of (closingResponse.output || [])) {
              const serialized = this.serializeOutputItem(item);
              if (serialized) {
                items.push(serialized);
              }
            }
          }
        } catch (closingError) {
          console.error('Error en llamada de cierre sin tools:', closingError.message);
        }
      }

      const reply = this.parseReply(finalResponse);
      await this.persistSessionItems(userId, clientCode, items, runContext);

      return this.deliverReplyThenDocuments(context, runContext, reply, {
        tools: runContext.toolTrace,
        items
      });
    } catch (error) {
      console.error('Error procesando mensaje con OpenAI:', error.message);
      if (Array.isArray(items) && items.length) {
        try {
          await this.persistSessionItems(userId, clientCode, items, runContext);
        } catch (saveError) {
          console.error('Error persistiendo sesión tras fallo:', saveError.message);
        }
      }
      // Error: descartar PDFs encolados para no mandar documento sin contexto
      if (runContext) {
        runContext.pendingDocuments = [];
      }
      return this.deliverReplyThenDocuments(
        context,
        runContext,
        'Hubo un error procesando tu mensaje. Intenta de nuevo.',
        { tools: runContext.toolTrace, items }
      );
    } finally {
      try {
        await this.firebaseService.unlockBotSession(userId, clientCode);
      } catch (unlockError) {
        console.error('Error liberando lock de sesión:', unlockError.message);
      }
    }
  }

  /**
   * Guarda items de sesión sin pares de tools rotos
   * @param {string} userId
   * @param {string} clientCode
   * @param {Array} items
   * @param {Object|null} runContext
   */
  async persistSessionItems(userId, clientCode, items, runContext = null) {
    const cleaned = this.dropIncompleteToolCalls(items);
    const trimmed = this.trimHistoryItems(cleaned, MAX_HISTORY_ITEMS);
    const payload = {
      items: trimmed,
      lockedUntil: null
    };
    if (runContext?.sessionSentDocuments) {
      payload.sentDocumentIds = Array.from(runContext.sessionSentDocuments);
    }
    await this.firebaseService.saveBotSession(userId, clientCode, payload);
  }

  /**
   * Resetea todas las sesiones (bot_sessions)
   * @returns {Promise<number>}
   */
  async resetSessions() {
    const deleted = await this.firebaseService.resetAllBotSessions();
    console.log(`=== Sesiones reseteadas (${deleted}) ===`);
    return deleted;
  }

  /**
   * Borra una sesión concreta
   * @param {string} userId
   * @param {string} clientCode
   * @returns {Promise<boolean>}
   */
  async deleteSession(userId, clientCode) {
    return this.firebaseService.deleteBotSession(userId, clientCode);
  }

  /**
   * Borra todas las sesiones de un usuario
   * @param {string} userId
   * @returns {Promise<number>}
   */
  async deleteSessionsByUserId(userId) {
    const deleted = await this.firebaseService.deleteBotSessionsByUserId(userId);
    console.log(`=== Sesiones eliminadas para usuario ${userId}: ${deleted} ===`);
    return deleted;
  }

  /**
   * Borra todas las sesiones de un consultorio
   * @param {string} clientCode
   * @returns {Promise<number>}
   */
  async deleteSessionsByClientCode(clientCode) {
    const deleted = await this.firebaseService.deleteBotSessionsByClientCode(clientCode);
    console.log(`=== Sesiones eliminadas para consultorio ${clientCode}: ${deleted} ===`);
    return deleted;
  }

  /**
   * Lista sesiones (resumen, sin items)
   * @param {{ userId?: string, clientCode?: string }} [filters]
   * @returns {Promise<Object[]>}
   */
  async listSessions(filters = {}) {
    return this.firebaseService.listBotSessions(filters);
  }
}

module.exports = OpenAIManager;