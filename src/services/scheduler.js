const cron = require('node-cron');
const UltraMsgManager = require('../managers/ultramsgManager');
const axios = require('axios');
require('dotenv').config();

class Scheduler {
  constructor() {
    this.ultraMsgManager = new UltraMsgManager();
    this.tasks = new Map();
  }

  // Inicializar todas las tareas programadas
  init() {
    console.log('🕐 Inicializando tareas programadas...');
    
    // Tarea diaria a las 10:00 AM
    this.scheduleDailyAgenda();
    
    // Tarea de limpieza semanal (domingos a las 2:00 AM)
    this.scheduleWeeklyCleanup();
    
    // Tarea de verificación de estado cada hora
    this.scheduleStatusCheck();
    
    console.log('✅ Tareas programadas inicializadas');
  }

  // Programar envío de agenda diaria a las 10:00 AM
  scheduleDailyAgenda() {
    const task = cron.schedule('0 10 * * *', async () => {
      console.log('📅 === EJECUTANDO AGENDA DIARIA ===');
      console.log('Hora:', new Date().toLocaleString('es-ES'));
      
      try {
        await this.sendDailyAgenda();
        console.log('✅ Agenda diaria completada exitosamente');
      } catch (error) {
        console.error('❌ Error en agenda diaria:', error.message);
      }
    }, {
      scheduled: true,
      timezone: "America/Mexico_City" // Ajusta a tu zona horaria
    });

    this.tasks.set('dailyAgenda', task);
    console.log('📅 Agenda diaria programada para las 10:00 AM');
  }

  // Programar limpieza semanal (domingos a las 2:00 AM)
  scheduleWeeklyCleanup() {
    const task = cron.schedule('0 2 * * 0', async () => {
      console.log('🧹 === EJECUTANDO LIMPIEZA SEMANAL ===');
      console.log('Hora:', new Date().toLocaleString('es-ES'));
      
      try {
        await this.weeklyCleanup();
        console.log('✅ Limpieza semanal completada');
      } catch (error) {
        console.error('❌ Error en limpieza semanal:', error.message);
      }
    }, {
      scheduled: true,
      timezone: "America/Mexico_City"
    });

    this.tasks.set('weeklyCleanup', task);
    console.log('🧹 Limpieza semanal programada para domingos a las 2:00 AM');
  }

  // Programar verificación de estado cada hora
  scheduleStatusCheck() {
    const task = cron.schedule('0 * * * *', async () => {
      console.log('🔍 === VERIFICANDO ESTADO ===');
      
      try {
        await this.checkSystemStatus();
      } catch (error) {
        console.error('❌ Error verificando estado:', error.message);
      }
    }, {
      scheduled: true,
      timezone: "America/Mexico_City"
    });

    this.tasks.set('statusCheck', task);
    console.log('🔍 Verificación de estado programada cada hora');
  }

  // Método principal para enviar agenda diaria
  async sendDailyAgenda() {
    try {
      // 1. Obtener citas del día desde Google Calendar
      const appointments = await this.getTodaysAppointments();
      
      if (appointments.length === 0) {
        console.log('📅 No hay citas para hoy');
        return;
      }

      console.log(`📅 Encontradas ${appointments.length} citas para hoy`);
      
      // 2. Enviar mensajes a cada paciente
      for (const appointment of appointments) {
        try {
          await this.sendAgendaToUser(appointment);
          
          // Esperar 1 segundo entre envíos para evitar rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.error(`❌ Error enviando agenda a ${appointment.name}:`, error.message);
        }
      }
      
    } catch (error) {
      console.error('❌ Error en sendDailyAgenda:', error.message);
      throw error;
    }
  }

  // Obtener citas del día (conectar con Google Calendar)
  async getTodaysAppointments() {
    // TODO: Implementar conexión con Google Calendar
    // Por ahora retornamos datos de ejemplo
    
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = domingo, 1 = lunes, etc.
    
    // Ejemplo: solo citas de lunes a viernes
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return [];
    }
    
    return [
      {
        name: 'Juan Pérez',
        phone: '34612345678',
        time: '10:00',
        service: 'Consulta médica',
        date: today.toISOString().split('T')[0]
      },
      {
        name: 'María García',
        phone: '34687654321',
        time: '14:30',
        service: 'Revisión',
        date: today.toISOString().split('T')[0]
      }
    ];
  }

  // Enviar agenda a un usuario específico
  async sendAgendaToUser(appointment) {
    try {
      const today = new Date().toLocaleDateString('es-ES');
      
      const message = `¡Hola ${appointment.name}! 👋

📅 Tienes una cita programada para hoy (${today}) a las ${appointment.time}.

🏥 Servicio: ${appointment.service}

Por favor confirma que asistirás respondiendo con "ok", "confirmado" o similar.

¡Te esperamos! 😊`;

      console.log(`📱 Enviando agenda a ${appointment.name} (${appointment.phone})`);
      
      // Enviar mensaje via UltraMsg
      const response = await this.ultraMsgManager.sendMessage(appointment.phone, message);
      
      // Marcar que se envió la agenda (para el sistema de confirmaciones)
      await this.markAgendaSent(appointment.phone);
      
      console.log(`✅ Agenda enviada a ${appointment.name}`);
      
      return response;
      
    } catch (error) {
      console.error(`❌ Error enviando agenda a ${appointment.name}:`, error.message);
      throw error;
    }
  }

  // Marcar que se envió la agenda (para el sistema de confirmaciones)
  async markAgendaSent(userPhone) {
    try {
      const response = await axios.post(`http://localhost:${process.env.PORT || 3000}/mark-agenda-sent`, {
        userId: userPhone
      });
      
      console.log(`✅ Usuario ${userPhone} marcado como agenda enviada`);
      return response.data;
      
    } catch (error) {
      console.error(`❌ Error marcando agenda enviada para ${userPhone}:`, error.message);
    }
  }

  // Limpieza semanal
  async weeklyCleanup() {
    try {
      console.log('🧹 Limpiando datos antiguos...');
      
      // Aquí puedes agregar lógica para limpiar:
      // - Logs antiguos
      // - Contextos de usuario muy antiguos
      // - Mensajes procesados antiguos
      // - Archivos temporales
      
      console.log('✅ Limpieza semanal completada');
      
    } catch (error) {
      console.error('❌ Error en limpieza semanal:', error.message);
      throw error;
    }
  }

  // Verificar estado del sistema
  async checkSystemStatus() {
    try {
      // Verificar conexión con UltraMsg
      const isConnected = await this.ultraMsgManager.isConnected();
      
      if (!isConnected) {
        console.log('⚠️ UltraMsg no está conectado');
        // Aquí podrías enviar una notificación al administrador
      } else {
        console.log('✅ UltraMsg conectado correctamente');
      }
      
    } catch (error) {
      console.error('❌ Error verificando estado:', error.message);
    }
  }

  // Ejecutar tarea manualmente (para pruebas)
  async runTaskManually(taskName) {
    console.log(`🔄 Ejecutando tarea manualmente: ${taskName}`);
    
    switch (taskName) {
      case 'dailyAgenda':
        await this.sendDailyAgenda();
        break;
      case 'weeklyCleanup':
        await this.weeklyCleanup();
        break;
      case 'statusCheck':
        await this.checkSystemStatus();
        break;
      default:
        console.log('❌ Tarea no encontrada:', taskName);
    }
  }

  // Detener todas las tareas
  stop() {
    console.log('🛑 Deteniendo tareas programadas...');
    
    for (const [name, task] of this.tasks) {
      task.stop();
      console.log(`🛑 Tarea detenida: ${name}`);
    }
    
    this.tasks.clear();
  }

  // Obtener estado de las tareas
  getTasksStatus() {
    const status = {};
    
    for (const [name, task] of this.tasks) {
      status[name] = {
        running: task.running,
        scheduled: task.scheduled
      };
    }
    
    return status;
  }
}

module.exports = Scheduler; 