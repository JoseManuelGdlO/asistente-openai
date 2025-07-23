class UserContextManager {
  constructor() {
    // Mapa para guardar el contexto de conversación por usuario
    this.userContext = new Map();
  }

  /**
   * Obtiene el contexto del usuario
   * @param {string} userId - ID del usuario
   * @returns {Object} - Contexto del usuario
   */
  getUserContext(userId) {
    if (!this.userContext.has(userId)) {
      this.userContext.set(userId, {
        lastMessageType: null,
        lastMessageTime: null,
        confirmationCount: 0,
        isWaitingForConfirmation: false
      });
    }
    return this.userContext.get(userId);
  }

  /**
   * Actualiza el contexto del usuario
   * @param {string} userId - ID del usuario
   * @param {string} messageType - Tipo de mensaje
   * @param {string} messageContent - Contenido del mensaje
   */
  updateUserContext(userId, messageType, messageContent) {
    const context = this.getUserContext(userId);
    const now = new Date();
    
    context.lastMessageType = messageType;
    context.lastMessageTime = now;
    
    if (messageType === 'confirmation') {
      context.confirmationCount++;
      context.isWaitingForConfirmation = false;
    } else if (messageType === 'agenda_sent') {
      context.isWaitingForConfirmation = true;
      context.confirmationCount = 0;
    }
    
    this.userContext.set(userId, context);
  }

  /**
   * Marca que se envió la agenda a un usuario
   * @param {string} userId - ID del usuario
   */
  markAgendaSent(userId) {
    this.updateUserContext(userId, 'agenda_sent', 'Agenda del día enviada');
  }

  /**
   * Limpia el contexto de un usuario
   * @param {string} userId - ID del usuario
   */
  clearUserContext(userId) {
    this.userContext.delete(userId);
  }

  /**
   * Obtiene todos los contextos de usuarios
   * @returns {Map} - Mapa con todos los contextos
   */
  getAllContexts() {
    return this.userContext;
  }

  /**
   * Verifica si un usuario está esperando confirmación
   * @param {string} userId - ID del usuario
   * @returns {boolean} - True si está esperando confirmación
   */
  isWaitingForConfirmation(userId) {
    const context = this.getUserContext(userId);
    return context.isWaitingForConfirmation;
  }
}

module.exports = UserContextManager; 