-- B.R.A.N.D 2.0 F4B — emergency quest CRYSTAL rewards

ALTER TABLE public.emergency_quests
  ADD COLUMN IF NOT EXISTS reward_crystal integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.emergency_quests'::regclass
      AND conname = 'emergency_quests_reward_crystal_check'
  ) THEN
    ALTER TABLE public.emergency_quests
      ADD CONSTRAINT emergency_quests_reward_crystal_check
      CHECK (reward_crystal BETWEEN 0 AND 10000);
  END IF;
END $$;

ALTER TABLE public.emergency_quest_completions
  ADD COLUMN IF NOT EXISTS crystal_transaction_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.emergency_quest_completions'::regclass
      AND conname = 'emergency_quest_completions_crystal_transaction_id_fkey'
  ) THEN
    ALTER TABLE public.emergency_quest_completions
      ADD CONSTRAINT emergency_quest_completions_crystal_transaction_id_fkey
      FOREIGN KEY (crystal_transaction_id) REFERENCES public.transactions(id);
  END IF;
END $$;

-- Keep the existing 6-argument RPC for older clients. The 7-argument overload is
-- selected by current clients because they provide p_reward_crystal explicitly.
CREATE OR REPLACE FUNCTION public.teacher_create_emergency_quest(
  p_classroom_id integer,
  p_title text,
  p_description text,
  p_reward_gold integer,
  p_reward_bv integer,
  p_duration_minutes integer,
  p_reward_crystal integer
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF NOT public.is_classroom_member(p_classroom_id) THEN
    RAISE EXCEPTION '[F4B] teacher classroom denied' USING ERRCODE='P4B10';
  END IF;
  IF char_length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION '[F4B] quest title invalid' USING ERRCODE='P4B20';
  END IF;
  IF char_length(btrim(coalesce(p_description,''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION '[F4B] quest description invalid' USING ERRCODE='P4B21';
  END IF;
  IF p_reward_gold NOT BETWEEN 0 AND 10000
     OR p_reward_bv NOT BETWEEN 0 AND 10000
     OR p_reward_crystal NOT BETWEEN 0 AND 10000
     OR (p_reward_gold=0 AND p_reward_bv=0 AND p_reward_crystal=0) THEN
    RAISE EXCEPTION '[F4B] quest reward invalid' USING ERRCODE='P4B22';
  END IF;
  IF p_duration_minutes NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION '[F4B] quest duration invalid' USING ERRCODE='P4B23';
  END IF;

  INSERT INTO public.emergency_quests(
    classroom_id,title,description,reward_gold,reward_bv,reward_crystal,expires_at,created_by
  ) VALUES (
    p_classroom_id,btrim(p_title),btrim(p_description),p_reward_gold,p_reward_bv,p_reward_crystal,
    now()+make_interval(mins=>p_duration_minutes),auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM public.broadcast_global_alert(
    p_classroom_id,'GENERAL',format('⚡ 돌발 퀘스트: %s',btrim(p_title)),
    '⚡',NULL,'EMERGENCY_QUEST',v_id,least(24,ceil(p_duration_minutes/60.0)::int+1)
  );
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.teacher_create_emergency_quest(integer,text,text,integer,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_create_emergency_quest(integer,text,text,integer,integer,integer,integer) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.complete_emergency_quest(p_student_id integer,p_quest_id bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
  q public.emergency_quests%ROWTYPE;
  v_class integer;
  v_completion bigint;
  v_gold bigint;
  v_bv bigint;
  v_crystal bigint;
BEGIN
  PERFORM public.ensure_self_or_teacher(p_student_id);
  SELECT classroom_id INTO v_class
  FROM public.students
  WHERE id=p_student_id AND transferred_at IS NULL AND role='STUDENT';
  IF v_class IS NULL THEN
    RAISE EXCEPTION '[F4B] active student not found' USING ERRCODE='P4B25';
  END IF;

  SELECT * INTO q FROM public.emergency_quests WHERE id=p_quest_id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION '[F4B] quest not found' USING ERRCODE='P4B24'; END IF;
  IF q.classroom_id<>v_class THEN RAISE EXCEPTION '[F4B] quest belongs to another classroom' USING ERRCODE='P4B26'; END IF;
  IF q.status<>'ACTIVE' OR now()<q.starts_at OR now()>=q.expires_at THEN
    RAISE EXCEPTION '[F4B] quest is not completable' USING ERRCODE='P4B27';
  END IF;

  INSERT INTO public.emergency_quest_completions(quest_id,classroom_id,student_id)
  VALUES(q.id,v_class,p_student_id)
  RETURNING id INTO v_completion;

  IF q.reward_gold>0 THEN
    v_gold:=public.create_transaction(p_student_id,'GOLD',q.reward_gold,'DAILY_QUEST',v_completion,0,format('[돌발 퀘스트] %s',q.title));
  END IF;
  IF q.reward_bv>0 THEN
    v_bv:=public.create_transaction(p_student_id,'BV',q.reward_bv,'DAILY_QUEST',v_completion,0,format('[돌발 퀘스트 명예] %s',q.title));
  END IF;
  IF q.reward_crystal>0 THEN
    v_crystal:=public.create_transaction(p_student_id,'CRYSTAL',q.reward_crystal,'DAILY_QUEST',v_completion,0,format('[돌발 퀘스트 크리스탈] %s',q.title));
  END IF;

  UPDATE public.emergency_quest_completions
  SET gold_transaction_id=v_gold,
      bv_transaction_id=v_bv,
      crystal_transaction_id=v_crystal
  WHERE id=v_completion;

  PERFORM public.send_mail(
    p_student_id,'SYSTEM',NULL,NULL,'⚡ 돌발 퀘스트 완료',
    format('"%s" 완료 보상이 지급되었습니다.',q.title),'REWARD','DAILY_QUEST',v_completion
  );
  PERFORM public.push_activity_feed(
    v_class,'OTHER',p_student_id,
    jsonb_build_object('message','돌발 퀘스트 완료','quest_title',q.title),'PUBLIC'
  );
  RETURN v_completion;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION '[F4B] quest already completed' USING ERRCODE='P4B28';
END $$;

-- Feature 4.1 approval flow exists in newer installations. If present, upgrade
-- its internal grant helper too; older production installations simply skip it.
DO $outer$
BEGIN
  IF to_regprocedure('public._grant_emergency_quest_after_approval(integer,bigint)') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public._grant_emergency_quest_after_approval(p_student_id integer,p_quest_id bigint)
      RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
      AS $body$
      DECLARE
        q public.emergency_quests%ROWTYPE;
        v_class integer;
        v_completion bigint;
        v_gold bigint;
        v_bv bigint;
        v_crystal bigint;
      BEGIN
        SELECT classroom_id INTO v_class
        FROM public.students
        WHERE id=p_student_id AND transferred_at IS NULL AND role='STUDENT';
        IF v_class IS NULL THEN RAISE EXCEPTION '[F4B] active student not found' USING ERRCODE='P4B25'; END IF;
        SELECT * INTO q FROM public.emergency_quests WHERE id=p_quest_id FOR UPDATE;
        IF q.id IS NULL THEN RAISE EXCEPTION '[F4B] quest not found' USING ERRCODE='P4B24'; END IF;
        IF q.classroom_id<>v_class THEN RAISE EXCEPTION '[F4B] quest belongs to another classroom' USING ERRCODE='P4B26'; END IF;

        INSERT INTO public.emergency_quest_completions(quest_id,classroom_id,student_id)
        VALUES(q.id,v_class,p_student_id) RETURNING id INTO v_completion;

        IF q.reward_gold>0 THEN
          v_gold:=public.create_transaction(p_student_id,'GOLD',q.reward_gold,'DAILY_QUEST',v_completion,0,format('[돌발 퀘스트] %s',q.title));
        END IF;
        IF q.reward_bv>0 THEN
          v_bv:=public.create_transaction(p_student_id,'BV',q.reward_bv,'DAILY_QUEST',v_completion,0,format('[돌발 퀘스트 명예] %s',q.title));
        END IF;
        IF q.reward_crystal>0 THEN
          v_crystal:=public.create_transaction(p_student_id,'CRYSTAL',q.reward_crystal,'DAILY_QUEST',v_completion,0,format('[돌발 퀘스트 크리스탈] %s',q.title));
        END IF;

        UPDATE public.emergency_quest_completions
        SET gold_transaction_id=v_gold,
            bv_transaction_id=v_bv,
            crystal_transaction_id=v_crystal
        WHERE id=v_completion;

        PERFORM public.send_mail(
          p_student_id,'SYSTEM',NULL,NULL,'⚡ 돌발 퀘스트 완료',
          format('"%s" 완료 요청이 승인되어 보상이 지급되었습니다.',q.title),'REWARD','DAILY_QUEST',v_completion
        );
        PERFORM public.push_activity_feed(
          v_class,'OTHER',p_student_id,
          jsonb_build_object('message','돌발 퀘스트 완료 승인','quest_title',q.title),'PUBLIC'
        );
        RETURN v_completion;
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION '[F4B] quest already completed' USING ERRCODE='P4B28';
      END
      $body$
    $fn$;
  END IF;
END
$outer$;