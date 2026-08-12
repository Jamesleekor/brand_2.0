# B.R.A.N.D 2.0 — MASTER IMPLEMENTATION ROADMAP

**Current master date:** 2026-08-12  
**Purpose:** B.R.A.N.D 2.0의 전체 구현 방향, 현재 진행 상태, Guild 2~5 상세 설계 연속성, Arcade 연동, 최종 1.0→2.0 컷오버까지 한 문서에서 보존한다.  
**Use case:** 새 ChatGPT/Codex 대화로 이동할 때 이전 세션의 중요한 결정이 유실되거나 과거 설계가 되살아나는 것을 방지한다.

---

# 0. 이 문서를 읽는 새 ChatGPT / Codex에게

이 문서는 단순한 “할 일 목록”이 아니다.

B.R.A.N.D 2.0의 **프로젝트 연속성 문서**다.

새 대화/새 작업 세션에서 다음 원칙을 따른다.

1. 이미 `ACCEPTED / LOCKED / COMPLETE`로 표시된 규칙은 임의로 다시 설계하지 않는다.
2. 과거 문서와 충돌하면 이 문서의 최신 상태와 해당 기능의 최신 SPEC을 우선한다.
3. `PENDING DISCUSSION`은 사용자의 결정 없이 임의로 채우지 않는다.
4. `DEFERRED`는 삭제된 기능이 아니라 조건이 갖춰진 뒤 검증/구현할 항목이다.
5. 구현 전에는 항상 실제 production Supabase schema를 조사한다.
6. 이 문서는 큰 방향과 상태를 보존한다. 세부 구현은 기능별 SPEC이 source of truth다.
7. 긴 대화가 끝나기 전에 이 문서를 **반드시 갱신**한다.

## 권장 문서 우선순위

1. `AGENTS.md` — 불변 개발/보안 규칙
2. 현재 작업 기능의 최신 SPEC (`GUILD2_SPEC.md`, 향후 `GUILD3_SPEC.md` 등)
3. **이 문서 `MASTER_IMPLEMENTATION_ROADMAP_2026-08-12.md`**
4. `BRAND_CURRENT_STATE_2026-08-12.md`
5. `00_BRAND_완벽이해하기(1).md`
6. 과거 `전체 기능 구현 청사진`, HANDOFF, FEATURE_STATUS, 오래된 구현노트/마이그레이션 주석

기능별 최신 SPEC과 이 문서가 충돌하면 **더 최근에 사용자에게 ACCEPT된 내용**이 우선이다.
충돌을 발견하면 조용히 임의 선택하지 말고 문서를 갱신한다.

---

# 1. 상태 표기

| 표기 | 의미 |
|---|---|
| ✅ COMPLETE | 사용자가 실제 E2E까지 확인하여 완료 판정 |
| 🟢 IMPLEMENTED BASELINE | 코드/기능이 존재하나 전체 최신 청사진 기준으로 최종 완료 판정은 아님 |
| 🟡 IN DESIGN / IN PROGRESS | 설계 또는 구현 진행 중 |
| ⬜ PLANNED | 향후 구현 예정 |
| ⏸ DEFERRED | 의도적으로 후속 단계로 미룸 |
| ❌ OBSOLETE | 폐기된 과거 규칙. 되살리지 말 것 |

---

# 2. B.R.A.N.D의 정체성과 불변 철학

B.R.A.N.D는 단순한 학급 경제 앱이 아니다.

**초등학교 5학년 한 반 24명이 1년 동안 살아가는 하나의 세계**다.

- 학생 = **모험가**
- 교사 = 운영자 / 세계 관리자
- 캐릭터 = **편린**
- 편린 구매 = **영입**
- BrandVN = **차원관문**
- 월간 MVP = 학생을 소울루트로 하여 새로운 **화신**을 피워내는 사건

설계 순서:

1. 이것이 B.R.A.N.D 세계에서 무엇인가?
2. 학생이 이것을 어떻게 경험하는가?
3. 기술적으로 어떻게 구현하는가?

성장 철학:

> **티끌 모아 태산**

작은 보상이 1년 동안 축적되는 구조를 우선하며 큰 즉시 인센티브로 활동을 강제하지 않는다.

## 경제 핵심

- GOLD = 일반 통화
- CRYSTAL = 프리미엄 통화
- BV = 명예/노력의 누적 기록
  - 학생 간 거래 불가
  - 일반 세금 없음
  - 일반적으로 차감하지 않음
  - 22티어의 유일한 기준
- 22티어 이름/임계값은 불변
- 금 광석 티어에서 2차직업 해금

## 기술 핵심

- React + TypeScript + Vite
- Supabase / PostgreSQL / PostgREST
- 중요한 자산·점수·권한 변경은 DB RPC에서 처리
- 클라이언트를 신뢰하지 않음
- production schema는 local migration 폴더와 같다고 가정하지 않음
- 과거 history/snapshot은 현재 상태가 바뀌어도 rewrite하지 않음

---

# 3. 현재 Git / 개발 운영 기준

## 현재 안정 기준점

**Guild 1 COMPLETE**

Git의 안정 기준:

- `main` = 검증 완료 안정판
- tag = `guild1-complete`
- Guild 2 작업 branch = `feature/guild2-gs-engine`

GitHub remote는 프로젝트의 원격 백업이며,
로컬 repo와 production Supabase DB는 서로 다른 상태 저장소다.

## 운영 원칙

- main에서 직접 새 기능 실험 금지
- 기능마다 `feature/...` branch 사용
- Codex는 현재 branch에서 in-place 수정
- 매 수정마다 ZIP 새 폴더 생성하지 않음
- dependency 변경이 없으면 매번 `npm ci` 하지 않음
- 기능 구현 후 `npm run build`
- Codex build 성공 ≠ COMPLETE
- 사용자 실제 teacher/student E2E 통과 후 main merge/tag

---

# 4. 현재 전체 상태 — 2026-08-12

| Stage | 영역 | 최신 상태 | 현재 해석 |
|---:|---|---|---|
| 0 | 공통 개발 기반·보안 | 🟡 지속 작업 | RPC/RLS/오류/Realtime 패턴 존재. 기능 추가마다 계속 강화 |
| 1 | 교사 BV/GOLD 지급·차감 | ✅ COMPLETE | 실제 E2E 완료 |
| 2 | 기본 경제 행동 | 🟢 IMPLEMENTED BASELINE | Feature 2 구현이 현재 코드에 존재. 전체 roadmap 완료조건은 추후 회귀 |
| 3 | 실시간 경매 | 🟢 IMPLEMENTED BASELINE | 실시간 경매 + 운영 확장/프리셋/회차 이력까지 구현된 현재 baseline |
| 4 | 길드 기반 | ✅ COMPLETE | Guild 1 완료. 전입/전출 E2E만 후속 학생관리 UI 뒤 검증 |
| 5 | 길드 핵심 시스템 | 🟡 IN PROGRESS | Guild 2→3→4→5로 재분해하여 진행 |
| A | Arcade | 🟡 PARALLEL DESIGN | 6개 초기 게임 + 월간 개인기여 보너스. 별도 프로젝트로 병행 |
| 6 | 시장·상점·직업 | ⬜ PLANNED | 일부 UI/legacy 흔적이 있어도 최신 완성 기준으로 재구축 필요 |
| 7 | 업적·성좌맵 | ⬜ PLANNED | 1.0 데이터/로직을 참고해 이식 |
| 8 | 금융 | ⬜ PLANNED | 예금·적금·대출·신용 |
| 9 | 출석·과제·일일퀘스트 | 🟢 PARTIAL BASELINE | 출석/과제 기반은 Feature 4에 존재. 전체 성장/보상 통합은 미완 |
| 10 | 복지·세금·사회기여 | ⬜ / PARTIAL | 일부 경제 UI 흔적과 별개로 전체 원장/분배 규칙 완성 필요 |
| 11 | 우편·알림·피드 | 🟢 PARTIAL BASELINE | Feature 4 통신/우편 기반 존재. 모든 도메인 통합 알림은 미완 |
| 12 | 비상사태·경비대·돌발퀘스트 | 🟢 PARTIAL BASELINE | Feature 4 운영 기능 존재. 최종 상태머신/가드 전체는 미완 |
| 13 | BrandVN | ⬜ PLANNED | 1.0 `Code_Character.gs` 이식 예정 |
| 14 | 편린 콜렉션·통합 버프 | ⬜ PLANNED | 성좌 버프와 동일한 통합 엔진 |
| 15 | 기록실·랭킹·분석 | 🟢 PARTIAL BASELINE | Records/Analytics UI 일부 존재. 전체 재현 가능한 집계는 미완 |
| 16 | 설정·관리·데이터 도구 | 🟡 PARTIAL | 학생 전입/전출 관리 UI가 특히 아직 필요 |
| 17 | UI/UX·성능·접근성 | 🟡 CONTINUOUS | 각 Feature마다 병행 |
| 18 | 최종 데이터 이전·컷오버 | ⬜ PLANNED | 모든 2.0 기능 완료 후 수행 |

**주의:** `IMPLEMENTED BASELINE`은 과거 청사진의 모든 세부 완료조건을 이미 통과했다는 뜻이 아니다.

---

# 5. Guild 1 — Foundation

**Status: ✅ COMPLETE**

## 5.1 최종 모델

길드 자체에는 속성이 없다.

각 학생의 활성 guild membership에 담당 속성이 있다.

지원:

- EARTH / 땅
- WATER / 물
- FIRE / 불
- WIND / 바람
- LIGHT / 빛
- DARK / 어둠

❌ OBSOLETE:

> 길드 자체가 땅/물/불/바람/빛 속성을 가진다.

이 과거 모델을 되살리지 않는다.

## 5.2 Membership

- 학생 1명당 활성 membership 최대 1개
- 이동 = 기존 row 종료 + 신규 row
- 탈퇴 = current row 종료
- 재배정 = 새로운 history row
- 같은 길드 속성 변경 = `ELEMENT_CHANGE` 이력
- 과거 membership 삭제 금지

## 5.3 Guild session

학교 출석과 별개.

세션 생성 순간 다음 snapshot 보존:

- 학생
- 당시 길드
- 당시 길드명
- 당시 담당 속성

상태:

- PRESENT
- ABSENT
- EXCUSED

개인기여도에서:

- PRESENT = 참석 인정
- EXCUSED = 참석 인정
- ABSENT = 불참

## 5.4 E2E 결과

통과:

- 기존 5개 길드/학생 배정
- 미배정 학생 표시
- 길드 생성
- 이동
- 탈퇴
- 재배정
- 이력 보존
- 속성
- 길드 세션
- 세션 snapshot
- 출석 3상태
- 인정불참 처리
- 빈 길드 비활성화/재활성화
- 학생 길드 공통 헤더
- 소속 이력/세션 기록

⏸ DEFERRED:

전입/전출 E2E.

이유:
학생 자체를 추가/전출 처리하는 교사 Student Management UI가 아직 없음.

Stage 16 구현 뒤 반드시 회귀:

1. 전입 학생 생성
2. 길드 배정
3. 전입 이전 세션에 등장하지 않는지
4. 전출 처리
5. 과거 history 보존
6. current membership 정리
7. 전출 이후 세션에서 제외

---

# 6. Guild 2~5 MASTER ROADMAP

이 절은 긴 대화 세션이 바뀌어도 **길드 설계를 잃지 않기 위한 핵심 연속성 영역**이다.

구현 순서는 고정:

> **Guild 1 Foundation → Guild 2 GS Engine → Guild 3 Mission → Guild 4 Peer Review → Guild 5 Monthly Closure & Conquest**

Guild 1은 완료.

---

# 7. Guild 2 — GS Engine & Individual Contribution

**Status: 🟡 DESIGN ACCEPTED / CODEX IMPLEMENTATION STARTED**

상세 source of truth:

`docs/GUILD2_SPEC.md`

## 7.1 개인기여도 — LOCKED

월간 기본 개인기여도 최대 **900점**.

| 영역 | 최대 |
|---|---:|
| 동료평가 | 300 |
| 미션 기여 | 300 |
| 길드 세션 | 150 |
| 교사 기여 기록 | 150 |
| **기본** | **900** |
| Arcade 보너스 | **+90 cap** |
| **절대 최대** | **990** |

BV 증가량을 개인기여도 공식에 사용하지 않는다.

과거 alpha/BV 증가 중심 시즌1 공식은 ❌ OBSOLETE.

## 7.2 동료평가 300 — 계산 계약 LOCKED

단순 평균 금지.
4~5인 길드라 절사평균도 사용하지 않는다.

### 1단계: 평가자 성향 보정

평가자별 자신이 준 점수 평균 계산.

평가자 평균들의 중앙값을 중심으로 편향 계산.

`bias = clamp(reviewer_mean - median(reviewer_means), -1.5, +1.5)`

`stageA = clamp(raw_score - bias, 1, 10)`

### 2단계: 특정 대상 극단값 영향 제한

대상 학생이 받은 `stageA` 점수들의 중앙값 계산.

허용범위:

`target_median ± 2`

그 밖 점수는 경계값까지 Winsorize.

최종평점 = 보정 점수 평균.

`peer_points = final_rating / 10 × 300`

### 공개

학생:

- 최종 `N / 300`만
- 원점수/평가자/보정량/중간 계산 비공개

교사:

- 원점수
- 평가자
- 보정값
- 최종 보정점수
- 댓글
- 이상치 검토 가능

## 7.3 미션 기여 300 — Guild 3 연결 계약 LOCKED

월 미션 개수와 관계없이 가중치로 300을 정규화.

`mission_max_i = 300 × mission_weight_i / monthly_weight_sum`

각 미션에서:

- 길드 클리어 = 80%p
- 실패 = 0%p
- 개인 수행 = 최대 20%p

개인 등급:

| 등급 | 개인 수행분 |
|---|---:|
| S | 20%p |
| A | 15%p |
| B | 10%p |
| C | 5%p |
| F | 0%p |

**미션 실패 시에도 개인 수행 20% 영역은 살아있다.**

## 7.4 학생 미션 활동 기록 — LOCKED

학생은 자기 등급을 선택하지 않는다.

학생은 자신이 실제로 한 일을 증거성 텍스트로 기록한다.

UI 필수 문구:

> 이번 미션에서 내가 실제로 한 일을 **구체적으로** 적어주세요.  
> *(길드 개인 기여도 점수에 일부 반영됩니다.)*

`구체적으로`는 실제 UI 강조.

체크리스트 방식 ❌.

교사는 기록을 읽고 `[S] [A] [B] [C] [F]` 중 하나를 클릭.

기록 미제출 시 기본 F/0% 개인 수행분.
특별한 사유가 있으면 교사가 override 가능.

## 7.5 길드 세션 150 — LOCKED

`max(0, 150 - 30 × ABSENT 수)`

- PRESENT 감점 없음
- EXCUSED 감점 없음
- ABSENT -30

세션 수가 월 3회든 4회든 “불참 1회 -30” 유지.

## 7.6 교사 기여 기록 150 — LOCKED

행동 로그:

- 협력
- 리더십
- 책임
- 지원
- 문제해결
- 기타

1회 = +10.

최대 15회 = 150.

짧은 근거 메모.
학생에게 공개 여부 별도.

학생 기본 공개:

- 점수
- 인정 행동 횟수
- 카테고리별 횟수

교사 메모는 기본 비공개.

## 7.7 Arcade +90 — LOCKED

게임별 월간 snapshot:

- 1위 +30
- 2위 +27
- 3위 +24
- 4~6위 +18
- 7~10위 +15
- 11위 이하 0

여러 게임 합산 raw가 90을 넘더라도:

`arcade_applied = min(raw, 90)`

## 7.8 4인 길드 보정 — LOCKED

단순 ×1.25 사용하지 않는다.

교사가 시즌/길드 단위로 직접:

> **인원 보정 대상 길드**

를 지정한다.

보정:

`0.5 × 해당 scoring roster의 평균 BASIC 개인기여도`

- Arcade 제외
- 10 GS 단위 반올림
- 실제 현재 인원이 4명이라고 자동 활성화하지 않음
- 시즌 중 전출로 인원이 줄어도 자동 ON/OFF하지 않음

머릿수가 중요한 미션에 시스템 차원의 별도 자동 보정 없음.

그런 미션의 어드밴티지는 미션 설계 자체에서 처리.

## 7.9 월간 GS — LOCKED

일반 길드:

`GS = 개인 최종기여도 합 + 공식 길드 미션 GS`

보정 길드:

`GS = 개인 최종기여도 합 + 공식 길드 미션 GS + 인원보정`

월간 길드 미션 full-clear 총 pool:

**5,000 GS**

5인 길드 기준:

- 기본 개인기여 최대 4,500
- 미션 5,000
- 기본 perfect subtotal 9,500
- Arcade까지 전원 90이면 이론 최대 9,950

따라서 **10,000 GS가 사실상 완벽한 달의 천장**.

## 7.10 학생 개인기여도 공개 — LOCKED

학생에게 원재료를 전부 보여주지 않는다.

헤더:

- 월간 총점
- 기본 `/900`
- Arcade `+/90`

영역:

- 동료평가 `/300`
- 미션 기여 `/300`
- 길드 세션 `/150`
- 길드 기여 기록 `/150`
- Arcade `+/90`

공개 강도:

- Peer: 최종점수만
- Mission: 점수 + 미션별 S/A/B/C/F + 자기 활동기록
- Session: 상세 출석 기록 공개
- Observation: 점수/횟수/category, 메모는 선택 공개
- Arcade: rank/bonus/cap 상세 공개

현재 월:

`집계 중`

최종 월:

`확정`

최종 확정/reopen은 Guild 5 책임.

## 7.11 Guild 2 데이터 원칙

- GS source별 audit
- append-only ledger 권장/원칙
- correction은 기존 event overwrite/delete보다 reversal + corrected event
- formula version 저장
- aggregate와 raw evidence 분리
- Guild 3/4가 아직 연결되지 않은 영역은 `0`으로 위장하지 않고 `미연결/준비 중` readiness 표시

## 7.12 현재 Codex 작업 원칙

Guild 2 구현 전 production preflight.

조사 대상:

- `guild_gs`
- `guild_individual_contributions`
- `guild_activity_logs`
- `guild_missions`
- `guild_mission_logs`
- `guild_peer_reviews`
- `guild_seasons`
- `guilds`
- 기존 `calculate_individual_contribution`
- 기존 `evaluate_guild_mission_log`
- 관련 GRANT / RLS / 함수 signature/default

DB 직접 접근 불가 시 preflight SQL 작성 후 **추측 구현 중단**.

---

# 8. Guild 3 — Mission

**Status: 🟡 CORE RULES ACCEPTED / DETAILED SPEC REQUIRED BEFORE IMPLEMENTATION**

향후:

`docs/GUILD3_SPEC.md`

를 별도로 확정한 뒤 구현한다.

## 8.1 이미 ACCEPT된 핵심

### Mission lifecycle

미션은 상태 머신을 가진다.

정확한 enum 이름은 아직 확정하지 않았으므로 임의로 만들지 않는다.

### Hidden information

- 시즌 미션 제목은 미리 보여줄 수 있음
- 교사가 공개한 미션만 상세 내용/평가기준 표시
- 미공개 상세는 프론트 CSS 숨김이 아니라 DB/RPC/RLS에서 차단

### Submission

미션별 제출 방식은 선택 가능해야 한다.

어떤 미션:

- 길드 전체 최종 결과물 1개

다른 미션:

- 개별 학생 작업

또 다른 미션:

- 별도 제출 없이 교사가 실제 활동을 확인

따라서 “모든 미션 제출 필수” 모델 금지.

제출 기능은 제공하되 미션 설정에 따라 optional/required/none이 가능하도록 설계.

submission history 보존.

### 개인기여 300

Guild 2의 가중치 + 80/20 계약 그대로 사용.

학생 활동 기록 + 교사 S/A/B/C/F.

### 공식 Guild Mission GS

월 full-clear 총합을 **5,000 GS**로 정규화.

`mission_gs_max_i = 5000 × weight_i / monthly_weight_sum`

가중치는 규모/중요도.

미션 개수가 많다고 월 최대 GS가 커지지 않는다.

### 실패해도 개인 수행분 유지

미션 실패:

- 길드 성공 80% = 0
- 개인 등급 0~20%는 지급 가능

## 8.2 PENDING DISCUSSION — Guild 3에서 반드시 확정

아래는 Codex가 임의로 정하지 않는다.

1. 정확한 mission state enum과 전이
2. 미션 공개 시각/마감 시각/수정 가능 기간
3. `submission_mode` 세부 타입
4. 길드 최종 제출과 개인 활동 기록의 관계
5. 부분 성공/부분 GS가 존재하는 미션의 규칙
6. teacher score correction/reopen UX
7. 미션 완료 판정과 Peer Review open 시점
8. 미션 실패/취소/무효 상태
9. 보상(BV/GOLD/CRYSTAL 등)이 필요한 미션의 지급 정책
10. 알림 연동
11. 과거 미션 read-only/history UI
12. 미션별 인원 어드밴티지 입력 방식이 필요한지 여부
   - 단, 자동 headcount compensation은 만들지 않음

---

# 9. Guild 4 — Peer Review

**Status: 🟡 MAJOR RULES ACCEPTED / DETAILED SPEC REQUIRED**

향후:

`docs/GUILD4_SPEC.md`

## 9.1 가장 중요한 불변 규칙: obligation snapshot

1.0에서 길드 이동 후 동료평가가 깨진 경험이 있었다.

문제 예:

- 전입한 학생에게 이미 끝난 과거 미션 평가 요구
- pending peer review 때문에 상점/교환/P2P lock
- current guild member count로 완료 여부를 계산해 결과 공개 시점이 꼬임
- 이미 완료한 평가가 다시 나타남

2.0에서는 절대 current membership으로 평가 의무를 동적으로 계산하지 않는다.

**평가 라운드가 열리는 순간:**

- 평가 참가자 snapshot
- reviewer → target obligation snapshot

을 고정한다.

이후 길드 이동/탈퇴/속성 변경이 있어도 해당 round obligations는 바뀌지 않는다.

## 9.2 ACCEPTED UX / Rules

- 자기 자신 평가 금지
- 길드원 한 명씩 평가
- 1~10점
- 구체적 comment 최소 20자
- progress 표시
- 중복 제출 방지
- 수정 가능 기간 존재
- deadline 표시
- deadline 도달 시 그때까지 실제 완료된 평가를 기준으로 결과 공개
- teacher: `지금 종료 / 결과 공개`
- 미평가자 penalty: **2,000 GOLD**

Teacher:

- 모든 작성자
- 원점수
- 댓글
- 보정 결과
- 제출 여부
- 신뢰 위반/이상치 검토

Student:

- 기본적으로 최종 aggregate peer score
- evaluator identity/raw score 비공개
- 교사가 선택한 피드백만 공개 가능

## 9.3 Peer score correction — LOCKED

Guild 2에서 정의한 2단계 보정 사용.

1. reviewer tendency correction, bias cap ±1.5
2. target median ±2 범위 밖 extreme influence cap

원점수 삭제 금지.

## 9.4 PENDING DISCUSSION — Guild 4

1. 평가 open 조건
2. 정확한 edit 기간
3. deadline 기본값/교사 설정 방식
4. 미제출 평가가 target 평균 denominator에서 어떻게 제외되는지 UI 설명
   - accepted high-level: deadline 시 완료된 평가를 사용
5. penalty 적용 시점/취소/정정
6. special absence/excuse가 peer obligation에도 필요한지
7. published feedback의 공개 기간/수정
8. 한 mission에 peer round가 1개인지, 특수 미션에서 복수 round 허용 여부
9. 동료평가 결과 확정 전 개인기여도 readiness 표시

---

# 10. Guild 5 — Monthly Closure & Conquest

**Status: 🟡 CORE RULES ACCEPTED / DETAILED SPEC REQUIRED**

향후:

`docs/GUILD5_SPEC.md`

## 10.1 Monthly close

Teacher:

- 월간 close preview
- source별 개인기여도 readiness
- 길드 GS preview
- 누락/오류 경고
- finalization
- reopen/correction

Guild 5가 최종 월 Snapshot 책임을 가진다.

Guild 2는 draft 계산만 담당.

## 10.2 Ranking

월간 final GS로 길드 rank 결정.

개인기여도, mission GS, compensation, Arcade가 최종 계산에 반영.

## 10.3 Tie-break — ACCEPTED

동점 시:

> **마감 시점 scoring member들의 개인 BV 합**

으로 순위 결정.

중요:

- current membership을 나중에 다시 조회해 과거 tie-break를 바꾸지 않음
- 마감 순간 roster/BV snapshot 필요

## 10.4 Conquest — ACCEPTED

정확히 **3개 영토**.

순위:

1. 1위 길드가 먼저 영토 선택
2. 2위 길드가 남은 것 중 선택
3. 3위 길드가 마지막 영토 획득

월별 점령 결과/history 보존.

학생 길드의 기본 탭은 장기적으로 점령/월드맵.

## 10.5 Correction / history

- 월간 결과 finalize
- 필요 시 reopen
- correction
- 기록실 연결

과거 결과는 snapshot 기반으로 재현 가능해야 한다.

## 10.6 PENDING DISCUSSION — Guild 5

1. finalize 전 필수 readiness 조건
2. peer/mission 미완료가 있을 때 close를 막을지 override 허용할지
3. correction으로 순위가 바뀌었는데 이미 영토 선택을 끝냈을 때 처리
4. 영토 선택 deadline
5. 선택하지 않은 경우 자동 배정 규칙
6. 4·5위 길드의 conquest UI 표현
7. 월드맵의 월/시즌 history UX
8. tie-break가 다시 동점인 경우 2차 tie-break
9. 월 close snapshot에 포함할 exact roster 기준
10. 시즌 누적 GS와 월 GS 관계/시즌 종료 snapshot
11. 월간 1위 길드 기록실/명예의 전당 연동
12. reopen 권한과 audit log

---

# 11. Arcade Project — Guild와 병행되는 게임 레이어

**Status: 🟡 PARALLEL DESIGN / IMPLEMENTATION PLANNED**

Arcade는 B.R.A.N.D 세계의 개인 경쟁형 미니게임 모음이다.

초기 게임은 6개지만 향후 추가 가능하다.

## 11.1 초기 6종

1. 집중 + 반응 + 콤보
2. 속도 + 정확도
3. 타카투카 — 선택 + 확률 / 10레벨 클리어형
4. 같은 별 연결 퍼즐
5. 순수 반응속도
6. 타자 속도 + 정확도

1, 2, 4, 5, 6은 사실상 무제한 high-score형.
타카투카는 10레벨 클리어 구조.

상세 mechanics는 별도 Arcade 설계 세션의 최신 SPEC을 따라야 한다.
이 Master Roadmap이 개별 게임 규칙을 대신하지 않는다.

## 11.2 Ranking — ACCEPTED

게임 × 기간별 leaderboard에서 학생 1명은 한 번만 등장.

각 학생의 **단일 최고 점수**만 사용.

Top 10은 서로 다른 10명.

## 11.3 Guild와의 관계 — ACCEPTED

Arcade는:

- 개인 경쟁
- 자율 참여
- 길드 단체 강제 참여 아님
- 게임 score를 길드 GS에 직접 합산하지 않음

Guild에 미치는 영향은:

**월간 개인기여도 Arcade bonus**

뿐.

## 11.4 Monthly snapshot — ACCEPTED

실시간 개인기여도 반영 아님.

월간 GS 계산 시점 ranking snapshot 사용.

Rank bonus:

- 1위 30
- 2위 27
- 3위 24
- 4~6위 18
- 7~10위 15

Guild 2에서 월 raw bonus와 cap 90을 관리.

## 11.5 확장성

고정된 `game1`~`game6` 컬럼을 만들지 않는다.

stable game code/id 사용.

추후 7번째, 8번째 게임이 추가되어도 contribution formula를 다시 설계하지 않는다.

## 11.6 Security anchor

Game #01에서 ACCEPT된 보안/상태 모델:

`READY → COUNTDOWN → PLAYING → GAME_OVER → SUBMITTING → RESULT`

브라우저가 최종 점수를 직접 DB에 쓰지 않는다.

클라이언트는 input/event log를 제출하고,
서버가 점수를 재계산/검증하는 방향.

최우선 방어:

- 콘솔로 점수 직접 조작
- 게임 속도 조작

과도한 anti-cheat는 초기 목표가 아니다.

## 11.7 Arcade PENDING

Arcade 상세 작업은 별도 `ARCADE_SPEC.md`로 정리해야 한다.

특히:

- 6게임별 정확한 rules/scoring
- retry/session 정책
- 서버 score validation 수준
- leaderboard period schema
- 월 snapshot lock
- Game #03 타카투카의 최신 상세 규칙
- 운영/초기화/기록 UI
- teacher admin

Guild 2는 Arcade 게임 자체를 구현하지 않고 **monthly result adapter contract**만 준비한다.

---

# 12. Stage 6 — 시장·상점·직업

**Status: ⬜ PLANNED**

원래 전체 청사진의 핵심 범위를 유지한다.

## 12.1 간식 상점

Teacher:

- 상품 등록/수정/비활성
- 이미지
- 기본/현재 재고
- 기본/현재 가격
- 학생별/주간 구매 제한
- 재입고
- 구매내역

Student:

- 상품
- 가격
- 재고
- 구매한도
- 수량
- 구매
- 성공/실패

DB:

- 서버 가격
- 잔액/재고/한도 한 transaction 검증
- 동시 구매로 재고 음수 금지

## 12.2 꾸미기·편린 상점

- 아이템/편린 master
- 가격 정책
- 판매기간
- set/collection
- 시즌 한정
- 이미지/CG
- 구매
- 보유함
- 장착/해제
- 프로필 preview
- set 완성
- 중복 보유 정책

세계관 용어:
편린 구매는 **영입**.

## 12.3 1인1역 + 급여

- 직업 목록/급여
- 학생 배정
- 근무 상태
- 정기/수동 급여
- 소득세/복지기금 연결
- 급여 history
- job history

## 12.4 2차직업

- **금 광석 이상 해금**
- catalogue
- 신청
- 승인/거절
- active job
- 교체/해제
- profile 표시
- 권한/보상 연결

## 12.5 시장 의뢰

- 학생 의뢰 등록
- 보상 escrow
- 수락
- 완료 요청
- 확인
- 보상 지급
- 취소
- 분쟁
- 만료

## 완료 기준

- 모든 구매/급여/보상은 transaction ledger
- 재고/잔액/escrow concurrency safe
- teacher/student full flow

---

# 13. Stage 7 — 업적·성좌맵

**Status: ⬜ PLANNED**

## 업적 master

- 기존 최신 업적 목록 이전
- 등급
- 조건
- 힌트
- hidden
- 평가 유형
- BV/GOLD/CRYSTAL reward
- 자동평가 여부

## 학생 업적

- 목록
- hidden 처리
- progress
- 신청
- evidence
- 보유
- 업적점수/rank

## 교사 운영

- 생성/수정/비활성
- 신청 검토
- 승인/거절
- 자동승인/자동거절
- 수동검토 queue
- reward
- duplicate 방지

## 성좌맵

- 은하 → 성좌 drill-down
- 성좌별 달성률
- 업적 달성 별/node 활성
- 길드/속성 시각 표현
- Chromebook/mobile SVG 최적화

Stage 14의 buff engine과 연결.

---

# 14. Stage 8 — 금융

**Status: ⬜ PLANNED**

1.0 검증 행동을 우선 reference.

## 예금

- 상품
- 가입
- 만기
- 예상 수령
- 중도해지
- penalty
- 자동만기
- 지급 history

## 적금

1.0의 검증 규칙:

- 회차 납입액
- 총 회차
- 주당 이자율
- 매 회차 누적 원금에 이자
- 잔액 부족 회차 skip
- 강제해지 없음
- 실제 납입 원금/이자만 만기 지급
- 미납 기록
- 중도해지 penalty

기존 deposit tables가 충분한지 먼저 조사.

## 대출

- 신청
- 승인/거절
- 실행
- 상환일정
- 자동/수동 상환
- 연체
- 완납
- 중복 제한
- 교사 조정/탕감

## 신용점수

- 산정규칙
- 상환/연체/활동 연동
- 현재 점수
- history
- 설명
- 대출 가능 여부

모든 금융 cron은 idempotent.
KST 일관.

---

# 15. Stage 9 — 출석·과제·일일퀘스트

**Status: 🟢 PARTIAL BASELINE / FINAL INTEGRATION PENDING**

현재 Feature 4에 출석/과제 기반 구현이 존재한다.

최종 요구:

## 출석

Teacher-only write.

- 일별 상태
- 과거 날짜 조회/정정
- 일괄 입력
- streak/milestone

Student:

- 오늘 상태
- streak
- reward history

## 과제

- 생성
- deadline
- 제출
- 채점
- 우수 reward
- 미제출
- feedback

## 일일퀘스트

- 오늘 퀘스트
- 조건
- 완료
- 일일 중복 방지
- reward
- history
- teacher create/deactivate

Feature 4 baseline이 존재한다고 이 Stage 전체가 완료된 것으로 보지 않는다.

---

# 16. Stage 10 — 복지·세금·사회기여

**Status: ⬜ / PARTIAL**

## 소득세/복지기금

- 소득 지급 시 세금
- tax transaction
- welfare fund 적립
- 잔액
- 누적 적립/분배
- ledger reconciliation

## 분배

전략:

- 균등
- 하위 30%
- 하위 50%
- 필요 시 개별선택

Teacher preview → confirm → bulk payout.

## 기부

- 학생 기부
- 누적
- 명예/BV reward 규칙
- 기록실
- 복지기금 유입 여부 명시

---

# 17. Stage 11 — 우편·알림·활동 피드

**Status: 🟢 PARTIAL BASELINE**

Feature 4의 mail/alert 기반 존재.

최종적으로 모든 주요 domain event를 연결.

Student:

- 받은 우편
- unread
- reward/system 알림
- 통합 notification center
- activity feed

Teacher:

- 개인/다중/전체
- 중요 고정
- read status
- 필요 시 예약/만료

연동 사건:

- 업적 승인
- 2차직업 승인/거절
- 경매 낙찰
- 금융 만기/대출
- 길드 미션 공개
- 동료평가 결과
- 비상사태 시작/종료

중복 알림 방지.

---

# 18. Stage 12 — 비상사태·경비대·돌발퀘스트

**Status: 🟢 PARTIAL BASELINE**

Feature 4 운영 baseline이 존재한다.

## 비상사태

- 교사 발동
- 유형/사유
- 시작/종료 시각
- 수동/자동 종료
- 상태 banner
- history
- 동시 허용 규칙

## 경비대

- 역할
- 임기
- 배정
- 활동 기록
- 비상사태 연결

## 돌발퀘스트

- 독립 모델 또는 daily quest 확장 여부 결정
- teacher message
- time limit
- condition
- GOLD/BV
- class notification
- duplicate completion 방지
- result

비상사태와 돌발퀘스트는 같은 개념이 아님.

---

# 19. Stage 13 — BrandVN / 차원관문

**Status: ⬜ PLANNED**

1.0 `Code_Character.gs`가 behavioral reference.

- 편린 선택
- 학생×캐릭터 호감도 0~100
- 단계:
  - 0~19
  - 20~39
  - 40~59
  - 60~79
  - 80~100
- 100에서 진실/story unlock
- 예의바른 대화 +3
- 가벼운 무례 -10
- 심각한 모욕 -30 + lock
- 일일 대화 제한
- 전문분야
- 회피주제
- spoiler gate
- 호감도별 말투
- 경제상황 최소 요약 연동
- CG/story unlock

LLM key는 browser에 두지 않는다.
호감도 계산 서버.
호출량/비용 logging.

---

# 20. Stage 14 — 편린 Collection + 성좌 Buff + 통합 Buff Engine

**Status: ⬜ PLANNED**

## 편린 Collection

- 특정 편린 조합
- 보유 자동 대조
- 달성
- 작은 buff
- 누적
- UI
- 알림

가능 buff:

- 세금 감면
- 상점 할인
- 거래소 할인
- 경매 사용액 일부 환급

각 buff는 작게.
여러 개 누적될 때 의미.

## 성좌 Buff

- 성좌 달성률
- 성좌별 buff
- 업적 보유 변경에 자동 반영

## 통합 engine

`get_active_buffs(student_id)`와 같은 single calculation point.

Source:

- 편린 collection
- 성좌
- 향후 event

필수:

- cap
- stacking
- expiry
- 근거

실제 결제/세금/환급 RPC가 server-side로 buff를 조회.

---

# 21. Stage 15 — 기록실·랭킹·분석

**Status: 🟢 PARTIAL BASELINE**

현재 records/analytics 화면 일부가 있으나 전체 blueprint는 미완.

## 기록실

- 역대 월간 1위 길드
- 주간 MVP
- 월간 MVP 후보
- 월간 MVP WINNER
- 업적 순위/점수
- 기부
- 경매 최고 낙찰
- 시즌 명예의 전당

## 학생 ranking

- BV
- GOLD
- 업적
- 길드 개인기여

민감 금융 세부는 비공개.

## 교사 분석

- 총 BV/GOLD
- 평균/중앙값
- Gini
- 티어 분포
- transaction type
- 학생 추이
- welfare
- Guild GS
- attendance/assignment/quest
- shop/auction
- finance
- anomaly detection

빈 데이터/계산실패를 `0`으로 위장 금지.

---

# 22. Stage 16 — 설정·관리·데이터 도구

**Status: 🟡 PARTIAL / IMPORTANT DEPENDENCY**

Guild 1 전입/전출 deferred E2E를 해제하려면 특히 중요.

## 학급 설정

- 연도/학기
- feature enable
- 구매한도
- 경매규칙
- 세율
- welfare rules
- notifications
- season

불변 규칙은 설정으로 열지 않음.

## 학생/계정 관리

- **전입**
- **전출**
- 계정 연결
- password reset
- 이름 변경
- 길드 재배정
- data retention

## master data

- 간식
- 꾸미기/편린
- 업적
- 직업
- 금융상품
- guild mission
- constellation
- collection
- BrandVN settings

## 운영 도구

- CSV/TSV dry-run
- name matching
- negative/duplicate/orphan 검사
- import report
- ledger reconciliation
- backup/recovery
- AI cost logs

---

# 23. Stage 17 — UI/UX·성능·접근성

**Status: 🟡 CONTINUOUS**

최종 polish만 마지막에 몰아서 하지 않는다.

- Chromebook desktop
- mobile
- 큰 교실 screen
- keyboard
- focus
- skeleton
- empty state
- retry
- long-task progress
- multi-select 대상수/총액
- number formatting
- lazy images
- route code splitting
- pagination/virtualization
- bad network duplicate prevention
- permission menu hiding
- privacy guide

---

# 24. Stage 18 — 전체 데이터 이전·최종 컷오버

**Status: ⬜ FINAL**

현재 2.0 데이터는 최종 운영 데이터라고 가정하지 않는다.

최종 전략:

1. 2.0 기능/콘텐츠 구현 완료
2. 그 시점 최신 1.0 실데이터 one-time migration
3. 검증
4. read-only 병행
5. 최종 증분 sync
6. cutover
7. 1.0 write 종료/보존

Migration 대상:

- 업적/보유업적
- 꾸미기/편린
- 길드/멤버/GS/미션/Peer
- 예금/적금/대출
- 신용
- 보존할 우편/알림
- BrandVN 설정/호감도
- 성좌/collection
- 1인1역/2차직업
- 필요한 경매/기부/records

검증:

- 24명 대조
- 전입/전출
- 음수
- duplicate
- orphan
- transaction totals
- wallet balance
- guild headcount
- achievement/cosmetic counts
- finance principals
- affinity range
- KST dates

---

# 25. 현실적인 최신 Release 묶음

과거 Release 1~8을 현재 상태에 맞춰 재해석한다.

## Release 1 — 경제 코어
🟢 대부분 baseline 존재.
추후 전체 회귀/보안 검증.

## Release 2 — 실시간 경매
🟢 baseline + 운영확장 구현.
추후 전체 회귀.

## Release 3 — Guild Season
🟡 현재 최우선.

- Guild 1 ✅
- Guild 2 🟡
- Guild 3 🟡 설계 필요
- Guild 4 🟡 설계 필요
- Guild 5 🟡 설계 필요

## Parallel Release A — Arcade
🟡 병행.

Guild 2의 contribution adapter와 연결하되,
게임 자체 개발은 별도 feature/module.

## Release 4 — 시장
⬜.

- 간식
- 꾸미기
- 1인1역
- 2차직업
- 시장 의뢰

## Release 5 — 성장
⬜ / 일부 baseline.

- 업적
- 성좌맵
- 출석
- 과제
- 일일퀘스트

## Release 6 — 금융·복지
⬜.

- 예금
- 적금
- 대출
- 신용
- 세금
- 복지
- 기부

## Release 7 — 세계관 콘텐츠
⬜.

- BrandVN
- 편린 Collection
- 성좌 buff
- 통합 buff

## Release 8 — 운영 완성
🟡 일부 baseline / 최종 통합 필요.

- 우편/알림
- emergency
- records
- analytics
- settings
- student management
- UI/UX
- full migration
- cutover

---

# 26. Cross-feature dependencies

## Guild → Arcade

Guild 2:

- monthly contribution adapter
- rank bonus/cap

Arcade:

- game score
- leaderboard
- monthly snapshot source

게임이 Guild GS를 직접 수정하지 않는다.

## Guild 3 → Guild 4

Mission lifecycle이 Peer Review round open 조건을 제공.

Peer obligations는 round open snapshot으로 고정.

## Guild 2/3/4 → Guild 5

Guild 5 close preview는 다음 readiness를 검사:

- session
- teacher observation
- mission
- peer
- arcade
- official mission GS
- compensation config

## Guild 5 → Records

final monthly rank / GS / conquest를 records에 snapshot.

## Job → Tax/Welfare

1인1역 급여 → income tax → welfare ledger.

## Achievement → Constellation → Buff

achievement holdings → constellation progress → active buff.

## Fragment Shop → Collection → Buff

편린 보유 → collection → buff.

## Shop/Auction/Tax → Buff

실제 할인/환급 계산은 client가 아니라 server buff engine 사용.

## Student Management → Guild regression

전입/전출 구현 후 Guild 1 deferred test 재개.

---

# 27. 아직 전역적으로 논의해야 할 큰 결정

각 Feature SPEC에서 상세화하되 이 목록을 잊지 않는다.

1. Guild 3 정확한 mission lifecycle
2. Guild 4 peer deadline/edit/exception 세부
3. Guild 5 correction과 conquest 결과 충돌 처리
4. Arcade 전체 architecture/spec
5. 시장/상점/직업의 Season 2 세부 경제값
6. 업적 최신 master / 성좌 visual & buff values
7. 금융 상품/이자/신용 Season 2 values
8. 복지/세금 exact rates
9. BrandVN 2.0 AI architecture/privacy/cost
10. 통합 buff의 cap/stacking
11. 학생 전입/전출 UI와 data lifecycle
12. final 1.0 migration source freeze 날짜/절차

이 항목들을 과거 코드가 이미 값을 가지고 있다는 이유로 자동 확정하지 않는다.

---

# 28. 새 대화 세션으로 옮길 때의 Continuity Protocol

이 문서가 만들어진 가장 중요한 이유다.

## 28.1 새 ChatGPT 세션 시작 시

가능하면 이 파일을 새 대화에 첨부하고 다음처럼 시작한다.

> B.R.A.N.D 2.0 설계를 계속한다.  
> 첨부한 `MASTER_IMPLEMENTATION_ROADMAP_2026-08-12.md`를 프로젝트 연속성의 기준으로 읽어라.  
> 이미 ACCEPTED/LOCKED/COMPLETE인 규칙을 다시 설계하지 말고, PENDING DISCUSSION 항목만 논의한다.  
> 실제 구현은 Codex에서 하고 이 대화에서는 설계·정책·UX 결정을 한다.

현재 기능의 상세 SPEC도 함께 필요하면 첨부한다.

예:

- Guild 2 → `GUILD2_SPEC.md`
- Guild 3 이후 → 해당 최신 SPEC

## 28.2 긴 세션 종료 전

새로운 결정이 있었다면 반드시 세 가지 중 하나를 한다.

- `ACCEPTED/LOCKED`로 Master Roadmap에 반영
- 해당 Feature SPEC에 반영
- 미결정이면 `PENDING DISCUSSION`에 명시

“대화에서만 합의하고 문서에는 없는 상태”를 만들지 않는다.

## 28.3 Codex 작업 완료 후

기능을 E2E 통과했다면:

1. Current status 갱신
2. Master Roadmap status 갱신
3. feature SPEC의 implementation status 갱신
4. main merge
5. complete tag

예:

`guild2-complete`

## 28.4 과거 설계를 발견했을 때

새 ChatGPT/Codex가 오래된 문서에서 다른 규칙을 발견하면:

- 자동으로 과거 규칙을 복구하지 않음
- 최신 문서와 비교
- `OBSOLETE` 여부 확인
- 불분명하면 사용자에게 확인

---

# 29. 새 대화에서 바로 사용할 현재 Agenda

현재 기준 다음 대화의 설계 우선순위:

## 1순위
Guild 2 Codex implementation 결과/Preflight 지원.

Guild 2 설계 자체는 대부분 LOCKED.

## 2순위
**Guild 3 Mission 상세 SPEC 확정**

이 문서의 Guild 3 `PENDING DISCUSSION`부터 하나씩 논의.

## 3순위
**Guild 4 Peer Review 상세 SPEC**

## 4순위
**Guild 5 Monthly Closure & Conquest 상세 SPEC**

## 병행
Arcade 별도 대화의 최신 결정을 `ARCADE_SPEC.md`로 통합.

Guild Season 이후에는 Stage 6~18 로드맵을 이 문서 기준으로 계속 진행.

---

# 30. 각 기능 구현의 표준 절차

1. 기획 확정
2. production DB 조사
3. preflight
4. incremental migration
5. ACL/RLS
6. postcheck
7. RPC/types/Zod
8. teacher UI
9. student UI
10. Realtime/cache
11. build
12. E2E
13. docs
14. Git merge/tag

Important:

- SQL Editor는 앱의 teacher JWT session이 아님
- teacher-auth RPC를 SQL Editor postcheck에서 직접 실행하지 않음
- function signature/default 확인
- destructive `CASCADE` 금지
- 과거 snapshots rewrite 금지
- 오류가 UI에서 “무반응”으로 보이지 않게 inline error/loading/success 제공

---

# 31. 현재 알려진 Production Legacy 주의사항

Guild 1 작업에서 실제로 드러난 예:

- `guilds.season_id` mandatory
- `guilds.guild_uid` mandatory
- `guild_uid varchar(20)`
- `guild_members.season_id`
- historical membership을 막던 legacy UNIQUE
- PostgreSQL function default parameter replacement 제약
- SQL Editor auth context 문제

따라서 앞으로도 문서상의 예상 schema보다 **실제 production schema가 우선**.

---

# 32. Security continuity

과거 audit에서 broad GRANT가 개별 REVOKE를 덮는 P0 위험이 발견된 이력이 있다.

특히 internal write/helper:

- `create_transaction`
- `link_student_to_auth_user`
- 기타 asset/achievement/mail helper

등은 browser direct execute 노출 여부를 실제 DB에서 재확인한다.

새 score/GS RPC도:

- PUBLIC / anon revoke
- authenticated에는 intended public RPC만
- fixed search_path
- role check
- classroom check
- target scope validation

---

# 33. 프로젝트 완성 기준

B.R.A.N.D 2.0 COMPLETE는:

- 모든 주요 메뉴 실제 데이터/기능
- 학생/교사 권한
- 안전한 ledger/RPC
- realtime/cache consistency
- Guild season
- Arcade integration
- Market/job
- Achievement/constellation
- Finance
- Attendance/assignment/quest
- Welfare/tax
- Mail/alerts
- Emergency
- BrandVN
- Fragment/constellation buff
- Records/analytics
- Student/admin tools
- Chromebook/mobile usability
- 1.0 final migration
- E2E/security/concurrency
- 운영 매뉴얼/backup/recovery
- cutover

까지 완료된 상태다.

---

# 34. 최종 성공 기준

기술적으로 모든 기능이 작동하는 것만이 목표가 아니다.

최종 성공 기준:

> **학생들이 “그해 우리 반은 특별했다”고 기억하는 것.**

경제, 길드, 게임, 편린, 성좌, 미션, 기록은 모두 이 경험을 만들기 위한 세계의 구성요소다.

---

# 35. 문서 갱신 규칙

이 파일은 고정 문서가 아니다.

다음 이벤트 뒤 갱신:

- 기능 SPEC ACCEPT
- Feature E2E COMPLETE
- 큰 설계 변경
- roadmap priority 변경
- 새로운 콘텐츠 프로젝트 추가
- production legacy 발견
- 새로운 chat session으로 이동하기 직전

파일명은 날짜를 갱신하거나 `MASTER_IMPLEMENTATION_ROADMAP.md` 고정명을 쓰고 Git history로 버전을 관리할 수 있다.

Git을 사용하기 시작했으므로 장기적으로는 고정 파일명:

`docs/MASTER_IMPLEMENTATION_ROADMAP.md`

를 권장한다.

Git commit history가 버전 역할을 하기 때문에 날짜별 파일을 계속 복제할 필요가 없다.

---

# Source basis

이 Master Roadmap은 다음을 통합한다.

- `00_BRAND_완벽이해하기(1).md`
- `BRAND_2.0_전체_기능_구현_청사진_2026-08-06.md`
- 기존 HANDOFF / ARCHITECTURE / DATABASE / FEATURE_STATUS 계열
- `AGENTS.md`
- `BRAND_CURRENT_STATE_2026-08-12.md`
- `GUILD2_SPEC.md`
- Guild 1 실제 E2E 결과
- 2026-08-11~12 Guild 2~5 설계 합의
- 병행 Arcade 프로젝트의 현재 확정 integration 규칙

과거 청사진의 status는 그대로 복사하지 않고,
2026-08-12 실제 구현 상태와 최신 사용자 결정을 기준으로 갱신했다.

---

**END OF MASTER ROADMAP**
