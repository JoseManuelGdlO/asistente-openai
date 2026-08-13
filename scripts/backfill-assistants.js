require('dotenv').config();

const FirebaseService = require('../src/services/firebaseService');

const DEFAULT_ENVIAR_PDF_TOOL = FirebaseService.DEFAULT_ENVIAR_PDF_TOOL;
const DEFAULT_RESPONSE_SCHEMA = FirebaseService.DEFAULT_RESPONSE_SCHEMA;

function defaultPrompt(name) {
  return `Eres el asistente virtual de ${name} por WhatsApp.
Responde de forma clara, breve y profesional.
Si el usuario pide un documento o lista de precios y hay documentos disponibles, usa la herramienta enviar_pdf.
Tu salida final debe ser JSON con la forma {"reply":"texto para WhatsApp"}.`;
}

async function backfillAssistants() {
  const dryRun = process.argv.includes('--dry-run');
  const firebaseService = new FirebaseService();

  console.log(dryRun ? '🔍 Backfill Assistants (dry-run)...' : '🚀 Backfill Assistants...');
  console.log('');

  const clients = await firebaseService.getAllClients();
  const clientList = Object.values(clients);

  if (clientList.length === 0) {
    console.log('No hay clientes activos.');
    return;
  }

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const client of clientList) {
    const clientId = client.id;
    const name = client.name || clientId;

    try {
      const existing = await firebaseService.getAssistantByClientId(clientId);
      if (existing) {
        console.log(`⏭️  ${clientId} (${name}): ya existe Assistants/${clientId}`);
        skipped += 1;
        continue;
      }

      const assistantData = {
        prompt: defaultPrompt(name),
        tools: [DEFAULT_ENVIAR_PDF_TOOL],
        config: { temperature: 0.4 },
        responseSchema: DEFAULT_RESPONSE_SCHEMA
      };

      if (dryRun) {
        console.log(`📝 ${clientId} (${name}): se crearía Assistants/${clientId}`);
        created += 1;
        continue;
      }

      const result = await firebaseService.ensureAssistantForClient(clientId, assistantData);
      if (result.created) {
        console.log(`✅ ${clientId} (${name}): creado Assistants/${clientId}`);
        created += 1;
      } else {
        console.log(`⏭️  ${clientId} (${name}): ya existe Assistants/${clientId}`);
        skipped += 1;
      }
    } catch (error) {
      console.error(`❌ ${clientId} (${name}): ${error.message}`);
      errors += 1;
    }
  }

  console.log('');
  console.log('Resumen:');
  console.log(`  Creados${dryRun ? ' (simulados)' : ''}: ${created}`);
  console.log(`  Ya existían: ${skipped}`);
  console.log(`  Errores: ${errors}`);
}

backfillAssistants().catch((error) => {
  console.error('❌ Error en backfill:', error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
