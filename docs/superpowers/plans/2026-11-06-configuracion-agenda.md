# Configuración → Agendar citas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Assistant → Configuración → Agendar citas as a clean rewrite: capacity slots, exceptions, transactional Firestore booking, Google sync with retries; hard-cut the old Calendar module with no data migration.

**Architecture:** New package `src/services/configuracion/agenda/` written from scratch. Shared `src/services/googleCalendar/` holds only the OAuth/API client moved out of Calendar. Single runtime path: `agendaService` for tools, panel, playground, and sync. No `agendaEngine`, no `BookingRouter`, no `/migrate`.

**Tech Stack:** Node/Express, Firestore transactions, axios Google Calendar API, Jest + supertest, vanilla panel JS, node-cron via existing `Scheduler`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-06-configuracion-agenda-design.md`
- Rewrite: delete current `configuracion/agenda` draft contents and rewrite; do not “fix in place” migrate/dual-engine code
- No migration from `calendar_settings`; do not read legacy busy/holds
- `capacity` per service, integer 1–100; same wall-clock slot may hold up to `capacity` confirmed appointments
- One Google event per appointment; exclude own `eventId` (and matching own ranges when freeBusy has no id) from occupancy
- Exceptions: closed day OR special intervals that date only
- Confirm to client after DB reserve; sync failures → keep reservation + `retry` + backoff
- Tool names: `listBookingServices`, `getAvailableSlots`, `createAppointment`, `rescheduleAppointment`, `cancelAppointment`
- Panel writes: `requireAdminAuth` + edit-lock (`X-Editor-Id`)
- Spanish UI copy
- Prefer small focused files under `configuracion/agenda/`

## File Structure

| File | Responsibility |
| --- | --- |
| `src/services/googleCalendar/client.js` | OAuth + freeBusy + CRUD events (moved from calendar) |
| `src/services/configuracion/agenda/constants.js` | Defaults, tool names, backoff |
| `src/services/configuracion/agenda/normalize.js` | Validate hours/services/exceptions/rules |
| `src/services/configuracion/agenda/readiness.js` | `describePhase` for panel |
| `src/services/configuracion/agenda/time.js` | TZ helpers + `dayWindows` with exceptions |
| `src/services/configuracion/agenda/availability.js` | Slot generation + occupancy vs capacity |
| `src/services/configuracion/agenda/settingsStore.js` | Memory + Firestore `agenda_settings` |
| `src/services/configuracion/agenda/appointmentsStore.js` | Memory + Firestore `agenda_appointments/{clientId}/items` |
| `src/services/configuracion/agenda/booking.js` | Transactional book/reschedule/cancel |
| `src/services/configuracion/agenda/syncWorker.js` | Process pending/retry queue |
| `src/services/configuracion/agenda/tools.js` | Tool defs + bot instructions |
| `src/services/configuracion/agenda/oauthState.js` | Signed OAuth state (port from calendar) |
| `src/services/configuracion/agenda/invite.js` | Calendar-connect invite tokens for agenda |
| `src/services/configuracion/agenda/agendaService.js` | Facade: panel, OAuth, tool execute, sync kick |
| `src/services/configuracion/agenda/createAgendaService.js` | Factory |
| `src/services/configuracion/agenda/routes.js` | `/clients/:id/configuracion/agenda/*` + public OAuth/invite |
| `src/services/firebaseService.js` | Keep `agenda_*` collection refs; drop calendar wiring if unused |
| `src/services/scheduler.js` | Agenda sync tick → `agendaService.processSyncQueue` |
| `src/index.js` / `src/app.js` / `openAIManager.js` | Only `agendaService`; remove calendar dual path |
| `public/js/configuracion-hub.js` | Hub |
| `public/js/agenda-panel.js` | Agendar citas UI (no migrate) |
| `public/js/app.js` / `public/index.html` | Mount hub; remove CalendarPanel |
| `tests/unit/agenda-*.test.js` | Engine tests |
| `tests/http/agenda.test.js` | Panel API tests |
| Delete | `bookingRouter.js`, `migrate.js`, `src/services/calendar/*` (after move), `calendar-panel.js`, calendar HTTP tests |

**Supersedes:** `docs/superpowers/plans/2026-11-05-configuracion-agenda.md` (migration / dual-engine plan). Delete that file in Task 1.

---

### Task 1: Extract Google client + wipe dual-engine draft

**Files:**
- Create: `src/services/googleCalendar/client.js` (move body from `src/services/calendar/googleCalendarClient.js`)
- Delete: `docs/superpowers/plans/2026-11-05-configuracion-agenda.md`
- Delete entire tree under `src/services/configuracion/agenda/` (draft)
- Modify later tasks recreate agenda files; for this task only leave google client + empty agenda dir optional

**Interfaces:**
- Produces: `GoogleCalendarClient`, `GoogleCalendarError`, `SCOPES` from `src/services/googleCalendar/client.js`
- Same public methods as today: `configured()`, `authorizationUrl`, `exchangeCode`, `refresh`, `userEmail`, `listCalendars`, `freeBusy`, `createEvent`, `updateEvent`, `deleteEvent`

- [ ] **Step 1: Move client**

```bash
mkdir -p src/services/googleCalendar
git mv src/services/calendar/googleCalendarClient.js src/services/googleCalendar/client.js
```

Update any remaining requires that pointed at `../calendar/googleCalendarClient` once agenda is recreated (Task 6). Temporarily keep a one-line re-export in old path only if something still imports it during the transition commit; prefer updating callers in the same commit as cutover (Task 8).

- [ ] **Step 2: Delete obsolete plan + draft agenda package**

```bash
rm -f docs/superpowers/plans/2026-11-05-configuracion-agenda.md
rm -rf src/services/configuracion/agenda
mkdir -p src/services/configuracion/agenda
rm -f tests/unit/agenda-availability.test.js tests/unit/agenda-booking.test.js tests/unit/agenda-sync.test.js 2>/dev/null || true
```

Do **not** delete `public/js/configuracion-hub.js` yet (rewritten in Task 9). Remove broken requires from `src/index.js` so the app can boot with stubs in Task 8 — for this commit, comment or temporarily remove `createAgendaService` / `BookingRouter` / `migrate` imports and pass `agendaService: null` until Task 8 (or leave index broken until Task 8 in the same day — prefer a single follow-up Task 8 quickly).

- [ ] **Step 3: Commit**

```bash
git add -A src/services/googleCalendar src/services/calendar src/services/configuracion docs/superpowers/plans
git commit -m "$(cat <<'EOF'
refactor: extract Google Calendar client; wipe agenda draft for rewrite

EOF
)"
```

---

### Task 2: Normalize, readiness, time, availability (TDD)

**Files:**
- Create: `src/services/configuracion/agenda/constants.js`
- Create: `src/services/configuracion/agenda/normalize.js`
- Create: `src/services/configuracion/agenda/readiness.js`
- Create: `src/services/configuracion/agenda/time.js`
- Create: `src/services/configuracion/agenda/availability.js`
- Test: `tests/unit/agenda-availability.test.js`

**Interfaces:**
- Produces:
  - `normalizeAgenda(input) → { ok: true, value } | { ok: false, error }`
  - `describePhase(doc) → { phase, label, ready, missing[], detail? }`
  - `dayWindows({ date, hours, exceptions, timeZone }) → { closed: boolean, intervals: [{start,end}] }`
  - `countOccupancy({ startMs, endMs, appointments, googleBusy, ownEventIds, bufferMs, excludeAppointmentId }) → number`
  - `buildAvailableSlots({ now, timeZone, hours, exceptions, service, rules, fromDate, toDate, appointments, googleBusy, limit, onePerDay, excludeAppointmentId }) → { dates?: [], slots?: [] }`
- `service.capacity` default 1; slot open iff `occupied < capacity`

- [ ] **Step 1: Write failing tests**

```js
const { normalizeAgenda } = require('../../src/services/configuracion/agenda/normalize');
const { buildAvailableSlots, countOccupancy } = require('../../src/services/configuracion/agenda/availability');

function baseHours() {
  return {
    monday: { enabled: true, intervals: [{ start: '09:00', end: '12:00' }] },
    tuesday: { enabled: false, intervals: [] },
    wednesday: { enabled: false, intervals: [] },
    thursday: { enabled: false, intervals: [] },
    friday: { enabled: false, intervals: [] },
    saturday: { enabled: false, intervals: [] },
    sunday: { enabled: false, intervals: [] }
  };
}

describe('agenda availability', () => {
  it('normalizeAgenda requires capacity 1–100 on services', () => {
    const bad = normalizeAgenda({
      timezone: 'America/Mexico_City',
      hours: baseHours(),
      services: [{ name: 'X', durationMinutes: 30, capacity: 0, active: true }],
      rules: {}
    });
    expect(bad.ok).toBe(false);
  });

  it('allows two bookings when capacity is 2', () => {
    const start = Date.parse('2026-11-09T15:00:00.000Z'); // pick Monday 09:00 Mexico
    const end = start + 30 * 60 * 1000;
    const occupied = countOccupancy({
      startMs: start,
      endMs: end,
      appointments: [
        { id: 'a1', status: 'confirmed', start: new Date(start).toISOString(), end: new Date(end).toISOString() }
      ],
      googleBusy: [],
      bufferMs: 0
    });
    expect(occupied).toBe(1);
    // with capacity 2, buildAvailableSlots must still include that wall time — assert in integration below
  });

  it('closed exception yields no slots that day', () => {
    const result = buildAvailableSlots({
      now: new Date('2026-11-08T12:00:00.000Z'),
      timeZone: 'America/Mexico_City',
      hours: baseHours(),
      exceptions: [{ date: '2026-11-09', closed: true }],
      service: { id: 'svc_1', durationMinutes: 30, capacity: 1, active: true },
      rules: { minNoticeMinutes: 0, maxDaysAhead: 14, slotIntervalMinutes: 30, bufferMinutes: 0 },
      fromDate: '2026-11-09',
      toDate: '2026-11-09',
      appointments: [],
      googleBusy: [],
      limit: 20
    });
    expect((result.slots || []).length).toBe(0);
  });

  it('does not double-count google busy matching own synced event range', () => {
    const startIso = '2026-11-09T15:00:00.000Z';
    const endIso = '2026-11-09T15:30:00.000Z';
    const n = countOccupancy({
      startMs: Date.parse(startIso),
      endMs: Date.parse(endIso),
      appointments: [{
        id: 'a1', status: 'confirmed', start: startIso, end: endIso, eventId: 'g1'
      }],
      googleBusy: [{ start: startIso, end: endIso }],
      ownEventIds: new Set(['g1']),
      bufferMs: 0
    });
    expect(n).toBe(1);
  });
});
```

Adjust the Monday 09:00 Mexico UTC anchor in tests using the same `zonedToUtc('2026-11-09','09:00','America/Mexico_City')` helper once `time.js` exists.

- [ ] **Step 2: Run tests — expect FAIL** (modules missing)

```bash
npx jest tests/unit/agenda-availability.test.js -v
```

- [ ] **Step 3: Implement** `constants.js`, `normalize.js` (hours, services+capacity, exceptions, rules, timezone), `readiness.js` (disabled / disconnected / revoked / incomplete / ready), `time.js` (port TZ math from old `calendar/time.js` + `dayWindows` that prefers exception intervals or closed), `availability.js` (`countOccupancy`, `buildAvailableSlots` stepping by `slotIntervalMinutes`, skip if `occupied >= capacity`).

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest tests/unit/agenda-availability.test.js -v
```

- [ ] **Step 5: Commit**

```bash
git add src/services/configuracion/agenda tests/unit/agenda-availability.test.js
git commit -m "$(cat <<'EOF'
feat(agenda): availability engine with capacity and exceptions

EOF
)"
```

---

### Task 3: Settings + appointments stores and transactional booking

**Files:**
- Create: `src/services/configuracion/agenda/settingsStore.js`
- Create: `src/services/configuracion/agenda/appointmentsStore.js`
- Create: `src/services/configuracion/agenda/booking.js`
- Modify: `src/services/firebaseService.js` — ensure:

```js
this.agendaSettingsCollection = col('agenda_settings');
this.agendaAppointmentsCollection = col('agenda_appointments');
```

- Test: `tests/unit/agenda-booking.test.js`

**Interfaces:**
- `SettingsStore.getRaw(clientId)`, `transaction(clientId, mutator) → nextDoc`
- `AppointmentsStore.get`, `listConfirmedInRange`, `listSyncDue`, `listAllClientIds`, `runTransaction(clientId, async tx => …)` where `tx` has `get`, `set`, `listConfirmed`
- `bookAppointment({ appointmentsStore, clientId, service, start, end, customerName, customerPhone, notes, googleBusy, rules, excludeAppointmentId }) → { ok:true, appointment } | { ok:false, code:'slot_full' }`
- On success: `status:'confirmed'`, `sync:'pending'`, `eventId:''`, `syncAttempts:0`
- `rescheduleAppointmentRecord(...)`, `cancelAppointmentRecord(...)` → set `sync:'pending'` (cancel keeps row, `status:'cancelled'`)

- [ ] **Step 1: Failing tests with Memory stores**

```js
const { MemoryAppointmentsStore } = require('../../src/services/configuracion/agenda/appointmentsStore');
const { bookAppointment } = require('../../src/services/configuracion/agenda/booking');

describe('agenda booking', () => {
  const service = { id: 'svc_a', durationMinutes: 30, capacity: 1 };
  const start = new Date('2026-11-09T15:00:00.000Z');
  const end = new Date('2026-11-09T15:30:00.000Z');

  it('books first slot and rejects second when capacity is 1', async () => {
    const store = new MemoryAppointmentsStore();
    const first = await bookAppointment({
      appointmentsStore: store,
      clientId: 'C1',
      service,
      start,
      end,
      customerName: 'Ana',
      googleBusy: [],
      rules: { bufferMinutes: 0 }
    });
    expect(first.ok).toBe(true);
    expect(first.appointment.sync).toBe('pending');

    const second = await bookAppointment({
      appointmentsStore: store,
      clientId: 'C1',
      service,
      start,
      end,
      customerName: 'Luis',
      googleBusy: [],
      rules: { bufferMinutes: 0 }
    });
    expect(second).toEqual({ ok: false, code: 'slot_full' });
  });

  it('allows two when capacity is 2', async () => {
    const store = new MemoryAppointmentsStore();
    const svc = { ...service, capacity: 2 };
    const a = await bookAppointment({ appointmentsStore: store, clientId: 'C1', service: svc, start, end, customerName: 'A', googleBusy: [], rules: { bufferMinutes: 0 } });
    const b = await bookAppointment({ appointmentsStore: store, clientId: 'C1', service: svc, start, end, customerName: 'B', googleBusy: [], rules: { bufferMinutes: 0 } });
    expect(a.ok && b.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run — FAIL**

```bash
npx jest tests/unit/agenda-booking.test.js -v
```

- [ ] **Step 3: Implement** Memory + Firestore stores. Firestore appointments: `agenda_appointments/{clientId}/items/{id}` with `runTransaction` using `this.db.runTransaction`. Booking calls `isSlotOpen` / occupancy inside the transaction after `listConfirmed`.

- [ ] **Step 4: PASS + commit**

```bash
git add src/services/configuracion/agenda src/services/firebaseService.js tests/unit/agenda-booking.test.js
git commit -m "$(cat <<'EOF'
feat(agenda): transactional booking with capacity checks

EOF
)"
```

---

### Task 4: Sync worker

**Files:**
- Create: `src/services/configuracion/agenda/syncWorker.js`
- Test: `tests/unit/agenda-sync.test.js`

**Interfaces:**
- `nextSyncBackoffMs(attemptIndex)` using `SYNC_BACKOFF_MS` from constants; `MAX_SYNC_ATTEMPTS = 12`
- `syncOneAppointment({ google, token, calendarId, timeZone, clientId, service, appointment, appointmentsStore, nowMs })`
- `processClientSyncQueue({ clientId, … })` / `processSyncQueue({ settingsStore, appointmentsStore, google, ensureAccessToken, listServices, now })`
- On create success → `sync:'synced'`, set `eventId`
- On failure → `sync:'retry'`, increment `syncAttempts`, set `nextRetryAt`, `lastSyncError`
- Cancelled + `eventId` → `deleteEvent` then clear eventId / mark synced
- Confirm-to-client never waits on this worker

- [ ] **Step 1: Failing test**

```js
const { MemoryAppointmentsStore } = require('../../src/services/configuracion/agenda/appointmentsStore');
const { syncOneAppointment } = require('../../src/services/configuracion/agenda/syncWorker');

describe('agenda sync', () => {
  it('marks synced with eventId on create', async () => {
    const store = new MemoryAppointmentsStore();
    const apt = {
      id: 'apt_1', serviceId: 'svc_a', start: '2026-11-09T15:00:00.000Z', end: '2026-11-09T15:30:00.000Z',
      customerName: 'Ana', status: 'confirmed', sync: 'pending', eventId: '', syncAttempts: 0, nextRetryAt: 0
    };
    await store.runTransaction('C1', async (tx) => { await tx.set('apt_1', apt); });
    const google = {
      createEvent: jest.fn().mockResolvedValue({ id: 'g_evt' })
    };
    const result = await syncOneAppointment({
      google,
      token: 't',
      calendarId: 'primary',
      timeZone: 'America/Mexico_City',
      clientId: 'C1',
      service: { name: 'Consulta', durationMinutes: 30 },
      appointment: apt,
      appointmentsStore: store
    });
    expect(result.ok).toBe(true);
    const saved = await store.get('C1', 'apt_1');
    expect(saved.sync).toBe('synced');
    expect(saved.eventId).toBe('g_evt');
  });

  it('keeps reservation and schedules retry on google error', async () => {
    const store = new MemoryAppointmentsStore();
    const apt = {
      id: 'apt_2', serviceId: 'svc_a', start: '2026-11-09T15:00:00.000Z', end: '2026-11-09T15:30:00.000Z',
      customerName: 'Ana', status: 'confirmed', sync: 'pending', eventId: '', syncAttempts: 0, nextRetryAt: 0
    };
    await store.runTransaction('C1', async (tx) => { await tx.set('apt_2', apt); });
    const google = { createEvent: jest.fn().mockRejectedValue(new Error('boom')) };
    await syncOneAppointment({
      google, token: 't', calendarId: 'primary', timeZone: 'America/Mexico_City',
      clientId: 'C1', service: { name: 'Consulta', durationMinutes: 30 },
      appointment: apt, appointmentsStore: store
    });
    const saved = await store.get('C1', 'apt_2');
    expect(saved.status).toBe('confirmed');
    expect(saved.sync).toBe('retry');
    expect(saved.syncAttempts).toBe(1);
    expect(saved.lastSyncError).toBeTruthy();
  });
});
```

- [ ] **Step 2–4: FAIL → implement → PASS → commit** `feat(agenda): google sync worker with retry backoff`

---

### Task 5: Tools + AgendaService facade + factory

**Files:**
- Create: `src/services/configuracion/agenda/tools.js`
- Create: `src/services/configuracion/agenda/oauthState.js` (port sign/verify from calendar)
- Create: `src/services/configuracion/agenda/agendaService.js`
- Create: `src/services/configuracion/agenda/createAgendaService.js`
- Test: `tests/unit/agenda-tools.test.js` (execute getAvailableSlots / createAppointment with memory stores + fake google)

**Interfaces:**
- `AgendaService` constructor `{ settingsStore, appointmentsStore, google, now, env, tokenOverride }`
- `toPanel(doc)`, `getPanel(clientId)`, `setEnabled`, `saveAgenda` (normalizeAgenda + write), `selectCalendar`, `beginOAuth`, `completeOAuth`, `disconnect`, `dismissNotice`, `setPlaygroundWrite`
- `loadRuntime(clientId)` → ready flag + connection + services + rules
- `execute(name, args, context)` dispatch tools; if not ready → instruction not to invent slots
- `createAppointment`: call `bookAppointment` then best-effort `syncOneAppointment`; always return success to bot if book ok (include `appointmentId`, note sync pending if needed)
- On `slot_full`: return error + optional fresh `offerList` from `buildAvailableSlots`
- `processSyncQueue()` for scheduler
- `createAgendaService({ firebaseService, settingsStore, appointmentsStore, google, now, env })` imports google from `../../googleCalendar/client`

- [ ] **Step 1: Tool execute test** — list services; createAppointment with capacity race; dry-run / non-live origin respects playground flag (port rules from old calendar: live origins `meta|ultramsg|own` write; playground needs `playgroundWriteEnabled`)

- [ ] **Step 2: Implement facade** — keep file focused; delegate booking/availability/sync; encrypt tokens with existing `credentialsCrypto`

- [ ] **Step 3: PASS + commit** `feat(agenda): service facade and bot tools`

---

### Task 6: HTTP routes + invite + OAuth callback

**Files:**
- Create: `src/services/configuracion/agenda/routes.js`
- Create: `src/services/configuracion/agenda/invite.js` (port calendar invite helpers; field names can stay `calendarInvite*` on assistant doc for less churn **or** rename to `agendaInvite*` — prefer keep existing invite field names on assistant to avoid Meta/link churn, but URLs must hit agenda routes)
- Test: `tests/http/agenda.test.js`

**API (requireAdminAuth; mutations need edit-lock like blacklist/calendar):**

| Method | Path |
| --- | --- |
| GET | `/clients/:clientId/configuracion/agenda` |
| PUT | `/clients/:clientId/configuracion/agenda/settings` |
| PUT | `/clients/:clientId/configuracion/agenda/enabled` |
| PUT | `/clients/:clientId/configuracion/agenda/playground-write` |
| GET | `/clients/:clientId/configuracion/agenda/calendars` |
| POST | `/clients/:clientId/configuracion/agenda/select-calendar` |
| POST | `/clients/:clientId/configuracion/agenda/oauth/start` |
| POST | `/clients/:clientId/configuracion/agenda/disconnect` |
| POST | `/clients/:clientId/configuracion/agenda/notice/dismiss` |
| POST | `/clients/:clientId/calendar/invite` → rebind to agenda invite **or** new `/configuracion/agenda/invite` and update panel copy links |
| GET | public OAuth callback — reuse path `/calendar/oauth/callback` **or** `/configuracion/agenda/oauth/callback` with env `GOOGLE_CALENDAR_REDIRECT_URI` updated; pick **one** and document in commit message. Prefer `/configuracion/agenda/oauth/callback` and update redirect env/docs. |

**No `/migrate` route.**

- [ ] **Step 1: HTTP tests** (supertest + `createTestApp` with `agendaService` memory factory)

```js
const request = require('supertest');
const { createTestApp, authHeader } = require('../helpers/createTestApp');
const { createAgendaService } = require('../../src/services/configuracion/agenda/createAgendaService');
const { MemorySettingsStore } = require('../../src/services/configuracion/agenda/settingsStore');
const { MemoryAppointmentsStore } = require('../../src/services/configuracion/agenda/appointmentsStore');

function agendaApp() {
  const agendaService = createAgendaService({
    settingsStore: new MemorySettingsStore(),
    appointmentsStore: new MemoryAppointmentsStore(),
    google: { configured: () => false },
    env: {}
  });
  const { app } = createTestApp({
    commandManager: {
      getAssistantConfig: jest.fn().mockResolvedValue({ clientId: 'C1', status: 'active' })
    },
    agendaService
  });
  return { app };
}

describe('API configuracion agenda', () => {
  it('starts disabled and saves settings with capacity', async () => {
    const { app } = agendaApp();
    const first = await request(app).get('/clients/C1/configuracion/agenda').set(authHeader());
    expect(first.status).toBe(200);
    expect(first.body.agenda.enabled).toBe(false);

    await request(app).put('/clients/C1/configuracion/agenda/enabled').set(authHeader()).send({ enabled: true });
    const saved = await request(app)
      .put('/clients/C1/configuracion/agenda/settings')
      .set(authHeader())
      .send({
        timezone: 'America/Mexico_City',
        hours: { /* monday open 09-12, rest closed — same shape as normalize */ },
        services: [{ name: 'Consulta', durationMinutes: 30, capacity: 3, active: true }],
        exceptions: [],
        rules: { minNoticeMinutes: 60, maxDaysAhead: 30, slotIntervalMinutes: 30, bufferMinutes: 0, allowCancel: true, allowReschedule: true }
      });
    expect(saved.status).toBe(200);
    expect(saved.body.agenda.services[0].capacity).toBe(3);
  });
});
```

Fill `hours` completely in the real test file (all 7 keys).

- [ ] **Step 2: Implement `mountAgendaRoutes(app, deps)`**; wire edit-lock helper same as calendar/blacklist routes

- [ ] **Step 3: PASS + commit** `feat(agenda): panel API routes for configuracion agenda`

---

### Task 7: Wire runtime — index, app, OpenAI tools, scheduler; delete Calendar

**Files:**
- Modify: `src/index.js` — only `createAgendaService`; `openAIManager.calendarBooking = agendaService` (or rename property to `agendaBooking` if you update all call sites); `scheduler.setAgendaSyncHandler(() => agendaService.processSyncQueue())`; remove `BookingRouter`, `migrateClient`, `resolveAgendaEngine`, `createCalendarService`
- Modify: `src/app.js` — `mountAgendaRoutes` only; remove `mountCalendarRoutes`; client list summary from `agendaService.publicSummary`; remove dual `calendarSummary` engine switch
- Modify: `src/managers/openAIManager.js` — merge agenda tools from `agendaService` only
- Modify: `src/services/scheduler.js` — keep `scheduleAgendaSync` calling handler
- Delete: `src/services/calendar/**` (after invite/oauth moved)
- Delete: `tests/http/calendar.test.js`, `tests/unit/calendar.test.js` (replace coverage already in agenda tests)
- Modify: `tests/helpers/createTestApp.js` — accept `agendaService`, stop requiring calendar

- [ ] **Step 1: Wire and delete**; fix compile errors from missing calendar imports

- [ ] **Step 2: Run**

```bash
npx jest tests/unit/agenda-availability.test.js tests/unit/agenda-booking.test.js tests/unit/agenda-sync.test.js tests/unit/agenda-tools.test.js tests/http/agenda.test.js -v
```

Expected: PASS

- [ ] **Step 3: Commit** `feat(agenda): cut over runtime to agenda; remove calendar module`

---

### Task 8: Panel UI — Configuración hub + Agendar citas

**Files:**
- Rewrite: `public/js/configuracion-hub.js` — hub only; no “Motor v2” / migrate hints
- Rewrite: `public/js/agenda-panel.js` — enable, OAuth/invite, calendars, hours, services (duration **and capacity**), exceptions, rules, playground write, show `lastSyncError` if exposed on panel payload
- Modify: `public/js/app.js` — mount ConfiguracionHub on assistant tab; on open agenda mount AgendaPanel into slot; **remove** `CalendarPanel.mount` / `#calendar-mount`
- Modify: `public/index.html` — drop `calendar-panel.js` script; keep hub + agenda-panel
- Delete: `public/js/calendar-panel.js` (and `calendar-conectar.js` only if fully replaced by agenda invite pages — if `calendar-conectar.html` still used, point it at agenda OAuth callback)

**Hub markup:**

```html
<div class="card stack configuracion-hub">
  <h2>Configuración</h2>
  <p class="muted">Ajustes del bot. La primera opción es la agenda de citas.</p>
  <div class="config-list">
    <button type="button" class="btn-secondary config-item" id="config-open-agenda">Agendar citas</button>
  </div>
  <div id="config-agenda-slot"></div>
</div>
```

- [ ] **Step 1: Implement UI** calling `/clients/:id/configuracion/agenda*` only

- [ ] **Step 2: Manual smoke** — open assistant → Configuración → Agendar citas; Calendar card gone

- [ ] **Step 3: Commit** `feat(agenda): configuracion hub and agenda panel UI`

---

### Task 9: Docs + final verification

**Files:**
- Modify: `docs/DOCUMENTACION.md` (or calendar sections) — document Configuración → Agendar citas, new collections, OAuth redirect path, no migration
- Modify: `.env.example` / `config.example` if redirect URI name changes

- [ ] **Step 1: Full test suite**

```bash
npx jest
```

Expected: PASS (fix or delete any leftover calendar references)

- [ ] **Step 2: Spec self-check** — every section of `2026-11-06-configuracion-agenda-design.md` has a task above (hub, data, flows, API without migrate, cutover, errors, tests)

- [ ] **Step 3: Commit** `docs: agenda rewrite cutover notes`

---

## Self-review (plan vs spec)

| Spec item | Task |
| --- | --- |
| Configuración hub + Agendar citas | 8 |
| Rewrite from scratch / discard draft | 1 |
| No migration | 1, 6 (no route), 7 |
| capacity same-slot cupos | 2, 3 |
| exceptions | 2 |
| transactional book + slot_full | 3, 5 |
| sync pending/retry + confirm without Google | 4, 5 |
| Google client reuse only | 1 |
| Hard cut Calendar panel/runtime | 7, 8 |
| API under `/configuracion/agenda` | 6 |
| Tests unit + HTTP | 2–6, 9 |

No migrate/dual-engine leftovers in this plan. Placeholder scan: none intentional.
