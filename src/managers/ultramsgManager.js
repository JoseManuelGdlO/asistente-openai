const axios = require('axios');
const FirebaseService = require('../services/firebaseService');
require('dotenv').config();

class UltraMsgManager {
  constructor() {
    this.instances = new Map();
    this.defaultInstance = null;
    this.firebaseService = new FirebaseService();
    this.initialized = false;
  }

  // Inicializar múltiples instancias de UltraMsg desde Firebase
  async initializeInstances(force = false) {
    if (this.initialized && !force) {
      return;
    }

    if (force) {
      this.instances.clear();
      this.defaultInstance = null;
      this.initialized = false;
    }

    try {
      console.log('🔄 Inicializando instancias UltraMsg desde Firebase...');
      
      // Obtener todos los clientes desde Firebase
      const clients = await this.firebaseService.getAllClients();
      
      // Configurar instancias basadas en los clientes de Firebase
      for (const [clientId, client] of Object.entries(clients)) {
        if (client.ULTRAMSG_TOKEN && client.ULTRAMSG_INSTANCE_ID) {
          const instance = {
            token: client.ULTRAMSG_TOKEN,
            instanceId: client.ULTRAMSG_INSTANCE_ID,
            name: client.name || `Cliente_${clientId}`,
            clientId: clientId,
            webhookToken: client.ULTRAMSG_WEBHOOK_TOKEN || client.ULTRAMSG_TOKEN,
            assistantPhone: client.assistantPhone
          };
          
          this.instances.set(client.ULTRAMSG_INSTANCE_ID, instance);
          console.log(`✅ Instancia UltraMsg configurada: ${instance.name} (${instance.instanceId})`);
        }
      }

      // Si no hay instancias de Firebase, usar variables de entorno como fallback
      if (this.instances.size === 0) {
        console.log('⚠️ No se encontraron instancias en Firebase, usando variables de entorno...');
        this.initializeFromEnv();
      }

      // Establecer instancia por defecto (la primera encontrada)
      if (this.instances.size > 0) {
        this.defaultInstance = Array.from(this.instances.values())[0];
      }

      console.log(`📱 Total de instancias UltraMsg configuradas: ${this.instances.size}`);
      this.initialized = true;
      
    } catch (error) {
      console.error('❌ Error inicializando instancias desde Firebase:', error);
      console.log('🔄 Usando configuración de variables de entorno como fallback...');
      this.initializeFromEnv();
    }
  }

  // Inicializar desde variables de entorno (fallback)
  initializeFromEnv() {
    // Instancia por defecto (para compatibilidad)
    const defaultToken = process.env.ULTRAMSG_TOKEN;
    const defaultInstanceId = process.env.ULTRAMSG_INSTANCE_ID;
    
    if (defaultToken && defaultInstanceId) {
      this.defaultInstance = {
        token: defaultToken,
        instanceId: defaultInstanceId,
        name: 'default'
      };
      this.instances.set(defaultInstanceId, this.defaultInstance);
    }

    // Buscar instancias adicionales en variables de entorno
    let instanceIndex = 1;
    while (true) {
      const token = process.env[`ULTRAMSG_INSTANCE_${instanceIndex}_TOKEN`];
      const instanceId = process.env[`ULTRAMSG_INSTANCE_${instanceIndex}_ID`];
      const name = process.env[`ULTRAMSG_INSTANCE_${instanceIndex}_NAME`] || `instance_${instanceIndex}`;
      
      if (!token || !instanceId) {
        break; // No hay más instancias
      }

      this.instances.set(instanceId, {
        token: token,
        instanceId: instanceId,
        name: name
      });

      console.log(`✅ Instancia UltraMsg configurada: ${name} (${instanceId})`);
      instanceIndex++;
    }

    if (this.instances.size === 0) {
      console.error('❌ No se encontraron instancias de UltraMsg configuradas');
    }
  }

  // Obtener instancia por ID
  getInstance(instanceId) {
    return this.instances.get(instanceId);
  }

  // Obtener todas las instancias
  getAllInstances() {
    return Array.from(this.instances.values());
  }

  // Obtener instancia por defecto
  getDefaultInstance() {
    return this.defaultInstance || Array.from(this.instances.values())[0];
  }

  /**
   * Obtiene el ID de instancia UltraMsg asociado a un cliente (por clientId de Firebase).
   * Así la respuesta siempre se envía por el mismo número que recibió el mensaje.
   * @param {string} clientId - ID del cliente en Firebase
   * @returns {string|null} - instanceId o null si no existe
   */
  getInstanceIdByClientId(clientId) {
    if (!clientId) return null;
    for (const [instanceId, instance] of this.instances) {
      if (instance.clientId === clientId) {
        return instanceId;
      }
    }
    return null;
  }

  /**
   * Formatea una línea de log legible para envío de mensajes.
   * @param {Object} opts - from (instancia), to, message, status ('sent'|'error'), error (opcional)
   * @param {string} origin - Origen: 'UltraMsg' | 'Mi sistema'
   * @returns {string}
   */
  _formatMessageLog(opts, origin = 'UltraMsg') {
    const maxLen = 60;
    const msgPreview = typeof opts.message === 'string'
      ? (opts.message.length > maxLen ? opts.message.slice(0, maxLen) + '…' : opts.message)
      : '';
    const from = opts.from || '?';
    const to = (opts.to || '?').toString().replace('@c.us', '');
    const parts = [`Origen: ${origin}`, `De: ${from}`, `Para: ${to}`, `Mensaje: "${msgPreview}"`, `Estado: ${opts.status === 'sent' ? 'Enviado' : 'Error'}`];
    if (opts.error) {
      const errMsg = typeof opts.error === 'string' ? opts.error : (opts.error?.message || opts.error?.response?.data?.message || JSON.stringify(opts.error?.response?.data || opts.error));
      parts.push(`Error: ${errMsg}`);
    }
    return parts.join(' | ');
  }

  // Enviar mensaje usando una instancia específica
  // options: { requestOrigin?: 'UltraMsg' | 'Mi sistema' }
  async sendMessage(to, message, instanceId = null, options = {}) {
    const origin = options.requestOrigin || 'UltraMsg';
    try {
      const instance = instanceId ? this.getInstance(instanceId) : this.getDefaultInstance();
      
      if (!instance) {
        throw new Error(`No se encontró la instancia UltraMsg: ${instanceId || 'default'}`);
      }

      const url = `https://api.ultramsg.com/${instance.instanceId}/messages/chat?token=${instance.token}`;
      
      const data = {
        to: to,
        body: message,
        priority: 10,
        referenceId: '',
        msgId: ''
      };

      const response = await axios.post(url, data, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ ' + this._formatMessageLog({ from: instance.name, to, message, status: 'sent' }, origin));
      return {
        ...response.data,
        instanceName: instance.name,
        instanceId: instance.instanceId
      };
    } catch (error) {
      const instance = instanceId ? this.getInstance(instanceId) : this.getDefaultInstance();
      const errMsg = error.response?.data?.message || (typeof error.response?.data === 'object' ? (error.response?.data?.error || error.message) : (error.response?.data || error.message));
      console.error('❌ ' + this._formatMessageLog({
        from: instance?.name,
        to,
        message,
        status: 'error',
        error: errMsg
      }, origin));
      throw error;
    }
  }

  /**
   * Envía un documento (PDF) por WhatsApp via UltraMsg
   * @param {string} to - Destinatario
   * @param {Object} options
   * @param {string} options.filename - Nombre del archivo (ej. lista_precios.pdf)
   * @param {string} options.document - URL HTTPS o base64 del archivo
   * @param {string} [options.caption] - Texto bajo el archivo
   * @param {string|null} instanceId
   */
  async sendDocument(to, { filename, document, caption = '' }, instanceId = null) {
    try {
      const instance = instanceId ? this.getInstance(instanceId) : this.getDefaultInstance();

      if (!instance) {
        throw new Error(`No se encontró la instancia UltraMsg: ${instanceId || 'default'}`);
      }

      if (!filename || !document) {
        throw new Error('filename y document son requeridos para enviar un documento');
      }

      const url = `https://api.ultramsg.com/${instance.instanceId}/messages/document?token=${instance.token}`;

      const data = {
        to,
        filename,
        document,
        caption: caption || '',
        priority: 10,
        referenceId: '',
        msgId: ''
      };

      const response = await axios.post(url, data, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log(`✅ Documento enviado via UltraMsg (${instance.name}):`, response.data);
      return {
        ...response.data,
        instanceName: instance.name,
        instanceId: instance.instanceId
      };
    } catch (error) {
      console.error('❌ Error enviando documento via UltraMsg:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Descarga media desde una URL (adjunto de UltraMsg)
   * @param {string} mediaUrl
   * @returns {Promise<Buffer>}
   */
  async downloadMedia(mediaUrl) {
    if (!mediaUrl || typeof mediaUrl !== 'string') {
      throw new Error('URL de media inválida');
    }

    try {
      const response = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 30 * 1024 * 1024
      });

      return Buffer.from(response.data);
    } catch (error) {
      console.error('❌ Error descargando media:', error.response?.data || error.message);
      throw error;
    }
  }

  _ultramsgErrorMessage(error) {
    const data = error.response?.data;
    if (!data) return error.message;
    if (typeof data === 'string') return data;
    if (typeof data.error === 'string') return data.error;
    if (data.error) return JSON.stringify(data.error);
    return error.message;
  }

  // Verificar estado de una instancia específica (nunca lanza: el panel no debe caer)
  async getInstanceStatus(instanceId = null) {
    const instance = instanceId ? this.getInstance(instanceId) : this.getDefaultInstance();

    if (!instance) {
      return {
        connected: false,
        error: `No se encontró la instancia UltraMsg: ${instanceId || 'default'}`,
        instanceId: instanceId || null
      };
    }

    try {
      const url = `https://api.ultramsg.com/${instance.instanceId}/instance/status?token=${instance.token}`;
      const response = await axios.get(url, { timeout: 8000 });
      const data = response.data || {};

      if (data.error) {
        const message = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
        console.warn(`⚠️ UltraMsg ${instance.name} (${instance.instanceId}): ${message}`);
        return {
          connected: false,
          error: message,
          instanceName: instance.name,
          instanceId: instance.instanceId
        };
      }

      const substatus = data.status?.accountStatus?.substatus;
      return {
        ...data,
        connected: substatus === 'connected',
        instanceName: instance.name,
        instanceId: instance.instanceId
      };
    } catch (error) {
      const message = this._ultramsgErrorMessage(error);
      console.warn(`⚠️ UltraMsg ${instance.name} (${instance.instanceId}): ${message}`);
      return {
        connected: false,
        error: message,
        instanceName: instance.name,
        instanceId: instance.instanceId
      };
    }
  }

  // Obtener información de una instancia específica
  async getInstanceInfo(instanceId = null) {
    try {
      const instance = instanceId ? this.getInstance(instanceId) : this.getDefaultInstance();
      
      if (!instance) {
        throw new Error(`No se encontró la instancia UltraMsg: ${instanceId || 'default'}`);
      }

      const url = `https://api.ultramsg.com/${instance.instanceId}/instance/me?token=${instance.token}`;
      
      const response = await axios.get(url);

      return {
        ...response.data,
        instanceName: instance.name,
        instanceId: instance.instanceId
      };
    } catch (error) {
      console.error('❌ Error obteniendo info de UltraMsg:', error.response?.data || error.message);
      throw error;
    }
  }

  // Verificar si una instancia específica está conectada
  async isConnected(instanceId = null) {
    const status = await this.getInstanceStatus(instanceId);
    return Boolean(status.connected);
  }

  // Obtener mensajes de una instancia específica
  async getMessages(instanceId = null) {
    try {
      const instance = instanceId ? this.getInstance(instanceId) : this.getDefaultInstance();
      
      if (!instance) {
        throw new Error(`No se encontró la instancia UltraMsg: ${instanceId || 'default'}`);
      }

      const url = `https://api.ultramsg.com/${instance.instanceId}/messages?token=${instance.token}`;
      
      const response = await axios.get(url);

      return {
        ...response.data,
        instanceName: instance.name,
        instanceId: instance.instanceId
      };
    } catch (error) {
      console.error('❌ Error obteniendo mensajes de UltraMsg:', error.response?.data || error.message);
      throw error;
    }
  }

  // Verificar estado de todas las instancias
  async getAllInstancesStatus() {
    const entries = Array.from(this.instances.entries());
    const results = await Promise.all(
      entries.map(async ([instanceId]) => [instanceId, await this.getInstanceStatus(instanceId)])
    );
    return Object.fromEntries(results);
  }

  // Métodos de compatibilidad (para mantener la API existente)
  async sendMessageLegacy(to, message) {
    return this.sendMessage(to, message);
  }

  async getInstanceStatusLegacy() {
    return this.getInstanceStatus();
  }

  async getInstanceInfoLegacy() {
    return this.getInstanceInfo();
  }

  async isConnectedLegacy() {
    return this.isConnected();
  }

  async getMessagesLegacy() {
    return this.getMessages();
  }
}

module.exports = UltraMsgManager; 