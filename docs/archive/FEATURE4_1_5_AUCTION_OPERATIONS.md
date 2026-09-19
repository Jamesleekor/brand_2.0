# Feature 4.1.5 — Auction Operations

## 사용자 요구 반영
1. 즉시 종료·정산 직후 상품명/낙찰자/낙찰금액 결과창 표시.
2. 같은 학년도·같은 회차의 완료 경매를 재생성할 때 경고 후 초기화 가능.
   - 기존 낙찰 결제 자동 환급 (`reverse_transaction`)
   - 확인 전에는 데이터 변경 없음.
3. 경매 탭에 과거 회차 기록 추가.
   - 회차 요약 및 학생별 구매 상품 상세 확인.
4. 상품 프리셋 추가.
   - 고정 카테고리: 자리, 1인1역, 급식순서, 특별경매, 기타
   - 자리 1~24, 급식순서 1~24 일괄 등록.
   - 1인1역/특별경매/기타 프리셋 DB 영구 저장 및 재사용.

## DB 적용
Supabase SQL Editor에서 `supabase/APPLY_AUCTION_OPERATIONS_V2.sql`을 실행한 뒤 새 프론트엔드를 사용합니다.

## 검증
수정된 TS/TSX 파일은 TypeScript transpile parser 기준 syntax error 0개.
현재 샌드박스는 npm registry에서 `zustand@5.0.14` 패키지를 받을 수 없어 전체 npm build를 완료하지 못했습니다.
