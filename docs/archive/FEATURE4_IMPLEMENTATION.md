# Feature 4 구현 내역

## F4A — 소통

- 학생 소식함: 우편 / 전역 알림 / 활동 피드 3탭
- 우편 읽음 처리
- 전역 알림 학생별 읽음 상태 신규 테이블 `global_alert_reads`
- 교사 다중 학생 우편 발송
- 교사 학급 전체 알림 발송
- Realtime 구독
- `send_mail`, `broadcast_global_alert`, `push_activity_feed`는 내부 함수로 다시 잠금

## F4B — 학급 운영

- 기존 비상사태 발동·종료 RPC 교사/학급 검증 하드닝
- 외부 종료는 항상 MANUAL_TERMINATED로 기록
- 만료 자동 종료 processor + pg_cron 시도
- cron 실패 시 대시보드 진입 안전망 RPC
- 돌발 퀘스트 정의·완료 테이블 신설
- 교사 퀘스트 생성/강제종료
- 학생 퀘스트 완료: 중복 방지 + GOLD/BV 원자 지급 + 우편/활동피드
- 경제수호대 임기 등록/종료 + 학생 우편
- 겹치는 임기 차단

## F4C — 출석·과제

- 오늘(KST) 출석 일괄 입력
- 이미 입력한 학생은 명시적 skipped 결과
- 오늘 출석 정정 시 기존 보상과 당일 마일스톤을 역분개한 뒤 재기록
- 과제 생성: 초안/즉시 공개
- 과제 공개·마감·보관 상태 관리
- 학생 제출 RPC 본인/학급/입력/첨부 검증 강화
- 제출 GOLD 자동 보상
- 교사 채점 + 만점 BV 보상 + 우편/활동피드
- 학생이 점수와 피드백 확인
- 교사가 제출 내용과 첨부 링크 확인

## F4D — 기록실·랭킹·분석

- `hall_of_fame_entries` 신규 테이블
- 학생 기록실: 전시 기록 + 최신 공식 랭킹 + 최신 학급 통계
- 교사 기록실: 오늘 통계/랭킹 계산, 명예 기록 추가/보관
- `calculate_daily_statistics`, `calculate_rankings` 브라우저 직접 실행 차단; 교사 wrapper/cron 경유
- 기존 AnalyticsPage의 Gini/티어/거래 조회 오류를 `[F4D:...]`로 구분
- `teacher_feature4_health_check()` 추가

## 오류 격리 설계

- DB: P4Axx / P4Bxx / P4Cxx / P4Dxx SQLSTATE + `[F4X]` 메시지
- 프론트 RPC: `[F4X:<rpc>]`
- 프론트 조회: `[F4X:<query-operation>]`
- 화면: `Feature4ErrorPanel`이 영역 코드를 그대로 표시
- DB bundle: A/B/C/D 독립 트랜잭션
- `FEATURE4_CHANGE_MANIFEST.json`: 영역별 파일·라우트·테이블·RPC 목록
- `20260807_02_feature4_postcheck.sql`: 적용 후 자동 점검

## 의도적으로 임의 규칙을 만들지 않은 부분

`기록실`의 주간/월간 MVP 자동 선정 규칙은 기존 명세에 선정 공식이 확정되어 있지 않습니다. 따라서 임의 점수 공식을 만들지 않고 `hall_of_fame_entries`의 범용 기록 구조와 교사 수동 전시 기능으로 구현했습니다. 향후 MVP 선정 규칙이 확정되면 F4D 집계 함수만 확장할 수 있습니다.

과거 1.0 우편·출석·과제·기록 데이터는 이번 버전에서 자동 이관하지 않습니다. 기존 데이터가 없어도 새 기능은 빈 상태에서 시작할 수 있습니다.
