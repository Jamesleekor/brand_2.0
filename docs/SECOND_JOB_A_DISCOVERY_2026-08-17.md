# SECOND_JOB-A — Existing Surface Discovery
## 2026-08-17 · Nightly preparation only

Status: DISCOVERY COMPLETE / PRODUCTION PREFLIGHT NOT YET RUN
Production DB writes: NONE

## Why this is next
The release-priority blueprint moves 2차직업 to the first post-Guild quick-win package.
Locked eligibility remains **금 광석 이상** (20,000 BV threshold in current tier constants / server tier function).

## Existing code already present

### Student-facing market directory
`src/features/market/MarketPage.tsx`
- `/market/jobs` tab already exists.
- reads `secondary_jobs`.
- expects:
  - `student_id`
  - `job_name`
  - `description`
  - `approved_at`
  - `classroom_id`
  - `status='ACTIVE'`
- displays current active jobs by student.

### Student RPC wrapper
`studentRpc.applySecondaryJob(...)`
- RPC name: `apply_secondary_job`
- current client input:
  - `p_student_id`
  - `p_job_name`
  - `p_description`
- description validation: 10~500 chars.

Important: no actual student application UI usage was found. The RPC wrapper exists but no page currently calls `applySecondaryJob`.

### Teacher review UI
`src/features/teacher/ReviewQueue.tsx`
- 2차직업 tab exists.
- reads `secondary_job_applications` with `status='PENDING'`.
- approve/reject buttons already exist.
- calls `approve_secondary_job`.

### Teacher dashboard
Pending 2차직업 applications are already included in the dashboard pending-review summary.

### Teacher RPC wrapper
Current input:
- `p_application_id`
- `p_teacher_user_id`
- `p_approved`
- `p_rejection_reason` optional in Zod

Current ReviewQueue reject path does not collect/send a rejection reason.
Do not change this before inspecting the actual Production function contract.

## Critical repository gap
No local migration defining these objects was found:
- `secondary_jobs`
- `secondary_job_applications`
- `apply_secondary_job`
- `approve_secondary_job`

They are referenced by current frontend and cleanup SQL, which strongly indicates legacy/Production objects exist, but their exact current schema/function definitions are not represented in the migration history available in v23.

Therefore **do not implement SECOND_JOB by guessing**.
Run the attached read-only Production preflight first.

## Model mismatch to resolve after preflight
Current UI/RPC contract looks like a free-text job proposal:
- student supplies `job_name`
- student supplies `description`

Latest release blueprint wants a **catalogue → apply → approve/reject → active job** model.

Possible outcomes after Production inspection:
1. Production already has a catalogue/definition table → reuse it.
2. `secondary_jobs` itself contains catalogue rows plus assignments → adapt safely if semantics permit.
3. Production only has free-text applications/active jobs → add a small explicit catalogue table in an incremental migration, preserving old history.

No choice is made tonight.

## SECOND_JOB implementation split after preflight

### SECOND_JOB-A Backend compatibility
- inspect Production tables/functions/constraints/RLS/grants
- enforce Gold Ore+ eligibility server-side
- choose/reuse catalogue model
- duplicate PENDING/ACTIVE rules
- approval/rejection audit/history
- employment-freeze guard if the existing system contract supports it

### SECOND_JOB-B Frontend
Student:
- eligibility banner
- catalogue/list
- apply modal
- pending status
- active job

Teacher:
- catalogue management only if the data model requires it
- review queue with explicit rejection reason if server contract supports/requires it
- active assignment/history view

### SECOND_JOB-C E2E + migration
- below-Gold-Ore rejection
- Gold-Ore+ application
- duplicate pending block
- approval → active job + directory/profile
- rejection
- replacement/removal rule
- other-classroom/security
- existing legacy rows preserved

