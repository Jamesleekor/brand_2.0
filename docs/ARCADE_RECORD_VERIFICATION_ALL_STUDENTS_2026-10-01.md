# Arcade 공인 기록 인증 — 전 학생 도전 허용 정책 (2026-10-01)

## 결정

공인 기록 인증의 **도전 자격**과 월간 **보상권(Top 10)** 을 분리한다.

- 공식 참여 학생은 일반 플레이 순위와 관계없이 누구나 공인 기록 인증 도전을 받을 수 있다.
- 일반 플레이 기록이 없는 학생도 인증 세션을 시작할 수 있다.
- 일반 기록이 없는 학생은 기존 기록의 80% 기준을 적용하지 않고, 기본 3회 인증 중 가장 높은 유효 기록을 새 공식 기록으로 사용한다.
- 일반 기록이 있는 학생은 기존 정책대로 일반 최고기록의 인증 기준(현재 80%)을 사용한다.
- 인증 결과는 즉시 현재 공식 순위 재계산에 반영된다.
- Top 10은 인증 자격이 아니라 최종 보상 범위다.

## 최종 확정 조건

모든 학생에게 인증 기회는 열려 있지만 전원 인증을 의무화하지 않는다.

최종 확정은 다음 조건을 만족할 때 가능하다.

1. 현재 공식 순위 Top 10(게임별 설정된 보상권)의 학생은 모두 공인 결과가 있어야 한다.
2. 순위 밖 학생을 포함해 진행 중(`ACTIVE`)인 인증 세션이 없어야 한다.
3. 순위 밖 학생이 인증을 완료해 Top 10에 진입하면 순위를 다시 계산하고 새 Top 10의 미인증 학생을 다시 확인한다.

따라서 교사가 최종 확정을 누르기 전까지 11~24위 학생도 언제든 인증을 시작해 실제 실력으로 Top 10에 진입할 수 있다.

## UI

교사 인증 관리에는 공식 참여 학생 전원을 표시한다.

- Top 10 여부와 관계없이 `인증 시작` 버튼 사용 가능
- 현재 Top 10 밖 학생은 `현재 Top 10 밖 · 인증 가능` 표시
- 일반 기록이 없는 학생은 `일반 기록 없음 / 신규 공인 기록` 표시

학생 인증 화면에서는 `일반 플레이 최고`, `인증 기준`, 남은 기회를 표시한다. 일반 기록이 없는 경우 인증 기준은 `3회 중 최고 기록`으로 안내한다.

## DB 변경

증분 마이그레이션: `supabase/migrations/20261001_01_arcade_verification_all_students.sql`

주요 변경 대상:

- `arcade_verification_sessions`: provisional 관련 필드를 nullable로 허용
- `teacher_get_arcade_verification_overview`: 전 공식 참여 학생 반환
- `teacher_start_arcade_verification_session`: 순위 제한 제거 + 일반 기록 없는 학생 지원
- `student_get_arcade_verification_state`: 순위 기반 `can_attempt` 제한 제거
- `student_create_arcade_verification_run`: Top 10 재검사 제거
- `arcade_finalize_verification_session`: baseline 없는 학생의 인증 최고기록을 공식 기록으로 확정
- `arcade_resolve_period_student_ranks`: verification-only 공식 결과도 순위 후보에 포함
- `arcade_refresh_verification_readiness`: Top 10 인증 + 모든 ACTIVE 세션 종료를 최종 확정 조건으로 사용
