const FirebaseService = require('./firebaseService');

class CommandManager {
  constructor() {
    // Servicio de Firebase para gestionar clientes
    this.firebaseService = new FirebaseService();
    
    // Configuración de clientes desde Firebase
    this.clientConfig = {};
    
    // Estados de los bots por cliente (cache local)
    this.botStatus = new Map();
    
    // Definición de comandos disponibles
    this.commands = {
      '/off': {
        description: 'Apagar bot',
        action: 'disable_bot',
        requiresAuth: true
      },
      '/on': {
        description: 'Encender bot', 
        action: 'enable_bot',
        requiresAuth: true
      },
      '/status': {
        description: 'Ver estado del bot',
        action: 'get_status',
        requiresAuth: true
      },
      '/restart': {
        description: 'Reiniciar bot',
        action: 'restart_bot',
        requiresAuth: true
      },
      '/help': {
        description: 'Ver comandos disponibles',
        action: 'show_help',
        requiresAuth: false
      },
      '/info': {
        description: 'Información del consultorio',
        action: 'show_info',
        requiresAuth: false
      },
      '/blacklist': {
        description: 'Gestionar lista de números bloqueados (solo admin)',
        action: 'blacklist',
        requiresAuth: true
      }
    };
    
    // Cargar clientes desde Firebase
    this.loadClientsFromFirebase();
  }

  /**
   * Carga clientes desde Firebase
   */
  async loadClientsFromFirebase() {
    try {
      this.clientConfig = await this.firebaseService.getAllClients();
      
      // Inicializar estados de bots desde Firebase
      Object.keys(this.clientConfig).forEach(clientId => {
        const client = this.clientConfig[clientId];
        this.botStatus.set(clientId, client.botStatus || 'active');
      });
      
      console.log('📋 Clientes cargados desde Firebase:', Object.keys(this.clientConfig));
    } catch (error) {
      console.error('❌ Error cargando clientes desde Firebase:', error);
      // Fallback a configuración vacía
      this.clientConfig = {};
    }
  }

  /**
   * Recarga clientes desde Firebase
   */
  async reloadClients() {
    await this.loadClientsFromFirebase();
  }

  /**
   * Verifica si un número está en la blacklist de un cliente
   * @param {string} clientId - ID del cliente (id_empresa)
   * @param {string} phone - Número de teléfono
   * @returns {Promise<boolean>} - True si está bloqueado
   */
  async isPhoneBlacklisted(clientId, phone) {
    return this.firebaseService.isPhoneBlacklisted(clientId, phone);
  }

  /**
   * Verifica si un número está autorizado para un cliente
   * @param {string} phoneNumber - Número de teléfono
   * @param {string} clientId - ID del cliente
   * @returns {boolean} - True si está autorizado
   */
  isAuthorizedNumber(phoneNumber, clientId) {
    const client = this.clientConfig[clientId];
    // Comparar solo el número sin @c.us
    const clientPhone = client?.adminPhone?.split('@')[0];
    const inputPhone = phoneNumber?.split('@')[0];
    return client && clientPhone === inputPhone;
  }

  /**
   * Verifica si un mensaje es un comando
   * @param {string} message - Mensaje a verificar
   * @returns {boolean} - True si es un comando
   */
  isCommand(message) {
    return message && message.includes('#') && message.includes('/');
  }

  /**
   * Extrae información del comando
   * @param {string} message - Mensaje del comando
   * @returns {Object|null} - Información del comando o null
   */
  extractCommandInfo(message) {
    // Formato: #CLIENTE001 /off  o  #CLIENTE001 /blacklist list | add 52... | remove 52...
    const match = message.match(/#(\w+)\s+(\/\w+)(?:\s+(.+))?/);
    
    if (!match) return null;
    
    const [, clientId, command, rest] = match;
    const args = rest ? rest.trim() : '';
    return { clientId, command, args };
  }

  /**
   * Ejecuta un comando específico
   * @param {string} clientId - ID del cliente
   * @param {string} command - Comando a ejecutar
   * @param {string} from - Número que envía el comando
   * @param {string} [args] - Argumentos opcionales del comando (ej. para /blacklist)
   * @returns {string} - Respuesta del comando
   */
  async executeCommand(clientId, command, from, args = '') {
    const client = this.clientConfig[clientId];
    const commandDef = this.commands[command];
    
    // Verificar si el comando existe
    if (!commandDef) {
      return `❌ Comando no reconocido: ${command}\nEscribe #${clientId} /help para ver comandos disponibles.`;
    }
    
    // Verificar autorización si es requerida
    if (commandDef.requiresAuth && !this.isAuthorizedNumber(from, clientId)) {
      return `❌ No autorizado para controlar el bot de ${client.name}.\nSolo el número ${client.adminPhone} puede ejecutar este comando.`;
    }
    
    // Ejecutar comando
    switch (commandDef.action) {
      case 'disable_bot':
        this.botStatus.set(clientId, 'inactive');
        await this.firebaseService.updateBotStatus(clientId, 'inactive');
        return `🤖 Bot de ${client.name} APAGADO\nYa no responderá a mensajes normales.`;
        
      case 'enable_bot':
        this.botStatus.set(clientId, 'active');
        await this.firebaseService.updateBotStatus(clientId, 'active');
        return `🤖 Bot de ${client.name} ENCENDIDO\nRespondiendo normalmente.`;
        
      case 'get_status':
        const status = this.botStatus.get(clientId);
        const statusText = status === 'active' ? '🟢 ACTIVO' : '🔴 INACTIVO';
        return `📊 Estado del bot de ${client.name}:\n${statusText}\nAsistente: ${client.assistantId}`;
        
      case 'restart_bot':
        this.botStatus.set(clientId, 'active');
        await this.firebaseService.updateBotStatus(clientId, 'active');
        return `🔄 Bot de ${client.name} REINICIADO\nEstado: ACTIVO`;
        
      case 'show_help':
        return this.getHelpMessage(clientId);
        
      case 'show_info':
        return this.getInfoMessage(clientId);
        
      case 'blacklist': {
        const sub = args.toLowerCase().split(/\s+/)[0];
        if (sub === 'list') {
          const list = await this.firebaseService.getBlacklist(clientId);
          if (!list.length) {
            return `📋 Lista de números bloqueados de ${client.name}:\n(ninguno)`;
          }
          const lines = list.map((item, i) => `${i + 1}. ${item.phone}`);
          return `📋 Lista de números bloqueados de ${client.name}:\n${lines.join('\n')}`;
        }
        if (sub === 'add') {
          const phone = args.slice(3).trim(); // "add 521234..." -> "521234..."
          if (!phone) {
            return `❌ Indica el número.\nUso: #${clientId} /blacklist add 521234567890`;
          }
          const result = await this.firebaseService.addToBlacklist(clientId, phone);
          if (result.added) {
            return `✅ Número ${phone} añadido a la lista de bloqueados.`;
          }
          return `ℹ️ ${result.message}`;
        }
        if (sub === 'remove') {
          const phone = args.slice(6).trim(); // "remove 521234..." -> "521234..."
          if (!phone) {
            return `❌ Indica el número.\nUso: #${clientId} /blacklist remove 521234567890`;
          }
          const removed = await this.firebaseService.removeFromBlacklist(clientId, phone);
          return removed
            ? `✅ Número ${phone} quitado de la lista de bloqueados.`
            : `ℹ️ El número ${phone} no estaba en la lista.`;
        }
        return `📋 Blacklist - Uso:\n#${clientId} /blacklist list\n#${clientId} /blacklist add 521234567890\n#${clientId} /blacklist remove 521234567890`;
      }

      default:
        return `❌ Acción no implementada: ${commandDef.action}`;
    }
  }

  /**
   * Procesa un mensaje y verifica si es un comando
   * @param {string} message - Mensaje a procesar
   * @param {string} from - Número que envía el mensaje
   * @returns {Object} - Resultado del procesamiento
   */
  async processMessage(message, from) {
    // Verificar si es un comando
    if (!this.isCommand(message)) {
      return { isCommand: false };
    }
    
    // Extraer información del comando
    const commandInfo = this.extractCommandInfo(message);
    if (!commandInfo) {
      return { 
        isCommand: true, 
        response: "❌ Formato de comando incorrecto.\nUso: #CLIENTE001 /comando" 
      };
    }
    
    const { clientId, command, args = '' } = commandInfo;
    
    // Verificar si el cliente existe
    if (!this.clientConfig[clientId]) {
      return { 
        isCommand: true, 
        response: `❌ Cliente no encontrado: ${clientId}\nVerifica el código del cliente.` 
      };
    }
    
    // Ejecutar comando
    const response = await this.executeCommand(clientId, command, from, args);
    
    return { 
      isCommand: true, 
      response: response,
      clientId: clientId,
      command: command
    };
  }

  /**
   * Verifica si un bot está activo
   * @param {string} clientId - ID del cliente
   * @returns {boolean} - True si está activo
   */
  isBotActive(clientId) {
    return this.botStatus.get(clientId) === 'active';
  }

  /**
   * Obtiene el cliente basándose en el número de teléfono del asistente
   * @param {string} assistantPhone - Número de teléfono del asistente (destinatario)
   * @returns {string|null} - ID del cliente o null si no se encuentra
   */
  async getClientByAssistantPhone(assistantPhone) {
    try {
      const client = await this.firebaseService.getClientByAssistantPhone(assistantPhone);
      return client ? client.id : null;
    } catch (error) {
      console.error('❌ Error obteniendo cliente por teléfono:', error);
      return null;
    }
  }

  /**
   * Obtiene el ID del asistente para un número de teléfono específico
   * @param {string} assistantPhone - Número de teléfono del asistente (destinatario)
   * @returns {string|null} - ID del asistente o null si no se encuentra
   */
  async getAssistantIdByPhone(assistantPhone) {
    try {
      const client = await this.firebaseService.getClientByAssistantPhone(assistantPhone);
      return client ? client.assistantId : null;
    } catch (error) {
      console.error('❌ Error obteniendo asistente por teléfono:', error);
      return null;
    }
  }

  /**
   * Obtiene el mensaje de ayuda para un cliente
   * @param {string} clientId - ID del cliente
   * @returns {string} - Mensaje de ayuda
   */
  getHelpMessage(clientId) {
    const client = this.clientConfig[clientId];
    let help = `📋 Comandos disponibles para ${client.name}:\n\n`;
    
    Object.entries(this.commands).forEach(([cmd, def]) => {
      const authRequired = def.requiresAuth ? ' (Solo autorizados)' : '';
      help += `${cmd} - ${def.description}${authRequired}\n`;
    });
    
    help += `\n💡 Uso: #${clientId} /comando`;
    return help;
  }

  /**
   * Obtiene información del consultorio
   * @param {string} clientId - ID del cliente
   * @returns {string} - Información del consultorio
   */
  getInfoMessage(clientId) {
    const client = this.clientConfig[clientId];
    const status = this.botStatus.get(clientId);
    const statusText = status === 'active' ? '🟢 ACTIVO' : '🔴 INACTIVO';
    
    return `🏥 Información de ${client.name}:\n\n` +
           `📞 Admin: ${client.adminPhone}\n` +
           `📱 Asistente: ${client.assistantPhone}\n` +
           `🤖 ID Asistente: ${client.assistantId}\n` +
           `📊 Estado: ${statusText}\n` +
           `🔑 ID: ${clientId}`;
  }

  /**
   * Obtiene el estado de todos los bots
   * @returns {Object} - Estado de todos los bots
   */
  getAllBotsStatus() {
    const status = {};
    Object.keys(this.clientConfig).forEach(clientId => {
      status[clientId] = {
        name: this.clientConfig[clientId].name,
        status: this.botStatus.get(clientId),
        adminPhone: this.clientConfig[clientId].adminPhone,
        assistantPhone: this.clientConfig[clientId].assistantPhone,
        assistantId: this.clientConfig[clientId].assistantId
      };
    });
    return status;
  }

  /**
   * Obtiene la configuración de clientes
   * @returns {Object} - Configuración de clientes
   */
  getClientConfig() {
    return this.clientConfig;
  }

  /**
   * Crea un nuevo cliente
   * @param {Object} clientData - Datos del cliente
   * @returns {Promise<Object>} - Cliente creado
   */
  async createClient(clientData) {
    try {
      const newClient = await this.firebaseService.createClient(clientData);
      await this.reloadClients(); // Recargar configuración
      return newClient;
    } catch (error) {
      console.error('❌ Error creando cliente:', error);
      throw error;
    }
  }

  /**
   * Actualiza un cliente existente
   * @param {string} clientId - ID del cliente
   * @param {Object} updateData - Datos a actualizar
   * @returns {Promise<Object>} - Cliente actualizado
   */
  async updateClient(clientId, updateData) {
    try {
      const updatedClient = await this.firebaseService.updateClient(clientId, updateData);
      await this.reloadClients(); // Recargar configuración
      return updatedClient;
    } catch (error) {
      console.error('❌ Error actualizando cliente:', error);
      throw error;
    }
  }

  /**
   * Elimina un cliente
   * @param {string} clientId - ID del cliente
   * @returns {Promise<boolean>} - True si se eliminó correctamente
   */
  async deleteClient(clientId) {
    try {
      const result = await this.firebaseService.deleteClient(clientId);
      await this.reloadClients(); // Recargar configuración
      return result;
    } catch (error) {
      console.error('❌ Error eliminando cliente:', error);
      throw error;
    }
  }
}

module.exports = CommandManager; 