# B.R.A.N.D 2.0 — 기본 경제 행동 적용 안내

이번 버전에는 다음 기능이 추가되었습니다.

## 학생

- 같은 학급 학생에게 GOLD 송금
- GOLD ↔ CRYSTAL 교환
- 학급 복지기금에 GOLD 기부
- 지갑과 거래 기록 Realtime 즉시 반영

## 교사

- 최근 교사 지급·차감 거래 취소
- P2P 송금 양쪽 거래 동시 취소
- 화폐 교환 지출·수령 거래 동시 취소
- 기부 환급과 복지기금 원장 동시 취소
- 취소 사유와 원본 거래 연결 기록

> `SOCIAL_CONTRIBUTION`은 기존 ENUM에는 있지만 구체적인 적립 대상·보상 규칙이 확정돼 있지 않아 임의 기능을 만들지 않았습니다. 이번 단계의 사회적 행동은 **복지기금 기부**로 구현했습니다.

---

## 반드시 지킬 적용 순서

### 1. 운영 DB에 migration 적용

Supabase Dashboard에서 다음 경로로 이동합니다.

```text
SQL Editor → New query
```

아래 파일을 열어 전체 내용을 붙여넣고 한 번 실행합니다.

```text
supabase/migrations/20260806_02_basic_economic_actions.sql
```

이 migration은 전체 스키마를 다시 만드는 파일이 아닙니다. 현재 운영 DB 위에 필요한 함수와 권한만 추가·보강합니다.

### 2. SQL 결과 확인

마지막 결과표에서 다음 함수가 보여야 합니다.

```text
transfer_p2p_with_log
exchange_token
donate_to_welfare_fund
teacher_reverse_economic_event
reverse_transaction
is_asset_freeze_active
```

권한 기대값:

```text
create_transaction / reverse_transaction
  anon            false
  authenticated   false
  service_role    true

transfer_p2p_with_log / exchange_token / donate_to_welfare_fund
teacher_reverse_economic_event
  anon            false
  authenticated   true
  service_role    true
```

기대값과 다르면 프론트 테스트를 시작하지 말고 SQL 결과를 공유합니다.

### 3. 프론트 설치·빌드

새 프로젝트 폴더에서:

```bash
npm ci
npm run build
npm run dev
```

Chunk 크기 경고는 빌드 실패가 아닙니다.

### 4. 학생 기능 위치

```text
학생 로그인 → 내 자산 → 경제 활동
```

버튼:

```text
송금 / 교환 / 기부
```

### 5. 교사 취소 기능 위치

```text
교사 로그인 → 학급 운영 → 거래 취소·정정
```

금액을 잘못 지급한 경우:

1. 잘못된 거래를 취소
2. 위쪽 `학생 자산 지급·차감` 패널에서 정확한 금액으로 다시 지급

---

## 안전한 첫 테스트

실제 운영 학생 두 명을 정하되 반드시 소액으로 진행합니다.

1. 학생 A → 학생 B에게 GOLD 1 송금
2. 교사 화면에서 해당 송금 취소
3. GOLD 2 → CRYSTAL 1 교환(학급 비율이 2인 경우)
4. 교사 화면에서 해당 교환 취소
5. 복지기금에 GOLD 1 기부
6. 교사 화면에서 해당 기부 취소

자세한 항목은 다음 문서를 따릅니다.

```text
FEATURE2_BASIC_ECONOMY_TEST_PLAN.md
```
