# Documentación del proyecto: Asistente de WhatsApp con IA

Documento completo del sistema **asistente-openai**: qué es, para quién sirve, cómo funciona (especialmente la inteligencia artificial), qué puede hacer, cómo está organizado y qué endpoints ofrece.

---

## 1. ¿Qué es este proyecto?

Es un **asistente automático de WhatsApp** pensado para **varios consultorios o negocios a la vez**. Cada consultorio tiene:

- Su propio número de WhatsApp (el del asistente).
- Su propio “cerebro” de inteligencia artificial (un asistente de OpenAI).
- Su propio administrador (quien enciende/apaga el bot y sube documentos).
- Opcionalmente, sus propios archivos PDF que la IA puede enviar a los pacientes.

**No hay aplicación web ni app móvil.** Es un servidor (API) que:

1. Recibe mensajes de WhatsApp.
2. Decide qué hacer (comando admin, confirmación corta, o conversación con IA).
3. Responde por WhatsApp.

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
| **OpenAI Assistants** | El empleado virtual que piensa y responde |
| **Firebase** | La agenda de consultorios (quién es quién) |
| **Carpeta `uploads/`** | El archivador de PDFs por consultorio |

---

## 3. Características principales

### 3.1 Conversación con inteligencia artificial

- Cada mensaje de texto de un paciente se envía a OpenAI.
- La IA responde según las instrucciones del asistente de ese consultorio.
- La conversación tiene **memoria** mientras el servidor no se reinicie (ver sección de *threads*).

### 3.2 Multi-consultorio (multi-cliente)

- Varios negocios pueden usar el mismo servidor.
- El sistema identifica el consultorio por el **número al que llegó el mensaje** (número del asistente).
- Cada uno tiene su `assistantId` de OpenAI independiente (tono, reglas y herramientas distintas).

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
¿Es grupo? → Ignorar
¿Es comando #cliente /…? → Ejecutar comando y responder
¿Es documento sin /upload? → Ignorar
¿Es confirmación corta esperada? → Respuesta fija (sin IA)
¿Bot apagado? → Avisar que está apagado
        ↓
Identificar consultorio por número del asistente
Obtener assistantId de OpenAI de ese consultorio
        ↓
OpenAI procesa el mensaje (thread + run + tools)
        ↓
Respuesta de texto → UltraMsg → WhatsApp del paciente
(Si la IA pidió enviar_pdf → también se envía el PDF)
```

### Ejemplo narrado

1. Ana escribe al WhatsApp del “Consultorio García”: *“¿Me pueden mandar la lista de precios?”*
2. UltraMsg notifica al servidor.
3. El servidor ve que el mensaje llegó al número del Consultorio García → usa el asistente OpenAI de ese consultorio.
4. OpenAI decide llamar `enviar_pdf` con `documento_id = lista_precios`.
5. El servidor lee `uploads/.../lista_precios.pdf` y lo envía por WhatsApp.
6. OpenAI también genera un texto del tipo: *“Te envío la lista de precios.”*
7. Ese texto también llega a Ana por WhatsApp.

---

## 5. Inteligencia artificial: guía detallada

Esta es la parte más importante del sistema.

### 5.1 Qué tecnología de OpenAI usa

El proyecto **no** usa el chat simple tipo “una pregunta → una respuesta” de forma aislada.

Usa la **Assistants API** de OpenAI (API beta de assistants/threads/runs):

| Concepto OpenAI | Qué significa aquí |
|-----------------|--------------------|
| **Assistant** | El “empleado virtual” configurado (instrucciones, modelo, herramientas). Cada consultorio puede tener el suyo. |
| **Thread** | El “hilo” o historial de una conversación con un paciente en un consultorio concreto. |
| **Message** | Cada mensaje del usuario o del asistente dentro del thread. |
| **Run** | Una “vuelta de pensamiento”: OpenAI lee el thread, decide qué hacer y produce respuesta (o pide herramientas). |
| **Tool / Function** | Acciones que el código puede ejecutar por pedido de la IA. Aquí: `enviar_pdf`. |

**Modelo por defecto al crear asistentes** (script `scripts/create-assistant.js`): `gpt-4o-mini`.  
El modelo real de cada consultorio es el que tenga configurado ese Assistant en OpenAI (Dashboard o API).

### 5.2 Dónde está la integración en el código

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/managers/openAIManager.js` | **Núcleo de IA**: threads, mensajes, runs, espera, tools, respuesta final. |
| `src/controllers/webhookManager.js` | Decide cuándo llamar a la IA y con qué `assistantId` / cliente / instancia WhatsApp. |
| `scripts/create-assistant.js` | Crea un Assistant nuevo en OpenAI. |
| `scripts/list-assistants.js` | Lista Assistants de la cuenta. |
| `src/services/documentStore.js` | Archivos PDF que la tool puede enviar. |
| `src/managers/ultramsgManager.js` | Envío real del PDF/texto a WhatsApp. |
| `src/services/commandManager.js` | Relaciona teléfono → cliente → `assistantId`; sube/borra docs. |

Variables de entorno relacionadas:

- `OPENAI_API_KEY` — clave de la cuenta OpenAI (obligatoria).
- `ASISTENTE_ID` — ID de respaldo/legado; en multi-cliente el ID principal vive en Firebase (`assistantId` de cada cliente).

### 5.3 Cómo se elige qué “cerebro” usa cada mensaje

1. UltraMsg entrega el mensaje con el campo `to` (número que recibió el mensaje = número del asistente).
2. El sistema busca en Firebase/cache un cliente cuyo `assistantPhone` coincida.
3. De ese cliente toma `assistantId` (por ejemplo `asst_abc123`).
4. Ese ID se pasa a `openAIManager.processMessage(...)`.

Así, el mismo servidor puede atender al Consultorio A con un tono formal y al Consultorio B con otro tono, porque son Assistants distintos.

### 5.4 Memoria de conversación (threads)

Para no mezclar conversaciones:

- Clave interna: `usuario + "_" + codigoCliente`  
  Ejemplo: `5215512345678_CLIENTE001`
- Si no existe thread, se crea uno nuevo en OpenAI (`threads.create`).
- Si ya existe, se reutiliza: la IA “recuerda” mensajes previos de esa pareja usuario–consultorio.

**Importante:**

- Los IDs de thread se guardan **en memoria RAM** del servidor (`Map`).
- Si el servidor **se reinicia**, se pierden esas asociaciones locales → la próxima conversación crea un thread nuevo (como empezar de cero para el usuario, aunque el thread viejo siga existiendo en OpenAI sin usarse).
- Endpoint `POST /reset_threads`: borra el mapa local a propósito (útil para pruebas o para “olvidar” conversaciones).

### 5.5 Qué hace exactamente `processMessage` (el corazón)

Función principal: `OpenAIManager.processMessage(userId, message, assistantId, clientCode, context)`.

Pasos internos:

1. **Obtener o crear thread** para ese usuario + cliente.
2. **Comprobar si hay un run activo** en ese thread.  
   Si aún está “pensando”, lanza error: *“Por favor espera a que termine la respuesta anterior.”*  
   (Evita solapar dos respuestas a la vez.)
3. **Armar contexto local del request** (usuario, cliente, instancia UltraMsg, documentStore) para que las tools no se confundan entre usuarios concurrentes.
4. **Agregar el mensaje del usuario** al thread.
5. **Listar documentos PDF** del consultorio y construir `additional_instructions`, por ejemplo:  
   *“Documentos disponibles: lista_precios, consentimiento. Usa solo estos documento_id al llamar enviar_pdf.”*
6. **Crear un Run** con el `assistant_id` del consultorio y esas instrucciones adicionales.
7. **Esperar el resultado** (polling cada 2 segundos, hasta ~5 minutos / 150 intentos).
8. Si el estado es `requires_action` → ejecutar tools (ver abajo) y devolver resultados a OpenAI.
9. Cuando el run está `completed` → leer el último mensaje del assistant y devolver el texto.
10. El webhook envía ese texto por WhatsApp.

### 5.6 La herramienta `enviar_pdf` (function calling)

A veces la IA no solo escribe texto: **pide al servidor que haga algo**.

Flujo:

```text
OpenAI (run) → estado requires_action
        ↓
Solicita tool: enviar_pdf { documento_id, caption? }
        ↓
Servidor: busca PDF en DocumentStore del cliente
        ↓
UltraMsg.sendDocument (PDF en base64) al WhatsApp del usuario
        ↓
Servidor responde a OpenAI: { success: true, ... }
        ↓
OpenAI continúa el run y genera el texto final
```

**Parámetros típicos que entiende el código:**

- `documento_id` o `documentoId` (obligatorio)
- `caption` (opcional, texto que acompaña el archivo)

**Qué necesita estar listo para que funcione:**

1. El PDF subido y guardado (WhatsApp `/upload` o API admin).
2. La tool `enviar_pdf` **registrada en el Assistant** en OpenAI (en el Dashboard o por script).  
   El script `scripts/create-assistant.js` crea assistants **sin tools** (`tools: []`); hay que añadir la tool después.
3. En las *Instructions* del Assistant, indicar **cuándo** usarla (ej.: si piden precios → `lista_precios`).

Si el documento no existe, la tool devuelve error y la lista de IDs disponibles; la IA puede informar al usuario.

### 5.7 Instrucciones adicionales dinámicas

En cada mensaje, además de las instrucciones fijas del Assistant en OpenAI, el servidor inyecta `additional_instructions` con los PDFs **actuales** de ese consultorio.

Ventaja: si el admin sube un PDF nuevo, la IA lo “conoce” en el siguiente mensaje sin reconfigurar el Assistant a mano.

### 5.8 Crear y listar asistentes

```bash
npm run create-assistant   # Crea uno genérico (gpt-4o-mini) e imprime el ID
npm run list-assistants    # Lista los de la cuenta
```

El ID resultante se guarda en Firebase en el campo `assistantId` del cliente (y opcionalmente en `ASISTENTE_ID` del `.env` para casos simples).

### 5.9 Qué NO hace la IA (límites actuales)

- No responde en grupos.
- No procesa documentos enviados por pacientes como “contenido para leer” (salvo el flujo admin `/upload`).
- No genera por sí sola la agenda diaria de citas (el scheduler está preparado, pero la fuente de citas aún es un placeholder).
- No persiste threads en base de datos propia.
- No usa Chat Completions ni Responses API; solo Assistants (beta).

### 5.10 Costes y rendimiento (visión práctica)

- Cada mensaje normal = al menos un run de OpenAI (consumo de tokens).
- Las confirmaciones cortas evitan ese coste.
- Si el usuario manda varios mensajes seguidos mientras hay un run activo, el segundo puede fallar con el mensaje de espera.
- El polling espera hasta ~5 minutos; respuestas muy largas o tools lentas pueden acercarse a ese límite.

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

---

## 7. Firebase (consultorios / clientes)

### Colección: `clients`

Cada documento representa un consultorio. Campos típicos:

| Campo | Significado |
|-------|-------------|
| `name` | Nombre visible (ej. Consultorio Dr. García) |
| `adminPhone` | WhatsApp del administrador (quien puede `/on`, `/off`, etc.) |
| `assistantPhone` | Número del bot (dónde llegan los mensajes de pacientes) |
| `assistantId` | ID del Assistant de OpenAI (`asst_…`) |
| `botStatus` | `active` o `inactive` |
| `status` | `active` o `deleted` (borrado lógico) |
| `ULTRAMSG_*` | Credenciales de la instancia WhatsApp de ese cliente |
| `createdAt` / `updatedAt` | Fechas |

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

Los archivos viven en disco: `uploads/{clientId}/{documento_id}.pdf` (volumen Docker recomendado).

---

## 11. Estructura del proyecto

```text
asistente-openai/
├── src/
│   ├── index.js                 # Servidor Express: todos los endpoints
│   ├── middleware/
│   │   └── requireAdminAuth.js  # Protección de endpoints de documentos
│   ├── managers/
│   │   ├── openAIManager.js     # Integración OpenAI Assistants
│   │   └── ultramsgManager.js   # WhatsApp vía UltraMsg
│   ├── controllers/
│   │   ├── webhookManager.js    # Orquestación de mensajes entrantes
│   │   └── schedulerController.js
│   └── services/
│       ├── firebaseService.js   # Clientes en Firestore
│       ├── commandManager.js    # Comandos #cliente /cmd
│       ├── documentStore.js     # PDFs en disco
│       ├── confirmationManager.js
│       ├── userContextManager.js
│       └── scheduler.js         # Cron jobs
├── uploads/                     # PDFs por cliente
├── scripts/
│   ├── create-assistant.js
│   ├── list-assistants.js
│   └── migrate-to-firebase.js
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

**No hay frontend** en este repositorio.

---

## 12. Catálogo de endpoints

Base típica: `http://localhost:3000` (o tu dominio en producción).

### Webhook WhatsApp

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/webhook` | Verificación con `?token=` |
| POST | `/webhook` | Mensajes entrantes de UltraMsg |

### OpenAI / conversaciones

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/reset_threads` | Borra el mapa local de threads usuario–cliente |

### Contexto de usuario

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/mark-agenda-sent` | Marca agenda enviada; espera confirmación |
| GET | `/user-context/:userId` | Consulta contexto |
| POST | `/clear-user-context/:userId` | Limpia contexto |

### Scheduler

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/scheduler/status` | Estado de tareas |
| POST | `/scheduler/run/:taskName` | Ejecuta `dailyAgenda`, `weeklyCleanup` o `statusCheck` |
| POST | `/scheduler/stop` | Detiene tareas |
| POST | `/scheduler/restart` | Reinicia tareas |

### Clientes (Firebase)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/clients` | Lista (cache) |
| POST | `/clients` | Crea (`name`, `adminPhone`, `assistantPhone`, `assistantId`) |
| GET | `/clients/:clientId` | Uno |
| PUT | `/clients/:clientId` | Actualiza |
| DELETE | `/clients/:clientId` | Soft delete |
| GET | `/clients/stats/overview` | Estadísticas |
| POST | `/clients/reload` | Recarga desde Firestore |
| GET | `/clients/status` | Estado actual sin recargar |

### Documentos (requieren `ADMIN_API_TOKEN`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/clients/:clientId/documents` | Lista PDFs |
| POST | `/clients/:clientId/documents` | Sube PDF |

### Bots y grupos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/bots/status` | Estado de bots |
| POST | `/bots/command` | Ejecuta comando (`clientId`, `command`) |
| GET | `/group-settings` | Política: no responder en grupos |

### UltraMsg

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

Varios endpoints de clientes/bots/scheduler **no exigen token admin**. Si el servidor es público, conviene protegerlos (firewall, reverse proxy, VPN o autenticación adicional).

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
| `ASISTENTE_ID` | Fallback / scripts |
| `ULTRAMSG_TOKEN` / `INSTANCE_ID` / `WEBHOOK_TOKEN` | WhatsApp (fallback) |
| `FIREBASE_CREDENTIALS` | JSON de service account |
| `ADMIN_API_TOKEN` | API de documentos |
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

1. Crear Assistant en OpenAI (`npm run create-assistant` o Dashboard).
2. Registrar tool `enviar_pdf` e instrucciones (cuándo enviar cada PDF).
3. Crear instancia UltraMsg y escanear QR.
4. Crear cliente en Firebase / `POST /clients` con teléfonos + `assistantId` + credenciales UltraMsg.
5. Apuntar webhook UltraMsg a `https://tu-dominio/webhook`.
6. Subir PDFs (`/upload` o API).
7. Probar desde WhatsApp: pregunta normal + `#ID /status` desde el admin.

---

## 14. Scripts útiles

| Script | Qué hace |
|--------|----------|
| `npm run create-assistant` | Crea Assistant OpenAI |
| `npm run list-assistants` | Lista Assistants |
| `npm run migrate-firebase` | Migración de clientes a Firebase |
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
- **Threads y contexto**: en memoria; se pierden al reiniciar.
- **Documentación antigua** (`README.md` y algunas guías) puede mencionar Meta/Facebook o archivos que ya no existen; esta `DOCUMENTACION.md` refleja el código actual (UltraMsg + Firebase + Assistants).
- El script para añadir la tool `enviar_pdf` mencionado en guías antiguas puede no estar en el repo; se puede registrar la tool desde el Dashboard de OpenAI.

---

## 16. Glosario (para usuarios no técnicos)

| Término | Significado sencillo |
|---------|----------------------|
| **API / Endpoint** | Una “dirección” del servidor a la que se le pide algo (listar clientes, health, etc.). |
| **Webhook** | UltraMsg “llama” a tu servidor cuando llega un mensaje de WhatsApp. |
| **Assistant** | Perfil de IA en OpenAI (personalidad + reglas + herramientas). |
| **Thread** | Historial de chat entre un paciente y un consultorio. |
| **Run** | Una ejecución de “pensar y responder” de la IA. |
| **Tool** | Acción que la IA pide al servidor (ej. enviar un PDF). |
| **Cliente** | Un consultorio/negocio registrado en Firebase. |
| **Instancia UltraMsg** | Una conexión WhatsApp concreta (un número). |
| **Admin** | Persona autorizada a encender/apagar el bot y gestionar PDFs. |

---

## 17. Resumen final

Este proyecto es un **backend multi-consultorio** que:

1. Escucha WhatsApp (UltraMsg).
2. Identifica el consultorio.
3. Delega la conversación a **OpenAI Assistants** (threads + runs + tool `enviar_pdf`).
4. Devuelve la respuesta (y PDFs si aplica) por WhatsApp.
5. Permite a cada admin controlar su bot y sus documentos sin entrar al código.

La inteligencia artificial no “vive” en WhatsApp: vive en OpenAI. Este servidor es el **traductor e integrador** entre pacientes, consultorios, documentos y el modelo de IA.

---

*Documento generado a partir del código del repositorio `asistente-openai`. Si el código cambia (nuevos endpoints, nueva API de OpenAI, etc.), conviene actualizar esta guía.*
