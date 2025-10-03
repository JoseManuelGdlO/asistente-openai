const OpenAIManager = require('../managers/openAIManager');
const UserContextManager = require('./userContextManager');

/**
 * Servicio para gestionar el reseteo de hilos de conversación
 * Maneja tanto los threads de OpenAI como el contexto de usuario
 */
class ThreadResetService {
  constructor(openAIManager, userContextManager) {
    this.openAIManager = openAIManager;
    this.userContextManager = userContextManager;
  }

  /**
   * Resetea el thread de un usuario específico para un cliente específico
   * @param {string} userId - ID del usuario (número de teléfono)
   * @param {string} clientCode - Código del cliente
   * @param {Object} options - Opciones adicionales
   * @returns {Object} - Resultado de la operación
   */
  async resetUserThread(userId, clientCode, options = {}) {
    try {
      // Validar parámetros
      const validation = this.validateParameters(userId, clientCode);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          code: 'VALIDATION_ERROR'
        };
      }

      const result = {
        success: true,
        userId: userId,
        clientCode: clientCode,
        timestamp: new Date().toISOString(),
        operations: []
      };

      // 1. Resetear thread de OpenAI
      const threadReset = this.openAIManager.resetUserThread(userId, clientCode);
      result.operations.push({
        type: 'openai_thread_reset',
        success: threadReset,
        message: threadReset 
          ? `Thread de OpenAI reseteado para ${userId} en ${clientCode}`
          : `No se encontró thread de OpenAI para ${userId} en ${clientCode}`
      });

      // 2. Resetear contexto de usuario (opcional)
      if (options.resetUserContext !== false) {
        this.userContextManager.clearUserContext(userId);
        result.operations.push({
          type: 'user_context_reset',
          success: true,
          message: `Contexto de usuario reseteado para ${userId}`
        });
      }

      // 3. Log de la operación
      console.log(`=== THREAD RESET SERVICE ===`);
      console.log(`Usuario: ${userId}`);
      console.log(`Cliente: ${clientCode}`);
      console.log(`Thread reseteado: ${threadReset}`);
      console.log(`Contexto reseteado: ${options.resetUserContext !== false}`);
      console.log(`Timestamp: ${result.timestamp}`);

      return result;

    } catch (error) {
      console.error('Error en ThreadResetService.resetUserThread:', error);
      return {
        success: false,
        error: error.message,
        code: 'SERVICE_ERROR',
        userId: userId,
        clientCode: clientCode
      };
    }
  }

  /**
   * Resetea todos los threads de un usuario específico
   * @param {string} userId - ID del usuario (número de teléfono)
   * @param {Object} options - Opciones adicionales
   * @returns {Object} - Resultado de la operación
   */
  async resetAllUserThreads(userId, options = {}) {
    try {
      // Validar parámetros
      if (!userId || typeof userId !== 'string') {
        return {
          success: false,
          error: 'userId es requerido y debe ser una cadena',
          code: 'VALIDATION_ERROR'
        };
      }

      const result = {
        success: true,
        userId: userId,
        timestamp: new Date().toISOString(),
        operations: []
      };

      // 1. Resetear todos los threads de OpenAI del usuario
      const resetCount = this.openAIManager.resetAllUserThreads(userId);
      result.operations.push({
        type: 'openai_threads_reset',
        success: resetCount > 0,
        count: resetCount,
        message: `${resetCount} threads de OpenAI reseteados para ${userId}`
      });

      // 2. Resetear contexto de usuario (opcional)
      if (options.resetUserContext !== false) {
        this.userContextManager.clearUserContext(userId);
        result.operations.push({
          type: 'user_context_reset',
          success: true,
          message: `Contexto de usuario reseteado para ${userId}`
        });
      }

      // 3. Log de la operación
      console.log(`=== THREAD RESET SERVICE (ALL USER THREADS) ===`);
      console.log(`Usuario: ${userId}`);
      console.log(`Threads reseteados: ${resetCount}`);
      console.log(`Contexto reseteado: ${options.resetUserContext !== false}`);
      console.log(`Timestamp: ${result.timestamp}`);

      return result;

    } catch (error) {
      console.error('Error en ThreadResetService.resetAllUserThreads:', error);
      return {
        success: false,
        error: error.message,
        code: 'SERVICE_ERROR',
        userId: userId
      };
    }
  }

  /**
   * Resetea todos los threads del sistema
   * @param {Object} options - Opciones adicionales
   * @returns {Object} - Resultado de la operación
   */
  async resetAllThreads(options = {}) {
    try {
      const result = {
        success: true,
        timestamp: new Date().toISOString(),
        operations: []
      };

      // 1. Resetear todos los threads de OpenAI
      this.openAIManager.resetThreads();
      result.operations.push({
        type: 'openai_all_threads_reset',
        success: true,
        message: 'Todos los threads de OpenAI han sido reseteados'
      });

      // 2. Resetear todos los contextos de usuario (opcional)
      if (options.resetUserContext !== false) {
        const allContexts = this.userContextManager.getAllContexts();
        const contextCount = allContexts.size;
        
        // Limpiar todos los contextos
        for (const userId of allContexts.keys()) {
          this.userContextManager.clearUserContext(userId);
        }
        
        result.operations.push({
          type: 'user_contexts_reset',
          success: true,
          count: contextCount,
          message: `${contextCount} contextos de usuario reseteados`
        });
      }

      // 3. Log de la operación
      console.log(`=== THREAD RESET SERVICE (ALL THREADS) ===`);
      console.log(`Todos los threads reseteados`);
      console.log(`Contextos reseteados: ${options.resetUserContext !== false}`);
      console.log(`Timestamp: ${result.timestamp}`);

      return result;

    } catch (error) {
      console.error('Error en ThreadResetService.resetAllThreads:', error);
      return {
        success: false,
        error: error.message,
        code: 'SERVICE_ERROR'
      };
    }
  }

  /**
   * Obtiene información detallada de los threads activos
   * @returns {Object} - Información de los threads
   */
  async getThreadsInfo() {
    try {
      const threadsInfo = this.openAIManager.getAllThreadsInfo();
      const userContexts = this.userContextManager.getAllContexts();
      
      // Combinar información de threads y contextos
      const enrichedThreads = threadsInfo.map(thread => {
        const userContext = userContexts.get(thread.userId);
        return {
          ...thread,
          userContext: userContext || null,
          hasUserContext: !!userContext
        };
      });

      return {
        success: true,
        totalThreads: threadsInfo.length,
        totalUserContexts: userContexts.size,
        threads: enrichedThreads,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error en ThreadResetService.getThreadsInfo:', error);
      return {
        success: false,
        error: error.message,
        code: 'SERVICE_ERROR'
      };
    }
  }

  /**
   * Busca threads por criterios específicos
   * @param {Object} criteria - Criterios de búsqueda
   * @returns {Object} - Threads que coinciden con los criterios
   */
  async findThreads(criteria = {}) {
    try {
      const threadsInfo = this.openAIManager.getAllThreadsInfo();
      let filteredThreads = threadsInfo;

      // Filtrar por userId
      if (criteria.userId) {
        filteredThreads = filteredThreads.filter(thread => 
          thread.userId === criteria.userId
        );
      }

      // Filtrar por clientCode
      if (criteria.clientCode) {
        filteredThreads = filteredThreads.filter(thread => 
          thread.clientCode === criteria.clientCode
        );
      }

      // Filtrar por threads con runs activos
      if (criteria.hasActiveRun !== undefined) {
        filteredThreads = filteredThreads.filter(thread => 
          thread.hasActiveRun === criteria.hasActiveRun
        );
      }

      return {
        success: true,
        criteria: criteria,
        totalFound: filteredThreads.length,
        threads: filteredThreads,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error en ThreadResetService.findThreads:', error);
      return {
        success: false,
        error: error.message,
        code: 'SERVICE_ERROR'
      };
    }
  }

  /**
   * Valida los parámetros de entrada
   * @param {string} userId - ID del usuario
   * @param {string} clientCode - Código del cliente
   * @returns {Object} - Resultado de la validación
   */
  validateParameters(userId, clientCode) {
    if (!userId || typeof userId !== 'string') {
      return {
        valid: false,
        error: 'userId es requerido y debe ser una cadena'
      };
    }

    if (!clientCode || typeof clientCode !== 'string') {
      return {
        valid: false,
        error: 'clientCode es requerido y debe ser una cadena'
      };
    }

    // Validar formato de número de teléfono (básico)
    if (!userId.includes('@') && !userId.match(/^\d{10,15}$/)) {
      return {
        valid: false,
        error: 'userId debe ser un número de teléfono válido (con @c.us o formato numérico)'
      };
    }

    return { valid: true };
  }

  /**
   * Obtiene estadísticas del servicio
   * @returns {Object} - Estadísticas del servicio
   */
  async getServiceStats() {
    try {
      const threadsInfo = this.openAIManager.getAllThreadsInfo();
      const userContexts = this.userContextManager.getAllContexts();
      
      // Agrupar por cliente
      const threadsByClient = {};
      const threadsByUser = {};
      
      threadsInfo.forEach(thread => {
        // Por cliente
        if (!threadsByClient[thread.clientCode]) {
          threadsByClient[thread.clientCode] = 0;
        }
        threadsByClient[thread.clientCode]++;
        
        // Por usuario
        if (!threadsByUser[thread.userId]) {
          threadsByUser[thread.userId] = 0;
        }
        threadsByUser[thread.userId]++;
      });

      return {
        success: true,
        stats: {
          totalThreads: threadsInfo.length,
          totalUserContexts: userContexts.size,
          threadsByClient: threadsByClient,
          threadsByUser: threadsByUser,
          activeRuns: threadsInfo.filter(t => t.hasActiveRun).length
        },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error en ThreadResetService.getServiceStats:', error);
      return {
        success: false,
        error: error.message,
        code: 'SERVICE_ERROR'
      };
    }
  }
}

module.exports = ThreadResetService;
