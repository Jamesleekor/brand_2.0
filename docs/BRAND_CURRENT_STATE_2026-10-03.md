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
