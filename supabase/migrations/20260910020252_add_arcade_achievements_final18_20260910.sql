-- B.R.A.N.D. 2.0 - Arcade achievement catalog final 18
-- Production migration counterpart: 20260910020252 add_arcade_achievements_final18_20260910
-- Definition only. Automatic award evaluation remains disabled.

with target_classroom as (
  select id
  from public.classrooms
  where school_year = 2026
    and name = '5학년 4반'
  order by id
  limit 1
), rows_to_upsert (
  achievement_uid, name, condition_text, grade, is_hidden, achievement_score, sort_order
) as (
  values
    ('ARC-001','아케이드 입성','아케이드 누적 10회 플레이','희귀',false,5,148),
    ('ARC-002','TOP10 생존자','특정 게임의 월간 최종 확정 순위에서 TOP10 달성','희귀',false,7,149),
    ('ARC-003','검증된 실력','기록 인증 도전 1회차에서 인증 기준(잠정기록의 80%) 이상 달성','희귀',false,8,150),
    ('ARC-004','전 종목 도전자','한 달 안에 아케이드 게임 1~6을 모두 최소 1회 플레이','희귀',false,7,151),
    ('ARC-005','실버 컨트롤러','특정 게임의 월간 최종 확정 순위 2위','유니크',false,11,152),
    ('ARC-006','황금 컨트롤러','특정 게임의 월간 최종 확정 순위 1위','유니크',false,13,153),
    ('ARC-007','연속된 질주','같은 게임에서 2개월 연속 월간 최종 TOP10 달성','유니크',false,12,154),
    ('ARC-008','정상을 경험한 자','특정 게임에서 실시간 1위 기록을 연속 24시간 이상 유지','유니크',false,12,155),
    ('ARC-009','엘리트 플레이어','6개의 게임에서 각각 최소 1회 월간 최종 TOP10 달성','유니크',false,13,156),
    ('ARC-010','진짜 최고기록','기록 인증 도전 중 인증 시작 당시 자신의 잠정 최고기록을 갱신','유니크',false,13,157),
    ('ARC-011','왕좌 수성','같은 게임에서 2개월 연속 월간 최종 1위 달성','에픽',false,25,158),
    ('ARC-012','트리플 크라운','서로 다른 아케이드 게임 3종에서 월간 최종 1위 달성','에픽',false,32,159),
    ('ARC-013','철옹성','같은 게임에서 3개월 연속 월간 최종 TOP3 달성','에픽',false,28,160),
    ('ARC-014','아케이드 마스터','6개의 게임에서 각각 최소 1회 월간 최종 TOP3 달성','에픽',false,34,161),
    ('ARC-015','그랜드슬램','한 달 안에 6개의 게임에서 모두 월간 최종 TOP3 달성','초월',false,85,162),
    ('ARC-016','완전 제패','6개의 게임에서 각각 최소 1회 월간 최종 1위 달성','초월',false,90,163),
    ('ARC-017','아케이드의 제왕','학기 종료 시 아케이드 1~6의 종합 성적이 전체 1위','유일',false,80,164),
    ('ARC-018','마지막 한 번','기록 인증 도전 1·2차에서 기준 미달 후 마지막 3차 도전에서 인증 성공','히든',true,18,165)
)
insert into public.achievements (
  achievement_uid,
  classroom_id,
  name,
  condition_text,
  grade,
  is_hidden,
  hint,
  evaluation_type,
  evaluation_query,
  reward_gold,
  reward_bv,
  reward_crystal,
  is_active,
  auto_eval_enabled,
  achievement_score,
  sort_order,
  helper_review_enabled,
  updated_at
)
select
  r.achievement_uid,
  c.id,
  r.name,
  r.condition_text,
  r.grade::public.achievement_grade,
  r.is_hidden,
  null,
  'QUANTITATIVE'::public.achievement_evaluation_type,
  null,
  0,
  0,
  0,
  true,
  false,
  r.achievement_score,
  r.sort_order,
  true,
  now()
from target_classroom c
cross join rows_to_upsert r
on conflict (classroom_id, achievement_uid)
do update set
  name = excluded.name,
  condition_text = excluded.condition_text,
  grade = excluded.grade,
  is_hidden = excluded.is_hidden,
  hint = excluded.hint,
  evaluation_type = excluded.evaluation_type,
  evaluation_query = excluded.evaluation_query,
  reward_gold = excluded.reward_gold,
  reward_bv = excluded.reward_bv,
  reward_crystal = excluded.reward_crystal,
  is_active = excluded.is_active,
  auto_eval_enabled = excluded.auto_eval_enabled,
  achievement_score = excluded.achievement_score,
  sort_order = excluded.sort_order,
  helper_review_enabled = excluded.helper_review_enabled,
  updated_at = now();
