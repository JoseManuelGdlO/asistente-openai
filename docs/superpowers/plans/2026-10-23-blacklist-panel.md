# Blacklist Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose per-bot blacklist management (list / add / remove) in the admin panel assistant editor, sharing Firestore data with WhatsApp `/blacklist`.

**Architecture:** HTTP routes in `src/services/blacklist/routes.js` mount like Calendar; they call existing `firebaseService` blacklist methods and enforce `requireAdminAuth` + edit-lock on writes. Frontend `public/js/blacklist-panel.js` mounts under `#blacklist-mount` in the assistant editor.

**Tech Stack:** Express, Firebase/Firestore stubs in Jest + supertest, vanilla JS panel (same as Calendar).

## Global Constraints

- Same Firestore collection `blacklist-phone` (`id_empresa`, `phone`); no schema changes.
- WhatsApp `/blacklist` stays unchanged.
- Writes require edit-lock (`X-Editor-Id`); GET does not.
- UI lives only in per-bot assistant editor (below Calendar).
- Spanish UI copy; reuse panel card/button styles.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/services/blacklist/routes.js` | Mount GET/POST/DELETE blacklist routes |
| `src/app.js` | Import + mount blacklist routes |
| `tests/helpers/createTestApp.js` | Stub `getBlacklist` / `addToBlacklist` / `removeFromBlacklist` |
| `tests/http/blacklist.test.js` | HTTP coverage |
| `public/js/blacklist-panel.js` | UI mount module |
| `public/js/app.js` | `#blacklist-mount` + mount call |
| `public/index.html` | Script tag |
| `public/styles.css` | Minimal blacklist list styles |

---

### Task 1: HTTP API + tests

**Files:**
- Create: `src/services/blacklist/routes.js`
- Create: `tests/http/blacklist.test.js`
- Modify: `src/app.js` (import + mount near calendar)
- Modify: `tests/helpers/createTestApp.js` (firebase stubs)

**Interfaces:**
- Consumes: `firebaseService.getBlacklist(id)`, `addToBlacklist(id, phone)`, `removeFromBlacklist(id, phone)`; `commandManager.getAssistantConfig`; `requireAdminAuth`; `requireEditLock(req,res,clientId)`
- Produces: `mountBlacklistRoutes(app, deps)`

- [ ] **Step 1: Add firebase stubs in createTestApp**

In `createStubDeps`, add to `firebaseService`:

```js
getBlacklist: fnAsync([]),
addToBlacklist: fnAsync({ added: true, id: 'bl1' }),
removeFromBlacklist: fnAsync(true),
```

- [ ] **Step 2: Write failing HTTP tests** in `tests/http/blacklist.test.js`

```js
const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');

function editorHeaders(id = 'editor-a') {
  return { ...authHeader(), 'X-Editor-Id': id };
}

describe('API blacklist por bot', () => {
  it('GET lista números del bot', async () => {
    const { app, deps } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' })
      },
      firebaseService: {
        getBlacklist: jest.fn().mockResolvedValue([{ id: '1', phone: '5211111111111' }])
      }
    });
    const res = await request(app).get('/clients/C1/blacklist').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.phones).toEqual([{ id: '1', phone: '5211111111111' }]);
    expect(deps.firebaseService.getBlacklist).toHaveBeenCalledWith('C1');
  });

  it('GET 404 si assistant no existe', async () => {
    const { app } = createTestApp({
      commandManager: { getAssistantConfig: jest.fn().mockResolvedValue(null) }
    });
    const res = await request(app).get('/clients/MISSING/blacklist').set(authHeader());
    expect(res.status).toBe(404);
  });

  it('POST agrega número con edit-lock', async () => {
    const { app, deps } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' })
      },
      firebaseService: {
        addToBlacklist: jest.fn().mockResolvedValue({ added: true, id: 'bl2' }),
        getBlacklist: jest.fn().mockResolvedValue([{ id: 'bl2', phone: '5222222222222' }])
      }
    });
    const res = await request(app)
      .post('/clients/C1/blacklist')
      .set(editorHeaders())
      .send({ phone: '5222222222222@c.us' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.added).toBe(true);
    expect(deps.firebaseService.addToBlacklist).toHaveBeenCalledWith('C1', '5222222222222@c.us');
    expect(res.body.phones).toHaveLength(1);
  });

  it('POST 400 sin teléfono', async () => {
    const { app } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' })
      }
    });
    const res = await request(app)
      .post('/clients/C1/blacklist')
      .set(editorHeaders())
      .send({});
    expect(res.status).toBe(400);
  });

  it('POST 409 sin edit-lock', async () => {
    const err = new Error('Otro usuario está editando este bot');
    err.code = 'EDIT_LOCK_NOT_HOLDER';
    const { app } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' })
      },
      firebaseService: {
        assertEditLockHolder: jest.fn().mockRejectedValue(err)
      }
    });
    const res = await request(app)
      .post('/clients/C1/blacklist')
      .set(editorHeaders())
      .send({ phone: '5211111111111' });
    expect(res.status).toBe(409);
  });

  it('DELETE quita número', async () => {
    const { app, deps } = createTestApp({
      commandManager: {
        getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' })
      },
      firebaseService: {
        removeFromBlacklist: jest.fn().mockResolvedValue(true),
        getBlacklist: jest.fn().mockResolvedValue([])
      }
    });
    const res = await request(app)
      .delete('/clients/C1/blacklist/5211111111111')
      .set(editorHeaders());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.removed).toBe(true);
    expect(deps.firebaseService.removeFromBlacklist).toHaveBeenCalledWith('C1', '5211111111111');
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL** (routes missing)

Run: `npx jest tests/http/blacklist.test.js -v`
Expected: FAIL (404 or cannot find module)

- [ ] **Step 4: Implement `src/services/blacklist/routes.js`**

```js
function mountBlacklistRoutes(app, deps) {
  const { firebaseService, requireAdminAuth, requireEditLock, commandManager } = deps;

  async function assertAssistant(res, clientId) {
    if (!commandManager || typeof commandManager.getAssistantConfig !== 'function') return true;
    const assistant = await commandManager.getAssistantConfig(clientId);
    if (!assistant || assistant.status === 'deleted') {
      res.status(404).json({ ok: false, error: 'Assistant no encontrado' });
      return false;
    }
    return true;
  }

  function normalizePhoneInput(phone) {
    if (phone == null) return '';
    return String(phone).replace('@c.us', '').trim();
  }

  app.get('/clients/:clientId/blacklist', requireAdminAuth, async (req, res) => {
    try {
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      const phones = await firebaseService.getBlacklist(clientId);
      res.json({ ok: true, phones });
    } catch (error) {
      console.error('Error leyendo blacklist:', error);
      res.status(500).json({ ok: false, error: 'Error leyendo la lista de bloqueados' });
    }
  });

  app.post('/clients/:clientId/blacklist', requireAdminAuth, async (req, res) => {
    try {
      const { clientId } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const phone = normalizePhoneInput(req.body?.phone);
      if (!phone) {
        return res.status(400).json({ ok: false, error: 'Indica un número de teléfono' });
      }
      const result = await firebaseService.addToBlacklist(clientId, req.body.phone);
      const phones = await firebaseService.getBlacklist(clientId);
      res.json({
        ok: true,
        added: Boolean(result?.added),
        message: result?.message,
        phones
      });
    } catch (error) {
      console.error('Error agregando a blacklist:', error);
      res.status(500).json({ ok: false, error: 'Error agregando el número' });
    }
  });

  app.delete('/clients/:clientId/blacklist/:phone', requireAdminAuth, async (req, res) => {
    try {
      const { clientId, phone } = req.params;
      if (!(await assertAssistant(res, clientId))) return;
      if (!(await requireEditLock(req, res, clientId))) return;
      const normalized = normalizePhoneInput(decodeURIComponent(phone));
      if (!normalized) {
        return res.status(400).json({ ok: false, error: 'Indica un número de teléfono' });
      }
      const removed = await firebaseService.removeFromBlacklist(clientId, normalized);
      const phones = await firebaseService.getBlacklist(clientId);
      res.json({ ok: true, removed: Boolean(removed), phones });
    } catch (error) {
      console.error('Error quitando de blacklist:', error);
      res.status(500).json({ ok: false, error: 'Error quitando el número' });
    }
  });
}

module.exports = { mountBlacklistRoutes };
```

- [ ] **Step 5: Mount in `src/app.js`**

```js
const { mountBlacklistRoutes } = require('./services/blacklist/routes');
// after mountCalendarRoutes:
mountBlacklistRoutes(app, {
  firebaseService,
  requireAdminAuth,
  requireEditLock: (req, res, clientId) => requireEditLockHolder(firebaseService, req, res, clientId),
  commandManager
});
```

- [ ] **Step 6: Run tests — expect PASS**

Run: `npx jest tests/http/blacklist.test.js -v`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/blacklist/routes.js src/app.js tests/helpers/createTestApp.js tests/http/blacklist.test.js
git commit -m "feat: add per-bot blacklist HTTP API for the admin panel"
```

---

### Task 2: Frontend panel UI

**Files:**
- Create: `public/js/blacklist-panel.js`
- Modify: `public/js/app.js` (mount point + call)
- Modify: `public/index.html` (script)
- Modify: `public/styles.css` (minimal)

**Interfaces:**
- Consumes: `api`, `escapeHtml`, `canEdit`, `clientId`; endpoints from Task 1
- Produces: `window.BlacklistPanel.mount(el, opts)`

- [ ] **Step 1: Create `public/js/blacklist-panel.js`**

Implement mount that:
1. Shows loading, then GET `/clients/:id/blacklist`
2. Renders card with title “Números bloqueados”, helper text, add form, list with remove buttons
3. POST on add; DELETE on remove (with `confirm`)
4. Disables controls when `!canEdit`
5. Calls `onError(err)` when present (for edit-lock 409), else local flash

Key behaviors:
- empty state: “No hay números bloqueados”
- after add with `added: false`, show `message` or “El número ya estaba en la lista”
- encode phone in DELETE URL with `encodeURIComponent`

- [ ] **Step 2: Wire into assistant editor**

In `public/js/app.js` template, after `#calendar-mount`:

```html
<div id="blacklist-mount"></div>
```

After CalendarPanel.mount:

```js
if (window.BlacklistPanel) {
  window.BlacklistPanel.mount(document.getElementById('blacklist-mount'), {
    clientId,
    canEdit,
    api,
    escapeHtml,
    onError: (err) => handleLostEditLock(document.getElementById('form-flash'), err)
  });
}
```

In `public/index.html`, before `app.js`:

```html
<script src="/js/blacklist-panel.js"></script>
```

- [ ] **Step 3: Minimal CSS** for `.blacklist-card`, `.blacklist-row`, `.blacklist-add` (flex row for input+button; list rows with phone + quitar)

- [ ] **Step 4: Commit**

```bash
git add public/js/blacklist-panel.js public/js/app.js public/index.html public/styles.css
git commit -m "feat: add blacklist panel UI on each bot assistant page"
```

---

### Task 3: Verify

- [ ] **Step 1:** Run `npx jest tests/http/blacklist.test.js tests/http/calendar.test.js tests/http/edit-lock.test.js -v` — all PASS
- [ ] **Step 2:** Manual smoke (optional): open assistant with edit lock, add/remove a number, confirm WhatsApp `/blacklist list` matches
