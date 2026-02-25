const CommandManager = require('../services/commandManager');
const OwnSystemManager = require('../managers/ownSystemManager');

class WebhookManager {
  constructor(ultraMsgManager, openAIManager, confirmationManager, userContextManager) {
    this.ultraMsgManager = ultraMsgManager;
    this.ownSystemManager = new OwnSystemManager();
    this.openAIManager = openAIManager;
    this.confirmationManager = confirmationManager;
    this.userContextManager = userContextManager;
    this.commandManager = new CommandManager();
    
    // Cache para mensajes procesados
    this.processedMessages = new Set();
  }

  /**
   * Verifica el token del webhook
   * @param {string} token - Token recibido
   * @returns {boolean} - True si el token es válido
   */
  verifyWebhookToken(token) {
    // Verificar token por defecto desde variables de entorno
    if (token === process.env.ULTRAMSG_WEBHOOK_TOKEN) {
      return true;
    }
    
    // Verificar tokens de las instancias configuradas
    for (const [instanceId, instance] of this.ultraMsgManager.instances) {
      if (instance.webhookToken && token === instance.webhookToken) {
        return true;
      }
    }
    
    // Verificar tokens de instancias adicionales desde variables de entorno (fallback)
    let instanceIndex = 1;
    while (true) {
      const webhookToken = process.env[`ULTRAMSG_INSTANCE_${instanceIndex}_WEBHOOK_TOKEN`];
      if (!webhookToken) {
        break;
      }
      if (token === webhookToken) {
        return true;
      }
      instanceIndex++;
    }
    
    return false;
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

  normalizeAssistantPhoneFromOwnTo(toJidWithDevice = '') {
    // Ej: "5216181020927:21@s.whatsapp.net" -> "5216181020927"
    const beforeColon = String(toJidWithDevice).split(':')[0];
    return beforeColon.split('@')[0];
  }

  normalizeFromPhoneFromJid(jid = '') {
    // Ej: "5216188329894@s.whatsapp.net" -> "5216188329894"
    return String(jid).split('@')[0];
  }

  _formatSendErrorLog(origin, to, messagePreview, error) {
    const maxLen = 60;
    const msg = typeof messagePreview === 'string' && messagePreview.length > maxLen ? messagePreview.slice(0, maxLen) + '…' : (messagePreview || '');
    const toStr = (to || '?').toString().replace('@c.us', '');
    const errMsg = typeof error === 'string' ? error : (error?.response?.data?.message || error?.message || error?.response?.data || JSON.stringify(error));
    return `Origen: ${origin} | Para: ${toStr} | Mensaje: "${msg}" | Estado: Error | Error: ${errMsg}`;
  }

  isGroupJid(jid = '') {
    return String(jid).endsWith('@g.us');
  }

  /**
   * Procesa un mensaje de confirmación
   * @param {string} userId - ID del usuario
   * @param {string} message - Mensaje del usuario
   * @param {Function} sendReply - Función para enviar reply: (text) => Promise<void>
   * @returns {boolean} - True si se procesó como confirmación
   */
  async processConfirmationMessage(userId, message, sendReply, origin = 'UltraMsg') {
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
        await sendReply(confirmationResponse);
        
        // Actualizar contexto del usuario
        this.userContextManager.updateUserContext(userId, 'confirmation', message);
        
        return true;
      } catch (error) {
        console.error('❌ ' + this._formatSendErrorLog(origin, userId, confirmationResponse, error));
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
   * Identifica qué instancia de UltraMsg envió el mensaje
   * @param {Object} messageData - Datos del mensaje de UltraMsg
   * @param {string} webhookToken - Token del webhook recibido
   * @returns {string|null} - ID de la instancia o null si no se puede identificar
   */
  identifyInstanceFromMessage(messageData, webhookToken = null) {
    // Si tenemos el token del webhook, identificar por él
    if (webhookToken) {
      for (const [instanceId, instance] of this.ultraMsgManager.instances) {
        if (instance.webhookToken && webhookToken === instance.webhookToken) {
          return instanceId;
        }
      }
    }
    
    // Intentar identificar por el número de teléfono del asistente
    const assistantPhone = messageData.to || messageData.from;
    
    // Buscar en todas las instancias configuradas
    for (const [instanceId, instance] of this.ultraMsgManager.instances) {
      // Aquí podrías implementar lógica más específica para identificar la instancia
      // Por ahora, usaremos la instancia por defecto
      if (assistantPhone.split('@')[0] === instance.assistantPhone.split('@')[0]) {
        return instanceId;
      }
    }
    
    // Si no se puede identificar, usar la instancia por defecto
    return this.ultraMsgManager.getDefaultInstance()?.instanceId || null;
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
   * @param {string} webhookToken - Token del webhook (opcional)
   * @returns {string} - Respuesta del asistente
   */
  async processMessage(messageData, webhookToken = null) {
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

    // Detectar automáticamente el cliente basándose en el número de teléfono del asistente
    // El número de teléfono del asistente es el "to" en el mensaje de UltraMsg
    const assistantPhone = messageData.to || messageData.from; // Fallback al from si no hay to
    const clientId = await this.commandManager.getClientByAssistantPhone(assistantPhone);

    // Si tenemos cliente, comprobar blacklist: no responder a números bloqueados
    if (clientId) {
      const blacklisted = await this.commandManager.isPhoneBlacklisted(clientId, from);
      if (blacklisted) {
        console.log('🚫 Mensaje ignorado (blacklist):', from, 'cliente:', clientId);
        return null;
      }
    }

    // Usar la instancia del cliente detectado (mismo número que recibió el mensaje),
    // no el token del webhook, para que cada bot responda por su propio teléfono
    const sendReplyUltra = async (text, preferredClientId = null) => {
      const instanceId = (preferredClientId && this.ultraMsgManager.getInstanceIdByClientId(preferredClientId))
        || this.identifyInstanceFromMessage(messageData, webhookToken);
      const response = await this.ultraMsgManager.sendMessage(from, text, instanceId, { requestOrigin: 'UltraMsg' });
    };

    // Verificar si es un comando
    const commandResult = await this.commandManager.processMessage(msg_body, from);
    if (commandResult.isCommand) {
      console.log('🎮 Comando ejecutado:', commandResult.command, 'para cliente:', commandResult.clientId);
      
      // Enviar respuesta del comando por WhatsApp
      try {
        await sendReplyUltra(commandResult.response, clientId);
        
        return commandResult.response;
      } catch (error) {
        console.error('❌ ' + this._formatSendErrorLog('UltraMsg', from, commandResult.response, error));
        throw error;
      }
    }

    // Verificar si es un mensaje de confirmación
    const sendReplyUltraWithClient = (text) => sendReplyUltra(text, clientId);
    const isConfirmationProcessed = await this.processConfirmationMessage(from, msg_body, sendReplyUltraWithClient, 'UltraMsg');
    if (isConfirmationProcessed) {
      return null; // Ya se procesó como confirmación
    }

    if (!clientId) {
      console.log('❌ No se pudo identificar el cliente para el número:', assistantPhone);
      return "❌ Error: No se pudo identificar el consultorio. Contacta al administrador.";
    }
    
    console.log('🏥 Cliente detectado:', clientId, 'para número:', assistantPhone);
    
    // Verificar si el bot está activo para este cliente
    if (!this.commandManager.isBotActive(clientId)) {
      console.log('🤖 Bot inactivo para cliente:', clientId);
      return "🤖 Bot está apagado. Escribe #" + clientId + " /on para encenderlo.";
    }
    
    // Obtener el ID del asistente para este cliente
    const assistantId = await this.commandManager.getAssistantIdByPhone(assistantPhone);
    if (!assistantId) {
      console.log('❌ No se encontró el asistente para el cliente:', clientId);
      return "❌ Error: No se pudo identificar el asistente. Contacta al administrador.";
    }
    
    console.log('🤖 Usando asistente:', assistantId, 'para cliente:', clientId);

    // Procesar con OpenAI usando el asistente específico del cliente
    const aiResponse = await this.openAIManager.processMessage(from, msg_body, assistantId, clientId);
    
    // Enviar respuesta via UltraMsg usando la instancia correcta
    try {
      await sendReplyUltra(aiResponse, clientId);
      
      return aiResponse;
    } catch (error) {
      console.error('❌ ' + this._formatSendErrorLog('UltraMsg', from, aiResponse, error));
      throw error;
    }
  }

  /**
   * Maneja una petición de webhook desde tu plataforma propia
   * @param {Object} body - Cuerpo de la petición (type=message.inbound)
   * @returns {Object} - Resultado del procesamiento
   */
  async handleOwnWebhook(body) {
    // Formato esperado (ejemplo):
    // {
    //   type: "message.inbound",
    //   tenantId, deviceId,
    //   normalized: { to, from, content: { text, type }, messageId }
    // }
    if (!body || body.type !== 'message.inbound' || !body.normalized) {
      return { processed: false, reason: 'invalid_message_format' };
    }

    const messageId = body.normalized.messageId;
    if (!messageId) {
      return { processed: false, reason: 'missing_message_id' };
    }

    const dedupeKey = `own:${messageId}`;
    if (this.isMessageProcessed(dedupeKey)) {
      console.log('Mensaje own ya procesado, ignorando:', messageId);
      return { processed: false, reason: 'already_processed' };
    }

    this.markMessageAsProcessed(dedupeKey);

    const tenantId = body.tenantId;
    const deviceId = body.deviceId;
    const normalized = body.normalized;

    const fromJid = normalized.from;
    const toRaw = normalized.to;
    const assistantPhone = this.normalizeAssistantPhoneFromOwnTo(toRaw);
    const fromPhone = this.normalizeFromPhoneFromJid(fromJid);
    const text = normalized?.content?.text;
    const contentType = normalized?.content?.type;

    if (!tenantId || !deviceId) {
      return { processed: false, reason: 'missing_tenant_or_device' };
    }

    // Ignorar grupos
    if (this.isGroupJid(fromJid)) {
      return {
        processed: true,
        response: null,
        userId: fromPhone,
        reason: 'group_message_ignored'
      };
    }

    // Resolver cliente por el número del asistente (normalized.to -> antes de :)
    const clientId = await this.commandManager.getClientByAssistantPhone(assistantPhone);
    if (!clientId) {
      console.log('❌ No se pudo identificar el cliente para assistantPhone:', assistantPhone, 'to:', toRaw);
      return { processed: false, reason: 'client_not_found' };
    }

    // Comprobar blacklist: no responder a números bloqueados
    const blacklisted = await this.commandManager.isPhoneBlacklisted(clientId, fromPhone);
    if (blacklisted) {
      console.log('🚫 Mensaje ignorado (blacklist):', fromPhone, 'cliente:', clientId);
      return { processed: true, response: null, userId: fromPhone, reason: 'blacklisted' };
    }

    const client = this.commandManager.clientConfig?.[clientId];
    if (!client) {
      return { processed: false, reason: 'client_config_missing' };
    }

    if (!client.OWN_SYSTEM) {
      // Este endpoint se usa solo para clientes migrados; si llega aquí, no hacemos fallback.
      return { processed: false, reason: 'client_not_own_system' };
    }

    const apiKey = client.OWN_API_KEY;
    if (!apiKey) {
      return { processed: false, reason: 'missing_own_api_key' };
    }

    const sendReplyOwn = async (replyText) => {
      console.log('Enviando mensaje via OwnSystem a:', fromJid);
      console.log('Mensaje:', replyText);
      const resp = await this.ownSystemManager.sendMessage({
        deviceId,
        tenantId,
        apiKey,
        to: fromJid,
        text: replyText
      });
      console.log('Respuesta OwnSystem:', resp);
    };

    // Solo soporta texto por ahora: si es imagen/audio/documento/etc., avisar y marcar como procesado
    if (contentType !== 'text' || !text) {
      console.log('📎 Mensaje no textual (own system) — body completo para revisión:', JSON.stringify(body, null, 2));
      try {
        await sendReplyOwn('Por ahora solo puedo responder a mensajes de texto. Escribe tu consulta.');
      } catch (err) {
        console.error('Error enviando aviso de mensaje no textual:', err.message);
      }
      return { processed: true, response: null, userId: fromPhone, reason: 'not_text_message' };
    }

    // Verificar si es un comando
    const commandResult = await this.commandManager.processMessage(text, fromPhone);
    if (commandResult.isCommand) {
      try {
        await sendReplyOwn(commandResult.response);
        return { processed: true, response: commandResult.response, userId: fromPhone };
      } catch (error) {
        console.error('❌ ' + this._formatSendErrorLog('Mi sistema', fromPhone, commandResult.response, error));
        throw error;
      }
    }

    // Verificar si es confirmación
    const isConfirmationProcessed = await this.processConfirmationMessage(fromPhone, text, sendReplyOwn, 'Mi sistema');
    if (isConfirmationProcessed) {
      return { processed: true, response: null, userId: fromPhone };
    }

    console.log('🏥 Cliente detectado (own):', clientId, 'para assistantPhone:', assistantPhone);

    // Verificar si el bot está activo para este cliente
    if (!this.commandManager.isBotActive(clientId)) {
      const offMsg = "🤖 Bot está apagado. Escribe #" + clientId + " /on para encenderlo.";
      await sendReplyOwn(offMsg);
      return { processed: true, response: offMsg, userId: fromPhone };
    }

    // Obtener el ID del asistente para este cliente
    const assistantId = await this.commandManager.getAssistantIdByPhone(assistantPhone);
    if (!assistantId) {
      const errMsg = "❌ Error: No se pudo identificar el asistente. Contacta al administrador.";
      await sendReplyOwn(errMsg);
      return { processed: true, response: errMsg, userId: fromPhone };
    }

    console.log('🤖 Usando asistente (own):', assistantId, 'para cliente:', clientId);

    const aiResponse = await this.openAIManager.processMessage(fromPhone, text, assistantId, clientId);
    await sendReplyOwn(aiResponse);

    return { processed: true, response: aiResponse, userId: fromPhone };
  }

  /**
   * Maneja una petición de webhook
   * @param {Object} body - Cuerpo de la petición
   * @param {string} webhookToken - Token del webhook (opcional)
   * @returns {Object} - Resultado del procesamiento
   */
  async handleWebhook(body, webhookToken = null) {
    // Verificar si es un mensaje de UltraMsg
    if (body && body.data && body.data.body) {
      const message = body.data;
      console.log('Mensaje recibido de:', message.from);
      console.log('ID del mensaje:', message.id);
      
      // Verificar si ya procesamos este mensaje
      const dedupeKey = `ultra:${message.id}`;
      if (this.isMessageProcessed(dedupeKey)) {
        console.log('Mensaje ya procesado, ignorando:', message.id);
        return { processed: false, reason: 'already_processed' };
      }

      // Marcar mensaje como procesado ANTES de procesarlo
      this.markMessageAsProcessed(dedupeKey);

      // Verificar si es un mensaje de texto
      if (body.event_type === 'message_create') {
        console.log('Mensaje no es de tipo texto, ignorando');
        return { processed: false, reason: 'not_text_message' };
      }

      // Procesar el mensaje con el token del webhook para identificación
      const response = await this.processMessage(message, webhookToken);
      
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