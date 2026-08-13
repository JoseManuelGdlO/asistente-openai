# Estructura del Proyecto

## Organización de Carpetas

```
src/
├── index.js                    # Arranque: deps reales, listen, intervalos
├── app.js                      # createApp(deps): rutas Express (testeable)
├── middleware/
│   └── requireAdminAuth.js     # Auth para admin API
├── managers/                   # Gestores de servicios externos
│   ├── openAIManager.js        # OpenAI Responses API + bot_sessions
│   ├── ultramsgManager.js      # UltraMsg / WhatsApp
│   └── ownSystemManager.js     # Backend WhatsApp propio (OWN_SYSTEM)
├── services/                   # Servicios de negocio
│   ├── firebaseService.js      # clients, Assistants, bot_sessions
│   ├── commandManager.js       # Comandos #cliente /cmd
│   ├── documentStore.js        # PDFs por consultorio
│   ├── confirmationManager.js  # Confirmaciones cortas
│   ├── userContextManager.js   # Contexto de agenda/usuario
│   └── scheduler.js            # Cron jobs
├── controllers/
│   ├── webhookManager.js       # Webhooks UltraMsg / own
│   └── schedulerController.js
└── utils/                      # Utilidades (futuro)
```

## Descripción

### `index.js`
Cablea dependencias reales, recarga periódica de clientes y `listen`.

### `app.js`
`createApp(deps)` registra middleware y rutas. Los tests HTTP inyectan stubs.

### `managers/`
- `openAIManager.js`: Responses API, tools (`enviar_pdf`), historial en Firestore
- `ultramsgManager.js`: envío/recepción vía UltraMsg
- `ownSystemManager.js`: envío vía API propia (`OWN_API_BASE_URL`)

### `services/`
- `firebaseService.js`: CRUD de `clients`, `Assistants`, `bot_sessions`
- `commandManager.js`: resolución cliente/Assistant y comandos admin
- `documentStore.js`, `confirmationManager.js`, `userContextManager.js`, `scheduler.js`

### `controllers/`
- `webhookManager.js`: orquesta mensajes entrantes
- `schedulerController.js`: endpoints del scheduler

## Variables OWN_SYSTEM

- `OWN_API_BASE_URL`: Base URL del backend WhatsApp propio
- Por cliente en Firebase: `OWN_SYSTEM` (boolean), `OWN_API_KEY` (string)
- Inbound: `POST /webhook-own` (`type=message.inbound`, `normalized.to`)

## Flujo de dependencias

```
index.js
├── managers/ (openAI, ultramsg, ownSystem)
├── services/ (firebase, commands, documents, confirmation, context, scheduler)
└── controllers/ (webhook, scheduler)
```

## Documentación relacionada

- `docs/DOCUMENTACION.md` — fuente de verdad del sistema
- `docs/SCHEDULER_GUIDE.md`
- `docs/COMMANDS_GUIDE.md`
- `docs/FIREBASE_MIGRATION_GUIDE.md`
- `docs/FIREBASE_ULTRAMSG_GUIDE.md`
