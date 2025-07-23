const axios = require('axios');

// URL de tu servidor
const WEBHOOK_URL = 'http://localhost:3000/webhook';
const GROUP_SETTINGS_URL = 'http://localhost:3000/group-settings';

// Simular mensaje de chat individual
const individualMessagePayload = {
  data: {
    from: '55123456789@c.us',
    body: 'Hola, esto es un mensaje individual',
    id: 'individual-' + Date.now()
  }
};

// Simular mensaje de grupo
const groupMessagePayload = {
  data: {
    from: '55123456789-1234567890@g.us',
    body: 'Hola, esto es un mensaje de grupo',
    id: 'group-' + Date.now(),
    chat: {
      id: '55123456789-1234567890@g.us',
      name: 'Grupo de Prueba',
      isGroup: true
    },
    author: '55123456789@c.us'
  }
};

// Simular mensaje de grupo (formato alternativo)
const groupMessagePayload2 = {
  data: {
    from: '55123456789-1234567890@g.us',
    body: 'Hola, esto es otro mensaje de grupo',
    id: 'group2-' + Date.now(),
    chat: {
      id: '55123456789-1234567890@g.us',
      name: 'Otro Grupo'
    }
  }
};

async function testGroupDetection() {
  try {
    console.log('=== PRUEBA DE DETECCIÓN DE GRUPOS ===\n');
    
    // 1. Verificar configuración de grupos
    console.log('1. Verificando configuración de grupos...');
    const settingsResponse = await axios.get(GROUP_SETTINGS_URL);
    console.log('Configuración:', settingsResponse.data);
    
    // 2. Probar mensaje individual
    console.log('\n2. Probando mensaje individual...');
    console.log('Enviando:', JSON.stringify(individualMessagePayload, null, 2));
    
    try {
      const individualResponse = await axios.post(WEBHOOK_URL, individualMessagePayload, {
        headers: { 'Content-Type': 'application/json' }
      });
      console.log('✅ Mensaje individual procesado (status:', individualResponse.status, ')');
    } catch (error) {
      console.log('❌ Error con mensaje individual:', error.response?.status, error.response?.data);
    }
    
    // 3. Probar mensaje de grupo
    console.log('\n3. Probando mensaje de grupo...');
    console.log('Enviando:', JSON.stringify(groupMessagePayload, null, 2));
    
    try {
      const groupResponse = await axios.post(WEBHOOK_URL, groupMessagePayload, {
        headers: { 'Content-Type': 'application/json' }
      });
      console.log('✅ Mensaje de grupo ignorado (status:', groupResponse.status, ')');
    } catch (error) {
      console.log('❌ Error con mensaje de grupo:', error.response?.status, error.response?.data);
    }
    
    // 4. Probar mensaje de grupo (formato alternativo)
    console.log('\n4. Probando mensaje de grupo (formato alternativo)...');
    console.log('Enviando:', JSON.stringify(groupMessagePayload2, null, 2));
    
    try {
      const groupResponse2 = await axios.post(WEBHOOK_URL, groupMessagePayload2, {
        headers: { 'Content-Type': 'application/json' }
      });
      console.log('✅ Mensaje de grupo (formato 2) ignorado (status:', groupResponse2.status, ')');
    } catch (error) {
      console.log('❌ Error con mensaje de grupo (formato 2):', error.response?.status, error.response?.data);
    }
    
    console.log('\n=== PRUEBA COMPLETADA ===');
    console.log('📱 Los mensajes de grupos deberían ser ignorados automáticamente');
    console.log('✅ Los mensajes individuales deberían procesarse normalmente');
    
  } catch (error) {
    console.error('❌ Error en la prueba:', error.response?.data || error.message);
  }
}

testGroupDetection(); 