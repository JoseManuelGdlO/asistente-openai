const OpenAI = require('openai');

class OpenAIManager {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    // Store thread IDs per user and client combination
    this.userThreads = new Map();
    
    // Mapa para guardar el estado de los runs por thread
    this.threadRuns = new Map();
  }

  /**
   * Obtiene o crea un thread para un usuario y cliente específico
   * @param {string} userId - ID del usuario
   * @param {string} clientCode - Código del cliente
   * @returns {string} - ID del thread
   */
  async getOrCreateThread(userId, clientCode) {
    const threadKey = `${userId}_${clientCode}`;
    let threadId = this.userThreads.get(threadKey);
    if (!threadId) {
      console.log('Creando nuevo thread para usuario:', userId, 'cliente:', clientCode);
      const thread = await this.openai.beta.threads.create();
      threadId = thread.id;
      this.userThreads.set(threadKey, threadId);
    } else {
      console.log('Usando thread existente:', threadId, 'para cliente:', clientCode);
    }
    return threadId;
  }

  /**
   * Verifica si hay un run activo para un thread
   * @param {string} threadId - ID del thread
   * @returns {boolean} - True si hay un run activo
   */
  hasActiveRun(threadId) {
    const runStatus = this.threadRuns.get(threadId);
    return runStatus && runStatus !== 'completed' && runStatus !== 'failed';
  }

  /**
   * Agrega un mensaje a un thread
   * @param {string} threadId - ID del thread
   * @param {string} content - Contenido del mensaje
   * @returns {Object} - Mensaje creado
   */
  async addMessageToThread(threadId, content) {
    const threadMessage = await this.openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: content
    });
    console.log('Mensaje agregado al thread:', threadMessage.id);
    return threadMessage;
  }

  /**
   * Obtiene mensajes anteriores de un thread
   * @param {string} threadId - ID del thread
   * @param {number} limit - Número de mensajes a obtener
   * @returns {Array} - Lista de mensajes
   */
  async getPreviousMessages(threadId, limit = 5) {
    const previousMessages = await this.openai.beta.threads.messages.list(threadId, {
      order: 'desc',
      limit: limit
    });
    console.log('Mensajes anteriores en el thread:', JSON.stringify(previousMessages.data, null, 2));
    return previousMessages.data;
  }

  /**
   * Construye additional_instructions con documentos disponibles
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
   * Crea y ejecuta un run
   * @param {string} threadId - ID del thread
   * @param {string} assistantId - ID del asistente a usar
   * @param {string} [additionalInstructions]
   * @returns {Object} - Run creado
   */
  async createRun(threadId, assistantId, additionalInstructions = '') {
    console.log('Creando run con asistente:', assistantId);
    const payload = {
      assistant_id: assistantId
    };
    if (additionalInstructions) {
      payload.additional_instructions = additionalInstructions;
    }

    const run = await this.openai.beta.threads.runs.create(threadId, payload);
    console.log('Run creado:', run.id);
    
    // Guardar estado del run como in_progress
    this.threadRuns.set(threadId, 'in_progress');
    
    return run;
  }

  /**
   * Espera a que termine un run
   * @param {string} threadId - ID del thread
   * @param {string} runId - ID del run
   * @param {Object|null} runContext - Contexto del request (aislado por llamada)
   * @returns {Object} - Estado final del run
   */
  async waitForRunCompletion(threadId, runId, runContext = null) {
    let runStatusObj;
    let retryCount = 0;
    const maxRetries = 150; // 5 minutos total
    
    do {
      await new Promise(r => setTimeout(r, 2000)); // 2 segundos entre intentos
      runStatusObj = await this.openai.beta.threads.runs.retrieve(threadId, runId);
      this.threadRuns.set(threadId, runStatusObj.status);
      console.log(`Estado del run: ${runStatusObj.status} (intento ${retryCount + 1}/${maxRetries})`);
      
      if (runStatusObj.status === 'failed') {
        console.error('Error en el run:', runStatusObj.last_error);
        break;
      }

      // Si requiere acción, manejar tool_calls
      if (runStatusObj.status === "requires_action") {
        console.log('El run requiere acción, procesando tool_calls...');
        console.log('Tool calls:', JSON.stringify(runStatusObj.required_action.submit_tool_outputs.tool_calls, null, 2));
        await this.handleRequiredAction(runStatusObj, threadId, runId, runContext);
      }

      retryCount++;
      if (retryCount >= maxRetries) {
        console.error(`Se alcanzó el máximo número de reintentos (${maxRetries}). El asistente está tardando más de lo esperado.`);
        console.error(`Tiempo total esperado: ${(maxRetries * 2)} segundos (${Math.round((maxRetries * 2) / 60)} minutos)`);
        break;
      }
    } while (runStatusObj.status !== "completed" && runStatusObj.status !== "failed");

    // Guardar estado final del run
    this.threadRuns.set(threadId, runStatusObj.status);
    
    return runStatusObj;
  }

  /**
   * Maneja required_action y tool_calls
   * @param {Object} runStatus - Estado del run
   * @param {string} threadId - ID del thread
   * @param {string} runId - ID del run
   * @param {Object|null} runContext - Contexto del request (aislado por llamada)
   */
  async handleRequiredAction(runStatus, threadId, runId, runContext = null) {
    const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
    const tool_outputs = await this.processToolCalls(toolCalls, runContext);

    // Enviar los resultados a OpenAI
    await this.openai.beta.threads.runs.submitToolOutputs(
      threadId,
      runId,
      { tool_outputs }
    );
  }

  /**
   * Ejecuta enviar_pdf
   * @param {Object} args
   * @param {Object|null} runContext - Contexto del request actual
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
   * Procesa tool_calls
   * @param {Array} toolCalls - Lista de tool calls
   * @param {Object|null} runContext - Contexto del request actual
   * @returns {Array} - Tool outputs
   */
  async processToolCalls(toolCalls, runContext = null) {
    const tool_outputs = [];
    for (const toolCall of toolCalls) {
      const functionName = toolCall.function.name;
      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch (error) {
        args = {};
      }
      let output = null;

      if (functionName === 'enviar_pdf') {
        try {
          console.log('📄 Ejecutando enviar_pdf:', args);
          output = await this.executeEnviarPdf(args, runContext);
        } catch (error) {
          console.error('❌ Error en enviar_pdf:', error.message);
          output = { error: error.message || 'Error enviando PDF' };
        }
      } else {
        output = { error: `Función ${functionName} no implementada.` };
      }

      tool_outputs.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify(output)
      });
    }
    return tool_outputs;
  }

  /**
   * Obtiene la respuesta del asistente
   * @param {string} threadId - ID del thread
   * @returns {string} - Respuesta del asistente
   */
  async getAssistantResponse(threadId) {
    console.log('Run completado, obteniendo mensajes...');
    // Obtener la respuesta del assistant
    const messages = await this.openai.beta.threads.messages.list(threadId, {
      order: 'desc',
      limit: 1
    });
    
    // Verificar que el mensaje sea del asistente y tenga contenido
    const lastMsg = messages.data[0];
    if (lastMsg && lastMsg.role === "assistant" && lastMsg.content && lastMsg.content[0]) {
      const aiResponse = lastMsg.content[0].text.value;
      console.log('Respuesta del asistente:', aiResponse);
      return aiResponse;
    } else {
      console.error('No se encontró una respuesta válida del asistente');
      return "Lo siento, hubo un error procesando tu solicitud. ¿Podrías intentarlo de nuevo?";
    }
  }

  /**
   * Procesa un mensaje completo con OpenAI
   * @param {string} userId - ID del usuario
   * @param {string} message - Mensaje del usuario
   * @param {string} assistantId - ID del asistente a usar
   * @param {string} clientCode - Código del cliente (opcional, para threads)
   * @param {Object} context - Contexto para tools (instanceId, ultraMsgManager, documentStore)
   * @returns {string} - Respuesta del asistente
   */
  async processMessage(userId, message, assistantId, clientCode = 'default', context = {}) {
    // Obtener o crear thread para el usuario y cliente
    const threadId = await this.getOrCreateThread(userId, clientCode);

    // Verificar si hay un run activo
    if (this.hasActiveRun(threadId)) {
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

    // Agregar el mensaje al thread
    await this.addMessageToThread(threadId, message);

    // Obtener mensajes anteriores para contexto
    await this.getPreviousMessages(threadId, 5);

    const additionalInstructions = await this.buildDocumentsInstructions(
      clientCode,
      context.documentStore
    );

    // Crear y ejecutar el run con el asistente específico
    const run = await this.createRun(threadId, assistantId, additionalInstructions);

    // Esperar a que termine el run (pasa runContext a tool calls)
    const runStatusObj = await this.waitForRunCompletion(threadId, run.id, runContext);

    // Obtener respuesta del asistente
    if (runStatusObj.status === "completed") {
      return await this.getAssistantResponse(threadId);
    } else {
      console.error('El run falló o no se completó:', runStatusObj.status);
      if (runStatusObj.last_error) {
        console.error('Error del run:', runStatusObj.last_error);
      }
      return "Hubo un error procesando tu mensaje. Intenta de nuevo.";
    }
  }

  /**
   * Resetea todos los threads
   */
  resetThreads() {
    this.userThreads.clear();
    console.log('=== Threads reseteados ===');
  }

  /**
   * Resetea el thread de un usuario específico para un cliente específico
   * @param {string} userId - ID del usuario (número de teléfono)
   * @param {string} clientCode - Código del cliente
   * @returns {boolean} - True si se encontró y reseteó el thread
   */
  resetUserThread(userId, clientCode) {
    const threadKey = `${userId}_${clientCode}`;
    const hadThread = this.userThreads.has(threadKey);
    
    if (hadThread) {
      this.userThreads.delete(threadKey);
      console.log(`=== Thread reseteado para usuario: ${userId}, cliente: ${clientCode} ===`);
    } else {
      console.log(`=== No se encontró thread para usuario: ${userId}, cliente: ${clientCode} ===`);
    }
    
    return hadThread;
  }

  /**
   * Resetea todos los threads de un usuario específico (para todos los clientes)
   * @param {string} userId - ID del usuario (número de teléfono)
   * @returns {number} - Número de threads reseteados
   */
  resetAllUserThreads(userId) {
    let resetCount = 0;
    const threadsToDelete = [];
    
    // Encontrar todos los threads del usuario
    for (const [threadKey, threadId] of this.userThreads.entries()) {
      if (threadKey.startsWith(`${userId}_`)) {
        threadsToDelete.push(threadKey);
      }
    }
    
    // Eliminar los threads encontrados
    threadsToDelete.forEach(threadKey => {
      this.userThreads.delete(threadKey);
      resetCount++;
    });
    
    console.log(`=== ${resetCount} threads reseteados para usuario: ${userId} ===`);
    return resetCount;
  }

  /**
   * Obtiene información de todos los threads activos
   * @returns {Array} - Lista de threads con información
   */
  getAllThreadsInfo() {
    const threadsInfo = [];
    
    for (const [threadKey, threadId] of this.userThreads.entries()) {
      const [userId, clientCode] = threadKey.split('_');
      threadsInfo.push({
        threadKey,
        threadId,
        userId,
        clientCode,
        hasActiveRun: this.hasActiveRun(threadId)
      });
    }
    
    return threadsInfo;
  }
}

module.exports = OpenAIManager;