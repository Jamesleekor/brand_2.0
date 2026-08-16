# B.R.A.N.D TEST 학급 운영 안내

`B.R.A.N.D TEST`는 실제 학급과 완전히 분리된 반복 검증용 공간입니다. 실제 학생 계정으로 Guild·Mission·Arcade를 시험해 원치 않는 이력이 남는 일을 막기 위해 만들었습니다.

## 무엇이 만들어지나

- TEST 전용 교사 Auth 계정: `brand-test-teacher@<TEST_FIXTURE_EMAIL_DOMAIN>`
- TEST 학생 Auth 계정: `brandtest01`부터 `brandtest05`까지
- `B.R.A.N.D TEST` 학급
- 같은 기준 시즌을 복사한 TEST 전용 Guild season
- `TEST GUILD`
- `TEST01`~`TEST05`의 TEST GUILD 기본 소속

TEST TEACHER는 의도적으로 `students` 행을 갖지 않습니다. 따라서 기존 `current_classroom_id()`와 `get_current_user_context()`가 TEST TEACHER의 유일한 활성 소유 학급인 `B.R.A.N.D TEST`를 자연스럽게 선택합니다. 실제 교사 계정에는 TEST 학급을 추가하지 않습니다.

## 처음 한 번의 적용 순서

1. Supabase SQL Editor에서 [20260815_04_test_classroom_fixture.sql](../supabase/migrations/20260815_04_test_classroom_fixture.sql)을 전체 실행합니다.
2. 마지막에 나오는 `test_classroom_fixture_postcheck`에서 다음을 확인합니다.
   - `fixture_registry_tables_ready: true`
   - `authenticated_reset_execute_granted: true`
   - `authenticated_service_reconcile_execute_denied: true`
   - `fixture_rows_created_by_migration: 0`
3. Supabase Edge Function을 배포합니다.

   ```bash
   supabase secrets set TEST_FIXTURE_EMAIL_DOMAIN=example.com
   supabase functions deploy test-classroom-fixture
   ```

   `example.com`은 실제로 사용할 테스트 메일 도메인으로 바꾸세요. 서비스 역할 키는 Supabase Edge Function 환경에 기본 제공되므로 브라우저 `.env` 파일에 넣지 않습니다.

4. 실제 교사 계정으로 로그인한 뒤 `/teacher/test-fixture`에서 12자 이상의 TEST 전용 비밀번호를 직접 정하고 **TEST 학급 만들기**를 누릅니다.
5. 화면에 표시된 TEST TEACHER/TEST01~05 이메일과 방금 정한 비밀번호를 안전한 곳에 기록합니다.

비밀번호는 화면이나 데이터베이스에 다시 표시하지 않습니다. 잊었으면 같은 페이지에서 새 비밀번호를 입력해 **TEST 계정 비밀번호 모두 바꾸기**를 사용하세요.

## TEST를 실제로 사용하는 방법

1. 실제 교사 계정에서 로그아웃합니다.
2. TEST TEACHER 계정으로 로그인합니다.
3. 교사 운영 패널에서 Guild, Mission, Arcade를 테스트합니다.
4. 학생 동작은 TEST01~05 각각으로 로그인해 확인합니다.
5. 테스트가 끝나면 실제 교사 계정으로 다시 로그인해 `/teacher/test-fixture`의 초기화를 실행합니다.

TEST 학생과 실제 학생은 각자 `students.classroom_id` 및 기존 RLS를 통해 다른 학급 데이터를 읽을 수 없습니다.

## TEST 초기화가 지우는 것

초기화는 서버에서 `test_classroom_fixtures.fixture_code = BRAND_TEST_V1`을 찾고, 그 행의 학급·시즌·길드 관계를 다시 검증한 뒤에만 실행합니다. 브라우저는 학급 ID를 전달하지 않습니다.

- Guild 1의 현재 길드 세션 및 참가자 snapshot
- Guild 2의 관찰 이벤트, 보정 설정, 개인 기여도, GS 원장, 월간 요약
- Guild 3의 미션, 인스턴스, 참여자, 제출, 활동, 평가·판정·감사, 동료평가 공개 기록
- Arcade의 실행 기록, 제출, 무효화, 사전 테스트 허용, 랭킹 기간, 월간 finalization/snapshot/Top 10/전체 순위 snapshot
- TEST01~05의 길드 소속 이력은 TEST 전용이므로 지운 뒤, `TEST GUILD` 기본 소속 5개를 새로 만듭니다.

초기화가 **보존하는 것**:

- TEST TEACHER 및 TEST01~05 Auth 계정
- TEST 학생 행과 Auth 연결
- `B.R.A.N.D TEST` 학급
- TEST season 및 `TEST GUILD`
- 실제 학급, 실제 학생, 실제 Guild/시즌/기록 전체

Guild 1의 legacy 호환 테이블은 현재 앱 흐름이 쓰지 않으며 이 기능도 건드리지 않습니다.

## 필수 E2E 확인

1. 실제 교사 로그인은 기존 실제 학급만 표시한다.
2. TEST TEACHER 로그인은 `B.R.A.N.D TEST`만 표시한다.
3. TEST01 로그인은 `B.R.A.N.D TEST` 소속으로 표시되고, TEST GUILD에 속한다.
4. 실제 학생은 TEST 학급 데이터를 읽지 못한다.
5. TEST01은 실제 학급 데이터를 읽지 못한다.
6. TEST TEACHER로 Guild 세션, Guild 3 미션, Arcade 실행을 각각 하나 이상 만든다.
7. 실제 교사 계정으로 TEST 초기화를 실행한다.
8. TEST 기록은 사라지고 TEST01~05와 TEST GUILD 기본 소속은 남아 있는지 확인한다.
9. 초기화 후 실제 학급의 Guild 2·Guild 3·Arcade 기록이 변하지 않았는지 확인한다.
10. 다시 **TEST 학급 다시 확인**을 눌러 학급·학생·Auth 계정이 중복 생성되지 않는지 확인한다.

## 실제 학급 시즌 전 정리와의 관계

이 TEST 초기화와 실제 학급의 one-time pre-season cleanup은 별개입니다. 실제 학급 cleanup은 되돌릴 수 없는 작업이므로 [PREFLIGHT_REAL_CLASSROOM_PRESEASON_CLEANUP.sql](../supabase/PREFLIGHT_REAL_CLASSROOM_PRESEASON_CLEANUP.sql) 결과를 받은 뒤, 영향 테이블과 보존 항목을 먼저 별도로 보고하고 실행 SQL을 제공합니다.
