-- =====================================================================
-- 퀴즈 로얄 보강 패치 2: 최종 발표에서 마지막 1·2위를 동시에 공개
-- ---------------------------------------------------------------------
-- 바꾸는 것: 함수 public.teacher_quiz_ceremony 하나뿐 (표·데이터는 건드리지 않음)
--   · 최종 발표 : 5·4·3위는 한 길드씩, 마지막 1·2위는 한 번 눌러 동시에 공개
--   · 개인전 발표 : 지금처럼 한 길드씩 (변화 없음)
-- 여러 번 실행해도 안전합니다. Supabase SQL Editor에 통째로 붙여넣고 Run.
-- =====================================================================

create or replace function public.teacher_quiz_ceremony(p_id bigint, p_action text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); v_act text := upper(coalesce(p_action, ''));
  v_res jsonb; v_max integer; v_kind text; v_n integer;
begin
  if e.phase not in ('IND_CEREMONY','FINAL_CEREMONY') then raise exception '발표 단계가 아니에요' using errcode = 'P7T03'; end if;
  v_kind := case when e.phase = 'IND_CEREMONY' then 'IND' else 'FINAL' end;
  v_res := case when v_kind = 'IND' then e.ind_result else e.final_result end;
  v_n := jsonb_array_length(coalesce(v_res->'guilds', '[]'::jsonb));
  v_max := v_n + 1;  -- 길드별 공개 + 마지막 전체 화면
  -- 최종 발표는 마지막 두 길드(1·2위)를 한 번에 공개한다: 단계가 (길드 수 − 2) → (길드 수)로 두 칸 넘어간다
  if v_act = 'STEP' then
    if e.ceremony_step >= v_max then raise exception '모두 공개했어요' using errcode = 'P7T05'; end if;
    update public.quiz_events
      set ceremony_step = ceremony_step + case when v_kind = 'FINAL' and v_n >= 2 and e.ceremony_step = v_n - 2 then 2 else 1 end
      where id = p_id;
  elsif v_act = 'BACK' then
    if e.ceremony_step <= 0 then raise exception '처음 화면이에요' using errcode = 'P7T05'; end if;
    update public.quiz_events
      set ceremony_step = ceremony_step - case when v_kind = 'FINAL' and v_n >= 2 and e.ceremony_step = v_n then 2 else 1 end
      where id = p_id;
  elsif v_act = 'RESNAP' then
    if e.ceremony_step > 0 then raise exception '공개를 시작한 뒤에는 다시 집계할 수 없어요. 처음 화면으로 돌아간 뒤 해 주세요' using errcode = 'P7T03'; end if;
    if v_kind = 'IND' then
      update public.quiz_events set ind_result = brand_quiz.result_snapshot(p_id, 'IND') where id = p_id;
    else
      update public.quiz_events set final_result = brand_quiz.result_snapshot(p_id, 'FINAL') where id = p_id;
    end if;
    perform brand_quiz.log(p_id, 'RESNAP', null, null, jsonb_build_object('kind', v_kind));
  elsif v_act = 'ADVANCE' then
    if e.ceremony_step < v_max then raise exception '발표를 끝까지 공개한 뒤 넘어갈 수 있어요' using errcode = 'P7T03'; end if;
    if v_kind = 'IND' then
      if brand_quiz.cfg_bool(e.config, 'use_team', true) and brand_quiz.next_question(p_id, 'TEAM', 0) is not null then
        perform brand_quiz.enter_stage(p_id, 'TEAM');
        update public.quiz_events set public_board = brand_quiz.board_snapshot(p_id, '개인전 결과') where id = p_id;
      else
        update public.quiz_events set phase = 'FINAL_CEREMONY', ceremony_step = 0,
          final_result = brand_quiz.result_snapshot(p_id, 'FINAL') where id = p_id;
      end if;
    else
      update public.quiz_events set phase = 'COMPLETED', completed_at = now(),
        public_board = brand_quiz.board_snapshot(p_id, '최종') where id = p_id;
      perform brand_quiz.lifecycle_signal(e.classroom_id, p_id);
    end if;
    perform brand_quiz.log(p_id, 'CEREMONY_ADVANCE', null, null, jsonb_build_object('kind', v_kind));
  else
    raise exception '알 수 없는 동작이에요' using errcode = 'P7T04';
  end if;
  perform brand_quiz.touch(p_id);
  perform brand_quiz.bump(p_id, true, jsonb_build_object('event', 'CEREMONY'));
  return jsonb_build_object('ok', true);
end
$fn$;

-- 확인: 아래가 true 이면 적용 완료
select position('v_n - 2' in pg_get_functiondef('public.teacher_quiz_ceremony(bigint,text)'::regprocedure)) > 0 as patched;
