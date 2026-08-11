# B.R.A.N.D 2.0 Frontend

React + TypeScript + Vite + Supabase 기반 학급 경제·게임화 앱입니다.

## 현재 패키지 기준

- Feature 1~2 경제 코어
- Feature 3 실시간 경매 + 운영 보강
- Feature 4 학급 운영 안정화
- **Guild 1 Foundation**: 길드/멤버 이력, 시즌, 길드 세션 snapshot, 교사 길드 운영

## 이번 버전 시작점

먼저 읽기:

```text
START_HERE_GUILD1.md
```

DB migration:

```text
supabase/APPLY_GUILD1_FOUNDATION.sql
```

실행:

```bash
npm ci
npm run build
npm run dev
```

Guild 1 핵심 E2E는 `GUILD1_FOUNDATION_TEST_PLAN.md`를 따른다.
