# AGENTS.md — B.R.A.N.D 2.0 Repository Rules

> 이 파일은 B.R.A.N.D 2.0 저장소에서 작업하는 Codex/AI 개발자가 가장 먼저 읽어야 하는 프로젝트 규칙이다.
> 마지막 갱신: 2026-09-03
> 현재 기준선: Guild 1 COMPLETE / Guild 2 설계 확정 후 구현 대기

---

## 0. Instruction precedence

문서 간 내용이 충돌할 경우 아래 순서를 따른다.

1. `AGENTS.md`
2. `docs/BRAND_CURRENT_STATE_2026-08-12.md`
3. 현재 작업 중인 기능 SPEC (`docs/GUILD2_SPEC.md` 등)
4. `00_BRAND_완벽이해하기*.md`
5. 과거 HANDOFF / BLUEPRINT / 구현 기록 / 오래된 migration 주석

과거 문서는 역사적 참고자료다. 최신 문서가 명시적으로 폐기한 설계를 되살리지 말 것.

특히 다음 두 가지는 이미 폐기된 과거 설계다.

- **길드 자체에 속성이 있다** → 틀림. 길드에는 속성이 없다.
- 과거 개인기여도 공식(BV 증가량 중심, `GUILD_GS_WEIGHTS.alpha` 등) → Guild 2 새 공식으로 폐기.

---

# 1. What B.R.A.N.D is

B.R.A.N.D는 단순한 학급 경제 앱이 아니다.

**초등학교 5학년 한 반 24명이 1년 동안 살아가는 하나의 세계**다.

경제·관리 기능은 세계를 지탱하는 하부구조이며, 설계 결정은 다음 순서로 생각한다.

1. 이것이 B.R.A.N.D 세계에서 무엇인가?
2. 학생이 이것을 어떻게 경험하는가?
3. 그것을 어떻게 구현하는가?

기능적으로 더 간단하거나 일반적인 방법이 있더라도, 서사적 일관성·교육적 의미·기존 학생 경험을 훼손하면 채택하지 않는다.

성장 철학은 **“티끌 모아 태산”**이다.
작은 보상이 장기간 누적되는 구조를 선호하고, 큰 즉시 보상으로 참여를 강제하지 않는다.

---

# 2. Immutable domain rules

명시적 사용자 승인 없이 변경하지 않는다.

## 2.1 Currency

- GOLD: 일반 통화
- CRYSTAL: 프리미엄 통화
- BV: 명예/노력의 기록
  - 거래 불가
  - 세금 없음
  - 일반적으로 차감하지 않음
  - **22티어를 결정하는 유일한 지표**

## 2.2 Tier system

22티어 체계는 기존 source of truth를 따른다.
티어 경계값을 임의로 수정하지 않는다.

## 2.3 Security

**클라이언트를 신뢰하지 않는다.**

- 자산 변경
- 점수 변경
- 경매 낙찰
- 길드 점수
- 개인 기여도
- 권한 변경
- 월간 확정

위와 같은 중요한 쓰기는 React에서 계산/직접 UPDATE하지 않는다.
PostgreSQL RPC / 트랜잭션 안에서 검증·계산한다.

---

# 3. Technical baseline

Current stack:

- React 19
- TypeScript
- Vite
- Supabase / PostgreSQL / PostgREST
- React Query
- Zustand
- Zod
- Tailwind CSS
- Node >= 20

Architecture:

`Browser (React) -> Supabase/PostgREST -> PostgreSQL functions -> data`

별도 애플리케이션 백엔드는 기본적으로 없다.

---

# 4. Production DB is not the local migration folder

매우 중요하다.

현재 production Supabase는 여러 단계의 legacy schema + 수동 hotfix가 누적된 상태다.
따라서 로컬 migration 파일만 읽고 production schema를 추정하지 않는다.

새 DB 작업 전 반드시 가능한 범위에서 실제 상태를 조사한다.

확인 대상 예:

- `information_schema.columns`
- `pg_constraint`
- `pg_indexes`
- `pg_proc`
- `pg_get_functiondef`
- `information_schema.routine_privileges`
- 현재 enum labels
- RLS/GRANT

Codex가 production DB에 직접 접근할 수 없다면:

1. migration을 추측해서 만들지 말고
2. 필요한 preflight/introspection SQL을 먼저 만들고
3. 사용자가 Supabase SQL Editor에서 실행해 결과를 제공하도록 요청한다.

**오류 메시지에 실제 schema 정보가 나오면 그것을 source of truth로 삼는다.**

---

# 5. Migration rules

## 5.1 Incremental only

이미 적용된 migration을 다시 실행하거나 과거 migration 파일을 수정해서 production 상태를 맞추려 하지 않는다.

새 변경은 항상 새로운 증분 migration으로 작성한다.

권장 이름:

`supabase/migrations/YYYYMMDD_NN_short_description.sql`

그리고 SQL Editor에서 수동 적용할 파일이 필요하면:

`supabase/APPLY_<FEATURE>_<DESCRIPTION>.sql`

을 동일 내용으로 제공할 수 있다.

## 5.2 Never destructive by default

다음은 사용자의 명시적 승인 없이 금지한다.

- `DROP TABLE`
- 대량 `DELETE`
- 과거 이력 rewrite
- `TRUNCATE`
- `DROP ... CASCADE`
- column/type destructive conversion
- 기존 거래/길드 이력 삭제

필요하면 먼저 preflight와 영향 분석을 제시한다.

## 5.3 Historical snapshots are sacred

길드 멤버십, 길드 세션, 월별 점수, 경매, 거래 등 과거 기록은 당시 상태를 보존해야 한다.

현재 상태를 바꾸었다고 과거 snapshot을 재작성하지 않는다.

## 5.4 Function replacement

PostgreSQL 함수 overload/default parameter 문제가 이미 발생했다.

`CREATE OR REPLACE FUNCTION`을 사용할 때:

- 기존 정확한 signature를 확인한다.
- parameter default 제거/변경 문제를 확인한다.
- PostgREST overload ambiguity를 확인한다.
- 함수를 DROP해야 한다면 dependency를 먼저 조사한다.
- 무작정 `DROP FUNCTION ... CASCADE` 금지.

## 5.5 SQL Editor vs authenticated app

Supabase SQL Editor는 앱의 로그인 교사 JWT 컨텍스트가 아니다.

`ensure_teacher_role()` 같은 auth 기반 RPC를 SQL Editor postcheck에서 직접 실행하지 않는다.

Postcheck는 둘로 구분한다.

- SQL Editor-safe structural postcheck
- 실제 교사 로그인 세션 E2E/RPC check

---

# 6. Security rules

모든 SECURITY DEFINER 함수는 다음을 검토한다.

- 고정 `search_path`
- 호출자 identity/role 검증
- classroom scope 검증
- 대상 student/guild ownership 검증
- explicit GRANT/REVOKE

학생이 호출하면 안 되는 internal helper는 `authenticated`에 직접 EXECUTE를 열지 않는다.

## 6.1 Known security warning

과거 production audit에서 광역 GRANT가 개별 REVOKE를 덮어쓴 P0 위험이 발견됐다.
`create_transaction`, `link_student_to_auth_user` 등을 포함한 ACL hardening patch가 준비된 이력이 있으나,
**production에 최종 적용됐는지는 현재 문서만으로 확정하지 않는다.**

새 작업에서 “이미 안전하다”고 가정하지 말고 실제 ACL을 확인한다.

---

# 7. Git rules for Codex

Codex는 기본적으로 파일을 수정하고 검증까지만 수행한다.

사용자가 명시적으로 요청하지 않는 한 다음 명령은 실행하지 않는다.

- `git commit`
- `git push`
- `git reset --hard`
- `git clean -fd`
- `git rebase`
- force push
- tag 생성/삭제
- branch 삭제

작업 시작 시:

- `git status`
- 현재 branch
- dirty files

를 확인한다.

사용자의 기존 미커밋 변경을 덮어쓰지 않는다.

---

# 8. Package/install/build rules

## 8.1 사용자 확정 운영 규칙 — AI는 npm 설치/빌드를 실행하지 않는다

2026-09-03 사용자 지시로 확정된 규칙이다. **모든 향후 인수인계서에도 반드시 유지한다.**

- AI/Codex/ChatGPT는 `npm ci`를 실행하지 않는다.
- AI/Codex/ChatGPT는 `npm install`을 실행하지 않는다.
- AI/Codex/ChatGPT는 `npm run build`를 실행하지 않는다.
- 실제 npm 설치와 production build는 **사용자가 자신의 로컬 PC에서 직접 실행**한다.
- AI는 코드 수정 후 사용자가 실행할 명령을 안내하고, 사용자가 전달한 build 오류를 기준으로 수정한다.
- 이유: 원격 작업 환경에서 `npm ci`가 반복적으로 장시간 정지/실패하여 작업 시간이 크게 낭비된 이력이 있다.

AI가 자체 검증할 때는 npm 설치를 유발하지 않는 정적/구문 검사만 사용한다. 예:

- 이미 환경에 존재하는 TypeScript compiler API를 이용한 `transpileModule` 구문 검사
- `git diff`, `rg`, 정적 파일 비교
- SQL 구조/권한/증분 migration 검토

`npm run dev` 역시 사용자가 명시적으로 요청하지 않는 한 실행하지 않는다.

**매 수정마다 ZIP을 만들지 않는다.**
Git repo에서 in-place로 작업한다.
사용자가 명시적으로 패키지/백업 ZIP을 요청하거나, 대화 기반 전달본이 필요한 경우에만 만든다.

---

# 9. Standard feature workflow

새 기능 하나를 구현할 때 이 순서를 따른다.

1. 최신 SPEC 읽기
2. 기존 frontend/RPC/schema 탐색
3. production compatibility 위험 식별
4. 필요 시 preflight SQL
5. 증분 migration 설계
6. ACL/RLS/postcheck 설계
7. RPC + Zod + TypeScript
8. teacher UI
9. student UI
10. realtime/cache invalidation
11. 사용자 로컬 build 결과 확인 / AI 정적 구문검사
12. 기능별 E2E checklist 작성
13. 변경 파일/SQL 적용 순서/미검증 항목 보고
14. 최신 CURRENT_STATE/SPEC 상태 갱신

“코드부터 쓰고 나중에 schema를 맞춘다”는 방식 금지.

---

# 10. Error handling / UX

버튼이 실패할 때 “아무 반응 없음” 상태를 만들지 않는다.

쓰기 작업은 최소한 다음 상태를 명확히 보여준다.

- submitting/loading
- success
- validation error
- server/RPC error

Modal보다 toast가 뒤에 숨지 않게 한다.
중요 오류는 modal 내부 inline error로도 표시한다.

학생에게는 기술적인 PostgreSQL 오류를 그대로 노출하지 않고 이해 가능한 한글 메시지를 우선한다.
교사 진단 화면에서는 실제 원인 확인이 가능해야 한다.

---

# 11. Guild 1 — current immutable corrections

Guild 1은 2026-08-12 기준 COMPLETE로 판정한다.
전입/전출 E2E만 학생관리 UI가 없어 후속 검증으로 남는다.

## 11.1 Element model

**Guild itself has NO element.**

각 활성 `guild_members` membership이 학생의 담당 속성을 가진다.

지원 속성:

- EARTH / 땅
- WATER / 물
- FIRE / 불
- WIND / 바람
- LIGHT / 빛
- DARK / 어둠

과거 blueprint의 “길드 속성” 문구는 폐기됐다.

## 11.2 Membership

- 학생은 활성 membership을 최대 1개 가진다.
- 이동 시 과거 row를 닫고 새 row를 만든다.
- 탈퇴 후 재배정 가능.
- 같은 길드에서 속성만 바뀌는 경우 membership history/event를 보존한다.
- 과거 membership 삭제 금지.

## 11.3 Guild sessions

길드 세션은 학교 출석과 별개다.

세션 생성 시 참가자 snapshot에 당시:

- student
- guild
- guild name
- assigned element

를 보존한다.

상태:

- PRESENT
- ABSENT
- EXCUSED

`EXCUSED`는 원상태는 그대로 보존하지만 개인기여도 출석 인정에서는 PRESENT와 동일하게 처리한다.

## 11.4 Known legacy compatibility

production legacy에서 확인된 사항:

- `guilds.season_id` required
- `guilds.guild_uid` required, `varchar(20)`
- generated uid는 `GUILD_` + 14 chars로 20자를 넘지 않아야 함
- `guild_members.season_id` legacy column 존재
- 여러 historical membership row를 막던 legacy UNIQUE는 Guild 1.2에서 호환 패치

과거 foundation cumulative 파일을 production에 다시 실행하지 않는다.

---

# 12. Guild 2

Guild 2의 authoritative specification:

`docs/GUILD2_SPEC.md`

과거 코드의 다음 항목은 **새 공식의 source of truth가 아니다.**

- `SYSTEM_CONSTANTS.GUILD_GS_WEIGHTS`
- BV 증가량 중심 alpha 산식
- 기존 `calculate_individual_contribution` 구현
- 기존 `evaluate_guild_mission_log`의 qualitative/synergy 점수 모델

이름이 같더라도 기존 함수를 그대로 재사용하지 않는다.
반드시 기존 정의/의존성을 조사하고 Guild 2 SPEC에 맞게 migration한다.

---

# 13. 1.0 -> 2.0 migration strategy

현재 2.0에 있는 과거 snapshot 데이터는 최종 운영 데이터라고 가정하지 않는다.

최종 전략:

1. 2.0 리팩터링/콘텐츠 구현 완료
2. 그 시점의 1.0 최신 데이터로 one-time migration
3. 검증
4. cutover
5. 1.0 write 종료

기존 1.0은 애매한 행동 규칙을 확인하는 behavioral source of truth로 참고할 수 있지만,
Guild 2처럼 사용자가 새로 명시한 시즌2 규칙은 최신 SPEC이 우선한다.

---

# 14. Definition of done

기능 완료라고 보고하기 전에 최소한:

- [ ] migration/preflight가 production legacy를 고려
- [ ] destructive mutation 없음 또는 승인됨
- [ ] server-side validation
- [ ] 권한/RLS/GRANT 검토
- [ ] teacher UI
- [ ] student UI (해당 시)
- [ ] loading/error state
- [ ] realtime/refetch
- [ ] 사용자가 로컬에서 `npm run build`를 실행했고 결과를 공유함 (AI가 직접 실행하지 않음)
- [ ] E2E checklist 제공
- [ ] known deferred tests 명시
- [ ] 문서 갱신

최종 성공 기준은 단순히 “버튼이 동작함”이 아니다.

**학생들이 “그해 우리 반은 특별했다”고 기억할 수 있는 안정적인 세계를 만드는 것**이 목적이다.
