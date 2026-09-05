-- Curated cross-season MVP history is authoritative by snapshot identity.
-- Do not bind historical seed rows to environment-specific current students(id) values.
-- Historical/current same-name people must never be merged solely by a live numeric FK.

update public.records_monthly_mvp_archive
set winner_student_id = null,
    updated_at = now()
where source_kind = 'CURATED'
  and winner_student_id is not null;
