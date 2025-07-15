# Solución: Token de Facebook de Corta Duración

## 🔍 **Diagnóstico del Problema**

### **Primero, verifica tu token actual:**

```bash
npm run check-token
```

Este comando te dirá:
- ✅ Si tu token es válido
- 📅 Cuántos días le quedan
- 🏷️ Qué tipo de token es (usuario vs página)
- 🔐 Qué permisos tiene

## 🎯 **Problema Común: Token de Usuario vs Token de Página**

### **Token de Usuario (❌ Problema)**
- **Duración**: 1-2 horas o máximo 60 días
- **Renovación**: Requiere interacción del usuario
- **Uso**: Para desarrollo/pruebas

### **Token de Página (✅ Solución)**
- **Duración**: 60 días
- **Renovación**: Automática con refresh
- **Uso**: Para producción

## 🛠️ **Solución: Obtener Token de Página**

### **Paso 1: Ir a Facebook Developers**

1. Ve a [Facebook Developers](https://developers.facebook.com/)
2. Selecciona tu aplicación
3. Ve a **WhatsApp > Configuration**

### **Paso 2: Obtener Token de Página**

En la sección **WhatsApp Business Account**:

1. **Busca tu Phone Number ID**
2. **Busca el Access Token** (este es el token de página)
3. **Copia ambos valores**

### **Paso 3: Actualizar Variables de Entorno**

```env
# En tu archivo .env
WHATSAPP_TOKEN=tu-token-de-pagina-aqui
PHONE_NUMBER_ID=tu-phone-number-id-aqui
```

### **Paso 4: Verificar el Nuevo Token**

```bash
npm run check-token
```

Deberías ver:
```
✅ Es un TOKEN DE PÁGINA (60 días)
📅 Días restantes: 60
✅ Tiene permisos de WhatsApp Business
```

## 🔄 **Sistema de Refresh Automático**

### **¿Por Qué Necesitas FB_APP_ID y FB_APP_SECRET?**

Para que el refresh automático funcione, necesitas:

```env
# Facebook App Configuration (para refresh automático)
FB_APP_ID=tu-facebook-app-id
FB_APP_SECRET=tu-facebook-app-secret
```

### **Cómo Obtenerlos:**

1. En Facebook Developers, ve a **Configuración > Básica**
2. Copia **ID de la aplicación** → `FB_APP_ID`
3. Copia **Secreto de la aplicación** → `FB_APP_SECRET`

### **Verificar Configuración:**

```bash
npm run token-status
```

## 🚀 **Configuración Completa para Producción**

### **Archivo .env Completo:**

```env
# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key
ASISTENTE_ID=asst-your-assistant-id

# WhatsApp Configuration (TOKEN DE PÁGINA)
WHATSAPP_TOKEN=tu-token-de-pagina-de-60-dias
WHATSAPP_VERIFY_TOKEN=tu-verify-token
PHONE_NUMBER_ID=tu-phone-number-id

# Facebook App Configuration (para refresh automático)
FB_APP_ID=tu-facebook-app-id
FB_APP_SECRET=tu-facebook-app-secret

# Server Configuration
PORT=3000
```

### **Verificar Todo:**

```bash
# Verificar token
npm run check-token

# Verificar estado del sistema de refresh
npm run token-status

# Probar envío de mensaje
npm run test-webhook
```

## 🔧 **Solución de Problemas**

### **Error: "Session has expired"**

**Causa**: Token expirado
**Solución**:
```bash
# 1. Obtener nuevo token de página desde Facebook Developers
# 2. Actualizar WHATSAPP_TOKEN en .env
# 3. Verificar
npm run check-token
```

### **Error: "Invalid token"**

**Causa**: Token incorrecto o de usuario
**Solución**:
1. Asegúrate de usar token de **página**, no de usuario
2. Verifica que sea el token de WhatsApp Business, no de Facebook normal

### **Error: "Missing permissions"**

**Causa**: Token sin permisos de WhatsApp
**Solución**:
1. Asegúrate de que tu app tenga **WhatsApp Business API** habilitado
2. Verifica que el token tenga permisos de `whatsapp_business_messaging`

### **Refresh Automático No Funciona**

**Causa**: Falta FB_APP_ID o FB_APP_SECRET
**Solución**:
1. Agregar las variables al .env
2. Reiniciar el servidor
3. Verificar con `npm run token-status`

## 📊 **Monitoreo en Producción**

### **Comandos Útiles:**

```bash
# Verificar estado del token
npm run check-token

# Ver estado del sistema de refresh
npm run token-status

# Refresh manual si es necesario
npm run refresh-token

# Ver logs del servidor
npm run dev
```

### **Logs a Monitorear:**

```
✅ Token válido, expira en 45 días
🔄 Refresh automático configurado
📱 WhatsApp Business API funcionando
```

## ⚠️ **Consideraciones Importantes**

### **Seguridad:**
- Nunca compartas tu `FB_APP_SECRET`
- Usa variables de entorno, no hardcodees tokens
- Rota tokens regularmente

### **Rate Limits:**
- WhatsApp tiene límites de mensajes por día
- Respeta los rate limits de Facebook API

### **Backup:**
- Guarda una copia de tu token de página
- Ten un plan de contingencia si expira

## 🎯 **Resumen de la Solución**

1. **Diagnosticar**: `npm run check-token`
2. **Obtener token de página** desde Facebook Developers
3. **Configurar variables**: WHATSAPP_TOKEN, FB_APP_ID, FB_APP_SECRET
4. **Verificar**: `npm run check-token` y `npm run token-status`
5. **Monitorear**: Revisar logs regularmente

### **Resultado Esperado:**
- ✅ Token de 60 días de duración
- ✅ Refresh automático funcionando
- ✅ Sin interrupciones en producción
- ✅ Mensajes enviándose correctamente

¡Con esta configuración, tu token durará 60 días y se renovará automáticamente! 🎉 