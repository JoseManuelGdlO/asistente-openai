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
  async initializeInstances() {
    if (this.initialized) {
      return; // Ya inicializado
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
            webhookToken: client.ULTRAMSG_WEBHOOK_TOKEN || client.ULTRAMSG_TOKEN
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

  // Enviar mensaje usando una instancia específica
  async sendMessage(to, message, instanceId = null) {
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

      console.log(`✅ Mensaje enviado via UltraMsg (${instance.name}):`, response.data);
      return {
        ...response.data,
        instanceName: instance.name,
        instanceId: instance.instanceId
      };
    } catch (error) {
      console.error('❌ Error enviando mensaje via UltraMsg:', error.response?.data || error.message);
      throw error;
    }
  }

  // Verificar estado de una instancia específica
  async getInstanceStatus(instanceId = null) {
    try {
      const instance = instanceId ? this.getInstance(instanceId) : this.getDefaultInstance();
      
      if (!instance) {
        throw new Error(`No se encontró la instancia UltraMsg: ${instanceId || 'default'}`);
      }

      const url = `https://api.ultramsg.com/${instance.instanceId}/instance/status?token=${instance.token}`;
      
      const response = await axios.get(url);

      return {
        ...response.data,
        instanceName: instance.name,
        instanceId: instance.instanceId
      };
    } catch (error) {
      console.error('❌ Error obteniendo estado de UltraMsg:', error.response?.data || error.message);
      throw error;
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
    try {
      const status = await this.getInstanceStatus(instanceId);
      return status.status.accountStatus.substatus === 'connected';
    } catch (error) {
      return false;
    }
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
    const statuses = {};
    
    for (const [instanceId, instance] of this.instances) {
      try {
        const status = await this.getInstanceStatus(instanceId);
        statuses[instanceId] = {
          ...status,
          connected: status.status.accountStatus.substatus === 'connected'
        };
      } catch (error) {
        statuses[instanceId] = {
          error: error.message,
          connected: false,
          instanceName: instance.name
        };
      }
    }
    
    return statuses;
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