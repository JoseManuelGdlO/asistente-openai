# Blacklist en el panel por bot

## Objetivo

Gestionar desde el panel admin la lista de números bloqueados de cada bot (misma data que `/blacklist` por WhatsApp): listar, agregar y quitar. Los números en la lista no reciben respuesta del bot.

## Decisiones

- UI en la ficha/editor de cada bot (junto a Calendar / prompt), no pantalla global.
- Paridad con WhatsApp: list / add / remove.
- Escrituras respetan edit-lock (mismo criterio que Calendar/prompt); sin lock → solo lectura.
- Comandos WhatsApp `/blacklist` se mantienen; panel y WhatsApp comparten Firestore.

## Datos

Colección existente `blacklist-phone` (vía `firestoreEnv`):

| Campo | Regla |
| --- | --- |
| `id_empresa` | `clientId` del bot |
| `phone` | Número normalizado (sin `@c.us`, trim) |

Sin cambios de esquema. Reutilizar `firebaseService.getBlacklist`, `addToBlacklist`, `removeFromBlacklist`, `isPhoneBlacklisted`.

## API

Todas las rutas usan `requireAdminAuth`. Header `X-Editor-Id` en mutaciones (edit-lock).

| Método | Ruta | Lock | Efecto |
| --- | --- | --- | --- |
| GET | `/clients/:clientId/blacklist` | no | Lista `{ id, phone }[]` |
| POST | `/clients/:clientId/blacklist` | sí | Body `{ phone }` → add; si ya existe, respuesta ok informativa (`added: false`) |
| DELETE | `/clients/:clientId/blacklist/:phone` | sí | Quita el número |

**Implementación:** módulo `src/services/blacklist/routes.js` montado desde `createApp` (mismo patrón que Calendar). Validar que el assistant exista (404 si no). Normalizar teléfono con la misma lógica que Firebase.

**Errores:** `401` sin auth · `404` bot inexistente · `409` sin edit-lock · `400` teléfono vacío/inválido · `500` genérico.

## Frontend

- `public/js/blacklist-panel.js`: `BlacklistPanel.mount(el, { clientId, canEdit, api })`.
- Montaje en el editor del assistant, debajo de Calendar (`#blacklist-mount`), encima del form del prompt.
- Card “Números bloqueados”: input + Agregar, lista con Quitar por fila, estado vacío, flash ok/error.
- Sin `canEdit`: controles deshabilitados; GET sigue activo.
- Script en `index.html`; estilos mínimos en `styles.css` solo si hace falta (reutilizar cards/botones).

## Flujo

1. Abrir assistant → GET → render lista.
2. Agregar → POST → refrescar; mensaje si ya estaba.
3. Quitar → confirmación corta → DELETE → refrescar.
4. WhatsApp y panel operan sobre la misma lista sin sincronización extra.

## Tests

- HTTP: GET/POST/DELETE (auth, lock, add idempotente, remove, 404).
- No cambiar la lógica de webhook/blacklist salvo regresión.

## Fuera de alcance

- Import masivo, búsqueda, export, motivo de bloqueo.
- Pantalla global de blacklist.
- Desactivar comandos WhatsApp.
- Cambios al modelo Firestore o a la comprobación en webhooks.
