# Guild4-B Frontend implementation validation

Date: 2026-08-16
Baseline: Guild3 COMPLETE checkpoint + Guild4-A backend v16
Scope: Frontend only. No new DB migration in this phase.

## Implemented

### Student
- `/guild/peer-review`
- Monthly Peer /300 summary (READY only; raw received review details are not shown)
- Round list, deadline, required/submitted progress
- One target at a time review editor
- Score 1~10
- Comment minimum 20 chars
- Existing authored review revision prefill/edit before deadline
- EXCUSED obligation display
- OPEN/CLOSED/FINALIZED and source VOID UI states
- Privacy explanation

### Teacher
- `/teacher/guild/peer-review`
- Guild3 opening -> Guild4 round sync
- Round list/detail
- reviewer -> target obligation status
- raw score/comment/revision visibility
- deadline change
- EXCUSED/RESTORED
- OPEN -> CLOSED -> FINALIZED
- finalized append-only review correction
- finalized exception correction
- score rollup/calculation audit
- penalty POSTED/PENDING_FUNDS/WAIVED display
- PENDING_FUNDS retry
- penalty waiver/reversal operation
- revision history and audit history
- mutation pending state + inline error + toast feedback

### Navigation
- Student Guild tab: Peer Review link enabled
- Teacher Guild admin: Guild4 button added
- Teacher sidebar parent item remains active on Guild subroutes

## Security / privacy UI contract
- Student UI does not display who reviewed the student, received raw scores/comments, or bias-correction details.
- Student can only view/edit reviews they authored because the student RPC returns only own obligations.
- Teacher UI displays raw review and calculation audit data as permitted by the teacher RPC.

## Static validation
- TypeScript/TSX syntax transpile check: PASS for all changed files.
- Import target existence scan: PASS.

## Build gate
- `npm ci --offline`: BLOCKED by environment cache (`zustand-5.0.14.tgz` not cached).
- Therefore `npm run build` is NOT marked PASS in this environment.
- Local gate required before G4-C E2E:
  1. `npm ci`
  2. `npm run build`
  3. fix any build error within G4-B before E2E

## Expected first E2E materialization
Current DB pre/postcheck showed 2 OPENABLE Guild3 peer sources and 0 Guild4 rounds.
On Teacher Guild4 page, press `Guild3 -> G4 sync` once.
Expected: 2 rounds, each 5 participants / 20 directed obligations (40 total obligations).
