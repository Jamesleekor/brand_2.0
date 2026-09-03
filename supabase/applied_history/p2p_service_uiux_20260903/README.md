# P2P 서비스 마켓 UI/UX backend — Production applied history

Status: **ALREADY APPLIED TO PRODUCTION on 2026-09-03**.

이 디렉터리는 Production에 이미 수동 적용된 P2P 서비스 마켓 UI/UX backend 변경의 감사/복구용 사본이다. 일반 migration tooling이 pending migration으로 인식하지 않도록 `supabase/migrations/` 밖에 두고 `.sql.applied` 확장자를 사용한다.

## 절대 재실행하지 말 것

- `01_APPLIED_P2P_SERVICE_UIUX_SCHEMA_RPC.sql.applied`

Production에 동일 SQL을 다시 실행하지 않는다. 이후 변경이 필요하면 최신 Production 구조를 READ-ONLY로 다시 확인한 뒤 새 incremental migration/rehearsal을 만든다.

## 이미 적용된 변경

- `secondary_job_services.subtitle varchar(40) NULL`
- `secondary_job_services.service_category varchar(20) NULL`
- `secondary_job_service_orders.service_category_snapshot varchar(20) NULL`
- 서비스 상세설명 상한 2,000자
- market RPC에 `subtitle`, `service_category` 추가
- reputation board에 서비스별 `service_reputations` 추가
- upsert RPC를 제목 2~24자 / 부제목 2~40자 / 상세설명 10~2000자 / canonical category 6종 계약으로 변경
- 신규 주문에 서비스 카테고리 snapshot 저장
- Economy Guard `SERVICE_ORDER.source_meta.service_category` 연결
- 기존 서비스/주문 데이터 backfill 없음

Canonical service category keys:

- `청소`
- `학습`
- `제작`
- `1인1역`
- `생활도움`
- `기타`

## Production 검증 완료

- ROLLBACK rehearsal: PASS
- APPLY postcheck: PASS
- STRICT READ-ONLY POSTCHECK V2: PASS
- Runtime/Auth READ E2E: PASS
- Runtime/Auth WRITE E2E V3.1: PASS, subtransaction rollback confirmed
- 기존 서비스 28 / 주문 29 / 후기 13 유지
- Economy Guard 공식 SERVICE_ORDER 29건 projection mismatch 0 / duplicate event key 0
- 기존 서비스와 기존 주문은 `subtitle/service_category/service_category_snapshot` backfill 없이 유지

## 중요한 historical gap

기존 P2P 서비스 본체의 최초 생성 migration은 이 저장소에 완전하게 복원되어 있지 않다. 이 applied-history 파일을 fresh-install migration chain으로 오해하지 않는다. 새 환경을 0부터 구축해야 한다면 먼저 P2P 서비스 backend 전체를 Production-to-source 방식으로 별도 reconcile해야 한다.
