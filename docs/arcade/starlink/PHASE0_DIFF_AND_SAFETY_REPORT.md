# PHASE 0 — 스타링크(GAME 4) 재통합 차이·안전 보고서

작성: 2026-10-30 16:30 KST · 작성자: Claude · 브랜치 `feat/starlink-mainline-integration-20261030`

## 1. 기준 버전 (실시간 재확인)

| 항목 | 값 |
|---|---|
| `origin/main` HEAD | `87ae9ee54bf320e67e41e55974a206fa2c5bf5b1` (2026-10-30 15:53 KST, 인수인계서의 `86ae171`보다 최신) |
| 옛 스타링크 브랜치 | `starlink-step2a-core-schema` @ `c8fe5f902bf1efc52f101deba0bea22b2f450707` (변동 없음) |
| 운영 DB | `tnsmjyzbjgfepubxvstw` PostgreSQL 17.6 |
| 작업 방식 | 최신 main에서 새 브랜치 + 파일 단위 선별 이식. 옛 브랜치 merge 없음 |

## 2. 운영 DB 읽기 전용 스냅샷 (2026-10-30 16:26 KST, SELECT만 실행)

| 항목 | 값 |
|---|---|
| `arcade_games` | `focus_reaction_01`(id 1), `pure_reaction_02`(id 7) — 스타링크 행 없음 |
| GAME1 run / VERIFIED / 점수합 | 2,358 / 2,220 / 55,072,129 (max id 4550) |
| GAME2 run / VERIFIED / 점수합 | 2,136 / 891 / 9,297,675 (max id 4527) |
| 공인 결과(`arcade_verification_official_results`) | 147건, md5 `00965e5f5726129141d7d1776302fadb` |
| 월간 스냅샷 entries md5 | `6bdf58a5d915b4c8a927e273cc236884`, finalizations 2건 |
| 10월 기간 id 37 | `VERIFICATION` |
| 10월 인증 세션 | ACTIVE 18 / COMPLETED 27 / RESET 24 / OVERRIDDEN 3 |
| 10월 인증 시도 | TERMINAL(소모) 88 / TECHNICAL_CANCELLED 6 / **ISSUED(진행 중) 1** |
| 10월 게임별 인증 마감 | GAME1 미마감 / GAME2 마감 |
| 10월 라카루카 공인 세션 | **ACTIVE 1** |
| 라카루카 COMPLETED 게임 / 세션 md5 | 211 / `51ec2021a5d4a3ff1f6c761fa76f5934` |

이 지문은 PHASE 4 직전·직후 재조회해 "기존 기록 불변"을 증명하는 기준값으로 쓴다.

## 3. 핵심 발견

1. **인수인계서와 다른 점:** 운영에는 월 단위 강제확정 함수 `teacher_force_finalize_arcade_month_for_guild5(p_year_month, p_reason)`가 이미 있다. 그러나 진행 중 인증 run(READY~SUBMITTING)이나 ACTIVE 라카루카 공인도전이 하나라도 있으면 `P0268` / `PTK50` 예외로 **막힌다.** 10월 현재 둘 다 존재하므로 지금 이 함수로는 확정이 불가능하다. → 사용자가 겪은 "미완료 학생 때문에 확정 불가"의 직접 원인.
2. 게임별 강제마감 `teacher_force_close_arcade_game_verification`은 이미 "진행 중 run → `EXPIRED` + 시도 `TECHNICAL_CANCELLED`(미소모), 보상권 미확정자 → 동결 잠정기록을 `MANUAL_SOURCE`로 채택" 정책을 갖고 있다. **새 기간 강제확정은 이 운영 정책을 그대로 재사용한다.**
3. **동결 호환성 위험:** `teacher_freeze_arcade_monthly_period`는 `available_from`이 기간과 겹치는 모든 게임(활성 여부 무관)에 인증 설정이 켜져 있지 않으면 `P0260`으로 동결을 거부한다. 옛 브랜치처럼 "is_active=false + 인증 OFF"로 사전 등록하면 11월 동결이 막힌다. → 사전 등록 시 `available_from`을 공개 예정일(미래)로 두고, 사전 테스트는 기존 `arcade_prerelease_test_access` 체계를 쓴다.
4. `student_create_arcade_run`/`student_begin_arcade_run`은 카운트다운 시작 시점에 `schedule_seed`를 응답한다. 인증 시드는 run마다 무작위다. → 공용 함수를 고치지 않고, **스타링크 run이 PLAYING으로 바뀌는 순간 트리거로 실제 게임 시드(A/B/C 또는 일반 무작위)와 nonce를 별도 테이블에 바인딩**한다. 학생에게는 PLAYING 이후에만 공개.
5. `arcade_runs`에 `run_nonce` 컬럼이 없다. 기존 테이블 변경 없이 스타링크 전용 바인딩 테이블로 해결한다.
6. 운영 함수 ACL은 내부 헬퍼를 `postgres` 전용으로 잠가 두었다. 새 함수도 `REVOKE ALL ... FROM PUBLIC, anon, authenticated` 후 필요한 RPC만 `authenticated`에 GRANT한다.
7. 운영 함수 상당수가 저장소 migration 파일과 다르다(운영 hotfix, Windows CRLF). 저장소만 보고 운영을 추정하면 안 된다(AGENTS.md §4 확인).

## 4. 격리 복제 DB (테스트 기반)

- 로컬 PostgreSQL 16에 `arcade_*`, `tikatuka_*` 26개 테이블을 **운영 DDL 그대로** 생성.
- 함수 78개: 저장소 소스 중 운영과 md5가 일치하는 것 63개 + 운영에서 읽어 온 정의 15개.
- 검증: CR 제거 지문 기준 **74개 운영과 바이트 동일**, 4개(`current_classroom_id`, `current_student_id`, `is_teacher_or_admin`, guild5 강제확정)는 공백·서식 차이만 있고 논리 동일(직접 대조).
- 운영 트리거 27개, RLS·테이블 GRANT, 함수 ACL을 운영과 동일하게 재현.
- Supabase `auth.uid()`는 `request.jwt.claim.sub`로 재현(실제 PostgREST와 같은 계약).
- **스텁:** `guild2_refresh_monthly_scores`(호출 여부만 기록). Guild2 계산 자체는 기존 월간 확정 경로와 동일하게 호출되며 이번 작업에서 수정하지 않는다.

## 5. 옛 브랜치에서 이식할 것 / 하지 않을 것

| 대상 | 판단 |
|---|---|
| `arcade_rng.ts`, `games/starlink_04/*` 순수 엔진 + 테스트 | 이식 (규칙서 v0.3과 대조 완료) |
| SQL 엔진 05·06·07 (보드·경로·점수·재생) | 이식 (순수 함수, `arcade_xorshift32_next`만 의존, 적용 시 내장 golden 검사) |
| `20261011_01` 코어 스키마 | 사용 안 함 → 기존 테이블 변경 없는 새 스키마로 재설계 |
| `20261011_02` 기존 RPC 11개 덮어쓰기 | **사용 안 함** (공용 함수 무변경 원칙) |
| `20261011_03` 기간 강제확정 | 참고만, 현재 운영 함수 기반으로 재작성 |
| `20261011_04` 사전 등록 | 사용 안 함 → 동결 호환 방식(미래 `available_from`)으로 재작성 |
| `20261012_02` 제출 RPC | 사용 안 함 → 현행 run/attempt 구조에 맞춰 재작성 |
| `StarlinkGame.tsx` | 참고 후 재작성 (규칙서의 터치·시각 요구 미충족) |

## 6. 기능별 영향표

| 영역 | 변경 | 영향 |
|---|---|---|
| GAME1·2 제출/인증 | 없음 (공용 함수 무변경) | 트리거는 스타링크 game_id에만 동작 |
| 교사 패널 | 기간 강제확정 미리보기/실행 섹션 추가 | 기존 게임별 마감·정정·복구 UI 유지 |
| 월간 스냅샷 | 기존 `teacher_finalize_arcade_monthly_snapshot`을 그대로 호출 | 스냅샷 형식 불변 |
| Guild2 | 기존 함수가 기존 방식대로 호출 | 수정 없음 |
| 라카루카 | 강제확정 시 진행 중 공인 세션만 `CANCELLED`(기존 CHECK가 허용하는 상태) | 완료된 기록·스냅샷 불변 |
| 10월 기간 | 이번 작업에서 운영 변경 없음 | 사용자가 승인하면 새 강제확정으로 즉시 확정 가능 |
