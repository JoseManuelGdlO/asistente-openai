# Debug de Webhook de WhatsApp

## Problema
Los mensajes de WhatsApp no están llegando al servidor.

## Pasos para debuggear

### 1. Verificar configuración de variables de entorno
Crea un archivo `.env` en la raíz del proyecto con las siguientes variables:

```
OPENAI_API_KEY=tu-api-key-de-openai
ASISTENTE_ID=tu-assistant-id
WHATSAPP_TOKEN=tu-token-de-whatsapp
WHATSAPP_VERIFY_TOKEN=tu-verify-token
PORT=3000
```

### 2. Verificar que el servidor está funcionando
```bash
npm start
```

Deberías ver en la consola:
- Las URLs disponibles
- El estado de las variables de entorno (configuradas o no)

### 3. Probar endpoints locales
```bash
# Probar health check
curl http://localhost:3000/health

# Probar endpoint de test
curl -X POST http://localhost:3000/test -H "Content-Type: application/json" -d '{"test":"data"}'
```

### 4. Probar webhook localmente
```bash
npm run test-webhook
```

### 5. Verificar configuración de ngrok
1. Ejecuta ngrok: `npm run ngrok`
2. Copia la URL HTTPS que te da ngrok
3. Verifica que la URL sea accesible desde internet

### 6. Verificar configuración en Meta Developer Console
1. Ve a https://developers.facebook.com/
2. Selecciona tu app
3. Ve a WhatsApp > Configuration
4. Verifica que la Webhook URL sea: `https://tu-url-ngrok.ngrok.io/webhook`
5. Verifica que el Verify Token coincida con `WHATSAPP_VERIFY_TOKEN`

### 7. Verificar logs del servidor
Cuando envíes un mensaje por WhatsApp, deberías ver en la consola:
- "=== Nueva petición recibida ==="
- Los headers y body de la petición
- El procesamiento del mensaje

### 8. Problemas comunes

#### No llegan peticiones al servidor
- Verificar que ngrok esté corriendo
- Verificar que la URL de ngrok esté configurada en Meta
- Verificar que el webhook esté verificado

#### Error 403 en verificación
- Verificar que el Verify Token coincida
- Verificar que la URL del webhook sea correcta

#### Error 500 en el servidor
- Verificar que las variables de entorno estén configuradas
- Verificar los logs de error en la consola

#### Mensajes no se procesan
- Verificar que el mensaje sea de tipo "text"
- Verificar que no esté duplicado (ID del mensaje)
- Verificar que las APIs de OpenAI estén funcionando

### 9. Comandos útiles

```bash
# Iniciar servidor en modo desarrollo
npm run dev

# Iniciar ngrok
npm run ngrok

# Probar webhook
npm run test-webhook

# Ver logs en tiempo real
tail -f logs.txt
``` 