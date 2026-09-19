# Guild 1 복구 지침

## SQL 적용 중 오류가 난 경우
`APPLY_GUILD1_FOUNDATION.sql`은 하나의 `BEGIN ... COMMIT` 트랜잭션이다. 중간 예외가 발생하면 해당 실행의 변경은 롤백된다. 오류 메시지에 표시된 중복 membership 또는 unsupported legacy column을 먼저 확인하고, 원본 데이터를 임의 삭제하지 않은 상태에서 수정 계획을 세운 뒤 다시 실행한다.

## 적용 후 문제가 발견된 경우
Guild 1은 membership history와 세션 snapshot을 보존하기 위해 기존 `guild_members`의 단일 `student_id UNIQUE`를 활성-row partial unique로 전환한다. 적용 후 기존 방식으로 되돌리려고 과거 membership row를 삭제하거나 단일 UNIQUE를 즉시 복원하면 이력이 손실될 수 있다.

따라서 적용 후 복구는 **파괴적 rollback보다 후속 증분 migration**을 원칙으로 한다.

1. 운영 화면에서 추가 쓰기 작업 중지.
2. 문제 시점 직전 Supabase 백업/스냅샷 확보.
3. `guild_membership_events`, `guild_sessions`, `guild_session_participants`의 새 데이터가 존재하는지 확인.
4. 함수/RLS/컬럼 문제는 별도 hotfix migration으로 수정.
5. membership 데이터 자체가 잘못된 경우 행 삭제보다 `left_at`, 보정 event 등 감사 가능한 방식으로 정정.

## 특히 하지 말 것
- `guild_members` 과거 row 일괄 삭제
- 현재 길드원 기준으로 과거 `guild_session_participants` 재생성
- 기존 `guild_session_attendances` 삭제
- 전체 `brand_complete_schema.sql` 재실행
