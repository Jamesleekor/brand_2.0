# Guild5 점령 운영 — 세율 선언 · 이의 제기 · 확정 징수 · 분배 · 이력 (2026-11-02)

## 확정 규칙 (사용자 지시)

1. 점령 확정(영토 배정) 순간에는 세금을 걷지 않는다. 자동 배정(48시간 만료)도 같다.
2. 점령 길드가 세율을 선언한다: **10% ~ 50%**. 이의 제기가 접수되기 전까지는 수정 가능.
3. 이의 제기: 그 달 **4·5위 길드만**, **영토당 1건**. 요구 세율은 선언 세율보다 낮아야 한다.
4. 투표는 모험가 도구함으로 따로 진행하고, 교사가 찬성·반대 수만 입력한다.
   - 찬성 **14표 이상** → 통과: 최종 세율 = 요구 세율
   - 14표 미만 → 부결: 최종 세율 = 선언 세율, 제기 길드 길드원은 그 영토에 **+10%p** (예: 50% → 60%)
   - 점령 길드원도 자기 영토 세금을 낸다.
5. 「세율 최종 확정」 시점에 그 달 과세 경매(영토 자금 snapshot의 경매)의 해당 카테고리 낙찰 전체에 일괄 과세.
   잔액이 부족하면 기존 미납(student_asset_arrears) 흐름으로 기록된다.
6. 월간 점령은 경매 대기열의 **경매 1개**에만 과세한다. 경매 도중 이전 달 점령 길드가 즉시 과세하던
   IMMEDIATE 트리거(`guild5_assess_sold_auction_item_tax_trigger`)는 no-op으로 교체했다.
7. 8회차 경매(auction 43)는 10월 점령 길드 몫. 9월 기준으로 걷힌 8회차 세금은 패널의
   「이전 점령 세금 환급」으로 돌려준 뒤(REVERSAL + voided_at) 10월 확정 세율로 다시 걷는다.
8. 분배: 걷힌 세금을 점령 길드원(마감 snapshot 기준)에게 균등 분배. 나누는 수 = max(길드 인원, 5).
   4인 길드는 5등분 값만 지급하고 남는 몫은 운영국 회수. 미납이 나중에 상환되면 늘어난 만큼만 추가 분배 가능.
   분배 거래는 TEACHER_GRANT, 소득세 0.

## DB

- migration: `supabase/migrations/20261102_02_guild5_conquest_objection_tax_ops.sql`
  (SQL Editor용 동일본: `supabase/APPLY_GUILD5_CONQUEST_OBJECTION_TAX_OPS.sql`, 확인용: `POSTCHECK_...sql`)
- 신규 테이블: `guild5_territory_rate_settlements`, `guild5_territory_objections`,
  `guild5_territory_tax_distributions`, `guild5_territory_tax_distribution_lines`
- `guild5_territory_tax_assessments`: `voided_at`, `void_reason`, `voided_by_user_id`, `void_refund_amount`,
  `objection_surcharge_pp`, `rate_settlement_id` 추가. `UNIQUE(auction_result_id)` →
  `WHERE voided_at IS NULL` partial unique index로 교체 (환급된 과세는 기록으로 남고 재과세 가능).
- 교체 함수: `teacher_choose_guild5_territory`, `guild5_process_due_conquest_internal` (과세 호출만 DEFERRED로),
  `guild5_assess_sold_auction_item_tax_trigger` (no-op), `guild5_get_territory_tax_summary` (voided 제외)
- 신규 교사 RPC: `teacher_get_guild5_conquest_ops(ym)`, `teacher_get_guild5_conquest_history()`,
  `teacher_declare_guild5_territory_rate`, `teacher_file_guild5_territory_objection`,
  `teacher_withdraw_guild5_territory_objection`, `teacher_record_guild5_objection_vote`,
  `teacher_finalize_guild5_territory_rate`, `teacher_distribute_guild5_territory_tax`,
  `teacher_refund_guild5_prior_territory_tax`
- 세율 선언/확정 시 `guild5_conquest_turns.territory_tax_rate_snapshot`을 선언·최종 세율로 갱신 →
  학생 정복 화면의 '지역 세율'이 실제 세율을 보여준다 (학생 UI 코드 변경 없음).

## 프론트

- `src/features/guild/GuildConquestOpsPanel.tsx` (신규): 점령 운영 패널 + 점령 이력 패널
- `src/features/guild/GuildMonthlyAdmin.tsx`: 두 패널 배치, 즉시 정산 안내 문구 교체, 새로고침 시 패널 데이터도 갱신
- `src/lib/rpc/guild5_rpc.ts`, `src/lib/zod_schemas/guild5_schemas.ts`: 타입·RPC·입력 검증 추가

## 검증

- 2026-11-02 production에서 BEGIN … ROLLBACK 안에 migration + 교사 JWT 흉내로 전체 흐름 실행:
  환급 69건 12,721G(지갑 합계 +12,721) → 3영토 점령 → 선언/수정 → 이의 제기(부결·통과) → 확정 징수
  → 분배(4인 길드 5등분, 회수 1,977G) → ops/history/dashboard 조회까지 모두 성공. 실제 데이터는 변경되지 않음.
- 미검증: 실제 교사 로그인 화면 클릭 E2E, 로컬 `npm run build` (사용자 실행)
