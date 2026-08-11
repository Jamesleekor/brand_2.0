# Feature 3 테스트 계획 — 실시간 온라인 경매

## 0. 준비

- 교사 브라우저 1개
- 학생 A 브라우저 1개
- 학생 B 브라우저 1개
- 가능하면 교실 중계 화면 1개
- F12 Network → Fetch/XHR를 열어둠
- 시작가 10 GOLD의 테스트 상품 2~3개

## 1. SQL 적용 검증

SQL 실행 후 다음 함수가 존재해야 합니다.

```text
place_live_auction_bid
finalize_live_auction_item_if_expired
get_live_auction_state
teacher_create_live_auction
teacher_start_live_auction
teacher_start_live_auction_item
teacher_close_live_auction_item_now
```

권한 기대값:

- 새 외부 RPC: anon false, authenticated true, service_role true
- 기존 `record_auction_bid`, `confirm_auction_sale`, `report_auction_failure`: anon false, authenticated false, service_role true
- `create_transaction`: anon false, authenticated false, service_role true

Realtime 결과:

```text
auctions
auction_items
auction_bids
auction_results
auction_failures
```

## 2. 회차와 상품 관리

1. 새 회차 생성
2. 상품 3개 추가
3. 상품명·이모지·시작가 수정
4. 순서 위·아래 이동
5. 사용하지 않을 상품 삭제
6. 새 상품 추가

기대:

- 진행 중인 상품이 없을 때만 목록 변경 가능
- 학생 화면에는 회차 시작 전 노출되지 않음

## 3. 회차 시작과 화면 동기화

1. 교사가 회차 시작
2. 학생 A/B가 시장 → 경매 진입
3. 교사가 중계 화면 열기
4. 첫 상품 시작

기대:

- 세 화면에 같은 상품·현재가·타이머 표시
- Network 400~500 없음

## 4. 직접 입찰

1. 학생 A가 현재가보다 높은 금액 입력
2. 입찰

기대:

- 모든 화면에 A가 최고 입찰자로 즉시 표시
- 현재가 갱신
- 최근 입찰 추가
- 지갑 잔액 자체는 낙찰 전까지 차감되지 않음
- 최고 입찰액은 예약 표시

## 5. 즉시 입찰 1.1배

학생 B가 즉시 입찰 클릭.

기대:

```text
즉시 입찰가 = max(현재가 + 1, ceil(현재가 × 1.1))
```

- B가 최고 입찰자
- A의 예약 해제
- B의 예약 생성

## 6. 타이머 연장

### 남은 시간이 15초보다 많을 때

입찰 후 타이머가 15초로 줄어들면 안 됩니다.

### 남은 시간이 15초 이하일 때

새 최고 입찰 후 약 15초로 돌아와야 합니다.

다시 입찰이 들어와도 15초가 누적 추가되는 것이 아니라 다시 약 15초가 남아야 합니다.

## 7. 동시 입찰

학생 A/B가 거의 동시에 서로 다른 금액으로 입찰.

기대:

- 높은 금액 한 건만 최종 최고 입찰
- 낮은 금액은 먼저 처리되었으면 기록 후 outbid, 늦게 처리되었으면 현재가 이하 오류
- 최고 입찰자가 둘이 되지 않음

## 8. GOLD 예약 방어

최고 입찰자가 예약액을 침범하도록 다음을 시도합니다.

- P2P 송금
- GOLD 교환
- 복지기금 기부
- 교사 GOLD 차감

기대:

- `최고 입찰액이 예약되어 있어요` 오류
- 예약액을 남기는 범위의 소액 사용은 허용
- 다른 학생이 최고 입찰하면 예약 해제

## 9. 자동 만료 낙찰

입찰이 있는 상태에서 타이머를 0까지 기다립니다.

기대:

- 한 번만 낙찰
- 승자 GOLD 차감
- `AUCTION_PAYMENT` 거래 생성
- `auction_results` 한 행 생성
- 학생·교사·중계 화면 즉시 종료 상태
- 낙찰자·낙찰가 표시

## 10. 입찰 없는 유찰과 재시도

1. 상품 시작
2. 아무도 입찰하지 않고 만료 또는 수동 유찰

기대:

- 1차 유찰 기록
- 2차 대기
- 학급 설정 할인율만큼 시작가 인하
- 2차, 3차 반복 가능
- 3차 유찰 후 `FAILED_FINAL`

## 11. 일시정지·재개

1. 상품 진행 중 일시정지
2. 5초 기다림
3. 재개

기대:

- PAUSE 표시
- 정지 중 입찰 차단
- 정지 전 남은 시간이 보존되어 재개

## 12. 교사 즉시 종료

입찰이 있는 상품을 교사가 즉시 종료.

기대:

- 현재 최고 유효 입찰자로 즉시 정산
- 중복 정산 없음

## 13. 회차 완료

모든 상품이 SOLD 또는 FAILED_FINAL 상태가 된 뒤 경매 완료 클릭.

기대:

- 회차 `COMPLETED`
- 학생 시장에는 진행 중 경매 없음 표시
- 과거 결과는 DB에 보존

## 14. 실패 방어

- 자기 자신이 이미 최고 입찰자인데 재입찰
- 현재가 이하 입찰
- 보유 GOLD 초과
- 타이머 종료 후 입찰
- 정지 중 입찰
- 다른 학급 학생 ID 위조
- 학생이 교사 RPC 직접 호출
- 버튼 연속 클릭

모두 잔액·입찰·결과가 중복 변경되지 않아야 합니다.
