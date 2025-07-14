const axios = require('axios');

// Configuración
const SERVER_URL = 'http://localhost:3000';
const WHATSAPP_PHONE_ID = 'tu-phone-number-id'; // Reemplaza con tu Phone Number ID

// Función para enviar mensaje de agenda a un usuario
async function sendAgendaToUser(userPhoneNumber, agendaMessage) {
  try {
    console.log(`📅 Enviando agenda a: ${userPhoneNumber}`);
    
    // 1. Enviar el mensaje de agenda
    const messageData = {
      messaging_product: 'whatsapp',
      to: userPhoneNumber,
      text: { 
        body: agendaMessage 
      }
    };
    
    // Aquí necesitarías usar tu token de WhatsApp
    // const response = await axios({
    //   method: 'POST',
    //   url: `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
    //   headers: {
    //     'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
    //     'Content-Type': 'application/json',
    //   },
    //   data: messageData
    // });
    
    console.log('✅ Mensaje de agenda enviado');
    
    // 2. Marcar en el servidor que se envió la agenda
    const markResponse = await axios.post(`${SERVER_URL}/mark-agenda-sent`, {
      userId: userPhoneNumber
    });
    
    console.log('✅ Usuario marcado como agenda enviada');
    console.log('Contexto:', markResponse.data.context);
    
    return true;
  } catch (error) {
    console.error('❌ Error al enviar agenda:', error.response?.data || error.message);
    return false;
  }
}

// Función para obtener citas del día (ejemplo)
function getTodaysAppointments() {
  // Aquí conectarías con tu base de datos o sistema de citas
  return [
    {
      name: 'Juan Pérez',
      phone: '34612345678',
      time: '10:00',
      service: 'Consulta médica'
    },
    {
      name: 'María García',
      phone: '34687654321', 
      time: '14:30',
      service: 'Revisión'
    }
  ];
}

// Función principal para enviar agenda del día
async function sendDailyAgenda() {
  console.log('=== ENVIANDO AGENDA DEL DÍA ===');
  
  const appointments = getTodaysAppointments();
  const today = new Date().toLocaleDateString('es-ES');
  
  console.log(`📅 Fecha: ${today}`);
  console.log(`👥 Total de citas: ${appointments.length}`);
  
  for (const appointment of appointments) {
    const agendaMessage = `¡Hola ${appointment.name}! 👋

📅 Tienes una cita programada para hoy (${today}) a las ${appointment.time}.

🏥 Servicio: ${appointment.service}

Por favor confirma que asistirás respondiendo con "ok", "confirmado" o similar.

¡Te esperamos! 😊`;

    const success = await sendAgendaToUser(appointment.phone, agendaMessage);
    
    if (success) {
      console.log(`✅ Agenda enviada a ${appointment.name} (${appointment.phone})`);
    } else {
      console.log(`❌ Error enviando agenda a ${appointment.name} (${appointment.phone})`);
    }
    
    // Esperar 1 segundo entre envíos para evitar rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('=== AGENDA DEL DÍA COMPLETADA ===');
}

// Función para verificar el contexto de un usuario
async function checkUserContext(userPhone) {
  try {
    const response = await axios.get(`${SERVER_URL}/user-context/${userPhone}`);
    console.log('Contexto del usuario:', response.data);
    return response.data.context;
  } catch (error) {
    console.error('Error al obtener contexto:', error.response?.data || error.message);
    return null;
  }
}

// Función para limpiar el contexto de un usuario
async function clearUserContext(userPhone) {
  try {
    const response = await axios.post(`${SERVER_URL}/clear-user-context/${userPhone}`);
    console.log('Contexto limpiado:', response.data);
    return true;
  } catch (error) {
    console.error('Error al limpiar contexto:', error.response?.data || error.message);
    return false;
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  // Ejemplo de uso
  const userPhone = '34612345678';
  
  // Enviar agenda del día
  sendDailyAgenda();
  
  // Verificar contexto después de un tiempo
  setTimeout(async () => {
    console.log('\n=== VERIFICANDO CONTEXTO ===');
    await checkUserContext(userPhone);
  }, 5000);
}

module.exports = {
  sendAgendaToUser,
  sendDailyAgenda,
  checkUserContext,
  clearUserContext
}; 