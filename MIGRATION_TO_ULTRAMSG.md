# Migración de Meta/WhatsApp a UltraMsg

## 🎯 **¿Por Qué Cambiar a UltraMsg?**

### **Ventajas de UltraMsg:**
- ✅ **Sin problemas de tokens**: No hay tokens que expiren
- ✅ **Más simple**: Configuración más directa
- ✅ **Mejor soporte**: Documentación en español
- ✅ **Más económico**: Precios más competitivos
- ✅ **Sin límites estrictos**: Menos restricciones que Meta

### **Desventajas de Meta:**
- ❌ **Tokens que expiran**: Problemas constantes de renovación
- ❌ **Configuración compleja**: Múltiples tokens y permisos
- ❌ **Límites estrictos**: Rate limits y restricciones
- ❌ **Soporte limitado**: Documentación en inglés

## 🔄 **Cambios Necesarios**

### **1. Variables de Entorno**

**Antes (Meta):**
```env
WHATSAPP_TOKEN=tu-token-de-meta
PHONE_NUMBER_ID=tu-phone-number-id
FB_APP_ID=tu-facebook-app-id
FB_APP_SECRET=tu-facebook-app-secret
WHATSAPP_VERIFY_TOKEN=tu-verify-token
```

**Ahora (UltraMsg):**
```env
ULTRAMSG_TOKEN=tu-token-de-ultramsg
ULTRAMSG_INSTANCE_ID=tu-instance-id
ULTRAMSG_WEBHOOK_TOKEN=tu-webhook-token
```

### **2. Configuración en UltraMsg**

1. **Crear cuenta en UltraMsg**
   - Ve a [ultramsg.com](https://ultramsg.com)
   - Regístrate y crea una cuenta

2. **Crear una instancia**
   - En el dashboard, crea una nueva instancia
   - Escanea el código QR con WhatsApp
   - Anota el **Instance ID** y **Token**

3. **Configurar webhook**
   - Ve a la configuración de la instancia
   - Configura el webhook URL: `https://tu-dominio.com/webhook`
   - Anota el **Webhook Token**

### **3. Actualizar tu archivo .env**

```env
# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key
ASISTENTE_ID=asst-your-assistant-id

# UltraMsg Configuration (NUEVO)
ULTRAMSG_TOKEN=tu-token-de-ultramsg
ULTRAMSG_INSTANCE_ID=tu-instance-id
ULTRAMSG_WEBHOOK_TOKEN=tu-webhook-token

# Server Configuration
PORT=3000
```

## 🧪 **Probar la Configuración**

### **1. Verificar conexión:**
```bash
npm run test-ultramsg
```

Deberías ver:
```
✅ UltraMsg conectado: SÍ
📱 Número de UltraMsg: +34612345678
```

### **2. Probar envío de mensaje:**
Edita `test-ultramsg.js` y descomenta la sección de envío de mensaje.

### **3. Probar webhook:**
```bash
npm run test-webhook
```

## 🔧 **Diferencias en el Código**

### **Antes (Meta):**
```javascript
// Enviar mensaje
const response = await axios({
  method: 'POST',
  url: `https://graph.facebook.com/v17.0/${phone_number_id}/messages`,
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  data: {
    messaging_product: 'whatsapp',
    to: phone,
    text: { body: message }
  }
});
```

### **Ahora (UltraMsg):**
```javascript
// Enviar mensaje
const response = await ultraMsgManager.sendMessage(phone, message);
```

## 📱 **Estructura de Mensajes**

### **Mensajes Recibidos (UltraMsg):**
```javascript
{
  key: {
    remoteJid: "34612345678@s.whatsapp.net",
    id: "message-id"
  },
  message: {
    messageType: "conversation",
    conversation: "Hola, ¿cómo estás?"
  }
}
```

### **Mensajes Enviados (UltraMsg):**
```javascript
{
  to: "34612345678",
  body: "¡Hola! ¿En qué puedo ayudarte?",
  priority: 10
}
```

## 🚀 **Pasos para la Migración**

### **Paso 1: Configurar UltraMsg**
1. Crear cuenta en UltraMsg
2. Crear instancia y escanear QR
3. Obtener credenciales

### **Paso 2: Actualizar Variables**
1. Actualizar archivo `.env`
2. Eliminar variables de Meta

### **Paso 3: Probar Configuración**
```bash
npm run test-ultramsg
```

### **Paso 4: Configurar Webhook**
1. Configurar URL del webhook en UltraMsg
2. Probar recepción de mensajes

### **Paso 5: Reiniciar Servidor**
```bash
npm start
```

## 🔍 **Solución de Problemas**

### **Error: "Instance not connected"**
- Verifica que hayas escaneado el QR correctamente
- Asegúrate de que WhatsApp esté conectado a internet

### **Error: "Invalid token"**
- Verifica que el token sea correcto
- Asegúrate de que la instancia esté activa

### **Error: "Webhook not working"**
- Verifica que la URL del webhook sea accesible
- Asegúrate de que el webhook token sea correcto

### **Mensajes no llegan**
- Verifica que el webhook esté configurado en UltraMsg
- Revisa los logs del servidor

## 📊 **Monitoreo**

### **Comandos Útiles:**
```bash
# Verificar estado de UltraMsg
npm run test-ultramsg

# Ver logs del servidor
npm run dev

# Probar webhook
npm run test-webhook
```

### **Logs a Monitorear:**
```
✅ UltraMsg conectado: SÍ
📱 Número de UltraMsg: +34612345678
✅ Mensaje enviado via UltraMsg
```

## 🎉 **Beneficios Después de la Migración**

- ✅ **Sin más problemas de tokens**: UltraMsg no usa tokens que expiren
- ✅ **Configuración más simple**: Menos variables y configuraciones
- ✅ **Mejor rendimiento**: Menos latencia en el envío
- ✅ **Más confiable**: Menos interrupciones del servicio
- ✅ **Soporte en español**: Mejor atención al cliente

## 📞 **Soporte**

- **Documentación UltraMsg**: [docs.ultramsg.com](https://docs.ultramsg.com)
- **Soporte técnico**: Disponible en español
- **Comunidad**: Grupos de Telegram y Discord

¡Con UltraMsg tendrás un sistema más estable y fácil de mantener! 🚀 