# B.R.A.N.D 2.0 — Feature 4.1.1 안정화 보정

기준: `brand_app_feature4_1_stabilized_buildfix`
작성일: 2026-08-08

## 이번 보정의 목적

실제 교사/학생 E2E 검증에서 발견된 UI·Realtime·fault isolation·경매 UX 회귀 문제를 한 묶음으로 수정합니다.

## 반영 사항

### 학생 홈
- 티어 / 업적도감 / 신용등급 카드를 우측 세로 레일로 이동.
- 카드 제목, 업적 달성 숫자, 신용등급/점수 폰트 확대.
- 홈 업적 카드의 `에픽 · 히든` 소형 문구 제거.
- 업적 페이지 상단에 `희귀 / 유니크 / 에픽 / 히든 / 유일 / 초월` 달성 수 표시.
- 히든 등급 글자색을 밝게 수정.
- 비상사태 배너를 어두운 배경 + 흰색 본문 + 경고색 종료시각으로 변경.

### 교사 운영 UI
- `TeacherShell` 안의 저대비 `text-text-muted/secondary/faded`를 밝은 색으로 상향.
- 공통 `input-field` 가독성 개선.

### 경제 운영
- 학생 카드 메인을 `이름 (브랜드명)`으로 변경, 티어는 보조 문구로 축소.
- 학생 목록 3열, 거래 취소/정정 목록 2열.
- `BV + 골드` 동시 지급 모드 추가.
- 동시 지급은 브라우저에서 RPC를 두 번 부르는 방식이 아니라 `teacher_grant_student_assets_combined()` 한 DB 함수 안에서 원자적으로 처리.

### 소통
- 우편 대상 목록에 학생 실명 표시, 브랜드명은 보조 표시.
- 최근 우편에도 `이름 (브랜드명)` 표시.
- 교사 화면 우편/알림 Realtime 갱신 추가.

### 이벤트 F4B
- `emergency_quest_requests` 실패가 비상사태/학생목록/수호대까지 같이 비우지 않도록 쿼리 fault-domain 분리.
- 비상사태, 돌발퀘스트, 수호대, 완료요청 Realtime 채널을 각각 분리.
- 비상사태 최근 기록 표시 및 현재 발동 상태/종료 예정 시각 표시.
- 종료 시각 입력/표시 폰트 확대.
- 돌발퀘스트 GOLD/BV/분 입력·라벨 확대.
- 경제수호대 학생 드롭다운을 독립 쿼리로 분리해 다른 F4B 오류와 격리.

### 출석 F4C
- 날짜 선택 UI 확대.
- 학생 목록 2열.
- 과거 날짜 조회/입력/정정 기능은 Feature 4.1 로직 유지.

### 학생 홈 Realtime
- 하나의 Supabase 채널에 여러 테이블을 묶지 않고 우편/알림/돌발퀘스트/과제/완료요청을 테이블별 채널로 분리.
- 선택 기능 테이블 하나가 schema cache/publication 문제로 실패해도 우편이나 돌발퀘스트 갱신까지 같이 죽지 않도록 수정.

### 학급 운영 비상사태
- `ClassroomControl`이 `emergencies` Realtime을 직접 구독.
- 이벤트 메뉴에서 발동/종료해도 학급 운영 카드가 즉시 동기화.
- 활성 카드에 자동 종료 시각 표시.

### 경매
- 경매 상태 조회 오류를 화면에 명시적으로 표시하고 재시도 버튼 제공.
- 상품 0개 상태에서 `경매 회차 시작` 버튼이 아무 반응 없는 것처럼 보이던 문제 수정.
- 이제 클릭 시 `상품을 먼저 등록`하라는 경고를 표시.
- 경매 Realtime도 테이블별 채널로 격리.

## DB migration

### 가장 안전한 적용 방법 — 현재 사용자의 DB에 권장

현재 실제 오류에 `public.emergency_quest_requests`가 schema cache에 없다고 표시되었으므로, 아래 누적 스크립트 하나를 SQL Editor에서 실행하는 것을 권장합니다.

`supabase/APPLY_FEATURE4_1_1_CUMULATIVE.sql`

이 파일은 순서대로:
1. 기존 Feature 4.1 migration을 다시 적용(대부분 CREATE IF NOT EXISTS / CREATE OR REPLACE 방식)
2. Feature 4.1.1 hotfix 적용
3. Realtime publication 보강
4. `NOTIFY pgrst, 'reload schema'` 실행

이미 Feature 4.1 migration 적용을 확실히 확인한 DB라면 아래 hotfix만 실행할 수 있습니다.

`supabase/migrations/20260808_02_feature4_1_1_ui_realtime_hotfix.sql`

적용 후 읽기 전용 확인:

`supabase/migrations/20260808_02_feature4_1_1_postcheck.sql`

## 진단

기록실의 `Feature4 진단 실행`은 이제 `teacher_feature4_1_1_health_check()`를 호출하며 기존 결과에 `F4.1.1` 블록을 추가합니다.

## 마지막 마이그레이션 이후에만 검증할 항목

다음은 기존 결정대로 최종 1.0 데이터 컷오버 이후 실제 E2E 검증합니다.
- 초인플레이션 실제 상품 가격 반영/복귀
- 고용동결과 실제 1인1역/임금 데이터 연동
