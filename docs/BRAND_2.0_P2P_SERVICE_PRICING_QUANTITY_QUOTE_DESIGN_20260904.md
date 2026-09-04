# B.R.A.N.D 2.0 — P2P 서비스 가격방식·수량·견적 확장 설계

작성일: 2026-09-04

## 1. 목표

기존 P2P 서비스/에스크로를 별도 시스템으로 분리하지 않고 다음 기능을 자연스럽게 통합한다.

- 모든 거래에 구매 수량
- 가격 방식 3종: FIXED / OPTION / QUOTE
- 서비스별 수량 단위
- 옵션별 가격
- 견적 요청 → 판매자 견적 → 구매자 수락 시 escrow
- 기존 28개 서비스 / 29개 주문 호환
- 기존 완료/수정요청/분쟁/교사 환불·정산 흐름 최대 재사용
- Economy Guard의 거래금액/수량/단가 의미 확장
- 서비스 카드 가격 요약 + 카드 높이/평가·후기 가독성 개선

## 2. 핵심 호환 원칙

### `secondary_job_services.price_gold`
- 컬럼은 삭제하지 않는다.
- FIXED 서비스의 단가로 계속 사용한다.
- OPTION / QUOTE에서는 NULL을 허용한다.
- 기존 서비스는 자동으로 FIXED로 간주한다.

### `secondary_job_service_orders.price_gold_snapshot`
- 컬럼은 삭제/이름 변경하지 않는다.
- 의미를 **거래 당시 총 결제금액**으로 확장한다.
- 기존 정산/환불 함수가 이 값을 그대로 사용하므로 기존 에스크로 코드를 최대한 재사용한다.
- QUOTE_REQUESTED 단계에서는 아직 가격이 없으므로 NULL 허용.
- 견적 제안 시 총액이 채워지고, 견적 수락 이후 기존 에스크로/정산의 canonical total이 된다.

## 3. 서비스 가격 모델

### 서비스 추가 컬럼

`secondary_job_services`
- `pricing_mode varchar(16) NOT NULL DEFAULT 'FIXED'`
  - FIXED
  - OPTION
  - QUOTE
- `quantity_unit varchar(20) NOT NULL DEFAULT '회'`
  - UI preset: 회 / 개 / 건 / 분 / 시간 / 일 / 직접 입력
  - DB에는 최종 표시 단위 문자열만 저장
- `price_gold`
  - FIXED: 1~1,000,000
  - OPTION/QUOTE: NULL

### 옵션 테이블

`secondary_job_service_options`
- `id bigint PK`
- `service_id bigint FK -> secondary_job_services(id) ON DELETE CASCADE`
- `option_name varchar(40)`
- `price_gold bigint`
- `is_active boolean`
- `sort_order integer`
- `created_at`, `updated_at`

규칙:
- OPTION 서비스는 1~20개 옵션
- 옵션명 1~40자
- 단가 1~1,000,000
- JSON 배열 순서를 `sort_order`로 저장
- 서비스 수정 시 옵션 set을 원자적으로 교체
- 기존 주문은 option snapshot을 갖기 때문에 이후 옵션 삭제/가격 변경과 무관

## 4. 주문 snapshot 확장

`secondary_job_service_orders` 추가 컬럼:

- `pricing_mode_snapshot varchar(16) NOT NULL DEFAULT 'FIXED'`
- `option_id_snapshot bigint NULL` (감사용 ID snapshot, FK 아님)
- `option_name_snapshot varchar(40) NULL`
- `unit_price_gold_snapshot bigint NULL`
- `quantity bigint NULL`
- `requested_quantity bigint NULL`
- `quantity_unit_snapshot varchar(20) NOT NULL DEFAULT '회'`
- `buyer_note text NULL`
- `seller_quote_note text NULL`
- `quote_offered_at timestamptz NULL`
- `quote_accepted_at timestamptz NULL`

기존 주문 backfill:
- pricing_mode_snapshot = FIXED
- unit_price_gold_snapshot = 기존 price_gold_snapshot
- quantity = 1
- quantity_unit_snapshot = 회
- 기존 price_gold_snapshot 자체는 변경하지 않음

## 5. 상태 머신

### 고정가격 / 옵션가격

`REQUESTED → ACCEPTED → DELIVERED → COMPLETED`

기존 흐름 유지.

주문 생성 시:
1. 단가 결정
2. 수량 검증
3. 총액 = 단가 × 수량
4. escrow 생성
5. REQUESTED 주문 생성

### 견적형

`QUOTE_REQUESTED → QUOTE_OFFERED → ACCEPTED → DELIVERED → COMPLETED`

#### QUOTE_REQUESTED
구매자가:
- 요청 내용
- 희망 수량
- 선택적 추가 메모
입력.

이 단계:
- `escrow_transaction_id = NULL`
- `price_gold_snapshot = NULL`
- 자산 이동 0

#### QUOTE_OFFERED
판매자가:
- 제안 단가
- 제안 수량
- 선택적 판매자 메모
입력.

시스템:
- 총액 = 단가 × 수량
- 아직 escrow 없음

#### 구매자 견적 수락
구매자가 수락하는 순간:
1. 학급 자산동결 재검사
2. 비동시 주문 서비스의 실제 진행 주문 존재 여부 재검사
3. 총액으로 escrow 생성
4. `escrow_transaction_id` 저장
5. `status = ACCEPTED`
6. `accepted_at`, `quote_accepted_at` 기록

판매자는 이미 견적을 제안했으므로 별도 ACCEPT를 다시 요구하지 않는다.

### 견적 취소/거절

- 구매자 QUOTE_REQUESTED 취소 → CANCELLED, refund 없음
- 구매자 QUOTE_OFFERED 견적 거절(`DECLINE_QUOTE`) → CANCELLED, refund 없음
- 판매자 QUOTE_REQUESTED/QUOTE_OFFERED 거절 → REJECTED, refund 없음
- escrow 생성 이후 취소/거절/교사 환불 → 기존 refund_locked 사용


## 5.1 DB 원장 일관성 방어

RPC 검증 외에도 주문 CHECK로 다음을 강제한다.

- QUOTE_REQUESTED: QUOTE + escrow 없음 + total/unit/actual quantity 없음 + requested quantity 존재
- QUOTE_OFFERED: QUOTE + escrow 없음 + total/unit/actual quantity 존재
- QUOTE의 pre-escrow CANCELLED/REJECTED: escrow 없음 허용
- 나머지 경제 상태: escrow + total/unit/quantity 필수
- OPTION 주문: option id/name snapshot 필수
- FIXED/QUOTE 주문: option snapshot 금지
- QUOTE는 requested_quantity 필수, FIXED/OPTION은 requested_quantity 없음

이렇게 하여 RPC 오류가 발생하더라도 모순된 주문 원장이 DB에 저장되지 않도록 한다.

## 6. 수량 규칙

- 수량: 1~1,000,000
- 단가: 1~1,000,000 GOLD
- 총 거래금액: 1~1,000,000 GOLD
- 곱셈 결과가 1,000,000을 초과하면 주문/견적 제안 거절
- 따라서 `1 GOLD × 138 = 138 GOLD` 자유금액 거래를 그대로 지원

## 7. 동시 주문 규칙

두 개념을 분리한다.

### 동일 구매자의 중복 요청
QUOTE_REQUESTED/QUOTE_OFFERED도 open order로 간주.
같은 구매자가 같은 서비스에 여러 열린 요청을 중복 생성할 수 없음.

### `allow_concurrent_orders=false`
실제 서비스 수행 capacity만 제한한다.

다음 escrow-active 상태만 capacity 점유:
- REQUESTED
- ACCEPTED
- DELIVERED
- REVISION_REQUESTED
- DISPUTED

QUOTE_REQUESTED / QUOTE_OFFERED는 아직 거래 미체결 문의이므로 다른 학생 주문을 막지 않는다.

단, 구매자가 견적을 수락하는 순간 capacity를 다시 확인한다.

## 8. RPC 전략

기존 frontend 배포 호환을 위해 기존 RPC를 즉시 제거하지 않는다.

### 신규 RPC

- `student_upsert_secondary_job_service_v2(...)`
  - pricing mode / quantity unit / options까지 원자 저장
- `student_order_secondary_job_service_v2(...)`
  - FIXED / OPTION / QUOTE 공통 주문 진입
- `student_offer_secondary_job_service_quote(...)`
- `student_accept_secondary_job_service_quote(...)`

### 기존 RPC 유지

`student_upsert_secondary_job_service(...)`
- 기존 FIXED 등록/수정 호환
- non-FIXED 서비스는 구 UI로 수정하지 못하도록 방어

`student_buy_secondary_job_service(...)`
- FIXED + 수량 1 compatibility wrapper
- OPTION/QUOTE에는 사용 불가

### 기존 액션 RPC 확장

`student_act_secondary_job_service_purchase`
- QUOTE_REQUESTED/QUOTE_OFFERED의 pre-escrow CANCEL 지원
- 기존 CONFIRM / REVISION / DISPUTE 유지

`student_act_secondary_job_service_sale`
- quote pre-escrow REJECT/CANCEL 지원
- 기존 REQUESTED ACCEPT/REJECT/CANCEL 유지

`teacher_resolve_secondary_job_service_order`
- pre-escrow quote는 REFUND가 아니라 직접 CANCELLED
- escrow 이후는 기존 refund_locked
- PAY_SELLER 기존 유지

## 9. Economy Guard

경제 이벤트는 **escrow가 존재하는 주문만** projection한다.

- FIXED/OPTION: 주문 생성 시점부터 event
- QUOTE: 견적 요청/제안은 event 없음
- 견적 수락(escrow 생성) 순간부터 event

Guard:
- `amount = price_gold_snapshot` = 총 거래금액
- `quantity = quantity`
- `unit_price = unit_price_gold_snapshot`
- `occurred_at = COALESCE(quote_accepted_at, created_at)`

`source_meta`:
- pricing_mode
- service_category
- option_name
- quantity_unit
- requested_quantity
- buyer_note
- seller_quote_note
- quote_offered_at
- quote_accepted_at

기존 29개 주문은 quantity=1 / unit_price=기존 total / FIXED이므로 기존 event amount/quantity/unit_price/fingerprint를 변경하지 않는다.

## 10. Market / 광고 응답

서비스 응답에 추가:
- pricing_mode
- quantity_unit
- price_min_gold
- price_max_gold
- options

가격 요약:
- FIXED: `150 GOLD / 회`
- OPTION: `120 ~ 250 GOLD / 회`
- QUOTE: `견적문의`

광고 RPC도 동일 가격 요약 필드를 추가하여 단일 숫자 가정 제거.

## 11. Frontend UX

### 서비스 카드
- 현재 148px → 약 180px 수준으로 확대
- 제목 2줄
- 부제목 2줄
- 가격 요약 1줄
- 평가/후기 글자 크기 상향
- 4열 × 2행 / 페이지당 8개 유지

### 상세 Modal — FIXED
- 단가
- 수량 입력
- 단위
- 실시간 총액
- 주문 요청
- 결제

### 상세 Modal — OPTION
- 활성 옵션 선택
- 옵션 단가
- 수량 입력
- 실시간 총액
- 주문 요청
- 결제

### 상세 Modal — QUOTE
- 요청 내용
- 희망 수량 + 단위
- 추가 메모
- `견적 요청하기`
- “견적 수락 전 자산 이동 없음” 명시

### 내 주문
QUOTE_REQUESTED:
- 견적 요청중
- 요청 취소

QUOTE_OFFERED:
- 판매자 제안 단가/수량/총액/메모 표시
- 견적 수락
- 견적 거절

### 판매 주문
QUOTE_REQUESTED:
- 구매 요청/희망수량 표시
- 제안 단가/수량/메모 입력
- 견적 제안
- 거절

QUOTE_OFFERED:
- 현재 제안 표시
- 필요 시 견적 재제안 가능
- 취소/거절

견적 수락 이후 기존 ACCEPTED UI를 그대로 사용.

## 12. 구현 순서

1. Production 구조 audit — 완료
2. 설계 확정 — 본 문서
3. ROLLBACK rehearsal
4. rehearsal PASS
5. Production APPLY
6. STRICT READ-ONLY POSTCHECK
7. Runtime/Auth READ E2E
8. ROLLBACK WRITE E2E
   - FIXED quantity
   - OPTION quantity
   - QUOTE request/offer/accept
   - no-escrow quote cancellation
   - Guard values
9. frontend integration patch
10. 사용자 `npm run build`
11. browser smoke test
12. commit/push

`npm ci`, `npm run build`는 사용자가 직접 실행한다.
