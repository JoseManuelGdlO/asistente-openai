# Configuración → Agendar citas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship module Configuración (Assistant → Configuración → Agendar citas) with a new agenda engine: multi-capacity slots, date exceptions, transactional booking in Firestore, async Google sync with retries, and migration from `calendar_settings`.

**Architecture:** New package `src/services/configuracion/agenda/` (settings + appointments stores, availability, booking, sync worker, service facade, routes). Reuse Google OAuth client and time helpers from `src/services/calendar/` where possible. Wire bots with `agendaEngine: 'v2'` to the new engine; migrate legacy docs idempotently. Panel hub + agenda UI replace Calendar mount after cutover for v2 bots.

**Tech Stack:** Node/Express, Firestore transactions, existing `GoogleCalendarClient`, Jest + supertest, vanilla panel JS, node-cron via existing Scheduler.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-05-configuracion-agenda-design.md`
- `capacity` per service, integer ≥ 1 (migration default `1`)
- One Google event per appointment; exclude own `eventId`s from freeBusy occupancy
- Exceptions: closed day OR special intervals that date only
- Confirm to client after DB reserve; sync failures → `retry` + backoff, keep reservation
- Tool names unchanged: `listBookingServices`, `getAvailableSlots`, `createAppointment`, `rescheduleAppointment`, `cancelAppointment`
- Panel writes: `requireAdminAuth` + edit-lock (`X-Editor-Id`)
- Spanish UI copy; do not delete legacy `calendar_settings` on first deploy
- Prefer small focused files under `configuracion/agenda/`

## File Structure

| File | Responsibility |
| --- | --- |
| `src/services/configuracion/agenda/constants.js` | Defaults, tool names, backoff, statuses |
| `src/services/configuracion/agenda/normalize.js` | Validate/normalize hours, services+capacity, exceptions, rules |
| `src/services/configuracion/agenda/readiness.js` | describePhase for panel |
| `src/services/configuracion/agenda/time.js` | Re-export or thin wrap of calendar time + exception-aware day windows |
| `src/services/configuracion/agenda/availability.js` | generate candidate slots + cupo counting |
| `src/services/configuracion/agenda/settingsStore.js` | Firestore `agenda_settings` |
| `src/services/configuracion/agenda/appointmentsStore.js` | Firestore `agenda_appointments/{id}/items` |
| `src/services/configuracion/agenda/booking.js` | Transactional create/reschedule/cancel |
| `src/services/configuracion/agenda/syncWorker.js` | Process pending/retry sync |
| `src/services/configuracion/agenda/tools.js` | Tool defs + instructions (port from calendar/tools) |
| `src/services/configuracion/agenda/agendaService.js` | Facade: panel, OAuth, execute tools |
| `src/services/configuracion/agenda/createAgendaService.js` | Factory |
| `src/services/configuracion/agenda/migrate.js` | Idempotent calendar → agenda migration |
| `src/services/configuracion/agenda/routes.js` | `/clients/:id/configuracion/agenda/*` |
| `src/services/firebaseService.js` | Collection refs for agenda_* |
| `src/services/scheduler.js` | Tick sync worker |
| `src/index.js` / `src/app.js` / `openAIManager.js` | Mount + route tools by `agendaEngine` |
| `public/js/configuracion-hub.js` | Hub under Assistant |
| `public/js/agenda-panel.js` | Agendar citas UI |
| `public/js/app.js` / `index.html` | Navigation + mounts |
| `tests/unit/agenda-*.test.js` | Engine unit tests |
| `tests/http/agenda.test.js` | HTTP panel tests |
| `scripts/migrate-agenda-v2.js` | CLI migration helper |

---

### Task 1: Normalize + readiness + availability (pure logic)

**Files:**
- Create: `src/services/configuracion/agenda/constants.js`
- Create: `src/services/configuracion/agenda/normalize.js`
- Create: `src/services/configuracion/agenda/readiness.js`
- Create: `src/services/configuracion/agenda/time.js`
- Create: `src/services/configuracion/agenda/availability.js`
- Test: `tests/unit/agenda-availability.test.js`

**Interfaces:**
- Produces: `normalizeAgenda(input) → { ok, value|error }`; `describePhase(doc)`; `dayWindows(date, hours, exceptions) → { closed, intervals }`; `countOccupancy({ startMs, endMs, appointments, googleBusy, ownEventIds, bufferMs })`; `buildAvailableSlots({ now, settings, service, appointments, googleBusy, fromDate, toDate, ... })`

- [ ] **Step 1: Write failing unit tests** for capacity=2 (two confirmed same slot still free once), closed exception (no slots), special intervals, own eventId excluded from google busy

- [ ] **Step 2: Implement constants/normalize/readiness/time/availability** — reuse `rangesOverlap`, `generateSlots` patterns from `src/services/calendar/time.js`; extend occupancy to count overlaps vs capacity instead of boolean busy

- [ ] **Step 3: Run** `npx jest tests/unit/agenda-availability.test.js -v` → PASS

- [ ] **Step 4: Commit** `feat(agenda): availability engine with capacity and exceptions`

---

### Task 2: Firestore stores + booking transactions

**Files:**
- Create: `src/services/configuracion/agenda/settingsStore.js`
- Create: `src/services/configuracion/agenda/appointmentsStore.js`
- Create: `src/services/configuracion/agenda/booking.js`
- Modify: `src/services/firebaseService.js` (collections `agenda_settings`, `agenda_appointments`)
- Test: `tests/unit/agenda-booking.test.js`

**Interfaces:**
- Produces: `SettingsStore.get/transaction`; `AppointmentsStore.listRange / createInTx / updateInTx`; `bookAppointment({ clientId, service, start, end, customer... })` → `{ ok, appointment }` or `{ ok:false, code:'slot_full' }`; status `confirmed` + sync `pending`

- [ ] **Step 1: Failing tests** with in-memory fake stores: success book, second book at capacity=1 fails, capacity=2 allows two

- [ ] **Step 2: Implement stores + booking** using Firestore transactions when real; fakes for unit tests

- [ ] **Step 3: Jest PASS**

- [ ] **Step 4: Commit** `feat(agenda): transactional booking with capacity checks`

---

### Task 3: Sync worker

**Files:**
- Create: `src/services/configuracion/agenda/syncWorker.js`
- Test: `tests/unit/agenda-sync.test.js`
- Modify: `src/services/scheduler.js` — cron every 1–2 min calling `agendaService.processSyncQueue()`

**Interfaces:**
- Consumes: Google client `createEvent` / `updateEvent` / `deleteEvent` (adapt from `googleCalendarClient.js`)
- Produces: `processSyncQueue({ limit })` — pending/retry due; success → synced; fail → retry + backoff (`syncAttempts`, `nextRetryAt`)

- [ ] **Step 1: Failing tests** success path, failure schedules retry without deleting appointment, cancel sync deletes event when eventId present

- [ ] **Step 2: Implement worker**

- [ ] **Step 3: Jest PASS + wire scheduler tick**

- [ ] **Step 4: Commit** `feat(agenda): async Google sync with retries`

---

### Task 4: AgendaService facade + tools + factory

**Files:**
- Create: `tools.js`, `agendaService.js`, `createAgendaService.js` under `configuracion/agenda/`
- Port OAuth/panel methods from `calendarService.js` against settingsStore
- Test: `tests/unit/agenda-tools.test.js` (list services, get slots, create returns before sync)

**Interfaces:**
- Produces: same surface as CalendarService for tools: `isCalendarTool`/`isAgendaTool`, `execute`, `mergeTools`, `buildInstructions`, `getPanel`, `saveAgenda`, OAuth helpers
- `createAppointment` must NOT await Google create — only enqueue pending

- [ ] **Step 1–4: TDD tools execute paths + commit** `feat(agenda): AgendaService tools and panel facade`

---

### Task 5: HTTP routes + app mount

**Files:**
- Create: `src/services/configuracion/agenda/routes.js`
- Modify: `src/app.js` mount `mountAgendaRoutes`
- Modify: `tests/helpers/createTestApp.js`
- Test: `tests/http/agenda.test.js`

**Routes:**
- `GET /clients/:clientId/configuracion/agenda`
- `PUT /clients/:clientId/configuracion/agenda/settings` (lock)
- OAuth/invite/select/disconnect/notice parity under same prefix (or delegate shared handlers)

- [ ] **Step 1–4: HTTP tests + implement + commit** `feat(agenda): admin API for configuracion/agenda`

---

### Task 6: Migration + engine switch

**Files:**
- Create: `src/services/configuracion/agenda/migrate.js`
- Create: `scripts/migrate-agenda-v2.js`
- Modify: `src/index.js` create both services; `openAIManager` picks calendar vs agenda by client `agendaEngine`
- Test: `tests/unit/agenda-migrate.test.js`

**Interfaces:**
- `migrateClient(clientId)` idempotent; sets `agendaEngine: 'v2'` on assistant/client doc
- Default missing/`v1` → legacy CalendarService

- [ ] **Step 1–4: TDD migration + wire routing + commit** `feat(agenda): migrate calendar_settings to agenda v2`

---

### Task 7: Panel UI Configuración + Agendar citas

**Files:**
- Create: `public/js/configuracion-hub.js`, `public/js/agenda-panel.js`
- Modify: `public/js/app.js` — Assistant nav: Configuración hub → Agendar citas; for `agendaEngine==='v2'` use new panel; hide old Calendar mount when v2
- Modify: `public/index.html` scripts
- Modify: `public/styles.css` minimal if needed

**UI sections:** status, Google connect, hours, services+capacity, exceptions, rules, enable — mirror useful UX from `calendar-panel.js` with new fields.

- [ ] **Step 1: Implement hub + agenda panel**

- [ ] **Step 2: Manual smoke via panel routes / unit not required for DOM**

- [ ] **Step 3: Commit** `feat(agenda): Configuración hub and Agendar citas panel`

---

### Task 8: Integration verification

- [ ] **Step 1: Run** `npx jest tests/unit/agenda-*.test.js tests/http/agenda.test.js tests/unit/calendar.test.js -v` — agenda green; calendar regression still passes

- [ ] **Step 2: Fix any failures**

- [ ] **Step 3: Commit** if fixes needed; mark plan tasks done in this file

---

## Spec coverage checklist

- [x] Config module hub + Agendar citas UI → Task 7
- [x] Hours, duration, capacity, exceptions → Tasks 1, 4, 5, 7
- [x] Availability BD + Google without double count → Task 1, 4
- [x] Transactional reserve + slot full → Task 2
- [x] Confirm before Google; retry sync → Tasks 3–4
- [x] Migration + agendaEngine flag → Task 6
- [x] Tests listed in spec → Tasks 1–6, 8
