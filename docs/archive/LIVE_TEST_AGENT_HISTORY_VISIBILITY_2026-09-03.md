# B.R.A.N.D 2.0 — Live Test Agent / 통합 히스토리 숨김 기능 인수인계

작성일: 2026-09-03

## 1. 사용자 확정 npm 운영 규칙

**반드시 유지한다.**

- AI/Codex/ChatGPT는 `npm ci`, `npm install`, `npm run build`를 실행하지 않는다.
- npm 설치 및 production build는 사용자가 로컬 PC에서 직접 실행한다.
- AI는 npm 설치를 유발하지 않는 정적/구문 검사만 수행하고, 사용자가 전달한 build 결과를 기준으로 후속 수정한다.
- 이 규칙은 향후 모든 B.R.A.N.D 인수인계 문서에도 포함한다.

## 2. Live Test Agent 현재 모델

- 실제 학급 안의 테스트요원은 `role='STUDENT'`를 유지한다.
- `students.is_test_account=true`로 공식 학생과 구분한다.
- 공식 참가자 판정은 `public.is_official_participant(student_id)`를 사용한다.
- 현재 실제 학급 공식 학생 수는 24명을 유지해야 한다.
- Live Test Agent는 기능 테스트용이며 공식 랭킹/통계/기록에는 포함하지 않는다.

## 3. 통합 히스토리 숨김 원칙

원본 거래/아이템 로그는 절대 삭제하지 않는다.

이번 기능은 `teacher_get_economy_history()`가 반환하는 안정적인 `event_key` 위에 표시 전용 overlay를 둔다.

새 테이블:

- `public.history_visibility_overrides`

새 RPC:

- `teacher_get_history_visibility(integer,text[])`
- `teacher_set_history_visibility(integer,text[],boolean,text)`

원본 테이블(`transactions`, inventory event 계열 등)은 UPDATE/DELETE하지 않는다.

## 4. 교사 UI 기능

위치: `학급 운영 → 히스토리`

추가 기능:

1. 개별 기록 숨김 / 복구
2. 체크박스 다중 선택 숨김 / 복구
3. Live Test Agent 기록 일괄 숨김
   - 날짜 필터가 없으면 전체 기간
   - 날짜 필터가 있으면 현재 날짜 범위만

추가 보기 설정:

- `숨긴 기록 보기`
- `테스트 기록 보기`

테스트요원 기록은 기본 화면에서 자동으로 제외한다.
`TEST_CLEANUP` 사유로 일괄 숨긴 테스트 기록은 `테스트 기록 보기`를 켜면 디버깅을 위해 다시 볼 수 있다.
수동으로 숨긴 기록은 `숨긴 기록 보기`가 켜져야 한다.

## 5. Production 적용 순서

Live Test Agent Phase B를 아직 적용하지 않았다면:

1. SQL Editor 수동 적용: `supabase/APPLY_LIVE_TEST_AGENT_PHASE_B_OFFICIAL_EXCLUSIONS.sql`
2. SQL Editor 수동 적용: `supabase/APPLY_HISTORY_VISIBILITY_OVERRIDES.sql`

두 APPLY 파일 모두 현재 SQL Editor 역할 문제를 피하기 위해 `SET ROLE postgres;`로 시작하고 `RESET ROLE;`로 끝난다. Git/CLI migration 기준 원본은 각각 `supabase/migrations/20260903_02_...`, `20260903_03_...`이다.

히스토리 migration만 Supabase SQL Editor에서 수동 적용할 때는:

- `supabase/APPLY_HISTORY_VISIBILITY_OVERRIDES.sql`

을 사용한다. 이 APPLY 파일은 현재 SQL Editor 세션이 `authenticated`로 전환돼 있던 문제를 피하기 위해 맨 앞에서 `SET ROLE postgres;`, 마지막에 `RESET ROLE;`을 수행한다.

## 6. 검증 순서

SQL 적용 후 structural postcheck에서 확인:

- `table_ready = true`
- `get_visibility = true`
- `set_visibility = true`
- `authenticated_can_get = true`
- `authenticated_can_set = true`
- `anon_can_get = false`
- `anon_can_set = false`
- `source_ledgers_untouched = true`

교사 UI E2E:

1. 테스트요원으로 아이템 지급/사용 기록 생성
2. 교사 → 학급 운영 → 히스토리에서 테스트 기록이 기본적으로 보이지 않는지 확인
3. `테스트 기록 보기` ON → 해당 기록 확인
4. 한 건 `숨김` → 일반 보기에서 사라짐
5. `숨긴 기록 보기` ON → 숨김 배지와 `복구` 확인
6. 복구 → 정상 재표시
7. 2건 이상 체크 → `선택 숨김` → 모두 사라짐
8. `숨긴 기록 보기` ON → 선택 후 `선택 복구`
9. 테스트요원 기록 생성 후 `테스트 기록 일괄 숨김`
10. 실제 `transactions`/inventory source row와 잔액이 변하지 않았는지 확인

마지막으로 사용자가 로컬에서:

```bash
npm run build
```

을 실행하고 결과를 공유한다. AI는 직접 실행하지 않는다.

## 7. 구현상 의도적인 제한

`teacher_get_economy_history()` 자체는 production legacy/manual 정의를 보호하기 위해 교체하지 않았다.
따라서 페이지 수/원본 총건수는 source audit ledger 기준이며, 숨김은 현재 페이지 표시에서 제외된다.
UI에 이 사실을 명시한다.

이 선택은 pagination을 완전히 재작성하는 것보다 production 함수 signature 및 기존 감사원장 안정성을 우선한 결정이다.
