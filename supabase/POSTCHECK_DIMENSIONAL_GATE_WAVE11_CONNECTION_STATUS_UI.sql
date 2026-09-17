select c.name,p.gate_status,p.is_active,
       public.dimensional_gate_content_complete(c.id) as publication_ready
from public.characters c
left join public.dimensional_gate_character_profiles p on p.character_id=c.id
where c.name in ('아스텔','루미')
order by c.name;

select coalesce(p.gate_status,'OUT_OF_RANGE') as gate_status,count(*)
from public.characters c
left join public.dimensional_gate_character_profiles p on p.character_id=c.id
where c.is_active=true
group by coalesce(p.gate_status,'OUT_OF_RANGE')
order by 1;

select column_name,data_type,column_default
from information_schema.columns
where table_schema='public' and table_name='dimensional_gate_character_profiles' and column_name='gate_status';
