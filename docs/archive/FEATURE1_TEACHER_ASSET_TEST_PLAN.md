# 테스트 계획 — 교사 BV/GOLD 지급·차감

운영 데이터 손상을 피하기 위해 반드시 **소액**으로 순서대로 테스트합니다.

## 0. 적용 전 준비

- 테스트할 학생 계정 한 명을 정합니다.
- 해당 학생의 현재 BV와 GOLD를 기록합니다.
- 가능하면 교사 브라우저와 학생 브라우저를 각각 엽니다.
  - 교사: 일반 창
  - 학생: 시크릿 창 또는 다른 브라우저

## 1. DB migration 적용

Supabase Dashboard:

```text
SQL Editor → New query
```

다음 파일 전체를 실행합니다.

```text
supabase/migrations/20260806_01_teacher_asset_adjustment.sql
```

### 기대 결과

함수 조회 결과에:

```text
teacher_adjust_student_assets
calculate_tier_from_bv
sync_student_cached_tier_from_wallet
```

가 표시됩니다.

권한 조회에서 `teacher_adjust_student_assets`는:

```text
authenticated | EXECUTE
service_role  | EXECUTE
```

만 표시되어야 합니다.

`anon`이나 `PUBLIC`이 보이면 테스트를 중단하고 결과를 공유합니다.

Realtime 결과에는:

```text
transactions
wallets
```

가 표시되어야 합니다.

## 2. 프론트 빌드

프로젝트 루트에서:

```bash
npm ci
npm run build
npm run dev
```

### 기대 결과

```text
npm run build
```

가 오류 없이 끝납니다. Chunk 크기 경고는 빌드 실패가 아닙니다.

## 3. 교사 화면 진입

```text
교사 로그인 → 학급 운영
```

화면 상단에:

```text
학생 자산 지급·차감
```

패널이 보여야 합니다.

확인:

- 활성 학생 목록
- 브랜드명/실명
- 현재 BV
- 현재 GOLD
- 검색
- 전체 선택
- 선택 초기화

F12 → Network → Fetch/XHR를 열어 두고 400~500 오류가 없는지 확인합니다.

## 4. 단일 학생 BV 지급

- 학생 한 명 선택
- 자산: BV
- 방식: 지급
- 금액: `1`
- 사유: `기능 테스트 BV 지급`
- 확인 → 확정 실행

### 기대 결과

- 성공 토스트
- 마지막 작업 완료 표시
- 교사 목록의 학생 BV가 1 증가
- 새로고침 후에도 유지
- 학생 화면의 BV가 즉시 또는 수 초 내 1 증가
- 임계값을 넘었다면 티어도 즉시 변경
- 학생 자산 기록에 양수 거래 생성
- source type이 `TEACHER_GRANT`
- 메모에 `기능 테스트 BV 지급` 포함
- Network 400~500 없음

## 5. 단일 학생 BV 원상복구

같은 학생에게:

- 자산: BV
- 방식: 차감
- 금액: `1`
- 사유: `기능 테스트 BV 원상복구`

### 기대 결과

- BV가 원래 값으로 복구
- 거래 기록에 음수 BV
- source type이 `BV_REVOKE`

## 6. GOLD 지급과 원상복구

GOLD 1로 같은 절차를 수행합니다.

지급:

```text
기능 테스트 GOLD 지급
```

원상복구:

```text
기능 테스트 GOLD 원상복구
```

기대 source type:

- 지급: `TEACHER_GRANT`
- 차감: `TEACHER_DEDUCT`

## 7. 잔액 부족 차단

학생 한 명 선택 후 현재 잔액보다 큰 차감액을 입력합니다.

### 기대 결과

프론트에서:

```text
잔액이 부족한 학생이 있습니다.
```

가 표시되고 실행 버튼이 비활성화됩니다.

개발자 도구에서 억지로 호출하더라도 DB의 `create_transaction`이 음수 잔액을 거부해야 합니다.

## 8. 다중 학생 지급

2명의 학생을 선택합니다.

- BV
- 지급
- 1
- `기능 테스트 다중 지급`

### 기대 결과

- 2명 모두 +1
- 두 거래가 각각 생성
- 성공 결과 2명
- 한 명만 반영되는 부분 성공 없음

이후 같은 학생 2명을 대상으로 BV 1을 차감해 원상복구합니다.

## 9. 원자성 확인

잔액이 서로 다른 학생 2명을 선택하고, 한 학생에게는 부족한 차감액이 되도록 설정합니다.

프론트에서 차단되는 것이 정상입니다.

DB 호출이 실행되더라도 한 학생의 잔액 부족으로 함수가 실패하면:

```text
두 학생 모두 변경되지 않아야 함
```

## 10. 권한 확인

학생 계정에서 교사용 RPC를 직접 호출할 수 있는지가 아니라, RPC 내부 권한 검사가 핵심입니다.

학생 계정으로 교사 기능 URL에 접근하거나 RPC를 호출하면 실패해야 합니다.

기대 오류:

```text
교사 또는 관리자 권한 필요
```

## 11. 최종 체크리스트

- [ ] migration 실행 성공
- [ ] 전용 RPC 권한에 anon/PUBLIC 없음
- [ ] `npm run build` 성공
- [ ] 교사 패널 학생 24명 정상
- [ ] 단일 BV 지급
- [ ] 단일 BV 차감
- [ ] 단일 GOLD 지급
- [ ] 단일 GOLD 차감
- [ ] 다중 지급·차감
- [ ] 잔액 부족 차단
- [ ] 학생 화면 Realtime 갱신
- [ ] 거래 기록과 사유
- [ ] 티어 즉시 갱신
- [ ] Network 400~500 없음

오류가 나면 다음 세 가지를 보냅니다.

```text
Request URL
Status Code
Response JSON
```
