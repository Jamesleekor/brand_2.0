# 기능 구현 보고서 — 교사 BV/GOLD 지급·차감

## 1. 구현 목표

교사가 학급 운영 패널에서 학생 한 명 또는 여러 명을 선택해 다음 작업을 수행할 수 있도록 구현했습니다.

- BV 지급
- BV 차감
- GOLD 지급
- GOLD 차감
- 단일 학생 선택
- 다중 학생 선택
- 이름·브랜드명·티어 검색
- 현재 검색 결과 전체 선택/해제
- 1인당 금액 입력
- 지급·차감 사유 입력
- 실행 전 최종 확인
- 성공 토스트와 마지막 작업 요약
- 오류 원인별 사용자 메시지
- 처리 후 교사 잔액 목록과 대시보드 재조회
- 학생 지갑과 거래 기록 Realtime 반영
- BV 변경 시 티어 자동 동기화

## 2. 프론트 변경 사항

### 새 파일

```text
src/features/teacher/AssetAdjustmentPanel.tsx
```

주요 기능:

- 운영 DB의 활성 학생과 지갑 조회
- `STUDENT`, `STUDENT_LEADER`, `GUARD` 역할만 표시
- 전출 학생 제외
- 단일·다중 선택
- 지급/차감 및 BV/GOLD 선택
- 금액 1~10,000,000 정수 검증
- 사유 2~200자 검증
- 차감 전 클라이언트 잔액 부족 안내
- 실행 확인 모달
- 다중 처리 원자성 안내
- RPC 성공 후 관련 React Query 캐시 무효화 및 재조회

### 수정 파일

```text
src/features/teacher/ClassroomControl.tsx
```

- 학급 운영 화면 상단에 자산 지급·차감 패널 추가

```text
src/features/teacher/TeacherDashboard.tsx
```

- 빠른 실행 첫 항목을 `자산 지급·차감`으로 연결

```text
src/lib/zod_schemas/teacher_schemas.ts
```

- `TeacherAdjustStudentAssetsSchema` 추가

```text
src/lib/rpc/student_rpc.ts
```

- `TeacherAssetAdjustmentResult` 타입 추가
- `teacherRpc.adjustStudentAssets()` 추가

```text
src/lib/rpc/error_handler.ts
```

- P0600~P0608 오류 메시지 추가

```text
src/features/dashboard/DashboardPage.tsx
src/features/profile/ProfilePage.tsx
```

- 학생 화면의 티어를 현재 `wallet.bv`에서 즉시 계산하도록 수정
- 오래된 인증 컨텍스트의 `cached_tier`만 기다리지 않음

## 3. DB migration

파일:

```text
supabase/migrations/20260806_01_teacher_asset_adjustment.sql
```

### 외부 RPC

정확한 시그니처:

```sql
public.teacher_adjust_student_assets(
  p_student_ids integer[],
  p_value_token public.value_token_type,
  p_amount bigint,
  p_reason text
)
```

반환:

```text
student_id
transaction_id
new_balance
```

### 서버 검증

RPC 내부에서 다음을 검증합니다.

- 로그인 여부
- 교사 또는 관리자 권한
- 교사에게 연결된 활성 학급
- 학생 수 1~100명
- 중복 또는 NULL 학생 ID 금지
- 담당 학급의 활성 학생만 허용
- BV/GOLD만 허용
- 금액은 0이 아니고 절댓값 10,000,000 이하
- 사유는 2~200자
- 차감 후 잔액이 음수가 되면 기존 `create_transaction`에서 거부

### 원자성

다중 학생 처리는 하나의 PostgreSQL 함수 호출 안에서 수행됩니다.

한 학생이라도 다음 문제로 실패하면 전체 호출이 롤백됩니다.

- 다른 학급 학생
- 전출 학생
- 지원하지 않는 역할
- 지갑 없음
- 잔액 부족
- 기타 DB 검증 실패

부분적으로 지급되고 일부만 실패하는 상태를 만들지 않습니다.

### 거래 분류

- 양수 지급: `TEACHER_GRANT`
- BV 차감: `BV_REVOKE`
- GOLD 차감: `TEACHER_DEDUCT`

거래 메모에는 교사가 입력한 사유가 저장됩니다.

### P0 보안 유지

내부 함수:

```text
create_transaction
```

은 브라우저 역할에 다시 공개하지 않습니다.

migration에서 다음 상태를 재확인합니다.

```text
PUBLIC: 실행 불가
anon: 실행 불가
authenticated: 실행 불가
service_role: 실행 가능
```

브라우저가 호출할 수 있는 것은 권한과 학급을 검사하는 전용 RPC뿐입니다.

## 4. BV 티어 동기화

migration은 프론트의 22단계 티어 임계값과 일치하는 내부 계산 함수와 지갑 트리거를 추가합니다.

```text
wallets.bv 변경
  → students.cached_tier 자동 갱신
```

기존 학생 데이터도 migration 적용 시 한 번 정합화합니다.

학생 대시보드와 프로필에서는 `wallet.bv`로 티어를 즉시 계산하므로 Realtime 지갑 UPDATE가 도착하면 화면 티어도 함께 갱신됩니다.

## 5. Realtime

migration은 `supabase_realtime` publication이 존재할 경우 다음 테이블을 조건부로 추가합니다.

```text
wallets
transactions
```

이미 등록되어 있으면 중복 추가하지 않습니다.

학생의 기존 `useWallet()` 구독은:

- 본인 wallet UPDATE → 잔액 캐시 즉시 변경
- 본인 transaction INSERT → 거래 기록 재조회

를 수행합니다.

## 6. 타입 검사 결과

이 작업본에 대해 다음 TypeScript project build를 실행했습니다.

```bash
tsc -b
```

결과:

```text
성공 — TypeScript 오류 없음
```

## 7. 전체 Vite build 환경 제한

작업 환경에서 사용자가 업로드한 `node_modules`는 Windows용 Rollup 선택 패키지를 포함하고 있었습니다. 현재 작업 컨테이너는 Linux이므로 그 `node_modules`로 Vite bundle을 만들 수 없었습니다.

또한 작업 환경의 내부 npm mirror에는 잠금 파일이 요구한 `zustand@5.0.14`가 없어 새 `npm ci`를 완료하지 못했습니다.

따라서:

- TypeScript `tsc -b`: 성공
- Linux 컨테이너 Vite bundle: 플랫폼별 Rollup 의존성 문제로 미실행
- 사용자 Windows PC: `npm ci` 후 `npm run build`로 최종 확인 필요

이는 확인되지 않은 코드 오류를 성공으로 주장하는 것이 아니라, 테스트 환경의 패키지 플랫폼 차이를 명시한 것입니다.

## 8. 아직 포함하지 않은 기능

이번 묶음은 교사 BV/GOLD 지급·차감만 대상으로 합니다.

다음은 별도 구현 대상입니다.

- 거래 회수/되돌리기 UI
- 간식 등록·구매
- 꾸미기 구매·장착
- 길드 관리
- 업적 전체 신청·승인
- 경매 전체 흐름
- 복지기금 실제 분배
