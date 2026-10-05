-- B.R.A.N.D 2.0 Fragment Expedition E2 seed v1.4

insert into public.expedition_settings(
  classroom_id,schema_version,is_core_enabled,is_student_ui_enabled,is_scheduler_enabled,is_reward_grant_enabled,
  publish_weekday,publish_time_kst,sat_open_time_kst,sun_open_time_kst,settle_time_kst,
  world_effect_start_time_kst,world_effect_duration_hours,world_trace_lv1,world_trace_lv2,world_trace_lv3,
  map_mastery_threshold,story_trace_faint,story_trace_discovery,story_trace_active,story_trace_breakthrough,
  reward_config,world_effect_config
)
select c.id,'EXPEDITION_V1_4',false,false,false,false,5,time '17:00',time '00:00',time '00:00',time '00:05',
       time '06:00',168,12,24,40,24,1,5,10,18,
       jsonb_build_object('reward_mode','DRY_RUN','reward_snapshot_stage','E3'),
       jsonb_build_object('duration_hours',168,'activation_time_kst','06:00','activation_weekday','MONDAY')
from public.classrooms c where c.is_active=true
on conflict(classroom_id) do nothing;

insert into public.expedition_seasons(classroom_id,season_code,name_ko,starts_on,ends_on,status,config_version)
select c.id,'EXPEDITION_2026','2026 편린 원정',date '2026-10-05',date '2027-02-28','ACTIVE','EXPEDITION_V1_4'
from public.classrooms c where c.is_active=true and c.school_year=2026
on conflict(classroom_id,season_code) do update
set name_ko=excluded.name_ko,starts_on=excluded.starts_on,ends_on=excluded.ends_on,config_version=excluded.config_version,
    status=case when public.expedition_seasons.status='CLOSED' then public.expedition_seasons.status else 'ACTIVE' end,
    updated_at=now();

insert into public.expedition_sites(site_code,name_ko,specialty_code,core_reward_code,world_effect_code,sort_order,is_active,metadata) values
('SITE-001','카르코사 고대도시','RUINS','EXPEDITION_BOX','SHOP',1,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-002','낙스마르 폐성터','RUINS','EXPEDITION_BOX','SUPPLY',2,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-003','네크로폴리아 지하유적','RUINS','EXPEDITION_BOX','RESTORE',3,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-004','크로노 타워','RUINS','EXPEDITION_BOX','RECORD',4,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-005','리바이어던의 둥지','RUINS','EXPEDITION_BOX','COSMETIC',5,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-006','제피로스 설산','NATURE','GOLD','RESTORE',6,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-007','샤이아 사막','NATURE','GOLD','SHOP',7,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-008','마스카룸 정글','NATURE','GOLD','SUPPLY',8,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-009','위치우드 늪지','NATURE','GOLD','RECORD',9,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-010','이그니스 용암지대','NATURE','GOLD','COSMETIC',10,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-011','태양의 신전','SANCTUARY','FRAGMENT','SUPPLY',11,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-012','은하수 관측소','SANCTUARY','FRAGMENT','RECORD',12,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-013','고대신 봉인지','SANCTUARY','FRAGMENT','COSMETIC',13,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-014','지옥의 문','SANCTUARY','FRAGMENT','SHOP',14,true,'{"seed_version":"SITE_V1_4"}'),
('SITE-015','세계수의 뿌리','SANCTUARY','FRAGMENT','RESTORE',15,true,'{"seed_version":"SITE_V1_4"}')
on conflict(site_code) do update set name_ko=excluded.name_ko,specialty_code=excluded.specialty_code,core_reward_code=excluded.core_reward_code,world_effect_code=excluded.world_effect_code,sort_order=excluded.sort_order,is_active=true,metadata=coalesce(public.expedition_sites.metadata,'{}')||excluded.metadata,updated_at=now();

insert into public.expedition_environment_templates(environment_code,label_ko,major_element,minor_element,config_version,sort_order,is_active,metadata) values
('ENV-01','물과 불이 부딪히는 곳','WATER','FIRE','ENV_V1',1,true,'{"seed_version":"ENV_V1"}'),
('ENV-02','물이 스며든 단단한 땅','WATER','EARTH','ENV_V1',2,true,'{"seed_version":"ENV_V1"}'),
('ENV-03','뜨거운 바람길','FIRE','WIND','ENV_V1',3,true,'{"seed_version":"ENV_V1"}'),
('ENV-04','불빛이 가득한 곳','FIRE','LIGHT','ENV_V1',4,true,'{"seed_version":"ENV_V1"}'),
('ENV-05','바람이 거세게 부는 바위길','WIND','EARTH','ENV_V1',5,true,'{"seed_version":"ENV_V1"}'),
('ENV-06','어두운 바람길','WIND','DARK','ENV_V1',6,true,'{"seed_version":"ENV_V1"}'),
('ENV-07','젖은 땅이 흔들리는 곳','EARTH','WATER','ENV_V1',7,true,'{"seed_version":"ENV_V1"}'),
('ENV-08','빛나는 돌길','EARTH','LIGHT','ENV_V1',8,true,'{"seed_version":"ENV_V1"}'),
('ENV-09','빛과 그림자가 갈리는 곳','LIGHT','DARK','ENV_V1',9,true,'{"seed_version":"ENV_V1"}'),
('ENV-10','별빛이 바람을 타는 곳','LIGHT','WIND','ENV_V1',10,true,'{"seed_version":"ENV_V1"}'),
('ENV-11','어둠 속 빛이 흔들리는 곳','DARK','LIGHT','ENV_V1',11,true,'{"seed_version":"ENV_V1"}'),
('ENV-12','붉은 그림자가 번지는 곳','DARK','FIRE','ENV_V1',12,true,'{"seed_version":"ENV_V1"}')
on conflict(environment_code) do update set label_ko=excluded.label_ko,major_element=excluded.major_element,minor_element=excluded.minor_element,config_version=excluded.config_version,sort_order=excluded.sort_order,is_active=true,metadata=coalesce(public.expedition_environment_templates.metadata,'{}')||excluded.metadata,updated_at=now();

do $seed_assert$
declare v_sites int; v_env int; v_ruins int; v_nature int; v_sanctuary int; v_settings int; v_seasons int;
begin
  select count(*) into v_sites from public.expedition_sites where is_active=true;
  select count(*) into v_env from public.expedition_environment_templates where is_active=true;
  select count(*) filter(where specialty_code='RUINS'),count(*) filter(where specialty_code='NATURE'),count(*) filter(where specialty_code='SANCTUARY') into v_ruins,v_nature,v_sanctuary from public.expedition_sites where is_active=true;
  select count(*) into v_settings from public.expedition_settings s join public.classrooms c on c.id=s.classroom_id where c.is_active=true;
  select count(*) into v_seasons from public.expedition_seasons e join public.classrooms c on c.id=e.classroom_id where c.is_active=true and e.status='ACTIVE';
  if v_sites<>15 or (v_ruins,v_nature,v_sanctuary)<>(5,5,5) then raise exception 'EXPEDITION_E2_SITE_SEED_INVALID total=% ruins=% nature=% sanctuary=%',v_sites,v_ruins,v_nature,v_sanctuary using errcode='P0E23'; end if;
  if v_env<>12 then raise exception 'EXPEDITION_E2_ENV_SEED_INVALID count=%',v_env using errcode='P0E24'; end if;
  if v_settings<>(select count(*) from public.classrooms where is_active=true) then raise exception 'EXPEDITION_E2_SETTINGS_COVERAGE_INVALID count=%',v_settings using errcode='P0E25'; end if;
  if v_seasons<>(select count(*) from public.classrooms where is_active=true and school_year=2026) then raise exception 'EXPEDITION_E2_SEASON_COVERAGE_INVALID count=%',v_seasons using errcode='P0E26'; end if;
  if exists(select 1 from public.expedition_settings where is_core_enabled or is_student_ui_enabled or is_scheduler_enabled or is_reward_grant_enabled) then raise exception 'EXPEDITION_E2_FLAGS_MUST_START_OFF' using errcode='P0E27'; end if;
end
$seed_assert$;
