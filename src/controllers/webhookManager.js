class WebhookManager {
  constructor(ultraMsgManager, openAIManager, confirmationManager, userContextManager) {
    this.ultraMsgManager = ultraMsgManager;
    this.openAIManager = openAIManager;
    this.confirmationManager = confirmationManager;
    this.userContextManager = userContextManager;
    
    // Cache para mensajes procesados
    this.processedMessages = new Set();
  }

  /**
   * Verifica el token del webhook
   * @param {string} token - Token recibido
   * @returns {boolean} - True si el token es válido
   */
  verifyWebhookToken(token) {
    return token === process.env.ULTRAMSG_WEBHOOK_TOKEN;
  }

  /**
   * Verifica si un mensaje ya fue procesado
   * @param {string} messageId - ID del mensaje
   * @returns {boolean} - True si ya fue procesado
   */
  isMessageProcessed(messageId) {
    return this.processedMessages.has(messageId);
  }

  /**
   * Marca un mensaje como procesado
   * @param {string} messageId - ID del mensaje
   */
  markMessageAsProcessed(messageId) {
    this.processedMessages.add(messageId);
    
    // Limpiar mensajes antiguos (mantener solo los últimos 1000)
    if (this.processedMessages.size > 1000) {
      const oldestMessages = Array.from(this.processedMessages).slice(0, this.processedMessages.size - 1000);
      oldestMessages.forEach(id => this.processedMessages.delete(id));
    }
  }

  /**
   * Procesa un mensaje de confirmación
   * @param {string} userId - ID del usuario
   * @param {string} message - Mensaje del usuario
   * @returns {boolean} - True si se procesó como confirmación
   */
  async processConfirmationMessage(userId, message) {
    const userCtx = this.userContextManager.getUserContext(userId);
    const isConfirmation = this.confirmationManager.isConfirmationMessage(message);
    
    console.log('Mensaje del usuario:', message);
    console.log('¿Es confirmación?', isConfirmation);
    console.log('Contexto del usuario:', userCtx);
    
    // Si es un mensaje de confirmación y estamos esperando confirmación, responder sin procesar con IA
    if (isConfirmation && userCtx.isWaitingForConfirmation) {
      console.log('Mensaje de confirmación detectado, respondiendo automáticamente');
      
      const confirmationResponse = this.confirmationManager.getConfirmationResponse();
      
      try {
        console.log('Enviando respuesta de confirmación a UltraMsg');
        
        const response = await this.ultraMsgManager.sendMessage(userId, confirmationResponse);
        console.log('Respuesta de confirmación enviada:', response);
        
        // Actualizar contexto del usuario
        this.userContextManager.updateUserContext(userId, 'confirmation', message);
        
        return true;
      } catch (error) {
        console.error('Error al enviar respuesta de confirmación:', error.response?.data || error.message);
        throw error;
      }
    }
    
    // Si es confirmación pero no estamos esperando confirmación, procesar normalmente
    if (isConfirmation) {
      this.userContextManager.updateUserContext(userId, 'confirmation', message);
    }

    return false;
  }

  /**
   * Verifica si un mensaje viene de un grupo de WhatsApp
   * @param {Object} messageData - Datos del mensaje de UltraMsg
   * @returns {boolean} - True si es un mensaje de grupo
   */
  isGroupMessage(messageData) {
    // Verificar si el from termina en @g.us (grupo) o contiene información de grupo
    return messageData.from && (
      messageData.from.endsWith('@g.us') || 
      messageData.chat?.isGroup === true ||
      (messageData.chat && messageData.chat.id && messageData.chat.id.endsWith('@g.us'))
    );
  }

  /**
   * Extrae información del grupo si el mensaje viene de un grupo
   * @param {Object} messageData - Datos del mensaje de UltraMsg
   * @returns {Object|null} - Información del grupo o null si no es grupo
   */
  extractGroupInfo(messageData) {
    if (!this.isGroupMessage(messageData)) {
      return null;
    }
    
    return {
      groupId: messageData.from,
      groupName: messageData.chat?.name || 'Grupo sin nombre',
      author: messageData.author || messageData.from.split('@')[0],
      isGroup: true
    };
  }

  /**
   * Procesa un mensaje completo
   * @param {Object} messageData - Datos del mensaje de UltraMsg
   * @returns {string} - Respuesta del asistente
   */
  async processMessage(messageData) {
    // Verificar si es un mensaje de grupo
    if (this.isGroupMessage(messageData)) {
      const groupInfo = this.extractGroupInfo(messageData);
      console.log('📱 Mensaje recibido de GRUPO:', groupInfo.groupName);
      console.log('👤 Autor del mensaje:', groupInfo.author);
      console.log('❌ Ignorando mensaje de grupo (configuración actual)');
      return null; // No procesar mensajes de grupo
    }

    const from = messageData.from.replace('@c.us', '');
    const msg_body = messageData.body;

    // Verificar si es un mensaje de confirmación
    const isConfirmationProcessed = await this.processConfirmationMessage(from, msg_body);
    if (isConfirmationProcessed) {
      return null; // Ya se procesó como confirmación
    }

    // Procesar con OpenAI
    const aiResponse = await this.openAIManager.processMessage(from, msg_body);
    
    // Enviar respuesta via UltraMsg
    try {
      console.log('Enviando mensaje via UltraMsg a:', from);
      console.log('Mensaje:', aiResponse);
      
      const response = await this.ultraMsgManager.sendMessage(from, aiResponse);
      console.log('Respuesta de UltraMsg:', response);
      
      return aiResponse;
    } catch (error) {
      console.error('Error al enviar mensaje via UltraMsg:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Maneja una petición de webhook
   * @param {Object} body - Cuerpo de la petición
   * @returns {Object} - Resultado del procesamiento
   */
  async handleWebhook(body) {
    console.log('=== Nueva petición recibida de UltraMsg ===');
    
    // Verificar si es un mensaje de UltraMsg
    if (body && body.data && body.data.body) {
      const message = body.data;
      console.log('Mensaje recibido de:', message.from);
      console.log('ID del mensaje:', message.id);
      
      // Verificar si ya procesamos este mensaje
      if (this.isMessageProcessed(message.id)) {
        console.log('Mensaje ya procesado, ignorando:', message.id);
        return { processed: false, reason: 'already_processed' };
      }

      // Marcar mensaje como procesado ANTES de procesarlo
      this.markMessageAsProcessed(message.id);

      // Verificar si es un mensaje de texto
      if (body.event_type === 'message_create') {
        console.log('Mensaje no es de tipo texto, ignorando');
        return { processed: false, reason: 'not_text_message' };
      }

      // Procesar el mensaje
      const response = await this.processMessage(message);
      
      // Si el mensaje fue ignorado (grupo), marcar como procesado pero sin respuesta
      if (response === null && this.isGroupMessage(message)) {
        return { 
          processed: true, 
          response: null,
          userId: message.from.replace('@c.us', ''),
          reason: 'group_message_ignored'
        };
      }
      
      return { 
        processed: true, 
        response: response,
        userId: message.from.replace('@c.us', '')
      };
    }

    return { processed: false, reason: 'invalid_message_format' };
  }
}

module.exports = WebhookManager; 