import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { EmptyState, LoadingPage, PageHeader } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { guild5RpcError, guild5StudentRpc } from '@/lib/rpc/guild5_rpc';

const num = (value: unknown) => Number(value ?? 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const monthLabel = (value: string) => `${Number(value.slice(5))}월`;

export default function GuildMonthlyPage() {
  const historyQ = useQuery({
    queryKey: ['guild5-student-history'],
    queryFn: async () => {
      const r = await guild5StudentRpc.history(supabase);
      if (!r.success) throw new Error(guild5RpcError(r));
      return r.data;
    },
  });

  if (historyQ.isLoading) return <><PageHeader title="월간 길드 결산" emoji="🏆"/><LoadingPage/></>;
  const history = historyQ.data ?? [];

  return <div className="pb-24">
    <PageHeader title="월간 길드 결산" emoji="🏆"/>
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-2"><Link to="/guild" className="btn-secondary text-xs">← 길드로 돌아가기</Link><button className="btn-secondary text-xs" onClick={() => void historyQ.refetch()}>새로고침</button></div>
      {historyQ.isError ? <section className="glass-card p-4 border-danger/40"><div className="font-black text-danger">월간 결산을 불러오지 못했습니다.</div><div className="text-xs text-text-secondary mt-2">{(historyQ.error as Error).message}</div></section>
        : history.length === 0 ? <EmptyState emoji="🏆" title="아직 확정된 월간 결산이 없어요" description="월말에 Guild5 마감이 완료되면 최종 길드 순위와 정복 결과가 이곳에 기록됩니다."/>
        : history.map((row) => <MonthCard key={`${row.year_month}-${row.version_no}`} row={row}/>) }
    </div>
  </div>;
}

function MonthCard({ row }: { row: any }) {
  const me = row.my_contribution ?? {};
  const guild = row.my_guild ?? {};
  const territory = row.territory ?? null;
  const rankings = row.rankings ?? [];
  return <section className="glass-card overflow-hidden">
    <div className="p-5 border-b border-line bg-gradient-to-r from-brand-primary/10 to-gold/10">
      <div className="flex flex-wrap justify-between gap-3"><div><div className="text-xs font-black text-text-muted">{row.year_month} · FINAL v{row.version_no}</div><h2 className="font-display text-2xl mt-1">{monthLabel(row.year_month)} 길드 결산</h2><p className="text-sm text-text-secondary mt-1">{guild.guild_name_at_close ?? '당시 길드'} · 최종 <b className="text-gold">{guild.rank_position ?? '-'}위</b></p></div><div className="text-right"><div className="text-xs font-black text-text-muted">최종 Guild GS</div><div className="font-display text-3xl text-gold">{num(guild.total_gs)}</div><div className="text-2xs text-text-muted mt-1">누적 FINAL GS {num(guild.cumulative_final_gs)}</div></div></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4"><Metric label="내 최종 기여" value={`${num(me.final_contribution)}점`}/><Metric label="기본 기여" value={`${num(me.basic_total)} / 900`}/><Metric label="Arcade" value={`+${num(me.arcade_applied)} / 90`}/><Metric label="정복 결과" value={territory?.territory_name_snapshot ?? '영토 없음'}/></div>
    </div>
    <div className="p-4">
      <h3 className="font-black mb-3">🏅 최종 순위</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">{rankings.map((g: any) => <div key={g.guild_id} className={`rounded-card-md border p-3 ${Number(g.guild_id) === Number(me.guild_id) ? 'border-bv bg-bv/10' : Number(g.rank_position) <= 3 ? 'border-gold/30 bg-gold/5' : 'border-line bg-bg-deep'}`}><div className="text-xs font-black text-text-muted">{g.rank_position}위</div><div className="font-black truncate mt-1">{g.guild_name_at_close}</div><div className="font-display text-lg text-gold mt-1">{num(g.total_gs)} GS</div></div>)}</div>
    </div>
  </section>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-card-md border border-line bg-bg-deep/80 p-3"><div className="text-2xs font-black text-text-muted">{label}</div><div className="font-black text-sm mt-1 truncate">{value}</div></div>; }
