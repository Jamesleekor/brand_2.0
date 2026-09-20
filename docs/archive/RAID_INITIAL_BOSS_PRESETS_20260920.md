# B.R.A.N.D 2.0 — 초기 4보스 전투 프리셋
## 2026-09-20

## 목적
레이드 운영 패널에서 보스별 공명방벽/기본 공격/공통 기믹/특수 패턴 값을 매번 수동 입력하지 않고, 초기 4종 A-Type 보스를 원클릭 프리셋으로 불러와 초안을 생성한다.

프리셋은 `src/features/teacher/raid/raidBossPresets.ts`를 source of truth로 사용한다.

## 확정 보스
1. WIND — `천공의 지배자, 바엘리온`
2. FIRE — `작열하는 홍염, 이그니스`
3. WATER — `해일의 포식자, 트리톤`
4. DARK — `월식의 심연, 녹스바르`

## 적용 범위
프리셋 선택 시 보스 이름/속성/설명/권장 레이드 제목을 폼에 채운다.

폼 저장 시 아래 V1.5 전투 설정을 함께 저장한다.
- 공명방벽 기본 설정
- 보스 기본 공격 이름/간격/예고/방벽 피해
- WEAK_POINT / BREAK / ENRAGE 공통 기믹 초안
- 보스별 특수 패턴 2~3종

자동으로 덮어쓰지 않는 항목:
- Boss max HP
- damage coefficient / crit / tap rate
- reward
- boss image URL
- loop video URL

이 값들은 실제 학급 DPS와 자산 URL에 의존하므로 기존값을 보존한다.

## Boss 1 — 천공의 지배자, 바엘리온
공통:
- 폭풍핵 노출 — WEAK_POINT
- 창공 압쇄 — BREAK → GROGGY
- 천공의 격노 — ENRAGE (HP 20%)

특수:
- 황금풍 흡수 — ABSORB
- 천공멸절 — ULTIMATE

기본 공격:
- 황금 돌풍 / 14초 / 방벽 3.5%

## Boss 2 — 작열하는 홍염, 이그니스
공통:
- 홍염핵 노출 — WEAK_POINT
- 대지 작열 — BREAK → GROGGY
- 진홍 광폭화 — ENRAGE (HP 20%)

특수:
- 작열의 낙인 — DOT + 파괴 가능한 작열핵
- 태양핵 폭주 — DAMAGE_CHECK

기본 공격:
- 홍염 충격파 / 12초 / 방벽 4.0%

## Boss 3 — 해일의 포식자, 트리톤
공통:
- 심해핵 노출 — WEAK_POINT
- 심해 압쇄 — BREAK → GROGGY
- 대해의 격류 — ENRAGE (HP 20%)

특수:
- 해류 장막 — SHIELD
- 쌍류 공명 — SPLIT_TARGET (좌/우 해류핵 균형 공격)

기본 공격:
- 해일 충돌 / 15초 / 방벽 3.5%

## Boss 4 — 월식의 심연, 녹스바르
공통:
- 월식핵 노출 — WEAK_POINT
- 공허 압쇄 — BREAK → GROGGY
- 심연 개방 — ENRAGE (HP 18%)

특수:
- 심연 역류 — REFLECT
- 삼중 월식핵 — MULTI_CORE (고정 순서)
- 월식 종언 — ULTIMATE

기본 공격:
- 심연 파동 / 13초 / 방벽 4.0%

`월식 종언`은 이후 Signature Moment 실험과 연결하기 좋은 후보로 남긴다.

## 운영 UI
`레이드 통제실 → 보스 및 전투 설정` 상단에 `초기 4보스 전투 프리셋` 카드가 추가된다.

- 신규 Raid: 프리셋 선택 → `초안 생성` 시 V1.5 config/pattern 자동 저장
- 기존 DRAFT/LOBBY_OPEN: 프리셋 선택 → `설정 저장` 시 기존 V1.5 pattern 목록을 프리셋으로 교체
- 이미지/영상/HP/보상은 보존
- 프리셋 선택 시 environment / camera / idle loop 연출 가이드도 함께 표시

## 검증
- Production의 `teacher_save_raid_combat_config(bigint,jsonb)` 실제 정의 확인
- Production `raid_advance_patterns(bigint)` / `raid_e3_build_targets(...)` 실제 정의 확인
- MULTI_CORE / SPLIT_TARGET / DOT target JSON은 현재 Production runtime이 사용하는 `key,label,x,y,width,height,hp_ratio` 구조에 맞춤
- npm install / npm run build는 프로젝트 운영 규칙에 따라 실행하지 않음
- 변경 TS/TSX는 TypeScript `transpileModule` 구문 검사 통과

## 밸런스 주의
수치는 첫 실전용 최종 밸런스가 아니라 초기 프리셋이다. 각 Raid 종료 후 Balance Lab의 실제 참여자 DPS, Break 성공률, Barrier 소진율을 보고 2차 조정한다.
