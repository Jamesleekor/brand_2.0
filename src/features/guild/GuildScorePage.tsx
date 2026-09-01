import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { EmptyState, LoadingPage, PageHeader } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { guild5RpcError, guild5StudentRpc } from '@/lib/rpc/guild5_rpc';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { getKstDateString } from '@/lib/utils/format';

const num = (value: unknown) => Number(value ?? 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const monthLabel = (value: string) => `${Number(value.slice(5))}월`;
const statusLabel: Record<string, string> = { READY: '집계 완료', NOT_READY: '연결 전', PENDING: '기록 대기', OVERRIDDEN: '교사 Override' };

export default function GuildScorePage() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();
  const currentMonth = getKstDateString().slice(0, 7);
  const historyQ = useQuery({
    queryKey: ['guild5-student-history'],
    queryFn: async () => {
      const r = await guild5StudentRpc.history(supabase);
      if (!r.success) throw new Error(guild5RpcError(r));
      return r.data;
    },
  });
  const months = useMemo(() => Array.from(new Set([currentMonth, ...(historyQ.data ?? []).map((row) => row.year_month)])).sort().reverse(), [currentMonth, historyQ.data]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const finalRow = (historyQ.data ?? []).find((row) => row.year_month === selectedMonth) ?? null;
  const draftQ = useDraftScore(classroomId, studentId, selectedMonth);

  if (historyQ.isLoading || draftQ.isLoading) return <><PageHeader title="길드점수" emoji="📊"/><LoadingPage/></>;
  if (historyQ.isError) return <><PageHeader title="길드점수" emoji="📊"/><div className="p-4"><LoadError message={(historyQ.error as Error).message} retry={() => void historyQ.refetch()}/></div></>;

  return <div className="pb-24">
    <PageHeader title="길드점수" emoji="📊"/>
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Link to="/guild" className="btn-secondary text-xs">← 길드로 돌아가기</Link>
        <label className="text-xs font-black text-text-secondary">조회 월
          <select className="input-field ml-2" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
            {months.map((month) => <option key={month} value={month}>{month}</option>)}
          </select>
        </label>
      </div>

      {finalRow ? <FinalScoreView row={finalRow}/> : draftQ.isError ? <LoadError message={(draftQ.error as Error).message} retry={() => void draftQ.refetch()}/> : <DraftScoreView yearMonth={selectedMonth} data={draftQ.data}/>} 
    </div>
  </div>;
}

function useDraftScore(classroomId: number | null, studentId: number | null, yearMonth: string) {
  return useQuery({
    queryKey: ['guild-score-student-draft', classroomId, studentId, yearMonth],
    enabled: !!classroomId && !!studentId,
    queryFn: async () => {
      const contributionRes = await supabase.from('guild2_individual_contributions').select('*').eq('classroom_id', classroomId!).eq('student_id', studentId!).eq('year_month', yearMonth).maybeSingle();
      if (contributionRes.error) throw new Error(`[길드점수:개인] ${contributionRes.error.message}`);
      const contribution: any = contributionRes.data;
      const summaryRes = contribution?.scoring_guild_id
        ? await supabase.from('guild2_monthly_gs_summaries').select('*').eq('classroom_id', classroomId!).eq('year_month', yearMonth).eq('guild_id', contribution.scoring_guild_id).maybeSingle()
        : { data: null, error: null };
      if (summaryRes.error) throw new Error(`[길드점수:길드] ${summaryRes.error.message}`);
      return { contribution, summary: summaryRes.data as any };
    },
  });
}

function FinalScoreView({ row }: { row: any }) {
  const guild = row.my_guild ?? {};
  const me = row.my_contribution ?? {};
  return <>
    <section className="glass-card overflow-hidden border-gold/30">
      <div className="p-5 bg-gradient-to-r from-gold/10 via-brand-primary/10 to-transparent">
        <div className="flex flex-wrap justify-between gap-4">
          <div><div className="inline-flex rounded-pill border border-gold/30 bg-gold/10 px-2.5 py-1 text-xs font-black text-gold">✓ FINAL v{row.version_no}</div><h2 className="font-display text-2xl mt-2">{monthLabel(row.year_month)} 최종 길드점수</h2><p className="text-sm text-text-secondary mt-1">월 마감 snapshot으로 고정된 결과입니다. 이후 Draft 값이 변해도 이 기록은 바뀌지 않습니다.</p></div>
          <div className="text-right"><div className="text-xs font-black text-text-muted">최종 Guild GS</div><div className="font-display text-4xl text-gold">{num(guild.total_gs)}</div><div className="text-sm font-black text-gold mt-1">최종 {guild.rank_position ?? '-'}위</div></div>
        </div>
      </div>
    </section>

    <section className="glass-card p-4">
      <h3 className="font-display text-lg">⚔️ Guild GS 구성</h3>
      <p className="text-xs text-text-secondary mt-1">마감 순간 저장된 길드 snapshot입니다.</p>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mt-4">
        <Metric label="개인 기여도 합" value={`${num(guild.individual_subtotal)} GS`}/>
        <Metric label="공식 Mission GS" value={`${num(guild.official_mission_gs)} GS`}/>
        <Metric label="인원 보정" value={`${num(guild.compensation_amount)} GS`}/>
        <Metric label="기타 조정" value={`${Number(guild.manual_adjustment_total ?? 0) >= 0 ? '+' : ''}${num(guild.manual_adjustment_total)} GS`}/>
        <Metric label="최종 GS" value={`${num(guild.total_gs)} GS`} accent/>
      </div>
    </section>

    <section className="glass-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="font-display text-lg">✨ 내 최종 기여도</h3><p className="text-xs text-text-secondary mt-1">당시 소속 · 역할 · BV와 함께 Guild5 snapshot에 보존됩니다.</p></div><div className="text-right"><div className="font-display text-2xl text-gold">{num(me.final_contribution)}점</div><div className="text-xs text-text-secondary">기본 {num(me.basic_total)} / 900 · Arcade +{num(me.arcade_applied)} / 90</div></div></div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 mt-4">
        <ComponentMetric label="동료평가" value={me.peer_points} max={300} status={me.peer_status}/>
        <ComponentMetric label="미션 기여" value={me.mission_points} max={300} status={me.mission_status}/>
        <ComponentMetric label="길드 세션" value={me.session_points} max={150} status={me.session_status}/>
        <ComponentMetric label="길드 기여 기록" value={me.observation_points} max={150} status={me.observation_status}/>
        <ComponentMetric label="Arcade 보너스" value={me.arcade_applied} max={90} status={me.arcade_status}/>
      </div>
    </section>

    <section className="glass-card p-4"><div className="flex items-center justify-between gap-2"><div><h3 className="font-display text-lg">🏆 월간 최종 순위</h3><p className="text-xs text-text-secondary mt-1">점령 결과와 같은 FINAL snapshot 순위입니다.</p></div><Link to="/guild/monthly" className="btn-secondary text-xs">월간결산 자세히</Link></div><div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 mt-4">{(row.rankings ?? []).map((g: any) => <div key={g.guild_id} className={`rounded-card-md border p-3 ${Number(g.guild_id) === Number(me.guild_id) ? 'border-bv bg-bv/10' : 'border-line bg-bg-deep'}`}><div className="text-xs font-black text-text-muted">{g.rank_position}위</div><div className="font-black truncate mt-1">{g.guild_name_at_close}</div><div className="font-display text-lg text-gold mt-1">{num(g.total_gs)} GS</div></div>)}</div></section>
  </>;
}

function DraftScoreView({ yearMonth, data }: { yearMonth: string; data: any }) {
  const summary = data?.summary;
  const me = data?.contribution;
  if (!summary && !me) return <EmptyState emoji="📊" title="아직 이번 달 길드점수 초안이 없어요" description="교사가 Guild2 점수를 계산하면 현재 Draft GS와 개인 기여도가 표시됩니다."/>;
  return <>
    <section className="glass-card p-5 border-warning/30"><div className="flex flex-wrap justify-between gap-4"><div><div className="inline-flex rounded-pill border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs font-black text-warning">DRAFT</div><h2 className="font-display text-2xl mt-2">{monthLabel(yearMonth)} 길드점수 초안</h2><p className="text-sm text-text-secondary mt-1">Guild5 월 마감 전의 현재 계산값입니다. 점수원이 바뀌면 계속 갱신될 수 있습니다.</p></div><div className="text-right"><div className="text-xs font-black text-text-muted">현재 Draft GS</div><div className="font-display text-4xl text-gold">{summary ? num(summary.draft_gs_total) : '집계 전'}</div><div className="text-sm font-black text-warning mt-1">{summary?.draft_rank ? `초안 ${summary.draft_rank}위` : '순위 대기'}</div></div></div></section>
    {summary && <section className="glass-card p-4"><h3 className="font-display text-lg">⚔️ Draft GS 구성</h3><div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mt-4"><Metric label="개인 기여도 합" value={`${num(summary.individual_subtotal)} GS`}/><Metric label="공식 Mission GS" value={`${num(summary.mission_gs_subtotal)} GS`}/><Metric label="인원 보정" value={`${num(summary.compensation_amount)} GS`}/><Metric label="기타 조정" value={`${Number(summary.manual_adjustment_total ?? 0) >= 0 ? '+' : ''}${num(summary.manual_adjustment_total)} GS`}/><Metric label="현재 Draft GS" value={`${num(summary.draft_gs_total)} GS`} accent/></div></section>}
    {me && <section className="glass-card p-4"><div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="font-display text-lg">✨ 내 현재 기여도</h3><p className="text-xs text-text-secondary mt-1">마감 전에는 Draft 값이며 Guild5 FINALIZE 때 snapshot으로 고정됩니다.</p></div><div className="font-display text-2xl text-gold">{num(me.final_total)}점</div></div><div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 mt-4"><ComponentMetric label="동료평가" value={me.peer_points} max={300} status={me.peer_status}/><ComponentMetric label="미션 기여" value={me.mission_points} max={300} status={me.mission_status}/><ComponentMetric label="길드 세션" value={me.session_points} max={150} status={me.session_status}/><ComponentMetric label="길드 기여 기록" value={me.teacher_observation_points} max={150} status={me.teacher_observation_status}/><ComponentMetric label="Arcade 보너스" value={me.arcade_applied} max={90} status={me.arcade_status}/></div></section>}
  </>;
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className={`rounded-card-md border p-3 ${accent ? 'border-gold/30 bg-gold/10' : 'border-line bg-bg-deep'}`}><div className="text-2xs font-black text-text-muted">{label}</div><div className={`font-black mt-1 ${accent ? 'text-gold' : 'text-white'}`}>{value}</div></div>; }
function ComponentMetric({ label, value, max, status }: { label: string; value: unknown; max: number; status?: string }) { return <div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="text-xs font-black text-text-secondary">{label}</div><div className="font-display text-xl text-gold mt-1">{num(value)} <span className="text-xs">/ {max}</span></div><div className={`text-[10px] font-black mt-1 ${status === 'READY' ? 'text-success' : status === 'OVERRIDDEN' ? 'text-warning' : 'text-text-muted'}`}>{statusLabel[status ?? ''] ?? status ?? '-'}</div></div>; }
function LoadError({ message, retry }: { message: string; retry: () => void }) { return <section className="glass-card p-4 border-danger/40"><div className="font-black text-danger">길드점수를 불러오지 못했습니다.</div><div className="text-xs text-text-secondary mt-2 break-all">{message}</div><button className="btn-secondary mt-3" onClick={retry}>다시 시도</button></section>; }
