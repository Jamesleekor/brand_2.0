# Arcade 운영 패널 — 기간별 3게임 기록 조회

## 원인과 운영 DB 확인

10월 월간 기간(id 37)은 ACTIVE이며 길드 시즌 4에 정상 연결되어 있다. 점검 시 집중 반응은 VERIFIED 61건(16명), 순수 반응은 VERIFIED 31건(11명)과 REJECTED 56건이다. 일반 감사 RPC는 각각 61행/87행을 정상 반환한다. 통계 v2 역시 월간 기간 37과 현재 순위 27행을 정상 반환한다.

기존 운영 UI에는 사전 테스트만 조회하는 순위 버튼과 기간 종료 후 VERIFICATION/READY_TO_FINALIZE에서만 여는 인증 현황이 있다. ACTIVE 기간의 일반 기록을 세 게임 통합으로 확인하는 조회 화면이 없었다. 사전 테스트 순위가 빈 것은 정상이며 일반 기록 소실이나 기간 연결 실패가 아니다.

라카루카의 10월 일반 완료 경기는 3건(2명)이다. 이번 기간의 공인 5판 세션은 아직 없다. 일반 클리어와 공인 도전 기록은 다른 원장이므로 일반 기록을 공인 점수로 바꾸거나 가상의 공인 순위를 만들지 않는다.

## 변경

- 교사 Arcade 운영 상단에 독립 조회 패널 `TeacherArcadePeriodRecordsPanel`을 추가했다. 사전 테스트 접근 목록 등 기존 운영 조회의 실패가 이 패널을 숨기지 않는다.
- 최신 진행 중 월간 기간을 기본으로 선택하고 종료·인증·확정 기간도 직접 선택할 수 있다. 세 게임은 한번에 조회하고 탭 전환은 추가 요청 없이 처리한다.
- 신규 교사 읽기 RPC `teacher_get_arcade_period_records(bigint)`은 선택한 기간의 24명 × 3게임(72행)을 반환한다. 미참여 학생도 명시적으로 남긴다.
- 반응 게임은 STANDARD 일반 기록만 집계하며 사전 테스트·무효 기록을 제외한다. 기간 내 최고 점수/평균 반응시간과 기존 공식 resolver의 현재 순위를 별도로 표시한다.
- 라카루카 일반 경기 전적·기간 내 클리어와 공인 5판 결과를 분리한다. 공인 세션은 `arcade_period_id`로 연결하며 FINALIZED에서는 기존 불변 Top 10 snapshot을 읽는다.
- 기간 경계는 시작 포함, 종료 제외다. 반응 게임은 기존 감사 조회와 같은 종료/제출/생성 시각 기준, 라카루카 일반은 경기 발급 시각 기준이다.
- 실시간 polling을 추가하지 않았다. 처음 열기·기간 변경·수동 새로고침에 조회하며 운영 상태/인증/무효 처리 후 관련 캐시를 무효화한다.
- 입력과 응답에 Zod 검증, 로딩·오류·미참여 표시를 추가했다.

## DB 적용과 권한

운영 migration `20261009121639_arcade_teacher_period_records` 적용 완료. 동일 SQL은 `supabase/APPLY_ARCADE_PERIOD_RECORDS.sql`과 migration 파일에 보존했다. 기존 기록·인증·보상·기간 상태는 변경하지 않았다. 이미 적용된 운영 DB에서 수동 SQL을 재실행할 필요는 없다.

기존 원장 테이블과 internal resolver에는 클라이언트 직접 접근이 제한되어 있어 기존 teacher RPC 패턴의 SECURITY DEFINER를 사용한다. 고정 search_path, 교사 역할 검증, 호출자 학급과 대상 기간 학급 검증을 적용했다. PUBLIC/anon 실행을 철회하고 authenticated에만 EXECUTE를 허용했다. Advisor의 authenticated definer 경고는 이 의도된 경계에 대한 일반 경고다. 학생 호출과 타 학급 조회가 거절되는 것을 별도로 검증했다. 참고: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

## 검증

- 10월 ACTIVE와 9월 FINALIZED 실제 원장 조회: 각 72행, 게임별 24명. 10월 인정/완료 합계 61/31/3건, 반응 게임 순위 16/11명.
- DB의 실제 교사 사용자 ID를 트랜잭션 범위 JWT claim으로 설정한 통제된 RPC 검사다. 실제 브라우저 로그인 E2E와 구분한다.
- 학생·미인증 호출 P0511 거절, 타 학급 기간 P0205 거절, anon EXECUTE=false, authenticated EXECUTE=true.
- 실제 72행 응답 Zod 검증 통과.
- 기존 설치된 compiler/dependencies를 이용한 전체 TypeScript noEmit 정적 검사 통과. npm 설치/build는 실행하지 않았다.
- 세 게임 각각 서버 렌더에서 학생 24행과 학생 이름 표시, 라카루카 공인 미참여 표시 확인. git diff --check 통과.

## 남은 배포와 실제 로그인 확인

2026-10-09 사용자가 commit/push를 명시 승인했다. 검증된 소스를 main에 반영하고 기존 GitHub Pages 자동 배포로 제공한다. 실제 교사 로그인 E2E는 배포 후 확인 대상이다.

배포 후 교사 로그인으로 Arcade 운영 상단에서 `2026년 10월 Arcade` 기본 선택, 세 게임 탭의 기록, 9월 전환 시 과거 기록, 새로고침을 확인한다. 기간 동결/인증/최종 확정은 조회 확인을 위해 실행할 필요가 없다. 로컬 build가 필요하면 사용자가 `npm run build`를 직접 실행한다.
