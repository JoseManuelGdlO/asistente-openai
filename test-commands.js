const axios = require('axios');

// URL de tu servidor
const BASE_URL = 'http://localhost:3000';
const WEBHOOK_URL = `${BASE_URL}/webhook`;

// Configuración de prueba
const TEST_CLIENT = 'CLIENTE001';
const TEST_ADMIN_PHONE = '5216181344331@c.us';
const TEST_ASSISTANT_PHONE = '6182191002';

// Simular mensajes de comando
const commandMessages = [
  {
    name: 'Comando de ayuda',
    payload: {
      data: {
        from: TEST_ADMIN_PHONE,
        to: TEST_ASSISTANT_PHONE,
        body: `#${TEST_CLIENT} /help`,
        id: 'help-' + Date.now()
      }
    }
  },
  {
    name: 'Comando de estado',
    payload: {
      data: {
        from: TEST_ADMIN_PHONE,
        to: TEST_ASSISTANT_PHONE,
        body: `#${TEST_CLIENT} /status`,
        id: 'status-' + Date.now()
      }
    }
  },
  {
    name: 'Comando de información',
    payload: {
      data: {
        from: TEST_ADMIN_PHONE,
        to: TEST_ASSISTANT_PHONE,
        body: `#${TEST_CLIENT} /info`,
        id: 'info-' + Date.now()
      }
    }
  },
  {
    name: 'Comando apagar bot',
    payload: {
      data: {
        from: TEST_ADMIN_PHONE,
        to: TEST_ASSISTANT_PHONE,
        body: `#${TEST_CLIENT} /off`,
        id: 'off-' + Date.now()
      }
    }
  },
  {
    name: 'Comando encender bot',
    payload: {
      data: {
        from: TEST_ADMIN_PHONE,
        to: TEST_ASSISTANT_PHONE,
        body: `#${TEST_CLIENT} /on`,
        id: 'on-' + Date.now()
      }
    }
  },
  {
    name: 'Comando no autorizado (número diferente)',
    payload: {
      data: {
        from: '5216189999999@c.us',
        to: TEST_ASSISTANT_PHONE,
        body: `#${TEST_CLIENT} /off`,
        id: 'unauthorized-' + Date.now()
      }
    }
  },
  {
    name: 'Comando cliente inexistente',
    payload: {
      data: {
        from: TEST_ADMIN_PHONE,
        to: TEST_ASSISTANT_PHONE,
        body: '#CLIENTE999 /status',
        id: 'invalid-client-' + Date.now()
      }
    }
  },
  {
    name: 'Comando formato incorrecto',
    payload: {
      data: {
        from: TEST_ADMIN_PHONE,
        to: TEST_ASSISTANT_PHONE,
        body: 'CLIENTE001 /status',
        id: 'wrong-format-' + Date.now()
      }
    }
  }
];

async function testCommands() {
  try {
    console.log('=== PRUEBA DE SISTEMA DE COMANDOS ===\n');
    
    // 1. Verificar configuración de clientes
    console.log('1. Verificando configuración de clientes...');
    try {
      const clientsResponse = await axios.get(`${BASE_URL}/clients`);
      console.log('✅ Clientes configurados:', clientsResponse.data);
    } catch (error) {
      console.log('❌ Error obteniendo clientes:', error.response?.data || error.message);
    }
    
    // 2. Verificar estado de bots
    console.log('\n2. Verificando estado de bots...');
    try {
      const statusResponse = await axios.get(`${BASE_URL}/bots/status`);
      console.log('✅ Estado de bots:', statusResponse.data);
    } catch (error) {
      console.log('❌ Error obteniendo estado:', error.response?.data || error.message);
    }
    
    // 3. Probar comandos via webhook
    console.log('\n3. Probando comandos via webhook...');
    
    for (const test of commandMessages) {
      console.log(`\n--- ${test.name} ---`);
      console.log('Enviando:', test.payload.data.body);
      
      try {
        const response = await axios.post(WEBHOOK_URL, test.payload, {
          headers: { 'Content-Type': 'application/json' }
        });
        console.log('✅ Comando procesado (status:', response.status, ')');
        console.log('📱 Respuesta enviada por WhatsApp al número:', test.payload.data.from);
      } catch (error) {
        console.log('❌ Error:', error.response?.status, error.response?.data);
      }
      
      // Esperar un poco entre comandos
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 4. Probar comando manual via API
    console.log('\n4. Probando comando manual via API...');
    try {
      const manualResponse = await axios.post(`${BASE_URL}/bots/command`, {
        clientCode: TEST_CLIENT,
        command: '/status',
        phoneNumber: TEST_ADMIN_PHONE
      });
      console.log('✅ Comando manual ejecutado:', manualResponse.data);
    } catch (error) {
      console.log('❌ Error comando manual:', error.response?.data || error.message);
    }
    
    console.log('\n=== PRUEBA COMPLETADA ===');
    console.log('📋 Verifica los logs del servidor para ver las respuestas');
    console.log('🎮 Los comandos deberían funcionar correctamente');
    
  } catch (error) {
    console.error('❌ Error en la prueba:', error.response?.data || error.message);
  }
}

testCommands(); 