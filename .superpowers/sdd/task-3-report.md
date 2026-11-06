# Task 3 Report — Settings + appointments stores, transactional booking

Status: DONE (with concerns)

## Note
`.superpowers/sdd/task-3-brief.md` did not exist; I worked from Task 3 in `docs/superpowers/plans/2026-11-06-configuracion-agenda.md` plus the Task 2 review.

## Files
- `src/services/configuracion/agenda/settingsStore.js`: `MemorySettingsStore`, `FirestoreSettingsStore`, `defaultDocument`, `normalizeDoc`. Provides `getRaw` and `transaction(clientId, mutator)`.
- `src/services/configuracion/agenda/appointmentsStore.js`: `MemoryAppointmentsStore` and `FirestoreAppointmentsStore` (`agenda_appointments/{clientId}/items/{id}`). Both provide `get`, `listConfirmedInRange`, `listSyncDue`, `listAllClientIds`, `update` and `runTransaction(clientId, fn(tx))`. `tx` has `get`, `set` and `listConfirmed`.
- `src/services/configuracion/agenda/booking.js`: `bookAppointment`, `rescheduleAppointmentRecord`, `cancelAppointmentRecord`, `ownEventIdsFrom`.
- `tests/unit/agenda-booking.test.js`: 13 tests.
- `src/services/firebaseService.js`: no change needed. `agendaSettingsCollection` (`agenda_settings`) and `agendaAppointmentsCollection` (`agenda_appointments`) were already defined at lines 77-78.

## Behavior
- Every booking, reschedule and cancel runs inside `appointmentsStore.runTransaction`. Capacity is checked via `countOccupancy` after `tx.listConfirmed()`.
- Review fix applied: `ownEventIds` is seeded from the `eventId` of every confirmed appointment. A Google mirror block is therefore not double-counted. A reschedule is not blocked by its own mirror event. Both are covered by tests.
- Booking returns `confirmed`, `sync:'pending'`, `eventId:''`, `syncAttempts:0`. A full slot returns `{ok:false, code:'slot_full'}`.
- Reschedule keeps `eventId` and the id, resets sync to `pending`, and ignores its own old slot.
- Cancel keeps the row with `status:'cancelled'` and `sync:'pending'`.
- Additional codes: `not_found`, `invalid_range`.
- The Memory stores serialize transactions per client. A concurrent test confirms 4 parallel bookings of a capacity-1 slot yield exactly 1.

## Tests
`npx jest tests/unit/agenda-booking.test.js tests/unit/agenda-availability.test.js`: 2 suites, 25/25 pass. The booking tests failed first (modules missing).

## Concerns
1. The Firestore stores have no automated test (no emulator or mock). They follow the existing `FirestoreCalendarStore` pattern. Verify manually or add a mock later.
2. Firestore `listConfirmed` and `listConfirmedInRange` query `status=='confirmed'` and filter by range in memory. This avoids a composite index but scans all of a client's confirmed rows, which will grow over time. Consider a `startMs` field plus an index later.
3. `listAllClientIds` uses `listDocuments()`, so it also returns clients whose parent doc is missing. This is intentional.
4. The Task 2 minor items 2 to 6 are untouched, apart from the `ownEventIds` seeding done in `booking.js`. `countOccupancy` itself still defaults `ownEventIds` to empty.
5. The unrelated working-tree change in `public/js/agenda-panel.js` was left uncommitted.

## Review fix: cancelled pending-delete events in occupancy
- Finding: cancelled appointments that still have a Google `eventId` (pending delete) were not seeded into `ownEventIds` because `listConfirmed` excludes them, so their freeBusy mirror was counted as foreign busy.
- Fix: added `tx.listCancelledWithEventId()` to the Memory and Firestore store transactions (`appointmentsStore.js`). `booking.js` now builds `ownEventIds` via `loadOwnEventIds(tx, confirmed)` (confirmed + cancelled-with-eventId) in both `bookAppointment` and `rescheduleAppointmentRecord`.
- Regression test: `cancelled appointment with pending-delete eventId does not block its slot via google mirror`. It books, sets eventId `g1`, cancels, mirrors the range in googleBusy, and a new capacity-1 booking succeeds. The test failed against the old `booking.js` (1 failed, 13 passed) and passes with the fix.
- Re-run: `npx jest tests/unit/agenda-booking.test.js tests/unit/agenda-availability.test.js --verbose` -> 2 suites passed, 26/26 tests passed.
- Note: the Firestore `listCancelledWithEventId` is not covered by an automated test (same limitation as concern 1); it queries `status=='cancelled'` and filters `eventId` in memory.
