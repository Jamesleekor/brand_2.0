# Feature 4 오류 위치 찾기

오류가 생기면 **화면 문구를 고치려고 먼저 코드를 건드리지 말고 오류 앞의 영역 코드부터 확인**합니다.

| 코드 | 영역 | 우선 확인 파일 |
|---|---|---|
| F4A | 우편·알림·활동 피드 | `20260807_02a_feature4_communications.sql`, `CommunicationPage.tsx`, `CommunicationAdmin.tsx` |
| F4B | 비상사태·수호대·돌발퀘스트 | `20260807_02b_feature4_operations.sql`, `OperationsAdmin.tsx`, `DashboardPage.tsx` |
| F4C | 출석·과제 | `20260807_02c_feature4_learning.sql`, `LearningAdmin.tsx`, `AssignmentsPage.tsx` |
| F4D | 기록·랭킹·분석 | `20260807_02d_feature4_records.sql`, `RecordsPage.tsx`, `RecordsAdmin.tsx`, `AnalyticsPage.tsx` |

## 오류를 보고할 때 같이 보내면 가장 빠른 정보

1. 화면에 나온 `[F4X:operation]` 전체 문구
2. F12 → Network의 실패 요청 이름과 HTTP 상태
3. Response의 `code`, `message`, `details`, `hint`
4. 문제가 난 계정이 학생/교사 중 무엇인지
5. 직전에 누른 버튼

`feature4_rpc.ts`와 `feature4_debug.ts`가 이 정보를 Console에도 구조화해서 남깁니다.

## DB migration 중 실패

Bundle은 A → B → C → D 순서이고 각 모듈이 별도 COMMIT입니다.

예를 들어 `[F4C]`에서 멈추면:
- F4A: 이미 적용됨
- F4B: 이미 적용됨
- F4C: 실패한 현재 모듈
- F4D: 아직 미실행

따라서 전체 스키마나 Feature1~3을 다시 실행하지 않습니다. 원인을 수정한 뒤 **C 개별 파일**, 그 뒤 **D 개별 파일**만 실행합니다.

## 빠른 진단

교사 → 기록실 운영 → `Feature4 진단 실행`.

- boolean ❌: 실제 설치/권한/Realtime 문제 가능성
- count=0: 단순히 데이터가 아직 없는 것일 수 있음
- 원본 JSON은 그대로 복사해서 오류 보고용으로 사용 가능

## 데이터 손상 위험이 있는 테스트

- 돌발 퀘스트 보상
- 출석 보상/출석 정정
- 과제 제출 GOLD/만점 BV

이 세 영역은 **1 GOLD/BV 또는 소액 테스트**로 시작합니다. 정정 실패 시 일부만 되돌아가지 않도록 DB 트랜잭션으로 묶여 있습니다.
