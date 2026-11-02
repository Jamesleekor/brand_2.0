# 스타링크(GAME 4) 최신 main 재통합 + 미완료 포함 즉시 강제확정 — PHASE 1~4 보고서

작성 2026-10-30 · 브랜치 `feat/starlink-mainline-integration-20261030` (기준 `origin/main` `87ae9ee`)
선행 문서: `PHASE0_DIFF_AND_SAFETY_REPORT.md` · 규칙 원본: `GAME_04_STARLINK_SPEC_v0.3_FINAL.md`

> 운영 DB 변경·main merge·학생 공개는 **하지 않았다.** 운영 DB에는 SELECT만 실행했다.

## 1. 변경 파일

| 구분 | 파일 | 성격 |
|---|---|---|
| DB | `supabase/migrations/20261030_10_starlink_04_deterministic_engine.sql` | 옛 브랜치 순수 엔진(보드·경로·점수·재생) 그대로 이식. 적용 시 골든 자동검사 |
| DB | `supabase/migrations/20261030_11_starlink_04_run_binding_and_submit.sql` | 새 테이블 4개, PLAYING 시드 바인딩 트리거, A/B/C 시드팩, 시작/제출 RPC |
| DB | `supabase/migrations/20261030_12_starlink_04_preregistration_hidden.sql` | 숨김 등록(`available_from=2099-12-31`), 재실행해도 비활성화 안 됨 |
| DB | `supabase/migrations/20261030_13_arcade_period_force_finalize.sql` | 기간 강제확정 미리보기/실행 + Guild5 버튼 함수 위임 |
| 운영 절차 | `supabase/PREFLIGHT_…`, `POSTCHECK_…`, `ROLLBACK_…`, `ACTIVATE_STARLINK_04_PUBLIC.sql` | 적용 전·후 점검, 되돌리기, 공개 |
| 엔진 | `src/features/arcade/arcade_rng.ts`, `games/starlink_04/*.ts` | 옛 브랜치 이식(규칙서 대조 완료) |
| 신규 | `games/starlink_04/starlinkPointer.ts`, `starlinkInputRecorder.ts` | 수학적 셀 판정·보간, 서버와 같은 규칙으로만 기록 |
| 신규 UI | `games/starlink_04/ui/StarlinkGame.tsx`, `ui/starlinkRenderer.ts` | 캔버스 성좌판, HUD, 결과, 재제출 |
| 신규 UI | `src/features/arcade/TeacherArcadeForceFinalizePanel.tsx` | 교사 "미완료 포함 즉시 확정" |
| 수정 | `ArcadePage.tsx` (+25/−5줄) | 스타링크는 서버가 허용할 때만 목록에 표시 |
| 수정 | `TeacherArcadeLegacyPage.tsx` (+4/−2줄) | 패널 삽입, 교사 게임 선택에 스타링크 추가 |
| 수정 | `RecordsArcadePanel.tsx` | 공개일 전 게임 탭 숨김, 스타링크 이름 |
| 추가 | `arcade_rpc.ts`, `arcade_schemas.ts` | 스타링크·강제확정 RPC/Zod만 추가(기존 항목 무변경) |
| 테스트 | `games/starlink_04/tests/*`, `supabase/tests/starlink_04_*`, `supabase/tests/replica/*`, `tools/starlink-browser-harness/*` | 아래 §3 |
| 기타 | `package.json` `test:starlink`, `.gitignore` | |

## 2. 설계 핵심

- **공용 Arcade RPC는 하나도 바꾸지 않았다.** 옛 브랜치는 기존 함수 11개를 덮어썼지만, 여기서는 스타링크 run이 `PLAYING`으로 바뀌는 순간 트리거가 숨겨진 `gameplay_seed`+`run_nonce`를 별도 테이블에 묶는다. 기존 `schedule_seed`(카운트다운 중 노출됨)는 스타링크 게임판에 쓰지 않는다 → 카운트다운 중 보드 미리보기 불가.
- **인증 A/B/C 시드팩:** 기간당 1개, SOFT 사전검사(최대 덩어리 ≤8)·서로 다른 시드/보드, 첫 인증 PLAYING에 LOCK. 학생별 순서는 서버 난수로 1회 생성 후 불변(세션 RESET 후에도 재추첨 불가). 기술 취소 후 재도전은 같은 기회 번호 → **같은 시드, 새 run/nonce.** 슈퍼유저로도 수정·삭제 불가(트리거).
- **제출:** 서버가 시드+입력 이벤트를 재생해 점수·통계를 계산. nonce 위조는 run을 건드리지 않고 거절, 같은 내용 재제출은 같은 결과(멱등), 다른 내용 재제출은 거절, 실제 경과 시간이 게임 종료(60초+재배치 정지)보다 이르면 거절.
- **강제확정(새 함수 `teacher_force_finalize_arcade_period`)**: 한 트랜잭션. 학생과 같은 잠금 순서(run→세션→라카루카→기간)로 교착 방지.
  1) 진행 중 인증 플레이 → 기술 취소(기회 미차감) 2) **이미 인증에 성공한 학생은 정상 판정**(동결 기록과 인증 최고점 중 높은 점수), 일반 기록 없이 유효 인증 기록이 있는 학생은 그 점수 채택 3) 정말 미완료인 보상권 학생 → 기존 운영 정책대로 동결 기록 채택 4) 라카루카 미완주 공인도전 → `CANCELLED`(이번 달 라카루카 공식 순위 제외) 5) 기존 월간 스냅샷+Guild 2 함수 호출. 재호출은 `already_finalized`.
  - 기존 Guild5 "현재 기록으로 강제 확정" 버튼 함수는 **이름·입력·반환 키 그대로** 새 함수에 위임 → 더는 멈추지 않는다.
- **숨김 등록이 11월 동결을 막지 않도록:** 운영 동결 함수는 기간에 걸친 게임의 인증 설정이 꺼져 있으면 동결을 거부한다. 그래서 "비활성+인증 OFF" 대신 "인증 설정 ON + 공개일 2099-12-31"로 숨긴다. 공개는 날짜 한 줄 변경.

## 3. 테스트 결과 (실행한 것만)

| 테스트 | 결과 | 범위 |
|---|---|---|
| TS 엔진/입력 `test:starlink` (TS 6 strict 컴파일) | **18/18 PASS** | 골든 457·1618, 59,999/60,000ms, 350ms 정지, 판정 영역, 빠른 스와이프, 멀티터치, 302회 봇: 화면 점수=재생 점수 |
| SQL 엔진 골든 3종 | **PASS** | 보드/경로·점수/전체 재생(457·1618·경계) |
| TS ↔ PostgreSQL 재생 대조 | **162/162 일치** | 점수·통계·종료 시각 |
| 격리 복제 DB E2E (실제 JWT 권한) | **67/67 PASS** ×1, 66/66 ×2회 반복 | 아래 |
| 브라우저(Chromium, 실제 `StarlinkGame` + 모의 서버) | **17/17 PASS** | 데스크톱 마우스, Android 크기 터치, 멀티터치, 터치 취소, 보드 밖 release, 스크롤 간섭, 제출 실패→동일 재제출 |
| 사전 점검 SQL을 운영에 실행(SELECT) | **15/15 OK** | 운영 함수가 오늘 검증한 정의와 동일 |
| 사후 점검·롤백·재적용 (복제본) | POSTCHECK 10/10, 롤백 후 Guild5 원본 md5 일치, 재적용 OK | |

E2E 주요 항목: 숨김 상태 학생 시작 차단·사전테스트 허용 / 10월 운영 상태 재현(인증 세션 18·진행 중 1·라카루카 1)에서 **기존 함수 P0268로 멈춤 재현 → 새 함수로 즉시 확정**, 미리보기 Top10 = 실제 스냅샷, Guild2 1회 호출, 다른 기간 불변, 확정 후 수정 불가 / 학생 보안(타인 run, 테이블·내부함수 직접 접근, nonce 위조, 조기 제출, 불가능 입력, 5,000개 초과) / 24명 동시 인증 시작·21명 동시 제출(교착 0, 중복 캡처 0) / 시드팩 단일·LOCK·불변·순서 무작위 / 기술 복구 같은 시드 / **교사 확정과 학생 제출 경쟁: 확정 전 도착 1명 반영, 이후 2명 거절, 교착 0** / 공식 기록·통계 동일 run 묶음 / 인증 성공자의 높은 점수 보존 / GAME2 수명주기 불변 / **24명 실시간(실제 5초+60초) 동시 플레이 전원 검증**.

재현: `supabase/tests/replica/build.sh` + `python3 supabase/tests/starlink_04_replica_e2e.py` (로컬 PostgreSQL, 운영과 무관).

## 4. 아직 검증되지 않은 것 (출시 전 필수)

1. **사용자 PC `npm run build`, `npm run test:tikatuka`, `npm run test:starlink`** — 저장소 규칙상 AI는 npm 설치/빌드를 하지 않는다. React 타입 검사는 부분 대체 선언으로만 했다.
2. **실기기:** 학교 크롬북(4GB)·Android 크롬 실제 손가락 입력, 프레임 유지, 화면 회전. (브라우저 검사는 데스크톱 Chromium의 터치 에뮬레이션)
3. **운영 Supabase 실제 PostgREST 경유 호출**(복제본은 같은 SQL·권한 계약이지만 PostgREST 자체는 거치지 않음), Guild2 실제 재계산(복제본은 호출 여부만 확인).
4. 강제확정 UI의 실제 교사 계정 클릭 흐름.

## 5. 운영 반영 순서 (사용자 승인 후)

1. 학생 플레이가 없는 시간에 `PREFLIGHT_STARLINK_04_MAINLINE_20261030.sql` → 모두 OK, 지문 저장.
2. SQL Editor에서 `20261030_10` → `_11` → `_12` → `_13` 순서로 실행(각 파일 자체 트랜잭션, 실패 시 자동 취소).
3. `POSTCHECK_…` → 모두 OK + 지문이 1번과 동일한지 확인.
4. 브랜치 → main 반영(GitHub Actions 배포). 스타링크는 숨김이라 학생 화면 변화 없음, 교사 화면에 강제확정 패널 추가.
5. 10월 확정: 교사 화면 "미완료 포함 즉시 확정" → 미리보기 확인 → 확정 (또는 Guild5 버튼). **실제 기간 확정은 별도 승인 사항.**
6. 사전 테스트: 기존 사전테스트 권한으로 테스트 학생에게만 스타링크 허용 → 실기기 점검.
7. 승인 시 `ACTIVATE_STARLINK_04_PUBLIC.sql`로 공개일 지정(권장 11월 1일).
8. 문제 시: 즉시 숨김(`available_from=2099-12-31`) → 필요하면 `ROLLBACK_…`(기록 삭제 없음).
