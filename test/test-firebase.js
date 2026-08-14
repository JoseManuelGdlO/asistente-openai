const FirebaseService = require('../src/services/firebaseService');

async function testFirebase() {
  try {
    console.log('🔥 PRUEBA DE FIREBASE ===\n');
    
    const firebaseService = new FirebaseService();
    
    // 1. Verificar conexión
    console.log('1. Verificando conexión con Firebase...');
    const isConnected = await firebaseService.testConnection();
    console.log('Conexión:', isConnected ? '✅ EXITOSA' : '❌ FALLIDA');
    
    if (!isConnected) {
      console.log('❌ No se puede continuar sin conexión a Firebase');
      return;
    }

    // 2. Crear par client + Assistant de prueba
    console.log('\n2. Creando par client + Assistant de prueba...');
    const testClient = {
      name: 'Cliente de Prueba',
      adminPhone: '5216189999999@c.us',
      assistantPhone: '6189999999',
      botStatus: 'active',
      prompt: 'Eres un asistente de prueba por WhatsApp. Responde en JSON {"reply":"..."}.'
    };

    try {
      const { client: newClient, assistant } = await firebaseService.createClientWithAssistant(
        testClient,
        {
          prompt: testClient.prompt,
          tools: [],
          config: { temperature: 0.4 },
          responseSchema: FirebaseService.DEFAULT_RESPONSE_SCHEMA
        }
      );
      console.log('✅ Cliente creado:', newClient.id);
      console.log('✅ Assistant doc:', assistant.id);

      // 3. Obtener cliente por ID
      console.log('\n3. Obteniendo cliente por ID...');
      const retrievedClient = await firebaseService.getClientById(newClient.id);
      console.log('Cliente obtenido:', retrievedClient ? '✅' : '❌');
      
      // 4. Obtener cliente por teléfono
      console.log('\n4. Obteniendo cliente por teléfono...');
      const clientByPhone = await firebaseService.getClientByAssistantPhone('6189999999');
      console.log('Cliente por teléfono:', clientByPhone ? '✅' : '❌');

      // 5. Verificar Assistant 1:1
      console.log('\n5. Obteniendo Assistant por clientId...');
      const assistantDoc = await firebaseService.getAssistantByClientId(newClient.id);
      console.log('Assistant obtenido:', assistantDoc ? '✅' : '❌');

      // 6. Actualizar cliente
      console.log('\n6. Actualizando cliente...');
      const updatedClient = await firebaseService.updateClient(newClient.id, {
        name: 'Cliente de Prueba Actualizado'
      });
      console.log('Cliente actualizado:', updatedClient ? '✅' : '❌');

      // 7. Cambiar estado del bot
      console.log('\n7. Cambiando estado del bot...');
      const botUpdated = await firebaseService.updateBotStatus(newClient.id, 'inactive');
      console.log('Estado del bot actualizado:', botUpdated ? '✅' : '❌');

      // 8. Obtener todos los clientes
      console.log('\n8. Obteniendo todos los clientes...');
      const allClients = await firebaseService.getAllClients();
      console.log('Total de clientes:', Object.keys(allClients).length);

      // 9. Obtener estadísticas
      console.log('\n9. Obteniendo estadísticas...');
      const stats = await firebaseService.getClientStats();
      console.log('Estadísticas:', stats);

      // 10. Eliminar par client + Assistant de prueba
      console.log('\n10. Eliminando par client + Assistant de prueba...');
      const deleted = await firebaseService.deleteClientWithAssistant(newClient.id);
      console.log('Par eliminado:', deleted ? '✅' : '❌');

      console.log('\n🎉 Todas las pruebas completadas exitosamente!');
    } catch (error) {
      console.error('❌ Error en las pruebas:', error.message);
    }
  } catch (error) {
    console.error('❌ Error general:', error);
  }
}

testFirebase();