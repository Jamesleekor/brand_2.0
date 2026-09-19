# B.R.A.N.D 2.0 Arcade 기록 인증 구현 기준

작성일: 2026-09-06

**현재 상태:** 사용자 로컬 `npm run build` 성공 확인. production PREFLIGHT 통과 후 Arcade 기록 인증 main migration과 FK index follow-up migration을 Supabase production에 적용했고, 독립 POSTCHECK 및 advisor 점검까지 완료했다. 현재 2026년 9월 월간 기간은 기존대로 `ACTIVE`이며 기존 Arcade run은 전부 `STANDARD`로 유지되어 migration 적용만으로 현재 랭킹/기록 데이터가 변경되지 않았다. 프런트엔드 production 배포와 실제 교사/학생 인증 E2E는 아직 남아 있으므로 전체 기능을 100% 완료로 판정하지 않는다.

## 최종 운영 정책

현재 구현은 `BRAND_2.0_아케이드_인증시스템_Spec_v2.0`의 공통 인증 흐름을 기반으로 하되, 이후 사용자 확정으로 아래 한 항목을 명시적으로 수정한다.

### Guild 2 Arcade bonus CAP

**월간 학생 1인당 Arcade 기여도 적용 보너스는 최대 +90이다.**

- 게임별 raw bonus: 1위 +30 / 2위 +27 / 3위 +24 / 4~6위 +18 / 7~10위 +15
- 여러 게임 raw bonus는 모두 합산하여 `arcade_raw_total`에 보존
- 실제 기여도 적용값: `arcade_applied = min(arcade_raw_total, 90)`
- 개인 기여도 최종 최대값: 990
- 예: 4개 게임 모두 1위 -> raw +120, 실제 적용 +90

이 CAP은 Arcade가 학생에게 과도한 경쟁·반복 플레이 부담이 되지 않도록 하기 위한 교육적 안전장치다.

따라서 기존 spec v2.0의 "여러 게임 합산에 별도 +90 cap 없음" 문구는 **구현 기준에서 폐기**한다.

## 이번 구현 범위

- 공통 verification framework
- MONTHLY lifecycle: `ACTIVE -> VERIFICATION -> READY_TO_FINALIZE -> FINALIZED`
- freeze 시 학생별 provisional best source 고정
- freeze 시 eligible game + verification config 고정
- current reward range Top10 인증
- default threshold 80%, max 3 consumed attempts
- 기술 취소/invalid attempt 복구/audit
- success / failure-valid / failure-no-valid 공식 source 결정
- official override 기반 재순위화
- 새 Top10 승격 학생 반복 인증
- Game #01 기존 authoritative validator 재사용
- verification run의 일반 PB/통계/다음 기간 랭킹 오염 방지
- 기존 immutable monthly snapshot + Guild 2 finalization 재사용
- TEST fixture reset 호환

## Game #05

현재 production registry에는 Game #01만 존재한다. Game #05 Pure Reaction은 게임 자체 및 authoritative validator가 production에 추가된 뒤 같은 framework에 연결한다.

새 게임이 월간 eligible game이 되었지만 `arcade_verification_game_configs`에 enabled config가 없다면 월간 freeze는 실패하도록 설계한다. 이는 validator 연결 누락 상태로 보상을 확정하는 것을 방지하기 위한 fail-closed 정책이다.

## 변경하지 않는 것

- 과거 FINALIZED snapshot
- Guild 2 +90 CAP / 최종 990 계약
- SEASON leaderboard lifecycle
- 일반 Game #01 validator의 점수 계산 방식
- 기존 사전 테스트 기록 정책

## 적용 및 검증 현황

### 완료

1. 사용자 로컬 `npm run build` — **PASS**
2. production PREFLIGHT — **PASS (모든 problem_count = 0)**
3. main migration — **적용 완료**
   - repository: `supabase/migrations/20260906_16_arcade_record_verification.sql`
   - production migration history: `20260906133233 arcade_record_verification_v2`
4. 독립 POSTCHECK — **PASS (모든 검사항목 = 0)**
5. Supabase security advisor — **Arcade verification 관련 신규 경고 없음**
   - 기존 프로젝트 공통 Auth 경고인 Leaked Password Protection 비활성화 1건은 이번 기능과 무관
6. performance advisor에서 확인된 verification FK 보조 인덱스 — **보완 완료**
   - repository: `supabase/migrations/20260906_17_arcade_record_verification_fk_indexes.sql`
   - production migration history: `20260906133703 arcade_record_verification_fk_indexes`
   - 메타데이터 재검사: verification FK 중 leading index 누락 **0건**
7. production smoke check — **PASS**
   - 2026년 9월 월간 기간: `ACTIVE` 유지
   - 기존 Arcade run: 전부 `STANDARD`
   - verification run/session/attempt/result/provisional: 아직 운영 데이터 0건
   - Game #01 config: Top10 / 80% / 3회
   - Guild 2 +90 / 최종 990 위반: 0건

> production migration history는 Supabase가 적용 시점 timestamp 버전을 기록하고, repository는 프로젝트 규칙에 따라 `YYYYMMDD_NN` 증분 파일명을 유지한다. 두 migration의 SQL 의미와 적용 순서는 위와 같다.

### 남음

1. 최종 프런트엔드 코드를 기존 production 배포 방식으로 배포
2. `docs/ARCADE_E2E_CHECKLIST.md`에 따라 실제 교사/학생 인증 E2E 수행
3. Game #01 일반 플레이/SEASON/기록실/통계/Guild 2 회귀 확인
4. E2E 통과 후 100% COMPLETE 판정

- eligible game의 마지막 날짜는 `ends_at_exclusive - 1 microsecond`의 KST 날짜로 계산한다. 따라서 정상 월말(다음 달 00:00)과 `즉시 종료` 모두 같은 규칙으로 정확히 처리된다.
