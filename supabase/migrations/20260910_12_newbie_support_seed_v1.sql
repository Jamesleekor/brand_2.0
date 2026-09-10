-- B.R.A.N.D. 2.0 — Newbie Support template v1 seed
WITH upsert_template AS (
  INSERT INTO private.newbie_support_templates(
    code,version,name,is_active,regular_percent,completion_percent,
    mentor_min_count,mentor_max_count,mentor_min_valid_help,
    mentor_base_reward_crystal,best_mentor_bonus_crystal,mentor_p2p_cap
  ) VALUES ('NEWBIE_SETTLEMENT',1,'뉴비 정착 지원 v1',true,80,20,2,3,3,2000,1000,1)
  ON CONFLICT(code,version) DO UPDATE SET
    name=excluded.name,is_active=true,regular_percent=80,completion_percent=20,
    mentor_min_count=2,mentor_max_count=3,mentor_min_valid_help=3,
    mentor_base_reward_crystal=2000,best_mentor_bonus_crystal=1000,mentor_p2p_cap=1
  RETURNING id
), template AS (
  SELECT id FROM upsert_template
  UNION ALL
  SELECT id FROM private.newbie_support_templates WHERE code='NEWBIE_SETTLEMENT' AND version=1
  LIMIT 1
), src(quest_code,title,description,target_count,weight_per_completion,verification_type,sort_order,config) AS (
  VALUES
    ('P2P_SELL_REVIEW','2차 직업 서비스 판매','반 친구들에게 2차 직업 서비스를 제공하고 후기와 평점을 받으세요.',10,1,'P2P_SELL_REVIEW',10,'{}'::jsonb),
    ('P2P_BUY_REVIEW','2차 직업 서비스 구매','친구들의 2차 직업 서비스를 구매하고 후기와 평점을 남기세요.',10,1,'P2P_BUY_REVIEW',20,'{}'::jsonb),
    ('COLLECTION_FIRST','편린 컬렉션 1종 완성','마스코트 컬렉션을 제외한 새로운 편린 컬렉션 1종을 완성하세요.',1,3,'COLLECTION_FIRST',30,'{}'::jsonb),
    ('COLLECTION_SECOND','두 번째 편린 컬렉션 완성','첫 번째 컬렉션 승인 후 서로 다른 두 번째 컬렉션을 완성하세요.',1,4,'COLLECTION_SECOND',40,'{}'::jsonb),
    ('PUBLIC_REQUEST_DELIVERY','공공의뢰 납품','정착 프로그램에 지정된 공공의뢰에 제작 작품을 납품하세요.',1,3,'PUBLIC_REQUEST_DELIVERY',50,'{}'::jsonb),
    ('CLASS_HELP_BONUS_300','수업 참여·학급 도움 +300','수업 참여나 학급 도움으로 +300 BV 보너스를 받으세요.',3,2,'CLASS_HELP_BONUS_300',60,'{}'::jsonb),
    ('ARCADE_FOCUS_50000','집중 반응 50,000점','아케이드 집중 반응 일반 플레이에서 50,000점 이상을 기록하세요.',1,4,'ARCADE_FOCUS_50000',70,jsonb_build_object('game_code','focus_reaction_01','score',50000))
)
INSERT INTO private.newbie_support_template_quests(
  template_id,quest_code,title,description,target_count,weight_per_completion,verification_type,sort_order,config
)
SELECT t.id,s.quest_code,s.title,s.description,s.target_count,s.weight_per_completion,s.verification_type,s.sort_order,s.config
FROM template t CROSS JOIN src s
ON CONFLICT(template_id,quest_code) DO UPDATE SET
  title=excluded.title,description=excluded.description,target_count=excluded.target_count,
  weight_per_completion=excluded.weight_per_completion,verification_type=excluded.verification_type,
  sort_order=excluded.sort_order,config=excluded.config;

DO $do$
DECLARE v_template_id bigint; v_rows int; v_count int; v_weight int; v_codes text[];
BEGIN
  SELECT id INTO v_template_id FROM private.newbie_support_templates WHERE code='NEWBIE_SETTLEMENT' AND version=1;
  SELECT count(*),sum(target_count),sum(target_count*weight_per_completion),array_agg(quest_code ORDER BY quest_code)
    INTO v_rows,v_count,v_weight,v_codes
  FROM private.newbie_support_template_quests WHERE template_id=v_template_id;
  IF v_rows<>7 OR v_count<>27 OR v_weight<>40 OR v_codes<>ARRAY[
    'ARCADE_FOCUS_50000','CLASS_HELP_BONUS_300','COLLECTION_FIRST','COLLECTION_SECOND',
    'P2P_BUY_REVIEW','P2P_SELL_REVIEW','PUBLIC_REQUEST_DELIVERY'
  ]::text[] THEN
    RAISE EXCEPTION '[NEWBIE] template v1 seed invariant failed rows=% count=% weight=% codes=%',v_rows,v_count,v_weight,v_codes USING ERRCODE='PNB23';
  END IF;
END
$do$;
