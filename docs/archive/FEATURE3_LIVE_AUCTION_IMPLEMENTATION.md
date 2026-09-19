# Feature 3 구현 보고서 — 실시간 온라인 경매

## 구현 범위

### 교사

- 경매 회차 생성·삭제
- 회차, 학년도, 예정일 설정
- 기본 타이머와 마지막 입찰 보장 시간 설정
- 상품 추가·수정·삭제
- 상품 순서 이동
- 회차 시작
- 개별 상품 시작
- 일시정지·재개
- 즉시 종료·정산
- 입찰 없는 상품 수동 유찰
- 1~3차 재시도 및 가격 인하
- 전체 경매 완료
- 교실 앞 중계 화면

### 학생

- 전체 상품과 진행 순서
- 현재 상품
- 이전 회차 동일 상품 낙찰가
- 현재 최고가와 최고 입찰자
- 서버 기준 실시간 타이머
- 현재가 1.1배 즉시 입찰
- 직접 입찰가 입력
- 보유 GOLD와 예약 GOLD
- 최근 입찰
- 종료 상품·낙찰자·낙찰가

### DB·보안

- `auctions`, `auction_items`, `auction_bids` 실시간 상태 컬럼 추가
- 경매 이벤트 원장 추가
- 학생·교사 직접 테이블 쓰기 차단
- 기존 미완성 저수준 경매 RPC 브라우저 차단
- 학생 본인·같은 학급 검증
- 교사 역할·담당 학급 검증
- advisory lock + `FOR UPDATE`
- 서버 시간 기준 입찰 종료 검증
- 입찰액 GOLD 예약을 `create_transaction`에서 중앙 보호
- 정산 시 잔액이 부족한 비정상 입찰 자동 무효화 후 다음 유효 입찰 탐색
- 낙찰 결제와 결과 저장 원자 처리
- Realtime publication 등록

## 신규 주요 RPC

학생/공통:

```text
place_live_auction_bid
finalize_live_auction_item_if_expired
get_live_auction_state
```

교사:

```text
teacher_create_live_auction
teacher_delete_scheduled_auction
teacher_add_live_auction_item
teacher_update_live_auction_item
teacher_delete_live_auction_item
teacher_move_live_auction_item
teacher_start_live_auction
teacher_start_live_auction_item
teacher_pause_live_auction_item
teacher_resume_live_auction_item
teacher_close_live_auction_item_now
teacher_fail_live_auction_item
teacher_complete_live_auction
```

## 타이머 규칙

새 입찰 시:

```text
새 종료 시각 = max(기존 종료 시각, 서버 현재 시각 + 연장 보장 시간)
```

따라서 남은 시간이 25초일 때 입찰해도 15초로 줄지 않고, 남은 시간이 7초일 때 입찰하면 약 15초로 되돌아갑니다.

## GOLD 예약

학생이 600 GOLD로 최고 입찰 중이고 지갑에 1,000 GOLD가 있다면 다른 기능에서 사용할 수 있는 금액은 400 GOLD입니다. 다른 학생이 더 높은 금액으로 입찰하면 기존 최고 입찰자의 예약은 즉시 해제됩니다.
