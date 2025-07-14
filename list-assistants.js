const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function listAssistants() {
  try {
    console.log('Buscando assistants existentes...');
    
    const assistants = await openai.beta.assistants.list();
    
    if (assistants.data.length === 0) {
      console.log('❌ No se encontraron assistants.');
      console.log('Ejecuta: node create-assistant.js para crear uno nuevo.');
      return;
    }
    
    console.log(`✅ Se encontraron ${assistants.data.length} assistant(s):`);
    console.log('');
    
    assistants.data.forEach((assistant, index) => {
      console.log(`${index + 1}. ID: ${assistant.id}`);
      console.log(`   Nombre: ${assistant.name}`);
      console.log(`   Modelo: ${assistant.model}`);
      console.log(`   Creado: ${new Date(assistant.created_at * 1000).toLocaleString()}`);
      console.log('');
    });
    
    console.log('📝 Copia el ID del assistant que quieras usar a tu archivo .env:');
    console.log('ASISTENTE_ID=asst_xxxxxxxxxxxxxxxxxxxxx');
    
  } catch (error) {
    console.error('❌ Error al listar assistants:', error.message);
    if (error.response?.data) {
      console.error('Detalles:', error.response.data);
    }
  }
}

listAssistants(); 