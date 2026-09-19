create or replace function public.character_recruitment_offer_normalize_discount()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.acquisition_mode <> 'CRYSTAL' or coalesce(new.discount_rate,0)=0 then
    new.discount_rate := 0;
    new.discount_start_at := null;
    new.discount_end_at := null;
  end if;
  return new;
end;
$function$;

revoke execute on function public.character_recruitment_offer_normalize_discount()
  from public, anon, authenticated;
grant execute on function public.character_recruitment_offer_normalize_discount()
  to service_role;

drop trigger if exists character_recruitment_offer_normalize_discount
  on public.character_recruitment_offers;

create trigger character_recruitment_offer_normalize_discount
before insert or update of acquisition_mode, discount_rate, discount_start_at, discount_end_at
on public.character_recruitment_offers
for each row
execute function public.character_recruitment_offer_normalize_discount();
