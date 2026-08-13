const OpenAI = require('openai');
const FirebaseService = require('../services/firebaseService');

const MAX_HISTORY_ITEMS = 40;
const MAX_TOOL_LOOPS = 8;

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
   * Ejecuta enviar_pdf
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
      return { error: 'documento_id es requerido' };
    }

    const doc = await ctx.documentStore.get(ctx.clientId, documentoId);
    if (!doc) {
      return {
        error: `Documento "${documentoId}" no encontrado`,
        disponibles: (await ctx.documentStore.list(ctx.clientId)).map((d) => d.documentoId)
      };
    }

    const documentBase64 = doc.buffer.toString('base64');
    await ctx.ultraMsgManager.sendDocument(
      ctx.userId,
      {
        filename: doc.filename,
        document: documentBase64,
        caption: args.caption || ''
      },
      ctx.instanceId
    );

    return {
      success: true,
      documento_id: doc.documentoId,
      filename: doc.filename
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
   * Parsea reply desde output_text o message Items
   * @param {Object} response
   * @returns {string}
   */
  parseReply(response) {
    const raw = response.output_text
      || (response.output || [])
        .filter((item) => item.type === 'message')
        .map((item) => this.extractMessageText(item))
        .join('')
        .trim();

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
   * Procesa un mensaje con Responses API + historial en Firestore
   * @param {string} userId
   * @param {string} message
   * @param {string} clientCode
   * @param {Object} context
   * @returns {Promise<string>}
   */
  async processMessage(userId, message, clientCode = 'default', context = {}) {
    const assistant = await this.firebaseService.getAssistantByClientId(clientCode);
    if (!assistant || assistant.status === 'deleted') {
      throw new Error(`Assistant no encontrado para cliente: ${clientCode}`);
    }

    const locked = await this.firebaseService.tryLockBotSession(userId, clientCode);
    if (!locked) {
      throw new Error('Por favor espera a que termine la respuesta anterior.');
    }

    // Contexto local por request: evita que peticiones concurrentes se pisen
    const runContext = {
      userId,
      clientId: clientCode,
      instanceId: context.instanceId || null,
      ultraMsgManager: context.ultraMsgManager || null,
      documentStore: context.documentStore || null
    };

    try {
      const session = await this.firebaseService.getOrCreateBotSession(userId, clientCode);
      let items = Array.isArray(session.items) ? [...session.items] : [];

      const userItem = { type: 'message', role: 'user', content: message };
      items.push(userItem);

      const docsInstructions = await this.buildDocumentsInstructions(
        clientCode,
        context.documentStore
      );
      const instructions = [assistant.prompt || '', docsInstructions]
        .filter(Boolean)
        .join('\n\n');

      const tools = Array.isArray(assistant.tools) ? assistant.tools : [];
      const responseSchema = assistant.responseSchema
        || FirebaseService.DEFAULT_RESPONSE_SCHEMA;
      const config = assistant.config || {};

      let loops = 0;
      let finalResponse = null;

      while (loops < MAX_TOOL_LOOPS) {
        loops += 1;

        const request = {
          model: this.model,
          instructions,
          input: items,
          store: false,
          tools: tools.length ? tools : undefined,
          text: {
            format: {
              type: 'json_schema',
              name: 'whatsapp_reply',
              strict: true,
              schema: responseSchema
            }
          }
        };

        if (config.temperature !== undefined) {
          request.temperature = config.temperature;
        }
        if (config.max_output_tokens !== undefined) {
          request.max_output_tokens = config.max_output_tokens;
        } else if (config.max_tokens !== undefined) {
          request.max_output_tokens = config.max_tokens;
        }

        console.log(`Responses create (loop ${loops}) para ${userId}_${clientCode}`);
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
          items.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(result)
          });
        }
      }

      if (!finalResponse) {
        return 'Hubo un error procesando tu mensaje. Intenta de nuevo.';
      }

      const reply = this.parseReply(finalResponse);
      const trimmed = this.trimHistoryItems(items, MAX_HISTORY_ITEMS);
      await this.firebaseService.saveBotSession(userId, clientCode, {
        items: trimmed,
        lockedUntil: null
      });

      return reply;
    } finally {
      try {
        await this.firebaseService.unlockBotSession(userId, clientCode);
      } catch (unlockError) {
        console.error('Error liberando lock de sesión:', unlockError.message);
      }
    }
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
   * Lista sesiones (resumen, sin items)
   * @param {{ userId?: string, clientCode?: string }} [filters]
   * @returns {Promise<Object[]>}
   */
  async listSessions(filters = {}) {
    return this.firebaseService.listBotSessions(filters);
  }
}

module.exports = OpenAIManager;