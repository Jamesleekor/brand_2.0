import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { EmptyState, LoadingPage, PageHeader } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { guild5RpcError, guild5StudentRpc } from '@/lib/rpc/guild5_rpc';

const MAP_ASSET = '/assets/guild/conquest-world-map.webp';
const num = (value: unknown) => Number(value ?? 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const pct = (value: unknown) => `${Number(value ?? 5).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;

type MarkerLayout = {
  slot: number;
  anchorX: number;
  anchorY: number;
  markerX: number;
  markerY: number;
  popoverX: number;
  popoverY?: number;
  popoverBottom?: number;
};

const MARKERS: MarkerLayout[] = [
  // slot 1 · 좌측 산악 요새
  { slot: 1, anchorX: 20.0, anchorY: 23.0, markerX: 27.0, markerY: 15.0, popoverX: 29.0, popoverY: 12.0 },
  // slot 2 · 중앙 왕성
  { slot: 2, anchorX: 51.0, anchorY: 46.0, markerX: 58.0, markerY: 36.0, popoverX: 60.0, popoverY: 33.0 },
  // slot 3 · 우측 해안 성채
  { slot: 3, anchorX: 79.0, anchorY: 65.0, markerX: 86.0, markerY: 55.0, popoverX: 62.0, popoverBottom: 3.0 },
];

const rankMedal = (rank: number) => rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank);
const initials = (name: unknown) => String(name ?? 'G').replace(/\s+/g, '').slice(0, 2).toUpperCase();

export default function GuildConquestPage() {
  const historyQ = useQuery({
    queryKey: ['guild5-student-history'],
    queryFn: async () => {
      const r = await guild5StudentRpc.history(supabase);
      if (!r.success) throw new Error(guild5RpcError(r));
      return r.data;
    },
  });

  const history = historyQ.data ?? [];
  // ?먮졊 ??쓽 '?꾩옱 ?곹깭'???щ젰???꾩옱 ?붿씠 ?꾨땲??  // 媛??理쒓렐???먮졊 ?덉감源뚯? COMPLETE ??FINAL ?붿씠??
  // 諛깆뿏?쒓? ?꾩쭅 conquest_status瑜??대젮二쇱? ?딅뒗 援щ쾭??諛고룷????명솚?쒕떎.
  const conquestHistory = useMemo(() => {
    const hasConquestStatus = history.some((item) => typeof item.conquest_status === 'string');
    return hasConquestStatus
      ? history.filter((item) => item.conquest_status === 'COMPLETE')
      : history;
  }, [history]);
  const months = useMemo(() => Array.from(new Set(conquestHistory.map((row) => row.year_month))), [conquestHistory]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const effectiveMonth = selectedMonth && months.includes(selectedMonth) ? selectedMonth : months[0] ?? null;
  const row = effectiveMonth ? conquestHistory.find((item) => item.year_month === effectiveMonth) ?? null : null;
  const assigned = useMemo(() => {
    const rankings = (row?.rankings ?? []) as Array<Record<string, any>>;
    return rankings
      .filter((g) => Number(g.rank_position) <= 3 && Number(g.territory_slot_no) >= 1 && Number(g.territory_slot_no) <= 3)
      .sort((a, b) => Number(a.rank_position) - Number(b.rank_position));
  }, [row]);

  const [selectedGuildId, setSelectedGuildId] = useState<number | null>(null);
  useEffect(() => {
    setSelectedGuildId(null);
  }, [effectiveMonth]);

  const selected = assigned.find((g) => Number(g.guild_id) === selectedGuildId) ?? null;
  const territoryEconomy = (row?.territory_economy ?? []) as Array<Record<string, any>>;
  const economyBySlot = new Map(territoryEconomy.map((item) => [Number(item.slot_no), item]));
  const taxSummary = (row?.territory_tax_summary ?? []) as Array<Record<string, any>>;
  const taxBySlot = new Map(taxSummary.map((item) => [Number(item.slot_no), item]));
  const selectedEconomy = selected ? economyBySlot.get(Number(selected.territory_slot_no)) ?? null : null;
  const selectedTax = selected ? taxBySlot.get(Number(selected.territory_slot_no)) ?? null : null;
  const selectedLayout = selected ? MARKERS.find((m) => m.slot === Number(selected.territory_slot_no)) ?? null : null;

  if (historyQ.isLoading) return <><PageHeader title="점령" emoji="🏰"/><LoadingPage/></>;

  return <div className="pb-24">
    <PageHeader title="점령" emoji="🏰"/>
    <div className="p-4 space-y-4 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Link to="/guild" className="btn-secondary text-xs">← 길드로 돌아가기</Link>
        {months.length > 0 && <label className="text-xs font-black text-text-secondary">
          조회 월
          <select className="input-field ml-2" value={effectiveMonth ?? ''} onChange={(e) => setSelectedMonth(e.target.value)}>
            {months.map((month) => <option key={month} value={month}>{month}</option>)}
          </select>
        </label>}
      </div>

      {historyQ.isError ? (
        <section className="glass-card p-4 border-danger/40 text-danger font-black">점령 기록을 불러오지 못했습니다.</section>
      ) : !row ? (
        <EmptyState emoji="🏰" title="아직 점령 결과가 없어요" description="Guild5 월 마감과 상위 3개 길드의 영토 선택이 끝나면 이곳에 월드맵과 점령 기록이 표시됩니다."/>
      ) : <>
        <TerritoryValueComparison row={row}/>

        <section className="relative rounded-card-lg border border-gold/20 bg-bg-deep">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-card-lg border-b border-line bg-bg-card/90 px-4 py-3">
            <div>
              <div className="font-display text-lg text-white">⚔️ {row.year_month} 월간 점령 현황</div>
              <p className="text-[11px] text-text-muted mt-0.5">길드 문장을 선택하면 거점 정보를 확인할 수 있습니다.</p>
            </div>
            <div className="rounded-pill border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-black text-gold">FINAL v{row.version_no}</div>
          </div>

          <div className="relative aspect-[1672/941] overflow-hidden rounded-b-card-lg bg-black sm:overflow-visible">
            <img src={MAP_ASSET} alt="산악 요새, 중앙 왕성, 해안 성채가 표시된 길드 점령 월드맵" className="absolute inset-0 h-full w-full rounded-b-card-lg object-cover bg-black"/>

            <svg className="absolute inset-0 h-full w-full pointer-events-none z-[2]" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {assigned.map((g) => {
                const layout = MARKERS.find((m) => m.slot === Number(g.territory_slot_no));
                if (!layout) return null;
                return <g key={`line-${g.guild_id}`}>
                  <line
                    x1={layout.anchorX} y1={layout.anchorY}
                    x2={layout.markerX} y2={layout.markerY}
                    stroke="rgba(255,235,170,.82)"
                    strokeWidth="0.32"
                    strokeDasharray="1.05 1.05"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle cx={layout.anchorX} cy={layout.anchorY} r="0.82" fill="rgba(12,9,18,.75)" stroke="rgba(255,225,120,.95)" strokeWidth="0.28" vectorEffect="non-scaling-stroke"/>
                  <circle cx={layout.anchorX} cy={layout.anchorY} r="0.27" fill="rgba(255,225,120,1)"/>
                </g>;
              })}
            </svg>

            {assigned.map((g) => {
              const layout = MARKERS.find((m) => m.slot === Number(g.territory_slot_no));
              if (!layout) return null;
              const active = Number(g.guild_id) === selectedGuildId;
              return <button
                type="button"
                key={g.guild_id}
                onClick={() => setSelectedGuildId(active ? null : Number(g.guild_id))}
                className={`absolute z-[5] -translate-x-1/2 -translate-y-1/2 group focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-xl ${active ? 'scale-110' : ''}`}
                style={{ left: `${layout.markerX}%`, top: `${layout.markerY}%` }}
                aria-label={`${g.territory ?? '점령 거점'} · ${g.guild_name_at_close} 점령 정보`}
                aria-expanded={active}
              >
                <span className="relative block">
                  <span className={`flex h-10 w-10 sm:h-16 sm:w-16 items-center justify-center overflow-hidden rounded-2xl border-2 bg-bg-deep/95 shadow-xl backdrop-blur transition-all ${active ? 'border-gold ring-4 ring-gold/20' : 'border-white/70 group-hover:border-gold group-hover:-translate-y-1'}`}>
                    {g.guild_logo_url_at_close
                      ? <img src={String(g.guild_logo_url_at_close)} alt="" className="h-full w-full object-cover"/>
                      : <span className="font-display text-sm sm:text-lg text-gold">{initials(g.guild_name_at_close)}</span>}
                  </span>
                  <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border border-gold bg-bg-deep px-1 text-[9px] font-black text-gold shadow">{Number(g.rank_position)}</span>
                </span>
                <span className="mt-1 hidden sm:block whitespace-nowrap rounded-pill border border-white/15 bg-bg-deep/85 px-2 py-1 text-[10px] font-black text-white shadow backdrop-blur">
                  {g.territory ?? `거점 ${g.territory_slot_no}`}
                </span>
              </button>;
            })}

            {selected && selectedLayout && <div className="hidden sm:block"><TerritoryPopover
              guild={selected}
              layout={selectedLayout}
              yearMonth={row.year_month}
              economy={selectedEconomy}
              taxSummary={selectedTax}
              onClose={() => setSelectedGuildId(null)}
            /></div>}

            {assigned.length < 3 && <div className="absolute bottom-3 left-1/2 z-[4] -translate-x-1/2 rounded-pill border border-warning/30 bg-bg-deep/85 px-3 py-1.5 text-[10px] font-black text-warning backdrop-blur">
              점령 선택 진행 중 · {assigned.length}/3
            </div>}
          </div>

          {selected && selectedLayout && <div className="border-t border-line bg-bg-deep p-3 sm:hidden"><TerritoryPopover
            guild={selected}
            layout={selectedLayout}
            yearMonth={row.year_month}
            economy={selectedEconomy}
            taxSummary={selectedTax}
            onClose={() => setSelectedGuildId(null)}
            inline
          /></div>}
        </section>

        <CompactRanking row={row}/>
      </>}
    </div>
  </div>;
}

function TerritoryValueComparison({ row }: { row: any }) {
  const economy = ((row.territory_economy ?? []) as Array<Record<string, any>>).slice().sort((a, b) => Number(a.slot_no) - Number(b.slot_no));
  if (!economy.length) return null;
  const rankings = (row.rankings ?? []) as Array<Record<string, any>>;
  const taxBySlot = new Map(
    ((row.territory_tax_summary ?? []) as Array<Record<string, any>>).map((item) => [Number(item.slot_no), item]),
  );
  const occupiedBySlot = new Map<number, string>();
  rankings.forEach((g) => {
    const slot = Number(g.territory_slot_no ?? 0);
    if (slot >= 1 && slot <= 3 && g.territory) occupiedBySlot.set(slot, String(g.guild_name_at_close ?? '점령 완료'));
  });
  const revenueOrder = new Map(
    economy
      .slice()
      .sort((a, b) => Number(b.projected_revenue ?? 0) - Number(a.projected_revenue ?? 0))
      .map((item, index) => [Number(item.slot_no), index + 1]),
  );
  const auctionRound = economy.find((item) => item.auction_round_number)?.auction_round_number;

  return <section className="glass-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="font-display text-lg">💰 영토 가치 · 세금 정산</h2>
        <p className="mt-1 text-[11px] text-text-muted">{auctionRound ? `${auctionRound}회차 실제 경매 정산액` : '정산된 기준 경매 없음'} × 지역 세율로 점령 가치를 비교합니다. 점령 확정 뒤에는 실제 부과·징수·미납액도 표시됩니다.</p>
      </div>
    </div>
    <div className="mt-3 grid gap-2 md:grid-cols-3">
      {economy.map((item) => {
        const slot = Number(item.slot_no);
        const occupier = occupiedBySlot.get(slot);
        const tax = taxBySlot.get(slot);
        const valueRank = revenueOrder.get(slot);
        return <div key={slot} className={`rounded-card-md border p-3 ${occupier ? 'border-success/25 bg-success/5' : 'border-gold/30 bg-gold/5'}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-black text-bv">{item.auction_category}</div>
              <div className="mt-0.5 font-black text-white">{item.territory_name ?? `영토 ${slot}`}</div>
            </div>
            <span className={`rounded-pill px-2 py-1 text-[9px] font-black ${occupier ? 'border border-success/30 text-success' : 'border border-gold/30 bg-gold/10 text-gold'}`}>{occupier ? `${occupier} 점령` : `예상 #${valueRank}`}</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniValue label="사용액" value={`${num(item.gross_spend)} G`}/>
            <MiniValue label="세율" value={pct(item.tax_rate_percent)}/>
            <MiniValue label="예상 세수" value={`${num(item.projected_revenue)} G`} emphasis/>
          </div>
          {Number(tax?.assessment_count ?? 0) > 0 && <div className="mt-2 grid grid-cols-3 gap-2">
            <MiniValue label="실제 부과" value={`${num(tax?.assessed_amount)} G`}/>
            <MiniValue label="징수" value={`${num(tax?.collected_amount)} G`} emphasis/>
            <MiniValue label="미납" value={`${num(tax?.outstanding_amount)} G`}/>
          </div>}
          <div className="mt-2 text-[9px] text-text-muted">경매 정산 {num(item.settled_item_count)}건 · 거점 {slot}{Number(tax?.assessment_count ?? 0) > 0 ? ` · 영토세 ${num(tax?.assessment_count)}건 부과` : ''}</div>
        </div>;
      })}
    </div>
  </section>;
}

function MiniValue({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className="rounded-card-sm border border-line bg-bg-card/70 p-2">
    <div className="text-[9px] font-black text-text-muted">{label}</div>
    <div className={`mt-0.5 text-xs font-black ${emphasis ? 'text-gold' : 'text-white'}`}>{value}</div>
  </div>;
}

function TerritoryPopover({ guild, layout, yearMonth, economy, taxSummary, onClose, inline = false }: { guild: Record<string, any>; layout: MarkerLayout; yearMonth: string; economy?: Record<string, any> | null; taxSummary?: Record<string, any> | null; onClose: () => void; inline?: boolean }) {
  const overlayStyle: CSSProperties | undefined = inline ? undefined : {
    left: `${layout.popoverX}%`,
    ...(layout.popoverBottom != null
      ? { bottom: `${layout.popoverBottom}%` }
      : { top: `${layout.popoverY ?? 8}%` }),
  };

  return <aside
    className={`${inline ? 'relative w-full' : 'absolute z-[8] w-[280px]'} rounded-card-lg border border-white/20 bg-bg-deep/95 p-3 sm:p-4 shadow-2xl backdrop-blur-xl`}
    style={overlayStyle}
  >
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[10px] font-black text-gold">점령 거점</div>
        <div className="font-display text-lg text-white truncate">{guild.territory ?? `거점 ${guild.territory_slot_no}`}</div>
      </div>
      <button type="button" onClick={onClose} className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-line bg-bg-card text-text-secondary hover:text-white" aria-label="점령 정보 닫기">×</button>
    </div>

    <div className="mt-3 flex items-center gap-3 rounded-card-md border border-line bg-bg-card/80 p-2.5">
      <div className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-xl border border-gold/30 bg-bg-deep">
        {guild.guild_logo_url_at_close
          ? <img src={String(guild.guild_logo_url_at_close)} alt={`${guild.guild_name_at_close} 길드 문장`} className="h-full w-full object-cover"/>
          : <span className="font-display text-sm text-gold">{initials(guild.guild_name_at_close)}</span>}
      </div>
      <div className="min-w-0">
        <div className="font-black text-white truncate">{guild.guild_name_at_close}</div>
        <div className="text-[10px] text-text-muted">{yearMonth} 점령 길드</div>
      </div>
    </div>

    <div className="mt-3 grid grid-cols-2 gap-2">
      <InfoCell label="최종 순위" value={`${guild.rank_position}위`}/>
      <InfoCell label="FINAL GS" value={`${num(guild.total_gs)} GS`}/>
      <InfoCell label="지역 세율" value={pct(guild.tax_rate_percent)}/>
      <InfoCell label="점령 월" value={yearMonth}/>
      <InfoCell label="경매 사용액" value={`${num(economy?.gross_spend ?? 0)} G`}/>
      <InfoCell label="예상 세수" value={`${num(economy?.projected_revenue ?? 0)} G`}/>
      <InfoCell label="실제 부과" value={`${num(taxSummary?.assessed_amount ?? 0)} G`}/>
      <InfoCell label="징수 / 미납" value={`${num(taxSummary?.collected_amount ?? 0)} / ${num(taxSummary?.outstanding_amount ?? 0)} G`}/>
    </div>

    {guild.territory_description && <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-text-secondary">{String(guild.territory_description)}</p>}
  </aside>;
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return <div className="rounded-card-sm border border-line bg-bg-card/70 p-2">
    <div className="text-[9px] font-black text-text-muted">{label}</div>
    <div className="mt-0.5 text-xs font-black text-white">{value}</div>
  </div>;
}

function CompactRanking({ row }: { row: any }) {
  const rankings = (row.rankings ?? []) as Array<Record<string, any>>;
  const myGuildId = Number(row.my_guild?.guild_id ?? 0);

  return <section className="glass-card overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <div>
        <h3 className="font-display text-lg">🏆 전체 길드 최종 순위</h3>
        <p className="text-[11px] text-text-muted">Guild5 FINAL snapshot · 상위 3개 길드만 영토를 점령합니다.</p>
      </div>
      {row.my_guild && <span className="rounded-pill border border-bv/30 bg-bv/10 px-2.5 py-1 text-[10px] font-black text-bv">우리 길드 {row.my_guild.rank_position}위</span>}
    </div>

    <div className="divide-y divide-line/70">
      {rankings.map((g) => {
        const mine = Number(g.guild_id) === myGuildId;
        return <div key={g.guild_id} className={`grid grid-cols-[38px_minmax(0,1fr)_auto] sm:grid-cols-[46px_minmax(0,1fr)_130px_170px] items-center gap-2 px-4 py-2.5 ${mine ? 'bg-bv/10' : ''}`}>
          <div className="font-display text-sm text-white">{rankMedal(Number(g.rank_position))}</div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid h-7 w-7 flex-none place-items-center overflow-hidden rounded-lg border border-line bg-bg-deep text-[9px] font-black text-gold">
              {g.guild_logo_url_at_close ? <img src={String(g.guild_logo_url_at_close)} alt="" className="h-full w-full object-cover"/> : initials(g.guild_name_at_close)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-black text-white">{g.guild_name_at_close}{mine && <span className="ml-1 text-[9px] text-bv">MY</span>}</div>
              <div className="sm:hidden text-[10px] text-text-muted">{g.territory ?? '점령 영토 없음'}</div>
            </div>
          </div>
          <div className="text-right text-xs font-black text-gold">{num(g.total_gs)} <span className="text-[9px]">GS</span></div>
          <div className={`hidden sm:block text-right text-xs font-black ${g.territory ? 'text-bv' : 'text-text-muted'}`}>{g.territory ?? '점령 영토 없음'}</div>
        </div>;
      })}
    </div>
  </section>;
}
