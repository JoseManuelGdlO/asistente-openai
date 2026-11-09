# Task 7 report: runtime cutover to agenda

## Status
DONE. Runtime is agenda-only; `src/services/calendar/**` deleted.

## Changes
- `src/index.js`: `createAgendaService`; `openAIManager.calendarBooking = agendaService` (property name kept to minimize churn); `scheduler.setAgendaSyncHandler(() => agendaService.processSyncQueue())`; `createApp({ agendaService })`.
- `src/app.js`: removed `mountCalendarRoutes`; `mountAgendaRoutes` always mounted (503 when service is null); client summary uses `agendaService.publicSummary`; invite helpers imported from agenda/invite.
- `src/services/configuracion/agenda/routes.js`: moved public endpoints here: `GET /calendar/conectar/listo`, `GET /calendar/conectar/:token`, `GET /public/calendar/result`, `GET /public/calendar/invite/:token`, `POST /public/calendar/invite/:token/start`. OAuth callback is `/configuracion/agenda/oauth/callback`.
- `agenda/invite.js`: added `redactCalendarInvite`, `publicCalendarSummary`. `agendaService.publicSummary` added.
- `openAIManager.js`: uses agenda `tools` (`isAgendaTool`, `replyOffersAppointmentTime`).
- `firebaseService.js`: invite hash import from agenda; removed `agendaEngine` whitelist in `updateAssistant`. `metaInviteService.js`: import from agenda/invite.
- `tests/helpers/createTestApp.js`: dropped `calendarService`.
- Deleted `tests/http/calendar.test.js`, `tests/unit/calendar.test.js`. Coverage migrated to `tests/http/agenda.test.js` (public invite flow, notice, expired/unknown link) and new `tests/unit/openAIManager.agenda.test.js` (instructions/tools injection, forced slot lookup, agenda-off). Other old unit cases (slots, oauth, booking) already covered by agenda-* tests.
- `googleCalendar/client.js` untouched.

## Tests
Full `npx jest`: 37 suites, 304 tests pass (includes the 5 required agenda files).

## Concerns
- Google OAuth redirect URI changed from `/calendar/oauth/callback` to `/configuracion/agenda/oauth/callback`; Google Cloud console must allow the new URI (or set `GOOGLE_CALENDAR_REDIRECT_URI`).
- Public invite page URLs (`/calendar/conectar/...`) intentionally kept so issued links still work.
- `calendarSettingsCollection` in firebaseService/firestoreEnv left in place (legacy data, unused).
- `public/js` panel still points at old `/clients/:id/calendar` endpoints (now gone) — Task 8. `public/js/agenda-panel.js` had uncommitted pre-existing changes; not included in the commit.

## Fix: legacy OAuth callback alias (review Important finding)
- `src/services/configuracion/agenda/routes.js`: the public OAuth callback is now mounted on both `/configuracion/agenda/oauth/callback` and legacy `GET /calendar/oauth/callback` (same handler), so existing `GOOGLE_CALENDAR_REDIRECT_URI` values keep working. `redirectUriFor` default is unchanged (new path).
- `tests/http/agenda.test.js`: added test hitting the alias (400 on bad state; 302 panel redirect on `access_denied`).
- `npx jest tests/http/agenda.test.js --verbose`: 1 suite, 16 tests pass.
- `.env`, docker-compose, and pre-existing `public/js/agenda-panel.js` changes not committed.
