class ConfirmationManager {
  constructor() {
    // Patrones de mensajes de confirmación
    this.confirmationPatterns = [
      /^(muy bien|perfecto|ok|okay|vale|genial|excelente|perfecto|gracias|thank you|thanks)$/i,
      /^(muy bien gracias|perfecto gracias|ok gracias|vale gracias|genial gracias|excelente gracias)$/i,
      /^(está bien|esta bien|está perfecto|esta perfecto)$/i,
      /^(confirmado|confirmo|acepto|aceptado)$/i,
      /^(👍|✅|👌|😊|🙏)$/,
      /^(si|sí|yes|yep|yeah|claro|por supuesto)$/i
    ];
  }

  /**
   * Detecta si un mensaje es de confirmación
   * @param {string} message - El mensaje a analizar
   * @returns {boolean} - True si es confirmación, false en caso contrario
   */
  isConfirmationMessage(message) {
    const cleanMessage = message.trim().toLowerCase();
    
    // Verificar patrones de confirmación
    for (const pattern of this.confirmationPatterns) {
      if (pattern.test(cleanMessage)) {
        return true;
      }
    }
    
    // Verificar si el mensaje es muy corto (menos de 10 caracteres) y contiene palabras de confirmación
    if (cleanMessage.length < 10) {
      const confirmationWords = ['bien', 'ok', 'vale', 'si', 'sí', 'yes', 'gracias', 'thanks', 'perfecto'];
      const words = cleanMessage.split(/\s+/);
      const hasConfirmationWord = words.some(word => confirmationWords.includes(word));
      
      if (hasConfirmationWord && words.length <= 3) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Obtiene la respuesta automática para mensajes de confirmación
   * @returns {string} - Respuesta de confirmación
   */
  getConfirmationResponse() {
    return "¡Perfecto! Me alegra saber que todo está bien. Si necesitas algo más, no dudes en preguntarme. 😊";
  }
}

module.exports = ConfirmationManager; 