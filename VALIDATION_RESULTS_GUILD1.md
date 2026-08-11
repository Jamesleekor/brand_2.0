# Guild 1 Validation Results

## 정적 검증

- 기준 패키지: `brand_app_feature4_1_5_auction_operations_buildfix.zip`
- `src/` TS/TSX: 64개
- TypeScript 5.8.3 `transpileModule` parser 검사: **syntax/transpile error 0**
- `supabase/migrations/20260811_02_guild1_foundation.sql`과 `supabase/APPLY_GUILD1_FOUNDATION.sql`: **동일 내용 확인**
- migration: 단일 `BEGIN ... COMMIT`, dollar quote 짝수 확인
- 기존 baseline 대비 변경 범위를 Guild 1 관련 파일 + App route + TeacherShell navigation + README로 제한

## 전체 npm build 상태

이 실행 환경에는 npm 패키지가 캐시되어 있지 않아 완전한 `npm ci`를 수행할 수 없었다.

```text
npm ci --offline --no-audit --no-fund
→ ENOTCACHED: zustand-5.0.14.tgz
```

부분 설치 상태에서 `npm run build`를 시도했을 때는 React/Node/Babel 등의 type definition 자체가 누락되어 `TS2688 Cannot find type definition file`로 중단됐다. 이는 소스 타입 오류 판정으로 사용할 수 없는 환경 오류다.

따라서 실제 전체 semantic type-check + Vite build는 사용자의 정상 npm registry 환경에서 반드시:

```bash
npm ci
npm run build
```

로 확인한다.

## DB 검증 상태

실제 Supabase 운영 DB에는 이 환경에서 접속/적용하지 않았다. migration에는 다음 preflight를 포함한다.

- 필수 기존 테이블/identity helper 존재 확인
- 중복 활성 membership 발견 시 중단
- guilds/guild_members/guild_seasons의 지원하지 않는 필수 legacy 컬럼 발견 시 중단
- 기존 복수 ACTIVE 시즌 발견 시 중단

적용 후 `20260811_02_guild1_foundation_postcheck.sql`과 교사 화면의 `Guild 1 진단`을 실행해야 한다.
