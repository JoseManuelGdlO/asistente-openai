class ConfirmationManager {
  constructor() {
    // Agradecimientos / cierres cortos (siempre plantilla, sin IA)
    this.acknowledgementPatterns = [
      /^(gracias|thank you|thanks|ty)[\s!.💕💖✨❤️]*$/i,
      /^(muchas gracias|mil gracias|muchísimas gracias|muchisimas gracias)[\s!.💕💖✨🙏❤️]*$/i,
      /^(ok gracias|okay gracias|vale gracias|perfecto gracias|genial gracias|excelente gracias|muy bien gracias)[\s!.💕💖✨🙏❤️]*$/i,
      /^(gracias nena|gracias por la info|gracias por la información)[\s!.💕💖✨🙏❤️]*$/i,
      /^(🙏|💕|💖)$/
    ];

    // Afirmaciones (solo plantilla si hay agenda pendiente)
    this.confirmationPatterns = [
      /^(muy bien|perfecto|ok|okay|vale|genial|excelente)$/i,
      /^(está bien|esta bien|está perfecto|esta perfecto)$/i,
      /^(confirmado|confirmo|acepto|aceptado)$/i,
      /^(👍|✅|👌|😊|🙏)$/,
      /^(si|sí|yes|yep|yeah|claro|por supuesto)$/i
    ];
  }

  /**
   * Normaliza texto para matching (sin acentos raros de espacio, trim)
   * @param {string} message
   * @returns {string}
   */
  normalizeMessage(message) {
    if (typeof message !== 'string') {
      return '';
    }
    return message.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Detecta agradecimiento / cierre corto (no es intención de venta)
   * @param {string} message
   * @returns {boolean}
   */
  isAcknowledgementMessage(message) {
    const cleanMessage = this.normalizeMessage(message);
    if (!cleanMessage) {
      return false;
    }

    for (const pattern of this.acknowledgementPatterns) {
      if (pattern.test(cleanMessage)) {
        return true;
      }
    }

    // Cortos con "gracias" / "thanks" (máx 4 palabras, < 40 chars)
    if (cleanMessage.length < 40) {
      const words = cleanMessage.split(/\s+/);
      const hasThanks = words.some((word) => /^(gracias|thanks|ty)[!.,]?$/i.test(word));
      if (hasThanks && words.length <= 4) {
        // Evitar frases con pregunta o pedido
        if (/[?]|(curso|precio|agendar|cita|info|información|cuánto|cuanto)/i.test(cleanMessage)) {
          return false;
        }
        return true;
      }
    }

    return false;
  }

  /**
   * Detecta afirmación corta (sí, ok, vale…) — no incluye agradecimientos
   * @param {string} message
   * @returns {boolean}
   */
  isConfirmationMessage(message) {
    if (this.isAcknowledgementMessage(message)) {
      return false;
    }

    const cleanMessage = this.normalizeMessage(message);
    if (!cleanMessage) {
      return false;
    }

    for (const pattern of this.confirmationPatterns) {
      if (pattern.test(cleanMessage)) {
        return true;
      }
    }

    if (cleanMessage.length < 10) {
      const confirmationWords = ['bien', 'ok', 'vale', 'si', 'sí', 'yes', 'perfecto'];
      const words = cleanMessage.split(/\s+/);
      const hasConfirmationWord = words.some((word) => confirmationWords.includes(word));

      if (hasConfirmationWord && words.length <= 3) {
        return true;
      }
    }

    return false;
  }

  /**
   * Respuesta automática tras agenda / confirmación esperada
   * @returns {string}
   */
  getConfirmationResponse() {
    return '¡Perfecto! Me alegra saber que todo está bien. Si necesitas algo más, no dudes en preguntarme. 😊';
  }

  /**
   * Respuesta automática a agradecimientos / cierres cortos
   * @returns {string}
   */
  getAcknowledgementResponse() {
    return 'Con gusto 💖 Si necesitas algo más, aquí estoy.';
  }
}

module.exports = ConfirmationManager;
