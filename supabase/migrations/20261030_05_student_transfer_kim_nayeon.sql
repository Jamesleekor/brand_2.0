-- 2026-10-28 전출 학생(김나연): 활동 비활성화 및 10월 MVP 초안 대상 정리.
-- 과거 자산/길드/경매/업적/레이드/9월 MVP 등은 절대 삭제하거나 수정하지 않는다.
-- 본 작업은 이미 운영 DB에 별도 실행되었으며, 이 파일은 추적 가능한 멱등 이관 기록이다.
begin;

with target as (
  select s.id
  from public.students s
  join public.classrooms c on c.id = s.classroom_id
  where c.school_year = 2026
    and c.name = '5학년 4반'
    and s.name = '김나연'
    and s.role::text = 'STUDENT'
    and s.is_test_account = false
)
update public.students s
set transferred_at = date '2026-10-28', updated_at = now()
where s.id in (select id from target)
  and s.transferred_at is null;

with target as (
  select s.id as student_id, s.classroom_id
  from public.students s
  join public.classrooms c on c.id = s.classroom_id
  where c.school_year = 2026
    and c.name = '5학년 4반'
    and s.name = '김나연'
    and s.transferred_at = date '2026-10-28'
), session_to_correct as (
  select m.id, m.draft_data, t.student_id
  from public.mvp_foundation_sessions m
  join target t on t.classroom_id = m.classroom_id
  where m.title = '2026년 10월 MVP 예선'
    and m.status = 'DRAFT'
    and exists (
      select 1 from jsonb_array_elements(coalesce(m.draft_data->'students','[]'::jsonb)) x
      where (x->>'student_id')::integer = t.student_id
    )
  for update of m
), revised as (
  select m.id,
    jsonb_set(
      jsonb_set(m.draft_data, '{students}',
        (select coalesce(jsonb_agg(x), '[]'::jsonb)
         from jsonb_array_elements(coalesce(m.draft_data->'students','[]'::jsonb)) x
         where (x->>'student_id')::integer <> m.student_id),
        true),
      '{summary,student_count}',
      to_jsonb(jsonb_array_length(coalesce(m.draft_data->'students','[]'::jsonb)) - 1),
      true) as draft_data
  from session_to_correct m
)
update public.mvp_foundation_sessions m
set draft_data = r.draft_data, updated_at = now()
from revised r
where m.id = r.id;

commit;
