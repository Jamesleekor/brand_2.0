-- ============================================================================
-- B.R.A.N.D 2.0 — 레이드 전리품 획득식 V1.2 · 2/3 (스키마)
--
-- 선행 조건: 20261018_01_raid_loot_enum.sql 이 먼저 성공해야 합니다.
--
-- 이 파일이 하는 일
--   1) 새 테이블 5개: 설정 / 후보 편린 / 획득식 / 전리품 라운드 / 감사 기록
--   2) 기존 CHECK 제약 3개를 "값 추가" 방식으로 확장 (기존 허용 값은 모두 유지)
--      - expedition_fragment_ledger_event_chk  : + 'RAID_LOOT'
--      - expedition_fragment_ledger_shape_chk  : + RAID_LOOT 행 모양
--      - character_event_type                  : + 'RAID_LOOT'
--   3) 전리품 거래 1라운드 1건 보장 인덱스 ux_transactions_raid_loot_once
--   4) RLS 켜기 + 브라우저 직접 접근 차단 (모든 읽기/쓰기는 RPC로만)
--
-- 삭제(DROP TABLE / DELETE / TRUNCATE) 없음. 기존 데이터 변경 없음.
-- 전체가 한 트랜잭션이므로 중간에 실패하면 아무것도 바뀌지 않습니다.
-- ============================================================================

BEGIN;

-- 0. 선행 enum 확인 ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid='public.transaction_source_type'::regtype AND enumlabel='RAID_LOOT'
  ) THEN
    RAISE EXCEPTION '먼저 20261018_01_raid_loot_enum.sql 을 실행하세요 (RAID_LOOT enum 없음).';
  END IF;
END $$;

-- 1. 레이드별 전리품 설정 -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.raid_loot_configs (
  raid_id                  bigint PRIMARY KEY REFERENCES public.raids(id) ON DELETE RESTRICT,
  classroom_id             integer NOT NULL REFERENCES public.classrooms(id) ON DELETE RESTRICT,
  enabled                  boolean NOT NULL DEFAULT false,
  config_version           integer NOT NULL DEFAULT 1 CHECK (config_version >= 1),
  slot1                    jsonb   NOT NULL DEFAULT '{}'::jsonb,
  slot2                    jsonb   NOT NULL DEFAULT '{}'::jsonb,
  minimum_damage_share_bp  integer NOT NULL DEFAULT 100 CHECK (minimum_damage_share_bp = 100),
  max_weight_ratio         numeric NOT NULL DEFAULT 2   CHECK (max_weight_ratio = 2),
  locked_at                timestamptz,
  locked_snapshot          jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid
);

-- 2. 후보 편린 (설정 저장 시점의 가격·이름·이미지 스냅샷) -------------------------
CREATE TABLE IF NOT EXISTS public.raid_loot_character_pool (
  raid_id             bigint  NOT NULL REFERENCES public.raid_loot_configs(raid_id) ON DELETE CASCADE,
  character_id        bigint  NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  manual_factor       numeric(6,3) NOT NULL DEFAULT 1 CHECK (manual_factor >= 0.25 AND manual_factor <= 4),
  base_price_crystal  bigint  NOT NULL CHECK (base_price_crystal >= 1000),
  display_name        text    NOT NULL,
  character_uid       text,
  image_url           text,
  emoji               text,
  is_selected         boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0,
  saved_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (raid_id, character_id)
);

-- 3. 획득식 (레이드당 1개) ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.raid_loot_ceremonies (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  raid_id               bigint  NOT NULL UNIQUE REFERENCES public.raids(id) ON DELETE RESTRICT,
  classroom_id          integer NOT NULL REFERENCES public.classrooms(id) ON DELETE RESTRICT,
  raid_original_status  text    NOT NULL CHECK (raid_original_status = 'COMPLETED'),
  status                text    NOT NULL DEFAULT 'READY' CHECK (status IN (
                          'READY','SLOT1_ITEM','SLOT1_DRAWING','SLOT1_WINNER',
                          'SLOT2_ITEM','SLOT2_DRAWING','SLOT2_WINNER','COMPLETE')),
  config_snapshot       jsonb   NOT NULL,
  eligible_snapshot     jsonb   NOT NULL,
  eligible_count        integer NOT NULL CHECK (eligible_count >= 1),
  total_damage          bigint  NOT NULL CHECK (total_damage > 0),
  version               integer NOT NULL DEFAULT 1,
  prepared_by           uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz
);

-- 4. 전리품 라운드 (획득식당 최대 2행) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.raid_loot_rounds (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ceremony_id             bigint   NOT NULL REFERENCES public.raid_loot_ceremonies(id) ON DELETE RESTRICT,
  raid_id                 bigint   NOT NULL REFERENCES public.raids(id) ON DELETE RESTRICT,
  slot_no                 smallint NOT NULL CHECK (slot_no IN (1,2)),
  reward_kind             text     NOT NULL,
  reward_amount           bigint,
  character_id            bigint REFERENCES public.characters(id) ON DELETE RESTRICT,
  reward_snapshot         jsonb    NOT NULL DEFAULT '{}'::jsonb,
  revealed_at             timestamptz NOT NULL DEFAULT now(),
  drawing_at              timestamptz,
  winner_student_id       integer REFERENCES public.students(id) ON DELETE RESTRICT,
  winner_participant_id   bigint  REFERENCES public.raid_participants(id) ON DELETE RESTRICT,
  winner_snapshot         jsonb,
  delivered_kind          text,
  delivered_amount        bigint,
  delivered_character_id  bigint REFERENCES public.characters(id) ON DELETE RESTRICT,
  transaction_id          bigint REFERENCES public.transactions(id) ON DELETE RESTRICT,
  fragment_ledger_id      bigint REFERENCES public.expedition_fragment_ledger(id) ON DELETE RESTRICT,
  acquisition_event_id    bigint REFERENCES public.character_acquisition_events(id) ON DELETE RESTRICT,
  settlement_status       text     NOT NULL DEFAULT 'UNSETTLED',
  settlement_request_id   uuid UNIQUE,
  void_reason             text,
  settled_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raid_loot_rounds_slot_once UNIQUE (raid_id, slot_no),
  CONSTRAINT raid_loot_rounds_slot_kind_chk CHECK (
    (slot_no = 1 AND reward_kind IN ('GOLD','CRYSTAL')) OR
    (slot_no = 2 AND reward_kind IN ('FRAGMENTS','CHARACTER'))
  ),
  CONSTRAINT raid_loot_rounds_reward_shape_chk CHECK (
    (reward_kind IN ('GOLD','CRYSTAL','FRAGMENTS') AND reward_amount > 0 AND character_id IS NULL) OR
    (reward_kind = 'CHARACTER' AND character_id IS NOT NULL AND reward_amount IS NULL)
  ),
  CONSTRAINT raid_loot_rounds_status_chk CHECK (settlement_status IN ('UNSETTLED','SETTLED','VOID')),
  CONSTRAINT raid_loot_rounds_settlement_shape_chk CHECK (
    (settlement_status = 'UNSETTLED'
      AND winner_student_id IS NULL AND delivered_kind IS NULL
      AND num_nonnulls(transaction_id, fragment_ledger_id, acquisition_event_id) = 0)
    OR
    (settlement_status = 'SETTLED'
      AND winner_student_id IS NOT NULL AND winner_participant_id IS NOT NULL
      AND delivered_kind IN ('GOLD','CRYSTAL','FRAGMENTS','CHARACTER')
      AND settled_at IS NOT NULL
      AND num_nonnulls(transaction_id, fragment_ledger_id, acquisition_event_id) = 1
      AND (
        (delivered_kind IN ('GOLD','CRYSTAL') AND transaction_id IS NOT NULL AND delivered_amount > 0) OR
        (delivered_kind = 'FRAGMENTS' AND fragment_ledger_id IS NOT NULL AND delivered_amount > 0) OR
        (delivered_kind = 'CHARACTER' AND acquisition_event_id IS NOT NULL AND delivered_character_id IS NOT NULL)
      ))
    OR
    (settlement_status = 'VOID'
      AND winner_student_id IS NULL AND delivered_kind IS NULL
      AND num_nonnulls(transaction_id, fragment_ledger_id, acquisition_event_id) = 0
      AND void_reason IS NOT NULL AND settled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS raid_loot_rounds_winner_idx
  ON public.raid_loot_rounds (winner_student_id, raid_id) WHERE winner_student_id IS NOT NULL;

-- 5. 감사 기록 -----------------------------------------------------------------
--   raid_id는 FK를 걸지 않습니다: 적격자 0명(NO_ELIGIBLE) 기록만 있는 레이드는
--   삭제 함수가 이 기록을 정리한 뒤 정상 삭제할 수 있어야 하기 때문입니다.
CREATE TABLE IF NOT EXISTS public.raid_loot_audit_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  raid_id        bigint   NOT NULL,
  ceremony_id    bigint REFERENCES public.raid_loot_ceremonies(id) ON DELETE RESTRICT,
  slot_no        smallint,
  action         text     NOT NULL,
  from_status    text,
  to_status      text,
  actor_user_id  uuid,
  request_id     uuid,
  metadata       jsonb    NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 같은 요청(버튼 연타·재전송)은 한 번만 전이되도록 하는 키
CREATE UNIQUE INDEX IF NOT EXISTS raid_loot_audit_request_once_idx
  ON public.raid_loot_audit_events (raid_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS raid_loot_audit_raid_idx
  ON public.raid_loot_audit_events (raid_id, created_at DESC);

-- 6. 기존 CHECK 제약 확장 (기존 허용 값 보존 + RAID_LOOT 추가) -------------------

-- 6-1. 편린 조각 장부: 이벤트 종류
ALTER TABLE public.expedition_fragment_ledger
  DROP CONSTRAINT IF EXISTS expedition_fragment_ledger_event_chk;
ALTER TABLE public.expedition_fragment_ledger
  ADD CONSTRAINT expedition_fragment_ledger_event_chk CHECK (
    event_type = ANY (ARRAY['REWARD'::text, 'RESTORE'::text, 'TEACHER_ADJUST'::text, 'MIGRATION'::text, 'RAID_LOOT'::text])
  );

-- 6-2. 편린 조각 장부: 행 모양 (기존 3가지 규칙 그대로 + RAID_LOOT 규칙)
ALTER TABLE public.expedition_fragment_ledger
  DROP CONSTRAINT IF EXISTS expedition_fragment_ledger_shape_chk;
ALTER TABLE public.expedition_fragment_ledger
  ADD CONSTRAINT expedition_fragment_ledger_shape_chk CHECK (
    ((event_type = 'REWARD'::text) AND (delta > 0) AND (source_run_id IS NOT NULL))
    OR ((event_type = 'RESTORE'::text) AND (delta < 0) AND (source_character_id IS NOT NULL))
    OR (event_type = ANY (ARRAY['TEACHER_ADJUST'::text, 'MIGRATION'::text]))
    OR ((event_type = 'RAID_LOOT'::text) AND (delta > 0)
        AND (source_run_id IS NULL) AND (source_character_id IS NULL) AND (request_id IS NOT NULL))
  );

-- 6-3. 편린 획득 이력: 이벤트 종류
ALTER TABLE public.character_acquisition_events
  DROP CONSTRAINT IF EXISTS character_event_type;
ALTER TABLE public.character_acquisition_events
  ADD CONSTRAINT character_event_type CHECK (
    event_type = ANY (ARRAY['RECRUIT'::text, 'TEACHER_GRANT'::text, 'RESTORE'::text, 'REVOKE'::text, 'MIGRATION'::text, 'RAID_LOOT'::text])
  );

-- 7. 전리품 거래는 라운드 1개당 정확히 1건 ------------------------------------------
--   (기존 ux_transactions_raid_reward_once 는 그대로 둡니다.)
CREATE UNIQUE INDEX IF NOT EXISTS ux_transactions_raid_loot_once
  ON public.transactions (source_id)
  WHERE source_type = 'RAID_LOOT'::public.transaction_source_type;

-- 8. 보안: RLS 켜기 + 브라우저 직접 접근 차단 -----------------------------------------
ALTER TABLE public.raid_loot_configs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raid_loot_character_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raid_loot_ceremonies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raid_loot_rounds         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raid_loot_audit_events   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.raid_loot_configs        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.raid_loot_character_pool FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.raid_loot_ceremonies     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.raid_loot_rounds         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.raid_loot_audit_events   FROM PUBLIC, anon, authenticated;

COMMIT;
