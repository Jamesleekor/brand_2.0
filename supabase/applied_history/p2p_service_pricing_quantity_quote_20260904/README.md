# P2P 서비스 가격방식·수량·견적 확장 — Production applied history

Status: **ALREADY APPLIED TO PRODUCTION on 2026-09-04**.

이 디렉터리는 Production에 이미 수동 적용된 P2P 서비스 가격방식·수량·견적 확장의 감사/복구용 사본이다. 일반 migration tooling이 pending migration으로 인식하지 않도록 `supabase/migrations/` 밖에 두고 `.sql.applied` 확장자를 사용한다.

## 절대 재실행하지 말 것

- `01_APPLIED_P2P_SERVICE_PRICING_QUANTITY_QUOTE.sql.applied`

Production에 동일 SQL을 다시 실행하지 않는다. 이후 변경은 최신 Production 구조를 READ-ONLY로 다시 확인한 뒤 새 incremental migration/rehearsal을 만든다.

## 이미 적용된 핵심 변경

- 서비스 가격방식 `FIXED / OPTION / QUOTE`
- 서비스 수량 단위 `quantity_unit`
- `secondary_job_service_options` 옵션가격 테이블
- 모든 주문의 수량/단가/총액 snapshot
- 견적 상태 `QUOTE_REQUESTED → QUOTE_OFFERED → ACCEPTED`
- 견적 수락 전 escrow/GOLD 이동 없음
- 견적 수락 순간 기존 escrow/정산 흐름으로 연결
- market / 광고 RPC의 `pricing_mode`, `quantity_unit`, `price_min_gold`, `price_max_gold`
- Economy Guard: `amount=총액`, `quantity=수량`, `unit_price=단가`; 견적은 escrow 생성 후에만 projection
- 기존 서비스/주문 호환 wrapper 유지

## Production 검증 완료

- ROLLBACK rehearsal: PASS
- Production APPLY: PASS
- STRICT READ-ONLY POSTCHECK V4: PASS
- Runtime/Auth READ E2E V2: PASS
- Runtime/Auth WRITE E2E: **PASS + rollback confirmed**

WRITE E2E에서 확인한 항목:

- FIXED 수량 총액
- OPTION 옵션/수량 snapshot
- OPTION 시장 가격범위
- QUOTE 요청/제안 단계 자산 이동 없음
- QUOTE 수락 시 escrow 생성
- QUOTE 결제 전 취소 시 자산 이동 없음
- FIXED / OPTION / QUOTE Economy Guard amount/quantity/unit_price
- 테스트 행 정확한 ID rollback
- 구매자 wallet GOLD 원상복구

PostgreSQL sequence는 rollback되지 않으므로 테스트 과정에서 ID gap이 생길 수 있으며 이는 정상이다.
