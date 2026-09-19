# B.R.A.N.D 2.0 — 교사 자산 지급·차감 기능 적용 안내

이 프로젝트에는 교사가 한 명 또는 여러 학생을 선택하여 **BV 또는 GOLD를 지급·차감**하는 기능이 추가되어 있습니다.

## 반드시 지켜야 할 적용 순서

### 1. 운영 DB에 migration 적용

Supabase Dashboard에서 다음 경로로 이동합니다.

```text
SQL Editor → New query
```

아래 파일을 열어 전체 내용을 붙여넣고 한 번 실행합니다.

```text
supabase/migrations/20260806_01_teacher_asset_adjustment.sql
```

성공하면 결과 영역에 다음 함수가 확인되어야 합니다.

```text
teacher_adjust_student_assets
calculate_tier_from_bv
sync_student_cached_tier_from_wallet
```

또한 `teacher_adjust_student_assets`의 EXECUTE 권한은 다음만 보여야 합니다.

```text
authenticated
service_role
```

`anon` 또는 `PUBLIC`이 보이면 기능 테스트를 중단하세요.

### 2. 프론트 설치 및 빌드

프로젝트 루트에서:

```bash
npm ci
npm run build
npm run dev
```

### 3. 교사 화면에서 기능 확인

```text
교사 로그인 → 학급 운영 → 학생 자산 지급·차감
```

먼저 테스트 학생 한 명에게 BV 1을 지급하여 확인합니다.

## 보안 구조

브라우저는 내부 함수 `create_transaction`을 직접 호출하지 않습니다.

```text
교사 브라우저
  → teacher_adjust_student_assets
      → 교사 권한 확인
      → 담당 학급 및 학생 검증
      → create_transaction 내부 호출
      → 지갑과 거래 기록을 하나의 DB 트랜잭션으로 처리
```

`create_transaction`은 기존 P0 보안 정책대로 `service_role` 전용 상태를 유지합니다.

## 상세 문서

- `FEATURE1_TEACHER_ASSET_IMPLEMENTATION.md`
- `FEATURE1_TEACHER_ASSET_TEST_PLAN.md`
