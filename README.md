# 🤖 WhatsApp AI Assistant

Un asistente inteligente de WhatsApp que integra OpenAI GPT-4 para responder mensajes automáticamente, con sistema de confirmaciones y tareas programadas.

## 🚀 Características

- **🤖 IA Avanzada**: Integración con OpenAI GPT-4
- **📱 UltraMsg**: Comunicación estable con WhatsApp
- **✅ Confirmaciones**: Detección automática de mensajes de confirmación
- **👤 Contexto**: Gestión de contexto de conversación por usuario
- **⏰ Tareas Programadas**: Envío automático de agenda diaria
- **🏗️ Arquitectura Modular**: Código organizado y mantenible
- **📱 Detección de Grupos**: Ignora automáticamente mensajes de grupos de WhatsApp

## 📁 Estructura del Proyecto

```
src/
├── index.js                    # 🚀 Punto de entrada principal
├── managers/                   # 🔌 Gestores de servicios externos
│   ├── openAIManager.js       # 🤖 Gestor de OpenAI
│   ├── ultramsgManager.js     # 📱 Gestor de UltraMsg
│   └── facebookTokenManager.js # 🔑 Gestor de tokens Facebook
├── services/                   # ⚙️ Servicios de negocio
│   ├── confirmationManager.js  # ✅ Gestor de confirmaciones
│   ├── userContextManager.js   # 👤 Gestor de contexto de usuario
│   └── scheduler.js           # ⏰ Scheduler de tareas
├── controllers/                # 🎮 Controladores de endpoints
│   ├── webhookManager.js      # 🌐 Controlador de webhooks
│   └── schedulerController.js # 🎛️ Controlador del scheduler
├── utils/                      # 🛠️ Utilidades (futuro)
└── README.md                   # 📚 Documentación de la estructura
```

## ⚙️ Configuración

### 1. Instalar Dependencias
```bash
npm install
```

### 2. Configurar Variables de Entorno
Crea un archivo `.env` en la raíz del proyecto:

```env
# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key
ASISTENTE_ID=asst-your-assistant-id

# UltraMsg Configuration
ULTRAMSG_TOKEN=tu-token-de-ultramsg
ULTRAMSG_INSTANCE_ID=tu-instance-id
ULTRAMSG_WEBHOOK_TOKEN=tu-webhook-token

# Server Configuration
PORT=3000
```

### 3. Configurar UltraMsg
1. Crea una cuenta en [UltraMsg](https://ultramsg.com)
2. Crea una instancia y escanea el código QR
3. Obtén el **Token** e **Instance ID**
4. Configura el webhook URL: `https://tu-dominio.com/webhook`

### 4. Crear Asistente de OpenAI
```bash
npm run create-assistant
```

## 🚀 Ejecutar el Servidor

### Desarrollo
```bash
npm run dev
```

### Producción
```bash
npm start
```

### Exponer con ngrok (para desarrollo)
```bash
npm run ngrok
```

## 📡 Endpoints Disponibles

### Webhooks
- `GET /webhook` - Verificación de webhook UltraMsg
- `POST /webhook` - Recepción de mensajes de WhatsApp

### Gestión de Threads
- `POST /reset_threads` - Resetear todos los threads de OpenAI

### Contexto de Usuario
- `POST /mark-agenda-sent` - Marcar agenda enviada a un usuario
- `GET /user-context/:userId` - Obtener contexto de un usuario
- `POST /clear-user-context/:userId` - Limpiar contexto de un usuario

### Scheduler
- `GET /scheduler/status` - Estado de tareas programadas
- `POST /scheduler/run/:taskName` - Ejecutar tarea manualmente
- `POST /scheduler/stop` - Detener todas las tareas
- `POST /scheduler/restart` - Reiniciar tareas

### Configuración de Grupos
- `GET /group-settings` - Ver configuración de comportamiento en grupos

### Utilidad
- `GET /health` - Health check
- `POST /test` - Test endpoint

## ⏰ Tareas Programadas

El sistema incluye tareas automáticas:

- **📅 Agenda Diaria**: Envía recordatorios a las 10:00 AM
- **🧹 Limpieza Semanal**: Limpia datos antiguos los domingos
- **🔍 Verificación de Estado**: Verifica conexión cada hora

### Verificar Estado
```bash
curl http://localhost:3000/scheduler/status
```

### Ejecutar Manualmente
```bash
curl -X POST http://localhost:3000/scheduler/run/dailyAgenda
```

## 📱 Detección de Grupos

El sistema detecta automáticamente los mensajes que provienen de grupos de WhatsApp y los ignora para evitar respuestas no deseadas.

### Características
- **Detección Automática**: Identifica mensajes de grupos por múltiples métodos
- **Ignorado Silencioso**: Los mensajes de grupos no generan respuestas
- **Logging Detallado**: Registra información sobre grupos detectados
- **Configuración Flexible**: Endpoint para verificar configuración

### Métodos de Detección
1. **Formato de ID**: Verifica si `from` termina en `@g.us`
2. **Campo isGroup**: Verifica si `chat.isGroup` es `true`
3. **ID de Chat**: Verifica si `chat.id` termina en `@g.us`

### Verificar Configuración
```bash
curl http://localhost:3000/group-settings
```

### Probar Detección
```bash
npm run test-groups
```

## 🧪 Testing

### Probar UltraMsg
```bash
npm run test-ultramsg
```

### Probar Scheduler
```bash
npm run test-scheduler
```

### Probar Webhook
```bash
npm run test-webhook
```

### Probar Grupos
```bash
npm run test-groups
```

## 📚 Documentación

- `src/README.md` - Documentación detallada de la estructura
- `SCHEDULER_GUIDE.md` - Guía completa del sistema de tareas programadas

## 🔧 Scripts Disponibles

- `npm start` - Iniciar servidor en producción
- `npm run dev` - Iniciar servidor en desarrollo con nodemon
- `npm run ngrok` - Exponer servidor con ngrok
- `npm run test-ultramsg` - Probar conexión con UltraMsg
- `npm run test-scheduler` - Probar sistema de tareas
- `npm run test-webhook` - Probar webhook
- `npm run test-groups` - Probar detección de grupos
- `npm run create-assistant` - Crear nuevo asistente de OpenAI
- `npm run list-assistants` - Listar asistentes existentes

## 🏗️ Arquitectura

El proyecto utiliza una arquitectura modular con separación de responsabilidades:

- **Managers**: Gestores de servicios externos (OpenAI, UltraMsg)
- **Services**: Lógica de negocio (confirmaciones, contexto, scheduler)
- **Controllers**: Manejo de peticiones HTTP
- **Utils**: Utilidades y helpers

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

---

**¡Disfruta usando tu asistente inteligente de WhatsApp! 🤖✨** 