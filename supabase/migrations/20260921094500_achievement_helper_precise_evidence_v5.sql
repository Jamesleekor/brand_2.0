begin;

create or replace function public._achievement_helper_generic_evidence_v5(p_student_id integer,p_achievement_uid text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid text:=upper(btrim(coalesce(p_achievement_uid,'')));
  v_profile record;
begin
  select * into v_profile from public.achievement_helper_verification_profiles p where p.achievement_uid=v_uid;
  return jsonb_build_object(
    'available',true,'source','HELPER_V5_PROFILE','metric_code',v_uid,'result','REVIEW',
    'verification_mode',coalesce(v_profile.verification_mode,'TEACHER_JUDGMENT'),
    'record_sections',coalesce(to_jsonb(v_profile.record_sections),'[]'::jsonb),
    'note',coalesce(v_profile.helper_note,'제출 설명과 공개 가능한 시스템 기록을 대조한 뒤 선생님에게 판단 근거를 남겨주세요.')
  );
end;
$$;
revoke all on function public._achievement_helper_generic_evidence_v5(integer,text) from public,anon,authenticated;
grant execute on function public._achievement_helper_generic_evidence_v5(integer,text) to service_role;

create or replace function public._achievement_helper_shard_evidence_v5(p_student_id integer,p_achievement_uid text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid text:=upper(btrim(coalesce(p_achievement_uid,'')));
  v_classroom_id integer;
  v_count bigint:=0;
  v_count2 bigint:=0;
  v_max bigint:=0;
  v_min bigint:=0;
begin
  select s.classroom_id into v_classroom_id from public.students s where s.id=p_student_id and s.transferred_at is null;
  if v_classroom_id is null then return jsonb_build_object('available',false,'error','학생 컨텍스트를 확인할 수 없습니다.'); end if;

  if v_uid in ('SHARD-001','SHARD-002','SHARD-003','SHARD-004') then
    select count(*) into v_count from public.student_characters sc where sc.student_id=p_student_id and sc.is_owned=true and sc.revoked_at is null;
    v_min:=case v_uid when 'SHARD-001' then 20 when 'SHARD-002' then 45 when 'SHARD-003' then 60 else 70 end;
    return jsonb_build_object('available',true,'source','HELPER_V5_SHARD','metric_code',v_uid,'measured_value',v_count,'target_value',v_min,'op','>=','result',case when v_count>=v_min then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('SHARDS'),'note','현재 보유 중인 서로 다른 편린 수입니다.');
  end if;

  if v_uid in ('SHARD-005','SHARD-006','SHARD-007') then
    with completed as (
      select cc.id from public.character_collections cc
      where cc.classroom_id=v_classroom_id and cc.is_active=true
        and exists (select 1 from public.character_collection_members cm where cm.collection_id=cc.id and cm.is_active=true)
        and not exists (
          select 1 from public.character_collection_members x
          where x.collection_id=cc.id and x.is_active=true
            and not exists (select 1 from public.student_characters sc where sc.student_id=p_student_id and sc.character_id=x.character_id and sc.is_owned=true and sc.revoked_at is null)
        )
    ) select count(*) into v_count from completed;
    v_min:=case v_uid when 'SHARD-005' then 10 when 'SHARD-006' then 20 else 30 end;
    return jsonb_build_object('available',true,'source','HELPER_V5_SHARD','metric_code',v_uid,'measured_value',v_count,'target_value',v_min,'op','>=','result',case when v_count>=v_min then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','완성 컬렉션 수','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('SHARDS'),'note','편린 보유와 컬렉션 구성만으로 계산합니다.');
  end if;

  if v_uid='SHARD-008' then
    with completed as (
      select cc.id,array_agg(cm.character_id order by cm.character_id) members
      from public.character_collections cc join public.character_collection_members cm on cm.collection_id=cc.id and cm.is_active=true
      where cc.classroom_id=v_classroom_id and cc.is_active=true
        and not exists (
          select 1 from public.character_collection_members x where x.collection_id=cc.id and x.is_active=true
            and not exists (select 1 from public.student_characters sc where sc.student_id=p_student_id and sc.character_id=x.character_id and sc.is_owned=true and sc.revoked_at is null)
        ) group by cc.id
    ) select coalesce(max(cnt),0) into v_max from (select member,count(*) cnt from completed c cross join lateral unnest(c.members) member group by member) q;
    return jsonb_build_object('available',true,'source','HELPER_V5_SHARD','metric_code',v_uid,'measured_value',v_max,'target_value',3,'op','>=','result',case when v_max>=3 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','한 편린이 포함된 완성 컬렉션 최대 수','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('SHARDS'),'note','동일 편린을 공유하는 완성 컬렉션의 최대 개수를 계산합니다.');
  end if;

  if v_uid='SHARD-009' then
    with completed as (
      select cc.id,array_agg(cm.character_id order by cm.character_id) members
      from public.character_collections cc join public.character_collection_members cm on cm.collection_id=cc.id and cm.is_active=true
      where cc.classroom_id=v_classroom_id and cc.is_active=true
        and not exists (
          select 1 from public.character_collection_members x where x.collection_id=cc.id and x.is_active=true
            and not exists (select 1 from public.student_characters sc where sc.student_id=p_student_id and sc.character_id=x.character_id and sc.is_owned=true and sc.revoked_at is null)
        ) group by cc.id
    ) select count(*) into v_count2 from completed a join completed b on a.id<b.id and not(a.members&&b.members) join completed c on b.id<c.id and not(a.members&&c.members) and not(b.members&&c.members);
    return jsonb_build_object('available',true,'source','HELPER_V5_SHARD','metric_code',v_uid,'measured_value',v_count2,'target_value',1,'op','>=','result',case when v_count2>=1 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','서로 겹치지 않는 3컬렉션 조합 수','value',v_count2)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('SHARDS'),'note','구성 편린이 하나도 겹치지 않는 완성 컬렉션 3종 조합을 찾습니다.');
  end if;

  if v_uid='SHARD-010' then
    with completed as (
      select cc.id,cc.name from public.character_collections cc
      where cc.classroom_id=v_classroom_id and cc.is_active=true
        and exists (select 1 from public.character_collection_members cm where cm.collection_id=cc.id and cm.is_active=true)
        and not exists (
          select 1 from public.character_collection_members x where x.collection_id=cc.id and x.is_active=true
            and not exists (select 1 from public.student_characters sc where sc.student_id=p_student_id and sc.character_id=x.character_id and sc.is_owned=true and sc.revoked_at is null)
        )
    ) select count(*) into v_count2 from completed where name in ('별이 맺은 네 사람','눈이 녹은 뒤의 봄');
    return jsonb_build_object('available',true,'source','HELPER_V5_SHARD','metric_code',v_uid,'measured_value',v_count2,'target_value',2,'op','=','result',case when v_count2=2 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','지정 컬렉션 완성 수','value',v_count2)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('SHARDS'),'note','「별이 맺은 네 사람」과 「눈이 녹은 뒤의 봄」의 동시 완성을 확인합니다.');
  end if;
  return public._achievement_helper_generic_evidence_v5(p_student_id,v_uid);
end;
$$;
revoke all on function public._achievement_helper_shard_evidence_v5(integer,text) from public,anon,authenticated;
grant execute on function public._achievement_helper_shard_evidence_v5(integer,text) to service_role;

create or replace function public._achievement_helper_arcade_evidence_v5(p_student_id integer,p_achievement_uid text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid text:=upper(btrim(coalesce(p_achievement_uid,'')));
  v_count bigint:=0;
  v_max bigint:=0;
  v_target bigint:=1;
begin
  if v_uid='ARC-001' then
    select count(*) into v_count from public.arcade_runs r where r.student_id=p_student_id and coalesce(r.is_prerelease_test,false)=false and r.official_score is not null;
    return jsonb_build_object('available',true,'source','HELPER_V5_ARCADE','metric_code',v_uid,'measured_value',v_count,'target_value',10,'op','>=','result',case when v_count>=10 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ARCADE'),'note','공식 점수가 확정된 비사전테스트 아케이드 플레이 수를 누적합니다.');
  end if;

  if v_uid in ('ARC-002','ARC-005','ARC-006') then
    select count(*) into v_count from public.arcade_monthly_snapshot_student_ranks sr join public.arcade_monthly_snapshots ms on ms.id=sr.snapshot_id
    where sr.student_id=p_student_id and ((v_uid='ARC-002' and sr.rank<=10) or (v_uid='ARC-005' and sr.rank=2) or (v_uid='ARC-006' and sr.rank=1));
    return jsonb_build_object('available',true,'source','HELPER_V5_ARCADE','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','조건을 만족한 월간 최종 기록 수','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ARCADE'),'note','FINALIZED 월간 스냅샷의 학생 최종 순위를 기준으로 확인합니다.');
  end if;

  if v_uid='ARC-003' then
    select count(distinct vs.id) into v_count from public.arcade_verification_sessions vs join public.arcade_verification_attempts va on va.session_id=vs.id
    where vs.student_id=p_student_id and va.opportunity_number=1 and coalesce(va.valid_run,false)=true and va.official_score is not null and va.official_score>=vs.verification_threshold;
    return jsonb_build_object('available',true,'source','HELPER_V5_ARCADE','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ARCADE'),'note','기록 인증 세션의 1차 기회에서 공식 점수가 해당 세션의 인증 기준점 이상이었는지 확인합니다.');
  end if;

  if v_uid='ARC-004' then
    select coalesce(max(game_count),0) into v_max from (
      select date_trunc('month',r.game_over_at at time zone 'Asia/Seoul') month_start,count(distinct r.game_id) game_count
      from public.arcade_runs r where r.student_id=p_student_id and coalesce(r.is_prerelease_test,false)=false and r.official_score is not null and r.game_over_at is not null group by 1
    ) q;
    return jsonb_build_object('available',true,'source','HELPER_V5_ARCADE','metric_code',v_uid,'measured_value',v_max,'target_value',6,'op','>=','result',case when v_max>=6 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','한 달 내 플레이한 서로 다른 게임 최대 수','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ARCADE'),'note','같은 KST 달 안에서 공식 기록이 남은 서로 다른 아케이드 게임 수를 계산합니다.');
  end if;

  if v_uid in ('ARC-007','ARC-011') then
    with ranked as (
      select ms.game_id,to_date(ms.contribution_year_month||'-01','YYYY-MM-DD') month_start,sr.rank
      from public.arcade_monthly_snapshot_student_ranks sr join public.arcade_monthly_snapshots ms on ms.id=sr.snapshot_id
      where sr.student_id=p_student_id and ((v_uid='ARC-007' and sr.rank<=10) or (v_uid='ARC-011' and sr.rank=1))
    ) select count(*) into v_count from ranked a join ranked b on b.game_id=a.game_id and b.month_start=(a.month_start+interval '1 month')::date;
    return jsonb_build_object('available',true,'source','HELPER_V5_ARCADE','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','같은 게임 연속 2개월 조건 조합 수','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ARCADE'),'note',case when v_uid='ARC-007' then '같은 게임에서 연속된 두 달 모두 월간 최종 TOP10인지 확인합니다.' else '같은 게임에서 연속된 두 달 모두 월간 최종 1위인지 확인합니다.' end);
  end if;

  if v_uid='ARC-008' then
    select count(*) into v_count from public.arcade_runs r where r.student_id=p_student_id and r.official_score is not null and coalesce(r.is_prerelease_test,false)=false;
    return jsonb_build_object('available',true,'source','HELPER_V5_ARCADE','metric_code',v_uid,'result','REVIEW','details',jsonb_build_array(jsonb_build_object('label','확인 가능한 공식 플레이 기록 수','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ARCADE'),'note','현재 DB에는 실시간 리더보드 1위 상태의 시작·종료 시각을 연속 보존하는 SSOT가 없어 24시간 연속 유지 여부를 자동 확정할 수 없습니다. ARCADE 기록과 당시 운영 기록을 함께 확인하세요.');
  end if;

  if v_uid in ('ARC-009','ARC-012','ARC-014','ARC-016') then
    select count(distinct ms.game_id) into v_count from public.arcade_monthly_snapshot_student_ranks sr join public.arcade_monthly_snapshots ms on ms.id=sr.snapshot_id
    where sr.student_id=p_student_id and ((v_uid='ARC-009' and sr.rank<=10) or (v_uid='ARC-012' and sr.rank=1) or (v_uid='ARC-014' and sr.rank<=3) or (v_uid='ARC-016' and sr.rank=1));
    v_target:=case v_uid when 'ARC-009' then 6 when 'ARC-012' then 3 when 'ARC-014' then 6 else 6 end;
    return jsonb_build_object('available',true,'source','HELPER_V5_ARCADE','metric_code',v_uid,'measured_value',v_count,'target_value',v_target,'op','>=','result',case when v_count>=v_target then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','조건을 달성한 서로 다른 게임 수','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ARCADE'),'note','FINALIZED 월간 최종 순위에서 조건을 한 번 이상 달성한 서로 다른 게임 수를 계산합니다.');
  end if;

  if v_uid='ARC-010' then
    select count(*) into v_count from public.arcade_verification_sessions vs join public.arcade_verification_attempts va on va.session_id=vs.id
    where vs.student_id=p_student_id and coalesce(va.valid_run,false)=true and va.official_score is not null and va.official_score>vs.provisional_score;
    return jsonb_build_object('available',true,'source','HELPER_V5_ARCADE','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ARCADE'),'note','인증 시작 당시 저장된 잠정 최고기록(provisional_score)을 인증 도전 공식 점수가 초과했는지 확인합니다.');
  end if;

  if v_uid='ARC-013' then
    with ranked as (
      select ms.game_id,to_date(ms.contribution_year_month||'-01','YYYY-MM-DD') month_start
      from public.arcade_monthly_snapshot_student_ranks sr join public.arcade_monthly_snapshots ms on ms.id=sr.snapshot_id
      where sr.student_id=p_student_id and sr.rank<=3
    ) select count(*) into v_count from ranked a join ranked b on b.game_id=a.game_id and b.month_start=(a.month_start+interval '1 month')::date join ranked c on c.game_id=a.game_id and c.month_start=(a.month_start+interval '2 month')::date;
    return jsonb_build_object('available',true,'source','HELPER_V5_ARCADE','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','같은 게임 연속 3개월 TOP3 조합 수','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ARCADE'),'note','같은 게임의 FINALIZED 월간 순위가 3개월 연속 TOP3였는지 확인합니다.');
  end if;

  if v_uid='ARC-015' then
    select coalesce(max(game_count),0) into v_max from (
      select ms.contribution_year_month,count(distinct ms.game_id) game_count from public.arcade_monthly_snapshot_student_ranks sr join public.arcade_monthly_snapshots ms on ms.id=sr.snapshot_id where sr.student_id=p_student_id and sr.rank<=3 group by ms.contribution_year_month
    ) q;
    return jsonb_build_object('available',true,'source','HELPER_V5_ARCADE','metric_code',v_uid,'measured_value',v_max,'target_value',6,'op','>=','result',case when v_max>=6 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','한 달에 TOP3를 달성한 서로 다른 게임 최대 수','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ARCADE'),'note','같은 월의 FINALIZED 스냅샷에서 6개 게임 모두 TOP3인지 확인합니다.');
  end if;

  if v_uid='ARC-017' then
    select count(distinct ms.game_id) into v_count from public.arcade_monthly_snapshot_student_ranks sr join public.arcade_monthly_snapshots ms on ms.id=sr.snapshot_id where sr.student_id=p_student_id;
    return jsonb_build_object('available',true,'source','HELPER_V5_ARCADE','metric_code',v_uid,'result','REVIEW','details',jsonb_build_array(jsonb_build_object('label','월간 최종 순위가 존재하는 서로 다른 게임 수','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ARCADE'),'note','“학기 종합 성적 전체 1위”의 공식 학기 종합 산식·최종 스냅샷이 별도 SSOT로 확정되어 있지 않아 월간 기록만으로 임의 계산하지 않습니다. 학기 종료 시 공식 종합 결과를 확인하세요.');
  end if;

  if v_uid='ARC-018' then
    with per_session as (
      select vs.id,
        bool_or(va.opportunity_number=1 and coalesce(va.valid_run,false)=true and coalesce(va.official_score,-9223372036854775808)<vs.verification_threshold) fail1,
        bool_or(va.opportunity_number=2 and coalesce(va.valid_run,false)=true and coalesce(va.official_score,-9223372036854775808)<vs.verification_threshold) fail2,
        bool_or(va.opportunity_number=3 and coalesce(va.valid_run,false)=true and coalesce(va.official_score,-9223372036854775808)>=vs.verification_threshold) pass3
      from public.arcade_verification_sessions vs left join public.arcade_verification_attempts va on va.session_id=vs.id where vs.student_id=p_student_id group by vs.id
    ) select count(*) into v_count from per_session where fail1 and fail2 and pass3;
    return jsonb_build_object('available',true,'source','HELPER_V5_ARCADE','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ARCADE'),'note','같은 기록 인증 세션에서 1·2차는 기준 미달, 3차는 기준 이상인 경우를 직접 확인합니다.');
  end if;
  return public._achievement_helper_generic_evidence_v5(p_student_id,v_uid);
end;
$$;
revoke all on function public._achievement_helper_arcade_evidence_v5(integer,text) from public,anon,authenticated;
grant execute on function public._achievement_helper_arcade_evidence_v5(integer,text) to service_role;

create or replace function public._achievement_helper_economy_evidence_v6(p_student_id integer,p_achievement_uid text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid text:=upper(btrim(coalesce(p_achievement_uid,'')));
  v_classroom_id integer;
  v_count bigint:=0; v_count2 bigint:=0; v_sum bigint:=0; v_sum2 bigint:=0; v_max bigint:=0; v_target bigint:=0;
  v_gold bigint:=0; v_deposit bigint:=0; v_installment bigint:=0; v_asset bigint:=0;
  v_latest_credit integer:=null; v_first_sale date:=null; v_last_purchase date:=null; v_max_gap integer:=0;
begin
  select s.classroom_id into v_classroom_id from public.students s where s.id=p_student_id and s.transferred_at is null;
  if v_classroom_id is null then return jsonb_build_object('available',false,'error','학생 컨텍스트를 확인할 수 없습니다.'); end if;

  if v_uid='ECO-001' or v_uid='ECO-008' or v_uid='ECO-012' then
    with spend as (
      select t.created_at at time zone 'Asia/Seoul' occurred_local,abs(t.amount)::bigint amount
      from public.transactions t
      where t.student_id=p_student_id and t.value_token='GOLD' and t.amount<0 and coalesce(t.is_reversed,false)=false
        and (t.source_type in ('P2P_SEND','COSMETIC_PURCHASE') or (t.source_type='OTHER' and (t.memo like '[시장구매]%' or t.memo like '[2차직업 서비스 에스크로]%' or t.memo like '[2차직업 서비스 견적 에스크로]%' or t.memo like '[경매%')))
      union all
      select l.purchased_at at time zone 'Asia/Seoul',l.price_gold::bigint from public.legacy_shop_purchase_history l where l.student_id=p_student_id
    )
    select coalesce(sum(amount) filter(where occurred_local>=((now() at time zone 'Asia/Seoul')-interval '30 days')),0)::bigint,
           coalesce(sum(amount) filter(where occurred_local>=((now() at time zone 'Asia/Seoul')-interval '7 days')),0)::bigint,
           coalesce(max(amount),0)::bigint
      into v_sum,v_sum2,v_max from spend;
    if v_uid='ECO-001' then
      return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_sum,'target_value',1000,'op','<','result',case when v_sum<1000 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','최근 30일 소비 합계','value',v_sum)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY','P2P'),'note','예금·환전·기부 같은 자금 이동은 소비에서 제외하고 상점/시장·서비스·P2P 등 소비성 GOLD 지출을 합산합니다.');
    elsif v_uid='ECO-008' then
      return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_sum2,'target_value',1000,'op','<=','result',case when v_sum2<=1000 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','최근 7일 소비 합계','value',v_sum2)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY','P2P'),'note','예금·환전·기부는 제외하고 소비성 GOLD 지출만 계산합니다.');
    else
      return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_max,'target_value',5000,'op','>=','result',case when v_max>=5000 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','단일 소비 거래 최대액','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY','P2P','AUCTION'),'note','예금 가입·환전 같은 단순 자금 이동을 제외한 단일 소비 거래 중 최대 지출액을 확인합니다.');
    end if;
  end if;

  if v_uid='ECO-002' then
    with rounds as (
      select a.id auction_id,max(ar.final_price) max_price,max(ar.final_price) filter(where ar.winner_student_id=p_student_id) my_max_price
      from public.auctions a join public.auction_items ai on ai.auction_id=a.id join public.auction_results ar on ar.auction_item_id=ai.id where a.classroom_id=v_classroom_id group by a.id
    ) select count(*),count(*) filter(where my_max_price=max_price) into v_count,v_count2 from rounds;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'result',case when v_count>0 and v_count=v_count2 then 'BORDERLINE' else 'REVIEW' end,'details',jsonb_build_array(jsonb_build_object('label','2.0에서 결과가 남은 경매 회차','value',v_count),jsonb_build_object('label','그중 최고가 낙찰자가 본인인 회차','value',v_count2),jsonb_build_object('label','Season 1 과거 경매 낙찰자','value','이관되지 않음')),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('AUCTION'),'note','2.0 경매는 회차별 최고 낙찰가와 낙찰자를 직접 대조합니다. Season 1 과거 경매에는 낙찰자 학생 ID가 없어 전체 기간은 교사 확인이 필요합니다.');
  end if;

  if v_uid='ECO-003' then
    select coalesce((select sum(greatest(coalesce(h.gold_delta,0),coalesce(h.bv_delta,0),0)) from public.legacy_asset_history h where h.student_id=p_student_id and h.memo ilike '%MVP%'),0)
      +coalesce((select sum(t.amount) from public.transactions t where t.student_id=p_student_id and t.amount>0 and coalesce(t.is_reversed,false)=false and t.value_token='GOLD' and t.memo ilike '%MVP%'),0) into v_sum;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_sum,'target_value',5000,'op','>=','result',case when v_sum>=5000 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY','ACHIEVEMENTS'),'note','Season 1 이관 원장의 MVP 표기 지급액과 2.0 MVP 표기 GOLD 지급액을 합산합니다.');
  end if;

  if v_uid='ECO-004' then
    select coalesce(sum(abs(t.amount)),0)::bigint into v_sum from public.transactions t where t.student_id=p_student_id and t.value_token='GOLD' and t.source_type='DONATION' and coalesce(t.is_reversed,false)=false;
    select v_sum+coalesce(sum(abs(h.gold_delta)),0)::bigint into v_sum from public.legacy_asset_history h where h.student_id=p_student_id and h.gold_delta<0 and (h.memo ilike '%기부%' or h.memo ilike '%복지기금%');
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_sum,'target_value',10000,'op','>=','result',case when v_sum>=10000 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','Season 1 이관 기부 기록과 2.0 DONATION 거래를 합산합니다.');
  end if;

  if v_uid='ECO-005' then
    select count(*) into v_count from public.wallets me join public.wallets other on other.bv=me.bv and other.student_id<>me.student_id join public.students s on s.id=other.student_id
    where me.student_id=p_student_id and s.classroom_id=v_classroom_id and s.role='STUDENT' and s.transferred_at is null and coalesce(s.is_test_account,false)=false;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','=','result',case when v_count=1 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','현재 BV가 정확히 같은 다른 학생 수','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('OVERVIEW'),'note','현재 시점에 본인과 BV가 정확히 같은 활성 학생이 단 1명인지 확인합니다.');
  end if;

  if v_uid='ECO-006' then
    with class_sales as (
      select min(d)::date first_sale from (
        select (ie.created_at at time zone 'Asia/Seoul')::date d from public.inventory_events ie join public.market_items mi on mi.id=ie.item_id where ie.classroom_id=v_classroom_id and ie.event_type='PURCHASE' and mi.item_type='SNACK'
        union all select l.purchased_at::date from public.legacy_shop_purchase_history l where l.classroom_id=v_classroom_id
      ) x
    ), my_purchases as (
      select d from (
        select (ie.created_at at time zone 'Asia/Seoul')::date d from public.inventory_events ie join public.market_items mi on mi.id=ie.item_id where ie.student_id=p_student_id and ie.event_type='PURCHASE' and mi.item_type='SNACK'
        union all select l.purchased_at::date from public.legacy_shop_purchase_history l where l.student_id=p_student_id
      ) x group by d order by d
    ), gaps as (select d,lag(d) over(order by d) prev_d from my_purchases)
    select (select first_sale from class_sales),(select max(d) from my_purchases),coalesce((select max(d-prev_d) from gaps where prev_d is not null),0) into v_first_sale,v_last_purchase,v_max_gap;
    if v_first_sale is not null then v_max_gap:=greatest(v_max_gap,case when v_last_purchase is null then current_date-v_first_sale else current_date-v_last_purchase end); end if;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_max_gap,'target_value',14,'op','>=','result',case when v_first_sale is not null and v_max_gap>=14 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','학급 간식 판매 확인 시작일','value',v_first_sale),jsonb_build_object('label','본인 마지막 간식 구매일','value',v_last_purchase),jsonb_build_object('label','확인 가능한 최장 무구매 간격(일)','value',v_max_gap)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','학급 간식 판매 기록이 시작된 이후 본인의 간식 구매 기록 사이 또는 마지막 구매 이후 14일 이상 공백이 있었는지 확인합니다.');
  end if;

  if v_uid='ECO-007' then
    select count(*) into v_count from public.auction_results ar join public.auction_items ai on ai.id=ar.auction_item_id join public.auctions a on a.id=ai.auction_id where ar.winner_student_id=p_student_id and a.classroom_id=v_classroom_id and ar.final_price=ai.starting_price;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('AUCTION'),'note','2.0 경매에서 최종 낙찰가가 해당 상품 시작 입찰가와 같은 낙찰 기록을 확인합니다.');
  end if;

  if v_uid='ECO-009' then
    with gains as (
      select (t.created_at at time zone 'Asia/Seoul')::date d,t.source_type::text route from public.transactions t where t.student_id=p_student_id and t.amount>0 and coalesce(t.is_reversed,false)=false
      union all
      select h.event_date,case when h.memo ilike '%MVP%' then 'MVP' when h.memo ilike '%기부%' then 'DONATION_REWARD' when h.memo ilike '%업적%' then 'ACHIEVEMENT' when h.memo ilike '%퀘스트%' or h.memo ilike '%일퀘%' then 'DAILY_QUEST' when h.memo ilike '%보너스%' then 'BONUS' else 'LEGACY_OTHER' end from public.legacy_asset_history h where h.student_id=p_student_id and (coalesce(h.gold_delta,0)>0 or coalesce(h.bv_delta,0)>0)
    ), daily as (select d,count(distinct route) routes from gains group by d)
    select coalesce(max(routes),0) into v_max from daily;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_max,'target_value',3,'op','>=','result',case when v_max>=3 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','하루에 획득한 서로 다른 경로 최대 수','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','같은 날짜의 서로 다른 수입 경로 수를 계산합니다.');
  end if;

  if v_uid='ECO-010' then
    select cs.total_score into v_latest_credit from public.credit_scores cs where cs.student_id=p_student_id order by cs.as_of_date desc,cs.calculated_at desc,cs.id desc limit 1;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_latest_credit,'target_value',900,'op','>=','result',case when coalesce(v_latest_credit,0)>=900 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','가장 최근 신용점수 기록을 사용합니다.');
  end if;

  if v_uid='ECO-011' then
    with donations as (
      select (t.created_at at time zone 'Asia/Seoul')::date d,abs(t.amount)::bigint amount from public.transactions t where t.student_id=p_student_id and t.value_token='GOLD' and t.source_type='DONATION' and coalesce(t.is_reversed,false)=false
      union all select h.event_date,abs(h.gold_delta)::bigint from public.legacy_asset_history h where h.student_id=p_student_id and h.gold_delta<0 and (h.memo ilike '%기부%' or h.memo ilike '%복지기금%')
    ) select coalesce(max(day_sum),0) into v_max from (select d,sum(amount) day_sum from donations group by d) q;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_max,'target_value',3000,'op','>=','result',case when v_max>=3000 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','Season 1과 2.0의 기부 기록을 날짜별로 합산해 하루 최고 기부액을 계산합니다.');
  end if;

  if v_uid in ('ECO-013','ECO-014','ECO-015') then
    with interest_rows as (
      select d.interest_paid::bigint interest_paid from public.student_deposits d where d.student_id=p_student_id and d.status='MATURED'
      union all select si.interest_paid::bigint from public.student_installment_savings si where si.student_id=p_student_id and si.status::text='MATURED'
    ) select count(*) filter(where interest_paid>0),coalesce(sum(interest_paid),0),coalesce(max(interest_paid),0) into v_count,v_sum,v_max from interest_rows;
    v_target:=case when v_uid='ECO-013' then 1 when v_uid='ECO-014' then 2000 else 5000 end;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',case when v_uid='ECO-013' then v_count when v_uid='ECO-014' then v_sum else v_max end,'target_value',v_target,'op','>=','result',case when (v_uid='ECO-013' and v_count>=1) or (v_uid='ECO-014' and v_sum>=2000) or (v_uid='ECO-015' and v_max>=5000) then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','이자 발생 만기 저축 수','value',v_count),jsonb_build_object('label','누적 이자','value',v_sum),jsonb_build_object('label','단일 저축 최대 이자','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','정기예금과 적금의 실제 만기 이자 지급 기록을 함께 계산합니다.');
  end if;

  if v_uid in ('ECO-016','ECO-017') then
    select coalesce(max(win_count),0) into v_max from (
      select a.id,count(*) win_count from public.auction_results ar join public.auction_items ai on ai.id=ar.auction_item_id join public.auctions a on a.id=ai.auction_id where ar.winner_student_id=p_student_id and a.classroom_id=v_classroom_id group by a.id
    ) q;
    v_target:=case when v_uid='ECO-016' then 5 else 15 end;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_max,'target_value',v_target,'op','>=','result',case when v_max>=v_target then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','한 경매 회차 최다 낙찰 수','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('AUCTION'),'note','2.0 경매 회차별 낙찰 결과에서 본인의 최대 낙찰 건수를 계산합니다.');
  end if;

  if v_uid='ECO-018' then
    select count(*) into v_count from public.guard_terms g where g.student_id=p_student_id and g.classroom_id=v_classroom_id;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','경제수호대 임기 배정 이력이 있는지 확인합니다.');
  end if;

  if v_uid='ECO-020' then
    select coalesce(max(cnt),0) into v_max from (select o.seller_student_id,count(*) cnt from public.secondary_job_service_orders o where o.buyer_student_id=p_student_id and o.status='COMPLETED' group by o.seller_student_id) q;
    return jsonb_build_object('available',true,'source','HELPER_V6_PRIVATE_PARTIAL','metric_code',v_uid,'measured_value',v_max,'target_value',3,'op','>=','result',case when v_max>=3 then 'BORDERLINE' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','같은 판매자에게 완료 구매한 최대 횟수','value',v_max),jsonb_build_object('label','평점 조건','value','도우미 비공개 · 교사 확인')),'verification_mode','PARTIAL_PRIVATE','record_sections',jsonb_build_array('P2P'),'note','구매 횟수만 자동 확인합니다. 구매자가 남긴 평점과 리뷰 값은 업적도우미에게 반환하지 않습니다.');
  end if;

  if v_uid='ECO-021' then
    select (select count(*) from public.p2p_transfers p where (p.sender_id=p_student_id or p.receiver_id=p_student_id) and p.status::text='NORMAL')+(select count(*) from public.secondary_job_service_orders o where (o.buyer_student_id=p_student_id or o.seller_student_id=p_student_id) and o.status='COMPLETED') into v_count;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('P2P'),'note','정상 P2P 송금 또는 완료된 2차직업 서비스 거래가 1건 이상인지 확인합니다.');
  end if;

  if v_uid='ECO-022' then
    select count(*) into v_count from public.p2p_transfers p where (p.sender_id=p_student_id or p.receiver_id=p_student_id) and p.amount>=200 and p.status::text='NORMAL';
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_count,'target_value',5,'op','>=','result',case when v_count>=5 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('P2P'),'note','정상 P2P 원거래 중 거래액 200 GOLD 이상인 건수를 확인합니다.');
  end if;

  if v_uid in ('ECO-023','ECO-027') then
    with outcomes as (
      select a.id auction_id,ar.confirmed_at,ar.id,case when ar.winner_student_id=p_student_id then 1 else 0 end is_win from public.auction_results ar join public.auction_items ai on ai.id=ar.auction_item_id join public.auctions a on a.id=ai.auction_id where a.classroom_id=v_classroom_id
    ), marked as (select *,sum(case when is_win=0 then 1 else 0 end) over(partition by auction_id order by confirmed_at,id) grp from outcomes), streaks as (select auction_id,grp,count(*) streak from marked where is_win=1 group by auction_id,grp)
    select coalesce(max(streak),0) into v_max from streaks;
    v_target:=case when v_uid='ECO-023' then 3 else 5 end;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_max,'target_value',v_target,'op','>=','result',case when v_max>=v_target then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','2.0 경매 최장 연속 낙찰','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('AUCTION'),'note','같은 경매 회차의 확정 낙찰 결과 순서에서 다른 학생의 낙찰 없이 이어진 본인 낙찰 최장 길이를 계산합니다.');
  end if;

  if v_uid in ('ECO-024','ECO-029','ECO-030') then
    select coalesce(w.gold,0) into v_gold from public.wallets w where w.student_id=p_student_id;
    select coalesce(sum(d.principal),0) into v_deposit from public.student_deposits d where d.student_id=p_student_id and d.status='ACTIVE';
    select coalesce(sum(si.actual_principal),0) into v_installment from public.student_installment_savings si where si.student_id=p_student_id and si.status::text='ACTIVE';
    select count(*) into v_count from public.loans l where l.student_id=p_student_id;
    v_asset:=v_gold+v_deposit+v_installment; v_target:=case v_uid when 'ECO-024' then 30000 when 'ECO-029' then 45000 else 80000 end;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_asset,'target_value',v_target,'op','>=','result',case when v_asset>=v_target and v_count=0 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','현재 자산','value',v_asset),jsonb_build_object('label','전체 대출 이용 이력 건수','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('OVERVIEW','ECONOMY'),'note','“대출 없이”를 대출 이용 이력 0건으로 엄격하게 확인합니다.');
  end if;

  if v_uid='ECO-025' then
    select count(*) into v_count from public.auction_results ar join public.auction_items ai on ai.id=ar.auction_item_id join public.auctions a on a.id=ai.auction_id
    where ar.winner_student_id=p_student_id and a.classroom_id=v_classroom_id and ar.attempt_number=ai.current_attempt and (select count(*) from public.auction_bids b where b.auction_item_id=ai.id and b.attempt_number=ar.attempt_number and b.invalidated_at is null)=1;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('AUCTION'),'note','상품의 최종 시도에서 유효 입찰자가 본인 1명뿐이었던 낙찰 기록을 확인합니다.');
  end if;

  if v_uid='ECO-026' then
    with purchases as (
      select (ie.created_at at time zone 'Asia/Seoul')::date d,coalesce(ie.total_gold,0)::bigint spend from public.inventory_events ie where ie.student_id=p_student_id and ie.event_type='PURCHASE'
      union all select l.purchased_at::date,l.price_gold::bigint from public.legacy_shop_purchase_history l where l.student_id=p_student_id
    ), weeks as (
      select date_trunc('week',d)::date week_start,count(distinct extract(isodow from d)) filter(where extract(isodow from d) between 1 and 5) weekday_count,sum(spend) filter(where extract(isodow from d) between 1 and 5) total_spend from purchases group by 1
    ) select count(*) into v_count from weeks where weekday_count=5 and total_spend<=1000;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','같은 ISO 주의 월~금 5일 모두 구매 기록이 있고 그 5일 총 구매액이 1000 GOLD 이하인 주가 있는지 확인합니다.');
  end if;

  if v_uid='ECO-031' then
    select count(*) into v_count from public.secondary_job_service_orders o where o.seller_student_id=p_student_id and o.status='COMPLETED';
    return jsonb_build_object('available',true,'source','HELPER_V6_PRIVATE_PARTIAL','metric_code',v_uid,'measured_value',v_count,'target_value',10,'op','>=','result',case when v_count>=10 then 'BORDERLINE' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','완료 판매 건수','value',v_count),jsonb_build_object('label','평균 평점 9.5 조건','value','도우미 비공개 · 교사 확인')),'verification_mode','PARTIAL_PRIVATE','record_sections',jsonb_build_array('P2P'),'note','판매 건수만 자동 확인합니다. 서비스 평점·리뷰 값은 의도적으로 읽지도 반환하지도 않습니다.');
  end if;

  if v_uid='ECO-032' then
    select coalesce((select sum(l.price_gold) from public.legacy_shop_purchase_history l where l.student_id=p_student_id),0)+coalesce((select sum(ie.total_gold) from public.inventory_events ie where ie.student_id=p_student_id and ie.event_type='PURCHASE'),0) into v_sum;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_sum,'target_value',10000,'op','>=','result',case when v_sum>=10000 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','Season 1 상점 구매 이관 기록과 2.0 물품시장 PURCHASE의 실제 구매 GOLD를 합산합니다.');
  end if;

  if v_uid='ECO-033' then
    select coalesce((select sum(coalesce(t.tax_amount,0)) from public.transactions t where t.student_id=p_student_id and coalesce(t.is_reversed,false)=false),0)+coalesce((select sum((substring(h.memo from '세금[ $]*([0-9]+)'))::bigint) from public.legacy_asset_history h where h.student_id=p_student_id and h.memo ~ '세금[ $]*[0-9]+'),0) into v_sum;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_sum,'target_value',5000,'op','>=','result',case when v_sum>=5000 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','2.0 tax_amount와 Season 1 이관 메모의 세금 숫자를 합산합니다.');
  end if;

  if v_uid='ECO-034' then
    with activity_months as (
      select distinct date_trunc('month',d)::date month_start from (
        select (ie.created_at at time zone 'Asia/Seoul')::date d from public.inventory_events ie where ie.classroom_id=v_classroom_id and ie.event_type='PURCHASE'
        union all select l.purchased_at::date from public.legacy_shop_purchase_history l where l.classroom_id=v_classroom_id
      ) x where date_trunc('month',d)::date<date_trunc('month',current_date)::date
    ), my_use as (
      select date_trunc('month',d)::date month_start,count(*) n from (
        select (ie.created_at at time zone 'Asia/Seoul')::date d from public.inventory_events ie where ie.student_id=p_student_id and ie.event_type='PURCHASE'
        union all select l.purchased_at::date from public.legacy_shop_purchase_history l where l.student_id=p_student_id
      ) x group by 1
    ) select count(*) into v_count from activity_months a left join my_use m using(month_start) where coalesce(m.n,0)=0;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','학급 시장은 운영됐지만 본인이 구매 0건인 완료 월 수','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','Season 1과 2.0 구매 기록을 합쳐 학급에서 실제 구매 활동이 있었던 완료 월 중 본인 구매가 0건인 달을 찾습니다.');
  end if;

  if v_uid in ('ECO-036','ECO-037') then
    with completed as (
      select date_trunc('month',coalesce(o.completed_at,o.updated_at) at time zone 'Asia/Seoul')::date month_start,case when v_uid='ECO-036' then o.seller_student_id else o.buyer_student_id end student_id,
        sum(case when o.unit_price_gold_snapshot is not null then o.unit_price_gold_snapshot*greatest(coalesce(o.requested_quantity,o.quantity,1),1) else coalesce(o.price_gold_snapshot,0) end)::bigint total_gold
      from public.secondary_job_service_orders o where o.classroom_id=v_classroom_id and o.status='COMPLETED' group by 1,2
    ), ranked as (select *,dense_rank() over(partition by month_start order by total_gold desc) rnk from completed)
    select count(*),coalesce(max(total_gold),0) into v_count,v_max from ranked where student_id=p_student_id and rnk=1 and total_gold>=1000;
    return jsonb_build_object('available',true,'source','HELPER_V6_ECONOMY','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label',case when v_uid='ECO-036' then '월간 판매금액 1위 달성 월 수' else '월간 구매금액 1위 달성 월 수' end,'value',v_count),jsonb_build_object('label','그중 최고 월 누적금액','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('P2P'),'note','완료된 2차직업 서비스 주문의 월별 실제 거래금액을 합산하고 동률 포함 1위를 판정합니다. 최소 1000 GOLD 조건도 함께 적용합니다.');
  end if;

  return public._achievement_helper_generic_evidence_v5(p_student_id,v_uid);
end;
$$;
revoke all on function public._achievement_helper_economy_evidence_v6(integer,text) from public,anon,authenticated;
grant execute on function public._achievement_helper_economy_evidence_v6(integer,text) to service_role;

create or replace function public._achievement_helper_life_evidence_v6(p_student_id integer,p_achievement_uid text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid text:=upper(btrim(coalesce(p_achievement_uid,'')));
  v_count bigint:=0; v_count2 bigint:=0; v_max bigint:=0; v_target bigint:=1;
begin
  if v_uid='LIFE-002' then
    with per_day as (
      select r.quest_date,count(*) filter(where q.result='PASS') pass_count,count(*) total_count
      from public.daily_quest_checks q join public.daily_quest_reports r on r.id=q.report_id where q.student_id=p_student_id group by r.quest_date
    ), weeks as (
      select date_trunc('week',quest_date)::date week_start,count(*) filter(where pass_count=4 and total_count=4 and extract(isodow from quest_date) between 1 and 5) perfect_days from per_day group by 1
    ) select coalesce(max(perfect_days),0) into v_max from weeks;
    return jsonb_build_object('available',true,'source','HELPER_V6_LIFE','metric_code',v_uid,'measured_value',v_max,'target_value',5,'op','>=','result',case when v_max>=5 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','한 주의 완벽 일일퀘스트 최대 일수','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('DAILY'),'note','같은 ISO 주의 월~금 중 출석·1인1역·청소·학습준비물 4종이 모두 PASS인 날을 계산합니다.');
  end if;

  if v_uid='LIFE-005' then
    with ordered as (
      select a.attendance_date,a.status::text status,sum(case when a.status::text='PRESENT' then 0 else 1 end) over(order by a.attendance_date,a.id) grp from public.attendances a where a.student_id=p_student_id
    ), streaks as (select grp,count(*) streak from ordered where status='PRESENT' group by grp)
    select coalesce(max(streak),0) into v_max from streaks;
    return jsonb_build_object('available',true,'source','HELPER_V6_LIFE','metric_code',v_uid,'measured_value',v_max,'target_value',100,'op','>=','result',case when v_max>=100 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','연속 PRESENT 최장 학교일 수','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('DAILY'),'note','출결 기록이 존재하는 학교일 순서에서 PRESENT가 끊기지 않은 최장 연속 길이를 계산합니다.');
  end if;

  if v_uid='LIFE-006' then
    with months as (
      select distinct date_trunc('month',a.attendance_date)::date month_start from public.attendances a where a.student_id=p_student_id and date_trunc('month',a.attendance_date)::date<date_trunc('month',current_date)::date
    ), penalties as (
      select date_trunc('month',(t.created_at at time zone 'Asia/Seoul')::date)::date month_start,count(*) n from public.transactions t where t.student_id=p_student_id and t.value_token='BV' and t.amount<0 and coalesce(t.is_reversed,false)=false group by 1
      union all select date_trunc('month',h.event_date)::date,count(*) from public.legacy_asset_history h where h.student_id=p_student_id and coalesce(h.bv_delta,0)<0 group by 1
    ), summed as (select m.month_start,coalesce(sum(p.n),0) penalty_count from months m left join penalties p using(month_start) group by m.month_start)
    select count(*) into v_count from summed where penalty_count=0;
    return jsonb_build_object('available',true,'source','HELPER_V6_LIFE','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','벌점 0건으로 끝난 완료 월 수','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('DAILY','ECONOMY'),'note','완료된 달만 대상으로 Season 1 BV 차감 원장과 2.0 음수 BV 거래를 벌점 기록으로 합산합니다.');
  end if;

  if v_uid='LIFE-007' then
    with gains as (
      select t.student_id,date_trunc('month',(t.created_at at time zone 'Asia/Seoul')::date)::date month_start,sum(case when t.amount>0 then t.amount else 0 end)::bigint gain
      from public.transactions t where t.classroom_id=(select classroom_id from public.students where id=p_student_id) and t.value_token='BV' and coalesce(t.is_reversed,false)=false group by 1,2
    ), legacy as (
      select h.student_id,date_trunc('month',h.event_date)::date month_start,sum(greatest(coalesce(h.bv_delta,0),0))::bigint gain from public.legacy_asset_history h where h.classroom_id=(select classroom_id from public.students where id=p_student_id) group by 1,2
    ), all_gain as (
      select student_id,month_start,sum(gain)::bigint gain from (select * from gains union all select * from legacy) x group by 1,2
    ), ranked as (select *,dense_rank() over(partition by month_start order by gain desc) rnk from all_gain)
    select count(*),coalesce(max(gain),0) into v_count,v_max from ranked where student_id=p_student_id and rnk=1 and gain>0;
    return jsonb_build_object('available',true,'source','HELPER_V6_LIFE','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','월간 BV 획득량 1위 달성 월 수','value',v_count),jsonb_build_object('label','1위 달성 월 중 최대 BV 획득량','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','월간 양수 BV 획득량을 Season 1+2.0으로 합산하고 동률 포함 1위를 판정합니다.');
  end if;

  if v_uid='LIFE-008' then
    select count(*) into v_count from public.secondary_jobs sj where sj.student_id=p_student_id and sj.approved_at is not null;
    select count(*) into v_count2 from public.secondary_job_service_orders o where o.seller_student_id=p_student_id and o.status='COMPLETED';
    return jsonb_build_object('available',true,'source','HELPER_V6_LIFE','metric_code',v_uid,'measured_value',v_count2,'target_value',1,'op','>=','result',case when v_count>=1 and v_count2>=1 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','승인된 2차직업 수','value',v_count),jsonb_build_object('label','완료 판매 수','value',v_count2)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('DAILY','P2P'),'note','2차직업 승인 이력과 실제 완료 판매 1건 이상을 함께 확인합니다.');
  end if;

  if v_uid in ('LIFE-009','LIFE-010') then
    select count(distinct pj.job_name) into v_count from public.primary_jobs pj where pj.student_id=p_student_id;
    v_target:=case when v_uid='LIFE-009' then 3 else 5 end;
    return jsonb_build_object('available',true,'source','HELPER_V6_LIFE','metric_code',v_uid,'measured_value',v_count,'target_value',v_target,'op','>=','result',case when v_count>=v_target then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('DAILY'),'note','1인1역 배정 이력에서 서로 다른 역할명 개수를 계산합니다.');
  end if;

  if v_uid='LIFE-013' then
    with cleaning as (
      select r.quest_date,bool_and(q.result='PASS' and coalesce(q.teacher_override,false)=false) all_first_pass from public.daily_quest_checks q join public.daily_quest_reports r on r.id=q.report_id where q.student_id=p_student_id and q.quest_code='CLEANING' group by r.quest_date
    ), weeks as (select date_trunc('week',quest_date)::date week_start,count(*) filter(where all_first_pass and extract(isodow from quest_date) between 1 and 5) pass_days from cleaning group by 1)
    select coalesce(max(pass_days),0) into v_max from weeks;
    return jsonb_build_object('available',true,'source','HELPER_V6_LIFE','metric_code',v_uid,'measured_value',v_max,'target_value',5,'op','>=','result',case when v_max>=5 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','한 주의 청소 1차 PASS 최대 일수','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('DAILY'),'note','월~금 CLEANING 결과가 PASS이고 교사 override가 아닌 날을 “한 번에 통과”로 계산합니다.');
  end if;

  if v_uid='LIFE-014' then
    with per_month as (
      select date_trunc('month',r.quest_date)::date month_start,count(*) total_checks,count(*) filter(where q.result='PASS' and coalesce(q.teacher_override,false)=false) pass_checks from public.daily_quest_checks q join public.daily_quest_reports r on r.id=q.report_id where q.student_id=p_student_id and q.quest_code='PRIMARY_JOB' group by 1
    ) select count(*) filter(where month_start<date_trunc('month',current_date)::date and total_checks>=15 and pass_checks=total_checks),coalesce(max(pass_checks) filter(where month_start=date_trunc('month',current_date)::date),0) into v_count,v_max from per_month;
    return jsonb_build_object('available',true,'source','HELPER_V6_LIFE','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','완료 월 중 1인1역 전부 1차 PASS인 월 수','value',v_count),jsonb_build_object('label','현재 월 1차 PASS 누적','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('DAILY'),'note','완료된 달에서 PRIMARY_JOB 검사 15회 이상이 모두 PASS이고 교사 override가 없을 때 달성으로 판정합니다.');
  end if;

  if v_uid='LIFE-018' then
    select count(*) into v_count from public.app_access_events ae where ae.student_id=p_student_id and ae.is_visit_start=true;
    return jsonb_build_object('available',true,'source','HELPER_V6_LIFE','metric_code',v_uid,'result','REVIEW','details',jsonb_build_array(jsonb_build_object('label','확인 가능한 방문 시작 기록 수','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ACCESS'),'note','업적 마스터의 조건이 “특정 시간대”라고만 되어 있고 정확한 시간 구간이 SSOT에 저장되어 있지 않아 임의 기준으로 자동 판정하지 않습니다.');
  end if;

  if v_uid='LIFE-021' then
    select count(distinct counterparty) into v_count from (
      select case when p.sender_id=p_student_id then p.receiver_id else p.sender_id end counterparty from public.p2p_transfers p where (p.sender_id=p_student_id or p.receiver_id=p_student_id) and p.status::text='NORMAL'
      union select case when o.buyer_student_id=p_student_id then o.seller_student_id else o.buyer_student_id end from public.secondary_job_service_orders o where (o.buyer_student_id=p_student_id or o.seller_student_id=p_student_id) and o.status='COMPLETED'
    ) q;
    select count(*)-1 into v_count2 from public.students s where s.classroom_id=(select classroom_id from public.students where id=p_student_id) and s.role='STUDENT' and s.transferred_at is null and coalesce(s.is_test_account,false)=false;
    return jsonb_build_object('available',true,'source','HELPER_V6_LIFE','metric_code',v_uid,'measured_value',v_count,'target_value',v_count2,'op','>=','result',case when v_count>=v_count2 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','거래한 서로 다른 반 친구 수','value',v_count),jsonb_build_object('label','필요한 다른 학생 수','value',v_count2)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('P2P'),'note','정상 P2P와 완료 서비스 주문에서 서로 다른 거래 상대 학생 수를 계산합니다.');
  end if;

  return public._achievement_helper_generic_evidence_v5(p_student_id,v_uid);
end;
$$;
revoke all on function public._achievement_helper_life_evidence_v6(integer,text) from public,anon,authenticated;
grant execute on function public._achievement_helper_life_evidence_v6(integer,text) to service_role;

create or replace function public._achievement_helper_rank_evidence_v5(p_student_id integer,p_achievement_uid text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid text:=upper(btrim(coalesce(p_achievement_uid,'')));
  v_threshold bigint; v_target_name text; v_target_cross timestamptz; v_first_cross timestamptz; v_first_student_id integer; v_first_student_name text; v_current_bv bigint:=0;
begin
  v_threshold:=case v_uid when 'RANK-001' then 12500 when 'RANK-002' then 20000 when 'RANK-003' then 30000 when 'RANK-004' then 45000 when 'RANK-005' then 65000 when 'RANK-006' then 85000 when 'RANK-007' then 100000 else null end;
  v_target_name:=case v_uid when 'RANK-001' then '성장한 실버' when 'RANK-002' then '금 광석' when 'RANK-003' then '루비 원석' when 'RANK-004' then '홍염의 정점' when 'RANK-005' then '영원의 결정' when 'RANK-006' then '천상의 마스터' when 'RANK-007' then '그랜드마스터' else null end;
  if v_threshold is null then return public._achievement_helper_generic_evidence_v5(p_student_id,v_uid); end if;
  select coalesce(w.bv,0) into v_current_bv from public.wallets w where w.student_id=p_student_id;
  with crossings as (
    select h.student_id,min(h.occurred_at) crossed_at from public.legacy_asset_history h where h.classroom_id=(select classroom_id from public.students where id=p_student_id) and coalesce(h.balance_after_bv,-1)>=v_threshold group by h.student_id
    union all
    select t.student_id,min(t.created_at) from public.transactions t where t.classroom_id=(select classroom_id from public.students where id=p_student_id) and t.value_token='BV' and coalesce(t.balance_after,-1)>=v_threshold and coalesce(t.is_reversed,false)=false group by t.student_id
  ), first_per_student as (select student_id,min(crossed_at) crossed_at from crossings group by student_id), eligible as (
    select f.student_id,f.crossed_at,s.name,s.brand_name from first_per_student f join public.students s on s.id=f.student_id where s.transferred_at is null and coalesce(s.is_test_account,false)=false
  )
  select (select crossed_at from eligible where student_id=p_student_id),(select crossed_at from eligible order by crossed_at,student_id limit 1),(select student_id from eligible order by crossed_at,student_id limit 1),(select coalesce(nullif(brand_name,''),name) from eligible order by crossed_at,student_id limit 1)
  into v_target_cross,v_first_cross,v_first_student_id,v_first_student_name;
  return jsonb_build_object('available',true,'source','HELPER_V5_RANK','metric_code',v_uid,'measured_value',v_current_bv,'target_value',v_threshold,'op','>=','result',case when v_target_cross is null then 'FAIL' when v_target_cross=v_first_cross and p_student_id=v_first_student_id then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','대상 티어','value',v_target_name),jsonb_build_object('label','본인 최초 임계값 도달 시각','value',v_target_cross),jsonb_build_object('label','학급 최초 도달 시각','value',v_first_cross),jsonb_build_object('label','학급 최초 도달 학생','value',v_first_student_name)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('OVERVIEW','ECONOMY'),'note','Season 1 이관 BV 잔액과 2.0 BV 거래의 balance_after를 합쳐 해당 임계값에 처음 도달한 시각을 학생별로 복원한 뒤 학급 최초 여부를 비교합니다.');
end;
$$;
revoke all on function public._achievement_helper_rank_evidence_v5(integer,text) from public,anon,authenticated;
grant execute on function public._achievement_helper_rank_evidence_v5(integer,text) to service_role;

create or replace function public._achievement_helper_misc_evidence_v6(p_student_id integer,p_achievement_uid text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid text:=upper(btrim(coalesce(p_achievement_uid,'')));
  v_classroom_id integer;
  v_count bigint:=0; v_count2 bigint:=0; v_count3 bigint:=0; v_sum bigint:=0; v_sum2 bigint:=0; v_max bigint:=0; v_bv bigint:=0; v_gold bigint:=0; v_asset bigint:=0; v_target bigint:=1; v_name text;
begin
  select s.classroom_id into v_classroom_id from public.students s where s.id=p_student_id and s.transferred_at is null;
  if v_classroom_id is null then return jsonb_build_object('available',false,'error','학생 컨텍스트를 확인할 수 없습니다.'); end if;

  if v_uid='MVP-001' then
    select coalesce((select count(*) from public.legacy_asset_history h where h.student_id=p_student_id and h.memo ilike '%주간%MVP%'),0)+coalesce((select count(*) from public.transactions t where t.student_id=p_student_id and t.value_token='BV' and t.amount>0 and coalesce(t.is_reversed,false)=false and t.memo ilike '%주간%MVP%'),0) into v_count;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'measured_value',v_count,'target_value',2,'op','>=','result',case when v_count>=2 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ACHIEVEMENTS','ECONOMY'),'note','Season 1 이관 원장의 주간 MVP 기록과 2.0 BV 지급 원장의 주간 MVP 기록을 합산합니다.');
  end if;

  if v_uid in ('MVP-002','HID-006') then
    select count(*) into v_count from public.records_monthly_mvp_archive m where m.winner_student_id=p_student_id and coalesce(m.status,'ACTIVE') not in ('VOID','CANCELLED','REVOKED');
    v_target:=case when v_uid='HID-006' then 2 else 1 end;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'measured_value',v_count,'target_value',v_target,'op','>=','result',case when v_count>=v_target then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ACHIEVEMENTS'),'note','공식 월간 MVP 아카이브의 우승 기록만 사용합니다.');
  end if;

  if v_uid='HID-002' then
    with daily as (
      select h.event_date,sum(coalesce(h.bv_delta,0))::bigint bv_delta,sum(coalesce(h.gold_delta,0))::bigint gold_delta from public.legacy_asset_history h where h.student_id=p_student_id group by h.event_date
      union all
      select (t.created_at at time zone 'Asia/Seoul')::date,sum(case when t.value_token='BV' then t.amount else 0 end)::bigint,sum(case when t.value_token='GOLD' then t.amount else 0 end)::bigint from public.transactions t where t.student_id=p_student_id and coalesce(t.is_reversed,false)=false group by 1
    ), combined as (select event_date,sum(bv_delta)::bigint bv_delta,sum(gold_delta)::bigint gold_delta from daily group by event_date)
    select count(*) into v_count from combined where bv_delta=0 and gold_delta=0;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','Season 1+2.0의 날짜별 BV와 GOLD 순변동이 모두 정확히 0인 날을 찾습니다.');
  end if;

  if v_uid in ('HID-004','HID-005') then
    select count(*) into v_count from public.student_achievements sa where sa.student_id=p_student_id and coalesce(sa.is_revoked,false)=false;
    v_target:=case when v_uid='HID-004' then 10 else 50 end;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'measured_value',v_count,'target_value',v_target,'op','>=','result',case when v_count>=v_target then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ACHIEVEMENTS'),'note','현재 유효한 업적 보유 개수를 계산합니다.');
  end if;

  if v_uid='HID-007' then
    select coalesce(w.bv,0) into v_bv from public.wallets w where w.student_id=p_student_id;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'measured_value',v_bv,'target_value','끝 4자리 0000','op','pattern','result',case when v_bv>=10000 and mod(v_bv,10000)=0 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('OVERVIEW'),'note','현재 BV가 10,000 이상이면서 마지막 네 자리가 0000인지 확인합니다.');
  end if;

  if v_uid='HID-008' then
    select coalesce(w.gold,0) into v_gold from public.wallets w where w.student_id=p_student_id;
    select v_gold+coalesce((select sum(d.principal) from public.student_deposits d where d.student_id=p_student_id and d.status='ACTIVE'),0)+coalesce((select sum(si.actual_principal) from public.student_installment_savings si where si.student_id=p_student_id and si.status::text='ACTIVE'),0) into v_asset;
    select count(distinct ch) into v_count from regexp_split_to_table(v_asset::text,'') ch where ch<>'';
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'measured_value',v_asset,'target_value','모든 자릿수 동일','op','pattern','result',case when v_asset>=10 and v_count=1 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('OVERVIEW','ECONOMY'),'note','현재 자산을 현금 GOLD + 활성 예금 원금 + 활성 적금 실제 원금으로 계산하고 모든 자릿수가 같은 숫자인지 확인합니다.');
  end if;

  if v_uid in ('STORY-001','STORY-002') then
    select c.name into v_name from public.characters c where c.id=case when v_uid='STORY-001' then 22 else 12 end;
    select count(*) into v_count from public.dimensional_gate_story_episodes e join public.dimensional_gate_story_progress sp on sp.episode_id=e.id and sp.student_id=p_student_id where e.character_id=case when v_uid='STORY-001' then 22 else 12 end and e.is_active=true and sp.completed_at is not null;
    select count(*) into v_count2 from public.dimensional_gate_story_episodes e where e.character_id=case when v_uid='STORY-001' then 22 else 12 end and e.is_active=true;
    select coalesce(max(dr.affinity),0) into v_max from public.dimensional_gate_relationships dr where dr.student_id=p_student_id and dr.character_id=case when v_uid='STORY-001' then 22 else 12 end;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'measured_value',v_count,'target_value',v_count2,'op','=','result',case when v_count2>0 and v_count=v_count2 and v_max>=100 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','캐릭터','value',v_name),jsonb_build_object('label','완료 에피소드','value',v_count),jsonb_build_object('label','전체 활성 에피소드','value',v_count2),jsonb_build_object('label','현재 호감도','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('DIMENSION'),'note','해당 캐릭터의 모든 활성 스토리 에피소드 완료와 호감도 100 이상을 함께 확인합니다.');
  end if;

  if v_uid='VAC-001' then
    select count(*) into v_count from public.app_access_daily ad where ad.student_id=p_student_id and ad.access_date between date '2026-07-25' and date '2026-08-23' and ad.has_direct_app_signal=true;
    if v_count=0 then select count(*) into v_count from public.legacy_asset_history h where h.student_id=p_student_id and h.memo like '[방학출석]%'; end if;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ACCESS'),'note','여름방학 기간 직접 앱 접속 기록을 우선 확인하고, 없으면 Season 1 방학출석 이관 기록을 보조 근거로 사용합니다.');
  end if;

  if v_uid in ('VAC-002','VAC-003','VAC-004','VAC-005','VAC-008') then
    select count(*) filter(where h.memo like '[방학출석]%' or h.memo like '[방학보충]%' or h.memo like '[방학복구]%'),count(*) filter(where h.memo like '[방학복구]%') into v_count,v_count2 from public.legacy_asset_history h where h.student_id=p_student_id;
    v_target:=case when v_uid='VAC-002' then 10 when v_uid='VAC-003' then 14 else 28 end;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'measured_value',v_count,'target_value',v_target,'op','>=','result',case when v_uid='VAC-005' then case when v_count>=28 and v_count2>=1 then 'PASS' else 'FAIL' end else case when v_count>=v_target then 'PASS' else 'FAIL' end end,'details',jsonb_build_array(jsonb_build_object('label','확인된 별 획득/복구 기록 수','value',v_count),jsonb_build_object('label','방학복구 기록 수','value',v_count2)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ACCESS','ECONOMY'),'note',case when v_uid='VAC-005' then '방학 기록 28개 완성 + 방학복구 1회 이상을 함께 확인합니다.' else 'Season 1 이관 원장의 방학출석·방학보충·방학복구 기록을 별 획득 기록으로 합산합니다.' end);
  end if;

  if v_uid='VAC-009' then
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'result','REVIEW','verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ACCESS','ECONOMY','ACHIEVEMENTS'),'note','방학 이벤트 토큰 교환 SSOT가 독립 필드로 완전 이관되지 않아 자동 확정하지 않습니다.');
  end if;

  if v_uid='CONS-002' then
    select count(*) into v_count from public.attendances a where a.student_id=p_student_id and a.status='PRESENT';
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'result','REVIEW','details',jsonb_build_array(jsonb_build_object('label','확인 가능한 PRESENT 출석일','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('DAILY'),'note','현재 출결 SSOT에는 “그날 몇 번째로 등교했는지”의 도착 순번이 저장되어 있지 않아 자동 확정하지 않습니다.');
  end if;

  if v_uid='CHAL-004' then
    with cutoff as (select ((now() at time zone 'Asia/Seoul')::date-30)::date d), historical as (
      select distinct on (h.student_id) h.student_id,h.balance_after_bv from public.legacy_asset_history h,cutoff c where h.classroom_id=v_classroom_id and h.event_date<=c.d order by h.student_id,h.occurred_at desc,h.id desc
    ), start_ranks as (select h.student_id,dense_rank() over(order by h.balance_after_bv desc) rnk from historical h), current_ranks as (
      select s.id student_id,dense_rank() over(order by coalesce(w.bv,0) desc) rnk from public.students s left join public.wallets w on w.student_id=s.id where s.classroom_id=v_classroom_id and s.role='STUDENT' and s.transferred_at is null and coalesce(s.is_test_account,false)=false
    ) select coalesce(sr.rnk,0)-coalesce(cr.rnk,0),coalesce(sr.rnk,0),coalesce(cr.rnk,0) into v_sum,v_sum2,v_max from start_ranks sr full join current_ranks cr using(student_id) where coalesce(sr.student_id,cr.student_id)=p_student_id;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'measured_value',v_sum,'target_value',10,'op','>=','result',case when v_sum>=10 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','30일 전 BV 순위','value',v_sum2),jsonb_build_object('label','현재 BV 순위','value',v_max),jsonb_build_object('label','상승 계단','value',v_sum)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('OVERVIEW','ECONOMY'),'note','30일 전 Season 1 이관 BV 잔액을 기준으로 학급 순위를 복원하고 현재 BV 순위와 비교합니다.');
  end if;

  if v_uid='CHAL-008' then
    with a as (select count(*) total_days,count(*) filter(where status='PRESENT') present_days from public.attendances where student_id=p_student_id), p as (
      select coalesce((select count(*) from public.transactions t where t.student_id=p_student_id and t.value_token='BV' and t.amount<0 and coalesce(t.is_reversed,false)=false),0)+coalesce((select count(*) from public.legacy_asset_history h where h.student_id=p_student_id and coalesce(h.bv_delta,0)<0),0) penalties
    ) select a.total_days,a.present_days,p.penalties into v_count,v_count2,v_max from a cross join p;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'result',case when v_count>=100 and v_count2=v_count and v_max=0 then 'PASS' else 'REVIEW' end,'details',jsonb_build_array(jsonb_build_object('label','출결 기록 일수','value',v_count),jsonb_build_object('label','PRESENT 일수','value',v_count2),jsonb_build_object('label','확인된 음수 BV 기록 수','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('DAILY','ECONOMY'),'note','100일치 출결 커버리지가 부족하면 자동 FAIL로 오판하지 않고 REVIEW로 남깁니다.');
  end if;

  if v_uid='CHAL-009' then
    with scope as (
      select s.id student_id,coalesce(w.bv,0)::bigint bv,
        coalesce(w.gold,0)+coalesce((select sum(d.principal) from public.student_deposits d where d.student_id=s.id and d.status='ACTIVE'),0)+coalesce((select sum(si.actual_principal) from public.student_installment_savings si where si.student_id=s.id and si.status::text='ACTIVE'),0) asset,
        coalesce((select count(*) from public.student_achievements sa where sa.student_id=s.id and coalesce(sa.is_revoked,false)=false),0) achievements,
        coalesce((select count(*) from public.transactions t where t.student_id=s.id and t.value_token='BV' and t.amount<0 and coalesce(t.is_reversed,false)=false),0)+coalesce((select count(*) from public.legacy_asset_history h where h.student_id=s.id and coalesce(h.bv_delta,0)<0),0) penalties,
        coalesce((select sum(abs(t.amount)) from public.transactions t where t.student_id=s.id and t.value_token='GOLD' and t.source_type='DONATION' and coalesce(t.is_reversed,false)=false),0)+coalesce((select sum(abs(h.gold_delta)) from public.legacy_asset_history h where h.student_id=s.id and h.gold_delta<0 and (h.memo ilike '%기부%' or h.memo ilike '%복지기금%')),0) donation
      from public.students s left join public.wallets w on w.student_id=s.id where s.classroom_id=v_classroom_id and s.role='STUDENT' and s.transferred_at is null and coalesce(s.is_test_account,false)=false
    ), ranked as (select *,dense_rank() over(order by bv desc) bv_rank,dense_rank() over(order by asset desc) asset_rank,dense_rank() over(order by achievements desc) achievement_rank,dense_rank() over(order by penalties asc) penalty_rank,dense_rank() over(order by donation desc) donation_rank from scope)
    select achievements,bv_rank,asset_rank,achievement_rank,penalty_rank,donation_rank into v_count,v_count2,v_count3,v_sum,v_sum2,v_max from ranked where student_id=p_student_id;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'result',case when v_count>=30 and v_count2=1 and v_count3=1 and v_sum=1 and v_sum2=1 and v_max=1 then 'PASS' else 'FAIL' end,'details',jsonb_build_array(jsonb_build_object('label','업적 보유 수','value',v_count),jsonb_build_object('label','BV 순위','value',v_count2),jsonb_build_object('label','자산 순위','value',v_count3),jsonb_build_object('label','업적 수 순위','value',v_sum),jsonb_build_object('label','적은 벌점 순위','value',v_sum2),jsonb_build_object('label','기부금액 순위','value',v_max)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('OVERVIEW','ECONOMY','ACHIEVEMENTS'),'note','다섯 지표를 같은 학급 활성 학생 전체와 비교하며 동률은 공동 1위로 인정합니다. 업적 30개 이상 조건도 적용합니다.');
  end if;

  if v_uid='CHAL-011' then
    with weekly as (
      select date_trunc('week',d)::date week_start,sum(penalty)::bigint penalty,sum(bonus)::bigint bonus from (
        select (t.created_at at time zone 'Asia/Seoul')::date d,case when t.value_token='BV' and t.amount<0 then abs(t.amount) else 0 end penalty,case when t.value_token='BV' and t.amount>0 and t.source_type='TEACHER_GRANT' then t.amount else 0 end bonus from public.transactions t where t.student_id=p_student_id and coalesce(t.is_reversed,false)=false
        union all select h.event_date,case when coalesce(h.bv_delta,0)<0 then abs(h.bv_delta) else 0 end,case when coalesce(h.bv_delta,0)>0 and h.memo ilike '%보너스%' then h.bv_delta else 0 end from public.legacy_asset_history h where h.student_id=p_student_id
      ) x group by 1
    ) select count(*) into v_count from weekly where penalty>=500 and bonus>=1000;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY'),'note','같은 ISO 주 안의 음수 BV 500 이상과 교사/Season 1 보너스 BV 1000 이상을 함께 확인합니다.');
  end if;

  if v_uid='CHAL-014' then
    select count(*) into v_count from public.legacy_asset_history h where h.student_id=p_student_id and coalesce(h.balance_after_gold,999999999)<=100;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'result','REVIEW','details',jsonb_build_array(jsonb_build_object('label','Season 1 자산 100 이하 기록 지점 수','value',v_count)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('ECONOMY','OVERVIEW'),'note','과거 통합 자산 시계열과 보너스 분류가 완전하지 않아 자동 PASS/FAIL을 만들지 않고 후보 시점과 원장을 직접 확인하게 합니다.');
  end if;

  if v_uid='GUILD-001' then
    select count(*) into v_count from public.guild_members gm join public.guilds g on g.id=gm.guild_id where gm.student_id=p_student_id and gm.left_at is null and nullif(btrim(g.name),'') is not null and nullif(btrim(coalesce(g.slogan,'')),'') is not null and nullif(btrim(coalesce(g.logo_url,'')),'') is not null;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'measured_value',v_count,'target_value',1,'op','>=','result',case when v_count>=1 then 'PASS' else 'FAIL' end,'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('GUILD'),'note','현재 소속 길드에 이름·슬로건·로고가 모두 등록되어 있는지 확인합니다.');
  end if;

  if v_uid like 'GUILD-%' then
    select count(*) into v_count from public.guild_members gm where gm.student_id=p_student_id;
    select count(*) into v_count2 from public.guild3_mission_participants mp where mp.student_id=p_student_id;
    select count(*) into v_count3 from public.guild_session_attendances ga where ga.student_id=p_student_id and ga.is_present=true;
    return jsonb_build_object('available',true,'source','HELPER_V6_MISC','metric_code',v_uid,'result','REVIEW','details',jsonb_build_array(jsonb_build_object('label','길드 소속 이력 수','value',v_count),jsonb_build_object('label','2.0 공식 길드미션 참여 기록 수','value',v_count2),jsonb_build_object('label','2.0 길드 세션 출석 기록 수','value',v_count3)),'verification_mode','SYSTEM_RECORD','record_sections',jsonb_build_array('GUILD','P2P'),'note','Season 1 세부 미션·순위·세션 SSOT가 2.0으로 완전 이관되지 않아 현재 길드 기록과 신청 설명을 대조하되 자동 확정하지 않습니다.');
  end if;

  return public._achievement_helper_generic_evidence_v5(p_student_id,v_uid);
end;
$$;
revoke all on function public._achievement_helper_misc_evidence_v6(integer,text) from public,anon,authenticated;
grant execute on function public._achievement_helper_misc_evidence_v6(integer,text) to service_role;

create or replace function public.student_get_achievement_helper_queue()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_helper_id integer:=public.current_student_id();
  v_classroom_id integer:=public.current_classroom_id();
  v_result jsonb:='[]'::jsonb;
  r record;
  v_auto_evidence jsonb;
  v_my_rec record;
begin
  if not public.achievement_current_student_is_helper() then
    raise exception 'Achievement helper role required' using errcode='PA302';
  end if;

  for r in
    select aa.id,aa.student_id,aa.evidence_text,aa.status,aa.created_at,
           a.id achievement_id,a.achievement_uid,a.name achievement_name,a.condition_text,a.grade::text grade,
           a.evaluation_type::text evaluation_type,a.auto_eval_enabled,
           coalesce(nullif(s.brand_name,''),s.name,'학생') student_name,
           p.verification_mode,p.record_sections,p.helper_note
    from public.achievement_applications aa
    join public.achievements a on a.id=aa.achievement_id
    join public.students s on s.id=aa.student_id
    left join public.achievement_helper_verification_profiles p on p.achievement_uid=a.achievement_uid
    where aa.classroom_id=v_classroom_id
      and aa.application_kind='NORMAL'
      and aa.status in ('PENDING','PENDING_REVIEW')
      and a.is_active=true
      and a.helper_review_enabled=true
      and (not a.is_hidden or a.revealed_at is not null)
    order by aa.created_at,aa.id
  loop
    if r.achievement_uid like 'ARC-%' then
      v_auto_evidence:=public._achievement_helper_arcade_evidence_v5(r.student_id,r.achievement_uid);
    elsif r.achievement_uid like 'ECO-%' then
      v_auto_evidence:=public._achievement_helper_economy_evidence_v6(r.student_id,r.achievement_uid);
    elsif r.achievement_uid like 'LIFE-%' then
      v_auto_evidence:=public._achievement_helper_life_evidence_v6(r.student_id,r.achievement_uid);
    elsif r.achievement_uid like 'RANK-%' then
      v_auto_evidence:=public._achievement_helper_rank_evidence_v5(r.student_id,r.achievement_uid);
    elsif r.achievement_uid like 'SHARD-%' then
      v_auto_evidence:=public._achievement_helper_shard_evidence_v5(r.student_id,r.achievement_uid);
    elsif r.achievement_uid like 'MVP-%'
       or r.achievement_uid like 'HID-%'
       or r.achievement_uid like 'STORY-%'
       or r.achievement_uid like 'VAC-%'
       or r.achievement_uid like 'CONS-%'
       or r.achievement_uid like 'CHAL-%'
       or r.achievement_uid like 'GUILD-%' then
      v_auto_evidence:=public._achievement_helper_misc_evidence_v6(r.student_id,r.achievement_uid);
    else
      v_auto_evidence:=public._achievement_helper_generic_evidence_v5(r.student_id,r.achievement_uid);
    end if;

    select h.recommendation,h.memo,h.updated_at
    into v_my_rec
    from public.achievement_helper_reviews h
    where h.application_id=r.id and h.helper_student_id=v_helper_id;

    v_result:=v_result||jsonb_build_array(jsonb_build_object(
      'application_id',r.id,
      'student_id',r.student_id,
      'student_name',r.student_name,
      'achievement_id',r.achievement_id,
      'achievement_uid',r.achievement_uid,
      'achievement_name',r.achievement_name,
      'condition_text',r.condition_text,
      'grade',r.grade,
      'evaluation_type',r.evaluation_type,
      'auto_eval_enabled',r.auto_eval_enabled,
      'verification_mode',coalesce(r.verification_mode,'TEACHER_JUDGMENT'),
      'record_sections',coalesce(to_jsonb(r.record_sections),'[]'::jsonb),
      'helper_note',r.helper_note,
      'evidence_text',r.evidence_text,
      'system_evidence',v_auto_evidence,
      'status',r.status::text,
      'created_at',r.created_at,
      'my_recommendation',v_my_rec.recommendation,
      'my_memo',v_my_rec.memo,
      'my_recommended_at',v_my_rec.updated_at
    ));
  end loop;

  return v_result;
end;
$$;

revoke all on function public.student_get_achievement_helper_queue() from public,anon;
grant execute on function public.student_get_achievement_helper_queue() to authenticated;

do $$
begin
  if exists (
    select 1
    from public.achievements a
    where a.classroom_id=1
      and a.is_active=true
      and not exists (
        select 1
        from public.achievement_helper_verification_profiles p
        where p.achievement_uid=a.achievement_uid
      )
  ) then
    raise exception 'Achievement helper verification profile coverage is incomplete.';
  end if;
end;
$$;

commit;
