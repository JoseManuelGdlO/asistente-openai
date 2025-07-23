class SchedulerController {
  constructor(scheduler) {
    this.scheduler = scheduler;
  }

  /**
   * Obtiene el estado de todas las tareas
   * @returns {Object} - Estado de las tareas
   */
  getTasksStatus() {
    try {
      const status = this.scheduler.getTasksStatus();
      return {
        ok: true,
        tasks: status,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error obteniendo estado del scheduler:', error);
      throw {
        ok: false,
        error: 'Error obteniendo estado del scheduler',
        details: error.message
      };
    }
  }

  /**
   * Ejecuta una tarea manualmente
   * @param {string} taskName - Nombre de la tarea
   * @returns {Object} - Resultado de la ejecución
   */
  async runTaskManually(taskName) {
    try {
      console.log(`🔄 Ejecutando tarea manualmente: ${taskName}`);
      
      await this.scheduler.runTaskManually(taskName);
      
      return {
        ok: true,
        message: `Tarea ${taskName} ejecutada manualmente`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error ejecutando tarea:', error);
      throw {
        ok: false,
        error: 'Error ejecutando tarea',
        details: error.message
      };
    }
  }

  /**
   * Detiene todas las tareas
   * @returns {Object} - Resultado de la operación
   */
  stopAllTasks() {
    try {
      this.scheduler.stop();
      
      return {
        ok: true,
        message: 'Todas las tareas han sido detenidas',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error deteniendo tareas:', error);
      throw {
        ok: false,
        error: 'Error deteniendo tareas',
        details: error.message
      };
    }
  }

  /**
   * Reinicia todas las tareas
   * @returns {Object} - Resultado de la operación
   */
  restartTasks() {
    try {
      this.scheduler.stop();
      this.scheduler.init();
      
      return {
        ok: true,
        message: 'Tareas reiniciadas exitosamente',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error reiniciando tareas:', error);
      throw {
        ok: false,
        error: 'Error reiniciando tareas',
        details: error.message
      };
    }
  }
}

module.exports = SchedulerController; 