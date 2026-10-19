# Bloqueo de edición 1 usuario por bot

## Objetivo

En el panel admin, cuando alguien trabaja en Assistant o Consultorio de un bot, solo ese editor puede guardar cambios. Otros usuarios del panel pueden ver el formulario en solo lectura. Documentos y Sesiones siguen editables.

## Comportamiento

- **Adquisición automática:** al abrir `#/clients/:id/assistant` o `#/clients/:id/consultorio`, el cliente pide el lease. El primero lo obtiene; los demás entran en vista.
- **Liberación:** al salir de esas pestañas, al hacer logout, o en `pagehide` (best-effort).
- **Heartbeat:** el holder renueva el lease cada ~30s. TTL ~120s. Si el navegador se cierra sin `release`, el lease caduca solo.
- **UI:** banner genérico “Otro usuario está editando” (sin mostrar email). Sin botón de forzar liberación; el lease se libera al salir o al caducar el TTL.
- **Identidad:** UUID `editor_id` en `sessionStorage`, enviado como header `X-Editor-Id`. El `ADMIN_API_TOKEN` compartido no cambia.

## Datos

Colección Firestore `assistant_edit_locks/{clientId}`:

| Campo | Regla |
| --- | --- |
| `holderId` | UUID de la pestaña/sesión del panel |
| `expiresAt` | Timestamp; lease vencido si `expiresAt <= now` |
| `updatedAt` | Último heartbeat / acquire |
| `holderEmail` | Opcional; solo logs; no se expone en UI |

El lease es **por bot** (`clientId`): Assistant y Consultorio comparten el mismo lock.

## API

Todas las rutas usan `requireAdminAuth`. Header requerido en mutaciones de lock y escrituras protegidas: `X-Editor-Id`.

| Método | Ruta | Efecto |
| --- | --- | --- |
| GET | `/bots/:clientId/edit-lock` | Estado (`held`, `isHolder`, `expiresAt`) |
| POST | `/bots/:clientId/edit-lock/acquire` | Toma o renueva si libre, vencido o mismo holder |
| POST | `/bots/:clientId/edit-lock/heartbeat` | Extiende si eres holder; 409 si no |
| POST | `/bots/:clientId/edit-lock/release` | Libera si eres holder |
### Escrituras protegidas (409 si no eres holder o lease vencido)

- `PUT /assistants/:clientId`
- `POST /assistants/:clientId/versions`
- `POST /assistants/:clientId/versions/:versionId/restore`
- `PUT /clients/:clientId`
- `POST /clients/:clientId/meta/invite`
- `POST /clients/:clientId/meta/disconnect`

### No bloqueados

Documentos, Sesiones, GETs, playground, listados, delete de sesiones, reset playground.

## Reglas de acquire

Se otorga el lease si:

1. No existe el documento, o
2. `expiresAt` ya pasó, o
3. `holderId` es el mismo `X-Editor-Id` (renovación).

Si otro holder tiene lease vigente → `held: true`, `isHolder: false` (HTTP 200 en acquire; escrituras posteriores 409).

## Frontend

- `public/js/api.js`: persiste `editor_id`; envía `X-Editor-Id` en `api()`.
- `public/js/app.js`: acquire al montar Assistant/Consultorio; heartbeat; release al salir; modo read-only; 409 en PUT → mensaje y solo lectura.

## Fuera de alcance

- Mostrar email del editor en la UI
- WebSockets / Firestore `onSnapshot` en el browser
- Roles distintos a “quien tiene el lease”
- Bloqueo de Documentos/Sesiones
