const axios = require('axios');

// URL de tu servidor (ajusta según tu configuración de ngrok)
const WEBHOOK_URL = 'http://localhost:3000/webhook';
const TEST_URL = 'http://localhost:3000/reset_threads';

// Simular una petición de WhatsApp
const whatsappPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '123456789',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '1234567890',
              phone_number_id: '987654321'
            },
            contacts: [
              {
                profile: {
                  name: 'Test User'
                },
                wa_id: '1234567890'
              }
            ],
            messages: [
              {
                from: '1234567890',
                id: 'test-message-id-' + Date.now(),
                timestamp: Math.floor(Date.now() / 1000),
                text: {
                  body: 'Hola, esto es una prueba'
                },
                type: 'text'
              }
            ]
          },
          field: 'messages'
        }
      ]
    }
  ]
};

async function testWebhook() {
  try {
    console.log('=== Probando endpoint de test ===');
    const testResponse = await axios.post(TEST_URL, { test: 'data' });
    console.log('Test endpoint funciona:', testResponse.data);
    
    console.log('\n=== Probando webhook de WhatsApp ===');
    console.log('Enviando payload:', JSON.stringify(whatsappPayload, null, 2));
    
    // const response = await axios.post(WEBHOOK_URL, whatsappPayload, {
    //   headers: {
    //     'Content-Type': 'application/json'
    //   }
    // });
    
    console.log('Respuesta del webhook:', response.status, response.data);
  } catch (error) {
    console.error('Error al probar webhook:', error.response?.data || error.message);
    console.error('Status:', error.response?.status);
  }
}

testWebhook(); 