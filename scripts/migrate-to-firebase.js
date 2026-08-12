const FirebaseService = require('../src/services/firebaseService');

// Clientes de ejemplo para migrar
const legacyClients = [
  {
    name: 'Consultorio Dr. García',
    adminPhone: '5216181344331@c.us',
    assistantPhone: '6182191002',
    assistantId: 'asst_KGIlBdi0uGXm0rvZQYpVTBoe',
    botStatus: 'active'
  },
  {
    name: 'Clínica Dental Sonrisa',
    adminPhone: '5216182191002@c.us',
    assistantPhone: '6181344331',
    assistantId: 'asst-def456',
    botStatus: 'active'
  }
];

async function migrateToFirebase() {
  try {
    console.log('🚀 Iniciando migración a Firebase...\n');
    
    const firebaseService = new FirebaseService();
    
    // Verificar conexión con Firebase
    console.log('1. Verificando conexión con Firebase...');
    const isConnected = await firebaseService.testConnection();
    
    if (!isConnected) {
      console.log('❌ No se pudo conectar a Firebase. Verifica las credenciales.');
      return;
    }
    
    console.log('✅ Conexión exitosa con Firebase\n');
    
    // Migrar cada cliente
    console.log('2. Migrando clientes...');
    
    for (const clientData of legacyClients) {
      try {
        console.log(`📋 Migrando: ${clientData.name}`);
        
        // Verificar si ya existe un cliente con ese número de asistente
        const existingClient = await firebaseService.getClientByAssistantPhone(clientData.assistantPhone);
        
        if (existingClient) {
          console.log(`⚠️  Cliente ya existe: ${existingClient.name} (ID: ${existingClient.id})`);
          continue;
        }
        
        // Crear nuevo cliente
        const newClient = await firebaseService.createClient(clientData);
        console.log(`✅ Cliente creado: ${newClient.name} (ID: ${newClient.id})`);
        
      } catch (error) {
        console.error(`❌ Error migrando ${clientData.name}:`, error.message);
      }
    }
    
    // Verificar clientes migrados
    console.log('\n3. Verificando clientes migrados...');
    const allClients = await firebaseService.getAllClients();
    
    console.log(`📊 Total de clientes en Firebase: ${Object.keys(allClients).length}`);
    
    Object.values(allClients).forEach(client => {
      console.log(`- ${client.name} (ID: ${client.id})`);
      console.log(`  📞 Admin: ${client.adminPhone}`);
      console.log(`  📱 Asistente: ${client.assistantPhone}`);
      console.log(`  🤖 Bot: ${client.botStatus}`);
    });
    
    // Obtener estadísticas
    console.log('\n4. Estadísticas del sistema...');
    const stats = await firebaseService.getClientStats();
    
    console.log(`📈 Estadísticas:`);
    console.log(`- Total: ${stats.total}`);
    console.log(`- Activos: ${stats.active}`);
    console.log(`- Inactivos: ${stats.inactive}`);
    
    console.log('\n🎉 Migración completada exitosamente!');
    console.log('💡 Ahora puedes gestionar clientes desde la API:');
    console.log('   POST /clients - Crear cliente');
    console.log('   GET /clients - Listar clientes');
    console.log('   PUT /clients/:id - Actualizar cliente');
    console.log('   DELETE /clients/:id - Eliminar cliente');
    
  } catch (error) {
    console.error('❌ Error en la migración:', error);
  }
}

// Ejecutar migración
migrateToFirebase(); 