# 기능 구현 보고서 — 기본 경제 행동

## 1. 구현 범위

### 학생 경제 활동

- P2P GOLD 송금
- GOLD·CRYSTAL 화폐 교환
- 복지기금 GOLD 기부
- 실행 전 상세 확인
- 잔액·입력값 클라이언트 사전 검증
- DB의 최종 권한·잔액·동시성 재검증
- 성공·실패 토스트
- React Query 재조회
- Realtime 지갑·거래 반영

### 교사 거래 취소·정정

- 최근 취소 가능 거래 검색
- 교사 지급·차감 단일 거래 취소
- P2P 송금의 송신·수신 거래 동시 취소
- 화폐 교환의 지출·수령 거래 동시 취소
- 기부 환급과 복지기금 원장 동시 취소
- 취소 사유 2~200자
- 원본 거래의 `is_reversed`, 취소 거래 ID, 취소 시각, 취소 사유 기록
- 금액 정정은 안전하게 `원본 취소 → 정확한 금액 재지급` 방식 사용

## 2. 학생 UI

새 파일:

```text
src/features/wallet/EconomicActionsPanel.tsx
```

연결 파일:

```text
src/features/wallet/WalletPage.tsx
```

`useWallet()`은 페이지에서 한 번만 호출하도록 정리했습니다. 같은 학생의 동일 Realtime 채널을 두 컴포넌트가 서로 제거하는 문제를 방지합니다.

### 송금

- 같은 학급의 재학 학생만 목록에 표시
- 본인 제외
- 실명·브랜드명·티어 검색
- 금액 1~1,000,000
- 메모 2~200자 필수
- 현재 잔액 초과 사전 차단
- 서버에서 같은 학급·본인·자산동결·잔액을 다시 검증

### 화폐 교환

- GOLD 또는 CRYSTAL 선택
- `classroom_settings.currency_exchange_ratio` 표시
- 현재 운영 규칙 유지: **비율 N개 사용 → 반대 화폐 1개 수령**
- 설정 비율의 배수만 허용
- 양방향에 같은 비율이 적용되므로 왕복 교환 시 손실 가능성을 명시
- BV 교환 금지

### 복지기금 기부

- 현재 GOLD와 복지기금 잔액 표시
- 금액·선택 메시지
- 학생 GOLD 차감, `DONATION` 거래, 기금 원장, 기금 잔액을 한 DB 트랜잭션으로 처리
- 프로필의 누적 기부 계산을 기존 잘못된 `P2P_SEND`가 아닌 `DONATION`으로 수정

## 3. 교사 UI

새 파일:

```text
src/features/teacher/TransactionReversalPanel.tsx
```

연결 파일:

```text
src/features/teacher/ClassroomControl.tsx
```

취소 목록에 표시하는 대표 거래 유형:

```text
TEACHER_GRANT
TEACHER_DEDUCT
BV_REVOKE
CORRECTION
P2P_SEND
EXCHANGE_PAY
DONATION
```

P2P는 `P2P_SEND` 한 건만 대표로 표시하고 실제 취소 시 송신·수신 거래를 함께 원복합니다. 교환도 `EXCHANGE_PAY` 한 건만 대표로 표시하고 지출·수령 거래를 함께 원복합니다.

과거 마이그레이션 거래 중 상세 원장과 연결되지 않은 P2P·교환·기부 거래는 안전하게 취소할 수 없으므로 목록에서 숨깁니다.

## 4. RPC·Zod·오류 처리

수정 파일:

```text
src/lib/zod_schemas/student_schemas.ts
src/lib/zod_schemas/teacher_schemas.ts
src/lib/rpc/student_rpc.ts
src/lib/rpc/error_handler.ts
```

추가 RPC 래퍼:

```text
studentRpc.donateToWelfare()
teacherRpc.reverseEconomicEvent()
```

P2P 검증도 운영 DB 규칙에 맞췄습니다.

```text
태그 최대 50자
메모 최대 200자
수량 1 이상
평점 1~10
```

## 5. DB migration

파일:

```text
supabase/migrations/20260806_02_basic_economic_actions.sql
```

### 보강한 함수

```text
transfer_p2p_with_log
exchange_token
reverse_transaction
```

### 새 함수

```text
is_asset_freeze_active
donate_to_welfare_fund
teacher_reverse_economic_event
```

### 권한 구조

```text
학생 브라우저
  → transfer_p2p_with_log / exchange_token / donate_to_welfare_fund
      → 본인 확인
      → 활성 학생·같은 학급 확인
      → 자산동결 확인
      → 내부 create_transaction

교사 브라우저
  → teacher_reverse_economic_event
      → 교사 권한 확인
      → 담당 학급 확인
      → 내부 reverse_transaction
          → 내부 create_transaction
```

`create_transaction`과 `reverse_transaction`은 브라우저 직접 호출이 차단된 상태를 유지합니다.

### 취소 원자성

- P2P 수령자가 받은 GOLD를 이미 사용해 회수할 수 없으면 송금자 환급도 발생하지 않습니다.
- 교환으로 받은 화폐를 이미 사용해 회수할 수 없으면 원래 화폐 환급도 발생하지 않습니다.
- 기부금이 이미 분배되어 복지기금 잔액이 부족하면 학생 환급도 발생하지 않습니다.
- 오류가 발생하면 PostgreSQL 트랜잭션 전체가 롤백됩니다.

## 6. Realtime

migration은 다음 테이블이 `supabase_realtime` publication에 없을 때 추가합니다.

```text
wallets
transactions
p2p_transfers
exchange_logs
welfare_funds
```

학생 잔액과 거래 내역은 기존 `useWallet()` 구독을 통해 즉시 갱신됩니다.

## 7. 명시적으로 구현하지 않은 항목

`SOCIAL_CONTRIBUTION`은 ENUM에 존재하지만 실제 기획에 다음 규칙이 확정돼 있지 않습니다.

- 누구에게 또는 어디에 기여하는가
- GOLD를 사용하는가
- BV·명예 보상이 있는가
- 교사 승인 절차가 있는가

따라서 임의의 자산 규칙을 만들지 않았습니다. 이번 버전에서는 복지기금 기부가 학생의 사회적 경제 행동을 담당합니다.
