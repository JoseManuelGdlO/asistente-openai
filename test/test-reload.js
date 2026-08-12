const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testReload() {
  try {
    console.log('🔄 PROBANDO ENDPOINT DE RELOAD ===\n');
    
    // 1. Ver estado actual
    console.log('1. Verificando estado actual...');
    const statusResponse = await axios.get(`${BASE_URL}/clients/status`);
    console.log('Estado actual:', statusResponse.data);
    
    // 2. Recargar clientes
    console.log('\n2. Recargando clientes desde Firebase...');
    const reloadResponse = await axios.post(`${BASE_URL}/clients/reload`);
    console.log('Respuesta de reload:', JSON.stringify(reloadResponse.data, null, 2));
    
    // 3. Ver estado después del reload
    console.log('\n3. Verificando estado después del reload...');
    const statusAfterResponse = await axios.get(`${BASE_URL}/clients/status`);
    console.log('Estado después:', statusAfterResponse.data);
    
    console.log('\n✅ Prueba completada exitosamente!');
    
  } catch (error) {
    console.error('❌ Error en la prueba:', error.response?.data || error.message);
  }
}

// Ejecutar prueba
testReload(); 