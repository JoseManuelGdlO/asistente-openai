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
- **🎮 Sistema de Comandos**: Control remoto de bots por cliente con autenticación
- **🔥 Firebase Integration**: Gestión dinámica de clientes en la nube
- **📊 Múltiples Clientes**: Soporte para múltiples consultorios con asistentes independientes
- **🖥️ Panel admin**: SPA en el mismo contenedor (`/`) para gestionar consultorios, assistants y PDFs

## 📁 Estructura del Proyecto

```
src/
├── index.js                    # 🚀 Punto de entrada principal
├── managers/                   # 🔌 Gestores de servicios externos
│   ├── openAIManager.js       # 🤖 Gestor OpenAI Responses API
│   ├── ultramsgManager.js     # 📱 Gestor de UltraMsg
│   └── ownSystemManager.js    # 🏗️ Backend WhatsApp propio (OWN_SYSTEM)
├── services/                   # ⚙️ Servicios de negocio
│   ├── confirmationManager.js  # ✅ Gestor de confirmaciones
│   ├── userContextManager.js   # 👤 Gestor de contexto de usuario
│   └── scheduler.js           # ⏰ Scheduler de tareas
├── controllers/                # 🎮 Controladores de endpoints
│   ├── webhookManager.js      # 🌐 Controlador de webhooks
│   └── schedulerController.js # 🎛️ Controlador del scheduler
├── utils/                      # 🛠️ Utilidades (futuro)
└── README.md                   # 📚 Documentación de la estructura
public/                         # Panel admin (HTML + JS)
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
OPENAI_MODEL=gpt-4o-mini

# UltraMsg Configuration
ULTRAMSG_TOKEN=tu-token-de-ultramsg
ULTRAMSG_INSTANCE_ID=tu-instance-id
ULTRAMSG_WEBHOOK_TOKEN=tu-webhook-token

# Firebase Configuration
FIREBASE_PROJECT_ID=tu-proyecto-id
FIREBASE_CLIENT_EMAIL=tu-service-account@proyecto.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nTu-clave-privada-aqui\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=https://tu-proyecto-id.firebaseio.com

# Admin panel + API de gestión
ADMIN_API_TOKEN=change-me-to-a-long-random-secret

# Server Configuration
PORT=3000
```

### 3. Configurar UltraMsg
1. Crea una cuenta en [UltraMsg](https://ultramsg.com)
2. Crea una instancia y escanea el código QR
3. Obtén el **Token** e **Instance ID**
4. Configura el webhook URL: `https://tu-dominio.com/webhook`

### 4. Configurar Firebase
1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com/)
2. Habilita Firestore Database
3. Crea un Service Account y descarga las credenciales
4. Configura las variables de Firebase en tu `.env`

### 5. Migrar Clientes (Opcional)
Si tienes clientes configurados en variables de entorno:
```bash
npm run migrate-firebase
```

### 6. Seed de cliente + Assistant (Firestore)
```bash
npm run create-assistant
```
Crea el par `clients/{id}` + `Assistants/{id}` (prompt, tools, schema). Variables opcionales: `SEED_CLIENT_ID`, `SEED_CLIENT_NAME`, etc.
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

## 🖥️ Panel admin

La misma app sirve una SPA en `/`. Entra con el valor de `ADMIN_API_TOKEN` (se guarda en `sessionStorage` y se envía como `Authorization: Bearer …`).

Desde el panel puedes:

- Ver health, bots, scheduler e instancias UltraMsg
- Crear, editar y eliminar consultorios
- Editar el Assistant (prompt + tools/config/responseSchema en JSON)
- Listar, subir y borrar PDFs

Los endpoints de gestión (`/clients`, `/assistants`, `/bots`, `/scheduler`, `/ultramsg`, documentos) **requieren** ese token. Siguen públicos: `/webhook`, `/webhook-own` y `/health`.

## 📡 Endpoints Disponibles

### Webhooks
- `GET /webhook` - Verificación de webhook UltraMsg
- `POST /webhook` - Recepción de mensajes de WhatsApp

### Gestión de sesiones (requieren `ADMIN_API_TOKEN`)
- `GET /sessions` - Listar sesiones (`?userId=` / `?clientCode=` opcionales)
- `POST /reset_sessions` - Borrar todas las sesiones (`bot_sessions`)
- `DELETE /sessions/user/:userId` - Borrar todas las sesiones de un usuario
- `DELETE /sessions/:userId/:clientCode` - Borrar una sesión concreta

### Contexto de Usuario
- `POST /mark-agenda-sent` - Marcar agenda enviada a un usuario
- `GET /user-context/:userId` - Obtener contexto de un usuario
- `POST /clear-user-context/:userId` - Limpiar contexto de un usuario

### Gestión de Clientes (Firebase, requieren `ADMIN_API_TOKEN`)
- `POST /clients` - Crear nuevo cliente
- `GET /clients` - Listar todos los clientes
- `GET /clients/:clientId` - Obtener cliente específico
- `PUT /clients/:clientId` - Actualizar cliente
- `DELETE /clients/:clientId` - Eliminar cliente
- `GET /clients/stats/overview` - Estadísticas de clientes
- `GET /clients/status` - Estado actual sin recargar
- `POST /clients/reload` - Recargar clientes desde Firebase
- `GET /clients/:clientId/documents` - Listar PDFs
- `POST /clients/:clientId/documents` - Subir PDF
- `DELETE /clients/:clientId/documents/:documentoId` - Eliminar PDF

### Assistants (Firestore, 1:1, requieren `ADMIN_API_TOKEN`)
- `GET /assistants` - Listar todos los Assistants
- `GET /assistants/:clientId` - Obtener prompt/tools/config de un consultorio
- `PUT /assistants/:clientId` - Actualizar prompt/tools/config

### Scheduler (requieren `ADMIN_API_TOKEN`)
- `GET /scheduler/status` - Estado de tareas programadas
- `POST /scheduler/run/:taskName` - Ejecutar tarea manualmente
- `POST /scheduler/stop` - Detener todas las tareas
- `POST /scheduler/restart` - Reiniciar tareas

### Configuración de Grupos
- `GET /group-settings` - Ver configuración de comportamiento en grupos

### Sistema de Comandos (requieren `ADMIN_API_TOKEN`)
- `GET /bots/status` - Ver estado de todos los bots
- `POST /bots/command` - Ejecutar comando manualmente

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

### Probar Firebase
```bash
npm run test-firebase
```

## 📚 Documentación

- `docs/DOCUMENTACION.md` - Documentación completa del sistema (Responses + Firebase)
- `src/README.md` - Estructura de carpetas
- `docs/SCHEDULER_GUIDE.md` - Guía del sistema de tareas programadas
- `docs/COMMANDS_GUIDE.md` - Guía del sistema de comandos
- `docs/FIREBASE_MIGRATION_GUIDE.md` - Guía de migración a Firebase
- `docs/FIREBASE_ULTRAMSG_GUIDE.md` - Firebase + UltraMsg por cliente

## 🔧 Scripts Disponibles

- `npm start` - Iniciar servidor en producción
- `npm run dev` - Iniciar servidor en desarrollo con nodemon
- `npm run ngrok` - Exponer servidor con ngrok
- `npm run test-ultramsg` - Probar conexión con UltraMsg
- `npm run test-scheduler` - Probar sistema de tareas
- `npm run test-webhook` - Probar webhook
- `npm run test-groups` - Probar detección de grupos
- `npm run test-commands` - Probar sistema de comandos
- `npm run test-firebase` - Probar conexión con Firebase
- `npm run migrate-firebase` - Migrar/seed clientes a Firebase (par client + Assistant)
- `npm run create-assistant` - Seed par client + Assistant en Firestore

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