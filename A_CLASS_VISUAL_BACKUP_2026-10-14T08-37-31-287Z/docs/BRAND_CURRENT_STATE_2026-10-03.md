# B.R.A.N.D 2.0 — CURRENT STATE

> 기준일: 2026-10-03 KST
> 성격: 운영 기준선. 과거 문서보다 우선한다.

## 1. 운영 상태

- B.R.A.N.D 2.0은 현재 production Supabase + GitHub Pages에서 실제 학급 운영 중이다.
- Guild 1~5는 모두 구현·운영 중이다.
- production DB는 로컬 migration 폴더보다 앞선다. 함수/ACL/RLS 변경 전 live introspection을 우선한다.

## 2. Live Auction

- 표준 조회 RPC: `public.get_live_auction_state`.
- 2026-10-03부터 모든 학생/교사/중계 조회는 `public.auction_live_runtime` 기반 단일 read path를 사용한다.
- `p_light_mode` 인자는 구버전 클라이언트 호환용으로만 남아 있으며 동작 분기에 사용하지 않는다.
- `brand_runtime_internal.get_live_auction_state_legacy_v1`과 `auction_state_cache`는 현재 normal read path에서 사용하지 않는다. rollback 자산으로만 유지한다.
- 학생/중계 payload는 비현재 상품을 compact하게 반환하고, 교사 운영 패널은 편집에 필요한 상세 필드를 반환한다.
- 현재 상품 recent bids는 현재 item/attempt만 조회한다.
- 프론트는 아직 polling 기반이다. Realtime 전환은 별도 설계 없이 섞지 않는다.

## 3. RAID

- `submit_raid_tap_batch`와 `raid_combat_tick`은 브라우저의 일반 background REST 2-slot queue를 우회하는 critical fast path다.
- tap batcher 자체의 1-in-flight, jitter, BUSY/backoff와 서버측 backpressure가 authoritative하다.
- 일반 상태 조회는 기존 background queue/polling 정책을 유지한다.

## 4. Dimensional Gate AI

Production Edge Function:
- `dimensional-gate-ai-chat`
- `dimensional-gate-ai-qa`

현재 provider는 OpenAI Responses API이며 runtime config 기본 모델은 GPT-5.6 Luna 계열이다.

Repo authoritative source:
- `supabase/functions/dimensional-gate-ai-chat/index.ts`
- `supabase/functions/dimensional-gate-ai-qa/index.ts`

`supabase/functions/dimensional-gate-chat/index.ts`는 Anthropic 시대의 historical source이며 production 배포용이 아니다.

2026-10-03 정리:
- chat transport-level fetch failure도 1회 재시도한다.
- chat/QA 모두 모델에 전달하는 dynamic context를 whitelist 방식으로 구성한다.
- QA가 Context Packet 신규 필드를 자동으로 모델에 노출하지 않도록 한다.

## 5. 예금 만기

- `brand_deposit_maturity` cron이 5분 간격으로 실행된다.
- 만기일은 Asia/Seoul 날짜 기준이며 만기일 00:00 KST 이후 자동 정산 대상이다.
- 자동 cron은 전용 wrapper를 사용하며 교사 JWT를 요구하지 않는다.
- 교사 은행의 수동 정산은 복구용이다.

## 6. Guild5 월 마감

- `guild5_build_close_preview` 자체는 STABLE read function이다.
- 교사용 wrapper `teacher_get_guild5_close_preview`가 `guild2_refresh_monthly_scores` 후 preview를 반환한다.
- 세션 readiness는 학생별 attendance 상태가 아니라 해당 월 session lifecycle(CLOSED 여부) 기준이다.
- mission readiness는 유효한 mission 중 FINALIZED가 아닌 것이 없으면 READY다.
- Arcade는 실제 monthly finalization snapshot 완료가 Guild5 READY 조건이다.
- 공식 Mission GS는 readiness gate가 아니라 실제 길드 점수 구성요소다.

## 7. 아직 남은 감사/개선 영역

- 다학급 확대 전 classroom scope audit.
- `wallets_select_own`의 teacher/admin 범위 정책 결정.
- internal financial helpers의 classroom caller contract 문서화.
- legacy auction rollback 자산은 신규 경매 E2E 확인 후 별도 migration에서 제거 검토.
- auth initialize 자동 backoff, presence OFF polling 완화 등은 UX/성능 후순위 개선.

## 8. 편린 영입 조건 확장 (2026-10-09)

- 기존 업적 수/등급별 업적 수/티어 조건에 특정 편린 모두 보유, 전체 보유 수, 기본가 기준 보유 가치, 완성 공개 콜렉션 수를 추가했다.
- 운영 DB migration `20261008154249_character_recruitment_collection_requirements` 적용 완료. 기존 판정 2,005건 동일, 새 판정/권한 테스트 392건 통과.
- 교사 UI 소스 수정 완료. GitHub 반영 및 사용자 로컬 build/로그인 E2E는 미완료.
- 네빌 조건은 예시 단계여서 지정하지 않았다. 세부 기준: `docs/CHARACTER_RECRUITMENT_REQUIREMENTS_2026-10-09.md`.

## 9. 편린 능력치 관리 확장 (2026-10-09)

공명력·치명타율에 주/부 속성 배분과 원정 특기 설정을 추가했다. 신규 편린의 누락 프로필도 생성 가능하다. 기존 RPC는 유지하고 교사 전용 combat profile RPC 2개를 추가했다. 운영 DB migration `20261008155719_character_combat_profile_admin.sql` 적용, 기존 값과 원정 스냅샷 보존. 실제 교사 로그인 E2E와 사용자 로컬 build/배포는 후속 확인. 상세: `docs/CHARACTER_COMBAT_PROFILE_ADMIN_2026-10-09.md`.

## 10. Arcade 기간 기록 조회 (2026-10-09)

운영 패널에 ACTIVE 기간부터 일반 기록을 확인하는 3게임 통합 조회를 추가했다. 운영 DB migration `20261009121639_arcade_teacher_period_records` 적용, 실제 10월/9월 각각 72행과 교사/학생/학급 경계 검증 완료. 기존 사전 테스트 순위·공인 인증과 별도로 조회하며 기록/보상/기간 상태를 바꾸지 않는다. 라카루카의 일반 경기와 공인 도전 기록은 구분한다. 전체 TypeScript 정적 검사/실제 응답 Zod/3게임 학생표 서버 렌더 확인 완료. 사용자 승인에 따라 main에 반영하며 실제 교사 로그인 E2E는 배포 후 확인 대상이다. 상세: `docs/ARCADE_PERIOD_RECORDS_FIX_2026-10-09.md`.

## 11. 편린 원정 명품관 명예 테두리 (2026-10-09, 소스 작업 중)

원정 연대기 하단 명품관에 시안 미리보기, 보유 테두리 장착/해제, 판매 상품 구매 UI를 연결했다. 친구·길드·랭킹·레이드 로비·교사용 레이드 중계 카드에는 공통 명예 테두리 표시 컴포넌트를 연결했다. 장착은 기존 `student_set_cosmetic_selection` RPC, 조회는 학급 범위 RLS가 적용된 기존 cosmetic 테이블을 사용한다. **운영 카탈로그는 비어 있고 실제 투명 테두리 자산도 아직 등록되지 않았다. GitHub 반영, 사용자 로컬 build, 로그인 E2E는 미완료.** 등록 규칙과 화면 검증은 `docs/PRESTIGE_BORDER_INTEGRATION_2026-10-09.md`를 따른다.
