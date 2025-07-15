const axios = require('axios');
require('dotenv').config();

async function checkTokenType() {
  console.log('=== VERIFICANDO TIPO DE TOKEN DE FACEBOOK ===');
  
  const token = process.env.WHATSAPP_TOKEN;
  
  if (!token) {
    console.error('❌ No hay token configurado en WHATSAPP_TOKEN');
    return;
  }
  
  console.log('🔍 Token encontrado, verificando...');
  
  try {
    // Verificar el token con Facebook
    const response = await axios.get(`https://graph.facebook.com/debug_token`, {
      params: {
        input_token: token,
        access_token: `${process.env.FB_APP_ID}|${process.env.FB_APP_SECRET}`
      }
    });
    
    const tokenInfo = response.data.data;
    
    console.log('\n📊 INFORMACIÓN DEL TOKEN:');
    console.log('✅ Válido:', tokenInfo.is_valid);
    console.log('👤 Usuario ID:', tokenInfo.user_id);
    console.log('📱 Aplicación ID:', tokenInfo.app_id);
    console.log('📅 Creado:', new Date(tokenInfo.issued_at * 1000).toLocaleString());
    console.log('⏰ Expira:', tokenInfo.expires_at ? new Date(tokenInfo.expires_at * 1000).toLocaleString() : 'Nunca');
    
    // Calcular días restantes
    if (tokenInfo.expires_at) {
      const now = Math.floor(Date.now() / 1000);
      const daysLeft = Math.ceil((tokenInfo.expires_at - now) / (24 * 60 * 60));
      console.log('📅 Días restantes:', daysLeft);
      
      if (daysLeft < 5) {
        console.log('⚠️  ¡ATENCIÓN! Token expira pronto');
      } else if (daysLeft < 30) {
        console.log('⚠️  Token expira en menos de 30 días');
      } else {
        console.log('✅ Token tiene buena duración');
      }
    }
    
    // Verificar permisos
    console.log('\n🔐 PERMISOS:');
    if (tokenInfo.scopes) {
      tokenInfo.scopes.forEach(scope => {
        console.log(`  - ${scope}`);
      });
    }
    
    // Verificar tipo de token
    console.log('\n🏷️  TIPO DE TOKEN:');
    if (tokenInfo.type === 'PAGE') {
      console.log('✅ Es un TOKEN DE PÁGINA (60 días)');
    } else if (tokenInfo.type === 'USER') {
      console.log('⚠️  Es un TOKEN DE USUARIO (corta duración)');
      console.log('💡 Recomendación: Cambiar a token de página');
    } else {
      console.log(`ℹ️  Tipo: ${tokenInfo.type}`);
    }
    
    // Verificar si es para WhatsApp
    console.log('\n📱 WHATSAPP:');
    if (tokenInfo.scopes && tokenInfo.scopes.includes('whatsapp_business_messaging')) {
      console.log('✅ Tiene permisos de WhatsApp Business');
    } else {
      console.log('❌ No tiene permisos de WhatsApp Business');
    }
    
  } catch (error) {
    console.error('❌ Error al verificar token:', error.response?.data || error.message);
    
    if (error.response?.data?.error?.code === 190) {
      console.log('\n💡 SUGERENCIA:');
      console.log('El token parece ser inválido o haber expirado.');
      console.log('Necesitas obtener un nuevo token de página desde Facebook Developers.');
    }
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  checkTokenType();
}

module.exports = { checkTokenType }; 