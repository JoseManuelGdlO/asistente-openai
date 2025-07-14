# Sistema de Detección de Confirmaciones

Este sistema resuelve el problema de que el bot procese mensajes de confirmación simple (como "muy bien gracias") como nuevas consultas y vuelva a enviar la agenda.

## 🎯 Problema Resuelto

**Antes**: Cuando envías la agenda del día y el usuario responde "muy bien gracias", el bot interpreta esto como una nueva conversación y vuelve a enviar la agenda.

**Ahora**: El sistema detecta automáticamente los mensajes de confirmación y responde apropiadamente sin procesar con IA.

## 🔧 Cómo Funciona

### 1. Detección de Confirmaciones

El sistema detecta mensajes de confirmación usando patrones predefinidos:

- **Palabras simples**: "ok", "vale", "si", "sí", "perfecto", "gracias"
- **Frases cortas**: "muy bien gracias", "perfecto gracias", "está bien"
- **Emojis**: 👍, ✅, 👌, 😊, 🙏
- **Mensajes cortos**: Cualquier mensaje de menos de 10 caracteres que contenga palabras de confirmación

### 2. Contexto de Usuario

Cada usuario tiene un contexto que incluye:
- `lastMessageType`: Tipo del último mensaje ("confirmation", "agenda_sent", etc.)
- `lastMessageTime`: Timestamp del último mensaje
- `confirmationCount`: Número de confirmaciones recibidas
- `isWaitingForConfirmation`: Si estamos esperando una confirmación

### 3. Flujo de Trabajo

1. **Enviar agenda**: Usas el endpoint `/mark-agenda-sent` para marcar que enviaste la agenda
2. **Usuario responde**: Si es confirmación y estamos esperando confirmación, responde automáticamente
3. **Otras respuestas**: Si no es confirmación o no estamos esperando confirmación, procesa normalmente con IA

## 📋 Endpoints Disponibles

### Marcar Agenda Enviada
```bash
POST /mark-agenda-sent
Content-Type: application/json

{
  "userId": "34612345678"
}
```

**Respuesta:**
```json
{
  "ok": true,
  "message": "Usuario 34612345678 marcado como agenda enviada",
  "context": {
    "lastMessageType": "agenda_sent",
    "lastMessageTime": "2024-01-15T10:30:00.000Z",
    "confirmationCount": 0,
    "isWaitingForConfirmation": true
  }
}
```

### Ver Contexto de Usuario
```bash
GET /user-context/34612345678
```

**Respuesta:**
```json
{
  "ok": true,
  "userId": "34612345678",
  "context": {
    "lastMessageType": "confirmation",
    "lastMessageTime": "2024-01-15T10:35:00.000Z",
    "confirmationCount": 1,
    "isWaitingForConfirmation": false
  }
}
```

### Limpiar Contexto de Usuario
```bash
POST /clear-user-context/34612345678
```

**Respuesta:**
```json
{
  "ok": true,
  "message": "Contexto limpiado para usuario 34612345678"
}
```

## 🚀 Implementación en tu Sistema

### Paso 1: Modificar tu script de envío de agenda

```javascript
const axios = require('axios');

async function sendAgendaToUser(userPhone, agendaMessage) {
  try {
    // 1. Enviar mensaje de agenda (tu código actual)
    await sendWhatsAppMessage(userPhone, agendaMessage);
    
    // 2. Marcar que se envió la agenda
    await axios.post('http://localhost:3000/mark-agenda-sent', {
      userId: userPhone
    });
    
    console.log(`✅ Agenda enviada y marcada para ${userPhone}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
}
```

### Paso 2: Ejemplo de uso

```javascript
// Enviar agenda del día
const appointments = getTodaysAppointments();

for (const appointment of appointments) {
  const message = `¡Hola ${appointment.name}! 
  
Tienes cita hoy a las ${appointment.time}.
Por favor confirma con "ok" o "confirmado".`;

  await sendAgendaToUser(appointment.phone, message);
}
```

## 📝 Patrones de Confirmación Detectados

El sistema detecta automáticamente estos tipos de mensajes:

### Palabras simples
- "ok", "okay", "vale", "si", "sí", "yes", "yep", "yeah"
- "perfecto", "genial", "excelente"
- "gracias", "thank you", "thanks"
- "claro", "por supuesto"

### Frases comunes
- "muy bien gracias", "perfecto gracias", "ok gracias"
- "está bien", "esta bien", "está perfecto"
- "confirmado", "confirmo", "acepto", "aceptado"

### Emojis
- 👍, ✅, 👌, 😊, 🙏

### Mensajes cortos
- Cualquier mensaje de menos de 10 caracteres que contenga palabras de confirmación

## 🔍 Monitoreo y Debug

### Ver logs en tiempo real
```bash
npm run dev
```

Los logs mostrarán:
```
Mensaje del usuario: muy bien gracias
¿Es confirmación? true
Contexto del usuario: { isWaitingForConfirmation: true, ... }
Mensaje de confirmación detectado, respondiendo automáticamente
```

### Verificar contexto de usuario
```bash
curl http://localhost:3000/user-context/34612345678
```

### Limpiar contexto si es necesario
```bash
curl -X POST http://localhost:3000/clear-user-context/34612345678
```

## 🛠️ Personalización

### Agregar nuevos patrones de confirmación

Edita el array `confirmationPatterns` en `src/index.js`:

```javascript
const confirmationPatterns = [
  // Patrones existentes...
  /^(tu-patron-personalizado)$/i,
  /^(otro-patron)$/i
];
```

### Cambiar la respuesta de confirmación

Edita la variable `confirmationResponse` en el webhook:

```javascript
const confirmationResponse = "Tu mensaje personalizado aquí 😊";
```

## ⚠️ Consideraciones Importantes

1. **Persistencia**: El contexto se mantiene en memoria, se pierde al reiniciar el servidor
2. **Limpieza**: Considera limpiar contextos antiguos periódicamente
3. **Rate Limits**: Respeta los límites de WhatsApp al enviar mensajes
4. **Testing**: Prueba con diferentes tipos de confirmaciones antes de usar en producción

## 🔄 Flujo Completo de Ejemplo

1. **08:00** - Script envía agenda a Juan: "Tienes cita a las 10:00"
2. **08:01** - Script marca: `POST /mark-agenda-sent` con userId de Juan
3. **08:05** - Juan responde: "muy bien gracias"
4. **08:05** - Bot detecta confirmación y responde: "¡Perfecto! Me alegra saber que todo está bien..."
5. **08:06** - Juan pregunta: "¿Puedo cambiar la hora?"
6. **08:06** - Bot procesa normalmente con IA (no es confirmación)

¡El problema está resuelto! 🎉 