const UltraMsgManager = require('./src/managers/ultramsgManager');
require('dotenv').config();

async function debugInstances() {
  console.log('=== DEBUG: Instancias de UltraMsg ===\n');
  
  const ultraMsgManager = new UltraMsgManager();
  
  try {
    // Inicializar instancias desde Firebase
    await ultraMsgManager.initializeInstances();
    
    console.log('📊 Total de instancias configuradas:', ultraMsgManager.instances.size);
    console.log('');
    
    // Mostrar todas las instancias
    let index = 1;
    for (const [instanceId, instance] of ultraMsgManager.instances) {
      console.log(`\n🔹 Instancia #${index}:`);
      console.log('  - Instance ID:', instanceId);
      console.log('  - Nombre:', instance.name);
      console.log('  - Client ID:', instance.clientId || 'No definido');
      console.log('  - Token:', instance.token ? `${instance.token.substring(0, 8)}...` : 'No definido');
      console.log('  - Webhook Token:', instance.webhookToken ? `${instance.webhookToken.substring(0, 8)}...` : 'No definido');
      console.log('  - Assistant Phone:', instance.assistantPhone || 'No definido');
      
      // Verificar si es la instancia por defecto
      const defaultInstance = ultraMsgManager.getDefaultInstance();
      if (defaultInstance && defaultInstance.instanceId === instanceId) {
        console.log('  - ⭐ ESTA ES LA INSTANCIA POR DEFECTO');
      }
      
      index++;
    }
    
    console.log('\n\n=== Instancia por Defecto ===');
    const defaultInstance = ultraMsgManager.getDefaultInstance();
    if (defaultInstance) {
      console.log('Instance ID:', defaultInstance.instanceId);
      console.log('Nombre:', defaultInstance.name);
      console.log('Assistant Phone:', defaultInstance.assistantPhone || 'No definido');
    } else {
      console.log('❌ No hay instancia por defecto configurada');
    }
    
    console.log('\n\n=== Simulación de Identificación ===');
    console.log('\n1. Prueba con webhook token de cada instancia:');
    for (const [instanceId, instance] of ultraMsgManager.instances) {
      if (instance.webhookToken) {
        console.log(`  - Token "${instance.webhookToken.substring(0, 8)}..." → Instancia: ${instanceId}`);
      }
    }
    
    console.log('\n2. Prueba con números de teléfono:');
    for (const [instanceId, instance] of ultraMsgManager.instances) {
      if (instance.assistantPhone) {
        console.log(`  - Teléfono "${instance.assistantPhone}" → Instancia: ${instanceId}`);
      }
    }
    
    console.log('\n✅ Debug completado');
    
  } catch (error) {
    console.error('❌ Error durante debug:', error.message);
    console.error(error);
  }
}

debugInstances();
