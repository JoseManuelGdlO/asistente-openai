const CommandManager = require('../services/commandManager');
const DocumentStore = require('../services/documentStore');
const OwnSystemManager = require('../managers/ownSystemManager');

class WebhookManager {
  constructor(ultraMsgManager, openAIManager, confirmationManager, userContextManager, documentStore = null) {
    this.ultraMsgManager = ultraMsgManager;
    this.ownSystemManager = new OwnSystemManager();
    this.openAIManager = openAIManager;
    this.confirmationManager = confirmationManager;
    this.userContextManager = userContextManager;
    this.documentStore = documentStore || new DocumentStore();
    this.commandManager = new CommandManager(
      this.documentStore,
      openAIManager?.firebaseService || null
    );
  }

  get firebaseService() {
    return this.openAIManager.firebaseService;
  }

  /**
   * Dedup compartido: claim → fn → completed; si fn lanza, libera el claim
   * @param {string} key
   * @param {Function} fn
   * @returns {Promise<Object>}
   */
  async withWebhookDedup(key, fn) {
    const claimed = await this.firebaseService.tryClaimWebhookMessage(key);
    if (!claimed) {
      console.log('Mensaje ya procesado, ignorando:', key);
      return { processed: false, reason: 'already_processed' };
    }

    try {
      const result = await fn();
      await this.firebaseService.markWebhookMessageCompleted(key);
      return result;
    } catch (error) {
      try {
        await this.firebaseService.releaseWebhookMessage(key);
      } catch (releaseError) {
        console.error('Error liberando claim de webhook:', releaseError.message);
      }
      throw error;
    }
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
    return Boolean(
      messageData.from && (
        messageData.from.endsWith('@g.us') ||
        messageData.chat?.isGroup === true ||
        (messageData.chat && messageData.chat.id && messageData.chat.id.endsWith('@g.us'))
      )
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
   * Detecta si el mensaje trae un documento/media
   * @param {Object} messageData
   * @returns {boolean}
   */
  isDocumentMessage(messageData) {
    const type = (messageData.type || messageData.message_type || '').toLowerCase();
    return type === 'document' || Boolean(messageData.media && messageData.filename);
  }

  /**
   * Extrae URL/filename/mime del adjunto UltraMsg
   * @param {Object} messageData
   * @returns {{mediaUrl: string|null, mediaFilename: string, mediaMime: string}}
   */
  extractMediaInfo(messageData) {
    return {
      mediaUrl: messageData.media || messageData.document || null,
      mediaFilename: messageData.filename || messageData.fileName || '',
      mediaMime: messageData.mimetype || messageData.mime_type || messageData.mediaType || ''
    };
  }

  /**
   * Resuelve instanceId para un clientId / mensaje
   */
  resolveInstanceId(clientId, messageData, webhookToken) {
    let instanceId = clientId
      ? this.ultraMsgManager.getInstanceIdByClientId(clientId)
      : null;
    if (!instanceId) {
      instanceId = this.identifyInstanceFromMessage(messageData, webhookToken);
    }
    return instanceId;
  }

  /**
   * Envía un aviso de negocio por UltraMsg; si el send falla, relanza
   * @param {Function} sendReply
   * @param {string} from
   * @param {string} text
   * @param {string|null} preferredClientId
   */
  async sendUltraNotice(sendReply, from, text, preferredClientId = null) {
    try {
      await sendReply(text, preferredClientId);
    } catch (error) {
      console.error('❌ ' + this._formatSendErrorLog('UltraMsg', from, text, error));
      throw error;
    }
  }

  /**
   * Procesa un mensaje completo
   * @param {Object} messageData - Datos del mensaje de UltraMsg
   * @param {string} webhookToken - Token del webhook (opcional)
   * @returns {Promise<{response: string|null, reason: string}>}
   */
  async processMessage(messageData, webhookToken = null) {
    // Verificar si es un mensaje de grupo
    if (this.isGroupMessage(messageData)) {
      const groupInfo = this.extractGroupInfo(messageData);
      console.log('📱 Mensaje recibido de GRUPO:', groupInfo.groupName);
      console.log('👤 Autor del mensaje:', groupInfo.author);
      console.log('❌ Ignorando mensaje de grupo (configuración actual)');
      return { response: null, reason: 'group_message_ignored' };
    }

    const from = messageData.from.replace('@c.us', '');
    const msg_body = messageData.body || '';
    const hasDocument = this.isDocumentMessage(messageData);
    const mediaInfo = this.extractMediaInfo(messageData);

    // Detectar automáticamente el cliente basándose en el número de teléfono del asistente
    const assistantPhone = messageData.to || messageData.from;
    const clientId = await this.commandManager.getClientByAssistantPhone(assistantPhone);

    // Si tenemos cliente, comprobar blacklist: no responder a números bloqueados
    if (clientId) {
      const blacklisted = await this.commandManager.isPhoneBlacklisted(clientId, from);
      if (blacklisted) {
        console.log('[BLACKLIST] Mensaje ignorado por contacto bloqueado | origen: UltraMsg | teléfono:', from, '| id_empresa:', clientId);
        return { response: null, reason: 'blacklisted' };
      }
    }

    const sendReplyUltra = async (text, preferredClientId = null) => {
      const instanceId = this.resolveInstanceId(
        preferredClientId || clientId,
        messageData,
        webhookToken
      );
      console.log('📱 Usando instancia UltraMsg:', instanceId);
      console.log('Enviando mensaje via UltraMsg a:', from);
      console.log('Mensaje:', text);
      const response = await this.ultraMsgManager.sendMessage(from, text, instanceId, {
        requestOrigin: 'UltraMsg'
      });
      console.log('Respuesta de UltraMsg:', response);
    };

    // Preparar contexto de media para comandos /upload
    let mediaContext = {};
    if (hasDocument && mediaInfo.mediaUrl) {
      try {
        console.log('📎 Descargando documento adjunto:', mediaInfo.mediaFilename || mediaInfo.mediaUrl);
        const mediaBuffer = await this.ultraMsgManager.downloadMedia(mediaInfo.mediaUrl);
        mediaContext = {
          mediaBuffer,
          mediaFilename: mediaInfo.mediaFilename,
          mediaMime: mediaInfo.mediaMime
        };
      } catch (error) {
        console.error('❌ Error descargando adjunto:', error.message);
        if (this.commandManager.isCommand(msg_body)) {
          const failMsg = '❌ No se pudo descargar el archivo adjunto. Intenta de nuevo.';
          await this.sendUltraNotice(sendReplyUltra, from, failMsg, clientId);
          return { response: failMsg, reason: 'media_download_failed' };
        }
      }
    }

    // Verificar si es un comando (texto o caption de documento)
    const commandResult = await this.commandManager.processMessage(msg_body, from, mediaContext);
    if (commandResult.isCommand) {
      console.log('🎮 Comando ejecutado:', commandResult.command, 'para cliente:', commandResult.clientId);

      await this.sendUltraNotice(
        sendReplyUltra,
        from,
        commandResult.response,
        commandResult.clientId || clientId
      );
      return { response: commandResult.response, reason: 'command' };
    }

    // Documentos sin comando de admin: no se procesan con IA en esta fase
    if (hasDocument) {
      console.log('📎 Documento recibido sin comando /upload; ignorando para el asistente');
      return { response: null, reason: 'document_ignored' };
    }

    // Sin cuerpo de texto no hay nada que procesar
    if (!msg_body || !String(msg_body).trim()) {
      console.log('Mensaje vacío, ignorando');
      return { response: null, reason: 'empty_message' };
    }

    // Verificar si es un mensaje de confirmación
    const sendReplyUltraWithClient = (text) => sendReplyUltra(text, clientId);
    const isConfirmationProcessed = await this.processConfirmationMessage(from, msg_body, sendReplyUltraWithClient, 'UltraMsg');
    if (isConfirmationProcessed) {
      return { response: null, reason: 'confirmation_processed' };
    }

    if (!clientId) {
      console.log('❌ No se pudo identificar el cliente para el número:', assistantPhone);
      const errMsg = '❌ Error: No se pudo identificar el consultorio. Contacta al administrador.';
      await this.sendUltraNotice(sendReplyUltra, from, errMsg);
      return { response: errMsg, reason: 'client_not_found' };
    }
    
    console.log('🏥 Cliente detectado:', clientId, 'para número:', assistantPhone);
    
    // Verificar si el bot está activo para este cliente
    if (!this.commandManager.isBotActive(clientId)) {
      console.log('🤖 Bot inactivo para cliente:', clientId);
      const offMsg = '🤖 Bot está apagado. Escribe #' + clientId + ' /on para encenderlo.';
      await this.sendUltraNotice(sendReplyUltra, from, offMsg, clientId);
      return { response: offMsg, reason: 'bot_inactive' };
    }
    
    // Verificar par 1:1 Assistants/{clientId}
    const assistantConfig = await this.commandManager.getAssistantConfig(clientId);
    if (!assistantConfig) {
      console.log('❌ No se encontró Assistant Firestore para el cliente:', clientId);
      const errMsg = '❌ Error: Configuración del asistente incompleta. Contacta al administrador.';
      await this.sendUltraNotice(sendReplyUltra, from, errMsg, clientId);
      return { response: errMsg, reason: 'assistant_missing' };
    }
    
    console.log('🤖 Usando Assistant Firestore para cliente:', clientId);

    const instanceId = this.resolveInstanceId(clientId, messageData, webhookToken);
    console.log('📱 Usando instancia UltraMsg:', instanceId, '(cliente:', clientId + ')');

    // Procesar con Responses API (tools encolan PDFs; sendReply va antes del flush)
    const aiResponse = await this.openAIManager.processMessage(from, msg_body, clientId, {
      instanceId,
      ultraMsgManager: this.ultraMsgManager,
      documentStore: this.documentStore,
      sendReply: async (text) => {
        await this.sendUltraNotice(sendReplyUltra, from, text, clientId);
      }
    });
    
    return { response: aiResponse, reason: 'ai_reply' };
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

    return this.withWebhookDedup(`own:${messageId}`, async () => {
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
        console.log('[BLACKLIST] Mensaje ignorado por contacto bloqueado | origen: OwnSystem | teléfono:', fromPhone, '| id_empresa:', clientId);
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
          return { processed: true, response: commandResult.response, userId: fromPhone, reason: 'command' };
        } catch (error) {
          console.error('❌ ' + this._formatSendErrorLog('Mi sistema', fromPhone, commandResult.response, error));
          throw error;
        }
      }

      // Verificar si es confirmación
      const isConfirmationProcessed = await this.processConfirmationMessage(fromPhone, text, sendReplyOwn, 'Mi sistema');
      if (isConfirmationProcessed) {
        return { processed: true, response: null, userId: fromPhone, reason: 'confirmation_processed' };
      }

      console.log('🏥 Cliente detectado (own):', clientId, 'para assistantPhone:', assistantPhone);

      // Verificar si el bot está activo para este cliente
      if (!this.commandManager.isBotActive(clientId)) {
        const offMsg = "🤖 Bot está apagado. Escribe #" + clientId + " /on para encenderlo.";
        await sendReplyOwn(offMsg);
        return { processed: true, response: offMsg, userId: fromPhone, reason: 'bot_inactive' };
      }

      // Verificar par 1:1 Assistants/{clientId}
      const assistantConfig = await this.commandManager.getAssistantConfig(clientId);
      if (!assistantConfig) {
        console.log('❌ No se encontró Assistant Firestore para el cliente (own):', clientId);
        const errMsg = "❌ Error: Configuración del asistente incompleta. Contacta al administrador.";
        await sendReplyOwn(errMsg);
        return { processed: true, response: errMsg, userId: fromPhone, reason: 'assistant_missing' };
      }

      console.log('🤖 Usando Assistant Firestore (own) para cliente:', clientId);

      const aiResponse = await this.openAIManager.processMessage(fromPhone, text, clientId, {
        ultraMsgManager: this.ultraMsgManager,
        documentStore: this.documentStore,
        sendReply: async (textReply) => {
          await sendReplyOwn(textReply);
        }
      });

      return { processed: true, response: aiResponse, userId: fromPhone, reason: 'ai_reply' };
    });
  }

  /**
   * Maneja una petición de webhook
   * @param {Object} body - Cuerpo de la petición
   * @param {string} webhookToken - Token del webhook (opcional)
   * @returns {Object} - Resultado del procesamiento
   */
  async handleWebhook(body, webhookToken = null) {
    console.log('=== Nueva petición recibida de UltraMsg ===');
    
    // Aceptar mensajes con body (texto/caption) o con media (documento)
    const hasPayload = body && body.data && (body.data.body || body.data.media || body.data.type);
    if (!hasPayload) {
      return { processed: false, reason: 'invalid_message_format' };
    }

    const message = body.data;
    console.log('Mensaje recibido de:', message.from);
    console.log('ID del mensaje:', message.id);
    console.log('Tipo:', message.type || 'text');

    if (!message.id) {
      return { processed: false, reason: 'missing_message_id' };
    }

    return this.withWebhookDedup(`ultra:${message.id}`, async () => {
      if (body.event_type === 'message_create') {
        console.log('Mensaje no es de tipo texto, ignorando');
        return { processed: false, reason: 'not_text_message' };
      }

      const result = await this.processMessage(message, webhookToken);
      return {
        processed: true,
        response: result.response,
        userId: message.from.replace('@c.us', ''),
        reason: result.reason
      };
    });
  }
}

module.exports = WebhookManager; 