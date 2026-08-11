# Feature 4 통합 검증 계획

네 영역을 한 번에 구현했기 때문에 테스트는 **모듈별 smoke → 교차 연결 → 실패 방어** 순으로 진행합니다. 실제 과거 데이터 이관은 필요하지 않습니다.

## 0. 설치 검증

1. Feature4 bundle 실행
2. 마지막 F4A~D `true` 확인
3. `20260807_02_feature4_postcheck.sql` 실행
4. 교사 → 기록실 → Feature4 진단 실행
5. Windows `npm run build` 성공 확인

## 1. F4A smoke

- 교사가 테스트 학생 1명에게 우편 발송
- 학생 우편함에서 새 우편 즉시 표시
- 열면 읽음 처리
- 교사가 전체 알림 발송
- 학생 알림 탭에 표시 → 읽음 처리
- 익명/로그아웃 상태에서 RPC 호출 불가 확인은 post-check ACL로 대체 가능

## 2. F4B smoke

- 교사가 10분짜리 ASSET_FREEZE 테스트 비상사태 발동 → 학생 화면/기존 경제 행동과 연결 확인
- 수동 종료 → MANUAL_TERMINATED 확인
- 돌발 퀘스트 보상 GOLD 1로 생성 → 학생 1회 완료 → GOLD +1, 우편, 활동피드 확인
- 같은 퀘스트 두 번째 완료는 `[F4B] quest already completed`로 실패
- 경제수호대 학생 1명 30일 임명 → 우편 확인 → 임기 종료

## 3. F4C smoke

- 교사 오늘 출석 1~2명 입력
- GOLD 출석 보상 확인
- 같은 학생 중복 입력은 새 거래 없이 skipped
- 오늘 출석 상태 정정 → 기존 보상 역분개 + 새 상태 보상만 적용
- 테스트 과제: 제출 GOLD 1, 만점 BV 1
- 학생 제출 → GOLD +1 한 번만
- 교사 만점 채점 → BV +1, 학생 점수/피드백/우편 확인
- 동일 제출 재채점은 차단

## 4. F4D smoke

- 교사 `오늘 기록 갱신`
- daily_statistics 한 행과 rankings 생성/갱신 확인
- 학생 기록실에서 최신 랭킹 표시
- 교사가 명예 기록 1개 추가 → 학생 기록실 표시 → 보관 처리 후 사라짐
- 기존 `/teacher/analytics` Gini/티어/거래 패널에 오류가 없는지 확인

## 5. 교차 연결 테스트

- 돌발 퀘스트 완료 → wallet + mail + activity feed 세 곳 동시 확인 (F4B→F4A→경제코어)
- 과제 만점 → wallet + mail + activity feed + 학생 과제 피드백 (F4C→F4A→경제코어)
- 기록 갱신 → 학생 기록실 + 기존 교사 분석 화면 (F4D)

## 6. 실패 방어 테스트

- 다른 학급 학생 ID로 교사 우편/수호대/출석 요청 → 실패
- 동일 수신자 중복 우편 배열 → 전체 실패
- 이미 완료한 돌발 퀘스트 → 실패, 보상 중복 없음
- 과제 빈 제출 → 실패
- http(s)가 아닌 첨부 URL → 실패
- 만점을 초과한 점수 → 실패
- 오늘이 아닌 날짜의 Feature4 일괄 출석 → 실패
- 이미 지나간 마감일의 과제를 다시 PUBLISHED로 변경 → 실패

## 7. 합격 기준

- 어떤 실패도 부분 자산 지급을 남기지 않음
- Network 400/500이 정상 실패 방어 외에는 없음
- 오류 발생 시 항상 F4A/F4B/F4C/F4D 중 하나로 추적 가능
- post-check에서 외부 RPC `anon=false/authenticated=true/service_role=true`
- 내부 helper `anon=false/authenticated=false/service_role=true`

## 추가 과제 경계 테스트

- 본문 없이 정상 `https://...` 첨부 링크만 제출 → 성공
- 6개 첨부 → 차단
- `javascript:` 또는 http(s)가 아닌 문자열 → 차단
- RETURNED 상태의 과거 제출이 있는 학생이 재제출하더라도 제출 GOLD가 두 번 지급되지 않는지 확인
