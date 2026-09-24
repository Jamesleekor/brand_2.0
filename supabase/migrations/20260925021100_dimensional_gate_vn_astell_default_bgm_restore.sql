-- B.R.A.N.D 2.0 / Dimensional Gate VN
-- Astell episode 1-4 default BGM restore.
-- Live DB was already updated on 2026-09-25; this file records the change in source control.
-- Idempotent: re-running only sets the same URLs.

with src(episode_no,bgm_url) as (
  values
    (1,'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/Character_Stories/Astell/Astell_mainTheme.mp3'),
    (2,'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/Character_Stories/Astell/Astell_002.mp3'),
    (3,'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/Character_Stories/Astell/Astell_003.mp3'),
    (4,'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/Character_Stories/Astell/Astell_004.mp3')
)
update public.dimensional_gate_story_episodes e
set default_bgm_url=s.bgm_url,
    metadata=coalesce(e.metadata,'{}'::jsonb) || jsonb_build_object(
      'default_bgm_restore','2026-09-25',
      'default_bgm_source','brand-assets Astell episode track'
    ),
    updated_at=now()
from src s
join public.characters c on c.character_uid='CHAR-022'
where e.character_id=c.id
  and e.episode_no=s.episode_no
  and e.is_active=true;
