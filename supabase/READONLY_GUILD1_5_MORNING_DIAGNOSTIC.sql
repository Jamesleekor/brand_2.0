-- B.R.A.N.D 2.0 Guild1~5 morning diagnostic
-- READ ONLY. No INSERT/UPDATE/DELETE/RPC mutation.
WITH fixture AS (
  SELECT id AS fixture_id,classroom_id,season_id,guild_id
  FROM public.test_classroom_fixtures
  WHERE fixture_code='BRAND_TEST_V1'
  LIMIT 1
), scope AS (
  SELECT f.*,to_char((now() AT TIME ZONE 'Asia/Seoul')::date,'YYYY-MM') AS year_month
  FROM fixture f
), checks AS (
  SELECT 10 AS check_order,'fixture'::text AS check_name,
         CASE WHEN EXISTS(SELECT 1 FROM fixture) THEN 'PASS' ELSE 'FAIL' END AS status,
         coalesce((SELECT jsonb_build_object('classroom_id',classroom_id,'season_id',season_id,'guild_id',guild_id) FROM fixture),'{}'::jsonb) AS detail
  UNION ALL
  SELECT 20,'fixture_students',CASE WHEN count(*)=5 THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('count',count(*),'students',coalesce(jsonb_agg(jsonb_build_object('code',fs.fixture_student_code,'student_id',fs.student_id) ORDER BY fs.fixture_slot),'[]'::jsonb))
  FROM public.test_classroom_fixture_students fs JOIN fixture f ON f.fixture_id=fs.fixture_id
  UNION ALL
  SELECT 30,'active_membership',CASE WHEN count(*)=5 AND count(DISTINCT gm.student_id)=5 THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('active_rows',count(*),'distinct_students',count(DISTINCT gm.student_id))
  FROM public.guild_members gm
  JOIN public.test_classroom_fixture_students fs ON fs.student_id=gm.student_id
  JOIN fixture f ON f.fixture_id=fs.fixture_id
  WHERE gm.left_at IS NULL
  UNION ALL
  SELECT 40,'guild2_current_month',CASE WHEN coalesce(sum(CASE WHEN c.guild_context_status<>'RESOLVED' THEN 1 ELSE 0 END),0)=0 THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object(
           'rows',count(*),
           'unresolved',coalesce(sum(CASE WHEN c.guild_context_status<>'RESOLVED' THEN 1 ELSE 0 END),0),
           'not_ready_peer',coalesce(sum(CASE WHEN c.peer_status<>'READY' THEN 1 ELSE 0 END),0),
           'not_ready_mission',coalesce(sum(CASE WHEN c.mission_status<>'READY' THEN 1 ELSE 0 END),0),
           'not_ready_session',coalesce(sum(CASE WHEN c.session_status<>'READY' THEN 1 ELSE 0 END),0),
           'not_ready_arcade',coalesce(sum(CASE WHEN c.arcade_status<>'READY' THEN 1 ELSE 0 END),0)
         )
  FROM scope s LEFT JOIN public.guild2_individual_contributions c
    ON c.classroom_id=s.classroom_id AND c.season_id=s.season_id AND c.year_month=s.year_month
  UNION ALL
  SELECT 50,'guild3_current_month','INFO',
         jsonb_build_object('missions',coalesce((SELECT jsonb_object_agg(x.lifecycle_state,x.cnt) FROM (
           SELECT m.lifecycle_state,count(*) AS cnt FROM scope s JOIN public.guild3_missions m ON m.classroom_id=s.classroom_id AND m.season_id=s.season_id AND m.contribution_year_month=s.year_month GROUP BY m.lifecycle_state
         ) x),'{}'::jsonb))
  UNION ALL
  SELECT 60,'guild4_current_month',CASE WHEN coalesce((SELECT count(*) FROM public.guild4_peer_review_obligations o JOIN public.guild4_peer_review_rounds r ON r.id=o.round_id JOIN scope s ON s.classroom_id=r.classroom_id AND s.season_id=r.season_id WHERE o.reviewer_student_id=o.target_student_id),0)=0 THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object(
           'round_states',coalesce((SELECT jsonb_object_agg(x.lifecycle_state,x.cnt) FROM (SELECT r.lifecycle_state,count(*) cnt FROM scope s JOIN public.guild4_peer_review_rounds r ON r.classroom_id=s.classroom_id AND r.season_id=s.season_id GROUP BY r.lifecycle_state) x),'{}'::jsonb),
           'self_review_obligations',coalesce((SELECT count(*) FROM public.guild4_peer_review_obligations o JOIN public.guild4_peer_review_rounds r ON r.id=o.round_id JOIN scope s ON s.classroom_id=r.classroom_id AND s.season_id=r.season_id WHERE o.reviewer_student_id=o.target_student_id),0)
         )
  UNION ALL
  SELECT 70,'guild5_current_month','INFO',
         coalesce((SELECT jsonb_build_object('closure_id',c.id,'state',c.lifecycle_state,'current_version_id',c.current_version_id,'year_month',c.year_month) FROM scope s JOIN public.guild5_month_closures c ON c.classroom_id=s.classroom_id AND c.season_id=s.season_id AND c.year_month=s.year_month),'{}'::jsonb)
  UNION ALL
  SELECT 80,'guild5_current_snapshot','INFO',
         jsonb_build_object(
           'version_no',v.version_no,
           'student_snapshots',(SELECT count(*) FROM public.guild5_student_snapshots ss WHERE ss.version_id=v.id),
           'guild_snapshots',(SELECT count(*) FROM public.guild5_guild_snapshots gs WHERE gs.version_id=v.id),
           'ranked_guilds',(SELECT count(*) FROM public.guild5_guild_snapshots gs WHERE gs.version_id=v.id AND gs.rank_position IS NOT NULL),
           'conquest_turns',(SELECT count(*) FROM public.guild5_conquest_turns ct WHERE ct.version_id=v.id),
           'assigned_turns',(SELECT count(*) FROM public.guild5_conquest_turns ct WHERE ct.version_id=v.id AND ct.turn_status IN ('ASSIGNED','AUTO_ASSIGNED'))
         )
  FROM scope s JOIN public.guild5_month_closures c ON c.classroom_id=s.classroom_id AND c.season_id=s.season_id AND c.year_month=s.year_month
  JOIN public.guild5_closure_versions v ON v.id=c.current_version_id
  UNION ALL
  SELECT 90,'freeze_helpers',CASE WHEN to_regprocedure('public.guild5_month_is_frozen(integer,integer,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('guild5_month_is_frozen',to_regprocedure('public.guild5_month_is_frozen(integer,integer,text)')::text)
)
SELECT * FROM checks ORDER BY check_order;
