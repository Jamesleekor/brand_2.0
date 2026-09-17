-- Applied to production on 2026-09-17. Idempotent source-control copy.
INSERT INTO public.cosmetic_items
  (item_uid, classroom_id, category, name, description, resource_url, is_active)
VALUES
  ('FONT_MONA12', NULL, 'font', '모나12', '교사가 특별 지급하는 한정 폰트입니다. 상점에서는 구매할 수 없습니다.', 'font:mona12-kr', false)
ON CONFLICT (item_uid) DO UPDATE
SET category = EXCLUDED.category,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    resource_url = EXCLUDED.resource_url,
    is_active = false,
    updated_at = now();

UPDATE public.cosmetic_item_pricings p
SET is_active = false
WHERE p.item_id = (SELECT id FROM public.cosmetic_items WHERE item_uid = 'FONT_MONA12');

CREATE OR REPLACE FUNCTION public.teacher_get_special_font_grant_board(p_classroom_id integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_item_id integer; v_item jsonb; v_students jsonb;
BEGIN
  PERFORM public.character_teacher_require_classroom(p_classroom_id);
  SELECT ci.id, jsonb_build_object('item_id',ci.id,'item_uid',ci.item_uid,'name',ci.name,'description',ci.description,'is_active',ci.is_active)
  INTO v_item_id,v_item FROM public.cosmetic_items ci WHERE ci.item_uid='FONT_MONA12' AND lower(ci.category)='font';
  IF v_item_id IS NULL THEN RAISE EXCEPTION 'Special font catalog item is missing' USING ERRCODE='PFC31'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('student_id',s.id,'name',s.name,'brand_name',s.brand_name,'owned',(sco.id IS NOT NULL),'is_equipped',COALESCE(sco.is_equipped,false),'ownership_id',sco.id) ORDER BY s.name,s.id),'[]'::jsonb)
  INTO v_students
  FROM public.students s LEFT JOIN public.student_cosmetic_ownerships sco ON sco.student_id=s.id AND sco.item_id=v_item_id
  WHERE s.classroom_id=p_classroom_id AND s.transferred_at IS NULL AND s.role IN ('STUDENT','STUDENT_LEADER','GUARD');
  RETURN jsonb_build_object('item',v_item,'students',v_students);
END; $$;

CREATE OR REPLACE FUNCTION public.teacher_grant_special_font(p_classroom_id integer,p_student_id integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_item_id integer; v_ownership_id bigint; v_already_owned boolean := false;
BEGIN
  PERFORM public.character_teacher_require_classroom(p_classroom_id);
  IF NOT EXISTS (SELECT 1 FROM public.students s WHERE s.id=p_student_id AND s.classroom_id=p_classroom_id AND s.transferred_at IS NULL AND s.role IN ('STUDENT','STUDENT_LEADER','GUARD')) THEN
    RAISE EXCEPTION 'Student is not an active member of this classroom' USING ERRCODE='PFC32';
  END IF;
  SELECT ci.id INTO v_item_id FROM public.cosmetic_items ci WHERE ci.item_uid='FONT_MONA12' AND lower(ci.category)='font';
  IF v_item_id IS NULL THEN RAISE EXCEPTION 'Special font catalog item is missing' USING ERRCODE='PFC31'; END IF;
  SELECT sco.id INTO v_ownership_id FROM public.student_cosmetic_ownerships sco WHERE sco.student_id=p_student_id AND sco.item_id=v_item_id;
  IF v_ownership_id IS NOT NULL THEN v_already_owned := true;
  ELSE
    INSERT INTO public.student_cosmetic_ownerships(student_id,item_id,transaction_id,obtained_via,is_equipped)
    VALUES(p_student_id,v_item_id,NULL,'TEACHER_GRANT'::public.cosmetic_obtained_via,false)
    RETURNING id INTO v_ownership_id;
  END IF;
  RETURN jsonb_build_object('ownership_id',v_ownership_id,'student_id',p_student_id,'item_uid','FONT_MONA12','already_owned',v_already_owned);
END; $$;

CREATE OR REPLACE FUNCTION public.teacher_revoke_special_font(p_classroom_id integer,p_student_id integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_item_id integer; v_removed bigint;
BEGIN
  PERFORM public.character_teacher_require_classroom(p_classroom_id);
  IF NOT EXISTS (SELECT 1 FROM public.students s WHERE s.id=p_student_id AND s.classroom_id=p_classroom_id AND s.transferred_at IS NULL) THEN
    RAISE EXCEPTION 'Student is not an active member of this classroom' USING ERRCODE='PFC32';
  END IF;
  SELECT ci.id INTO v_item_id FROM public.cosmetic_items ci WHERE ci.item_uid='FONT_MONA12' AND lower(ci.category)='font';
  IF v_item_id IS NULL THEN RAISE EXCEPTION 'Special font catalog item is missing' USING ERRCODE='PFC31'; END IF;
  DELETE FROM public.student_cosmetic_ownerships sco WHERE sco.student_id=p_student_id AND sco.item_id=v_item_id RETURNING sco.id INTO v_removed;
  RETURN jsonb_build_object('student_id',p_student_id,'item_uid','FONT_MONA12','removed',v_removed IS NOT NULL);
END; $$;

REVOKE ALL ON FUNCTION public.teacher_get_special_font_grant_board(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_grant_special_font(integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_revoke_special_font(integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_get_special_font_grant_board(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_grant_special_font(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_revoke_special_font(integer,integer) TO authenticated;
