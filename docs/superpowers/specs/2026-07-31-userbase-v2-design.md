# Userbase Automation v2 — Design

Date: 2026-07-31
Status: Approved

## Goal
Fix the final-checklist "!" false failures, make per-stage output prominent and
always downloadable, add Skip and Remove-input controls, show the SOP on the
start screen, add a single-zone run mode, and refine the UI.

## A. Checklist "!" fixes (`engine/stages/export_final.py`, append stages)
Root cause: users appended at stages 8/10/11 are built with all columns blank
then partially filled, and are added *after* the OT (4) and email-validation (3)
stages, so `OT` is `""` and their emails are never re-validated.

- **OT**: appended rows default `OT (Yes/No) = "No"` when the OT column exists.
  Implemented in the shared append helpers (`aurora._flag_and_append`,
  `bsc`, `zone_additional`) — new rows get `"No"` for `OT_COLUMN` unless already set.
- **Email validity**: append only rows whose email is valid (non-blank, contains
  `@`, no `noemail`) — same predicate as Stage 3. A single `is_valid_email`
  helper in `io_utils` is reused by Stage 3 and every append.
- **Zone**: `status[5]` becomes "Stage 7 ran" instead of "all 8 zones have files".
  Zones without a file are surfaced as info, not a failure.

## B. Skip — pass-through, any stage except 1
- `POST /api/runs/{rid}/stages/{n}/skip`: saves a pass-through `StageResult`
  (`kept` = current working file, no removed/added, log "Stage N skipped"),
  marks the stage `skipped: true`, advances the frontier.
- Stage 1 cannot be skipped (no base snapshot would exist). Enforced server-side.
- UI: a "Skip" button on the active (frontier) stage.

## C. Remove a wrong-uploaded input
- `POST /api/runs/{rid}/inputs/{slot}/clear`: sets `manifest.inputs[slot] = None`.
- UI: a "✕ Remove" affordance on any filled input dropzone.

## D. Per-stage files — prominent (frontend only)
- Existing per-stage kept/removed/added preview + downloads are surfaced clearly
  at every completed stage. No new endpoints.

## E. SOP on the start screen (frontend)
- The empty area of "Start a run" shows a Standard Operating Procedure panel
  (purpose, required inputs, all 14 steps) as static frontend content derived
  from `Userbase_Creation_SOP.docx`.

## F. Single-zone run (new mode)
- Home offers **Full run** and **Single-zone run**.
- Single-zone: after Datamart upload, the distinct values of
  `Macro Entity Level 2 (Zone)` are offered; the user picks one. Stage 1 first
  drops every row whose value ≠ the chosen zone (removed rows stored + logged),
  then the normal 14 stages run.
- Manifest gains `mode` (`full` | `single_zone`) and `zone_filter {column, value}`.
- New `GET /api/runs/{rid}/zone-values?column=...` returns distinct values +
  counts so the UI can present the picker.

## G. UI refine
- Cohesive polish (home + SOP panel, stage panel, inputs, log dock) guided by the
  ui-ux-pro-max skill. No behavioural change beyond the above.

## Data model
- `manifest.mode`, `manifest.zone_filter`, per-stage `skipped` flag.

## Testing
New pytest coverage: checklist all-Completed after appends; skip endpoint;
clear-input endpoint; single-zone filter drops other zones and records removed.
Existing 33 tests stay green.
