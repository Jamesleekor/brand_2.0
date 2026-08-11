# B.R.A.N.D 2.0 — Feature 4 적용 시작

Feature 4는 네 영역을 한 버전에 묶었지만 **DB migration은 F4A/F4B/F4C/F4D 네 개의 독립 트랜잭션으로 분리**했습니다. 오류가 발생하면 오류 메시지의 `[F4A]`, `[F4B]`, `[F4C]`, `[F4D]`만으로 첫 추적 위치를 바로 알 수 있습니다.

## 전제

- Feature 1, Feature 2 migration은 이미 적용되어 있어야 합니다.
- Feature 3 경매 migration도 이미 적용된 상태를 기준으로 합니다.
- Feature 3 브라우저 E2E는 사용자가 추후 천천히 검증하기로 했으므로 이 패키지에서는 **잠정 통과로 가정**할 뿐 최종 검증 완료라고 기록하지 않습니다.
- 이번 패키지는 기존 1.0의 과거 길드·업적·금융 등 **실제 데이터 이관을 수행하지 않습니다.**

## 1. Supabase 적용

SQL Editor → New query에서 다음 파일 **하나만** 실행합니다.

`supabase/migrations/20260807_02_feature4_bundle.sql`

전체 스키마 파일을 다시 실행하지 마세요.

정상 종료 시 마지막 결과표에 아래 네 행이 모두 `true`로 나와야 합니다.

- F4A true
- F4B true
- F4C true
- F4D true

### 오류가 나면

오류 문구를 그대로 보관하세요. 예:

- `[F4A] ...` → 우편·알림·활동 피드
- `[F4B] ...` → 비상사태·경제수호대·돌발 퀘스트
- `[F4C] ...` → 출석·과제
- `[F4D] ...` → 기록실·랭킹·분석

각 모듈은 독립 COMMIT이므로 F4A/F4B까지 성공한 뒤 F4C가 실패했다면 앞의 A/B는 유지됩니다. **실패 모듈만 수정 후 해당 개별 SQL을 재실행**하는 방식으로 복구합니다.

개별 파일:
- `20260807_02a_feature4_communications.sql`
- `20260807_02b_feature4_operations.sql`
- `20260807_02c_feature4_learning.sql`
- `20260807_02d_feature4_records.sql`

## 2. 자동 post-check

bundle 성공 뒤 새 Query에서:

`supabase/migrations/20260807_02_feature4_postcheck.sql`

을 실행합니다. 객체 존재, 외부/내부 함수 권한, Realtime publication을 한 번에 점검합니다.

## 3. 프론트 빌드

Windows 프로젝트 루트:

```bash
npm ci
npm run build
npm run dev
```

## 4. Feature4 자체 진단

교사 로그인 → **기록실** → `Feature4 진단 실행`

F4A/F4B/F4C/F4D와 Realtime 카드에서 boolean 값은 가능한 한 모두 ✅여야 합니다. 숫자 값이 0인 것은 데이터가 아직 없다는 뜻일 수 있으므로 오류가 아닙니다.

## 5. 페이지

학생:
- `/mail` — 우편·알림·활동
- `/assignments` — 과제 제출·채점 결과 확인
- `/records` — 명예의 전당·공식 랭킹
- `/` — 돌발 퀘스트 배너

교사:
- `/teacher/communications` — 우편·전역 알림
- `/teacher/operations` — 비상사태·경제수호대·돌발 퀘스트
- `/teacher/learning` — 오늘 출석·과제 생성·채점
- `/teacher/records` — 기록 갱신·명예의 전당·진단
- `/teacher/analytics` — 기존 분석 화면에 F4D 오류 추적 표시 추가

## pg_cron 주의

F4B는 만료된 비상사태를 1분마다 정리하는 pg_cron 등록을 시도합니다. cron 등록이 불가능하면 SQL은 실패하지 않고 NOTICE를 남깁니다. 그 경우에도 학생/교사 대시보드 진입 시 `finalize_expired_emergencies_for_classroom`가 만료 상태를 안전하게 정리하므로 상태가 계속 ACTIVE로 남는 문제를 방지합니다.

---

## Feature 4.1 안정화 패치 (2026-08-08)

실제 교사/학생 E2E 검증 후 안정화 패치가 추가되었습니다. 신규 적용은 먼저 기존 Feature 4를 기준 상태로 만든 뒤 다음 문서를 읽으십시오.

- `FEATURE4_1_STABILIZATION.md`
- `supabase/migrations/20260808_01_feature4_1_stabilization.sql`
- 적용 후 `supabase/migrations/20260808_01_feature4_1_postcheck.sql`
- `VALIDATION_RESULTS_FEATURE4_1.md`

---

## 2026-08-08 Feature 4.1.1 추가 적용

실제 E2E 검증에서 발견된 UI/Realtime/schema-cache 보정은 `FEATURE4_1_1_STABILIZATION.md`를 우선 확인하십시오.
현재 DB에서 `emergency_quest_requests` schema cache 오류가 있었다면 `supabase/APPLY_FEATURE4_1_1_CUMULATIVE.sql`을 적용하는 것이 권장 경로입니다.
