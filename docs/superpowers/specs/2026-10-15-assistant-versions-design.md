# Versiones manuales del Assistant

## Objetivo

En la pestaña Assistant de un bot, quien administra el panel puede archivar el estado actual como un hito con nota opcional y, más adelante, verlo o restaurarlo. Guardar el Assistant sigue publicando al bot en vivo sin dejar historial.

WhatsApp y el playground leen solo el documento vivo `Assistants/{clientId}`. Un hito no cambia el bot hasta que alguien lo restaura o lo vuelve a publicar.

## Comportamiento

Hay dos acciones de publicación:

- **Guardar Assistant** actualiza `Assistants/{clientId}` y no crea un hito. El checkbox de resetear sesiones de WhatsApp sigue ligado solo a este botón.
- **Guardar versión** publica el formulario al documento vivo y, en el mismo batch, archiva un hito. Reinicia la sesión del playground igual que Guardar Assistant. No resetea las sesiones de WhatsApp.

**Ver** carga el hito en el formulario y no llama al endpoint de publicación. Arriba del formulario aparece: “Viendo la versión del {fecha}. Aún no está en vivo.” Ese aviso desaparece al guardar el Assistant, al guardar una versión o al restaurar.

**Restaurar** pide confirmación: “Esto reemplaza el Assistant en vivo con la versión del {fecha}. Si no guardaste una versión del estado actual, ese estado se pierde.” Si se confirma, copia el snapshot al documento vivo, reinicia el playground y no crea otro hito.

## Datos

Subcolección `Assistants/{clientId}/versions/{id}`. El id lo asigna Firestore. El documento no se edita ni se borra desde el panel.

| Campo | Regla |
| --- | --- |
| `label` | Nota opcional. Se recorta. Cadena vacía si no hay nota. Si tras recortar pasa de 120 caracteres, la petición se rechaza. |
| `prompt` | Texto publicado. |
| `tools` | Array publicado. |
| `config` | Objeto publicado. |
| `responseSchema` | Objeto publicado. |
| `createdAt` | `serverTimestamp`. |

El hito guarda siempre el snapshot completo de esos cuatro campos tal como quedan publicados. Si el cuerpo omite uno, se conserva el valor vivo actual y ese valor es el que entra al hito.

Borrar un bot no borra esta subcolección.

## API

Todas las rutas usan `requireAdminAuth`. El controlador delega en `CommandManager`, y este en `FirebaseService`, igual que el Assistant actual.

Validación del cuerpo en `POST /assistants/:clientId/versions`:

- `label`, si viene, es string. Si no es string, 400. Tras `trim`, longitud máxima 120. Si no viene, se guarda `""`.
- `prompt`, si viene, es string. Si no es string, 400.
- `tools`, si viene, es un array. Si no, 400.
- `config` y `responseSchema`, si vienen, son objetos que no sean array ni `null`. Si no, 400.

`PUT /assistants/:clientId` no cambia: sigue sin crear hitos y sin esta validación nueva.

### `POST /assistants/:clientId/versions`

Publica y archiva en un solo batch de Firestore. Si el cliente o el Assistant no existen, 404 y no se escribe nada. Si el batch falla, el documento vivo queda como estaba y no se crea el hito.

Después del batch, reinicia el playground con el mismo `try/catch` que el `PUT` actual. Si ese reinicio falla, la respuesta sigue en 200 y `playgroundReset` es `false`.

```json
{
  "ok": true,
  "assistant": {},
  "version": { "id": "", "label": "", "createdAt": "", "promptExcerpt": "" },
  "playgroundReset": true,
  "message": "Versión guardada"
}
```

`createdAt` sale en ISO. `promptExcerpt` son los primeros 160 caracteres del prompt, con saltos de línea sustituidos por un espacio y recortados.

### `GET /assistants/:clientId/versions`

404 si no existe el Assistant. Lista de la más nueva a la más vieja, sin el snapshot completo:

```json
{
  "ok": true,
  "versions": [
    { "id": "", "label": "", "createdAt": "", "promptExcerpt": "" }
  ]
}
```

### `GET /assistants/:clientId/versions/:versionId`

404 si no existe el Assistant o la versión. Devuelve el snapshot completo: `id`, `label`, `createdAt`, `prompt`, `tools`, `config`, `responseSchema`.

### `POST /assistants/:clientId/versions/:versionId/restore`

Lee el hito y actualiza el documento vivo con sus cuatro campos mediante la actualización ya existente, fuera de un batch de versionado. No crea un hito. 404 si falta el Assistant o la versión. Reinicia el playground igual que el `POST` de versiones.

```json
{
  "ok": true,
  "assistant": {},
  "playgroundReset": true,
  "message": "Versión restaurada"
}
```

## Interfaz

La pestaña Assistant mantiene el formulario y el playground. El historial no es una tarjeta debajo del formulario.

- Encima de la etiqueta del prompt, un botón **Versiones** (`btn-sm btn-secondary`, `aria-expanded`). Cerrado al entrar en la pestaña.
- Al abrirlo, la rejilla pasa a tres columnas: versiones, formulario, playground. La columna de versiones es la más estrecha. En pantallas estrechas queda encima del formulario. Cerrado, el panel no ocupa espacio (`hidden`).
- La lista se pide la primera vez que se abre el panel y otra vez después de guardar una versión con éxito.
- Estado vacío: “Aún no hay versiones guardadas.”
- Cada fila muestra la fecha con el formateador `es-MX` del panel y la nota, o “Sin nota”. Solo una fila va expandida a la vez. Al expandirla se ven el extracto del prompt, **Ver** y **Restaurar**.
- **Ver** pide el snapshot, rellena prompt, tools, config y responseSchema, y muestra el aviso de que aún no está en vivo.
- **Restaurar** usa la confirmación descrita arriba. Si se acepta, publica, recarga el formulario con el Assistant devuelto, quita el aviso y, si `playgroundReset` es true, limpia el log del playground.
- En la fila de acciones, el orden es **Guardar Assistant**, **Solo resetear sesiones**, un input de nota (`maxlength="120"`, placeholder “Nota opcional”) y **Guardar versión** (`type="button"`, estilo secundario).
- **Guardar versión** valida el JSON en el cliente con las mismas reglas que Guardar Assistant. Si falla, muestra el aviso y no llama al servidor. Si sale bien, limpia la nota, refresca la lista, quita el aviso de “viendo una versión” y limpia el playground cuando `playgroundReset` es true. El aviso de éxito es “Versión guardada. Playground reiniciado.” Si `playgroundReset` es false: “Versión guardada. No se pudo reiniciar el playground.” Restaurar usa las mismas dos frases, con “Versión restaurada”.

## Errores

| Caso | Resultado |
| --- | --- |
| JSON inválido en el formulario | Aviso en el panel, sin petición |
| `tools` no es un array en `POST .../versions` | 400 |
| `label` de más de 120 caracteres tras recortar | 400 |
| `config` o `responseSchema` no son un objeto (array o `null` incluidos) | 400 |
| Cliente o Assistant inexistente | 404 |
| Versión inexistente | 404 |
| Fallo del batch | El documento vivo queda como estaba y no se crea el hito |
| Fallo al reiniciar el playground | 200, `playgroundReset: false`, aviso de que la operación quedó hecha y el playground no se reinició |

## Pruebas

HTTP con Supertest, en un archivo nuevo `tests/http/assistant-versions.test.js`, usando `createTestApp`:

- `POST` 200 publica y devuelve el hito y `playgroundReset`
- `POST` 400 si `tools` no es un array
- `POST` 400 si la nota supera 120 caracteres
- `POST` 404 si el Assistant no existe
- `GET` lista ordenada
- `GET` de una versión devuelve el snapshot
- `GET` y `POST restore` 404 si la versión no existe
- `POST restore` 200 actualiza el Assistant y no pide crear un hito
- `PUT /assistants/:id` sigue sin invocar el guardado de versiones

Unitarias de `FirebaseService` en `tests/unit/firebaseService.assistantVersions.test.js`, con el Firestore en memoria:

- El batch actualiza el documento vivo y crea el hito, o no deja ninguno si el Assistant no existe
- El hito contiene el snapshot completo, incluida la nota vacía
- La lista sale de la más nueva a la más vieja y cada ítem trae `promptExcerpt` de hasta 160 caracteres
- Restaurar copia los cuatro campos al documento vivo y el número de hitos no cambia

El mock de `tests/helpers/mockFirebase.js` hoy no abre subcolecciones, `WriteBatch` no tiene `update` y las queries no tienen `orderBy`. Esas tres piezas se añaden para poder probar este flujo. `createTestApp` expone los métodos nuevos del `commandManager` como el resto de métodos mock.

El panel no tiene runner de tests de UI. Al implementarlo se comprueba en el navegador: abrir y cerrar Versiones, fila vacía, expandir una versión, Ver sin publicar, Restaurar con confirmación cancelada y aceptada, y Guardar versión con nota.

## Fuera de alcance

- Foto automática en cada Guardar Assistant
- Borrar o editar un hito
- Borrar la subcolección al eliminar el bot
- Comparar dos versiones en un diff
- Resetear sesiones de WhatsApp desde Guardar versión
