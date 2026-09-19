# Guild1~5 Nightly Stabilization Summary
## 2026-08-17

## Result
The requested nightly work completed in five independent stages without Production DB writes.

### Stage 1 — baseline
COMPLETE. v23 preserved; release-priority blueprint embedded in docs.

### Stage 2 — static integrated audit
COMPLETE.
Found only safe UI/integration issues in the Guild scope selected for tonight:
- conquest popup clipping;
- stale Guild2 teacher wording;
- always-FINAL monthly-close tab subtitle.
No missing Guild route, wrapper SQL definition, student direct Guild table write, or obvious Guild5 internal grant regression was found by the static scans.

### Stage 3 — safe fixes
COMPLETE.
- popup clipping fixed for desktop and mobile;
- Guild2 copy updated to current architecture;
- monthly-close status made data-dependent.
Changed TS/TSX syntax parse: PASS.
Full npm build not available in this environment because the offline npm cache is missing `zustand-5.0.14.tgz`; morning local build remains mandatory.

### Stage 4 — morning E2E
COMPLETE.
- integrated Guild1→5 checklist prepared;
- read-only DB diagnostic prepared.

### Stage 5 — next feature preparation
COMPLETE.
- SECOND_JOB existing surfaces inventoried;
- key finding: frontend wrappers/UI reference legacy Production objects but v23 migration history does not define them;
- student application RPC wrapper exists, but no student UI currently calls it;
- teacher review and market active-job directory already exist;
- a metadata-only Production preflight is ready.

## Do not do automatically tomorrow
- do not run any old whole-schema Guild APPLY again;
- do not reset the real classroom;
- do not implement 2차직업 catalogue schema until the Production discovery result is reviewed;
- do not change locked Guild formulas to address optional follow-ups.

## Recommended first morning actions
1. integrate/use the Stage 5 nightly candidate locally;
2. `npm ci` and `npm run build`;
3. check conquest popup #3 desktop + mobile;
4. run short Guild consistency smoke;
5. if clean, create Guild1~5 Git checkpoint;
6. run `PREFLIGHT_SECOND_JOB_A_PRODUCTION_DISCOVERY.sql` and send the complete result;
7. start SECOND_JOB-A from the actual Production contract.
