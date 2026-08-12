# Guía para Múltiples Instancias de UltraMsg con Firebase

Esta guía te explica cómo configurar tu backend para manejar múltiples proyectos de UltraMsg usando Firebase como base de datos para almacenar las credenciales.

## 🎯 Problema Resuelto

Tienes dos (o más) proyectos en UltraMsg y cada uno te proporciona sus propias llaves:
- Token de API
- Instance ID
- Webhook Token

Pero quieres que ambos usen el mismo backend y que las credenciales se almacenen en Firebase para mayor flexibilidad.

## ✅ Solución Implementada

El sistema ahora:
1. **Lee las credenciales desde Firebase** en lugar de variables de entorno
2. **Configura automáticamente las instancias** basándose en los clientes de Firebase
3. **Identifica qué instancia envió cada mensaje** usando el webhook token
4. **Usa la instancia correcta** para responder a cada mensaje

## 🔧 Configuración en Firebase

### 1. Estructura de Datos en Firebase

Cada cliente en Firebase debe tener estos campos para UltraMsg:

```json
{
  "name": "Consultorio Dra. García",
  "adminPhone": "5216181020927@c.us",
  "assistantPhone": "5216182191002",
  "assistantId": "asst_KGIIBdi0uGXm0rvZQYpVTBoe",
  "botStatus": "active",
  "status": "active",
  
  // Credenciales de UltraMsg
  "ULTRAMSG_TOKEN": "rc06r3hzymuzm25i",
  "ULTRAMSG_INSTANCE_ID": "instance132663",
  "ULTRAMSG_WEBHOOK_TOKEN": "rc06r3hzymuzm25i",
  
  "createdAt": "2025-07-23T20:32:53.000Z",
  "updatedAt": "2025-07-23T23:21:42.000Z"
}
```

### 2. Campos Requeridos para UltraMsg

Para que un cliente funcione con UltraMsg, debe tener estos campos:

| Campo | Descripción | Ejemplo |
|-------|-------------|---------|
| `ULTRAMSG_TOKEN` | Token de API de UltraMsg | `"rc06r3hzymuzm25i"` |
| `ULTRAMSG_INSTANCE_ID` | ID de la instancia de UltraMsg | `"instance132663"` |
| `ULTRAMSG_WEBHOOK_TOKEN` | Token del webhook (puede ser el mismo que ULTRAMSG_TOKEN) | `"rc06r3hzymuzm25i"` |
| `assistantPhone` | Número de teléfono del asistente | `"5216182191002"` |
| `botStatus` | Estado del bot | `"active"` |

### 3. Configuración en UltraMsg

Para cada proyecto en UltraMsg:

1. Ve a la configuración del webhook
2. Configura la URL: `http://tu-servidor.com/webhook`
3. Usa el webhook token que configuraste en Firebase
4. Guarda la configuración

## 🔄 Flujo de Funcionamiento

### 1. Inicialización del Sistema

Al iniciar el servidor:

1. **Lee todos los clientes** desde Firebase
2. **Configura las instancias** de UltraMsg basándose en los clientes
3. **Verifica la conexión** de cada instancia
4. **Muestra el estado** de todas las instancias

### 2. Recepción de Mensajes

Cuando llega un mensaje al webhook:

1. **Identifica la instancia** usando el webhook token
2. **Procesa el mensaje** con la lógica de negocio
3. **Responde usando la misma instancia** que recibió el mensaje

### 3. Separación de Datos

- Cada instancia mantiene sus propios mensajes
- Los clientes se configuran por número de teléfono
- El contexto de usuario se mantiene separado por instancia

## 🛠️ Comandos de Prueba

### Verificar Configuración

```bash
# Probar configuración desde Firebase
node test/test-firebase-ultramsg.js
```

### Ver Estado del Servidor

```bash
# Ver todas las instancias
curl http://localhost:3000/ultramsg/instances

# Ver información de una instancia específica
curl http://localhost:3000/ultramsg/instances/instance132663

# Ver estado del servidor
curl http://localhost:3000/health
```

### Enviar Mensaje de Prueba

```bash
# Enviar mensaje usando una instancia específica
curl -X POST http://localhost:3000/ultramsg/instances/instance132663/send \
  -H "Content-Type: application/json" \
  -d '{"to": "5216181344331@c.us", "message": "Prueba desde Firebase"}'
```

## 📊 Logs del Sistema

Al iniciar el servidor verás algo como:

```
🔄 Inicializando instancias UltraMsg desde Firebase...
✅ Instancia UltraMsg configurada: Consultorio Dra. García (instance132663)
📱 Total de instancias UltraMsg configuradas: 1

- Estado de instancias UltraMsg:
  ✅ Consultorio Dra. García (instance132663): Conectado
    📱 Número: +1234567890
```

## 🔍 Endpoints Disponibles

### Gestión de Instancias

- `GET /ultramsg/instances` - Ver todas las instancias
- `GET /ultramsg/instances/:instanceId` - Ver instancia específica
- `POST /ultramsg/instances/:instanceId/send` - Enviar mensaje

### Gestión de Clientes

- `GET /clients` - Ver todos los clientes
- `GET /clients/:clientId` - Ver cliente específico
- `POST /clients/reload` - Recargar clientes desde Firebase

### Utilidades

- `GET /health` - Estado del servidor
- `POST /test` - Endpoint de prueba

## 🚨 Consideraciones Importantes

### 1. Webhook URL Única

Todos los proyectos de UltraMsg deben usar la misma URL de webhook:
```
http://tu-servidor.com/webhook
```

### 2. Tokens Únicos

Cada proyecto debe tener su propio webhook token para que el sistema pueda identificarlos.

### 3. Configuración en Firebase

Asegúrate de que cada cliente en Firebase tenga:
- Las credenciales de UltraMsg configuradas
- El `botStatus` en "active"
- Un `assistantPhone` válido

### 4. Monitoreo

Usa los endpoints de gestión para monitorear el estado de todas las instancias regularmente.

## 🔧 Personalización Avanzada

### Identificación de Instancia por Número de Teléfono

Si quieres que cada instancia maneje números específicos, puedes modificar el método `identifyInstanceFromMessage` en `webhookManager.js`:

```javascript
identifyInstanceFromMessage(messageData, webhookToken = null) {
  // Si tenemos el token del webhook, identificar por él
  if (webhookToken) {
    for (const [instanceId, instance] of this.ultraMsgManager.instances) {
      if (instance.webhookToken && webhookToken === instance.webhookToken) {
        return instanceId;
      }
    }
  }
  
  // Identificar por número de teléfono del asistente
  const assistantPhone = messageData.to || messageData.from;
  
  // Buscar instancia que maneje este número
  for (const [instanceId, instance] of this.ultraMsgManager.instances) {
    if (instance.assistantPhone === assistantPhone) {
      return instanceId;
    }
  }
  
  // Usar instancia por defecto
  return this.ultraMsgManager.getDefaultInstance()?.instanceId || null;
}
```

## 🔍 Troubleshooting

### Instancia no se conecta

1. Verifica que las credenciales en Firebase sean correctas
2. Revisa los logs del servidor
3. Usa el endpoint `/ultramsg/instances` para ver el estado

### Mensajes no llegan

1. Verifica que el webhook esté configurado correctamente en UltraMsg
2. Asegúrate de que el webhook token coincida con el de Firebase
3. Revisa los logs del servidor

### Respuestas van a la instancia incorrecta

1. Verifica la configuración de identificación de instancia
2. Revisa los logs para ver qué instancia se está usando
3. Considera personalizar la lógica de identificación

### Error de conexión con Firebase

1. Verifica las credenciales de Firebase en las variables de entorno
2. Asegúrate de que el proyecto de Firebase esté configurado correctamente
3. Revisa los permisos de la cuenta de servicio

## 📞 Soporte

Si tienes problemas con la configuración:

1. Ejecuta `node test/test-firebase-ultramsg.js` para diagnosticar
2. Revisa los logs del servidor
3. Usa los endpoints de diagnóstico
4. Verifica la configuración en Firebase y UltraMsg

## 🎉 Beneficios de esta Configuración

1. **Gestión centralizada** de credenciales en Firebase
2. **Configuración dinámica** sin reiniciar el servidor
3. **Múltiples instancias** con un solo backend
4. **Identificación automática** de instancias
5. **Monitoreo centralizado** de todas las instancias
6. **Escalabilidad** para agregar más proyectos fácilmente

¡Con esta configuración, puedes manejar múltiples proyectos de UltraMsg usando Firebase como base de datos centralizada! 🚀 