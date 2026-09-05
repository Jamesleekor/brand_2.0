-- Records: permanent auto-claim for the four currently unclaimed milestone thrones.
--
-- Principles
-- 1) These are FIRST milestones, not current-leader records.
-- 2) Once legitimately claimed, later balance/count changes do not remove the historical claim.
-- 3) GOLD claims sourced from a transaction are repaired only when that exact source transaction is reversed.
-- 4) MVP identity never merges people across eras by display name alone.
-- 5) Student-facing RPCs never expose the internal MVP identity key.

-- ---------------------------------------------------------------------------
-- MVP identity snapshot
-- ---------------------------------------------------------------------------

create or replace function public.records_prepare_monthly_mvp_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_match_count integer;
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb);

  if nullif(new.metadata->>'winner_identity_key','') is not null then
    return new;
  end if;

  if new.winner_student_id is not null then
    select s.id, s.classroom_id
      into v_student_id, v_classroom_id
    from public.students s
    where s.id = new.winner_student_id
      and public.is_official_participant(s.id);

    if v_student_id is not null then
      new.metadata := new.metadata || jsonb_build_object(
        'winner_identity_key', format('CLASSROOM:%s:STUDENT:%s', v_classroom_id, v_student_id),
        'winner_identity_source', 'STUDENT_ID',
        'winner_student_id_snapshot', v_student_id,
        'winner_classroom_id_snapshot', v_classroom_id
      );
      return new;
    end if;
  end if;

  -- Safe fallback for current/future archives: resolve only when exactly one
  -- official student with this name exists among classrooms of that school year.
  select count(*), min(s.id), min(s.classroom_id)
    into v_match_count, v_student_id, v_classroom_id
  from public.students s
  join public.classrooms c on c.id = s.classroom_id
  where c.school_year = new.school_year
    and s.name = new.winner_display_name
    and public.is_official_participant(s.id);

  if v_match_count = 1 then
    new.metadata := new.metadata || jsonb_build_object(
      'winner_identity_key', format('CLASSROOM:%s:STUDENT:%s', v_classroom_id, v_student_id),
      'winner_identity_source', 'UNIQUE_SCHOOL_YEAR_NAME_RESOLUTION',
      'winner_student_id_snapshot', v_student_id,
      'winner_classroom_id_snapshot', v_classroom_id
    );
  elsif new.school_year = 2023 then
    -- 2023 is a curated single-era archive. Keep it explicitly year-scoped so
    -- a same-named person in another era can never be merged with it.
    new.metadata := new.metadata || jsonb_build_object(
      'winner_identity_key', format('CURATED:2023:%s', new.winner_display_name),
      'winner_identity_source', 'CURATED_2023_YEAR_SCOPED_NAME'
    );
  else
    new.metadata := new.metadata || jsonb_build_object(
      'winner_identity_source', 'UNRESOLVED'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.records_prepare_monthly_mvp_identity() from public, anon, authenticated;

-- Backfill identity metadata without restoring the deliberately-null public FK.
update public.records_monthly_mvp_archive m
set metadata = coalesce(m.metadata, '{}'::jsonb) || jsonb_build_object(
      'winner_identity_key', format('CURATED:2023:%s', m.winner_display_name),
      'winner_identity_source', 'CURATED_2023_YEAR_SCOPED_NAME'
    ),
    updated_at = now()
where m.school_year = 2023
  and m.status = 'ACTIVE'
  and nullif(m.metadata->>'winner_identity_key','') is null;

with resolved as (
  select m.id,
         min(s.id) as student_id,
         min(s.classroom_id) as classroom_id,
         count(*) as match_count
  from public.records_monthly_mvp_archive m
  join public.classrooms c on c.school_year = m.school_year
  join public.students s on s.classroom_id = c.id
                        and s.name = m.winner_display_name
  where m.school_year >= 2026
    and m.status = 'ACTIVE'
    and public.is_official_participant(s.id)
    and nullif(m.metadata->>'winner_identity_key','') is null
  group by m.id
)
update public.records_monthly_mvp_archive m
set metadata = coalesce(m.metadata, '{}'::jsonb) || jsonb_build_object(
      'winner_identity_key', format('CLASSROOM:%s:STUDENT:%s', r.classroom_id, r.student_id),
      'winner_identity_source', 'UNIQUE_SCHOOL_YEAR_NAME_RESOLUTION',
      'winner_student_id_snapshot', r.student_id,
      'winner_classroom_id_snapshot', r.classroom_id
    ),
    updated_at = now()
from resolved r
where r.id = m.id
  and r.match_count = 1;

-- ---------------------------------------------------------------------------
-- Claim helper
-- ---------------------------------------------------------------------------

create or replace function public.records_claim_empty_throne(
  p_record_key text,
  p_student_id integer,
  p_display_name text,
  p_brand_name text,
  p_school_year integer,
  p_period_label text,
  p_occurred_on date,
  p_value_primary numeric,
  p_denominator numeric,
  p_comparison_value numeric,
  p_source_ref text,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if p_student_id is null or coalesce(btrim(p_display_name),'') = '' then
    return false;
  end if;

  update public.records_historical_entries h
  set subject_kind = 'STUDENT',
      subject_display_name = p_display_name,
      subject_brand_name = p_brand_name,
      subject_student_id = p_student_id,
      school_year = p_school_year,
      period_label = p_period_label,
      occurred_on = p_occurred_on,
      value_primary = p_value_primary,
      denominator = p_denominator,
      comparison_value = p_comparison_value,
      source_kind = 'PRODUCTION_SNAPSHOT',
      source_ref = p_source_ref,
      metadata = (coalesce(h.metadata,'{}'::jsonb) - 'unclaimed')
        || jsonb_build_object(
          'auto_claimed', true,
          'auto_claim_version', 'RECORDS_EMPTY_THRONE_V1',
          'claimed_at', clock_timestamp(),
          'official_participant', true
        )
        || coalesce(p_metadata,'{}'::jsonb),
      updated_at = now()
  where h.record_key = p_record_key
    and h.status = 'ACTIVE'
    and h.subject_kind = 'EMPTY_THRONE';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.records_claim_empty_throne(text,integer,text,text,integer,text,date,numeric,numeric,numeric,text,jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Synchronize the four first-milestone thrones
-- ---------------------------------------------------------------------------

create or replace function public.records_sync_empty_thrones()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed text[] := array[]::text[];
  v_student_id integer;
  v_display_name text;
  v_brand_name text;
  v_school_year integer;
  v_classroom_id integer;
  v_occurred_at timestamptz;
  v_value numeric;
  v_source_ref text;
  v_source_transaction_id bigint;
  v_catalog_count integer;
  v_valid_count integer;
  v_required_count integer;
  v_rate numeric;
  v_period_label text;
  v_mvp_archive_id bigint;
  v_identity_key text;
  v_existing record;
begin
  -- Serialize claim decisions without blocking unrelated application work.
  perform pg_advisory_xact_lock(hashtext('RECORDS_EMPTY_THRONE_V1'));

  -- -----------------------------------------------------------------------
  -- GOLD 100,000: first official non-reversed historical balance >= threshold.
  -- A direct wallet state is a fallback for teacher/admin adjustments without a
  -- transaction row. Normal later spending does not invalidate the milestone.
  -- -----------------------------------------------------------------------

  select h.* into v_existing
  from public.records_historical_entries h
  where h.record_key = 'PIONEER_FIRST_GOLD_100000_EMPTY'
    and h.status = 'ACTIVE'
  for update;

  -- If the exact transaction that created an automatic GOLD claim is later
  -- reversed, restore only this auto-claimed throne and recompute below.
  if v_existing.subject_kind = 'STUDENT'
     and coalesce((v_existing.metadata->>'auto_claimed')::boolean,false)
     and nullif(v_existing.metadata->>'source_transaction_id','') is not null then
    select t.is_reversed
      into strict v_rate
    from public.transactions t
    where t.id = (v_existing.metadata->>'source_transaction_id')::bigint;

    if v_rate::boolean then
      update public.records_historical_entries h
      set subject_kind = 'EMPTY_THRONE',
          subject_display_name = '아직 주인이 없는 자리',
          subject_brand_name = null,
          subject_student_id = null,
          school_year = null,
          period_label = null,
          occurred_on = null,
          value_primary = 100000,
          denominator = null,
          comparison_value = 100000,
          source_kind = 'CURATED',
          source_ref = null,
          metadata = jsonb_build_object('unclaimed',true,'restored_after_reversed_source',true),
          updated_at = now()
      where h.id = v_existing.id;
      v_existing.subject_kind := 'EMPTY_THRONE';
    end if;
  end if;

  if v_existing.subject_kind = 'EMPTY_THRONE' then
    with official_students as (
      select s.id, s.name, s.brand_name, s.classroom_id, c.school_year
      from public.students s
      join public.classrooms c on c.id = s.classroom_id
      where public.is_official_participant(s.id)
    ), candidates as (
      select l.student_id,
             coalesce(l.occurred_at, l.event_date::timestamp at time zone 'Asia/Seoul') as occurred_at,
             l.balance_after_gold::numeric as balance_after,
             format('legacy_asset_history:%s', l.id) as source_ref,
             null::bigint as source_transaction_id,
             10 as source_priority,
             l.id::bigint as source_id
      from public.legacy_asset_history l
      join official_students o on o.id = l.student_id
      where l.balance_after_gold >= 100000

      union all

      select t.student_id,
             t.created_at,
             t.balance_after::numeric,
             format('transactions:%s', t.id),
             t.id,
             20,
             t.id
      from public.transactions t
      join official_students o on o.id = t.student_id
      where t.value_token = 'GOLD'
        and not t.is_reversed
        and t.balance_after >= 100000

      union all

      select w.student_id,
             w.updated_at,
             w.gold::numeric,
             format('wallets:%s', w.id),
             null::bigint,
             30,
             w.id::bigint
      from public.wallets w
      join official_students o on o.id = w.student_id
      where w.gold >= 100000
    )
    select o.id, o.name, o.brand_name, o.school_year, o.classroom_id,
           c.occurred_at, c.balance_after, c.source_ref, c.source_transaction_id
      into v_student_id, v_display_name, v_brand_name, v_school_year, v_classroom_id,
           v_occurred_at, v_value, v_source_ref, v_source_transaction_id
    from candidates c
    join official_students o on o.id = c.student_id
    order by c.occurred_at asc nulls last, c.source_priority asc, c.source_id asc
    limit 1;

    if v_student_id is not null and public.records_claim_empty_throne(
      'PIONEER_FIRST_GOLD_100000_EMPTY',
      v_student_id, v_display_name, v_brand_name, v_school_year,
      coalesce(v_school_year::text || '년', null),
      (v_occurred_at at time zone 'Asia/Seoul')::date,
      100000, null, 100000, v_source_ref,
      jsonb_build_object(
        'milestone_threshold',100000,
        'actual_balance_at_claim',v_value,
        'source_transaction_id',v_source_transaction_id,
        'classroom_id_snapshot',v_classroom_id
      )
    ) then
      v_claimed := array_append(v_claimed,'PIONEER_FIRST_GOLD_100000_EMPTY');
    end if;
  end if;

  -- -----------------------------------------------------------------------
  -- First 100 valid achievements.
  -- -----------------------------------------------------------------------

  if exists (
    select 1 from public.records_historical_entries
    where record_key='PIONEER_FIRST_ACHIEVEMENT_100_EMPTY'
      and status='ACTIVE' and subject_kind='EMPTY_THRONE'
  ) then
    with valid_awards as (
      select sa.student_id, sa.achieved_at,
             row_number() over(partition by sa.student_id order by sa.achieved_at, sa.id) as rn
      from public.student_achievements sa
      join public.students s on s.id=sa.student_id
      where not sa.is_revoked
        and public.is_official_participant(sa.student_id)
    ), hundredth as (
      select v.student_id, v.achieved_at
      from valid_awards v
      where v.rn=100
    )
    select s.id,s.name,s.brand_name,c.school_year,s.classroom_id,h.achieved_at
      into v_student_id,v_display_name,v_brand_name,v_school_year,v_classroom_id,v_occurred_at
    from hundredth h
    join public.students s on s.id=h.student_id
    join public.classrooms c on c.id=s.classroom_id
    order by h.achieved_at, h.student_id
    limit 1;

    if v_student_id is not null and public.records_claim_empty_throne(
      'PIONEER_FIRST_ACHIEVEMENT_100_EMPTY',
      v_student_id,v_display_name,v_brand_name,v_school_year,
      v_school_year::text || '년',
      (v_occurred_at at time zone 'Asia/Seoul')::date,
      100,null,100,
      format('student_achievements:student:%s:100th',v_student_id),
      jsonb_build_object('milestone_threshold',100,'classroom_id_snapshot',v_classroom_id)
    ) then
      v_claimed := array_append(v_claimed,'PIONEER_FIRST_ACHIEVEMENT_100_EMPTY');
    end if;
  end if;

  -- -----------------------------------------------------------------------
  -- First 90% of the ACTIVE classroom achievement catalog.
  -- Current rule: active, non-revoked awards / active classroom catalog.
  -- Once observed, the historical first milestone is frozen.
  -- -----------------------------------------------------------------------

  if exists (
    select 1 from public.records_historical_entries
    where record_key='PIONEER_FIRST_ACHIEVEMENT_90_EMPTY'
      and status='ACTIVE' and subject_kind='EMPTY_THRONE'
  ) then
    with classroom_catalog as (
      select c.id as classroom_id,c.school_year,
             count(a.id) filter(where a.is_active)::integer as catalog_count
      from public.classrooms c
      left join public.achievements a on a.classroom_id=c.id
      group by c.id,c.school_year
    ), student_counts as (
      select s.id as student_id,s.classroom_id,s.name,s.brand_name,
             cc.school_year,cc.catalog_count,
             count(sa.id) filter(where not sa.is_revoked and a.is_active)::integer as valid_count
      from public.students s
      join classroom_catalog cc on cc.classroom_id=s.classroom_id
      left join public.student_achievements sa on sa.student_id=s.id and sa.classroom_id=s.classroom_id
      left join public.achievements a on a.id=sa.achievement_id and a.classroom_id=s.classroom_id
      where public.is_official_participant(s.id)
      group by s.id,s.classroom_id,s.name,s.brand_name,cc.school_year,cc.catalog_count
    )
    select sc.student_id,sc.name,sc.brand_name,sc.school_year,sc.classroom_id,
           sc.catalog_count,sc.valid_count,
           ceil(sc.catalog_count * 0.90)::integer,
           round(100.0 * sc.valid_count / nullif(sc.catalog_count,0),8)
      into v_student_id,v_display_name,v_brand_name,v_school_year,v_classroom_id,
           v_catalog_count,v_valid_count,v_required_count,v_rate
    from student_counts sc
    where sc.catalog_count > 0
      and sc.valid_count * 100 >= sc.catalog_count * 90
    order by sc.valid_count::numeric / sc.catalog_count desc, sc.student_id
    limit 1;

    if v_student_id is not null and public.records_claim_empty_throne(
      'PIONEER_FIRST_ACHIEVEMENT_90_EMPTY',
      v_student_id,v_display_name,v_brand_name,v_school_year,
      v_school_year::text || '년',
      (clock_timestamp() at time zone 'Asia/Seoul')::date,
      v_valid_count,v_catalog_count,v_rate,
      format('achievement_catalog:%s:student:%s',v_classroom_id,v_student_id),
      jsonb_build_object(
        'milestone_threshold_percent',90,
        'active_catalog_count_at_claim',v_catalog_count,
        'required_count_at_claim',v_required_count,
        'valid_active_count_at_claim',v_valid_count,
        'rate_percent_at_claim',v_rate,
        'classroom_id_snapshot',v_classroom_id
      )
    ) then
      v_claimed := array_append(v_claimed,'PIONEER_FIRST_ACHIEVEMENT_90_EMPTY');
    end if;
  end if;

  -- -----------------------------------------------------------------------
  -- First three MONTHLY MVP wins. Identity is an internal snapshot key.
  -- The third win itself determines the historical claim date.
  -- -----------------------------------------------------------------------

  if exists (
    select 1 from public.records_historical_entries
    where record_key='CROWN_MVP_FIRST_3_EMPTY'
      and status='ACTIVE' and subject_kind='EMPTY_THRONE'
  ) then
    with ordered_wins as (
      select m.id,m.school_year,m.month_no,m.period_label,m.winner_display_name,
             nullif(m.metadata->>'winner_identity_key','') as identity_key,
             nullif(m.metadata->>'winner_student_id_snapshot','')::integer as student_id_snapshot,
             nullif(m.metadata->>'winner_classroom_id_snapshot','')::integer as classroom_id_snapshot,
             row_number() over(
               partition by nullif(m.metadata->>'winner_identity_key','')
               order by m.school_year,m.month_no,m.id
             ) as win_no
      from public.records_monthly_mvp_archive m
      where m.status='ACTIVE'
        and nullif(m.metadata->>'winner_identity_key','') is not null
    ), third_wins as (
      select * from ordered_wins where win_no=3 and student_id_snapshot is not null
    )
    select tw.id,tw.identity_key,tw.student_id_snapshot,s.name,s.brand_name,
           tw.school_year,tw.classroom_id_snapshot,tw.period_label
      into v_mvp_archive_id,v_identity_key,v_student_id,v_display_name,v_brand_name,
           v_school_year,v_classroom_id,v_period_label
    from third_wins tw
    join public.students s on s.id=tw.student_id_snapshot
    order by tw.school_year,tw.month_no,tw.id
    limit 1;

    if v_student_id is not null and public.records_claim_empty_throne(
      'CROWN_MVP_FIRST_3_EMPTY',
      v_student_id,v_display_name,v_brand_name,v_school_year,
      v_period_label,
      ((make_date(v_school_year, split_part(v_period_label,'-',2)::integer,1) + interval '1 month - 1 day')::date),
      3,null,3,
      format('records_monthly_mvp_archive:%s',v_mvp_archive_id),
      jsonb_build_object(
        'milestone_threshold',3,
        'winner_identity_key',v_identity_key,
        'third_win_archive_id',v_mvp_archive_id,
        'classroom_id_snapshot',v_classroom_id
      )
    ) then
      v_claimed := array_append(v_claimed,'CROWN_MVP_FIRST_3_EMPTY');
    end if;
  end if;

  return jsonb_build_object(
    'claimed', to_jsonb(v_claimed),
    'claimed_count', cardinality(v_claimed)
  );
end;
$$;

revoke all on function public.records_sync_empty_thrones() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trigger adapter
-- ---------------------------------------------------------------------------

create or replace function public.records_empty_throne_source_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.records_sync_empty_thrones();
  return coalesce(new, old);
end;
$$;

revoke all on function public.records_empty_throne_source_trigger() from public, anon, authenticated;

-- Normalize MVP identity before the after-trigger evaluates three-time winners.
drop trigger if exists trg_records_prepare_mvp_identity on public.records_monthly_mvp_archive;
create trigger trg_records_prepare_mvp_identity
before insert or update on public.records_monthly_mvp_archive
for each row execute function public.records_prepare_monthly_mvp_identity();

drop trigger if exists trg_records_empty_throne_transactions on public.transactions;
create trigger trg_records_empty_throne_transactions
after insert or update on public.transactions
for each statement execute function public.records_empty_throne_source_trigger();

drop trigger if exists trg_records_empty_throne_wallets on public.wallets;
create trigger trg_records_empty_throne_wallets
after insert or update on public.wallets
for each statement execute function public.records_empty_throne_source_trigger();

drop trigger if exists trg_records_empty_throne_student_achievements on public.student_achievements;
create trigger trg_records_empty_throne_student_achievements
after insert or update or delete on public.student_achievements
for each statement execute function public.records_empty_throne_source_trigger();

drop trigger if exists trg_records_empty_throne_achievements on public.achievements;
create trigger trg_records_empty_throne_achievements
after insert or update or delete on public.achievements
for each statement execute function public.records_empty_throne_source_trigger();

drop trigger if exists trg_records_empty_throne_mvp_archive on public.records_monthly_mvp_archive;
create trigger trg_records_empty_throne_mvp_archive
after insert or update or delete on public.records_monthly_mvp_archive
for each statement execute function public.records_empty_throne_source_trigger();

-- One-time initial synchronization. Current Production is expected to claim zero.
select public.records_sync_empty_thrones();
