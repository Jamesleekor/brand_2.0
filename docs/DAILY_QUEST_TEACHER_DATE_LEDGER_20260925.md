# B.R.A.N.D 2.0 — 일일퀘스트 일자별 정산 / Legacy Archive

적용일: 2026-09-25 KST

## 구현 범위

- 교사 운영 패널 `일일퀘스트 정산`을 날짜 중심으로 탐색
- 이전일 / 다음일 이동 + 날짜 직접 선택
- 오늘 정산표가 없을 때 교사가 명시적으로 `이 날짜 정산표 생성`
- 일일퀘스트 관리자 학생이 없거나 부재해도 교사 생성 가능
- 생성만으로 보상 지급 없음
- 기존 DRAFT / RETURNED / SUBMITTED / SETTLED 정산 흐름 유지
- 2026-08-29 이전 legacy 일일퀘스트 지급 기록을 같은 화면에서 조회
- legacy 자료는 `legacy_asset_history` 기반 읽기 전용
- legacy 자료에는 현재 4종 퀘스트 PASS/FAIL을 추정해서 만들지 않음
- legacy 보상은 이미 지급된 기록이므로 재정산 / 재지급 기능 없음

## 중요한 안전 규칙

1. 새 지급용 정산표는 KST 오늘 날짜에만 생성할 수 있다.
2. 과거 날짜의 현재 1인1역 / 일급을 과거 날짜에 복사하지 않는다.
3. 2026-08-29 이전 legacy RPC는 조회만 하며 transaction / wallet settlement를 호출하지 않는다.
4. 기존 `daily_quest_reports`, `daily_quest_checks`, `daily_quest_completions`, `transactions` 이력은 재작성하지 않는다.
5. 이미 SETTLED 된 현재 시스템 보고서는 기존 idempotency를 그대로 사용한다.

## Production DB 상태

Production Supabase에는 migration `20260924185737_daily_quest_teacher_day_archive`가 이미 적용되어 있다.
로컬 패치에 포함된 migration 파일은 저장소 migration history를 production과 일치시키기 위한 소스 파일이다.

추가 RPC:

- `teacher_get_daily_quest_day_state(date)`
- `teacher_create_daily_quest_report(date)`
- `teacher_get_legacy_daily_quest_archive(date)`

`daily_quest_reports.manager_student_id`는 교사 긴급 생성 원장을 위해 nullable이 되었다.

## Production 검증 완료

- authenticated: 새 교사 RPC EXECUTE 가능
- anon: 새 교사 RPC EXECUTE 불가
- legacy archive 함수에 `create_transaction` 참조 없음
- legacy archive 함수에 wallet 참조 없음
- legacy archive 함수에 `transactions` INSERT 없음
- 2026-03-06 legacy 조회 테스트: 22명 / 22건, read_only=true, rewards_already_applied=true
- 2026-09-25 현재 보고서 존재 확인: 새 생성 가능 상태를 반환하지 않음

## 로컬 적용 후 E2E

1. 교사 운영 패널 > 일일퀘스트 정산 진입
2. 날짜 좌우 이동 / 직접 선택 동작 확인
3. 2026-03-06 선택
   - `Legacy Archive · Read Only` 표시
   - 학생별 BV/GOLD 기록 표시
   - 정산/보상 지급 버튼이 존재하지 않는지 확인
4. 2026-08-28 등 legacy 날짜 선택
   - 같은 읽기 전용 규칙 확인
5. 2026-08-29 이후 이미 정산된 날짜 선택
   - 기존 정산 상세 표시
   - `정산 완료` 상태에서 중복 지급 버튼 없음 확인
6. 오늘 보고서가 존재하는 현재 상태
   - 기존 오늘 보고서가 정상 표시되는지 확인
7. 향후 관리자 부재 등으로 오늘 보고서가 없는 날
   - `이 날짜 정산표 생성` 버튼 표시
   - 생성 후 학생 4종 체크리스트 표시
   - 생성 직후에는 지갑 보상 변화가 없어야 함
   - 모든 미확인 처리 후 최종 승인 때만 지급 발생
8. 관리자 1인1역 자체가 미배정이어도 교사 생성 가능 확인
9. 학생들의 1인1역/일급이 미완성인 경우에는 생성 차단 메시지 확인

## 빌드

AI 작업 환경에서는 저장소 규칙에 따라 npm 설치/빌드를 실행하지 않았다.
로컬 적용 후 사용자가 직접 실행:

`npm run build`

빌드 오류가 있으면 오류 전문을 그대로 전달한다.
