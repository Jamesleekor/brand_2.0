-- 2026-10-10 명품관 명예 테두리 3종 시험 판매. 운영 DB에 이미 적용됨.
-- 적용 전 현재 운영 DB 상태 확인; 동일 변경을 다시 적용해도 구매 이력은 변경하지 않는다.
begin;

insert into public.cosmetic_items(item_uid,category,name,description,resource_url,is_active)
values
  ('PRESTIGE_MOON_2026','prestige_border','월광의 유리','달빛과 푸른 수정이 새겨진 명예 테두리.','data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNjAgMTYwIiBmaWxsPSJub25lIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ibWV0YWwiIHgxPSIwIiB5MT0iMCIgeDI9IjE2MCIgeTI9IjE2MCIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPjxzdG9wIHN0b3AtY29sb3I9IiNCOUVCRkYiLz48c3RvcCBvZmZzZXQ9Ii40OCIgc3RvcC1jb2xvcj0iIzVGOTFENSIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0VFRTVGRiIvPjwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxpZ2h0IiB4MT0iMCIgeTE9IjAiIHgyPSIxNjAiIHkyPSIxNjAiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj48c3RvcCBzdG9wLWNvbG9yPSIjRkZGOEZGIi8+PHN0b3Agb2Zmc2V0PSIuNTUiIHN0b3AtY29sb3I9IiM5REUxRkYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM3RDc4REEiLz48L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8cmVjdCB4PSI1IiB5PSI1IiB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgcng9IjI3IiBzdHJva2U9IiNBN0RCRkYiIHN0cm9rZS1vcGFjaXR5PSIuNDUiIHN0cm9rZS13aWR0aD0iMyIvPgogIDxyZWN0IHg9IjkiIHk9IjkiIHdpZHRoPSIxNDIiIGhlaWdodD0iMTQyIiByeD0iMjQiIHN0cm9rZT0idXJsKCNtZXRhbCkiIHN0cm9rZS13aWR0aD0iMyIvPgogIDxyZWN0IHg9IjE3IiB5PSIxNyIgd2lkdGg9IjEyNiIgaGVpZ2h0PSIxMjYiIHJ4PSIxNyIgc3Ryb2tlPSJ1cmwoI2xpZ2h0KSIgc3Ryb2tlLW9wYWNpdHk9Ii44NSIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgPHBhdGggZD0iTTMwIDEyaDMwTTEwMCAxMmgzME0zMCAxNDhoMzBNMTAwIDE0OGgzME0xMiAzMnYyOG0wIDQwdjI4bTEzNi05NnYyOG0wIDQwdjI4IiBzdHJva2U9IiNEOEYzRkYiIHN0cm9rZS1vcGFjaXR5PSIuOCIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8cGF0aCBkPSJNMjggNDFjLTEzLTQtMTQtMjItMy0yOS0zIDEwIDIgMTggMTMgMjAtMiA1LTUgOC0xMCA5Wm0xMDQgMGMxMy00IDE0LTIyIDMtMjkgMyAxMC0yIDE4LTEzIDIwIDIgNSA1IDggMTAgOVpNMjggMTE5Yy0xMyA0LTE0IDIyLTMgMjktMy0xMCAyLTE4IDEzLTIwLTItNS01LTgtMTAtOVptMTA0IDBjMTMgNCAxNCAyMiAzIDI5IDMtMTAtMi0xOC0xMy0yMCAyLTUgNS04IDEwLTlaIiBmaWxsPSJ1cmwoI2xpZ2h0KSIgc3Ryb2tlPSIjRERFRUZGIiBzdHJva2Utd2lkdGg9IjEuNCIvPgogIDxwYXRoIGQ9Im04MCA1IDMgNi0zIDYtMy02IDMtNlptMCAxMzggMyA2LTMgNi0zLTYgMy02Wk01IDgwbDYtMyA2IDMtNiAzLTYtM1ptMTM4IDAgNi0zIDYgMy02IDMtNi0zWiIgZmlsbD0iI0Y4RjRGRiIvPgogIDxjaXJjbGUgY3g9IjgwIiBjeT0iMTEiIHI9IjIiIGZpbGw9IiNDMUU3RkYiLz48Y2lyY2xlIGN4PSI4MCIgY3k9IjE0OSIgcj0iMiIgZmlsbD0iI0MxRTdGRiIvPgo8L3N2Zz4K',true),
  ('PRESTIGE_TREE_2026','prestige_border','세계수의 서약','에메랄드 잎맥이 흐르는 명예 테두리.','data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNjAgMTYwIiBmaWxsPSJub25lIj4KICA8ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9InZpbmUiIHgxPSIwIiB5MT0iMCIgeDI9IjE2MCIgeTI9IjE2MCIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPjxzdG9wIHN0b3AtY29sb3I9IiNFN0ZGQjEiLz48c3RvcCBvZmZzZXQ9Ii40MiIgc3RvcC1jb2xvcj0iIzY1RDdBNCIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0JERkJERCIvPjwvbGluZWFyR3JhZGllbnQ+PGxpbmVhckdyYWRpZW50IGlkPSJsZWFmIiB4MT0iMCIgeTE9IjAiIHgyPSIxNjAiIHkyPSIxNjAiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj48c3RvcCBzdG9wLWNvbG9yPSIjRjJGOUMxIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMkJCQTg5Ii8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+CiAgPHJlY3QgeD0iNSIgeT0iNSIgd2lkdGg9IjE1MCIgaGVpZ2h0PSIxNTAiIHJ4PSIyNyIgc3Ryb2tlPSIjQzdGMkIxIiBzdHJva2Utb3BhY2l0eT0iLjQiIHN0cm9rZS13aWR0aD0iMyIvPgogIDxyZWN0IHg9IjEwIiB5PSIxMCIgd2lkdGg9IjE0MCIgaGVpZ2h0PSIxNDAiIHJ4PSIyMyIgc3Ryb2tlPSJ1cmwoI3ZpbmUpIiBzdHJva2Utd2lkdGg9IjMiLz4KICA8cmVjdCB4PSIxOCIgeT0iMTgiIHdpZHRoPSIxMjQiIGhlaWdodD0iMTI0IiByeD0iMTYiIHN0cm9rZT0iI0FGRUZDQSIgc3Ryb2tlLW9wYWNpdHk9Ii44IiBzdHJva2Utd2lkdGg9IjIiLz4KICA8cGF0aCBkPSJNMjcgMTRjMTEgMTAgMTggMTMgMzYgMTFNMTMzIDE0Yy0xMSAxMC0xOCAxMy0zNiAxMU0yNyAxNDZjMTEtMTAgMTgtMTMgMzYtMTFtNzAgMTFjLTExLTEwLTE4LTEzLTM2LTExTTE0IDI3YzEwIDExIDEzIDE4IDExIDM2bTEyMS0zNmMtMTAgMTEtMTMgMTgtMTEgMzZNMTQgMTMzYzEwLTExIDEzLTE4IDExLTM2bTEyMSAzNmMtMTAtMTEtMTMtMTgtMTEtMzYiIHN0cm9rZT0idXJsKCN2aW5lKSIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgogIDxwYXRoIGQ9Ik0xMSAxMWMyMC0xIDMwIDEyIDI5IDI5QzI0IDQyIDEwIDMyIDExIDExWm0xMzggMGMtMjAtMS0zMCAxMi0yOSAyOSAxNiAyIDMwLTggMjktMjlaTTExIDE0OWMyMCAxIDMwLTEyIDI5LTI5LTE2LTItMzAgOC0yOSAyOVptMTM4IDBjLTIwIDEtMzAtMTItMjktMjkgMTYtMiAzMCA4IDI5IDI5WiIgZmlsbD0idXJsKCNsZWFmKSIgc3Ryb2tlPSIjRjNGOUNFIiBzdHJva2Utd2lkdGg9IjEuNSIvPgogIDxwYXRoIGQ9Ik0xNCAxNCAzNyAzN20xMDktMjMtMjMgMjNNMTQgMTQ2bDIzLTIzbTEwOSAyMy0yMy0yMyIgc3Ryb2tlPSIjRjdGRkUwIiBzdHJva2Utb3BhY2l0eT0iLjc4IiBzdHJva2Utd2lkdGg9IjEuNCIvPgogIDxwYXRoIGQ9Im04MCA2IDUgNS01IDUtNS01IDUtNVptMCAxMzggNSA1LTUgNS01LTUgNS01Wk02IDgwbDUtNSA1IDUtNSA1LTUtNVptMTM4IDAgNS01IDUgNS01IDUtNS01WiIgZmlsbD0iI0RCRkZDQyIvPgo8L3N2Zz4K',true),
  ('PRESTIGE_DRAGON_2026','prestige_border','황금룡의 맹세','황금 비늘과 붉은 불꽃을 품은 명예 테두리.','data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNjAgMTYwIiBmaWxsPSJub25lIj4KICA8ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImdvbGQiIHgxPSIwIiB5MT0iMCIgeDI9IjE2MCIgeTI9IjE2MCIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPjxzdG9wIHN0b3AtY29sb3I9IiNGRkYzQzMiLz48c3RvcCBvZmZzZXQ9Ii4zNSIgc3RvcC1jb2xvcj0iI0VDQTk0QiIvPjxzdG9wIG9mZnNldD0iLjY1IiBzdG9wLWNvbG9yPSIjQUU2MTNDIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjRkZFMkEwIi8+PC9saW5lYXJHcmFkaWVudD48bGluZWFyR3JhZGllbnQgaWQ9ImVtYmVyIiB4MT0iMCIgeTE9IjAiIHgyPSIxNjAiIHkyPSIxNjAiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj48c3RvcCBzdG9wLWNvbG9yPSIjRkZFNkEwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjQ0Y1QjM4Ii8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+CiAgPHJlY3QgeD0iNCIgeT0iNCIgd2lkdGg9IjE1MiIgaGVpZ2h0PSIxNTIiIHJ4PSIyNiIgc3Ryb2tlPSIjRjVCRTZCIiBzdHJva2Utb3BhY2l0eT0iLjUiIHN0cm9rZS13aWR0aD0iNCIvPgogIDxyZWN0IHg9IjkiIHk9IjkiIHdpZHRoPSIxNDIiIGhlaWdodD0iMTQyIiByeD0iMjMiIHN0cm9rZT0idXJsKCNnb2xkKSIgc3Ryb2tlLXdpZHRoPSI0Ii8+CiAgPHJlY3QgeD0iMTgiIHk9IjE4IiB3aWR0aD0iMTI0IiBoZWlnaHQ9IjEyNCIgcng9IjE2IiBzdHJva2U9IiNGN0Q2OEEiIHN0cm9rZS13aWR0aD0iMiIvPgogIDxwYXRoIGQ9Ik0zMSAxM2gzOWwxMCA3IDEwLTdoMzlNMzEgMTQ3aDM5bDEwLTcgMTAgN2gzOU0xMyAzMXYzOWw3IDEwLTcgMTB2MzltMTM0LTk4djM5bC03IDEwIDcgMTB2MzkiIHN0cm9rZT0idXJsKCNnb2xkKSIgc3Ryb2tlLXdpZHRoPSIyLjUiLz4KICA8cGF0aCBkPSJNMTEgMTFjNiA0IDE3IDMgMjMgMTEgMiAzIDAgNi00IDlsMTIgMS04IDktOC00LTExIDEwIDQtMTUtOC05Wm0xMzggMGMtNiA0LTE3IDMtMjMgMTEtMiAzIDAgNiA0IDlsLTEyIDEgOCA5IDgtNCAxMSAxMC00LTE1IDgtOVpNMTEgMTQ5YzYtNCAxNy0zIDIzLTExIDItMyAwLTYtNC05bDEyLTEtOC05LTggNC0xMS0xMCA0IDE1LTggOVptMTM4IDBjLTYtNC0xNy0zLTIzLTExLTItMyAwLTYgNC05bC0xMi0xIDgtOSA4IDQgMTEtMTAtNCAxNSA4IDlaIiBmaWxsPSJ1cmwoI2VtYmVyKSIgc3Ryb2tlPSIjRkZFNkFBIiBzdHJva2Utd2lkdGg9IjEuNiIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgogIDxwYXRoIGQ9Im04MCAzIDcgOS03IDEwLTctMTAgNy05Wm0wIDEzNSA3IDEwLTcgOS03LTkgNy0xMFpNMyA4MGw5LTcgMTAgNy0xMCA3LTktN1ptMTM1IDAgMTAtNyA5IDctOSA3LTEwLTdaIiBmaWxsPSIjRkZFM0EzIiBzdHJva2U9IiNFRkE5NUEiIHN0cm9rZS13aWR0aD0iMS41Ii8+CiAgPHBhdGggZD0ibTUzIDEyIDUgNCA1LTRtMzQgMCA1IDQgNS00TTUzIDE0OGw1LTQgNSA0bTM0IDAgNS00IDUgNE0xMiA1M2w0IDUtNCA1bTAgMzQgNCA1LTQgNW0xMzYtNTQtNCA1IDQgNW0wIDM0LTQgNSA0IDUiIHN0cm9rZT0iI0ZGRjBCOCIgc3Ryb2tlLXdpZHRoPSIyIi8+Cjwvc3ZnPgo=',true)
on conflict(item_uid) do update
set category=excluded.category,name=excluded.name,description=excluded.description,
    resource_url=excluded.resource_url,is_active=true;

insert into public.cosmetic_item_pricings(item_id,value_token,price,condition_type,is_active)
select ci.id,'GOLD',300,'NONE',true
from public.cosmetic_items ci
where ci.item_uid in ('PRESTIGE_MOON_2026','PRESTIGE_TREE_2026','PRESTIGE_DRAGON_2026')
  and not exists (
    select 1 from public.cosmetic_item_pricings cp
    where cp.item_id=ci.id and cp.value_token='GOLD' and cp.price=300
  );

insert into public.seasonal_items(item_id,season_name,available_from,available_until,is_active)
select ci.id,'원정 명품관 첫 개방',
       '2026-10-10 00:00:00+09'::timestamptz,
       '2026-11-10 00:00:00+09'::timestamptz,true
from public.cosmetic_items ci
where ci.item_uid in ('PRESTIGE_MOON_2026','PRESTIGE_TREE_2026','PRESTIGE_DRAGON_2026')
on conflict(item_id) do update
set season_name=excluded.season_name,available_from=excluded.available_from,
    available_until=excluded.available_until,is_active=true;

insert into public.expedition_luxury_catalog
  (cosmetic_item_id,luxury_group,required_effect_level,presentation_kind,is_active,metadata)
select ci.id,'B',2,'PRESTIGE_BORDER_IMAGE',true,
       '{"trial_open":true,"trial_until":"2026-11-10T00:00:00+09:00"}'::jsonb
from public.cosmetic_items ci
where ci.item_uid in ('PRESTIGE_MOON_2026','PRESTIGE_TREE_2026','PRESTIGE_DRAGON_2026')
on conflict(cosmetic_item_id) do update
set luxury_group=excluded.luxury_group,
    required_effect_level=excluded.required_effect_level,
    presentation_kind=excluded.presentation_kind,is_active=true,
    metadata=excluded.metadata;

-- 월드효과 기록은 수정하지 않는다. 이 세 상품의 판매 기간에만 특별 개방한다.
CREATE OR REPLACE FUNCTION public.student_get_expedition_luxury_shop()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student public.students%rowtype;
  v_effect jsonb;
  v_access integer;
  v_trial_access integer;
  v_now timestamptz:=clock_timestamp();
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode='42501';
  end if;

  select * into v_student
  from public.students
  where user_id=auth.uid()
    and transferred_at is null
    and role::text='STUDENT';

  if not found then
    raise exception '학생 계정을 확인할 수 없습니다.' using errcode='42501';
  end if;

  v_effect:=public._expedition_active_world_effect(v_student.classroom_id,v_now);
  v_access:=public._expedition_current_cosmetic_access_level(v_student.classroom_id,v_now);
  select coalesce(max(lc.required_effect_level),0) into v_trial_access
  from public.expedition_luxury_catalog lc
  join public.cosmetic_items ci on ci.id=lc.cosmetic_item_id
  join public.seasonal_items si on si.item_id=ci.id
  where lc.is_active=true and ci.is_active=true
    and (ci.classroom_id is null or ci.classroom_id=v_student.classroom_id)
    and si.is_active=true and v_now between si.available_from and si.available_until
    and lc.metadata->>'trial_open'='true'
    and v_now<(lc.metadata->>'trial_until')::timestamptz;

  return jsonb_build_object(
    'open',(v_access>0 or v_trial_access>0),
    'access_level',greatest(v_access,v_trial_access),
    'trial_open',(v_trial_access>0),
    'active_effect',v_effect,
    'items',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'item_id',ci.id,
          'item_uid',ci.item_uid,
          'name',ci.name,
          'description',ci.description,
          'resource_url',ci.resource_url,
          'category',ci.category,
          'luxury_group',lc.luxury_group,
          'required_effect_level',lc.required_effect_level,
          'presentation_kind',lc.presentation_kind,
          'owned',exists(
            select 1 from public.student_cosmetic_ownerships sco
            where sco.student_id=v_student.id and sco.item_id=ci.id
          ),
          'pricing',coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'pricing_id',cp.id,
                'value_token',cp.value_token,
                'price',cp.price,
                'condition_description',cp.condition_description
              )
              order by cp.id
            )
            from public.cosmetic_item_pricings cp
            where cp.item_id=ci.id and cp.is_active=true
          ),'[]'::jsonb)
        )
        order by lc.required_effect_level,ci.name,ci.id
      )
      from public.expedition_luxury_catalog lc
      join public.cosmetic_items ci
        on ci.id=lc.cosmetic_item_id
       and ci.is_active=true
       and (ci.classroom_id is null or ci.classroom_id=v_student.classroom_id)
      join public.seasonal_items si
        on si.item_id=ci.id
       and si.is_active=true
       and v_now>=si.available_from
       and v_now<=si.available_until
      where lc.is_active=true
        and (lc.required_effect_level<=v_access or (
          lc.metadata->>'trial_open'='true'
          and v_now<(lc.metadata->>'trial_until')::timestamptz
        ))
    ),'[]'::jsonb),
    'assets_pending',not exists(
      select 1 from public.expedition_luxury_catalog where is_active=true
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.student_purchase_cosmetic(p_item_id integer, p_pricing_id integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_item public.cosmetic_items%rowtype;
  v_luxury public.expedition_luxury_catalog%rowtype;
  v_access integer;
  v_now timestamptz:=clock_timestamp();
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode='PFC01';
  end if;

  v_student_id:=public.current_student_id();
  if v_student_id is null then
    raise exception '학생 계정을 확인할 수 없습니다.' using errcode='PFC02';
  end if;

  select s.classroom_id into v_classroom_id
  from public.students s
  where s.id=v_student_id
    and s.user_id=auth.uid()
    and s.transferred_at is null;

  if v_classroom_id is null then
    raise exception '현재 재학 중인 학생 계정을 확인할 수 없습니다.' using errcode='PFC05';
  end if;

  select * into v_item
  from public.cosmetic_items ci
  where ci.id=p_item_id and ci.is_active=true;

  if v_item.id is null then
    raise exception '활성 꾸미기 아이템이 아닙니다.' using errcode='PFC03';
  end if;

  if v_item.classroom_id is not null and v_item.classroom_id<>v_classroom_id then
    raise exception '다른 학급 아이템은 구매할 수 없습니다.' using errcode='PFC04';
  end if;

  select * into v_luxury
  from public.expedition_luxury_catalog
  where cosmetic_item_id=p_item_id and is_active=true;

  if found then
    v_access:=public._expedition_current_cosmetic_access_level(v_classroom_id,v_now);

    if v_access<v_luxury.required_effect_level
       and not (
         v_luxury.metadata->>'trial_open'='true'
         and v_now<(v_luxury.metadata->>'trial_until')::timestamptz
       ) then
      raise exception '현재 명품관에서 구매할 수 없는 상품입니다.'
        using errcode='P0EB6';
    end if;

    if not exists(
      select 1 from public.seasonal_items si
      where si.item_id=p_item_id
        and si.is_active=true
        and v_now>=si.available_from
        and v_now<=si.available_until
    ) then
      raise exception '현재 명품관 판매 기간이 아닙니다.'
        using errcode='P0EB7';
    end if;
  end if;

  return public.purchase_cosmetic_item(v_student_id,p_item_id,p_pricing_id);
end;
$function$
;

commit;
