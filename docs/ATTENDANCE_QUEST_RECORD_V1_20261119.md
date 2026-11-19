# 출석 · 일일퀘스트 기록 창 V1 — 구현 기록 (2026-11-19)

기준 명세: `docs/BRAND_ATTENDANCE_DAILY_QUEST_SPEC_v1.3_20261118.md`

## 1. 무엇이 바뀌었나

홈의 출석현황 버튼으로 여는 창이 `출석 · 일일퀘스트 기록` 창으로 확장됐다. 학생은 달력이나 주간표에서 날짜를 골라 그날의 미달 항목과 그 주 전체 상태를 확인한다. 읽기 전용이다.

- 위: 현재 연속 출석 / 선택 주 전체 완료 / 선택 주 퀘스트 요약 카드
- 왼쪽(모바일은 위): 월간 달력 (`4/4`, `n/4`, `대기`, `미확정`, `예정`, `—`, `확인`)
- 오른쪽(모바일은 아래): 선택 주 월~금 6열 표, 선택일 상세, LIFE-002 「퀘스트 마스터」 안내
- 아래 접이식: 출석 마일스톤 · 이번 달 출석 보상(기존 화면 그대로)

## 2. 운영 DB (적용 완료)

migration `attendance_quest_record_calendar_20261119` (저장소 파일: `supabase/migrations/20261119_01_attendance_quest_record_calendar.sql`)

| 객체 | 내용 |
|---|---|
| `classroom_closures` | 휴업일 표. 시드 5건(9/24~25 추석, 10/5, 10/9, 12/25, 1/1). RLS ON, 학생 직접 접근 없음 |
| `legacy_daily_quest_results` | 8/24~9/1 4종 결과 672행(FAIL 46). 담임 제공 명단. RLS ON, 학생 직접 접근 없음 |
| `_is_school_day(int, date)` | 운영일 공통 판단. 내부 전용(authenticated EXECUTE 없음) |
| `student_get_my_attendance_quest_calendar(date)` | 학생 본인 월 단위 조회. SECURITY DEFINER, authenticated만 EXECUTE |

기존 테이블·함수·이력에는 쓰기가 없다. 기존 `student_get_attendance_dashboard`는 그대로이며, 연속 출석·마일스톤·이번 달 보상은 계속 이 함수가 담당한다.

### 적용 후 검증 (2026-11-19, 실제 운영 데이터)

- 재학생 23명 × 8~11월 = 92회 호출(학생 로그인 흉내, 트랜잭션 롤백)
- 주간 합계 불변식(확정+확정 전+예정+휴업+확인 필요=5, 완료+미달=확정) 위반 0건
- `확인 필요` 날짜 0일 (휴업일 시드가 9/24·10/5·10/9를 모두 덮음)
- 9/25 추석 자동 DRAFT 원장 → `휴업`으로 표시
- 출결 행이 없는 정산일 7일(9/2, 9/18, 9/21, 9/22, 9/23, 9/29, 9/30) → `출석 인정 (일일퀘스트 기준)` 표시
- 8/28 한서현 `3/4`(준비물 미달), 8/26 한서현 `2/4`
- 11/19(오늘, 원장 미정산) `대기`, 11/20 `예정`, 11/21 `—`
- LIFE-002 공개·보유 판정, 범위 밖 월 요청 시 현재 월로 제한

## 3. 프론트엔드 파일

| 파일 | 내용 |
|---|---|
| `src/lib/rpc/attendance_quest_rpc.ts` | 신규. 응답 Zod 스키마, 주간 합계 불변식 검사, 조회 래퍼 |
| `src/features/attendance/attendanceQuestDates.ts` | 신규. 연도 포함 날짜 계산, 월/주 이동 규칙(preferredDay, 오늘·범위 제한) |
| `src/features/attendance/attendanceQuestModel.ts` | 신규. 서버 상태 → 화면 문구·색상 |
| `src/features/attendance/AttendanceQuestSummary.tsx` | 신규. 요약 카드 |
| `src/features/attendance/AttendanceQuestCalendar.tsx` | 신규. 달력·범례·이동 버튼 |
| `src/features/attendance/AttendanceQuestWeekTable.tsx` | 신규. 6열 고정표·주간 분포 |
| `src/features/attendance/AttendanceQuestDayDetail.tsx` | 신규. 선택일 상세 |
| `src/features/attendance/AttendanceQuestAchievementCard.tsx` | 신규. LIFE-002 안내 카드 |
| `src/features/attendance/AttendanceModal.tsx` | 수정. 기록 창 조합. 기존 마일스톤·보상 블록 재사용, 이전 연속출석·달력 블록은 보존(미사용) |
| `src/components/shared/components.tsx` | 수정. 공통 Modal에 opt-in `size="record"`, `bodyClassName`, `accessibleDialog` 추가. 다른 모달의 기본값은 그대로 |

## 4. 남은 확인 (사용자)

1. GitHub Desktop으로 commit·push → GitHub Actions 빌드 성공 확인(타입 오류 포함)
2. 실제 학생 계정으로 창 열기: 크롬북(1366×768, 1366×640), 모바일(360/390px), 중간 화면(768/820px)
3. 달력 날짜·표 머리·표 셀을 눌러 같은 날짜가 선택되는지, 월/주 이동·`오늘` 버튼
4. ESC 닫기, 닫은 뒤 홈 버튼으로 포커스 복귀, Tab 이동이 창 밖으로 나가지 않는지
5. 다른 모달(경매·레이드 등)이 전과 똑같이 보이는지(공통 Modal은 opt-in만 추가)

## 5. 별도 작업으로 남긴 것

- 공식 출결 보정 7일(9/2, 9/18, 9/21, 9/22, 9/23, 9/29, 9/30): 연속·누적 출석, 마일스톤과 얽혀 계획·검증 후 진행
- `school_terms` 2학기 8/24~1/5 수정과 8/24~8/31 업적 35건 학기 정보 보정
- 교사 패널의 휴업일 등록·수정 화면(임시공휴일 대비)
- 다음 학기 조회 범위: RPC 안의 상수 `c_range_start`·`c_range_end`
- 공통 Modal 닫기 버튼(32px)은 모든 모달에 공통이라 이번에 키우지 않음
