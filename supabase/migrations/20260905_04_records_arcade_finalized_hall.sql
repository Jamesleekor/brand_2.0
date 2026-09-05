-- B.R.A.N.D 2.0 Records / Arcade FINALIZED Hall of Glory
-- 2026-09-05
--
-- Principles
-- - Only immutable MONTHLY FINALIZED Arcade snapshots may create Hall of Glory records.
-- - Historical student/game identity is snapshotted at finalization time.
-- - A game_id/code is one historical scoreboard. A fundamental rules/scoring redesign must use
--   a new game code (for example, takatuka2), which naturally creates a separate record board.
-- - Monthly champion is the single official rank=1 from the FINALIZED snapshot.
-- - All-time score ties are joint records even though monthly rank ordering itself uses row_number.
-- - Grand Slam is evaluated only when the official finalized month has exactly 6 eligible games.
-- - Throne time starts at the FINALIZED timestamp that establishes/ties the all-time high.
--   Self-improvement does not reset an existing reign. A tie adds a joint reign without ending
--   the prior holder. A higher finalized score ends all prior reigns. Game retirement ends reign.
--
-- Apply protocol:
-- READ-ONLY PREFLIGHT -> guard -> ROLLBACK REHEARSAL -> ONE-TIME APPLY -> STRICT POSTCHECK -> Auth E2E.

alter table public.arcade_monthly_snapshots
  add column if not exists game_code_at_close text,
  add column if not exists game_name_at_close text;

alter table public.arcade_monthly_snapshot_entries
  add column if not exists student_name_at_close text,
  add column if not exists brand_name_at_close text;

alter table public.arcade_monthly_snapshot_student_ranks
  add column if not exists student_name_at_close text,
  add column if not exists brand_name_at_close text;

comment on column public.arcade_monthly_snapshots.game_code_at_close is
  'Immutable game identity snapshot for cross-season historical records.';
comment on column public.arcade_monthly_snapshots.game_name_at_close is
  'Game name snapshot captured when the monthly Arcade snapshot is created.';
comment on column public.arcade_monthly_snapshot_entries.student_name_at_close is
  'Student display-name snapshot captured at monthly Arcade finalization.';
comment on column public.arcade_monthly_snapshot_entries.brand_name_at_close is
  'Student brand-name snapshot captured at monthly Arcade finalization.';

update public.arcade_monthly_snapshots snapshot
set game_code_at_close = coalesce(snapshot.game_code_at_close, game.code),
    game_name_at_close = coalesce(snapshot.game_name_at_close, game.internal_name)
from public.arcade_games game
where game.id = snapshot.game_id
  and (snapshot.game_code_at_close is null or snapshot.game_name_at_close is null);

update public.arcade_monthly_snapshot_entries entry
set student_name_at_close = coalesce(entry.student_name_at_close, student.name),
    brand_name_at_close = coalesce(entry.brand_name_at_close, student.brand_name)
from public.students student
where student.id = entry.student_id
  and (entry.student_name_at_close is null or entry.brand_name_at_close is null);

update public.arcade_monthly_snapshot_student_ranks rank_row
set student_name_at_close = coalesce(rank_row.student_name_at_close, student.name),
    brand_name_at_close = coalesce(rank_row.brand_name_at_close, student.brand_name)
from public.students student
where student.id = rank_row.student_id
  and (rank_row.student_name_at_close is null or rank_row.brand_name_at_close is null);

create or replace function public.records_arcade_snapshot_game_identity()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_code text;
  v_name text;
begin
  select game.code, game.internal_name
    into v_code, v_name
  from public.arcade_games game
  where game.id = new.game_id;

  if v_code is null then
    raise exception '[RECORDS] Arcade game identity missing for monthly snapshot.' using errcode='P0940';
  end if;

  new.game_code_at_close := coalesce(new.game_code_at_close, v_code);
  new.game_name_at_close := coalesce(new.game_name_at_close, v_name);
  return new;
end;
$$;

create or replace function public.records_arcade_snapshot_student_identity()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_name text;
  v_brand text;
begin
  select student.name, student.brand_name
    into v_name, v_brand
  from public.students student
  where student.id = new.student_id;

  if v_name is null then
    raise exception '[RECORDS] Arcade student identity missing for monthly snapshot.' using errcode='P0941';
  end if;

  new.student_name_at_close := coalesce(new.student_name_at_close, v_name);
  new.brand_name_at_close := coalesce(new.brand_name_at_close, v_brand);
  return new;
end;
$$;

revoke all on function public.records_arcade_snapshot_game_identity() from public, anon, authenticated;
revoke all on function public.records_arcade_snapshot_student_identity() from public, anon, authenticated;

drop trigger if exists records_arcade_snapshot_game_identity_bi on public.arcade_monthly_snapshots;
create trigger records_arcade_snapshot_game_identity_bi
before insert on public.arcade_monthly_snapshots
for each row execute function public.records_arcade_snapshot_game_identity();

drop trigger if exists records_arcade_snapshot_entry_identity_bi on public.arcade_monthly_snapshot_entries;
create trigger records_arcade_snapshot_entry_identity_bi
before insert on public.arcade_monthly_snapshot_entries
for each row execute function public.records_arcade_snapshot_student_identity();

drop trigger if exists records_arcade_snapshot_rank_identity_bi on public.arcade_monthly_snapshot_student_ranks;
create trigger records_arcade_snapshot_rank_identity_bi
before insert on public.arcade_monthly_snapshot_student_ranks
for each row execute function public.records_arcade_snapshot_student_identity();

create or replace function public.student_get_records_arcade_hall()
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_classroom_id integer := public.current_classroom_id();
  v_student_id integer := public.current_student_id();
  v_school_year integer;
  v_entries jsonb;
begin
  if auth.uid() is null or v_classroom_id is null or v_student_id is null then
    raise exception '[RECORDS] authenticated classroom member context is required.' using errcode='P0930';
  end if;

  select classroom.school_year
    into v_school_year
  from public.classrooms classroom
  where classroom.id = v_classroom_id;

  if v_school_year is null then
    raise exception '[RECORDS] classroom school year is required.' using errcode='P0931';
  end if;

  with finalized as (
    select
      finalization.id as finalization_id,
      finalization.period_id,
      finalization.contribution_year_month,
      finalization.eligible_game_count,
      finalization.finalized_at
    from public.arcade_monthly_finalizations finalization
    join public.arcade_ranking_periods period on period.id = finalization.period_id
    where finalization.classroom_id = v_classroom_id
      and period.classroom_id = v_classroom_id
      and period.period_kind = 'MONTHLY'
      and period.status = 'FINALIZED'
  ),
  snapshots as (
    select
      snapshot.id as snapshot_id,
      snapshot.finalization_id,
      snapshot.game_id,
      coalesce(snapshot.game_code_at_close, game.code) as game_code,
      coalesce(snapshot.game_name_at_close, game.internal_name) as game_name,
      game.available_until as game_available_until,
      finalized.contribution_year_month,
      finalized.eligible_game_count,
      finalized.finalized_at
    from public.arcade_monthly_snapshots snapshot
    join finalized on finalized.finalization_id = snapshot.finalization_id
    join public.arcade_games game on game.id = snapshot.game_id
    where snapshot.classroom_id = v_classroom_id
  ),
  scores as (
    select
      snapshot.snapshot_id,
      snapshot.finalization_id,
      snapshot.game_id,
      snapshot.game_code,
      snapshot.game_name,
      snapshot.game_available_until,
      snapshot.contribution_year_month,
      snapshot.eligible_game_count,
      snapshot.finalized_at,
      entry.student_id,
      coalesce(entry.student_name_at_close, student.name, '알 수 없는 학생') as student_name,
      coalesce(entry.brand_name_at_close, student.brand_name) as brand_name,
      entry.rank,
      entry.official_score,
      entry.achieved_at
    from snapshots snapshot
    join public.arcade_monthly_snapshot_entries entry on entry.snapshot_id = snapshot.snapshot_id
    left join public.students student on student.id = entry.student_id
  ),
  champions as (
    select * from scores where rank = 1
  ),
  first_champions as (
    select distinct on (champion.game_id)
      champion.*
    from champions champion
    order by champion.game_id, champion.finalized_at, champion.snapshot_id
  ),
  game_max as (
    select game_id, max(official_score) as max_score
    from scores
    group by game_id
  ),
  high_holders as (
    select distinct on (score.game_id, score.student_id)
      score.*
    from scores score
    join game_max maximum
      on maximum.game_id = score.game_id
     and maximum.max_score = score.official_score
    order by score.game_id, score.student_id, score.finalized_at, score.achieved_at, score.snapshot_id
  ),
  champion_counts as (
    select
      champion.game_id,
      champion.game_code,
      champion.game_name,
      champion.student_id,
      min(champion.student_name) as student_name,
      min(champion.brand_name) as brand_name,
      count(*)::integer as win_count,
      min(champion.finalized_at) as first_win_finalized_at
    from champions champion
    group by champion.game_id, champion.game_code, champion.game_name, champion.student_id
  ),
  max_champion_count as (
    select max(win_count) as max_wins from champion_counts
  ),
  champion_count_leaders as (
    select count_row.*
    from champion_counts count_row
    cross join max_champion_count maximum
    where count_row.win_count = maximum.max_wins
  ),
  different_game_counts as (
    select
      champion.student_id,
      min(champion.student_name) as student_name,
      min(champion.brand_name) as brand_name,
      count(distinct champion.game_id)::integer as game_count,
      min(champion.finalized_at) as first_win_finalized_at
    from champions champion
    group by champion.student_id
  ),
  max_different_game_count as (
    select max(game_count) as max_games from different_game_counts
  ),
  different_game_leaders as (
    select count_row.*
    from different_game_counts count_row
    cross join max_different_game_count maximum
    where count_row.game_count = maximum.max_games
  ),
  grand_slammers as (
    select
      finalized.finalization_id,
      finalized.contribution_year_month,
      finalized.finalized_at,
      score.student_id,
      min(score.student_name) as student_name,
      min(score.brand_name) as brand_name,
      count(distinct score.game_id)::integer as top3_game_count
    from finalized
    join snapshots snapshot on snapshot.finalization_id = finalized.finalization_id
    join scores score
      on score.snapshot_id = snapshot.snapshot_id
     and score.rank <= 3
    where finalized.eligible_game_count = 6
    group by finalized.finalization_id, finalized.contribution_year_month, finalized.finalized_at, score.student_id
    having count(distinct score.game_id) = 6
  ),
  game_events as (
    select
      snapshot.*,
      row_number() over (
        partition by snapshot.game_id
        order by snapshot.finalized_at, snapshot.finalization_id, snapshot.snapshot_id
      )::integer as event_no,
      case
        when snapshot.game_available_until is null then null::timestamptz
        else ((snapshot.game_available_until + 1)::timestamp at time zone 'Asia/Seoul')
      end as retired_at
    from snapshots snapshot
  ),
  game_students as (
    select distinct on (score.game_id, score.student_id)
      score.game_id,
      score.student_id,
      score.student_name,
      score.brand_name
    from scores score
    order by score.game_id, score.student_id, score.finalized_at, score.achieved_at, score.snapshot_id
  ),
  holder_scores as (
    select
      event.game_id,
      event.game_code,
      event.game_name,
      event.event_no,
      event.finalized_at,
      event.retired_at,
      game_student.student_id,
      game_student.student_name,
      game_student.brand_name,
      (
        select max(student_score.official_score)
        from scores student_score
        where student_score.game_id = event.game_id
          and student_score.student_id = game_student.student_id
          and student_score.finalized_at <= event.finalized_at
      ) as student_best,
      (
        select max(global_score.official_score)
        from scores global_score
        where global_score.game_id = event.game_id
          and global_score.finalized_at <= event.finalized_at
      ) as global_best
    from game_events event
    join game_students game_student on game_student.game_id = event.game_id
  ),
  holder_state as (
    select
      holder_score.*,
      (holder_score.student_best is not null and holder_score.student_best = holder_score.global_best) as is_holder
    from holder_scores holder_score
  ),
  holder_with_prev as (
    select
      holder_state.*,
      lag(holder_state.is_holder, 1, false) over (
        partition by holder_state.game_id, holder_state.student_id
        order by holder_state.event_no
      ) as was_holder
    from holder_state
  ),
  reign_starts as (
    select *
    from holder_with_prev
    where is_holder and not was_holder
  ),
  reigns as (
    select
      reign_start.*,
      coalesce(
        (
          select min(later.finalized_at)
          from holder_with_prev later
          where later.game_id = reign_start.game_id
            and later.student_id = reign_start.student_id
            and later.event_no > reign_start.event_no
            and not later.is_holder
        ),
        case
          when reign_start.retired_at is not null and reign_start.retired_at < now() then reign_start.retired_at
          else now()
        end
      ) as ended_at
    from reign_starts reign_start
  ),
  reign_durations as (
    select
      reign.*,
      greatest(0::numeric, extract(epoch from (reign.ended_at - reign.finalized_at))::numeric) as duration_seconds
    from reigns reign
  ),
  max_reign_duration as (
    select max(duration_seconds) as max_seconds from reign_durations
  ),
  longest_reigns as (
    select reign.*
    from reign_durations reign
    cross join max_reign_duration maximum
    where reign.duration_seconds = maximum.max_seconds
  ),
  generated as (
    -- Pioneers: first official monthly champion for each game.
    select
      'ARCADE_FIRST_CHAMPION_' || first_champion.game_code as record_key,
      'PIONEERS'::text as hall_key,
      'FIRST_ARCADE_MONTHLY_CHAMPION__' || first_champion.game_code as record_type,
      '최초 월간 챔피언 · ' || first_champion.game_name as title,
      first_champion.contribution_year_month as subtitle,
      null::text as description,
      'STUDENT'::text as subject_kind,
      first_champion.student_name::text as subject_display_name,
      first_champion.brand_name::text as subject_brand_name,
      v_school_year as school_year,
      null::text as season_label,
      first_champion.contribution_year_month::text as period_label,
      (first_champion.finalized_at at time zone 'Asia/Seoul')::date as occurred_on,
      1::integer as rank_position,
      first_champion.official_score::numeric as value_primary,
      null::numeric as value_secondary,
      null::numeric as denominator,
      '점'::text as unit,
      first_champion.official_score::numeric as comparison_value,
      'PRODUCTION_SNAPSHOT'::text as source_kind,
      jsonb_build_object(
        'game_id', first_champion.game_id,
        'game_code', first_champion.game_code,
        'game_name', first_champion.game_name,
        'finalized_at', first_champion.finalized_at,
        'achieved_at', first_champion.achieved_at
      ) as metadata,
      (200 + first_champion.game_id)::integer as sort_order
    from first_champions first_champion

    union all

    -- Arcade rulers: per-game all-time high score, with joint holders on exact score ties.
    select
      'ARCADE_HIGH_' || high_holder.game_code || '_' || high_holder.student_id::text,
      'ARCADE_RULERS',
      'ALL_TIME_HIGH_SCORE__' || high_holder.game_code,
      high_holder.game_name || ' 역대 최고 점수',
      high_holder.contribution_year_month,
      null,
      'STUDENT',
      high_holder.student_name,
      high_holder.brand_name,
      v_school_year,
      null,
      high_holder.contribution_year_month,
      (high_holder.finalized_at at time zone 'Asia/Seoul')::date,
      1,
      high_holder.official_score::numeric,
      null,
      null,
      '점',
      high_holder.official_score::numeric,
      'PRODUCTION_DERIVED',
      jsonb_build_object(
        'game_id', high_holder.game_id,
        'game_code', high_holder.game_code,
        'game_name', high_holder.game_name,
        'record_first_finalized_at', high_holder.finalized_at,
        'record_achieved_at', high_holder.achieved_at,
        'joint_record', (select count(*) > 1 from high_holders tied where tied.game_id = high_holder.game_id)
      ),
      (10 + high_holder.game_id)::integer
    from high_holders high_holder

    union all

    -- Most monthly wins accumulated in a single game.
    select
      'ARCADE_MOST_WINS_ONE_GAME_' || leader.game_id::text || '_' || leader.student_id::text,
      'ARCADE_RULERS',
      'MOST_MONTHLY_WINS_ONE_GAME',
      '한 게임 최다 월간 우승',
      leader.game_name,
      null,
      'STUDENT',
      leader.student_name,
      leader.brand_name,
      v_school_year,
      null,
      leader.game_name,
      (leader.first_win_finalized_at at time zone 'Asia/Seoul')::date,
      1,
      leader.win_count::numeric,
      null,
      null,
      '회',
      leader.win_count::numeric,
      'PRODUCTION_DERIVED',
      jsonb_build_object('game_id',leader.game_id,'game_code',leader.game_code,'game_name',leader.game_name),
      100
    from champion_count_leaders leader

    union all

    -- Most distinct games with at least one monthly championship.
    select
      'ARCADE_MOST_GAMES_WON_' || leader.student_id::text,
      'ARCADE_RULERS',
      'MOST_DIFFERENT_GAMES_WON',
      '서로 다른 게임 최다 우승',
      null,
      null,
      'STUDENT',
      leader.student_name,
      leader.brand_name,
      v_school_year,
      null,
      null,
      (leader.first_win_finalized_at at time zone 'Asia/Seoul')::date,
      1,
      leader.game_count::numeric,
      null,
      null,
      '종',
      leader.game_count::numeric,
      'PRODUCTION_DERIVED',
      '{}'::jsonb,
      110
    from different_game_leaders leader

    union all

    -- Grand Slam honor roll: exactly 6 eligible games and TOP3 in all six in the same finalized month.
    select
      'ARCADE_GRAND_SLAM_' || replace(grand_slammer.contribution_year_month,'-','') || '_' || grand_slammer.student_id::text,
      'ARCADE_RULERS',
      'GRAND_SLAMMER__' || replace(grand_slammer.contribution_year_month,'-','_'),
      '그랜드 슬래머',
      grand_slammer.contribution_year_month || ' · 6종 전체 TOP3',
      null,
      'STUDENT',
      grand_slammer.student_name,
      grand_slammer.brand_name,
      v_school_year,
      null,
      grand_slammer.contribution_year_month,
      (grand_slammer.finalized_at at time zone 'Asia/Seoul')::date,
      1,
      6::numeric,
      null,
      6::numeric,
      '게임',
      100::numeric,
      'PRODUCTION_SNAPSHOT',
      jsonb_build_object('finalization_id',grand_slammer.finalization_id,'finalized_at',grand_slammer.finalized_at),
      120
    from grand_slammers grand_slammer

    union all

    -- Single longest throne across every Arcade game.
    select
      'ARCADE_LONGEST_THRONE_' || longest_reign.game_id::text || '_' || longest_reign.student_id::text || '_' || longest_reign.event_no::text,
      'ARCADE_RULERS',
      'LONGEST_OVERALL_THRONE',
      '최장 아케이드 왕좌',
      longest_reign.game_name,
      null,
      'STUDENT',
      longest_reign.student_name,
      longest_reign.brand_name,
      v_school_year,
      null,
      longest_reign.game_name,
      (longest_reign.finalized_at at time zone 'Asia/Seoul')::date,
      1,
      round(longest_reign.duration_seconds / 86400::numeric, 2),
      longest_reign.student_best::numeric,
      null,
      '일',
      longest_reign.duration_seconds,
      'PRODUCTION_DERIVED',
      jsonb_build_object(
        'game_id',longest_reign.game_id,
        'game_code',longest_reign.game_code,
        'game_name',longest_reign.game_name,
        'started_at',longest_reign.finalized_at,
        'ended_at',longest_reign.ended_at,
        'starting_record_score',longest_reign.student_best,
        'ongoing', longest_reign.ended_at >= now() - interval '1 second'
      ),
      130
    from longest_reigns longest_reign
  ),
  numbered as (
    select
      (-10000000 - row_number() over (order by generated.hall_key, generated.sort_order, generated.record_type, generated.record_key))::bigint as id,
      generated.*
    from generated
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', numbered.id,
        'record_key', numbered.record_key,
        'hall_key', numbered.hall_key,
        'record_type', numbered.record_type,
        'title', numbered.title,
        'subtitle', numbered.subtitle,
        'description', numbered.description,
        'subject_kind', numbered.subject_kind,
        'subject_display_name', numbered.subject_display_name,
        'subject_brand_name', numbered.subject_brand_name,
        'school_year', numbered.school_year,
        'season_label', numbered.season_label,
        'period_label', numbered.period_label,
        'occurred_on', numbered.occurred_on,
        'rank_position', numbered.rank_position,
        'value_primary', numbered.value_primary,
        'value_secondary', numbered.value_secondary,
        'denominator', numbered.denominator,
        'unit', numbered.unit,
        'comparison_value', numbered.comparison_value,
        'source_kind', numbered.source_kind,
        'metadata', numbered.metadata,
        'sort_order', numbered.sort_order
      )
      order by numbered.hall_key, numbered.sort_order, numbered.record_type, numbered.rank_position nulls last, numbered.record_key
    ),
    '[]'::jsonb
  ) into v_entries
  from numbered;

  return jsonb_build_object('entries', v_entries);
end;
$$;

revoke all on function public.student_get_records_arcade_hall() from public;
revoke all on function public.student_get_records_arcade_hall() from anon;
grant execute on function public.student_get_records_arcade_hall() to authenticated;
