# Feature 2 정적 검증 결과

검증일: 2026-08-06

## 통과

```text
TypeScript project build: tsc -b
결과: 오류 0개
```

정적 검색 확인:

- 프론트에서 `create_transaction` 직접 호출 없음
- 프론트에서 `reverse_transaction` 직접 호출 없음
- 프론트에서 `collect_to_welfare_fund` 직접 호출 없음
- service_role 키 또는 문자열을 프론트 코드에 추가하지 않음
- 새 학생 RPC는 Zod 입력 검증을 거침
- 새 교사 취소 RPC는 Zod 입력 검증을 거침
- 프로필 기부 합계가 `DONATION` 기준으로 수정됨
- `useWallet()` 중복 호출 제거
- migration에서 사용하는 거래 유형·화폐·비상사태 ENUM 값이 운영 덤프에 모두 존재함
- migration의 함수 시그니처가 운영 덤프의 기존 함수와 일치함

## 이 작업 환경에서 완료하지 못한 검증

Vite 번들은 코드 오류가 아니라 작업 환경의 플랫폼 의존 패키지 문제로 실행하지 못했습니다.

```text
현재 작업용 node_modules: Windows용
실행 환경: Linux
누락: @rollup/rollup-linux-x64-gnu
```

사용자 Windows 환경에서 아래 명령으로 최종 검증해야 합니다.

```bash
npm ci
npm run build
```

## 운영 DB 검증

SQL migration은 실제 운영 DB에 아직 적용하지 않았습니다. Supabase SQL Editor에서 migration을 실행한 뒤 파일 마지막의 함수·권한 결과를 확인해야 합니다.
