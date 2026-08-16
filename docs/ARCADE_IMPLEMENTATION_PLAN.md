# B.R.A.N.D Arcade — Production Integration Plan

**Status:** 01~09 production 적용 및 Arcade Core/Game #01 화면 구현 완료 — 10 Game #01 NO GO 통과 검증 수정 migration 적용 대기  
**Date:** 2026-08-14  
**Product/game source of truth:** 사용자 제공 `ARCADE_SPEC.md` (2026-08-13)  
**Scope of this document:** Game #01을 포함한 Arcade 0.1을 기존 B.R.A.N.D 2.0에 안전하게 붙이는 방법. 이 문서는 게임 규칙을 변경하지 않는다.

---

## 1. 결론과 현재 중단 지점

Game #01은 별도 학생 계정·별도 길드·별도 GS 체계를 만들지 않고, 현재의 학생 identity와 Guild 2A 개인기여도에 연결하는 것이 맞다.

이 작업 환경은 production Supabase에 직접 접속할 수 없지만, 사용자가 2026-08-14에 [PREFLIGHT_ARCADE_INTEGRATION.sql](../supabase/PREFLIGHT_ARCADE_INTEGRATION.sql)을 production SQL Editor에서 실행했고 Section 1~13 전체 결과를 공유했다. 그 결과를 아래 계획에 반영했다.

그 결과, Arcade 관련 기존 table은 없고 기존 `rankings`는 Arcade에 재사용할 수 없는 legacy 일일 랭킹임이 확인됐다. 따라서 기존 학생·길드·Guild 2 GS 구조는 재사용하되, 게임 고유 기록은 새 `arcade_*` table로 추가한다. **이 단계에서는 Arcade migration이나 게임 코드를 아직 작성하지 않는다.**

---

## 2. 조사 결과와 근거 수준

### 2.1 실제 production에서 확인된 사실

Guild 2 작업 때 사용자가 실행·공유한 production preflight 및 이후 E2E, 그리고 2026-08-14 Arcade preflight Section 1~13에서 다음을 확인했다.

- `students.user_id`는 `auth.users(id)`를 참조한다. 즉 Arcade는 `auth.uid()` → `students.id` → `classroom_id`라는 기존 identity 연결을 그대로 사용한다.
- `current_student_id()`는 로그인한 활성 학생의 `students.id`를, `current_classroom_id()`는 학생의 학급 또는 교사 전용 계정의 활성 담당 학급을 반환한다. `get_current_user_context()`은 이 context를 제공한다.
- `students`, `guilds`, `guild_seasons`, `guild_members`, `guild_membership_events`, `guild_sessions`, `guild_session_participants`가 실제 존재한다.
- 길드 소속의 현재 판정은 `guild_members.left_at IS NULL`이며, 과거 소속과 세션 참가자 snapshot은 보존된다.
- 기존 `guild_gs`와 `guild_individual_contributions`는 BV 증가량 중심 legacy 구조다. Arcade를 여기에 쓰면 안 된다.
- Guild 2A의 별도 table인 `guild2_individual_contributions`, `guild2_gs_events`, `guild2_monthly_gs_summaries`와 교사 RPC가 production에 적용되어 E2E를 통과했다.
- Guild 2A는 `guild2_individual_contributions.arcade_raw_total`, `arcade_applied`, `arcade_status`를 이미 가지고 있다. 현재 `guild2_refresh_monthly_scores(integer, text)`는 매 재계산 때 이를 `0`, `0`, `NOT_READY`로 덮어쓴다.
- production의 현재 제약은 정확히 `guild2_contribution_arcade_applied_check` (`arcade_applied <= 90`) 및 `guild2_contribution_final_range_check` (`final_total <= 990`)이다. 이는 LOCKED Guild 2 규칙이며 Arcade adapter도 그대로 유지한다. 원본 Arcade 합계는 `arcade_raw_total`에 보존하고, Guild 2에 반영하는 값만 +90으로 제한한다.
- 기존 `rankings`는 약 100행의 일일 legacy 랭킹이다. `ranking_type`은 `TIER`, `BRAND_VALUE`, `GOLD_ASSET`, `CRYSTAL_ASSET`, `ACHIEVEMENT_COUNT`, `CONTRIBUTION`뿐이며, `game_id`·run·기간 snapshot·공식 점수 시간이 없다. `calculate_rankings(integer, date)`도 BV/자산/업적만 upsert한다. 따라서 이를 Arcade leaderboard로 재사용하거나 과거 행을 수정하지 않는다.
- 실제 browser 교사 쓰기는 `teacher_recalculate_guild2_scores(integer, text)`만 `authenticated` execute를 받으며, 내부 Guild 2 refresh helper는 `postgres`만 실행할 수 있다. 새 Arcade도 이 공개 RPC / 비공개 helper 경계를 따른다.
- `rankings`를 포함한 legacy table에는 넓은 authenticated DML grant가 일부 남아 있으나, `rankings` RLS는 현재 SELECT policy만 있다. Arcade는 이 오래된 grant 방식을 복제하지 않고 직접 table write를 전부 차단한다.
- Guild 2/Arcade 관련 table은 현재 Realtime publication에 하나도 없다. Arcade 0.1은 RPC 뒤 React Query refetch로 화면을 갱신하며, Realtime은 필요성이 확인될 때만 별도 migration으로 추가한다.
- `btree_gist` 1.7, `pgcrypto` 1.3, `uuid-ossp` 1.1이 production에 이미 있다. 새 extension 설치는 필요 없다.
- `teacher_record_guild_session_attendance(bigint, jsonb)`는 2026-08-13 후속 SQL에서 Guild 2 점수 재계산까지 연결됐다.

### 2.2 현재 repository에서 확인한 사실

아래는 local code 관찰 결과다. production과 100% 같다고 가정하지 않으며, preflight에서 다시 확인한다.

| 영역 | 확인한 파일/구조 | Arcade에서의 사용 계획 |
|---|---|---|
| 로그인 | `src/lib/supabase/auth_helpers.ts` | Supabase Auth 로그인 후 `get_current_user_context()`로 학생/학급 context를 가져온다. |
| 프런트 identity | `src/stores/auth_store.ts` | `studentId`, `classroomId`, `isTeacher`를 공통 source로 사용한다. Arcade가 별도 identity를 만들지 않는다. |
| 학생 라우팅 | `src/App.tsx`의 `ProtectedRoute`와 `AppShell` | 학생 Arcade는 보호된 `/arcade` 아래에 둔다. |
| 교사 라우팅 | `src/App.tsx`의 `ProtectedRoute requireTeacher` | 기간 설정·기록 무효화·snapshot은 `/teacher/arcade`에서만 한다. |
| RPC 패턴 | `src/lib/rpc/student_rpc.ts`, `src/lib/rpc/guild_rpc.ts` | Zod 검증 → `supabase.rpc()` → 일관된 성공/오류 결과 패턴을 따른다. |
| Guild 2 계산 | `supabase/migrations/20260812_02_guild2a_core.sql` | 새 Arcade snapshot을 읽어 기존 `guild2_refresh_monthly_scores`에 Arcade 부분만 추가한다. |
| 학생 길드 UI | `src/features/guild/GuildPage.tsx` | 기존 Arcade 카드의 `NOT_READY`를 월 snapshot 상세 표시로 교체한다. |
| 교사 길드 UI | `src/features/guild/GuildScoreAdmin.tsx` | 기존 `arcade_raw_total`, `arcade_applied`, `arcade_status` 표시를 재사용한다. |
| Realtime 패턴 | `src/lib/realtime/subscriptions.ts` 및 Guild 2 페이지의 query invalidation | production에는 관련 publication이 없으므로 Arcade 0.1은 RPC 성공 뒤 query invalidation/refetch를 사용한다. |

### 2.3 preflight 결론이 설계에 주는 의미

- Arcade 전용 identity, 길드 membership, 별도 Guild GS ledger는 만들지 않는다.
- `rankings`는 보존 전용 legacy 일일 랭킹으로 두고 Arcade에 사용하지 않는다.
- `arcade_ranking_periods`는 `guild_seasons`를 FK로 연결하되, 교사가 월간 날짜를 조절할 수 있으므로 period 자체는 새 table로 둔다.
- production에 `btree_gist`가 있으므로 같은 학급·같은 종류의 활성 기간 겹침은 range exclusion constraint로 막는다.
- Arcade의 공식 점수·snapshot·Guild 2 반영은 기존 내부 Guild 2 helper처럼 비공개 `SECURITY DEFINER` helper에서만 수행한다.

---

## 3. 재사용과 새로 만들 부분

### 그대로 재사용

- **학생 identity:** Supabase Auth → 현재 사용자 context → `student_id` / `classroom_id`
- **교사 권한:** `ensure_teacher_role()` 및 classroom scope 검증
- **길드 관계:** `guild_members`와 Guild 1 history. Arcade는 길드 membership을 저장하거나 수정하지 않는다.
- **시즌 관계:** `guild_seasons`는 Arcade season period의 연결 대상이다. 같은 날짜라면 Season 2를 참조한다.
- **GS 계산:** `guild2_individual_contributions`의 Arcade 열과 `guild2_gs_events`의 기존 개인 기여도 ledger 흐름
- **학생/교사 UI 보호:** 기존 React protected route와 Zustand auth store
- **서버 쓰기 보안:** PostgreSQL `SECURITY DEFINER` RPC, 고정 `search_path`, explicit `GRANT`/`REVOKE`

### 재사용하지 않는 legacy 구조

- **`rankings`:** 날짜별 기존 경제/성장 랭킹이다. `UNIQUE (classroom_id, student_id, as_of_date, ranking_type)`와 `calculate_rankings()`의 upsert 방식은 “한 기간·한 게임·학생별 최고 공식 run 1개”라는 Arcade 규칙을 표현할 수 없다. 기존 약 100행을 보존하고 Arcade에는 쓰지 않는다.

### Arcade 때문에 새로 필요한 부분

- 게임 registry와 규칙 version
- 교사가 날짜를 조절할 수 있는 Arcade ranking period
- 서버가 발급하고 검증하는 게임 run/session과 raw input audit
- 학생별 최고점 leaderboard query
- 월간 Top 10을 고정 보존하는 game별 ranking snapshot
- 교사용 월 snapshot 실행과 기록 무효화 기능
- Arcade Core, MiniGame Framework, Game #01 화면

이것들은 게임 고유 데이터이므로 새 table이 필요하다. 그러나 학생·길드·Guild GS를 복제하는 table은 만들지 않는다.

---

## 4. 통합 흐름

```text
학생 로그인
  → 기존 auth.uid() / current_student_id() / current_classroom_id()
  → Arcade Core가 본인용 run 발급
  → Game #01이 D/F/J/K 입력을 기록
  → 서버가 규칙 version·seed·입력 event로 공식 점수 재계산
  → 학생별 최고점 leaderboard (월/시즌)
  → 교사가 월간 Arcade snapshot을 명시적으로 확정
  → Guild 2A 재계산이 finalized snapshot의 game별 보너스를 그대로 합산
  → 기존 Guild 2A 개인기여도 / GS ledger / 학생 길드 카드에 표시
```

중요: 게임을 할 때는 GS가 바뀌지 않는다. **월간 snapshot을 교사가 확정할 때만** Guild 2A의 Arcade contribution이 반영된다.

---

## 5. 제안 DB 구조

아래는 production preflight 결과를 반영해 확정한 Arcade 전용 구조다. 이는 기존 system과 중복하지 않는 게임 고유 데이터다.

### 5.1 `arcade_games`

게임 registry다. `game1`~`game6` 같은 고정 column은 만들지 않는다.

- `id` bigint primary key
- `code` text unique — 첫 값은 `focus_reaction_01`
- `internal_name` text — 현재는 내부 이름만 사용; 학생용 lore 이름은 미정
- `is_active` boolean
- `available_from` 필수, `available_until` 선택 — 과거 월 snapshot에 나중 추가한 게임이 섞이지 않게 하는 게임 공개 범위
- `created_at`, `updated_at`

### 5.2 `arcade_game_rule_versions`

게임 규칙 version을 보존한다. 과거 run이 나중의 밸런스 변경으로 다시 계산되지 않게 한다.

- `id` bigint primary key
- `game_id` FK → `arcade_games`
- `version_code` text
- `config` jsonb — Game #01의 locked difficulty/score/combo/GO-NO-GO 값을 저장
- `is_active` boolean
- `created_by_user_id`, `created_at`
- `UNIQUE (game_id, version_code)`

Game #01 v0.1 config에는 `ARCADE_SPEC.md`의 Easy~Extreme 값, Overdrive 30초 증가값, Life 3, 600ms recovery, score formula, combo 표를 그대로 넣는다. 설정을 table에 두는 이유는 나중의 밸런스 조정 시 core 코드를 다시 설계하지 않기 위해서이며, 기존 run의 version row는 수정하지 않는다.

### 5.3 `arcade_ranking_periods`

월간/시즌 leaderboard의 teacher-configurable 기간이다.

- `id` bigint primary key
- `classroom_id` FK → existing `classrooms`
- `period_kind` text check: `MONTHLY` / `SEASON`
- `display_name` text
- `guild_season_id` nullable FK → existing `guild_seasons` (season period의 연결 정보)
- `contribution_year_month` varchar(7), monthly period에서 필수
- `starts_at` timestamptz
- `ends_at_exclusive` timestamptz
- `status` text check: `DRAFT` / `ACTIVE` / `FINALIZED`
- `created_by_user_id`, `created_at`, `updated_at`

화면에서는 교사가 시작일·종료일을 날짜로 고른다. DB에는 한국 시간 기준 종료일 다음 날 00:00을 `ends_at_exclusive`로 저장해 “23:59:59” 같은 취약한 경계를 만들지 않는다. 월간 기간은 어떤 `YYYY-MM` Guild 2 contribution에 넣을지를 `contribution_year_month`으로 명시한다.

production에 `btree_gist` 1.7이 확인됐다. 따라서 같은 학급·같은 `period_kind`의 기간이 겹치지 않게 `tstzrange(starts_at, ends_at_exclusive, '[)')` range exclusion constraint를 사용한다. 교사 RPC의 transaction lock은 동시 수정 방어를 위해 함께 둔다.

### 5.4 `arcade_runs`

한 번의 실제 플레이 run이다. 학생이 이 table에 직접 INSERT/UPDATE하지 않는다.

- `id` bigint primary key — production의 기존 `rankings`, Guild 2 ledger/summary와 같은 기록 table 관례를 따른다.
- `classroom_id`, `student_id`, `game_id`, `rule_version_id` FK
- `status`: `READY`, `COUNTDOWN`, `PLAYING`, `GAME_OVER`, `SUBMITTING`, `VERIFIED`, `REJECTED`, `EXPIRED`
- 서버가 만든 deterministic seed 또는 동등한 schedule identity
- `countdown_started_at`, `play_started_at`, `game_over_at`, `submitted_at`, `verified_at`
- `official_score` nullable, `official_duration_ms` nullable
- `stats` jsonb (accuracy, maxCombo, misses 등 low-cost 항목)
- `rejection_code`, `rejection_reason` nullable
- `created_at`

공식 점수는 client가 보낸 숫자를 저장하지 않고, 서버 검증이 성공했을 때 한 번만 기록한다.

### 5.5 `arcade_run_submissions`

플레이 종료 시 제출된 입력 event audit이다.

- `id` bigint primary key
- `run_id` FK → `arcade_runs`, `UNIQUE (run_id)`
- `input_events` jsonb — `{ elapsed_ms, lane }` 배열
- `input_event_count`, `submitted_at`, `payload_hash`
- 서버가 계산한 검증 metadata

입력 event에는 **점수 field가 없다.** JSON 크기/건수/시간 순서에는 server-side 상한과 validation을 둔다.

### 5.6 `arcade_monthly_finalizations` / `arcade_monthly_snapshots` / monthly rank snapshots

월간 GS 반영의 불변 근거다.

`arcade_monthly_finalizations`:

- `classroom_id`, `period_id`, `contribution_year_month`
- 확정 당시 active game 수
- `finalized_by_user_id`, `finalized_at`
- `UNIQUE (period_id)`

이 parent row는 “한 game snapshot만 존재”하는 상태와 “그 달 전체 Arcade가 정상 확정”된 상태를 구분한다.

`arcade_monthly_snapshots`:

- `finalization_id`, `classroom_id`, `period_id`, `game_id`, `contribution_year_month`
- `created_by_user_id`, `created_at`
- `UNIQUE (period_id, game_id)`

`arcade_monthly_snapshot_entries`:

- `snapshot_id` FK
- `student_id` FK
- `source_run_id` FK
- `rank` (1~10)
- `official_score`, `achieved_at` (source run의 `game_over_at` 값을 복사해 보존)
- `raw_bonus` (30 / 27 / 24 / 18 / 15)
- `UNIQUE (snapshot_id, student_id)` and `UNIQUE (snapshot_id, rank)`

`arcade_monthly_snapshot_student_ranks`:

- 같은 `snapshot_id`에서 **참여한 모든 학생**의 최종 best run을 보존
- `student_id`, `source_run_id`, `rank`, `official_score`, `achieved_at`
- `UNIQUE (snapshot_id, student_id)` and `UNIQUE (snapshot_id, rank)`
- `raw_bonus` column은 없다. 이 table은 FINALIZED된 월에 현재 학생의 `my_rank` / `my_score`를 보여주기 위한 비공개 근거일 뿐, Guild 2 보너스 계산에는 사용하지 않는다.

Top 10 table만 game별 raw contribution과 당시 공개 보너스를 보존한다. 별도의 중복 `arcade_monthly_contributions` table은 만들지 않는다.

### 5.7 `arcade_run_moderation_events`

교사의 기록 무효화 이력이다.

- `run_id` FK
- `event_kind` initially `INVALIDATE`
- 2자 이상 사유, actor, idempotency key, created time
- 한 run을 중복 무효화하지 못하게 partial unique index

run을 삭제하지 않는다. leaderboard와 snapshot 후보 query는 활성 invalidation event가 있는 run을 제외한다. 이미 만들어진 monthly snapshot entry는 수정·삭제하지 않으며, Guild 5의 reopen/correction 정책 전에는 과거 GS를 임의로 다시 쓰지 않는다.

---

## 6. Index, FK, constraint 원칙

- 모든 run/period/snapshot은 `classroom_id`를 가져 classroom isolation을 빠르게 검증한다.
- `arcade_runs (game_id, classroom_id, game_over_at)` index: period leaderboard 후보 탐색
- `arcade_runs (student_id, game_id, game_over_at DESC)` index: 학생 personal best 탐색
- verified run만 빠르게 찾는 partial index: `WHERE status = 'VERIFIED'`
- snapshot entry의 `(snapshot_id, rank)` 및 `(snapshot_id, student_id)` unique
- period의 `ends_at_exclusive > starts_at` check
- monthly period의 `contribution_year_month` 형식 check와 required-shape check
- `official_score >= 0`, `official_duration_ms >= 0`, event time non-negative check
- FK는 existing `students`, `classrooms`, `guild_seasons`, Guild 2 table을 **복제하지 않고** 참조한다.

production에서 `students`, `classrooms`, `guilds`, `guild_seasons`의 ID가 `integer`임을 확인했다. Arcade FK는 이 type에 맞추고, Arcade 자체의 append-only run/snapshot/event ID는 `bigint`로 둔다.

---

## 7. 필요한 RPC와 권한 경계

### 학생용 RPC

production의 Guild 2 공개 RPC는 `teacher_*`, 내부 helper는 `guild2_*` 형태이며 overload가 없다. 아래 이름으로 새 function을 추가하되, migration 직전에 `pg_proc` 재확인으로 같은 signature가 없는지 확인한다.

1. `student_create_arcade_run(p_game_code)`
   - 현재 로그인 학생과 현재 학급을 server에서 찾는다.
   - game active 여부와 rules version을 확인한다.
   - run/session과 server-owned schedule identity를 만든다.
   - 5초 countdown 정보를 반환한다.

2. `student_begin_arcade_run(p_run_id)`
   - 본인 run인지 확인한다.
   - countdown 5초가 실제로 끝난 뒤에만 `PLAYING`으로 전환한다.
   - server time을 `play_started_at`으로 기록한다.

3. `student_submit_focus_reaction_01_run(p_run_id, p_input_events)`
   - score를 parameter로 받지 않는다.
   - run을 lock한 뒤 rules version·schedule·입력을 server에서 재생한다.
   - official score, duration, stats, monthly/season rank 결과만 반환한다.

4. `student_get_arcade_leaderboard(p_game_code, p_period_id)`
   - Top 10 서로 다른 학생, 내 best score/rank만 반환한다.
   - 타인의 raw input이나 moderation 사유는 반환하지 않는다.

### 교사용 RPC

1. period 생성/수정/활성화/종료
2. `teacher_finalize_arcade_monthly_snapshot(p_period_id)`
3. `teacher_invalidate_arcade_run(p_run_id, p_reason, p_idempotency_key)`
4. 교사용 run/snapshot audit 조회 (필요 시 read RPC)

### 내부 helper

- period membership resolver
- deterministic Game #01 schedule generator
- Game #01 input replay/validator
- snapshot Top 10 resolver
- Guild 2 Arcade rollup helper

모든 `SECURITY DEFINER` function은 production Guild 2와 동일하게 `SET search_path = public, pg_temp`을 사용한다. internal helper는 `PUBLIC`, `anon`, `authenticated`에서 execute를 모두 회수하고 `postgres`/`service_role`만 실행할 수 있게 한다. 학생/교사 공개 RPC만 `authenticated` execute를 받고, RPC 내부에서 학생/교사 및 classroom scope를 다시 검사한다.

---

## 8. RLS와 데이터 공개 정책

| 데이터 | 학생 | 교사 | 직접 table write |
|---|---|---|---|
| 게임 registry / active period | 필요한 공개 정보만 읽기 | 읽기 | 금지 |
| 본인 결과 | 본인 요약만 RPC로 읽기 | 학급 audit | 금지 |
| raw input events / seed | 직접 SELECT 금지 | 필요한 audit 화면만 | 금지 |
| leaderboard | Top 10 이름/점수 + 본인 순위 | 학급 전체 | 금지 |
| monthly snapshot | 본인 상세 및 공개 leaderboard | 학급 전체 | 금지 |
| moderation | 직접 노출 금지 | 해당 학급만 | 금지 |

이 구조는 Guild 2A의 “직접 SELECT는 제한하고 중요한 쓰기는 RPC” 패턴을 따른다. production legacy `rankings`에는 authenticated DML grant가 남아 있지만, Arcade table에는 `anon`/`authenticated`의 INSERT·UPDATE·DELETE grant를 만들지 않는다. 특히 raw input을 RLS로 넓게 공개하지 않으면, 학생 화면 query가 우연히 다른 학생의 게임 입력 기록을 읽는 문제가 없다.

---

## 9. Game #01 Arcade Core와 보안 구현

### 9.1 MiniGame Framework

공통 lifecycle은 확정 spec을 그대로 따른다.

`READY → COUNTDOWN → PLAYING → GAME_OVER → SUBMITTING → RESULT`

Arcade Core 책임:

- 로그인 학생 확인
- run/session 발급과 상태 전환
- rules version과 seed/schedule 관리
- 결과 제출·검증·저장
- personal best / leaderboard / snapshot
- Guild 2 adapter

Game #01 책임:

- 화면 표시
- 4 lane input 처리
- `performance.now()` 기반의 visual timeline
- GO/NO-GO, life, combo, HUD
- raw lane event 전달

### 9.2 Game #01 component 구조

```text
src/features/arcade/
  ArcadePage.tsx                    # 게임 선택, 기간별 leaderboard
  ArcadeGamePage.tsx                # 공통 run/result container
  core/
    arcade_types.ts
    useArcadeRun.ts                 # RPC와 lifecycle
    ArcadeLeaderboard.tsx
    ArcadeResultPanel.tsx
  games/focus_reaction_01/
    FocusReactionGame.tsx
    focus_reaction_config.ts        # versioned config parser
    useFocusReactionEngine.ts       # elapsed time + input state
    FocusReactionLanes.tsx
    FocusReactionHud.tsx
    focus_reaction_rules.ts         # client visual/simulation helpers
```

`keydown`에서 D/F/J/K만 처리하고, `event.repeat`은 무시한다. touch 지원은 같은 `laneInput(0..3)` 함수로 합류한다. `requestAnimationFrame()`은 화면을 그릴 때만 사용하며, signal 위치·판정 기준은 `performance.now()`와 `targetTime`이다.

### 9.3 두 가지 anti-cheat 요구사항

#### A. 콘솔에서 점수 숫자만 바꾸는 공격 방지

- client는 `finalScore`를 RPC에 보내지 않는다.
- server가 발급한 run ID, rules version, deterministic seed/schedule과 제출 input event로 score를 재계산한다.
- official run/snapshot table에는 client direct INSERT/UPDATE 권한이 없다.
- client state나 React DevTools에서 숫자를 바꿔도 화면 숫자만 바뀔 뿐, official result는 바뀌지 않는다.

#### B. 게임 속도를 느리게 만드는 공격 방지

- client gameplay는 frame count가 아니라 `performance.now()`를 사용한다.
- `student_begin_arcade_run`이 server의 `play_started_at`을 기록한다.
- server는 schedule을 재생해 계산한 game-over duration과 실제 server elapsed time을 비교한다.
- animation/CSS/frame rate를 느리게 해서 더 오래 생각하면, server elapsed time이 검증된 play timeline보다 비정상적으로 길어져 official run을 거절한다.
- tab hidden / resume / long stall은 게임을 pause하지 않고 run을 종료 또는 무효 처리한다. 이 방식이 Chromebook 성능 저하로 gameplay 자체가 느려지는 것을 허용하지 않는다.

이것은 basic console score edit와 whole-game slowdown을 막는 범위다. 화면에서 보이는 signal을 보고 고급 자동 입력 script를 만드는 상업용 anti-cheat까지는 v0.1 범위가 아니다.

### 9.4 Deterministic schedule

Game #01은 server와 client가 같은 versioned schedule을 재현할 수 있어야 한다. server가 만든 seed와 rule config로 constrained randomness를 재현하고, server validator가 다음을 보장한다.

- GO/NO-GO, lane, target time, burst pattern이 locked tier 범위 안에 있음
- v0.1 chord/simultaneous input 없음
- 같은 lane의 병적인 반복과 불가능한 overlap 제거
- 600ms damage recovery 동안 neutralized signal은 점수/피해에 반영하지 않음
- BaseScore, combo multiplier, life, Overdrive floor/cap을 spec 수치대로 계산

frontend가 보이는 schedule을 알아야 rendering이 가능하다는 사실은 보안 경계가 아니다. **공식 점수를 저장하는 권한과 재계산 근거가 server에만 있는 것**이 핵심이다.

### 9.5 확정할 deterministic PRNG와 정수 점수 규칙

Game #01 구현 전 아래 계산 규칙을 고정한다. 이것은 `ARCADE_SPEC.md`의 난이도/점수 규칙을 바꾸는 것이 아니라, TypeScript와 PostgreSQL validator가 같은 결과를 내게 하는 구현 규칙이다.

#### PRNG

- 알고리즘: **xorshift32**
- state: 0이 아닌 unsigned 32-bit integer
- 한 step: `x ^= x << 13`, `x ^= x >>> 17`, `x ^= x << 5`, 매 step 뒤 `0xffffffff` mask
- server가 run마다 non-zero seed를 만들고 rules version과 함께 저장한다.
- client와 server는 동일한 seed에서 동일한 순서로 `nextU32()`를 소비한다.
- 범위 난수는 floating point가 아니라 `min + (nextU32() mod (max - min + 1))`으로 만든다.
- 확률은 basis point 정수(예: 5%=500)와 `nextU32() mod 10000`으로 판정한다.

`Math.random()`과 PostgreSQL `random()`은 authoritative schedule에 사용하지 않는다. 구현 때 xorshift32 test vector를 TypeScript와 SQL validator 양쪽에 같은 fixture로 둔다.

#### 입력 시간과 점수

- client는 `performance.now()` 차이를 **가장 가까운 정수 ms로 반올림**한 `elapsed_ms`만 제출한다.
- server target time도 정수 ms다.
- `error_ms = abs(input_elapsed_ms - target_time_ms)`.
- 성공 GO의 base는 `200 - floor(100 × error_ms / hit_window_ms)`로 계산한다. 따라서 window 안에서 정확히 100~200점이다.
- 성공 입력 때 combo를 먼저 1 올린 뒤, 새 combo band의 percent-scale `multiplier_percent` `100 / 110 / 120 / 130 / 140`를 적용한다.
- `awarded_points = floor(base_points × multiplier_percent / 100)`이며, 모든 run score는 정수 합계다.
- PERFECT/GREAT/GOOD 표시는 `error_ms × 100`과 `hit_window_ms × 20/50/100`의 정수 비교로만 결정한다.

이 규칙으로 같은 seed, rules version, input event가 들어오면 browser와 server가 항상 같은 official score를 계산한다.

---

## 10. Leaderboard 계산 방식

### 월간/시즌 live leaderboard

1. 해당 `game_id × arcade_ranking_period`에 `game_over_at`이 들어가는 verified run을 찾는다.
2. moderation invalidation이 없는 run만 남긴다.
3. `student_id`별로 `official_score DESC`, `game_over_at ASC`, `run_id ASC` 순으로 하나만 고른다.
4. 그 학생 best score들을 같은 순서로 rank한다.
5. Top 10에는 최대 10명의 서로 다른 학생만 반환한다.

동점에서는 server가 기록·검증한 source run의 `game_over_at`이 빠른 학생을 우선한다. Snapshot entry의 `achieved_at`은 그 `game_over_at` 값을 복사해 과거 순위 근거를 보존할 때만 사용하며, live leaderboard 정렬에는 별도 run column을 만들지 않는다.

### 월 snapshot — 한 transaction, all-or-nothing

`teacher_finalize_arcade_monthly_snapshot`은 하나의 transaction 안에서 월간 period 날짜와 각 게임의 `available_from`/`available_until`이 겹치는 **모든 eligible game**에 대해 위 leaderboard를 계산한다. finalize 시점의 `is_active` 값만으로 과거 월 대상 게임을 결정하지 않는다.

- 1위 30
- 2위 27
- 3위 24
- 4~6위 18
- 7~10위 15

각 game은 참가자가 0명이어도 0-entry snapshot을 정상적으로 만든다. 각 game의 공개 Top 10 snapshot과 참여 학생 전체-rank snapshot, 학생별 raw contribution 합산, Guild 2 refresh, period `FINALIZED` 전환이 모두 성공해야 commit한다. 하나라도 실패하면 전체 rollback한다.

`arcade_monthly_finalizations` parent row가 있고 snapshot 수가 확정 당시 active game 수와 같을 때만 그 월의 Arcade 상태를 `READY`로 본다. 한 game만 snapshot된 partial 상태는 commit될 수 없고 `READY`도 될 수 없다.

이미 finalize된 period는 같은 game snapshot을 다시 계산하거나 덮어쓰지 않는다. 그래서 나중에 더 높은 run이 생기거나 period 경계를 고쳐도 과거 contribution은 바뀌지 않는다.

---

## 11. 기간과 Season 2 처리

### 월간

- 교사가 기본값(해당 달 1일~말일)을 만든 뒤 시작·종료일을 수정한다.
- 예: 마지막 날이 주말이면 마지막 금요일을 `ends_at_exclusive` 전날로 설정한다.
- monthly period는 Guild 2의 어느 `YYYY-MM`에 반영할지 명시한다.
- ranking period membership은 `play_started_at`, `submitted_at`, `verified_at`이 아니라 server가 재현·검증한 **`game_over_at`**으로 판단한다.

### 시즌

- Season 2 default는 **2026-08-24부터 2026-12-24까지 포함**이다.
- DB range는 2026-12-25 00:00 Asia/Seoul을 exclusive end로 저장한다.
- `guild_seasons`가 같은 season의 source relationship을 제공하면 FK로 연결한다. 그러나 Arcade period는 teacher가 별도 날짜를 조절해야 하므로, monthly custom range 자체는 `guild_seasons`만으로 표현할 수 없다.

---

## 12. Guild 2A Snapshot 연동

production에서 `public.guild2_refresh_monthly_scores(p_classroom_id integer, p_year_month text)`의 정확한 signature와 body를 확인했다. 이 함수는 매 draft 재계산에서 Arcade 값을 `0`, `0`, `NOT_READY`로 덮어쓴다. Arcade migration은 이 **같은 signature**를 안전하게 `CREATE OR REPLACE`하여 snapshot rollup을 추가한다. 이어서 `public.guild2_refresh_monthly_gs_summary(p_classroom_id integer, p_year_month text, p_season_id integer)`도 같은 방식으로 Arcade readiness를 반영한다.

변경 후 원리:

1. month에 대응하는 finalized `arcade_monthly_snapshot_entries`를 game별로 합산한다.
2. 학생별 `arcade_raw_total = sum(raw_bonus)`을 만든다.
3. `arcade_raw_total = sum(raw_bonus)`은 감사용 원본 합계라 +90을 넘을 수 있다. `arcade_applied = least(arcade_raw_total, 90)`만 Guild 2에 반영한다.
4. `basic_total`은 그대로 유지한다.
5. `final_total = basic_total + arcade_applied`로 계산하며, 따라서 최댓값은 990이다.
6. snapshot이 없으면 numeric 0 + `arcade_status = NOT_READY`를 유지한다.
7. 해당 monthly period 전체가 atomic finalization을 마쳤을 때만 `arcade_status = READY`로 표시한다.
8. 기존 `guild2_refresh_monthly_gs_summary`가 `final_total`을 ledger에 반영한다. 따라서 별도의 Arcade GS ledger나 별도의 길드 점수 table은 만들지 않는다.

4인 길드 compensation은 계속 `basic_total`만 평균내므로 Arcade를 포함하지 않는다.

### Guild 2A와의 LOCKED 호환

production에서 정확히 `guild2_contribution_arcade_applied_check` (`arcade_applied BETWEEN 0 AND 90`)와 `guild2_contribution_final_range_check` (`final_total BETWEEN 0 AND 990`)가 확인됐다. Arcade adapter는 이 두 constraint를 **변경하지 않는다.** 여러 게임에서 얻은 원본 보너스는 `arcade_raw_total`로 남기고, 적용값은 `least(arcade_raw_total, 90)`으로 계산한다. 기존 contribution/GS ledger/Guild 1 history의 행은 삭제·rewrite하지 않는다.

Guild 1 membership/history를 Arcade snapshot이 수정하지 않는다. mid-month membership context는 기존 Guild 2A/Guild 5 boundary를 유지한다.

---

## 13. 사용자 승인으로 확정된 운영/계산 결정

아래는 2026-08-14 사용자 검토에서 확정됐다. Game #01 product rule 변경이 아니라 안전한 운영과 deterministic 구현을 위한 고정이다.

### 확정 1 — Arcade snapshot을 언제 누를지

현재 교사 화면의 **점수 다시 계산**은 같은 달에 여러 번 눌러도 되는 draft 갱신 버튼이다. 이것이 첫 클릭 때 Arcade Top 10을 영구 고정하면, 월 중간에 실수로 순위를 확정할 수 있다.

기존 버튼은 그대로 draft 재계산으로 유지하고, 교사 Arcade 화면에 별도 **“이번 달 Arcade 순위 확정 및 Guild 2 반영”** 버튼을 둔다. 이 버튼만 snapshot을 만들고 이후의 Guild 2 재계산은 그 snapshot을 사용한다.

이 action은 해당 월간 period의 날짜와 `available_from`/`available_until`이 겹치는 모든 eligible game을 하나의 transaction으로 finalization한다.

### 확정 2 — 기간 경계를 넘긴 긴 run의 소속 기준

기간 membership은 `play_started_at`이 아니라 authoritative `game_over_at`을 사용한다.

예: 마감 15:00에 14:59 시작·15:07 종료 run은 그 기간에 포함되지 않고, 14:55 시작·14:59 종료 run만 포함된다. `submitted_at`/`verified_at`은 network 처리 지연 때문에 사용하지 않는다.

### 확정 3 — Arcade 원본 보너스와 Guild 2 적용 보너스

여러 game의 월간 rank bonus 원본은 그대로 합산한다. 초기 6개 game에서 모두 1위면 `arcade_raw_total`은 +180이 될 수 있다. 다만 LOCKED Guild 2 반영값은 `arcade_applied = least(arcade_raw_total, 90)`이며, 최종 개인기여도는 최대 990이다. Arcade는 4인 길드 compensation 평균에는 계속 포함하지 않는다.

---

## 14. 예상 migration 순서

1. `supabase/PREFLIGHT_ARCADE_INTEGRATION.sql` production 결과 검토 완료
2. `YYYYMMDD_01_arcade_foundation.sql`
   - registry, rule version, periods, runs, submissions, moderation, RLS/ACL
3. `YYYYMMDD_02_arcade_game01_server_validation.sql`
   - deterministic schedule와 Game #01 validator, 학생 run RPC
4. `YYYYMMDD_03_arcade_monthly_finalization_guild2_adapter.sql`
   - atomic monthly finalization/snapshot RPC와 Guild 2A refresh extension
   - production에서 확인된 `guild2_contribution_arcade_applied_check`, `guild2_contribution_final_range_check`를 변경하지 않고 +90 applied cap으로 snapshot을 반영
5. `YYYYMMDD_04_arcade_finalized_leaderboard_snapshot_read.sql`
   - 이미 확정된 월간 period의 공개 Top 10은 기존 immutable Top 10 snapshot을 읽음
   - 이 단계의 `my_rank`/`my_score`는 Top 10 entry 안에서만 조회되므로, Top 10 밖 학생의 확정 후 개인 순위는 아직 보존되지 않음
6. `YYYYMMDD_05_arcade_full_rank_snapshot_integrity.sql`
   - 참여한 모든 학생의 final best rank/score/run/time은 별도 immutable full-rank snapshot으로 함께 저장하여, Top 10 밖 학생도 FINALIZED 뒤 자신의 순위·점수를 볼 수 있게 함
   - FINALIZED 월간 period/game에 필요한 snapshot이 없으면 빈 순위표 대신 data-integrity 오류를 반환
   - 기존 Top 10 bonus/Guild 2 계산/snapshot history는 수정하지 않음
7. `YYYYMMDD_06_arcade_prerelease_test_runs.sql`
   - 교사가 지정한 학생에게만 `available_from` 이전의 사전 테스트를 허용
   - server가 `is_prerelease_test`를 기록하고, 테스트 run은 live/final leaderboard·monthly snapshot·Guild 2 보너스에서 모두 제외
   - 공개일은 변경하지 않으며 테스트 run은 교사 감사 기록에만 남음
8. `YYYYMMDD_07_arcade_pgcrypto_schema_resolution.sql`
   - Supabase의 실제 `pgcrypto` 설치 schema를 서버에서 안전하게 찾아 난수 seed와 SHA-256 hash를 생성
   - `42883` 함수 탐색 오류를 고치며, 공개일 전 사전 테스트와 일반 공식 플레이 모두에 적용
9. `YYYYMMDD_08_arcade_prerelease_test_leaderboard.sql`
   - 교사만 사전 테스트 run을 별도 순위표에서 확인
   - 학생당 최고 서버 점수 하나와 공식 동점 규칙을 사용하지만, 공개 Top 10·월간 확정·Guild 2에는 절대 섞지 않음
10. `YYYYMMDD_09_arcade_game01_validation_horizon_fix.sql`
   - 종료 직전의 이른 입력도 서버가 같은 deterministic schedule에서 검증하도록 범위를 보정
   - GO miss는 실제 판정 창이 끝난 뒤에만 처리하여 client/server 종료 시점을 일치시킴
11. `YYYYMMDD_10_arcade_game01_no_go_pass_validation_fix.sql`
   - 입력하지 않아 정상 통과한 NO GO 신호에서 서버 검증이 멈추지 않고 다음 신호로 진행하도록 수정
   - 사전 테스트·공식 기록 모두의 점수 규칙과 server-side 검증 경계는 그대로 유지
12. migration마다 SQL Editor-safe structural postcheck 포함
13. frontend, RPC wrapper, Zod, UI 구현

각 migration은 새 증분 파일만 사용한다. 기존 Guild 1/Guild 2 migration을 재실행·수정하지 않으며, legacy `guild_gs`/`guild_individual_contributions`나 history를 삭제·rewrite하지 않는다.

---

## 15. Frontend 구현 순서

1. `/arcade` 게임 선택 및 월/시즌 leaderboard read-only 화면
2. Arcade Core의 run lifecycle / error / loading state
3. Game #01 keyboard-first, touch-compatible play screen
4. result 화면: official score, personal best, monthly top 10, 내 순위
5. `/teacher/arcade`: period 설정, snapshot, audit, invalidation
6. `/guild` Arcade 카드: game별 rank/bonus/raw sum/applied total 상세
7. `/teacher/guild/scores`: Arcade status/raw/applied 정보와 snapshot 상태
8. RPC 성공 뒤 query invalidation/refetch. Realtime은 Arcade 0.1 범위에서 추가하지 않음

새 heavy game engine이나 새 npm dependency는 사용하지 않는다. React, TypeScript, CSS, `performance.now()`, `requestAnimationFrame()`으로 Chromebook 친화적으로 만든다.

---

## 16. 테스트와 acceptance criteria

### Game #01

- D/F/J/K, touch 모두 같은 lane input으로 동작
- 5초 countdown, Life 3, GO/NO-GO, 600ms recovery
- Easy → Normal → Hard → Very Hard → Extreme → 5:00 Overdrive
- frame count가 아니라 elapsed time 기반
- locked base score / combo multiplier / Overdrive floor-cap 일치
- Chromebook 저사양 frame drop에서 gameplay clock이 느려지지 않음

### Server/security

- client가 점수 field를 보내지 않아도 official score가 계산됨
- console에서 높은 score를 넣어 submit하려 해도 leaderboard에 저장되지 않음
- 다른 학생 run ID submit, 다른 classroom period 접근, anon 호출 거절
- 동일 run 이중 제출과 concurrent submit이 한 번만 처리됨
- tab hidden/long stall/whole-game slowdown이 official result를 얻지 못함
- 교사 invalidation 뒤 leaderboard/snapshot 후보에서 제외됨

### Ranking/snapshot

- 한 학생의 여러 high score가 Top 10에 한 자리만 차지
- tie는 `official_score DESC → game_over_at ASC → run_id ASC` 순서
- monthly와 season leaderboard 모두 현재 학생의 밖의 순위 표시
- FINALIZED 월간 leaderboard에서 Top 10 밖 학생도 immutable full-rank snapshot의 `my_rank`, `my_score`가 표시됨
- Top 10 보너스 30/27/24/18/15 정확
- snapshot 후 새 run/period 수정이 과거 snapshot entry를 변경하지 않음
- 여러 game의 rank bonus 원본 합은 `arcade_raw_total`에 남고, `arcade_applied`는 최대 +90이며 final은 최대 990
- compensation average에 Arcade가 들어가지 않음

### Regression

- Guild 2A session/observation/compensation/manual adjustment 기능 유지
- Guild 1 membership history와 session snapshot 불변
- 학생은 자신과 공개 leaderboard만 보고 raw inputs/교사용 moderation은 못 봄
- `npm run build` 성공
- 실제 교사/학생 E2E 및 Chromebook E2E 통과

---

## 17. 알려진 위험과 대응

| 위험 | 대응 |
|---|---|
| local migration과 production 차이 | Section 1~13 production preflight로 확인 완료. 새 migration은 확인된 exact signature/constraint를 사용 |
| legacy `rankings`를 Arcade에 잘못 재사용 | 기존 100행은 보존하고, 날짜별 경제 랭킹과 Arcade game/run/snapshot을 분리 |
| 기존 Guild 2 recalc가 Arcade 값을 초기화 | 확인된 exact Guild 2 function 두 개를 snapshot-aware로 증분 교체하고, 별도 finalize action만 snapshot을 생성 |
| RLS policy 자기 참조 | raw run table을 직접 학생 query로 열지 않고 결과 RPC 중심으로 설계 |
| 게임 frame drop이 쉬운 난이도가 됨 | clock은 `performance.now()`, rAF는 render 전용 |
| 게임 속도 늦추기 | server start/elapsed와 deterministic replay 대조 |
| monthly period를 수정하며 과거 GS까지 바뀜 | finalized snapshot entry를 immutable 근거로 유지 |
| Guild 1 history rewrite | Arcade는 membership을 쓰지 않고 existing Guild 2 context resolver만 사용 |

---

## 18. 다음 실제 작업

1. production preflight Section 1~13 검토 완료: legacy `rankings` 보존, `arcade_*` 신규 구조, 기존 identity/Guild 2 재사용으로 확정한다.
2. 구현 시작 시 새 증분 migration 3개를 순서대로 작성한다. 과거 Guild 1/Guild 2 migration은 수정·재실행하지 않는다.
3. foundation → Game #01 server validator → atomic monthly snapshot/Guild 2 adapter 순서로 SQL Editor-safe postcheck와 교사/학생 E2E를 수행한다.
4. migration 적용 뒤에만 frontend, RPC wrapper, Zod, `/arcade`, `/teacher/arcade` 화면을 구현한다.

이 문서가 승인되기 전에는 Game #01의 규칙, 난이도, 점수, combo, ranking 보너스, Guild 연결 규칙을 변경하지 않는다.
