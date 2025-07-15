const UltraMsgManager = require('./src/ultramsgManager');
require('dotenv').config();

async function testUltraMsg() {
  console.log('=== PRUEBA DE ULTRAMSG ===');
  
  const ultraMsg = new UltraMsgManager();
  
  try {
    // 1. Verificar estado de la instancia
    console.log('\n1. Verificando estado de la instancia...');
    const status = await ultraMsg.getInstanceStatus();
    console.log('Estado:', status);
    
    // 2. Obtener información de la instancia
    console.log('\n2. Obteniendo información de la instancia...');
    const info = await ultraMsg.getInstanceInfo();
    console.log('Información:', info);
    
    // 3. Verificar si está conectado
    console.log('\n3. Verificando conexión...');
    const isConnected = await ultraMsg.isConnected();
    console.log('¿Está conectado?', isConnected ? '✅ SÍ' : '❌ NO');
    
    // 4. Enviar mensaje de prueba (descomenta para probar)
    /*
    console.log('\n4. Enviando mensaje de prueba...');
    const testPhone = '34612345678'; // Reemplaza con tu número
    const testMessage = '¡Hola! Este es un mensaje de prueba desde UltraMsg.';
    
    const result = await ultraMsg.sendMessage(testPhone, testMessage);
    console.log('Resultado del envío:', result);
    */
    
    console.log('\n✅ Prueba completada exitosamente');
    
  } catch (error) {
    console.error('❌ Error en la prueba:', error.response?.data || error.message);
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  testUltraMsg();
}

module.exports = { testUltraMsg }; 