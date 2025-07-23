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
   * Crea y ejecuta un run
   * @param {string} threadId - ID del thread
   * @param {string} assistantId - ID del asistente a usar
   * @returns {Object} - Run creado
   */
  async createRun(threadId, assistantId) {
    console.log('Creando run con asistente:', assistantId);
    const run = await this.openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId
    });
    console.log('Run creado:', run.id);
    
    // Guardar estado del run como in_progress
    this.threadRuns.set(threadId, 'in_progress');
    
    return run;
  }

  /**
   * Espera a que termine un run
   * @param {string} threadId - ID del thread
   * @param {string} runId - ID del run
   * @returns {Object} - Estado final del run
   */
  async waitForRunCompletion(threadId, runId) {
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
        await this.handleRequiredAction(runStatusObj, threadId, runId);
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
   */
  async handleRequiredAction(runStatus, threadId, runId) {
    const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
    const tool_outputs = await this.processToolCalls(toolCalls);

    // Enviar los resultados a OpenAI
    await this.openai.beta.threads.runs.submitToolOutputs(
      threadId,
      runId,
      { tool_outputs }
    );
  }

  /**
   * Procesa tool_calls
   * @param {Array} toolCalls - Lista de tool calls
   * @returns {Array} - Tool outputs
   */
  async processToolCalls(toolCalls) {
    const tool_outputs = [];
    for (const toolCall of toolCalls) {
      const functionName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);
      let output = null;

      // Por ahora no hay funciones implementadas
      output = { error: `Función ${functionName} no implementada.` };

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
   * @returns {string} - Respuesta del asistente
   */
  async processMessage(userId, message, assistantId, clientCode = 'default') {
    // Obtener o crear thread para el usuario y cliente
    const threadId = await this.getOrCreateThread(userId, clientCode);

    // Verificar si hay un run activo
    if (this.hasActiveRun(threadId)) {
      throw new Error('Por favor espera a que termine la respuesta anterior.');
    }
    
    // Agregar el mensaje al thread
    await this.addMessageToThread(threadId, message);

    // Obtener mensajes anteriores para contexto
    await this.getPreviousMessages(threadId, 5);

    // Crear y ejecutar el run con el asistente específico
    const run = await this.createRun(threadId, assistantId);

    // Esperar a que termine el run
    const runStatusObj = await this.waitForRunCompletion(threadId, run.id);

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
}

module.exports = OpenAIManager; 