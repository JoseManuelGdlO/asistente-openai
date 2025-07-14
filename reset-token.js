const fs = require('fs').promises;
const path = require('path');
const FacebookTokenManager = require('./src/facebookTokenManager');
require('dotenv').config();

async function resetToken() {
  console.log('=== Script de Reset de Token de Facebook ===');
  
  try {
    const tokenManager = new FacebookTokenManager();
    const tokenFilePath = path.join(__dirname, 'token.json');
    
    // Eliminar archivo de token si existe
    try {
      await fs.unlink(tokenFilePath);
      console.log('✅ Archivo token.json eliminado');
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('ℹ️  Archivo token.json no existía');
      } else {
        console.error('❌ Error al eliminar token.json:', error.message);
      }
    }
    
    // Eliminar archivo temporal si existe
    try {
      await fs.unlink(tokenFilePath + '.tmp');
      console.log('✅ Archivo token.json.tmp eliminado');
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('ℹ️  Archivo token.json.tmp no existía');
      } else {
        console.error('❌ Error al eliminar token.json.tmp:', error.message);
      }
    }
    
    console.log('\n🔄 Verificando configuración...');
    
    // Verificar configuración
    if (!process.env.FB_APP_ID || !process.env.FB_APP_SECRET) {
      console.error('❌ Error: FB_APP_ID y FB_APP_SECRET deben estar configurados en .env');
      return;
    }
    
    if (!process.env.WHATSAPP_TOKEN) {
      console.error('❌ Error: WHATSAPP_TOKEN debe estar configurado en .env');
      return;
    }
    
    console.log('✅ Configuración verificada');
    
    // Intentar crear un nuevo token
    console.log('\n🔄 Creando nuevo token...');
    const currentToken = process.env.WHATSAPP_TOKEN;
    const newToken = await tokenManager.refreshAndSaveToken(currentToken);
    
    if (newToken && newToken !== currentToken) {
      console.log('✅ Nuevo token creado exitosamente');
      
      // Verificar que se guardó correctamente
      const savedToken = await tokenManager.loadToken();
      console.log('✅ Token guardado y cargado correctamente');
      
      console.log('\n📊 Información del nuevo token:');
      console.log('📏 Longitud del token:', newToken.length);
      console.log('🔄 Token renovado:', newToken !== currentToken ? 'Sí' : 'No');
      
    } else {
      console.log('⚠️  No se pudo renovar el token, usando el actual');
    }
    
    console.log('\n🎉 Reset completado!');
    console.log('💡 El sistema ahora debería funcionar correctamente');
    
  } catch (error) {
    console.error('❌ Error durante el reset:', error.message);
    console.error('Detalles:', error);
  }
}

// Ejecutar el script
resetToken(); 