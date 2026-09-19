# Feature 4 정적 검증 결과

검증 기준: Feature 3 소스 위에 F4A/F4B/F4C/F4D 통합 구현 후 최종 작업본.

## 통과한 검사

- `node node_modules/typescript/bin/tsc -b` — **PASS, TypeScript 오류 0개**
- `node node_modules/typescript/bin/tsc --noEmit --project tsconfig.json` — **PASS**
- `python scripts/validate_feature4_static.py` — **PASS**
  - F4A~D migration 존재
  - 각 모듈 1 BEGIN / 1 COMMIT
  - bundle 4 BEGIN / 4 COMMIT
  - Feature4 RPC wrapper ↔ SQL 함수 정의 대응
  - 학생/교사 신규 route 존재
  - 구 돌발퀘스트 placeholder 제거
- 프론트 service-role 비밀키 패턴 검색 — **PASS**
- Feature4에서 사용하는 기존 테이블/핵심 함수명을 `live_public_schema_2026-08-04.sql`과 대조 — **PASS**
- Feature4 SQL의 `$$` delimiter 짝 검사 — **PASS**
- Feature3 대비 수정 파일 범위를 별도 diff로 확인 — Feature4 통합에 필요한 라우팅/대시보드/출석/알림/분석 및 신규 파일에 한정

## SQL 안전장치

- F4A/F4B/F4C/F4D 독립 트랜잭션
- 모듈별 SQLSTATE `P4Axx/P4Bxx/P4Cxx/P4Dxx`
- 외부 RPC는 정확한 함수 시그니처만 authenticated에 GRANT
- 내부 helper는 브라우저 직접 EXECUTE 차단
- F4D 계산 함수도 브라우저 직접 실행 차단 후 교사 wrapper/cron 경유
- 돌발퀘스트 완료, 과제 보상, 출석 입력/정정은 DB 트랜잭션 내부 처리
- 출석 정정은 보상 역분개 실패 시 전체 롤백
- 과제 RETURNED 후 재제출이 있어도 제출 GOLD는 학생×과제 기준으로 중복 지급하지 않음
- 만료 비상사태는 pg_cron + 학급 화면 진입 안전망의 두 경로가 모두 멱등 처리

## Vite bundle 검증 제한

Assistant Linux 환경에서 `vite build`를 실행했으나, 작업에 사용한 기존 `node_modules`가 다른 플랫폼에서 생성되어 Rollup의 Linux native optional package가 없습니다.

오류:

`Cannot find module @rollup/rollup-linux-x64-gnu`

따라서 **Vite 최종 번들 성공 여부는 사용자 Windows 환경에서** 아래 명령으로 확인해야 합니다.

```bash
npm ci
npm run build
npm run dev
```

이 제한은 TypeScript 소스 오류와 별개이며, `tsc -b`와 `tsc --noEmit`은 모두 통과했습니다.

## 아직 하지 않은 것

- 운영 Supabase에 Feature4 bundle 실제 적용
- 실제 학생/교사 브라우저 E2E
- 과거 1.0 실제 데이터 이관
- Feature3 경매의 사용자 최종 E2E (사용자가 추후 별도 검증 예정)

따라서 Feature4의 현재 상태는 **구현 + 정적 검증 완료 / 운영 적용 및 사용자 E2E 대기**입니다.
