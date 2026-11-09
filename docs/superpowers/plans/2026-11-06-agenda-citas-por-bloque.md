# Agenda citas por bloque — Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox syntax.

**Goal:** Replace per-service `capacity` with global `rules.appointmentsPerBlock`.

**Architecture:** Same occupancy engine; cupo comes from rules. Services drop `capacity`. Panel moves the field to Reglas.

**Tech Stack:** Node/Express agenda module, Jest, `public/js/agenda-panel.js`

## Global Constraints

- `appointmentsPerBlock` integer 1–100, default 1
- Ignore legacy `services[].capacity`
- Local agenda only for availability (unchanged)

---

### Task 1: Normalize + constants

- [x] Add `appointmentsPerBlock` to `defaultRules`
- [x] Strip `capacity` from `normalizeServices`; validate `appointmentsPerBlock` in `normalizeRules`
- [x] Update unit tests for normalize

### Task 2: Availability + booking + service

- [x] Read cupo from `rules.appointmentsPerBlock` in availability, booking, agendaService
- [x] Update unit tests

### Task 3: Panel + tools + HTTP

- [x] UI: remove capacity; add “Citas por bloque”
- [x] Tools copy; HTTP test; docs touch

### Task 4: Verify

- [x] Run agenda unit + http tests (85 passed)
