class CommandManager {
  constructor() {
    // Configuración de clientes desde variables de entorno
    this.clientConfig = this.loadClientConfig();
    
    // Estados de los bots por cliente
    this.botStatus = new Map();
    
    // Inicializar todos los bots como activos
    Object.keys(this.clientConfig).forEach(clientCode => {
      this.botStatus.set(clientCode, 'active');
    });
    
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
      }
    };
  }

  /**
   * Carga la configuración de clientes desde variables de entorno
   * @returns {Object} Configuración de clientes
   */
  loadClientConfig() {
    const config = {};
    
    // Buscar variables de entorno que empiecen con CLIENTE
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('CLIENTE') && key.includes('_PHONE')) {
        const clientCode = key.split('_')[0]; // CLIENTE001_PHONE -> CLIENTE001
        
        config[clientCode] = {
          phone: process.env[key],
          name: process.env[`${clientCode}_NAME`] || clientCode,
          assistantId: process.env[`${clientCode}_ASSISTANT`] || process.env.ASISTENTE_ID,
          status: 'active'
        };
      }
    });
    
    console.log('📋 Clientes configurados:', Object.keys(config));
    return config;
  }

  /**
   * Verifica si un número está autorizado para un cliente
   * @param {string} phoneNumber - Número de teléfono
   * @param {string} clientCode - Código del cliente
   * @returns {boolean} - True si está autorizado
   */
  isAuthorizedNumber(phoneNumber, clientCode) {
    const client = this.clientConfig[clientCode];
    // Comparar solo el número sin @c.us
    const clientPhone = client?.phone?.split('@')[0];
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
    // Formato: #CLIENTE001 /off
    const match = message.match(/#(\w+)\s+(\/\w+)/);
    
    if (!match) return null;
    
    const [, clientCode, command] = match;
    return { clientCode, command };
  }

  /**
   * Ejecuta un comando específico
   * @param {string} clientCode - Código del cliente
   * @param {string} command - Comando a ejecutar
   * @param {string} from - Número que envía el comando
   * @returns {string} - Respuesta del comando
   */
  executeCommand(clientCode, command, from) {
    const client = this.clientConfig[clientCode];
    const commandDef = this.commands[command];
    
    // Verificar si el comando existe
    if (!commandDef) {
      return `❌ Comando no reconocido: ${command}\nEscribe #${clientCode} /help para ver comandos disponibles.`;
    }
    
    // Verificar autorización si es requerida
    if (commandDef.requiresAuth && !this.isAuthorizedNumber(from, clientCode)) {
      return `❌ No autorizado para controlar el bot de ${client.name}.\nSolo el número ${client.phone} puede ejecutar este comando.`;
    }
    
    // Ejecutar comando
    switch (commandDef.action) {
      case 'disable_bot':
        this.botStatus.set(clientCode, 'inactive');
        return `🤖 Bot de ${client.name} APAGADO\nYa no responderá a mensajes normales.`;
        
      case 'enable_bot':
        this.botStatus.set(clientCode, 'active');
        return `🤖 Bot de ${client.name} ENCENDIDO\nRespondiendo normalmente.`;
        
      case 'get_status':
        const status = this.botStatus.get(clientCode);
        const statusText = status === 'active' ? '🟢 ACTIVO' : '🔴 INACTIVO';
        return `📊 Estado del bot de ${client.name}:\n${statusText}\nAsistente: ${client.assistantId}`;
        
      case 'restart_bot':
        this.botStatus.set(clientCode, 'active');
        return `🔄 Bot de ${client.name} REINICIADO\nEstado: ACTIVO`;
        
      case 'show_help':
        return this.getHelpMessage(clientCode);
        
      case 'show_info':
        return this.getInfoMessage(clientCode);
        
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
  processMessage(message, from) {
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
    
    const { clientCode, command } = commandInfo;
    
    // Verificar si el cliente existe
    if (!this.clientConfig[clientCode]) {
      return { 
        isCommand: true, 
        response: `❌ Cliente no encontrado: ${clientCode}\nVerifica el código del cliente.` 
      };
    }
    
    // Ejecutar comando
    const response = this.executeCommand(clientCode, command, from);
    
    return { 
      isCommand: true, 
      response: response,
      clientCode: clientCode,
      command: command
    };
  }

  /**
   * Verifica si un bot está activo
   * @param {string} clientCode - Código del cliente
   * @returns {boolean} - True si está activo
   */
  isBotActive(clientCode) {
    return this.botStatus.get(clientCode) === 'active';
  }

  /**
   * Obtiene el mensaje de ayuda para un cliente
   * @param {string} clientCode - Código del cliente
   * @returns {string} - Mensaje de ayuda
   */
  getHelpMessage(clientCode) {
    const client = this.clientConfig[clientCode];
    let help = `📋 Comandos disponibles para ${client.name}:\n\n`;
    
    Object.entries(this.commands).forEach(([cmd, def]) => {
      const authRequired = def.requiresAuth ? ' (Solo autorizados)' : '';
      help += `${cmd} - ${def.description}${authRequired}\n`;
    });
    
    help += `\n💡 Uso: #${clientCode} /comando`;
    return help;
  }

  /**
   * Obtiene información del consultorio
   * @param {string} clientCode - Código del cliente
   * @returns {string} - Información del consultorio
   */
  getInfoMessage(clientCode) {
    const client = this.clientConfig[clientCode];
    const status = this.botStatus.get(clientCode);
    const statusText = status === 'active' ? '🟢 ACTIVO' : '🔴 INACTIVO';
    
    return `🏥 Información de ${client.name}:\n\n` +
           `📞 Número: ${client.phone}\n` +
           `🤖 Asistente: ${client.assistantId}\n` +
           `📊 Estado: ${statusText}\n` +
           `🔑 Código: ${clientCode}`;
  }

  /**
   * Obtiene el estado de todos los bots
   * @returns {Object} - Estado de todos los bots
   */
  getAllBotsStatus() {
    const status = {};
    Object.keys(this.clientConfig).forEach(clientCode => {
      status[clientCode] = {
        name: this.clientConfig[clientCode].name,
        status: this.botStatus.get(clientCode),
        assistantId: this.clientConfig[clientCode].assistantId
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
}

module.exports = CommandManager; 