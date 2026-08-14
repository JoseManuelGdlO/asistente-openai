# Documentación del proyecto: Asistente de WhatsApp con IA

Documento completo del sistema **asistente-openai**: qué es, para quién sirve, cómo funciona (especialmente la inteligencia artificial), qué puede hacer, cómo está organizado y qué endpoints ofrece.

---

## 1. ¿Qué es este proyecto?

Es un **asistente automático de WhatsApp** pensado para **varios consultorios o negocios a la vez**. Cada consultorio tiene:

- Su propio número de WhatsApp (el del asistente).
- Su propio “cerebro” de inteligencia artificial (prompt, tools y schema en Firestore `Assistants/{clientId}`).
- Su propio administrador (quien enciende/apaga el bot y sube documentos).
- Opcionalmente, sus propios archivos PDF que la IA puede enviar a los pacientes.

Es un servidor (API) que:

1. Recibe mensajes de WhatsApp.
2. Decide qué hacer (comando admin, confirmación corta, o conversación con IA).
3. Responde por WhatsApp.

También sirve un **panel admin** (SPA estática en `/`) para gestionar consultorios, assistants, PDFs y sesiones con el token `ADMIN_API_TOKEN`.

En la práctica: el paciente escribe por WhatsApp y recibe respuestas generadas por IA, personalizadas según el consultorio al que escribió.

---

## 2. Idea de negocio (en lenguaje sencillo)

Imagina varios consultorios médicos. Cada uno quiere un bot en WhatsApp que:

- Conteste preguntas frecuentes.
- Hable de forma coherente a lo largo de la conversación.
- Pueda enviar PDFs (precios, consentimientos, folletos) cuando el paciente lo pida.
- Pueda apagarse o encenderse sin tocar el servidor (desde WhatsApp, por el admin).

Este proyecto es el “cerebro central” que conecta:

| Pieza | Rol (análogo) |
|--------|----------------|
| **WhatsApp + UltraMsg** | El teléfono y el mensajero |
| **Este servidor** | La recepción y la lógica de negocio |
| **OpenAI Responses API** | El modelo que piensa y responde |
| **Firebase** | Consultorios (`clients`), cerebros (`Assistants`) e historial (`bot_sessions`) |
| **Carpeta `uploads/`** | El archivador de PDFs por consultorio |

---

## 3. Características principales

### 3.1 Conversación con inteligencia artificial

- Cada mensaje de texto de un paciente se envía a OpenAI (Responses API).
- La IA responde según el prompt del documento `Assistants/{clientId}` de ese consultorio.
- La conversación tiene **memoria persistente** en Firestore (`bot_sessions`).

### 3.2 Multi-consultorio (multi-cliente)

- Varios negocios pueden usar el mismo servidor.
- El sistema identifica el consultorio por el **número al que llegó el mensaje** (número del asistente).
- Cada uno tiene su documento `Assistants/{clientId}` (prompt, tools y schema independientes).

### 3.3 Control remoto por WhatsApp (comandos)

El administrador escribe mensajes con formato:

```text
#CODIGO_CLIENTE /comando
```

Ejemplos: `/on`, `/off`, `/status`, `/upload`, `/docs`, `/delete`.

### 3.4 Envío de PDFs por la IA

- El admin sube PDFs (por WhatsApp o por API).
- Cuando el paciente pide algo relacionado, la IA puede llamar a la herramienta `enviar_pdf`.
- El servidor busca el archivo y lo manda por WhatsApp.

### 3.5 Confirmaciones cortas sin gastar IA

Si se marcó que se envió una “agenda” y el usuario responde “ok”, “gracias”, “sí”, etc., el sistema contesta con un mensaje fijo **sin llamar a OpenAI** (más rápido y más barato).

### 3.6 Ignorar grupos

Los mensajes de grupos de WhatsApp (`@g.us`) **no se responden**, para evitar spam o respuestas no deseadas.

### 3.7 Tareas programadas

- Agenda diaria (10:00, zona México) — *preparada; las citas reales aún no están conectadas a Google Calendar*.
- Limpieza semanal (domingo 2:00).
- Verificación de estado cada hora.

### 3.8 Almacenamiento de clientes en la nube

Los consultorios viven en **Firebase Firestore**. El servidor los recarga al arrancar y cada 30 minutos.

---

## 4. ¿Cómo funciona el flujo completo? (paso a paso)

```text
Paciente escribe en WhatsApp
        ↓
UltraMsg recibe el mensaje y llama a tu servidor
        ↓
POST /webhook
        ↓
Claim en webhook_dedup (ultra:{id} / own:{id})
        ↓
¿Es grupo? → Ignorar
¿Es comando #cliente /…? → Ejecutar comando y responder
¿Es documento sin /upload? → Ignorar
¿Es confirmación corta esperada? → Respuesta fija (sin IA)
¿Sin consultorio / bot apagado / Assistant faltante? → Aviso por WhatsApp
        ↓
Identificar consultorio por número del asistente
Cargar Assistants/{clientId} (par 1:1 obligatorio)
        ↓
OpenAI Responses API (instructions + historial Items + tools)
        ↓
Respuesta de texto → UltraMsg → WhatsApp del paciente
(Si la IA pidió enviar_pdf → también se envía el PDF)
```

### Ejemplo narrado

1. Ana escribe al WhatsApp del “Consultorio García”: *“¿Me pueden mandar la lista de precios?”*
2. UltraMsg notifica al servidor.
3. El servidor ve que el mensaje llegó al número del Consultorio García → carga `Assistants/{clientId}`.
4. OpenAI decide llamar `enviar_pdf` con `documento_id = lista_precios`.
5. El servidor lee `uploads/.../lista_precios.pdf` y lo envía por WhatsApp.
6. OpenAI también genera JSON `{"reply":"Te envío la lista de precios."}`.
7. Ese texto también llega a Ana por WhatsApp.

---

## 5. Inteligencia artificial: guía detallada

Esta es la parte más importante del sistema.

### 5.1 Qué tecnología de OpenAI usa

Usa la **Responses API** de OpenAI (`openai.responses.create`):

| Concepto | Qué significa aquí |
|----------|--------------------|
| **instructions** | Prompt del consultorio (`Assistants.prompt`) + lista dinámica de PDFs. |
| **input (Items)** | Historial de la conversación (user/assistant + function_call / function_call_output). |
| **tools** | Functions en shape Responses (planas). Aquí: `enviar_pdf`. |
| **text.format** | JSON Schema estricto `{ "reply": string }` para la respuesta a WhatsApp. |
| **store: false** | No se guarda estado en OpenAI; el historial vive en Firestore. |

**Modelo global** vía env `OPENAI_MODEL` (default `gpt-4o-mini`). El “cerebro” por consultorio es el documento Firestore `Assistants/{clientId}` (mismo ID que `clients/{clientId}`).

### 5.2 Dónde está la integración en el código

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/managers/openAIManager.js` | **Núcleo de IA**: Responses, loop de tools, historial en `bot_sessions`. |
| `src/controllers/webhookManager.js` | Decide cuándo llamar a la IA; resuelve `clientId` e instancia WhatsApp. |
| `src/services/firebaseService.js` | CRUD `clients`, `Assistants`, `bot_sessions`, `webhook_dedup`. |
| `scripts/create-assistant.js` | Seed del **par** client + Assistant en Firestore. |
| `src/services/documentStore.js` | Archivos PDF que la tool puede enviar. |
| `src/managers/ultramsgManager.js` | Envío real del PDF/texto a WhatsApp. |
| `src/services/commandManager.js` | Relaciona teléfono → cliente; carga Assistant 1:1; sube/borra docs. |

Variables de entorno relacionadas:

- `OPENAI_API_KEY` — clave de la cuenta OpenAI (obligatoria).
- `OPENAI_MODEL` — modelo Responses (ej. `gpt-4o-mini`).

### 5.3 Cómo se elige qué “cerebro” usa cada mensaje

1. UltraMsg entrega el mensaje con el campo `to` (número del asistente).
2. El sistema busca un cliente cuyo `assistantPhone` coincida → `clientId`.
3. Carga `Assistants/{clientId}`. Si falta el documento → aviso al paciente (par inconsistente).
4. `openAIManager.processMessage(userId, message, clientId, context)` usa ese prompt/tools/schema.

Así, el mismo servidor puede atender al Consultorio A con un tono formal y al Consultorio B con otro tono, porque son Assistants distintos.

### 5.4 Memoria de conversación (`bot_sessions`)

Para no mezclar conversaciones:

- Documento ID: `usuario + "_" + codigoCliente`  
  Ejemplo: `5215512345678_CLIENTE001`
- Campo `items[]`: Items Responses serializables (sin `instructions`).
- En cada turno se reenvía `input = items` + el mensaje nuevo.
- Límite ~40 Items al guardar (sin romper pares function_call / function_call_output).
- Lock `lockedUntil` (TTL inicial **180s**): evita dos respuestas concurrentes a la misma sesión.
- **Heartbeat**: en cada loop de tools se renueva `lockedUntil` (`refreshBotSessionLock`), para que un ciclo lento de hasta 8 tools no deje entrar otra petición.
- Si `responses.create` falla a mitad, se persiste el Item `user` (y pares de tools completos). Los `function_call` sin `function_call_output` se descartan. El lock se libera en `finally`.
- Si el lock está ocupado, no se appenda el mensaje: se responde *“Por favor espera a que termine la respuesta anterior.”*

**Endpoints** (requieren `ADMIN_API_TOKEN`):

- `GET /sessions` — lista resúmenes (`itemsCount`, `isLocked`, fechas); filtros opcionales `?userId=` / `?clientCode=`.
- `POST /reset_sessions` — borra **todas** las docs de `bot_sessions`.
- `DELETE /sessions/user/:userId` — borra todas las sesiones de ese usuario.
- `DELETE /sessions/client/:clientCode` — borra todas las sesiones de ese consultorio.
- `DELETE /sessions/:userId/:clientCode` — borra una sesión concreta.

El panel expone estas acciones en **Sesiones** (listado global) y en la pestaña **Sesiones** de cada consultorio. Al guardar el Assistant se puede marcar “Resetear conversaciones…” para que el historial viejo no siga al prompt nuevo.

### 5.5 Qué hace exactamente `processMessage` (el corazón)

Firma: `OpenAIManager.processMessage(userId, message, clientCode, context)`.

Pasos internos:

1. Cargar `Assistants/{clientCode}`; si no existe, devolver aviso de config incompleta (no lanza).
2. Adquirir lock de `bot_sessions/{userId_clientCode}` (180s). Si está ocupado, devolver aviso de espera.
3. Cargar o crear sesión; append Item `user`.
4. Construir `instructions` = prompt + documentos disponibles.
5. Llamar `responses.create` con `input`, `tools`, `text.format`, `store: false`. Al inicio de cada loop, renovar el lock.
6. Si hay `function_call` → ejecutar `enviar_pdf`, append outputs, repetir (máx. 8 loops).
7. Parsear `{ reply }` desde `output_text`; persistir Items; liberar lock; devolver string a WhatsApp.
8. Si OpenAI falla: persistir lo posible (sin pares rotos), liberar lock y devolver *“Hubo un error procesando tu mensaje. Intenta de nuevo.”* para que el webhook lo envíe (HTTP 200, sin silencio).

### 5.6 La herramienta `enviar_pdf` (function calling)

```text
responses.create → output con function_call enviar_pdf
        ↓
Servidor: busca PDF en DocumentStore del cliente
        ↓
UltraMsg.sendDocument (PDF en base64)
        ↓
Append function_call_output al historial
        ↓
Nueva llamada responses.create → JSON {"reply":"..."}
```

**Parámetros:** `documento_id` (obligatorio), `caption` (opcional; en schema strict se envía como `string | null` y entra en `required`). Al llamar a OpenAI, `normalizeToolsForResponses` corrige tools guardadas con `required` incompleto.

La tool vive en `Assistants.tools` (shape Responses, sin wrapper `function: {...}`). El seed `npm run create-assistant` la incluye.

### 5.7 Instrucciones dinámicas de documentos

En cada mensaje, `instructions` combina el prompt fijo de Firestore con la lista actual de PDFs del consultorio. Si el admin sube un PDF nuevo, la IA lo conoce en el siguiente turno sin tocar OpenAI Dashboard.

### 5.8 Seed del par client + Assistant

```bash
npm run create-assistant
```

Crea en Firestore `clients/{id}` + `Assistants/{id}` con tool `enviar_pdf` y schema `{ reply }`.  
Variables opcionales: `SEED_CLIENT_ID`, `SEED_CLIENT_NAME`, `SEED_ADMIN_PHONE`, `SEED_ASSISTANT_PHONE`, `SEED_PROMPT`.

### 5.9 Qué NO hace la IA (límites actuales)

- No responde en grupos.
- No procesa documentos de pacientes como “contenido para leer” (salvo admin `/upload`).
- No genera por sí sola la agenda diaria de citas (scheduler aún placeholder).
- No usa Assistants API (`threads`/`runs`) ni Chat Completions en runtime.
- No usa `previous_response_id` ni Conversations API (historial solo en Firestore).

### 5.10 Costes y rendimiento (visión práctica)

- Cada mensaje normal = al menos una llamada Responses (más si hay tools).
- Las confirmaciones cortas evitan ese coste.
- Si el usuario manda varios mensajes mientras la sesión está locked, el segundo puede fallar con el mensaje de espera.

---

## 6. UltraMsg (WhatsApp)

UltraMsg es el puente entre WhatsApp y este servidor.

### Qué hace

- Recibe mensajes entrantes y los reenvía al webhook `POST /webhook`.
- Envía textos y documentos (PDFs) de vuelta.
- Puede haber **varias instancias** (varios números), configuradas desde Firebase por cliente.

### Configuración típica por cliente (Firebase)

- `ULTRAMSG_TOKEN`
- `ULTRAMSG_INSTANCE_ID`
- `ULTRAMSG_WEBHOOK_TOKEN`

También hay fallback desde variables de entorno globales (`ULTRAMSG_*`) si no hay instancias en Firebase.

### Webhook

En UltraMsg se configura la URL pública, por ejemplo:

```text
https://tu-dominio.com/webhook
```

El servidor valida el token (`?token=` o header `x-webhook-token`).

Tras identificar el mensaje se hace claim en `webhook_dedup`. Avisos de negocio (consultorio no identificado, bot apagado, Assistant faltante) se envían por WhatsApp y el webhook responde **200**. Si el envío o un fallo inesperado lanza, se libera el claim y se responde **500** para que UltraMsg reintente.

---

## 7. Firebase (consultorios / clientes)

### Colección: `clients`

Cada documento representa un consultorio. Campos típicos:

| Campo | Significado |
|-------|-------------|
| `name` | Nombre visible (ej. Consultorio Dr. García) |
| `adminPhone` | WhatsApp del administrador (quien puede `/on`, `/off`, etc.) |
| `assistantPhone` | Número del bot (dónde llegan los mensajes de pacientes) |
| `botStatus` | `active` o `inactive` |
| `status` | `active` o `deleted` (borrado lógico) |
| `ULTRAMSG_*` | Credenciales de la instancia WhatsApp de ese cliente |
| `createdAt` / `updatedAt` | Fechas |

El campo legado `assistantId` (`asst_…`) **ya no se usa** en runtime. El cerebro se resuelve por `Assistants/{clientId}`.

### Colección: `Assistants` (1:1 con `clients`)

Documento ID = **mismo** `clientId`.

| Campo | Significado |
|-------|-------------|
| `clientId` | Redundante con el ID del doc |
| `prompt` | System instructions → `instructions` en Responses |
| `tools` | Functions shape Responses (incl. `enviar_pdf`) |
| `config` | `temperature`, `max_output_tokens`, etc. |
| `responseSchema` | JSON Schema para `{ reply }` |
| `updatedAt` | Fecha |

Alta/baja de cliente siempre en par con su Assistant (`createClientWithAssistant` / `deleteClientWithAssistant`).

### Colección: `bot_sessions`

| Campo | Significado |
|-------|-------------|
| `userId` / `clientCode` | Identifican la sesión |
| `items[]` | Historial Responses |
| `lockedUntil` | Lock de concurrencia (180s + heartbeat por loop) |
| `createdAt` / `updatedAt` | Fechas |

### Colección: `webhook_dedup`

Evita doble procesamiento (multi-instancia) y el silencio por reintento de UltraMsg tras un 500.

Documento ID = `ultra:{messageId}` o `own:{messageId}`.

| Campo | Significado |
|-------|-------------|
| `status` | `processing` (claim) o `completed` (ya notificado) |
| `expiresAt` | Si expiró, otro worker puede reclamar. Activar TTL de Firestore sobre este campo. |
| `updatedAt` | Fecha |

Flujo: claim al llegar el webhook → si el handler termina (incluido aviso de negocio o error de OpenAI convertido a texto) → `completed` (24h) → HTTP 200. Si lanza **antes** de notificar al usuario → se borra el claim → HTTP 500 → UltraMsg puede reintentar.

### Credenciales del servidor

El código usa:

```env
FIREBASE_CREDENTIALS={"type":"service_account", ... JSON completo ...}
```

(No campos sueltos `FIREBASE_PROJECT_ID` + `PRIVATE_KEY` por separado en el código actual, aunque alguna guía antigua lo mencione así.)

### Recarga

- Al arrancar el servidor.
- Cada 30 minutos automáticamente.
- Manual: `POST /clients/reload`.

---

## 8. Sistema de comandos (administradores)

### Formato

```text
#CODIGOCLIENTE /comando [argumento]
```

Ejemplos:

```text
#CLIENTE001 /off
#CLIENTE001 /on
#CLIENTE001 /status
#CLIENTE001 /help
#CLIENTE001 /info
#CLIENTE001 /docs
#CLIENTE001 /upload lista_precios     ← con PDF adjunto en el mismo mensaje
#CLIENTE001 /delete lista_precios
#CLIENTE001 /restart
```

### Autorización

- `/help` e `/info`: cualquiera.
- El resto de comandos sensibles: solo el `adminPhone` de ese cliente.

### Estados del bot

- **ACTIVO**: responde con IA a mensajes normales.
- **INACTIVO**: no procesa conversación con IA; avisa que está apagado. Los comandos sí siguen funcionando.

### PDFs por WhatsApp

1. Desde el número admin, adjunta un PDF.
2. En el caption escribe: `#CLIENTE001 /upload lista_precios`
3. Se guarda en `uploads/CLIENTE001/lista_precios.pdf`

Los IDs se normalizan a minúsculas, letras, números y guion bajo.

---

## 9. Confirmaciones y contexto de usuario

### Confirmaciones

Si el sistema marcó que envió una agenda (`POST /mark-agenda-sent`) y el usuario responde algo como “ok”, “gracias”, “sí”, “perfecto”, un emoji 👍, etc.:

- Se responde con un mensaje amable fijo.
- **No** se llama a OpenAI.

### Contexto en memoria

`UserContextManager` guarda en RAM si se espera confirmación, etc. Se pierde al reiniciar.

Endpoints útiles:

- `POST /mark-agenda-sent` — body `{ "userId": "..." }`
- `GET /user-context/:userId`
- `POST /clear-user-context/:userId`

---

## 10. Documentos PDF (API admin)

Además de WhatsApp, se pueden gestionar por HTTP (requieren token admin):

- Header: `Authorization: Bearer <ADMIN_API_TOKEN>`  
  o `x-admin-token: <ADMIN_API_TOKEN>`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/clients/:clientId/documents` | Lista PDFs |
| POST | `/clients/:clientId/documents` | Sube PDF (multipart: `file` + `documento_id`). Máx. 25 MB |
| DELETE | `/clients/:clientId/documents/:documentoId` | Elimina un PDF |

Los archivos viven en disco: `uploads/{clientId}/{documento_id}.pdf` (volumen Docker recomendado).

---

## 10.1 Panel admin (SPA)

La misma app Express sirve `public/` en `/`. No hace falta un segundo contenedor.

1. Abre `https://tu-dominio/` (o `http://localhost:3000/`).
2. Introduce `ADMIN_API_TOKEN`. Se guarda en `sessionStorage` y las peticiones llevan `Authorization: Bearer <token>`.
3. Desde el panel: dashboard (health, bots, scheduler, UltraMsg), CRUD de consultorios, edición del Assistant (textarea de prompt + JSON de tools/config/schema), **playground de chat** al lado del prompt, gestión de PDFs y sesiones (listar/borrar; reset al cambiar el prompt).

Si cambias credenciales `ULTRAMSG_*` de un consultorio, el servidor re-inicializa las instancias sin reiniciar el contenedor.

---

## 10.2 Playground de prompts y tools

En la pestaña **Assistant** hay un chat de prueba que llama a OpenAI y Firestore de verdad, **sin UltraMsg ni webhook**.

- Usuario fijo: `playground_{clientId}` (no se mezcla con pacientes).
- Usa el Assistant **ya guardado** (prompt/tools/schema de Firestore). Probar el textarea sin guardar queda pendiente.
- `enviar_pdf` resuelve PDFs reales del consultorio pero no envía WhatsApp; en el chat aparece `PDF simulado: archivo.pdf` (o el error si el id no existe).
- La sesión persiste en `bot_sessions`. Se reinicia con **Nueva conversación**, al **guardar** el Assistant, o al resetear sesiones del consultorio. Cambiar de consultorio carga la sesión playground de ese agente (no borra la anterior).

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/playground/:clientId` | Historial (`items`) de la sesión playground |
| POST | `/playground/:clientId/chat` | Envía un mensaje `{ message, reset? }` y devuelve `reply`, `tools`, `simulatedDocuments` |

---

## 11. Estructura del proyecto

```text
asistente-openai/
├── src/
│   ├── index.js                 # Servidor Express: todos los endpoints
│   ├── middleware/
│   │   └── requireAdminAuth.js  # Protección de la API de gestión y el panel
│   ├── managers/
│   │   ├── openAIManager.js     # Integración OpenAI Responses API
│   │   └── ultramsgManager.js   # WhatsApp vía UltraMsg
│   ├── controllers/
│   │   ├── webhookManager.js    # Orquestación de mensajes entrantes
│   │   └── schedulerController.js
│   └── services/
│       ├── firebaseService.js   # clients, Assistants, bot_sessions, webhook_dedup
│       ├── commandManager.js    # Comandos #cliente /cmd
│       ├── documentStore.js     # PDFs en disco
│       ├── confirmationManager.js
│       ├── userContextManager.js
│       └── scheduler.js         # Cron jobs
├── uploads/                     # PDFs por cliente
├── scripts/
│   ├── create-assistant.js      # Seed par client+Assistant Firestore
│   ├── backfill-assistants.js   # Crea Assistants/{id} faltantes (opcional)
│   └── migrate-to-firebase.js
├── public/                      # Panel admin (HTML + JS)
├── test/                        # Scripts de prueba
├── package.json
├── Dockerfile / docker-compose.yml
├── config-ultramsg.example      # Plantilla de variables
└── DOCUMENTACION.md             # Este documento
```

### Roles de cada capa (para no técnicos)

- **Managers**: hablan con servicios externos (OpenAI, UltraMsg).
- **Services**: reglas de negocio (clientes, comandos, PDFs, confirmaciones, horarios).
- **Controllers**: reciben HTTP y coordinan.
- **index.js**: cablea todo y publica las URLs.

El frontend es la SPA en `public/`, servida por el mismo proceso Node.

---

## 12. Catálogo de endpoints

Base típica: `http://localhost:3000` (o tu dominio en producción).

### Webhook WhatsApp

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/webhook` | Verificación con `?token=` |
| POST | `/webhook` | Mensajes entrantes de UltraMsg |

### OpenAI / conversaciones (requieren `ADMIN_API_TOKEN`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/sessions` | Lista resúmenes de sesiones (`?userId=` / `?clientCode=` opcionales) |
| POST | `/reset_sessions` | Borra todas las sesiones en `bot_sessions` |
| DELETE | `/sessions/user/:userId` | Borra todas las sesiones de un usuario |
| DELETE | `/sessions/client/:clientCode` | Borra todas las sesiones de un consultorio |
| DELETE | `/sessions/:userId/:clientCode` | Borra una sesión concreta |

### Contexto de usuario

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/mark-agenda-sent` | Marca agenda enviada; espera confirmación |
| GET | `/user-context/:userId` | Consulta contexto |
| POST | `/clear-user-context/:userId` | Limpia contexto |

### Scheduler (requieren `ADMIN_API_TOKEN`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/scheduler/status` | Estado de tareas |
| POST | `/scheduler/run/:taskName` | Ejecuta `dailyAgenda`, `weeklyCleanup` o `statusCheck` |
| POST | `/scheduler/stop` | Detiene tareas |
| POST | `/scheduler/restart` | Reinicia tareas |

### Clientes (Firebase, requieren `ADMIN_API_TOKEN`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/clients` | Lista (cache) |
| POST | `/clients` | Crea **par** client + Assistant (`name`, `adminPhone`, `assistantPhone`, `prompt?`, `tools?`, `config?`) |
| GET | `/clients/:clientId` | Uno |
| PUT | `/clients/:clientId` | Actualiza datos del consultorio (no crea Assistants huérfanos) |
| DELETE | `/clients/:clientId` | Soft-delete del **par** client + Assistant |
| GET | `/clients/stats/overview` | Estadísticas |
| POST | `/clients/reload` | Recarga desde Firestore |
| GET | `/clients/status` | Estado actual sin recargar |

### Assistants (Firestore, 1:1, requieren `ADMIN_API_TOKEN`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/assistants` | Lista todos los Assistants de Firestore (excluye deleted) |
| GET | `/assistants/:clientId` | Lee prompt/tools/config del consultorio |
| PUT | `/assistants/:clientId` | Actualiza prompt/tools/config; resetea la sesión playground; **404** si no existe el cliente |

### Playground (requieren `ADMIN_API_TOKEN`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/playground/:clientId` | Lee `items` de `playground_{clientId}` |
| POST | `/playground/:clientId/chat` | Chat de prueba (OpenAI real, sin WhatsApp) |

### Documentos (requieren `ADMIN_API_TOKEN`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/clients/:clientId/documents` | Lista PDFs |
| POST | `/clients/:clientId/documents` | Sube PDF |
| DELETE | `/clients/:clientId/documents/:documentoId` | Elimina un PDF |

### Bots y grupos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/bots/status` | Estado de bots (requiere token) |
| POST | `/bots/command` | Ejecuta comando (`clientId`, `command`) (requiere token) |
| GET | `/group-settings` | Política: no responder en grupos |

### UltraMsg (requieren `ADMIN_API_TOKEN`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/ultramsg/instances` | Instancias y estado |
| GET | `/ultramsg/instances/:instanceId` | Detalle |
| POST | `/ultramsg/instances/:instanceId/send` | Envío manual `{ to, message }` |

### Utilidad

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Healthcheck (Docker) |
| POST | `/test` | Echo de depuración |

### Nota de seguridad

Los endpoints de gestión (`/clients`, `/assistants`, `/bots`, `/scheduler`, `/ultramsg`, documentos y sesiones) exigen `ADMIN_API_TOKEN`. Siguen públicos: webhooks y `/health`.

---

## 13. Configuración y arranque

### Dependencias

```bash
npm install
```

### Variables de entorno (resumen)

Copia `config-ultramsg.example` a `.env` y completa. Lo esencial:

| Variable | Uso |
|----------|-----|
| `OPENAI_API_KEY` | Acceso a OpenAI |
| `OPENAI_MODEL` | Modelo Responses (default `gpt-4o-mini`) |
| `ULTRAMSG_TOKEN` / `INSTANCE_ID` / `WEBHOOK_TOKEN` | WhatsApp (fallback) |
| `FIREBASE_CREDENTIALS` | JSON de service account |
| `ADMIN_API_TOKEN` | Panel admin y API de gestión (clientes, assistants, playground, documentos, sesiones, bots, scheduler, UltraMsg) |
| `PORT` | Puerto (default 3000) |
| `UPLOADS_DIR` | Carpeta de PDFs (opcional) |

### Ejecutar

```bash
npm run dev      # desarrollo (nodemon)
npm start        # producción
npm run ngrok    # exponer puerto 3000 en desarrollo
```

### Docker

- Imagen: Node 22 Alpine, usuario no-root, healthcheck en `/health`.
- Volumen recomendado: `./uploads` para no perder PDFs al redeploy.
- Pensado para paneles tipo EasyPanel vía `docker-compose.yml`.

### Alta típica de un consultorio nuevo

1. Seed del par en Firestore (`npm run create-assistant`) o `POST /clients` (`prompt` opcional; vacío → fallback `''`).
2. Ajustar prompt/tools con `PUT /assistants/:clientId` si hace falta.
3. Crear instancia UltraMsg y escanear QR.
4. Asociar credenciales UltraMsg al cliente (`PUT /clients/:clientId`).
5. Apuntar webhook UltraMsg a `https://tu-dominio/webhook`.
6. Subir PDFs (`/upload` o API).
7. Probar desde WhatsApp: pregunta normal + `#ID /status` desde el admin.

---

## 14. Scripts útiles

| Script | Qué hace |
|--------|----------|
| `npm run create-assistant` | Seed par client + Assistant en Firestore |
| `node scripts/backfill-assistants.js` | Crea `Assistants/{id}` faltantes para clients activos (idempotente; `--dry-run` solo reporta). Ya aplicado en producción si corresponde. |
| `npm run migrate-firebase` | Seed/migración de clientes de ejemplo a Firestore |
| `npm run test-ultramsg` | Prueba UltraMsg |
| `npm run test-webhook` | Prueba webhook |
| `npm run test-commands` | Prueba comandos |
| `npm run test-firebase` | Prueba Firebase |
| `npm run test-scheduler` | Prueba scheduler |
| `npm run test-groups` | Prueba detección de grupos |

---

## 15. Limitaciones y estado actual (transparencia)

- **Agenda diaria**: la estructura existe; la obtención de citas (`getTodaysAppointments`) aún no está conectada a Google Calendar (suele devolver lista vacía).
- **Limpieza semanal**: principalmente logging; no es un borrado agresivo de datos.
- **Historial**: persistido en Firestore (`bot_sessions`); sobrevive reinicios del servidor. Si OpenAI falla a mitad, se guarda el turno del usuario (sin pares de tools rotos).
- **Documentación antigua** (`README.md` y algunas guías) puede mencionar Meta/Facebook; esta `DOCUMENTACION.md` refleja Responses + Firebase.
- Clientes sin documento `Assistants/{id}` reciben un aviso por WhatsApp (no quedan mudos). Si hiciera falta crear el par: `node scripts/backfill-assistants.js` (o `--dry-run` antes).

---

## 16. Glosario (para usuarios no técnicos)

| Término | Significado sencillo |
|---------|----------------------|
| **API / Endpoint** | Una “dirección” del servidor a la que se le pide algo (listar clientes, health, etc.). |
| **Webhook** | UltraMsg “llama” a tu servidor cuando llega un mensaje de WhatsApp. |
| **webhook_dedup** | Doc en Firestore que evita procesar dos veces el mismo mensaje (y el silencio si hay reintento). |
| **Assistant (Firestore)** | Config del cerebro del consultorio: prompt, tools y schema en `Assistants/{clientId}`. |
| **bot_session** | Historial de chat entre un paciente y un consultorio (Items de Responses). |
| **Responses API** | Endpoint de OpenAI que genera la siguiente respuesta a partir de `instructions` + `input`. |
| **Tool** | Acción que la IA pide al servidor (ej. enviar un PDF). |
| **Cliente** | Un consultorio/negocio registrado en Firebase. |
| **Instancia UltraMsg** | Una conexión WhatsApp concreta (un número). |
| **Admin** | Persona autorizada a encender/apagar el bot y gestionar PDFs. |

---

## 17. Resumen final

Este proyecto es un **backend multi-consultorio** que:

1. Escucha WhatsApp (UltraMsg).
2. Identifica el consultorio.
3. Delega la conversación a **OpenAI Responses** (historial en Firestore + tool `enviar_pdf`).
4. Devuelve la respuesta (y PDFs si aplica) por WhatsApp.
5. Permite a cada admin controlar su bot y sus documentos sin entrar al código.

La inteligencia artificial no “vive” en WhatsApp: el modelo corre en OpenAI y el prompt/historial viven en Firebase. Este servidor es el **traductor e integrador** entre pacientes, consultorios, documentos y el modelo de IA.

---

*Documento generado a partir del código del repositorio `asistente-openai`. Si el código cambia (nuevos endpoints, nueva API de OpenAI, etc.), conviene actualizar esta guía.*
