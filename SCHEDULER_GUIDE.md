# Sistema de Tareas Programadas

## 🕐 **¿Qué Es?**

Un sistema que ejecuta automáticamente tareas específicas en horarios programados, como enviar la agenda diaria a las 10:00 AM.

## 📅 **Tareas Configuradas**

### **1. Agenda Diaria (10:00 AM)**
- **Horario**: Todos los días a las 10:00 AM
- **Función**: Envía recordatorios de citas a los pacientes
- **Cron**: `0 10 * * *`

### **2. Limpieza Semanal (Domingos 2:00 AM)**
- **Horario**: Domingos a las 2:00 AM
- **Función**: Limpia datos antiguos y logs
- **Cron**: `0 2 * * 0`

### **3. Verificación de Estado (Cada Hora)**
- **Horario**: Cada hora en punto
- **Función**: Verifica que UltraMsg esté conectado
- **Cron**: `0 * * * *`

## 🚀 **Cómo Usar**

### **1. El Sistema Se Inicia Automáticamente**
Cuando arrancas el servidor, las tareas se programan automáticamente:

```bash
npm start
```

Verás en los logs:
```
🕐 Inicializando tareas programadas...
📅 Agenda diaria programada para las 10:00 AM
🧹 Limpieza semanal programada para domingos a las 2:00 AM
🔍 Verificación de estado programada cada hora
✅ Tareas programadas inicializadas
```

### **2. Verificar Estado de las Tareas**
```bash
curl http://localhost:3000/scheduler/status
```

Respuesta:
```json
{
  "ok": true,
  "tasks": {
    "dailyAgenda": {
      "running": true,
      "scheduled": true
    },
    "weeklyCleanup": {
      "running": true,
      "scheduled": true
    },
    "statusCheck": {
      "running": true,
      "scheduled": true
    }
  },
  "timestamp": "2024-01-15T10:00:00.000Z"
}
```

### **3. Ejecutar Tarea Manualmente**
```bash
# Ejecutar agenda diaria ahora
curl -X POST http://localhost:3000/scheduler/run/dailyAgenda

# Ejecutar verificación de estado
curl -X POST http://localhost:3000/scheduler/run/statusCheck

# Ejecutar limpieza semanal
curl -X POST http://localhost:3000/scheduler/run/weeklyCleanup
```

### **4. Detener/Reiniciar Tareas**
```bash
# Detener todas las tareas
curl -X POST http://localhost:3000/scheduler/stop

# Reiniciar tareas
curl -X POST http://localhost:3000/scheduler/restart
```

## 🧪 **Probar el Sistema**

### **Probar Todas las Funciones:**
```bash
npm run test-scheduler
```

### **Probar Solo la Agenda:**
```bash
curl -X POST http://localhost:3000/scheduler/run/dailyAgenda
```

## ⏰ **Configurar Horarios**

### **Cambiar Hora de la Agenda Diaria**

Edita `src/scheduler.js`:

```javascript
// Cambiar de 10:00 AM a 9:00 AM
scheduleDailyAgenda() {
  const task = cron.schedule('0 9 * * *', async () => {
    // ... código ...
  });
}
```

### **Expresiones Cron Comunes**

| Expresión | Descripción |
|-----------|-------------|
| `0 10 * * *` | Todos los días a las 10:00 AM |
| `0 9 * * 1-5` | Lunes a viernes a las 9:00 AM |
| `0 8,12,18 * * *` | 8:00 AM, 12:00 PM, 6:00 PM |
| `0 */2 * * *` | Cada 2 horas |
| `0 0 * * 0` | Domingos a medianoche |

### **Zonas Horarias**

Cambia la zona horaria en `src/scheduler.js`:

```javascript
// Para España
timezone: "Europe/Madrid"

// Para México
timezone: "America/Mexico_City"

// Para Colombia
timezone: "America/Bogota"
```

## 📱 **Integración con Google Calendar**

### **Conectar con Google Calendar**

Edita `src/scheduler.js` en la función `getTodaysAppointments()`:

```javascript
async getTodaysAppointments() {
  // TODO: Implementar conexión con Google Calendar
  const { google } = require('googleapis');
  
  // Configurar credenciales
  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  
  const calendar = google.calendar({ version: 'v3', auth });
  
  // Obtener eventos del día
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
  
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });
  
  return response.data.items.map(event => ({
    name: event.summary,
    phone: event.extendedProperties?.private?.phone || 'No disponible',
    time: new Date(event.start.dateTime).toLocaleTimeString('es-ES', { 
      hour: '2-digit', 
      minute: '2-digit' 
    }),
    service: event.description || 'Sin descripción',
    date: today.toISOString().split('T')[0]
  }));
}
```

## 🔧 **Personalizar Mensajes**

### **Cambiar el Mensaje de la Agenda**

Edita `src/scheduler.js` en la función `sendAgendaToUser()`:

```javascript
const message = `¡Hola ${appointment.name}! 👋

📅 Tienes una cita programada para hoy (${today}) a las ${appointment.time}.

🏥 Servicio: ${appointment.service}

Por favor confirma que asistirás respondiendo con "ok", "confirmado" o similar.

¡Te esperamos! 😊`;
```

## 📊 **Monitoreo y Logs**

### **Logs Automáticos**

El sistema registra automáticamente:

```
📅 === EJECUTANDO AGENDA DIARIA ===
Hora: 15/1/2024, 10:00:00
📅 Encontradas 3 citas para hoy
📱 Enviando agenda a Juan Pérez (34612345678)
✅ Agenda enviada a Juan Pérez
✅ Agenda diaria completada exitosamente
```

### **Verificar Logs en Tiempo Real**

```bash
npm run dev
```

## ⚠️ **Consideraciones Importantes**

### **1. Zona Horaria**
- Asegúrate de configurar la zona horaria correcta
- El servidor debe estar en la zona horaria correcta

### **2. Persistencia**
- Las tareas se detienen si el servidor se reinicia
- Considera usar PM2 o similar para mantener el servidor activo

### **3. Rate Limits**
- El sistema espera 1 segundo entre envíos de mensajes
- Respeta los límites de UltraMsg

### **4. Manejo de Errores**
- Los errores se registran pero no detienen otras tareas
- Revisa los logs regularmente

## 🎯 **Ejemplo de Uso Completo**

### **1. Iniciar Servidor**
```bash
npm start
```

### **2. Verificar Estado**
```bash
curl http://localhost:3000/scheduler/status
```

### **3. Probar Agenda Manualmente**
```bash
curl -X POST http://localhost:3000/scheduler/run/dailyAgenda
```

### **4. Monitorear Logs**
```bash
npm run dev
```

## 🚀 **Próximos Pasos**

1. **Conectar con Google Calendar** para obtener citas reales
2. **Agregar notificaciones** al administrador si algo falla
3. **Configurar múltiples horarios** para diferentes tipos de recordatorios
4. **Agregar estadísticas** de envíos y confirmaciones

¡Con este sistema tendrás automatizado el envío de recordatorios de citas! 🎉 