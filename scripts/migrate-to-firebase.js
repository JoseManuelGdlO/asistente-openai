const FirebaseService = require('../src/services/firebaseService');

const DEFAULT_ENVIAR_PDF_TOOL = FirebaseService.DEFAULT_ENVIAR_PDF_TOOL;

function defaultPrompt(name) {
  return `Eres el asistente virtual de ${name} por WhatsApp.
Responde de forma clara, breve y profesional.
Si el usuario pide un documento o lista de precios y hay documentos disponibles, usa la herramienta enviar_pdf.
Tu salida final debe ser JSON con la forma {"reply":"texto para WhatsApp"}.`;
}

// Clientes de ejemplo para migrar (par client + Assistant Firestore)
const legacyClients = [
  {
    name: 'Consultorio Dr. García',
    adminPhone: '5216181344331@c.us',
    assistantPhone: '6182191002',
    botStatus: 'active'
  },
  {
    name: 'Clínica Dental Sonrisa',
    adminPhone: '5216182191002@c.us',
    assistantPhone: '6181344331',
    botStatus: 'active'
  }
];

async function migrateToFirebase() {
  try {
    console.log('🚀 Iniciando migración a Firebase...\n');

    const firebaseService = new FirebaseService();

    console.log('1. Verificando conexión con Firebase...');
    const isConnected = await firebaseService.testConnection();

    if (!isConnected) {
      console.log('❌ No se pudo conectar a Firebase. Verifica las credenciales.');
      return;
    }

    console.log('✅ Conexión exitosa con Firebase\n');

    console.log('2. Migrando clientes (par client + Assistant)...');

    for (const clientData of legacyClients) {
      try {
        console.log(`📋 Migrando: ${clientData.name}`);

        const existingClient = await firebaseService.getClientByAssistantPhone(
          clientData.assistantPhone
        );

        if (existingClient) {
          console.log(
            `⚠️  Cliente ya existe: ${existingClient.name} (ID: ${existingClient.id})`
          );
          continue;
        }

        const prompt = defaultPrompt(clientData.name);
        const { client, assistant } = await firebaseService.createClientWithAssistant(
          {
            ...clientData,
            prompt,
            tools: [DEFAULT_ENVIAR_PDF_TOOL],
            config: { temperature: 0.4 },
            responseSchema: FirebaseService.DEFAULT_RESPONSE_SCHEMA
          },
          {
            prompt,
            tools: [DEFAULT_ENVIAR_PDF_TOOL],
            config: { temperature: 0.4 },
            responseSchema: FirebaseService.DEFAULT_RESPONSE_SCHEMA
          }
        );
        console.log(`✅ Cliente creado: ${client.name} (ID: ${client.id})`);
        console.log(`   Assistant doc: Assistants/${assistant.id}`);
      } catch (error) {
        console.error(`❌ Error migrando ${clientData.name}:`, error.message);
      }
    }

    console.log('\n3. Verificando clientes migrados...');
    const allClients = await firebaseService.getAllClients();

    console.log(`📊 Total de clientes en Firebase: ${Object.keys(allClients).length}`);

    for (const client of Object.values(allClients)) {
      const assistant = await firebaseService.getAssistantByClientId(client.id);
      console.log(`- ${client.name} (ID: ${client.id})`);
      console.log(`  📞 Admin: ${client.adminPhone}`);
      console.log(`  📱 Asistente: ${client.assistantPhone}`);
      console.log(`  🤖 Bot: ${client.botStatus}`);
      console.log(`  🧠 Assistant: ${assistant ? 'OK' : 'FALTA'}`);
    }

    console.log('\n4. Estadísticas del sistema...');
    const stats = await firebaseService.getClientStats();

    console.log(`📈 Estadísticas:`);
    console.log(`- Total: ${stats.total}`);
    console.log(`- Activos: ${stats.active}`);
    console.log(`- Inactivos: ${stats.inactive}`);

    console.log('\n🎉 Migración completada exitosamente!');
    console.log('💡 Ahora puedes gestionar clientes desde la API:');
    console.log('   POST /clients - Crear par client + Assistant');
    console.log('   GET /clients - Listar clientes');
    console.log('   PUT /clients/:id - Actualizar cliente');
    console.log('   PUT /assistants/:id - Actualizar prompt/tools');
    console.log('   DELETE /clients/:id - Eliminar par client + Assistant');
  } catch (error) {
    console.error('❌ Error en la migración:', error);
  }
}

migrateToFirebase();
