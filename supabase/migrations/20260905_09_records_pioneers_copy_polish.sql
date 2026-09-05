-- Records Hall 1 display copy polish.
-- Keeps canonical historical copy aligned with the dedicated Pioneers museum UI.

update public.records_historical_entries
set subtitle = case record_key
  when 'PIONEER_MASTER_2023_KIMSEUNGHYUN' then '역사상 처음으로 마스터에 도달하다'
  when 'PIONEER_CELESTIAL_MASTER_2023_KIMSEUNGHYUN' then '역사상 처음으로 천상의 마스터에 도달하다'
  when 'PIONEER_GRANDMASTER_2023_KIMSEUNGHYUN' then '처음으로 정상에 오른 자에 대한 헌사'
  else subtitle
end,
updated_at = now()
where record_key in (
  'PIONEER_MASTER_2023_KIMSEUNGHYUN',
  'PIONEER_CELESTIAL_MASTER_2023_KIMSEUNGHYUN',
  'PIONEER_GRANDMASTER_2023_KIMSEUNGHYUN'
);

update public.records_historical_entries
set title = '최초 50,000골드 보유',
    updated_at = now()
where record_key = 'PIONEER_FIRST_GOLD_50000_2023_CHOIMINJAE';
