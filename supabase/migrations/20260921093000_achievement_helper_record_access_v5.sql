begin;

create table if not exists public.achievement_helper_verification_profiles (
  achievement_uid text primary key,
  verification_mode text not null check (verification_mode in ('SYSTEM_RECORD','PARTIAL_PRIVATE','TEACHER_JUDGMENT')),
  record_sections text[] not null default '{}',
  helper_note text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.achievement_helper_verification_profiles enable row level security;
revoke all on table public.achievement_helper_verification_profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.achievement_helper_verification_profiles to service_role;

insert into public.achievement_helper_verification_profiles(achievement_uid,verification_mode,record_sections,helper_note,updated_at)
select a.achievement_uid,
       'TEACHER_JUDGMENT',
       case split_part(a.achievement_uid,'-',1)
         when 'ACH' then array['OVERVIEW','ECONOMY']::text[]
         when 'ARC' then array['ARCADE']::text[]
         when 'ART' then array[]::text[]
         when 'CHAL' then array['OVERVIEW','ECONOMY','DAILY','ACHIEVEMENTS']::text[]
         when 'CONS' then array['DAILY']::text[]
         when 'ECO' then array['OVERVIEW','ECONOMY','P2P','AUCTION']::text[]
         when 'GUILD' then array['GUILD','P2P']::text[]
         when 'HID' then array['OVERVIEW','ECONOMY','ACHIEVEMENTS','ACCESS']::text[]
         when 'LIFE' then array['OVERVIEW','DAILY','ECONOMY','P2P','ACCESS']::text[]
         when 'MVP' then array['OVERVIEW','ACHIEVEMENTS']::text[]
         when 'RANK' then array['OVERVIEW','ECONOMY']::text[]
         when 'SHARD' then array['SHARDS']::text[]
         when 'START' then array[]::text[]
         when 'STORY' then array['DIMENSION']::text[]
         when 'STU' then array[]::text[]
         when 'TEAM' then array[]::text[]
         when 'VAC' then array['ACCESS','ECONOMY']::text[]
         else array['OVERVIEW']::text[]
       end,
       '제출 설명과 공개 가능한 시스템 기록을 확인한 뒤 판단하세요. 교사의 최종 승인·반려 권한은 그대로 유지됩니다.',
       now()
from public.achievements a
where a.classroom_id=1 and a.is_active=true
on conflict (achievement_uid) do update
set record_sections=excluded.record_sections,
    updated_at=excluded.updated_at;

update public.achievement_helper_verification_profiles
set verification_mode='SYSTEM_RECORD', helper_note='시스템에 남은 객관적 기록을 중심으로 검증합니다. 관련 기록실에서 원자료를 추가 확인할 수 있습니다.', updated_at=now()
where achievement_uid = any(array[
 'ACH-001','ACH-002',
 'ARC-001','ARC-002','ARC-003','ARC-004','ARC-005','ARC-006','ARC-007','ARC-008','ARC-009','ARC-010','ARC-011','ARC-012','ARC-013','ARC-014','ARC-015','ARC-016','ARC-017','ARC-018',
 'CHAL-004','CHAL-008','CHAL-009','CHAL-011','CHAL-014',
 'CONS-002',
 'ECO-001','ECO-002','ECO-003','ECO-004','ECO-005','ECO-006','ECO-007','ECO-008','ECO-009','ECO-010','ECO-011','ECO-012','ECO-013','ECO-014','ECO-015','ECO-016','ECO-017','ECO-018','ECO-021','ECO-022','ECO-023','ECO-024','ECO-025','ECO-026','ECO-027','ECO-029','ECO-030','ECO-032','ECO-033','ECO-034','ECO-036','ECO-037',
 'GUILD-001','GUILD-002','GUILD-003','GUILD-004','GUILD-007','GUILD-008','GUILD-009','GUILD-010','GUILD-011','GUILD-012','GUILD-013','GUILD-014',
 'HID-002','HID-004','HID-005','HID-006','HID-007','HID-008',
 'LIFE-002','LIFE-005','LIFE-006','LIFE-007','LIFE-008','LIFE-009','LIFE-010','LIFE-013','LIFE-014','LIFE-018','LIFE-021',
 'MVP-001','MVP-002',
 'RANK-001','RANK-002','RANK-003','RANK-004','RANK-005','RANK-006','RANK-007',
 'SHARD-001','SHARD-002','SHARD-003','SHARD-004','SHARD-005','SHARD-006','SHARD-007','SHARD-008','SHARD-009','SHARD-010',
 'STORY-001','STORY-002',
 'VAC-001','VAC-002','VAC-003','VAC-004','VAC-005','VAC-008','VAC-009'
]::text[]);

update public.achievement_helper_verification_profiles
set verification_mode='PARTIAL_PRIVATE', record_sections=array['P2P']::text[],
    helper_note='거래 횟수·상대·금액·상태는 확인할 수 있지만 구매자가 남긴 평점과 리뷰는 도우미에게 공개되지 않습니다. 평점 조건은 선생님이 최종 확인합니다.', updated_at=now()
where achievement_uid in ('ECO-020','ECO-031');

update public.achievement_helper_verification_profiles
set verification_mode='PARTIAL_PRIVATE', record_sections=array[]::text[],
    helper_note='공식 평가·활동 증명 자료는 업적 도우미에게 공개하지 않습니다. 학생 제출 설명만 1차 검토하고 실제 성적·PAPS·팀 과제 결과·우수작 선정·투표 결과는 선생님이 확인합니다.', updated_at=now()
where achievement_uid = any(array[
 'ART-001','ART-002','CHAL-005','CHAL-007','CHAL-010','CHAL-012','CHAL-013','CONS-001',
 'GUILD-005','GUILD-006','LIFE-020',
 'STU-001','STU-002','STU-005','STU-006','STU-007','STU-008','STU-009',
 'TEAM-001','TEAM-002','TEAM-003','TEAM-004'
]::text[]);

update public.achievement_helper_verification_profiles set record_sections=array['ECONOMY','DAILY']::text[], helper_note='실패·재도전 여부 자체의 의미 판단은 선생님 영역입니다. 공개 가능한 경제·생활 기록은 보조 자료로만 확인하세요.', updated_at=now() where achievement_uid='CHAL-001';
update public.achievement_helper_verification_profiles set record_sections=array['OVERVIEW','DAILY']::text[], helper_note='도전 난이도와 성공의 의미는 정성 판단이 필요합니다. 시스템 기록은 보조 자료일 뿐입니다.', updated_at=now() where achievement_uid in ('CHAL-002','CHAL-003');
update public.achievement_helper_verification_profiles set record_sections=array['ACHIEVEMENTS']::text[], helper_note='도움을 주었다는 사실과 성과 연결 여부는 제출 설명을 검토하고 선생님이 최종 판단합니다.', updated_at=now() where achievement_uid='CHAL-006';
update public.achievement_helper_verification_profiles set record_sections=array['ECONOMY','P2P']::text[], helper_note='경제수호대 브리핑·제보의 적절성은 선생님이 판단합니다. 공개 가능한 경제·거래 기록은 보조 자료로 확인할 수 있습니다.', updated_at=now() where achievement_uid in ('ECO-028','ECO-035');
update public.achievement_helper_verification_profiles set record_sections=array['ACCESS']::text[], helper_note='버그/이스터에그 제보 내용의 유효성은 선생님이 판단합니다. 미공개 히든 조건 자체는 절대 노출되지 않습니다.', updated_at=now() where achievement_uid in ('HID-001','HID-003');
update public.achievement_helper_verification_profiles set record_sections=array['ACCESS']::text[], helper_note='특별 우편의 내용과 개인 우편은 공개하지 않습니다. 학생 제출 설명을 중심으로 1차 검토하세요.', updated_at=now() where achievement_uid='HID-009';
update public.achievement_helper_verification_profiles set record_sections=array['DAILY','ACCESS']::text[], helper_note='행동의 질·태도·정리 상태·독서/제안 내용 등은 정성 판단이 필요합니다. 공개 가능한 생활 기록만 보조 자료로 확인합니다.', updated_at=now() where achievement_uid = any(array['LIFE-003','LIFE-011','LIFE-012','LIFE-015','LIFE-016','LIFE-017','LIFE-019']::text[]);
update public.achievement_helper_verification_profiles set record_sections=array[]::text[], helper_note='수업 참여·팀 기여·질문·토론·학습 산출물의 질은 선생님이 최종 판단합니다. 공식 평가 자료는 도우미에게 공개하지 않습니다.', updated_at=now() where achievement_uid = any(array['START-001','START-002','START-003','STU-003','STU-010','STU-011','STU-012','STU-013','STU-014']::text[]);
update public.achievement_helper_verification_profiles set record_sections=array['ACCESS']::text[], helper_note='방학 기록/제안의 내용 자체는 제출 설명을 검토하고 선생님이 최종 판단합니다.', updated_at=now() where achievement_uid in ('VAC-006','VAC-007');
update public.achievement_helper_verification_profiles set record_sections=array['OVERVIEW']::text[], helper_note='공개 조건이 열리기 전에는 업적 도우미에게 조건을 보여주지 않습니다. 공개 후에도 최종 인정은 선생님이 판단합니다.', updated_at=now() where achievement_uid='CHAL-015';

create or replace function public._achievement_helper_assert_target(p_student_id integer)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_classroom_id integer:=public.current_classroom_id();
  v_target_classroom integer;
begin
  if not public.achievement_current_student_is_helper() then
    raise exception 'Achievement helper role required' using errcode='PA302';
  end if;
  if p_student_id is null then raise exception 'student_id required' using errcode='22023'; end if;
  select s.classroom_id into v_target_classroom from public.students s where s.id=p_student_id and s.transferred_at is null;
  if v_target_classroom is null or v_target_classroom<>v_classroom_id then
    raise exception 'Target student is outside helper classroom' using errcode='42501';
  end if;
  return v_classroom_id;
end;
$$;
revoke all on function public._achievement_helper_assert_target(integer) from public,anon,authenticated;
grant execute on function public._achievement_helper_assert_target(integer) to service_role;

create or replace function public.student_get_achievement_helper_directory()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_classroom_id integer:=public.current_classroom_id();
  v_result jsonb;
begin
  if not public.achievement_current_student_is_helper() then raise exception 'Achievement helper role required' using errcode='PA302'; end if;
  with scope as (
    select s.id student_id,s.name,s.brand_name,s.cached_tier,coalesce(w.gold,0)::bigint gold,coalesce(w.crystal,0)::bigint crystal,coalesce(w.bv,0)::bigint bv
    from public.students s left join public.wallets w on w.student_id=s.id
    where s.classroom_id=v_classroom_id and s.role='STUDENT' and s.transferred_at is null and coalesce(s.is_test_account,false)=false
  ), assets as (
    select sc.*,
      coalesce((select sum(d.principal) from public.student_deposits d where d.student_id=sc.student_id and d.status='ACTIVE'),0)::bigint deposit_principal,
      coalesce((select sum(si.actual_principal) from public.student_installment_savings si where si.student_id=sc.student_id and si.status='ACTIVE'),0)::bigint installment_principal,
      coalesce((select count(*) from public.student_achievements sa where sa.student_id=sc.student_id and coalesce(sa.is_revoked,false)=false),0)::integer achievement_count,
      coalesce((select sum(abs(t.amount)) from public.transactions t where t.student_id=sc.student_id and t.value_token='GOLD' and t.source_type='DONATION' and coalesce(t.is_reversed,false)=false),0)::bigint donation_gold,
      coalesce((select count(*) from public.transactions t where t.student_id=sc.student_id and t.value_token='BV' and t.amount<0 and coalesce(t.is_reversed,false)=false),0)::integer bv_deduction_count
    from scope sc
  ), ranked as (
    select a.*,(a.gold+a.deposit_principal+a.installment_principal)::bigint total_asset,
      row_number() over(order by a.bv desc,a.name,a.student_id)::integer bv_rank,
      row_number() over(order by (a.gold+a.deposit_principal+a.installment_principal) desc,a.name,a.student_id)::integer asset_rank,
      row_number() over(order by a.achievement_count desc,a.name,a.student_id)::integer achievement_rank,
      row_number() over(order by a.donation_gold desc,a.name,a.student_id)::integer donation_rank,
      row_number() over(order by a.bv_deduction_count asc,a.name,a.student_id)::integer low_deduction_rank
    from assets a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'student_id',r.student_id,'student_name',r.name,'brand_name',r.brand_name,'tier',r.cached_tier,
    'gold',r.gold,'crystal',r.crystal,'bv',r.bv,'total_asset',r.total_asset,
    'achievement_count',r.achievement_count,'donation_gold',r.donation_gold,'bv_deduction_count',r.bv_deduction_count,
    'bv_rank',r.bv_rank,'asset_rank',r.asset_rank,'achievement_rank',r.achievement_rank,'donation_rank',r.donation_rank,'low_deduction_rank',r.low_deduction_rank
  ) order by r.name,r.student_id),'[]'::jsonb) into v_result from ranked r;
  return v_result;
end;
$$;
revoke all on function public.student_get_achievement_helper_directory() from public,anon;
grant execute on function public.student_get_achievement_helper_directory() to authenticated;

create or replace function public.student_get_achievement_helper_student_record(
  p_student_id integer,p_section text default 'OVERVIEW',p_limit integer default 100,p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_classroom_id integer;
  v_section text:=upper(btrim(coalesce(p_section,'OVERVIEW')));
  v_limit integer:=least(greatest(coalesce(p_limit,100),1),250);
  v_offset integer:=greatest(coalesce(p_offset,0),0);
  v_result jsonb;
  v_student jsonb;
begin
  v_classroom_id:=public._achievement_helper_assert_target(p_student_id);
  select jsonb_build_object('student_id',s.id,'student_name',s.name,'brand_name',s.brand_name,'tier',s.cached_tier,'enrolled_at',s.enrolled_at)
    into v_student from public.students s where s.id=p_student_id;

  if v_section='OVERVIEW' then
    with asset as (
      select coalesce(w.gold,0)::bigint gold,coalesce(w.crystal,0)::bigint crystal,coalesce(w.bv,0)::bigint bv,
        coalesce((select sum(d.principal) from public.student_deposits d where d.student_id=p_student_id and d.status='ACTIVE'),0)::bigint deposit_principal,
        coalesce((select sum(si.actual_principal) from public.student_installment_savings si where si.student_id=p_student_id and si.status='ACTIVE'),0)::bigint installment_principal,
        coalesce((select sum(l.remaining_principal) from public.loans l where l.student_id=p_student_id and l.status::text not in ('PAID','CANCELLED','REJECTED')),0)::bigint outstanding_loan,
        coalesce((select count(*) from public.student_achievements sa where sa.student_id=p_student_id and coalesce(sa.is_revoked,false)=false),0)::integer achievement_count,
        coalesce((select sum(abs(t.amount)) from public.transactions t where t.student_id=p_student_id and t.value_token='GOLD' and t.source_type='DONATION' and coalesce(t.is_reversed,false)=false),0)::bigint donation_gold,
        coalesce((select count(*) from public.transactions t where t.student_id=p_student_id and t.value_token='BV' and t.amount<0 and coalesce(t.is_reversed,false)=false),0)::integer bv_deduction_count,
        (select cs.total_score from public.credit_scores cs where cs.student_id=p_student_id order by cs.as_of_date desc,cs.calculated_at desc,cs.id desc limit 1)::integer credit_score
      from public.wallets w where w.student_id=p_student_id
    )
    select jsonb_build_object('section','OVERVIEW','student',v_student,'data',jsonb_build_object(
      'gold',a.gold,'crystal',a.crystal,'bv',a.bv,'deposit_principal',a.deposit_principal,'installment_principal',a.installment_principal,
      'total_asset',a.gold+a.deposit_principal+a.installment_principal,'outstanding_loan',a.outstanding_loan,'achievement_count',a.achievement_count,
      'donation_gold',a.donation_gold,'bv_deduction_count',a.bv_deduction_count,'credit_score',a.credit_score
    )) into v_result from asset a;
    return coalesce(v_result,jsonb_build_object('section','OVERVIEW','student',v_student,'data','{}'::jsonb));
  end if;

  if v_section='ECONOMY' then
    return jsonb_build_object('section','ECONOMY','student',v_student,'data',jsonb_build_object(
      'transactions',coalesce((select jsonb_agg(x order by (x->>'created_at')::timestamptz desc) from (
        select jsonb_build_object('id',t.id,'token',t.value_token::text,'amount',t.amount,'balance_after',t.balance_after,'source_type',t.source_type::text,'tax_amount',t.tax_amount,'created_at',t.created_at,'is_reversed',t.is_reversed) x
        from public.transactions t where t.student_id=p_student_id order by t.created_at desc,t.id desc limit v_limit offset v_offset
      ) q),'[]'::jsonb),
      'deposits',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'product_name',d.product_name_snapshot,'principal',d.principal,'interest_rate',d.interest_rate,'start_date',d.start_date,'maturity_date',d.maturity_date,'status',d.status::text,'interest_paid',d.interest_paid,'created_at',d.created_at) order by d.created_at desc) from public.student_deposits d where d.student_id=p_student_id),'[]'::jsonb),
      'installment_savings',coalesce((select jsonb_agg(jsonb_build_object('id',si.id,'product_name',si.product_name_snapshot,'installment_amount',si.installment_amount,'paid_rounds',si.paid_rounds,'missed_rounds',si.missed_rounds,'actual_principal',si.actual_principal,'interest_paid',si.interest_paid,'status',si.status::text,'start_date',si.start_date,'maturity_date',si.maturity_date) order by si.created_at desc) from public.student_installment_savings si where si.student_id=p_student_id),'[]'::jsonb),
      'loans',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'loan_amount',l.loan_amount,'remaining_principal',l.remaining_principal,'weekly_interest_rate',l.weekly_interest_rate,'executed_at',l.executed_at,'due_date',l.due_date,'status',l.status::text,'overdue_weeks',l.overdue_weeks) order by l.created_at desc) from public.loans l where l.student_id=p_student_id),'[]'::jsonb),
      'credit_history',coalesce((select jsonb_agg(jsonb_build_object('date',cs.as_of_date,'total_score',cs.total_score,'grade',cs.grade::text) order by cs.as_of_date desc,cs.calculated_at desc) from (select * from public.credit_scores where student_id=p_student_id order by as_of_date desc,calculated_at desc limit v_limit) cs),'[]'::jsonb),
      'market_purchases',coalesce((select jsonb_agg(jsonb_build_object('item_name',mi.name,'event_type',ie.event_type,'quantity_delta',ie.quantity_delta,'unit_gold',ie.unit_gold,'total_gold',ie.total_gold,'created_at',ie.created_at) order by ie.created_at desc) from (select * from public.inventory_events where student_id=p_student_id order by created_at desc limit v_limit) ie join public.market_items mi on mi.id=ie.item_id),'[]'::jsonb)
    ));
  end if;

  if v_section='P2P' then
    return jsonb_build_object('section','P2P','student',v_student,'privacy','평점과 리뷰는 업적 도우미에게 공개되지 않습니다.','data',jsonb_build_object(
      'transfers',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'direction',case when p.sender_id=p_student_id then 'SENT' else 'RECEIVED' end,'counterparty_student_id',case when p.sender_id=p_student_id then p.receiver_id else p.sender_id end,'counterparty_name',coalesce(nullif(cp.brand_name,''),cp.name),'amount',p.amount,'tag',p.tag,'quantity',p.quantity,'status',p.status::text,'created_at',p.created_at) order by p.created_at desc) from (select * from public.p2p_transfers where classroom_id=v_classroom_id and (sender_id=p_student_id or receiver_id=p_student_id) order by created_at desc limit v_limit offset v_offset) p join public.students cp on cp.id=case when p.sender_id=p_student_id then p.receiver_id else p.sender_id end),'[]'::jsonb),
      'service_orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'role',case when o.buyer_student_id=p_student_id then 'BUYER' else 'SELLER' end,'counterparty_student_id',case when o.buyer_student_id=p_student_id then o.seller_student_id else o.buyer_student_id end,'counterparty_name',coalesce(nullif(cp.brand_name,''),cp.name),'service_title',o.service_title_snapshot,'price_gold',o.price_gold_snapshot,'quantity',coalesce(o.requested_quantity,o.quantity,1),'status',o.status,'created_at',o.created_at,'completed_at',o.completed_at) order by o.created_at desc) from (select * from public.secondary_job_service_orders where classroom_id=v_classroom_id and (buyer_student_id=p_student_id or seller_student_id=p_student_id) order by created_at desc limit v_limit offset v_offset) o join public.students cp on cp.id=case when o.buyer_student_id=p_student_id then o.seller_student_id else o.buyer_student_id end),'[]'::jsonb)
    ));
  end if;

  if v_section='AUCTION' then
    return jsonb_build_object('section','AUCTION','student',v_student,'data',jsonb_build_object(
      'bids',coalesce((select jsonb_agg(jsonb_build_object('auction_id',a.id,'round_number',a.round_number,'item_name',ai.item_name,'starting_price',ai.starting_price,'bid_amount',b.bid_amount,'attempt_number',b.attempt_number,'is_winning',b.is_winning,'created_at',b.created_at) order by b.created_at desc) from (select * from public.auction_bids where student_id=p_student_id order by created_at desc limit v_limit offset v_offset) b join public.auction_items ai on ai.id=b.auction_item_id join public.auctions a on a.id=ai.auction_id),'[]'::jsonb),
      'wins',coalesce((select jsonb_agg(jsonb_build_object('auction_id',a.id,'round_number',a.round_number,'item_name',ai.item_name,'starting_price',ai.starting_price,'final_price',ar.final_price,'attempt_number',ar.attempt_number,'confirmed_at',ar.confirmed_at) order by ar.confirmed_at desc) from public.auction_results ar join public.auction_items ai on ai.id=ar.auction_item_id join public.auctions a on a.id=ai.auction_id where ar.winner_student_id=p_student_id),'[]'::jsonb)
    ));
  end if;

  if v_section='ARCADE' then
    return jsonb_build_object('section','ARCADE','student',v_student,'data',jsonb_build_object(
      'runs',coalesce((select jsonb_agg(jsonb_build_object('run_id',r.id,'game_code',g.code,'game_name',g.internal_name,'status',r.status,'official_score',r.official_score,'duration_ms',r.official_duration_ms,'game_over_at',r.game_over_at,'verified_at',r.verified_at,'run_context',r.run_context) order by r.created_at desc) from (select * from public.arcade_runs where student_id=p_student_id and coalesce(is_prerelease_test,false)=false order by created_at desc limit v_limit offset v_offset) r join public.arcade_games g on g.id=r.game_id),'[]'::jsonb),
      'monthly_final_ranks',coalesce((select jsonb_agg(jsonb_build_object('period',rp.display_name,'year_month',ms.contribution_year_month,'game_code',ms.game_code_at_close,'game_name',ms.game_name_at_close,'rank',sr.rank,'score',sr.official_score,'achieved_at',sr.achieved_at) order by rp.starts_at desc,ms.game_code_at_close) from public.arcade_monthly_snapshot_student_ranks sr join public.arcade_monthly_snapshots ms on ms.id=sr.snapshot_id join public.arcade_ranking_periods rp on rp.id=ms.period_id where sr.student_id=p_student_id),'[]'::jsonb),
      'verification_sessions',coalesce((select jsonb_agg(jsonb_build_object('session_id',vs.id,'period',rp.display_name,'game_code',g.code,'provisional_score',vs.provisional_score,'threshold',vs.verification_threshold,'max_attempts',vs.max_attempts,'status',vs.status,'success',vs.success_achieved,'result_status',vs.result_status,'activated_at',vs.activated_at,'ended_at',vs.ended_at) order by vs.activated_at desc) from (select * from public.arcade_verification_sessions where student_id=p_student_id order by activated_at desc limit v_limit) vs join public.arcade_games g on g.id=vs.game_id join public.arcade_ranking_periods rp on rp.id=vs.period_id),'[]'::jsonb),
      'verification_attempts',coalesce((select jsonb_agg(jsonb_build_object('session_id',va.session_id,'opportunity',va.opportunity_number,'status',va.status,'valid_run',va.valid_run,'terminal_outcome',va.terminal_outcome,'official_score',va.official_score,'issued_at',va.issued_at,'terminal_at',va.terminal_at) order by va.issued_at desc) from public.arcade_verification_attempts va join public.arcade_verification_sessions vs on vs.id=va.session_id where vs.student_id=p_student_id),'[]'::jsonb)
    ));
  end if;

  if v_section='GUILD' then
    return jsonb_build_object('section','GUILD','student',v_student,'data',jsonb_build_object(
      'memberships',coalesce((select jsonb_agg(jsonb_build_object('guild_id',g.id,'guild_name',g.name,'season_id',gm.season_id,'element',gm.element::text,'joined_at',gm.joined_at,'left_at',gm.left_at) order by gm.joined_at desc) from public.guild_members gm join public.guilds g on g.id=gm.guild_id where gm.student_id=p_student_id),'[]'::jsonb),
      'session_attendance',coalesce((select jsonb_agg(jsonb_build_object('guild_name',g.name,'session_date',ga.session_date,'is_present',ga.is_present) order by ga.session_date desc) from public.guild_session_attendances ga join public.guilds g on g.id=ga.guild_id where ga.student_id=p_student_id),'[]'::jsonb),
      'monthly_contribution',coalesce((select jsonb_agg(jsonb_build_object('year_month',gc.year_month,'guild_name',g.name,'bv_growth',gc.bv_growth,'mission_participation_count',gc.mission_participation_count,'session_attendance_count',gc.session_attendance_count,'total_contribution_score',gc.total_contribution_score,'guild_rank',gc.guild_rank) order by gc.year_month desc) from public.guild_individual_contributions gc join public.guilds g on g.id=gc.guild_id where gc.student_id=p_student_id),'[]'::jsonb),
      'closed_snapshots',coalesce((select jsonb_agg(jsonb_build_object('year_month',mc.year_month,'guild_name',ss.guild_name_at_close,'final_contribution',ss.final_contribution,'mission_points',ss.mission_points,'session_points',ss.session_points,'arcade_applied',ss.arcade_applied) order by mc.year_month desc) from public.guild5_student_snapshots ss join public.guild5_closure_versions cv on cv.id=ss.version_id join public.guild5_month_closures mc on mc.id=cv.closure_id where ss.student_id=p_student_id and mc.current_version_id=cv.id),'[]'::jsonb),
      'mission_participation',coalesce((select jsonb_agg(jsonb_build_object('mission_id',m.id,'title',m.title,'guild_name',mp.guild_name_at_snapshot,'snapshot_at',mp.snapshot_at,'finalized_at',m.finalized_at) order by m.created_at desc) from public.guild3_mission_participants mp join public.guild3_missions m on m.id=mp.mission_id where mp.student_id=p_student_id),'[]'::jsonb)
    ));
  end if;

  if v_section='SHARDS' then
    return jsonb_build_object('section','SHARDS','student',v_student,'data',jsonb_build_object(
      'owned_characters',coalesce((select jsonb_agg(jsonb_build_object('character_uid',c.character_uid,'name',c.name,'epithet',c.epithet,'acquired_at',sc.acquired_at,'acquired_via',sc.acquired_via) order by c.character_uid) from public.student_characters sc join public.characters c on c.id=sc.character_id where sc.student_id=p_student_id and sc.is_owned=true and sc.revoked_at is null),'[]'::jsonb),
      'completed_collections',coalesce((select jsonb_agg(jsonb_build_object('collection_uid',cc.collection_uid,'name',cc.name,'member_count',z.member_count) order by cc.collection_uid) from public.character_collections cc join lateral (select count(*)::integer member_count from public.character_collection_members cm where cm.collection_id=cc.id and cm.is_active=true) z on true where cc.classroom_id=v_classroom_id and cc.is_active=true and not exists (select 1 from public.character_collection_members cm where cm.collection_id=cc.id and cm.is_active=true and not exists (select 1 from public.student_characters sc where sc.student_id=p_student_id and sc.character_id=cm.character_id and sc.is_owned=true and sc.revoked_at is null))),'[]'::jsonb)
    ));
  end if;

  if v_section='DAILY' then
    return jsonb_build_object('section','DAILY','student',v_student,'data',jsonb_build_object(
      'attendance',coalesce((select jsonb_agg(jsonb_build_object('date',a.attendance_date,'status',a.status::text,'streak_days',a.streak_days,'record_source',a.record_source) order by a.attendance_date desc) from (select * from public.attendances where student_id=p_student_id order by attendance_date desc limit v_limit offset v_offset) a),'[]'::jsonb),
      'quest_checks',coalesce((select jsonb_agg(jsonb_build_object('quest_date',r.quest_date,'quest_code',q.quest_code,'result',q.result,'check_source',q.check_source,'job_name',q.job_name_snapshot,'assigned_area',q.assigned_area_snapshot,'checked_at',q.checked_at,'teacher_override',q.teacher_override) order by r.quest_date desc,q.quest_code) from public.daily_quest_checks q join public.daily_quest_reports r on r.id=q.report_id where q.student_id=p_student_id and q.id in (select id from public.daily_quest_checks where student_id=p_student_id order by checked_at desc limit v_limit offset v_offset)),'[]'::jsonb),
      'primary_jobs',coalesce((select jsonb_agg(jsonb_build_object('job_name',pj.job_name,'daily_wage',pj.daily_wage,'assigned_area',pj.assigned_area,'assigned_at',pj.assigned_at,'released_at',pj.released_at,'is_active',pj.is_active) order by pj.assigned_at desc) from public.primary_jobs pj where pj.student_id=p_student_id),'[]'::jsonb),
      'secondary_jobs',coalesce((select jsonb_agg(jsonb_build_object('job_name',sj.job_name,'approved_at',sj.approved_at,'released_at',sj.released_at,'is_active',sj.is_active,'tier_at_approval',sj.tier_at_approval) order by sj.approved_at desc) from public.secondary_jobs sj where sj.student_id=p_student_id),'[]'::jsonb)
    ));
  end if;

  if v_section='ACCESS' then
    return jsonb_build_object('section','ACCESS','student',v_student,'data',jsonb_build_object(
      'daily_access',coalesce((select jsonb_agg(jsonb_build_object('date',ad.access_date,'first_seen_at',ad.first_seen_at,'last_seen_at',ad.last_seen_at,'signal_count',ad.signal_count,'has_direct_app_signal',ad.has_direct_app_signal) order by ad.access_date desc) from (select * from public.app_access_daily where student_id=p_student_id order by access_date desc limit v_limit offset v_offset) ad),'[]'::jsonb),
      'login_events',coalesce((select jsonb_agg(jsonb_build_object('event_type',h.event_type,'occurred_at',h.occurred_at) order by h.occurred_at desc) from (select * from public.auth_login_history where student_id=p_student_id and event_type in ('LOGIN_SUCCESS','LOGOUT') order by occurred_at desc limit v_limit offset v_offset) h),'[]'::jsonb)
    ));
  end if;

  if v_section='DIMENSION' then
    return jsonb_build_object('section','DIMENSION','student',v_student,'data',jsonb_build_object(
      'relationships',coalesce((select jsonb_agg(jsonb_build_object('character_uid',c.character_uid,'character_name',c.name,'affinity',dr.affinity,'status',dr.status,'first_interacted_at',dr.first_interacted_at,'last_interacted_at',dr.last_interacted_at) order by c.character_uid) from public.dimensional_gate_relationships dr join public.characters c on c.id=dr.character_id where dr.student_id=p_student_id),'[]'::jsonb),
      'story_progress',coalesce((select jsonb_agg(jsonb_build_object('episode_id',sp.episode_id,'opened_at',sp.opened_at,'completed_at',sp.completed_at,'last_cut_order',sp.last_cut_order) order by sp.updated_at desc) from public.dimensional_gate_story_progress sp where sp.student_id=p_student_id),'[]'::jsonb),
      'reward_claims',coalesce((select jsonb_agg(jsonb_build_object('character_uid',c.character_uid,'character_name',c.name,'affinity_threshold',rc.affinity_threshold,'claimed_at',rc.claimed_at) order by rc.claimed_at desc) from public.dimensional_gate_reward_claims rc join public.characters c on c.id=rc.character_id where rc.student_id=p_student_id),'[]'::jsonb)
    ));
  end if;

  if v_section='ACHIEVEMENTS' then
    return jsonb_build_object('section','ACHIEVEMENTS','student',v_student,'data',jsonb_build_object(
      'earned',coalesce((select jsonb_agg(jsonb_build_object('achievement_uid',a.achievement_uid,'name',a.name,'grade',a.grade::text,'achieved_at',sa.achieved_at) order by sa.achieved_at desc) from public.student_achievements sa join public.achievements a on a.id=sa.achievement_id where sa.student_id=p_student_id and coalesce(sa.is_revoked,false)=false and (not a.is_hidden or a.revealed_at is not null)),'[]'::jsonb),
      'applications',coalesce((select jsonb_agg(jsonb_build_object('application_id',aa.id,'achievement_uid',a.achievement_uid,'name',a.name,'status',aa.status::text,'created_at',aa.created_at,'evaluated_at',aa.evaluated_at,'rejection_reason',aa.rejection_reason) order by aa.created_at desc) from public.achievement_applications aa join public.achievements a on a.id=aa.achievement_id where aa.student_id=p_student_id and aa.application_kind='NORMAL' and (not a.is_hidden or a.revealed_at is not null)),'[]'::jsonb),
      'monthly_mvp',coalesce((select jsonb_agg(jsonb_build_object('period_label',m.period_label,'month_no',m.month_no,'is_winner',m.winner_student_id=p_student_id) order by m.school_year desc,m.month_no desc) from public.records_monthly_mvp_archive m where m.winner_student_id=p_student_id),'[]'::jsonb)
    ));
  end if;

  raise exception 'Unsupported helper record section: %',v_section using errcode='22023';
end;
$$;
revoke all on function public.student_get_achievement_helper_student_record(integer,text,integer,integer) from public,anon;
grant execute on function public.student_get_achievement_helper_student_record(integer,text,integer,integer) to authenticated;

commit;
