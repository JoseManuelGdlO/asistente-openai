const FacebookTokenManager = require('./src/facebookTokenManager');
require('dotenv').config();

async function refreshToken() {
  console.log('=== Script de Refresh de Token de Facebook ===');
  
  try {
    const tokenManager = new FacebookTokenManager();
    
    // Verificar configuración
    if (!process.env.FB_APP_ID || !process.env.FB_APP_SECRET) {
      console.error('❌ Error: FB_APP_ID y FB_APP_SECRET deben estar configurados en .env');
      console.log('Por favor, agrega estas variables a tu archivo .env:');
      console.log('FB_APP_ID=tu-app-id-de-facebook');
      console.log('FB_APP_SECRET=tu-app-secret-de-facebook');
      return;
    }
    
    if (!process.env.WHATSAPP_TOKEN) {
      console.error('❌ Error: WHATSAPP_TOKEN debe estar configurado en .env');
      return;
    }
    
    console.log('✅ Configuración verificada');
    console.log('📱 FB_APP_ID:', process.env.FB_APP_ID ? 'Configurado' : 'NO CONFIGURADO');
    console.log('🔐 FB_APP_SECRET:', process.env.FB_APP_SECRET ? 'Configurado' : 'NO CONFIGURADO');
    console.log('📞 WHATSAPP_TOKEN:', process.env.WHATSAPP_TOKEN ? 'Configurado' : 'NO CONFIGURADO');
    
    console.log('\n🔄 Iniciando refresh del token...');
    
    // Obtener token actual
    const currentToken = await tokenManager.getValidToken();
    console.log('📋 Token actual obtenido');
    
    // Refrescar token
    const newToken = await tokenManager.refreshAndSaveToken(currentToken);
    console.log('✅ Token refrescado exitosamente');
    
    // Mostrar información del nuevo token
    const tokenData = await tokenManager.loadToken();
    console.log('\n📊 Información del token:');
    console.log('📅 Fecha de refresh:', tokenData.refreshDate);
    console.log('⏰ Expira:', tokenData.expiresAt);
    console.log('📏 Longitud del token:', newToken.length);
    
    const daysUntilExpiry = Math.ceil((new Date(tokenData.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
    console.log('📅 Días hasta expiración:', daysUntilExpiry);
    
    console.log('\n🎉 Refresh completado exitosamente!');
    
  } catch (error) {
    console.error('❌ Error durante el refresh:', error.message);
    console.error('Detalles:', error);
  }
}

// Ejecutar el script
refreshToken(); 