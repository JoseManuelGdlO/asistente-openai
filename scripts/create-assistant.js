const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function createAssistant() {
  try {
    console.log('Creando nuevo assistant...');
    
    const assistant = await openai.beta.assistants.create({
      name: "Asistente de WhatsApp",
      instructions: `Eres un asistente útil que ayuda a los usuarios a través de WhatsApp. 
      
      Puedes:
      - Responder preguntas generales
      - Ayudar con información
      - Ser amigable y profesional
      
      Responde de manera clara y concisa.`,
      model: "gpt-4o-mini",
      tools: []
    });

    console.log('✅ Assistant creado exitosamente!');
    console.log('Assistant ID:', assistant.id);
    console.log('Nombre:', assistant.name);
    console.log('');
    console.log('📝 Copia este ID a tu archivo .env:');
    console.log(`ASISTENTE_ID=${assistant.id}`);
    
  } catch (error) {
    console.error('❌ Error al crear assistant:', error.message);
    if (error.response?.data) {
      console.error('Detalles:', error.response.data);
    }
  }
}

createAssistant(); 