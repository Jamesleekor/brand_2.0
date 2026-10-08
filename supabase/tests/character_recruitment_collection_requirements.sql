-- SQL Editor-safe tests. All fixture changes roll back, including policy/group changes.
BEGIN;
CREATE TEMP TABLE recruitment_requirement_test_results(label text, passed boolean) ON COMMIT DROP;
DO $test$
DECLARE
  s record;
  v_policy bigint;
  v_group bigint;
  v_other_group bigint;
  v_req bigint;
  v_failed_req bigint;
  v_count bigint;
  v_value bigint;
  v_completed bigint;
  v_ids bigint[];
  v_missing bigint;
  v_check boolean;
BEGIN
  FOR s IN SELECT id,classroom_id FROM public.students
    WHERE transferred_at IS NULL AND role::text='STUDENT'
  LOOP
    SELECT p.id INTO v_policy FROM public.character_recruitment_policies p
      WHERE p.classroom_id=s.classroom_id ORDER BY p.id LIMIT 1;
    IF v_policy IS NULL THEN CONTINUE; END IF;
    -- Isolate a fixture policy inside the rollback-only transaction.
    UPDATE public.character_recruitment_policies SET status='ACTIVE',is_recruitable=true,requirement_mode='GROUPS' WHERE id=v_policy;
    UPDATE public.character_requirement_groups SET is_active=false WHERE policy_id=v_policy;
    INSERT INTO public.character_requirement_groups(policy_id,group_no,label,is_active)
      SELECT v_policy,COALESCE(max(group_no),0)+1,'ROLLBACK-ONLY TEST',true
      FROM public.character_requirement_groups WHERE policy_id=v_policy
      RETURNING id INTO v_group;
    SELECT count(*),COALESCE(sum(CASE WHEN o.acquisition_mode='CRYSTAL' THEN o.base_price_crystal ELSE 0 END),0)
      INTO v_count,v_value FROM public.student_characters sc
      LEFT JOIN public.character_recruitment_offers o ON o.classroom_id=s.classroom_id AND o.character_id=sc.character_id
      WHERE sc.student_id=s.id AND sc.classroom_id=s.classroom_id AND sc.is_owned=true;
    SELECT count(*) INTO v_completed FROM public.character_collections cc
      WHERE cc.classroom_id=s.classroom_id AND cc.is_active AND cc.is_visible
        AND public.character_collection_is_complete(s.id,cc.id);
    INSERT INTO public.character_requirements(group_id,requirement_type,required_numeric,is_active)
      VALUES(v_group,'OWNED_CHARACTER_COUNT',greatest(1,v_count),true) RETURNING id INTO v_req;
    v_check:=public.character_requirement_met(s.id,v_req)=(v_count>0);
    INSERT INTO recruitment_requirement_test_results VALUES('count exact boundary',v_check);
    UPDATE public.character_requirements SET required_numeric=v_count+1 WHERE id=v_req;
    INSERT INTO recruitment_requirement_test_results VALUES('count +1 rejected',NOT public.character_requirement_met(s.id,v_req));

    UPDATE public.character_requirements SET requirement_type='OWNED_CHARACTER_VALUE',required_numeric=greatest(1,v_value) WHERE id=v_req;
    INSERT INTO recruitment_requirement_test_results VALUES('value exact boundary',public.character_requirement_met(s.id,v_req)=(v_value>0));
    UPDATE public.character_requirements SET required_numeric=v_value+1 WHERE id=v_req;
    INSERT INTO recruitment_requirement_test_results VALUES('value +1 rejected',NOT public.character_requirement_met(s.id,v_req));

    UPDATE public.character_requirements SET requirement_type='COMPLETED_COLLECTION_COUNT',required_numeric=greatest(1,v_completed) WHERE id=v_req;
    INSERT INTO recruitment_requirement_test_results VALUES('collections exact boundary',public.character_requirement_met(s.id,v_req)=(v_completed>0));
    UPDATE public.character_requirements SET required_numeric=v_completed+1 WHERE id=v_req;
    INSERT INTO recruitment_requirement_test_results VALUES('collections +1 rejected',NOT public.character_requirement_met(s.id,v_req));

    SELECT array_agg(x.character_id) INTO v_ids FROM (
      SELECT sc.character_id FROM public.student_characters sc
      WHERE sc.student_id=s.id AND sc.classroom_id=s.classroom_id AND sc.is_owned=true
      ORDER BY sc.character_id LIMIT 2
    ) x;
    UPDATE public.character_requirements SET requirement_type='OWNED_CHARACTERS',required_numeric=1,
      metadata=jsonb_build_object('required_character_ids',COALESCE(to_jsonb(v_ids),'[]'::jsonb)) WHERE id=v_req;
    INSERT INTO recruitment_requirement_test_results VALUES('selected all owned',public.character_requirement_met(s.id,v_req)=(COALESCE(cardinality(v_ids),0)>0));
    SELECT c.id INTO v_missing FROM public.characters c
      WHERE NOT EXISTS (SELECT 1 FROM public.student_characters sc
        WHERE sc.student_id=s.id AND sc.classroom_id=s.classroom_id AND sc.character_id=c.id AND sc.is_owned=true)
      ORDER BY c.id LIMIT 1;
    IF v_missing IS NOT NULL THEN
      UPDATE public.character_requirements SET metadata=jsonb_build_object('required_character_ids',
        COALESCE(to_jsonb(v_ids),'[]'::jsonb)||jsonb_build_array(v_missing)) WHERE id=v_req;
      INSERT INTO recruitment_requirement_test_results VALUES('selected one missing rejected',NOT public.character_requirement_met(s.id,v_req));
    END IF;
    UPDATE public.character_requirements SET metadata='{"required_character_ids":[]}' WHERE id=v_req;
    INSERT INTO recruitment_requirement_test_results VALUES('empty selection rejected',NOT public.character_requirement_met(s.id,v_req));
    UPDATE public.character_requirements SET metadata='{"required_character_ids":["invalid"]}' WHERE id=v_req;
    INSERT INTO recruitment_requirement_test_results VALUES('malformed selection rejected',NOT public.character_requirement_met(s.id,v_req));
    INSERT INTO recruitment_requirement_test_results VALUES('invalid student rejected',NOT public.character_requirement_met(NULL,v_req));

    -- A true AND false group must fail; a separate true OR group must pass.
    UPDATE public.character_requirements SET requirement_type='TIER_AT_LEAST',required_numeric=1,metadata='{}' WHERE id=v_req;
    INSERT INTO public.character_requirements(group_id,requirement_type,required_numeric,is_active)
      VALUES(v_group,'OWNED_CHARACTER_COUNT',v_count+1,true) RETURNING id INTO v_failed_req;
    INSERT INTO recruitment_requirement_test_results VALUES('AND failure blocks policy',NOT public.character_policy_eligible(s.id,v_policy));
    INSERT INTO public.character_requirement_groups(policy_id,group_no,label,is_active)
      SELECT v_policy,max(group_no)+1,'ROLLBACK-ONLY OR TEST',true FROM public.character_requirement_groups WHERE policy_id=v_policy
      RETURNING id INTO v_other_group;
    INSERT INTO public.character_requirements(group_id,requirement_type,required_numeric,is_active)
      VALUES(v_other_group,'TIER_AT_LEAST',1,true);
    INSERT INTO recruitment_requirement_test_results VALUES('OR alternate allows policy',public.character_policy_eligible(s.id,v_policy));
    UPDATE public.character_requirement_groups SET is_active=false WHERE id IN (v_group,v_other_group);
  END LOOP;
  INSERT INTO recruitment_requirement_test_results VALUES('internal helper blocked for students',
    NOT has_function_privilege('authenticated','public.character_requirement_met(integer,bigint)','EXECUTE'));
  INSERT INTO recruitment_requirement_test_results VALUES('internal helper blocked for anon',
    NOT has_function_privilege('anon','public.character_requirement_met(integer,bigint)','EXECUTE'));
  IF EXISTS (SELECT 1 FROM recruitment_requirement_test_results WHERE NOT passed OR passed IS NULL) THEN
    RAISE EXCEPTION 'Recruitment requirement tests failed';
  END IF;
END;
$test$;
SELECT label,count(*) AS checked,bool_and(passed) AS passed
  FROM recruitment_requirement_test_results GROUP BY label ORDER BY label;
ROLLBACK;
