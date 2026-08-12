require('dotenv').config();

const FirebaseService = require('../src/services/firebaseService');

const DEFAULT_ENVIAR_PDF_TOOL = {
  type: 'function',
  name: 'enviar_pdf',
  description:
    'Envía un PDF del consultorio al usuario por WhatsApp. Usa solo documento_id de la lista de documentos disponibles.',
  parameters: {
    type: 'object',
    properties: {
      documento_id: {
        type: 'string',
        description: 'Identificador del PDF (ej. lista_precios)'
      },
      caption: {
        type: 'string',
        description: 'Texto opcional que acompaña el archivo'
      }
    },
    required: ['documento_id'],
    additionalProperties: false
  },
  strict: true
};

const DEFAULT_RESPONSE_SCHEMA = FirebaseService.DEFAULT_RESPONSE_SCHEMA;

async function seedClientAssistant() {
  const firebaseService = new FirebaseService();

  const clientId = process.env.SEED_CLIENT_ID || 'DEMO001';
  const name = process.env.SEED_CLIENT_NAME || 'Consultorio Demo';
  const adminPhone = process.env.SEED_ADMIN_PHONE || '5215500000000';
  const assistantPhone = process.env.SEED_ASSISTANT_PHONE || '5215500000001';

  const prompt =
    process.env.SEED_PROMPT ||
    `Eres el asistente virtual de ${name} por WhatsApp.
Responde de forma clara, breve y profesional.
Si el usuario pide un documento o lista de precios y hay documentos disponibles, usa la herramienta enviar_pdf.
Tu salida final debe ser JSON con la forma {"reply":"texto para WhatsApp"}.`;

  console.log('Creando par client + Assistant en Firestore...');
  console.log('clientId:', clientId);

  const existingClient = await firebaseService.getClientById(clientId);
  if (existingClient && existingClient.status === 'active') {
    console.error(`❌ Ya existe un cliente activo con id ${clientId}. Usa otro SEED_CLIENT_ID o elimínalo antes.`);
    process.exit(1);
  }

  const { client, assistant } = await firebaseService.createClientWithAssistant(
    {
      id: clientId,
      name,
      adminPhone,
      assistantPhone,
      botStatus: 'active',
      prompt,
      tools: [DEFAULT_ENVIAR_PDF_TOOL],
      config: {
        temperature: 0.4
      },
      responseSchema: DEFAULT_RESPONSE_SCHEMA
    },
    {
      prompt,
      tools: [DEFAULT_ENVIAR_PDF_TOOL],
      config: { temperature: 0.4 },
      responseSchema: DEFAULT_RESPONSE_SCHEMA
    }
  );

  console.log('✅ Par creado exitosamente');
  console.log('Cliente:', client.id, '-', client.name);
  console.log('Assistant doc: Assistants/' + assistant.id);
  console.log('Tools:', (assistant.tools || []).map((t) => t.name).join(', ') || '(ninguna)');
  console.log('');
  console.log('Variables útiles:');
  console.log(`OPENAI_MODEL=${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`);
  console.log(`SEED_CLIENT_ID=${client.id}`);
}

seedClientAssistant().catch((error) => {
  console.error('❌ Error en seed:', error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
