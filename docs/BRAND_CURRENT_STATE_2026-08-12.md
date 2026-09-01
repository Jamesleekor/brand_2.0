# B.R.A.N.D 2.0 — CURRENT STATE / CODEX HANDOFF

**Date:** 2026-08-12  
**Baseline:** Guild 1 COMPLETE  
**Next:** Guild 2A — production SQL 적용 및 E2E (GS Engine + Individual Contribution foundation)

---

# 1. Project identity

B.R.A.N.D는 초등학교 5학년 24명이 1년 동안 사용하는 학급 세계다.

학생 = 모험가  
교사 = 운영자 / 세계 관리자

경제 시스템은 목적 자체가 아니라 세계를 유지하는 기반이다.

핵심 설계 질문:

1. 이것이 세계 안에서 무엇인가?
2. 학생이 어떻게 경험하는가?
3. 어떻게 구현하는가?

성장 철학은 “티끌 모아 태산”.
작은 보상들이 1년 동안 누적되는 구조를 선호한다.

---

# 2. Architecture

Frontend:

- React 19
- TypeScript
- Vite
- React Query
- Zustand
- Zod
- Tailwind

Backend:

- Supabase
- PostgreSQL functions/RPC
- RLS
- Realtime

핵심 흐름:

`React -> Supabase/PostgREST -> PostgreSQL function -> data`

중요한 계산과 쓰기는 DB에서 수행한다.

---

# 3. Current working baseline

현재 기준 코드는 `brand_app_guild1_2_stability` 계열이다.

현재 baseline에 존재하는 큰 기능:

- Feature 1: teacher asset/economy core
- Feature 2: basic economy actions
- Feature 3: live auction + auction operations
- Feature 4: classroom operations stabilization
- Guild 1: guild foundation

과거 구현/검증 문서가 저장소 루트에 많이 존재하므로,
새 개발에서는 `AGENTS.md`와 `docs/` 최신 문서를 우선한다.

---

# 4. Guild 1 final status

사용자 E2E 결과를 기준으로 Guild 1은 완료 판정했다.

## 4.1 Passed

- 기존 5개 길드 정상 표시
- 재학생의 활성 길드 소속 표시
- 미배정 학생 별도 표시
- 중복 활성 배정을 UI에서 만들지 않음
- 길드 생성
- 길드명 / 슬로건 표시
- 학생별 담당 속성 표시
- 기존 소속 학생을 다른 길드로 이동
- 길드 소속 해제
- 해제 후 원래/다른 길드로 재배정
- membership history 보존
- 길드 세션 생성
- 세션 참가자 snapshot
- PRESENT / ABSENT / EXCUSED 기록
- EXCUSED를 참석 인정으로 계산
- 세션 생성 후 길드 이동 시 과거 세션 snapshot 보존
- 빈 길드 비활성화 / 재활성화
- 활성 멤버가 있는 길드 비활성화 방어
- 학생 길드 공통 헤더
- 길드명
- 슬로건
- 개인 담당 속성
- 이번달 GS placeholder/display
- 시즌 누적 GS placeholder/display
- 길드원 수
- 개인 기여도 영역
- 소속 변경 이력
- 세션 참석 기록
- 점수 카드 가독성 개선

## 4.2 Deferred only

전입/전출 E2E는 아직 테스트하지 못했다.

이유:
학생 자체를 추가/전출 처리하는 teacher student-management workflow/UI가 아직 준비되지 않았다.

Guild 1에서 `students.transferred_at`과 historical membership/session 보존을 고려한 구조는 유지하되,
실제 student-management 기능이 생긴 후 다음 회귀 테스트를 수행한다.

- 전입 학생 생성
- 전입 학생을 길드에 배정
- 전입 이전 과거 세션에 학생이 나타나지 않는지 확인
- 전출 처리
- 전출 이전 history 보존
- 전출 이후 active membership 정리
- 전출 이후 신규 세션 snapshot에서 제외

---

# 5. Correct guild element model

과거 문서 일부에는 길드 자체가 속성을 가진다고 되어 있으나 폐기됐다.

현재 정확한 모델:

**Guild = no element**

각 학생의 현재 guild membership이 담당 속성 하나를 가진다.

지원:

- EARTH / 땅
- WATER / 물
- FIRE / 불
- WIND / 바람
- LIGHT / 빛
- DARK / 어둠

이동하면 새로운 membership이 새 속성을 가진다.

같은 길드 안에서 속성만 바꿀 수도 있으며,
이 경우 `ELEMENT_CHANGE` history를 남긴다.

---

# 6. Guild membership/history rules

- 현재 학생 1명당 활성 membership 최대 1개.
- `left_at IS NULL`이 현재 소속의 핵심 조건.
- MOVE는 과거 row를 닫고 새 row를 만든다.
- REMOVE는 current row를 닫는다.
- 재배정은 새 historical row를 만든다.
- 과거 row 삭제 금지.
- 시즌이 같아도 여러 과거 membership row가 존재할 수 있다.
- legacy UNIQUE가 이를 막지 않도록 Guild 1.2 compatibility patch가 적용됐다.

---

# 7. Guild session rules

학교 출석과 길드 세션 출석은 다른 개념이다.

세션 생성 시 participant snapshot을 만든다.

snapshot에는 당시:

- student id/name
- guild id/name
- assigned element

를 보존한다.

학생이 이후 다른 길드로 이동하거나 속성을 바꾸더라도 과거 세션을 rewrite하지 않는다.

Attendance status:

- PRESENT: 참석
- ABSENT: 불참
- EXCUSED: 인정불참

개인 기여도 출석 영역에서는:

- PRESENT = 인정
- EXCUSED = 인정
- ABSENT = -30

---

# 8. Legacy DB compatibility learned during Guild 1

실제 production schema와 초기 설계 문서가 달랐던 사례가 여러 번 있었다.

확인된 legacy:

- `guilds.season_id`가 mandatory
- `guilds.guild_uid`가 mandatory
- `guild_uid`는 `varchar(20)`
- 따라서 generator는 `GUILD_` + 14 chars
- `guild_members.season_id` 존재
- historical membership을 막는 legacy UNIQUE가 존재한 이력

교훈:

**production schema를 절대 추측하지 않는다.**

새 migration 전 preflight를 우선한다.

---

# 9. Important old code that is obsolete for Guild 2

현재 소스에는 과거 Guild scoring 흔적이 남아 있다.

예:

- `SYSTEM_CONSTANTS.GUILD_GS_WEIGHTS`
  - alpha / BV increase 중심
- `calculate_individual_contribution`
- `evaluate_guild_mission_log`
- legacy `guild_individual_contributions`
- legacy `guild_gs`
- legacy `guild_missions`
- legacy `guild_peer_reviews`
- legacy `guild_activity_logs`

테이블/함수 이름 자체를 버리라는 뜻은 아니다.

**실제 production 정의를 조사한 뒤 새 규칙과 호환되면 재사용/확장하고,
호환되지 않으면 안전한 증분 migration으로 교체한다.**

과거 산식을 그대로 살리는 것은 금지한다.

---

# 10. Guild 2A implementation status

2026-08-12에 production preflight 결과를 확인했다.

확인된 사실:

- 기존 `guild_gs`, `guild_individual_contributions`는 BV 증가량 기반 legacy 구조라 Guild 2 공식에 재사용할 수 없다.
- Guild 1의 membership, season, session participant snapshot은 실제 production에 존재하며, 새 session 점수의 근거로 사용할 수 있다.
- legacy mission/peer tables는 Guild 3·4의 확정 설계와 맞지 않는다. 이번 단계에서는 연결하지 않고 `NOT_READY`로만 표시한다.

준비된 Guild 2A 범위:

- 새 `guild2_*` 전용 초안 aggregate, 관찰 기록, GS append-only ledger, 월간 GS summary
- Guild session과 교사 기여 기록의 server-side 계산
- 수동 4인 길드 보정(평균 BASIC × 0.5, 10점 단위 반올림)
- 교사 운영 화면 `/teacher/guild/scores` 및 학생 길드 화면의 개인 기여도 카드
- legacy BV 산식 RPC의 browser execute 권한 회수. legacy 표와 Guild 1 history row는 삭제·재작성하지 않는다.

Production에는 Core SQL과 두 후속 수정 SQL까지 적용됐다. 초보자용 실제 확인 순서와 결과는 `docs/GUILD2A_E2E_CHECKLIST.md`를 따른다.

2026-08-13에는 공개 교사 메모 조회 정책이 같은 표를 다시 조회해 발생한 RLS 무한 재귀를 확인했다. 기존 데이터에 영향 없이 `supabase/migrations/20260813_01_guild2a_observation_rls_recursion_fix.sql`로 정책만 교체한다.

같은 날 Guild 1 세션 출석을 변경한 뒤 Guild 2 초안 점수가 자동으로 갱신되지 않는 것을 확인했다. `supabase/migrations/20260813_02_guild2a_refresh_after_session_attendance.sql`는 실제 production 함수 signature를 유지한 채, 저장 직후 해당 월의 Guild 2 초안만 다시 계산하도록 연결한다.

2026-08-13 production E2E 통과:

- 세션 `ABSENT` 감점 및 `PRESENT`/`EXCUSED` 변경 후 자동 복구
- 교사 기여 기록, 학생 공개/비공개 메모, 취소 반대 기록
- 4인 길드 인원 보정의 적용과 해제
- 교사 GS 수동 조정과 append-only 기록 보존
- 학생 자기 점수 조회 및 교사 화면 접근 차단

이후 Guild 1의 기존 학생 이동·해제·재배정, 이동 후 과거 세션 snapshot 보존도 production에서 통과했다. 따라서 **Guild 2A Core는 사용자 E2E ACCEPTED** 상태다. 다른 기기 Realtime 즉시 반영과 전입/전출 E2E는 별도 확인 항목으로 남는다.

다음 운영 도구 후보로, 교사가 회귀 테스트용 학생을 운영 패널에서 쉽게 추가할 수 있는 기능 요청을 기록했다. 실제 학생·인증 계정·길드 이력에 영향을 줄 수 있으므로, Guild 3/4에 임의로 섞어 구현하지 않고 별도 SPEC과 production preflight 후 진행한다.

---

# 11. Security state warning

이전 운영 DB audit에서는 broad GRANT가 individual REVOKE를 덮어쓴 문제가 발견됐다.

특히 다음과 같은 internal function이 authenticated/anon에 노출될 경우 P0가 된다.

- `create_transaction`
- `link_student_to_auth_user`
- 기타 internal asset/achievement/mail helpers

security hardening migration이 준비된 이력이 있으나
**production 최종 적용 여부는 현재 handoff 정보만으로 확정되지 않는다.**

Codex가 새로운 score RPC를 만들 때도:

- PUBLIC/anon revoke
- authenticated에는 필요한 public RPC만 grant
- internal helper direct EXECUTE 차단
- SECURITY DEFINER search_path/role/classroom check

를 반드시 검토한다.

---

# 11. Migration/cutover strategy

1.0(GAS/Sheets)은 오래 실제 운영된 behavioral reference다.

2.0은 리팩터링 중이다.

최종 데이터 전략:

1. 2.0 기능 구현 완료
2. 현재 시점의 1.0 최신 데이터를 한 번에 migration
3. 검증
4. cutover
5. 1.0 write 종료

따라서 현재 2.0의 오래된 snapshot 데이터를 “최종 실데이터”처럼 수선하는 작업을 임의로 하지 않는다.

---

# 12. Next roadmap

현재 길드 개발 순서:

1. **Guild 1 — Foundation: COMPLETE**
2. **Guild 2 — GS Engine / 개인 기여도 기반**
3. Guild 3 — Mission
4. Guild 4 — Peer Review
5. Guild 5 — Monthly closure / conquest

Guild 2 authoritative spec:

`docs/GUILD2_SPEC.md`

Guild 3/4에 필요한 산식은 Guild 2 SPEC에 integration contract로 미리 정의하되,
Mission/Peer Review 전체 기능 자체를 Guild 2에서 중복 구현하지 않는다.

---

# 13. Guild 2 headline decisions

월간 개인 기여도:

- 동료평가: 300
- 미션 기여: 300
- 길드 세션: 150
- 교사 관찰 로그: 150
- 기본 최대: 900
- Arcade raw bonus: game별 rank bonus 합산 (원본은 +90 초과 가능)
- Arcade applied bonus: `least(raw, 90)`, 최대 +90
- 최종 개인기여도: 기본 + 적용 Arcade, 최대 990

Guild GS:

- 개인 기여도 합
- + 월간 길드 미션 GS
- + 수동 지정 4인 길드 compensation

5인 길드 기준:

- 기본 개인기여 최대: 900 × 5 = 4,500
- 월간 미션 full-clear total: 5,000
- 기본 설계 ceiling: 9,500
- 초기 6개 game에서 원본 합계가 +180이어도 학생별 적용값은 +90, 5인 기준 theoretical 9,950
- game 수가 늘어도 Guild 2 적용 Arcade bonus는 학생별 +90을 넘지 않음

---

# 14. Four-member guild compensation

자동으로 “현재 4명이니까 보정”하지 않는다.

Teacher가 시즌/길드 단위로:

**인원 보정 대상 길드**

를 수동 지정한다.

보정은 기본 개인기여도만 사용한다.

`compensation = 0.5 × guild members' average BASIC contribution`

Arcade bonus는 compensation 평균에 넣지 않는다.

보정값은 10점 단위 반올림.

이 설정은 실제 현재 인원수가 일시적으로 바뀌어도 자동 ON/OFF되지 않는다.

Season 2 중 학생 전출 가능성이 있으므로 특히 중요하다.

“머릿수가 중요한 미션”에 별도 시스템 보정은 만들지 않는다.
필요한 어드밴티지는 mission design 자체에서 교사가 처리한다.

---

# 15. Student score visibility

학생에게 너무 상세한 계산 원재료를 공개하지 않는다.

기본:

- 월간 총 개인기여도
- 기본 /900
- arcade 획득 +N / 반영 +M (반영 최대 +90)
- 각 영역 합계

영역별 공개 정도는 다르게 한다.

## Peer review
최종 점수만.
원점수/평가자별 점수/보정전후/알고리즘 중간값 비공개.

## Mission
월간 점수 + 미션별 S/A/B/C/F grade.
활동기록 본문은 본인이 확인.
세부 산술식은 비공개.

## Session
상세 공개 가능.
각 세션 PRESENT/ABSENT/EXCUSED 및 불참 감점 표시.

## Teacher observation
점수 + 인정 행동 횟수 + category counts.
교사 메모는 기본 비공개.
교사가 공개 지정한 메모만 학생에게 노출 가능.

## Arcade
게임별 rank/bonus와 cap 적용을 상세 공개.

Current month:

`집계 중`

Finalized month:

`확정`

월 마감/reopen/correction은 Guild 5에서 구현한다.
