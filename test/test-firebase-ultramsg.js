const UltraMsgManager = require('../src/managers/ultramsgManager');
const FirebaseService = require('../src/services/firebaseService');
require('dotenv').config();

// Colores para la consola
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testFirebaseUltraMsg() {
  log('🧪 Iniciando prueba de configuración UltraMsg desde Firebase...', 'blue');
  log('==============================================================', 'blue');
  
  try {
    // 1. Probar conexión con Firebase
    log('\n1️⃣ Probando conexión con Firebase...', 'yellow');
    const firebaseService = new FirebaseService();
    
    try {
      await firebaseService.testConnection();
      log('✅ Conexión con Firebase exitosa', 'green');
    } catch (error) {
      log('❌ Error conectando con Firebase:', 'red');
      log(`   ${error.message}`, 'red');
      return;
    }
    
    // 2. Obtener clientes desde Firebase
    log('\n2️⃣ Obteniendo clientes desde Firebase...', 'yellow');
    const clients = await firebaseService.getAllClients();
    
    if (Object.keys(clients).length === 0) {
      log('⚠️ No se encontraron clientes en Firebase', 'yellow');
    } else {
      log(`✅ Se encontraron ${Object.keys(clients).length} clientes:`, 'green');
      
      Object.entries(clients).forEach(([clientId, client], index) => {
        log(`   ${index + 1}. ${client.name || 'Sin nombre'} (${clientId})`, 'green');
        
        // Verificar credenciales de UltraMsg
        const hasToken = client.ULTRAMSG_TOKEN ? '✅' : '❌';
        const hasInstanceId = client.ULTRAMSG_INSTANCE_ID ? '✅' : '❌';
        const hasWebhookToken = client.ULTRAMSG_WEBHOOK_TOKEN ? '✅' : '❌';
        
        log(`      Token: ${hasToken} ${client.ULTRAMSG_TOKEN ? 'Configurado' : 'Faltante'}`, 'green');
        log(`      Instance ID: ${hasInstanceId} ${client.ULTRAMSG_INSTANCE_ID || 'Faltante'}`, 'green');
        log(`      Webhook Token: ${hasWebhookToken} ${client.ULTRAMSG_WEBHOOK_TOKEN ? 'Configurado' : 'Faltante'}`, 'green');
        log(`      Assistant Phone: ${client.assistantPhone || 'No configurado'}`, 'green');
        log(`      Bot Status: ${client.botStatus || 'No configurado'}`, 'green');
      });
    }
    
    // 3. Probar inicialización del UltraMsgManager
    log('\n3️⃣ Probando inicialización del UltraMsgManager...', 'yellow');
    const ultraMsgManager = new UltraMsgManager();
    
    try {
      await ultraMsgManager.initializeInstances();
      log('✅ UltraMsgManager inicializado correctamente', 'green');
      
      const instances = ultraMsgManager.getAllInstances();
      log(`📱 Total de instancias configuradas: ${instances.length}`, 'green');
      
      if (instances.length > 0) {
        instances.forEach((instance, index) => {
          log(`   ${index + 1}. ${instance.name} (${instance.instanceId})`, 'green');
          log(`      Client ID: ${instance.clientId || 'N/A'}`, 'green');
          log(`      Webhook Token: ${instance.webhookToken ? 'Configurado' : 'No configurado'}`, 'green');
        });
      }
      
    } catch (error) {
      log('❌ Error inicializando UltraMsgManager:', 'red');
      log(`   ${error.message}`, 'red');
      return;
    }
    
    // 4. Probar verificación de tokens de webhook
    log('\n4️⃣ Probando verificación de tokens de webhook...', 'yellow');
    
    const instances = ultraMsgManager.getAllInstances();
    if (instances.length > 0) {
      instances.forEach((instance, index) => {
        log(`   Probando instancia ${index + 1}: ${instance.name}`, 'blue');
        
        if (instance.webhookToken) {
          log(`      Webhook Token: ${instance.webhookToken}`, 'green');
          
          // Simular verificación de token
          const isValid = instance.webhookToken && instance.webhookToken.length > 0;
          log(`      Token válido: ${isValid ? '✅ Sí' : '❌ No'}`, 'green');
        } else {
          log(`      ⚠️ No tiene webhook token configurado`, 'yellow');
        }
      });
    } else {
      log('⚠️ No hay instancias para probar tokens', 'yellow');
    }
    
    // 5. Probar estado de conexión de las instancias
    log('\n5️⃣ Probando estado de conexión de las instancias...', 'yellow');
    
    try {
      const allStatuses = await ultraMsgManager.getAllInstancesStatus();
      
      if (Object.keys(allStatuses).length === 0) {
        log('⚠️ No hay instancias para verificar estado', 'yellow');
      } else {
        Object.entries(allStatuses).forEach(([instanceId, status]) => {
          const statusIcon = status.connected ? '✅' : '❌';
          const instanceName = status.instanceName || 'Sin nombre';
          log(`   ${statusIcon} ${instanceName} (${instanceId}): ${status.connected ? 'Conectado' : 'Desconectado'}`, 'green');
          
          if (status.connected && status.name) {
            log(`      📱 Número: ${status.name}`, 'green');
          }
          
          if (status.error) {
            log(`      ❌ Error: ${status.error}`, 'red');
          }
        });
      }
      
    } catch (error) {
      log('❌ Error verificando estado de instancias:', 'red');
      log(`   ${error.message}`, 'red');
    }
    
    // 6. Resumen final
    log('\n6️⃣ Resumen de la prueba:', 'blue');
    log('==============================================================', 'blue');
    
    const totalClients = Object.keys(clients).length;
    const totalInstances = instances.length;
    const connectedInstances = Object.values(await ultraMsgManager.getAllInstancesStatus()).filter(s => s.connected).length;
    
    log(`📊 Clientes en Firebase: ${totalClients}`, 'green');
    log(`📱 Instancias UltraMsg configuradas: ${totalInstances}`, 'green');
    log(`✅ Instancias conectadas: ${connectedInstances}`, 'green');
    log(`❌ Instancias desconectadas: ${totalInstances - connectedInstances}`, 'red');
    
    if (totalInstances === 0) {
      log('\n⚠️ No se configuraron instancias de UltraMsg', 'yellow');
      log('💡 Asegúrate de que los clientes en Firebase tengan las credenciales de UltraMsg configuradas:', 'yellow');
      log('   - ULTRAMSG_TOKEN', 'yellow');
      log('   - ULTRAMSG_INSTANCE_ID', 'yellow');
      log('   - ULTRAMSG_WEBHOOK_TOKEN', 'yellow');
    } else if (connectedInstances === totalInstances) {
      log('\n🎉 ¡Todas las instancias están funcionando correctamente!', 'green');
    } else if (connectedInstances > 0) {
      log('\n⚠️ Algunas instancias están desconectadas. Revisa las credenciales.', 'yellow');
    } else {
      log('\n🚨 Ninguna instancia está conectada. Verifica las credenciales de UltraMsg.', 'red');
    }
    
    log('\n📋 Configuración recomendada en Firebase:', 'blue');
    log('   Cada cliente debe tener estos campos:', 'green');
    log('   - ULTRAMSG_TOKEN: Token de API de UltraMsg', 'green');
    log('   - ULTRAMSG_INSTANCE_ID: ID de la instancia de UltraMsg', 'green');
    log('   - ULTRAMSG_WEBHOOK_TOKEN: Token del webhook (puede ser el mismo que ULTRAMSG_TOKEN)', 'green');
    log('   - assistantPhone: Número de teléfono del asistente', 'green');
    log('   - botStatus: "active" para activar el bot', 'green');
    
  } catch (error) {
    log('\n❌ Error en la prueba:', 'red');
    log(`   ${error.message}`, 'red');
    console.error(error);
  }
}

// Ejecutar la prueba
if (require.main === module) {
  testFirebaseUltraMsg().catch(console.error);
}

module.exports = { testFirebaseUltraMsg }; 