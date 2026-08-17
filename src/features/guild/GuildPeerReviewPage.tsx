import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { EmptyState, LoadingPage, PageHeader } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  guild4RpcError,
  guild4StudentRpc,
  type Guild4StudentObligation,
  type Guild4StudentRound,
} from '@/lib/rpc/guild4_rpc';
import { useToastStore } from '@/stores/ui_store';

const fmt = (value?: string | null) => value
  ? new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  : '-';

const roundStateLabel: Record<string, string> = { OPEN: '평가 진행', CLOSED: '평가 마감', FINALIZED: '확정' };

export default function GuildPeerReviewPage() {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  const roundsQ = useQuery({
    queryKey: ['guild4-student-rounds'],
    queryFn: async () => {
      const r = await guild4StudentRpc.rounds(supabase);
      if (!r.success) throw new Error(guild4RpcError(r));
      return r.data;
    },
  });
  const monthlyQ = useQuery({
    queryKey: ['guild4-student-monthly'],
    queryFn: async () => {
      const r = await guild4StudentRpc.monthlySummary(supabase);
      if (!r.success) throw new Error(guild4RpcError(r));
      return r.data;
    },
  });
  const submitM = useMutation({
    mutationFn: async (input: { p_obligation_id: number; p_score: number; p_comment: string }) => {
      const r = await guild4StudentRpc.submit(supabase, input);
      if (!r.success) throw new Error(guild4RpcError(r));
      return r.data;
    },
    onSuccess: () => {
      show({ title: '동료평가를 저장했어요', description: '마감 전까지 다시 수정할 수 있습니다.', variant: 'success' });
      void qc.invalidateQueries({ queryKey: ['guild4-student-rounds'] });
    },
    onError: (error) => show({ title: '동료평가 저장 실패', description: (error as Error).message, variant: 'error', duration: 6000 }),
  });

  if (roundsQ.isLoading) return <><PageHeader title="동료평가" emoji="🤝"/><LoadingPage/></>;

  const rounds = roundsQ.data ?? [];
  const monthly = monthlyQ.data ?? [];

  return <div className="pb-24">
    <PageHeader title="동료평가" emoji="🤝"/>
    <div className="p-4 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <Link to="/guild" className="btn-secondary text-xs">← 길드로 돌아가기</Link>
        <button className="btn-secondary text-xs" onClick={() => { void roundsQ.refetch(); void monthlyQ.refetch(); }}>새로고침</button>
      </div>

      <section className="glass-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black text-text-muted">개인 기여도 · Peer Review</p>
            <h2 className="font-display text-lg text-brand-gradient mt-1">월간 동료평가 점수</h2>
            <p className="text-xs text-text-secondary mt-1">개별 평가자·받은 원점수는 공개되지 않습니다.</p>
          </div>
          <span className="text-2xl">🔐</span>
        </div>
        {monthlyQ.isLoading ? <p className="text-sm text-text-secondary mt-3">월간 점수를 불러오는 중...</p>
          : monthlyQ.isError ? <p className="text-sm text-danger mt-3">{(monthlyQ.error as Error).message}</p>
          : monthly.length === 0 ? <p className="text-sm text-text-secondary mt-3">아직 월간 동료평가 집계가 없습니다.</p>
          : <div className="mt-3 grid gap-2">{monthly.map((m) => <div key={m.year_month} className="rounded-card-md border border-line bg-bg-deep p-3 flex items-center justify-between gap-3">
              <div><div className="font-black text-sm">{m.year_month}</div>{m.explanation && <div className="text-2xs text-text-muted mt-1">{m.explanation}</div>}</div>
              <div className={`font-display text-xl ${m.status === 'READY' ? 'text-gold' : 'text-warning'}`}>{m.status === 'READY' && m.peer_points != null ? `${Number(m.peer_points).toFixed(1)} / ${m.max_points}` : '집계 중'}</div>
            </div>)}</div>}
      </section>

      {roundsQ.isError ? <section className="glass-card p-4 border-danger/40"><div className="font-black text-danger">동료평가를 불러오지 못했습니다.</div><div className="text-xs text-text-secondary mt-2 break-all">{(roundsQ.error as Error).message}</div></section>
        : rounds.length === 0 ? <EmptyState emoji="🤝" title="진행할 동료평가가 없어요" description="미션이 최종 확정되고 동료평가가 열리면 이곳에 표시됩니다."/>
        : rounds.map((round) => <PeerRoundCard key={round.round_id} round={round} busy={submitM.isPending} onSubmit={(obligationId, score, comment) => submitM.mutate({ p_obligation_id: obligationId, p_score: score, p_comment: comment })}/>)}
    </div>
  </div>;
}

function PeerRoundCard({ round, busy, onSubmit }: { round: Guild4StudentRound; busy: boolean; onSubmit: (obligationId: number, score: number, comment: string) => void }) {
  const required = round.obligations.filter((o) => o.obligation_status === 'REQUIRED');
  const incomplete = required.filter((o) => !o.latest_review_revision_number);
  const [selectedId, setSelectedId] = useState<number | null>(() => incomplete[0]?.obligation_id ?? required[0]?.obligation_id ?? round.obligations[0]?.obligation_id ?? null);

  useEffect(() => {
    if (selectedId != null && round.obligations.some((o) => o.obligation_id === selectedId)) return;
    setSelectedId(incomplete[0]?.obligation_id ?? required[0]?.obligation_id ?? round.obligations[0]?.obligation_id ?? null);
  }, [round.obligations, selectedId, incomplete, required]);

  const selected = round.obligations.find((o) => o.obligation_id === selectedId) ?? null;
  const deadlinePassed = Date.now() > new Date(round.deadline_at).getTime();
  const editable = round.lifecycle_state === 'OPEN' && !deadlinePassed && round.monthly_eligible !== false;
  const complete = Number(round.required_count) === Number(round.submitted_required_count);
  const progress = Number(round.required_count) > 0 ? Math.round((Number(round.submitted_required_count) / Number(round.required_count)) * 100) : 100;

  return <section className={`glass-card overflow-hidden ${round.monthly_eligible === false ? 'opacity-60' : ''}`}>
    <div className="p-4 border-b border-line">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-2xs rounded-full px-2 py-1 font-black ${round.lifecycle_state === 'OPEN' ? 'bg-success/10 text-success' : round.lifecycle_state === 'FINALIZED' ? 'bg-gold/10 text-gold' : 'bg-warning/10 text-warning'}`}>{roundStateLabel[round.lifecycle_state] ?? round.lifecycle_state}</span>
            {complete && <span className="text-2xs rounded-full px-2 py-1 font-black bg-bv/10 text-bv">내 평가 완료 ✓</span>}
          </div>
          <h3 className="font-display text-xl mt-2 truncate">{round.mission_title}</h3>
          <p className="text-xs text-text-secondary mt-1">{round.guild_name} · 마감 {fmt(round.deadline_at)}</p>
        </div>

      </div>
      <div className="mt-3"><div className="flex justify-between text-xs font-black"><span>진행도</span><span className={complete ? 'text-success' : 'text-bv'}>{round.submitted_required_count} / {round.required_count}</span></div><div className="h-2 rounded-full bg-bg-deep overflow-hidden mt-1.5"><div className="h-full bg-gradient-to-r from-brand-primary to-gold transition-all" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}/></div></div>
      {deadlinePassed && round.lifecycle_state === 'OPEN' && <div className="mt-3 rounded-card-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">평가 마감시각이 지났습니다. 교사가 round를 마감하기 전이라도 더 이상 수정할 수 없습니다.</div>}
      {round.monthly_eligible === false && <div className="mt-3 rounded-card-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger">원본 미션이 무효 처리되어 이 평가는 월간 점수에서 제외됩니다.</div>}
    </div>

    {round.obligations.length === 0 ? <div className="p-4 text-sm text-text-secondary">평가 대상이 없습니다.</div>
      : <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{round.obligations.map((o) => <button key={o.obligation_id} type="button" onClick={() => setSelectedId(o.obligation_id)} className={`rounded-card-md border p-2.5 text-left transition ${selectedId === o.obligation_id ? 'border-bv bg-bv/10' : 'border-line bg-bg-deep hover:border-bv/40'} ${o.obligation_status === 'EXCUSED' ? 'opacity-60' : ''}`}><div className="font-black text-sm truncate">{o.target_name}</div><div className={`text-2xs mt-1 font-black ${o.obligation_status === 'EXCUSED' ? 'text-text-muted' : o.latest_review_revision_number ? 'text-success' : 'text-warning'}`}>{o.obligation_status === 'EXCUSED' ? '평가 면제' : o.latest_review_revision_number ? `${o.latest_review_revision_number}차 저장됨 ✓` : '평가 필요'}</div></button>)}</div>
        {selected && <ReviewEditor key={`${round.round_id}-${selected.obligation_id}-${selected.latest_review_revision_number ?? 0}`} obligation={selected} editable={editable} busy={busy} onSubmit={onSubmit}/>} 
        <div className="rounded-card-md border border-line bg-bg-deep p-3 text-xs leading-relaxed text-text-secondary">🔐 내가 작성한 평가는 교사가 확인할 수 있지만, 다른 학생에게는 <b className="text-text-primary">누가 몇 점을 주었는지·개별 의견·보정 계산</b>이 공개되지 않습니다.</div>
      </div>}
  </section>;
}

function ReviewEditor({ obligation, editable, busy, onSubmit }: { obligation: Guild4StudentObligation; editable: boolean; busy: boolean; onSubmit: (obligationId: number, score: number, comment: string) => void }) {
  const [score, setScore] = useState<number>(Number(obligation.latest_score ?? 0));
  const [comment, setComment] = useState(String(obligation.latest_comment ?? ''));
  const excused = obligation.obligation_status === 'EXCUSED';

  if (excused) return <div className="rounded-card-lg border border-line bg-bg-deep p-4"><div className="font-display text-lg">{obligation.target_name}</div><p className="text-sm text-text-secondary mt-2">교사가 이 평가 의무를 <b>EXCUSED</b> 처리했습니다. 제출하거나 수정할 필요가 없습니다.</p></div>;

  return <div className="rounded-card-lg border border-line bg-bg-deep p-4">
    <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-black text-text-muted">현재 평가 대상</div><h4 className="font-display text-xl mt-1">{obligation.target_name}</h4></div>{obligation.latest_review_revision_number && <span className="text-xs font-black text-success">{obligation.latest_review_revision_number}차 저장됨</span>}</div>
    <div className="mt-4"><div className="text-xs font-black text-text-secondary mb-2">점수 · 1~10</div><div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <button key={n} type="button" disabled={!editable} onClick={() => setScore(n)} className={`h-10 rounded-card-sm border font-black transition ${score === n ? 'border-gold bg-gold/15 text-gold' : 'border-line bg-bg-card text-text-secondary'} disabled:opacity-50`}>{n}</button>)}</div></div>
    <div className="mt-4"><div className="flex justify-between text-xs font-black text-text-secondary"><span>평가 의견 · 최소 20자</span><span className={comment.trim().length >= 20 ? 'text-success' : 'text-warning'}>{comment.trim().length}자</span></div><textarea className="input-field w-full min-h-32 mt-2" disabled={!editable} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="이 길드원이 미션에서 실제로 어떤 도움을 주었는지 구체적으로 적어주세요."/></div>
    <button type="button" className="btn-primary w-full mt-3" disabled={!editable || busy || score < 1 || comment.trim().length < 20} onClick={() => onSubmit(obligation.obligation_id, score, comment.trim())}>{busy ? '저장 중...' : obligation.latest_review_revision_number ? '평가 수정 저장' : '평가 저장'}</button>
    {!editable && <p className="text-xs text-text-muted mt-2 text-center">현재 round에서는 평가를 수정할 수 없습니다.</p>}
  </div>;
}
