import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { EmptyState, LoadingSpinner, Modal } from '@/components/shared/components';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { GuildPeerReviewStudentJudgement } from './GuildPeerReviewStudentJudgement';
import { GuildPeerReviewOverview } from './GuildPeerReviewOverview';
import { supabase } from '@/lib/supabase/client';
import {
  guild4RpcError,
  guild4TeacherRpc,
  type Guild4TeacherRoundDetail,
  type Guild4TeacherRoundListItem,
} from '@/lib/rpc/guild4_rpc';
import { useToastStore } from '@/stores/ui_store';

const fmt = (value?: string | null) => value
  ? new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  : '-';
const stateLabel: Record<string, string> = { OPEN: '진행 중', CLOSED: '마감/정리', FINALIZED: '확정' };
const stateStyle: Record<string, string> = { OPEN: 'text-success bg-success/10', CLOSED: 'text-warning bg-warning/10', FINALIZED: 'text-gold bg-gold/10' };
const penaltyLabel: Record<string, string> = { NOT_EVALUATED: '미평가', NO_PENALTY: '벌금 없음', POSTED: '차감 완료', PENDING_FUNDS: '잔액 부족', WAIVED: '면제' };

export default function GuildPeerReviewAdmin() {
  const qc = useQueryClient();
  const show = useToastStore((s) => s.show);
  const [selected, setSelected] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ['guild4-teacher-list'],
    queryFn: async () => {
      const r = await guild4TeacherRpc.list(supabase);
      if (!r.success) throw new Error(guild4RpcError(r));
      return r.data;
    },
  });
  const missionGroups = useMemo(() => {
    const groups = new Map<string, { key: string; title: string; rounds: Guild4TeacherRoundListItem[] }>();
    for (const round of listQ.data ?? []) {
      // Distinct Guild3 missions with the same visible name remain separate.
      const key = Number(round.mission_id) > 0
        ? `mission:${round.mission_id}`
        : `title:${round.mission_title}:${round.source_finalized_at ?? ''}`;
      const group = groups.get(key);
      if (group) group.rounds.push(round);
      else groups.set(key, { key, title: round.mission_title, rounds: [round] });
    }
    return Array.from(groups.values());
  }, [listQ.data]);

  useEffect(() => {
    if (listQ.data && !listQ.data.length) { if (selected !== null) setSelected(null); return; }
    if (listQ.data?.length && !listQ.data.some((round) => round.round_id === selected)) {
      setSelected(listQ.data[0].round_id);
    }
  }, [selected, listQ.data]);
  const selectedMission = missionGroups.find((group) => group.rounds.some((row) => row.round_id === selected));

  const detailQ = useQuery({
    queryKey: ['guild4-teacher-detail', selected],
    enabled: selected !== null,
    queryFn: async () => {
      const r = await guild4TeacherRpc.detail(supabase, { p_round_id: selected! });
      if (!r.success) throw new Error(guild4RpcError(r));
      return r.data;
    },
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['guild4-teacher-list'] });
    if (selected !== null) void qc.invalidateQueries({ queryKey: ['guild4-teacher-detail', selected] });
  };

  const actionM = useMutation({
    mutationFn: async (job: { label: string; fn: () => Promise<any> }) => {
      const r = await job.fn();
      if (!r.success) throw new Error(guild4RpcError(r));
      return { label: job.label, data: r.data };
    },
    onMutate: () => setActionError(null),
    onSuccess: ({ label }) => { show({ title: label, variant: 'success' }); refresh(); },
    onError: (error) => {
      const message = (error as Error).message;
      setActionError(message);
      show({ title: 'Guild4 작업 오류', description: message, variant: 'error', duration: 7000 });
    },
  });
  const run = (label: string, fn: () => Promise<any>) => actionM.mutate({ label, fn });

  const syncM = useMutation({
    mutationFn: async () => {
      const r = await guild4TeacherRpc.sync(supabase);
      if (!r.success) throw new Error(guild4RpcError(r));
      return r.data;
    },
    onSuccess: (data) => {
      show({ title: 'Guild4 round 동기화 완료', description: `새 round ${data.created}개 · 기존 ${data.already_existing}개`, variant: 'success' });
      void qc.invalidateQueries({ queryKey: ['guild4-teacher-list'] });
    },
    onError: (error) => {
      const message = (error as Error).message;
      setActionError(message);
      show({ title: 'Round 동기화 실패', description: message, variant: 'error', duration: 7000 });
    },
  });

  return <TeacherShell><div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-xs font-black text-[#f2ddbc]">Guild 4</div>
        <h1 className="font-display text-2xl text-brand-gradient">동료평가 운영</h1>
        <p className="mt-1 text-sm text-[#f7e7d0]">미션별로 묶어 보고, 길드를 선택해 학생별 받은 점수·준 점수·미제출 현황을 확인합니다.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="/teacher/guild" className="btn-secondary">← 길드 운영</Link>
        <button className="btn-primary" disabled={syncM.isPending || actionM.isPending} onClick={() => syncM.mutate()}>{syncM.isPending ? '동기화 중...' : '🔄 Guild3 → G4 동기화'}</button>
      </div>
    </div>

    {actionError && <div role="alert" className="rounded-card-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"><b>최근 작업 오류</b><div className="mt-1 break-all">{actionError}</div></div>}

    <div className="grid gap-4 lg:grid-cols-[255px_minmax(0,1fr)]">
      <aside className="glass-card h-fit p-3">
        <div className="mb-3 flex items-center justify-between px-1"><h2 className="font-display text-lg text-[#fff0cf]">평가 미션</h2><span className="text-xs font-black text-[#f2ddbc]">{missionGroups.length}개 · 최신순</span></div>
        {listQ.isLoading ? <div className="flex justify-center py-10"><LoadingSpinner/></div>
          : listQ.isError ? <div className="p-3 text-sm text-danger">{(listQ.error as Error).message}</div>
          : missionGroups.length === 0 ? <EmptyState emoji="🤝" title="아직 평가 미션이 없습니다" description="Guild3에서 Peer ON 미션을 FINALIZED한 뒤 동기화하세요."/>
          : <div className="space-y-2">{missionGroups.map((group) => <MissionListButton key={group.key} title={group.title} rounds={group.rounds} selected={selectedMission?.key === group.key} onClick={() => setSelected(group.rounds[0].round_id)}/>)}</div>}
      </aside>

      <main className="min-w-0 space-y-3">
        {selectedMission && <section className="glass-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><div className="text-xs font-black text-[#f2ddbc]">선택한 미션</div><h2 className="font-display text-xl text-[#fff0cf]">{selectedMission.title}</h2></div>
            <span className="text-xs font-black text-[#f2ddbc]">길드 {selectedMission.rounds.length}개</span>
          </div>
          <div role="tablist" aria-label="길드별 동료평가" className="mt-3 flex flex-wrap gap-2">
            {selectedMission.rounds.map((row) => {
              const active = row.round_id === selected;
              const done = Number(row.submitted_required_count);
              const required = Number(row.required_obligation_count);
              return <button key={row.round_id} role="tab" aria-selected={active} type="button" onClick={() => setSelected(row.round_id)} className={`min-w-[130px] flex-1 rounded-card-md border px-3 py-2.5 text-left transition ${active ? 'border-bv bg-bv/20 text-[#fff5e6] ring-1 ring-bv' : 'border-line bg-bg-deep text-[#f2ddbc] hover:border-gold/50'}`}>
                <div className="flex items-center justify-between gap-2"><span className="truncate font-black">{row.guild_name}</span><span className={`text-xs font-black ${done < required ? 'text-amber-200' : 'text-emerald-200'}`}>{done}/{required}</span></div>
                <div className="mt-1 flex items-center gap-2 text-xs"><StateBadge state={row.lifecycle_state}/>{done < required && <span className="text-amber-200">미제출 {required - done}건</span>}</div>
              </button>;
            })}
          </div>
        </section>}
        <section className="glass-card min-h-[520px] min-w-0">
          {selected === null ? <EmptyState emoji="🤝" title="평가 미션을 선택하세요"/>
            : detailQ.isLoading ? <div className="flex justify-center py-24"><LoadingSpinner size="lg"/></div>
            : detailQ.isError ? <div className="p-5 text-danger">{(detailQ.error as Error).message}</div>
            : detailQ.data ? <RoundDetailPanel key={selected} detail={detailQ.data} busy={actionM.isPending} run={run} refresh={refresh}/> : null}
        </section>
      </main>
    </div>
  </div></TeacherShell>;
}

function MissionListButton({ title, rounds, selected, onClick }: { title: string; rounds: Guild4TeacherRoundListItem[]; selected: boolean; onClick: () => void }) {
  const required = rounds.reduce((total, row) => total + Number(row.required_obligation_count), 0);
  const done = rounds.reduce((total, row) => total + Number(row.submitted_required_count), 0);
  const state = rounds.every((row) => row.lifecycle_state === 'FINALIZED') ? 'FINALIZED'
    : rounds.some((row) => row.lifecycle_state === 'OPEN') ? 'OPEN' : 'CLOSED';
  return <button type="button" onClick={onClick} aria-current={selected ? 'true' : undefined} className={`w-full rounded-card-md border p-3 text-left transition ${selected ? 'border-bv bg-bv/15 ring-1 ring-bv/40' : 'border-line bg-bg-deep hover:border-gold/40'}`}>
    <div className="flex items-start justify-between gap-2"><span className="font-black text-[#fff5e6]">{title}</span><StateBadge state={state}/></div>
    <div className="mt-2 text-xs font-bold text-[#f2ddbc]">{rounds.length}개 길드 · 제출 {done}/{required}</div>
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-card"><div className="h-full bg-bv" style={{ width: `${required ? Math.min(100, done / required * 100) : 100}%` }}/></div>
    <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[#f2ddbc]">{rounds.map((row) => <span key={row.round_id}>{row.guild_name}</span>)}</div>
    <div className="mt-2 text-xs text-[#edd4ae]">마감 {fmt(rounds[0]?.deadline_at)}</div>
  </button>;
}

function RoundDetailPanel({ detail, busy, run, refresh }: { detail: Guild4TeacherRoundDetail; busy: boolean; run: (label: string, fn: () => Promise<any>) => void; refresh: () => void }) {
  const round = detail.round;
  const state = String(round.lifecycle_state);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [obligationModal, setObligationModal] = useState<{ kind: 'exception' | 'review'; obligation: Guild4TeacherRoundDetail['obligations'][number] } | null>(null);
  const [waivePenalty, setWaivePenalty] = useState<Record<string, any> | null>(null);
  const [viewMode, setViewMode] = useState<'overview' | 'submissions' | 'students'>('overview');

  useEffect(() => {
    setViewMode('overview');
  }, [round.id, state]);
  const participantsByStudent = useMemo(() => new Map(detail.participants.map((p) => [Number(p.student_id), p.student_name])), [detail.participants]);
  const required = detail.obligations.filter((o) => o.obligation_status === 'REQUIRED');
  const submitted = required.filter((o) => o.latest_review);
  const missing = required.filter((o) => !o.latest_review);
  const excused = detail.obligations.filter((o) => o.obligation_status === 'EXCUSED');

  const closeRound = () => {
    const reason = window.prompt('Round 마감 사유를 2자 이상 입력하세요.', '평가 기간 종료')?.trim() ?? '';
    if (reason.length >= 2 && window.confirm('학생의 평가 작성/수정을 마감할까요?')) run('동료평가 Round를 마감했어요', () => guild4TeacherRpc.close(supabase, { p_round_id: Number(round.id), p_reason: reason }));
  };
  const finalizeRound = () => {
    const reason = window.prompt(`최종 확정 메모 (선택)\n미제출 학생 ${new Set(missing.map((o) => o.reviewer_student_id)).size}명에게 round당 2,000 GOLD 벌금 판정이 함께 진행됩니다.`, '') ?? null;
    if (reason !== null && window.confirm('점수 계산·벌금 판정·Guild2 Peer 반영까지 최종 확정할까요?')) run('동료평가 Round를 최종 확정했어요', () => guild4TeacherRpc.finalize(supabase, { p_round_id: Number(round.id), p_reason: reason.trim() || null }));
  };

  return <div className="p-5 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><StateBadge state={state}/><h2 className="font-display text-2xl mt-2">{detail.mission?.title ?? `Round #${round.id}`}</h2><p className="text-xs text-text-secondary mt-1">{round.guild_id ? `Guild #${round.guild_id}` : ''} · 미션 weight {detail.mission?.weight ?? '-'} · {detail.mission?.contribution_year_month ?? '-'}</p><p className="text-xs text-text-muted mt-1">마감 {fmt(round.deadline_at)} · 원본 확정 {fmt(round.source_finalized_at)}</p></div>
      <div className="flex flex-wrap gap-2">{state === 'OPEN' && <><button className="btn-secondary" disabled={busy} onClick={() => setDeadlineOpen(true)}>⏰ 마감 변경</button><button className="btn-primary" disabled={busy} onClick={closeRound}>평가 마감</button></>}{state === 'CLOSED' && <button className="btn-primary" disabled={busy} onClick={finalizeRound}>최종 확정</button>}</div>
    </div>

    {round.monthly_eligible === false && <div className="rounded-card-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger"><b>월간 집계 제외:</b> {round.source_void_reason ?? '원본 Guild3 미션이 VOID 처리되었습니다.'}</div>}

    <div className="grid grid-cols-2 md:grid-cols-4 gap-2"><Metric label="참가자" value={`${detail.participants.length}명`}/><Metric label="필수 평가" value={`${submitted.length}/${required.length}`}/><Metric label="미제출" value={`${missing.length}건`}/><Metric label="EXCUSED" value={`${excused.length}건`}/></div>

    <div className="flex flex-wrap items-center gap-2 rounded-card-md border border-line bg-bg-deep p-1.5">
      <button type="button" className={`rounded-card-sm px-4 py-2 text-sm font-black transition ${viewMode === 'overview' ? 'bg-bv text-white' : 'text-[#f2ddbc] hover:bg-bg-card'}`} onClick={() => setViewMode('overview')}>평가 한눈에</button>
      <button type="button" className={`rounded-card-sm px-4 py-2 text-sm font-black transition ${viewMode === 'submissions' ? 'bg-bv text-white' : 'text-[#f2ddbc] hover:bg-bg-card'}`} onClick={() => setViewMode('submissions')}>제출·정정 관리</button>
      <button type="button" className={`rounded-card-sm px-4 py-2 text-sm font-black transition ${viewMode === 'students' ? 'bg-bv text-white' : 'text-text-secondary hover:bg-bg-card'}`} onClick={() => setViewMode('students')}>학생별 판정</button>
    </div>

    {viewMode === 'overview' ? (
      <GuildPeerReviewOverview detail={detail}/>
    ) : viewMode === 'submissions' ? (
      <section className="space-y-3"><div className="flex items-center justify-between"><div><h3 className="font-display text-lg">평가 제출 현황</h3><p className="text-xs text-text-secondary mt-1">교사는 reviewer·target·raw score·comment를 모두 확인할 수 있습니다.</p></div></div><div className="overflow-x-auto rounded-card-md border border-line"><table className="min-w-[820px] w-full text-xs"><thead className="bg-bg-deep text-text-muted"><tr><Th>평가자</Th><Th>대상</Th><Th>상태</Th><Th>점수</Th><Th>의견</Th><Th>Revision</Th><Th>관리</Th></tr></thead><tbody>{detail.obligations.map((o) => <tr key={o.obligation_id} className="border-t border-line align-top"><Td><b>{o.reviewer_name}</b></Td><Td>{o.target_name}</Td><Td>{o.obligation_status === 'EXCUSED' ? <span className="text-text-muted font-black">EXCUSED</span> : o.latest_review ? <span className="text-success font-black">제출 ✓</span> : <span className="text-warning font-black">미제출</span>}</Td><Td>{o.latest_review?.score ?? '-'}</Td><Td><div className="max-w-[250px] whitespace-pre-wrap">{o.latest_review?.comment ?? (o.current_exception_reason ? `면제: ${o.current_exception_reason}` : '-')}</div></Td><Td>{o.latest_revision_number ? `${o.latest_revision_number}차` : '-'}</Td><Td><div className="flex flex-wrap gap-1">{state !== 'FINALIZED' && <button className="btn-secondary !px-2 !py-1 text-2xs" disabled={busy} onClick={() => setObligationModal({ kind: 'exception', obligation: o })}>{o.obligation_status === 'EXCUSED' ? '면제 해제' : 'EXCUSED'}</button>}{state === 'FINALIZED' && round.monthly_eligible !== false && <><button className="btn-secondary !px-2 !py-1 text-2xs" disabled={busy} onClick={() => setObligationModal({ kind: 'exception', obligation: o })}>예외 정정</button>{o.latest_review && <button className="btn-secondary !px-2 !py-1 text-2xs" disabled={busy} onClick={() => setObligationModal({ kind: 'review', obligation: o })}>리뷰 정정</button>}</>}</div></Td></tr>)}</tbody></table></div></section>
    ) : (
      <GuildPeerReviewStudentJudgement detail={detail} busy={busy}/>
    )}

    {state === 'FINALIZED' && <>
      <ScoreAudit detail={detail} participantsByStudent={participantsByStudent}/>
      <PenaltyPanel detail={detail} participantsByStudent={participantsByStudent} busy={busy} run={run} onWaive={setWaivePenalty}/>
    </>}

    <details className="rounded-card-md border border-line bg-bg-deep"><summary className="cursor-pointer p-3 font-black text-sm">Revision History · {detail.review_revision_history.length}건</summary><div className="border-t border-line p-3 space-y-2 max-h-80 overflow-y-auto">{detail.review_revision_history.length === 0 ? <p className="text-xs text-text-muted">아직 revision이 없습니다.</p> : detail.review_revision_history.map((rv) => <div key={String(rv.id)} className="rounded-card-sm border border-line bg-bg-card p-2 text-xs"><b>{participantsByStudent.get(Number(rv.reviewer_student_id)) ?? `학생#${rv.reviewer_student_id}`}</b> → <b>{participantsByStudent.get(Number(rv.target_student_id)) ?? `학생#${rv.target_student_id}`}</b> · {rv.revision_number}차 · {rv.score}점 · {fmt(rv.submitted_at)}<div className="text-text-secondary mt-1 whitespace-pre-wrap">{String(rv.comment ?? '')}</div></div>)}</div></details>

    <details className="rounded-card-md border border-line bg-bg-deep"><summary className="cursor-pointer p-3 font-black text-sm">Audit History · {detail.audit_history.length}건</summary><div className="border-t border-line p-3 space-y-2 max-h-80 overflow-y-auto">{detail.audit_history.length === 0 ? <p className="text-xs text-text-muted">감사 이력이 없습니다.</p> : detail.audit_history.map((a) => <div key={String(a.id)} className="text-xs"><b>{String(a.event_kind ?? 'EVENT')}</b> · {fmt(a.occurred_at)}{a.reason ? <span className="text-text-secondary"> · {String(a.reason)}</span> : null}</div>)}</div></details>

    {deadlineOpen && <DeadlineModal deadline={String(round.deadline_at)} busy={busy} onClose={() => setDeadlineOpen(false)} onSave={(deadline, reason) => { run('동료평가 마감을 변경했어요', () => guild4TeacherRpc.updateDeadline(supabase, { p_round_id: Number(round.id), p_deadline_at: deadline, p_reason: reason })); setDeadlineOpen(false); }}/>} 
    {obligationModal && <ObligationActionModal roundState={state} item={obligationModal} busy={busy} onClose={() => setObligationModal(null)} onRun={(label, fn) => { run(label, fn); setObligationModal(null); }}/>} 
    {waivePenalty && <ReasonModal title="미제출 벌금 면제" emoji="🪙" description={`${participantsByStudent.get(Number(waivePenalty.student_id)) ?? `학생 #${waivePenalty.student_id}`}의 2,000 GOLD 벌금을 면제합니다. 이미 차감된 경우 reversal 이력이 남습니다.`} busy={busy} onClose={() => setWaivePenalty(null)} onConfirm={(reason) => { run('벌금을 면제했어요', () => guild4TeacherRpc.waivePenalty(supabase, { p_penalty_id: Number(waivePenalty.id), p_reason: reason })); setWaivePenalty(null); }}/>} 
  </div>;
}

function ScoreAudit({ detail, participantsByStudent }: { detail: Guild4TeacherRoundDetail; participantsByStudent: Map<number, string> }) {
  return <section className="space-y-3"><div><h3 className="font-display text-lg">점수 계산 Audit</h3><p className="text-xs text-text-secondary mt-1">reviewer bias ±1.5 → target median ±2 cap → /300 계산 결과입니다.</p></div>{detail.score_rollups.length === 0 ? <div className="rounded-card-md border border-line bg-bg-deep p-3 text-sm text-text-secondary">아직 계산 결과가 없습니다.</div> : <div className="grid md:grid-cols-2 gap-2">{detail.score_rollups.map((sr) => <div key={String(sr.id)} className="rounded-card-md border border-line bg-bg-deep p-3"><div className="flex justify-between gap-3"><div><div className="font-black">{participantsByStudent.get(Number(sr.student_id)) ?? `학생 #${sr.student_id}`}</div><div className="text-2xs text-text-muted mt-1">eligible review {sr.eligible_review_count ?? 0}건 · {sr.rollup_status}</div></div><div className="text-right"><div className="font-display text-xl text-gold">{sr.peer_points == null ? '-' : Number(sr.peer_points).toFixed(1)}</div><div className="text-2xs text-text-muted">/ 300</div></div></div><div className="grid grid-cols-2 gap-2 mt-2 text-xs"><Metric label="최종 rating" value={sr.final_rating == null ? '-' : Number(sr.final_rating).toFixed(3)}/><Metric label="Target median" value={sr.target_median == null ? '-' : Number(sr.target_median).toFixed(3)}/></div>{sr.raw_payload?.reviews && <details className="mt-2"><summary className="cursor-pointer text-xs font-black text-bv">보정 상세 보기</summary><div className="mt-2 space-y-1">{(sr.raw_payload.reviews as any[]).map((r: any) => <div key={String(r.obligation_id)} className="rounded border border-line bg-bg-card p-2 text-2xs text-text-secondary">reviewer #{r.reviewer_student_id} · raw {Number(r.raw_score).toFixed(2)} → bias {Number(r.reviewer_bias).toFixed(2)} → stage A {Number(r.stage_a_score).toFixed(2)} → final {Number(r.final_corrected_score).toFixed(2)}</div>)}</div></details>}</div>)}</div>}</section>;
}

function PenaltyPanel({ detail, participantsByStudent, busy, run, onWaive }: { detail: Guild4TeacherRoundDetail; participantsByStudent: Map<number, string>; busy: boolean; run: (label: string, fn: () => Promise<any>) => void; onWaive: (penalty: Record<string, any>) => void }) {
  return <section className="space-y-3"><div><h3 className="font-display text-lg">미제출 벌금</h3><p className="text-xs text-text-secondary mt-1">필수 평가를 하나라도 빠뜨리면 누락 건수와 관계없이 round당 2,000 GOLD 1회입니다.</p></div>{detail.penalties.length === 0 ? <div className="rounded-card-md border border-line bg-bg-deep p-3 text-sm text-text-secondary">벌금 판정 데이터가 없습니다.</div> : <div className="space-y-2">{detail.penalties.map((p) => <div key={String(p.id)} className="rounded-card-md border border-line bg-bg-deep p-3 flex flex-wrap items-center gap-3"><div className="flex-1 min-w-[180px]"><div className="font-black">{participantsByStudent.get(Number(p.student_id)) ?? `학생 #${p.student_id}`}</div><div className="text-xs text-text-secondary mt-1">미완료 {p.missing_required_count ?? 0}건 · {Number(p.penalty_amount ?? 2000).toLocaleString()} GOLD</div>{p.last_failure_reason && <div className="text-2xs text-danger mt-1 break-all">{p.last_failure_reason}</div>}{p.waiver_reason && <div className="text-2xs text-text-muted mt-1">면제: {p.waiver_reason}</div>}</div><span className={`text-xs font-black ${p.penalty_status === 'POSTED' ? 'text-danger' : p.penalty_status === 'PENDING_FUNDS' ? 'text-warning' : p.penalty_status === 'WAIVED' ? 'text-bv' : 'text-success'}`}>{penaltyLabel[String(p.penalty_status)] ?? String(p.penalty_status)}</span><div className="flex gap-1">{p.penalty_status === 'PENDING_FUNDS' && <button className="btn-secondary !px-2 !py-1 text-2xs" disabled={busy} onClick={() => run('벌금 재시도를 완료했어요', () => guild4TeacherRpc.retryPenalty(supabase, { p_penalty_id: Number(p.id) }))}>재시도</button>}{['POSTED', 'PENDING_FUNDS'].includes(String(p.penalty_status)) && <button className="btn-secondary !px-2 !py-1 text-2xs" disabled={busy} onClick={() => onWaive(p)}>면제</button>}</div></div>)}</div>}</section>;
}

function ObligationActionModal({ roundState, item, busy, onClose, onRun }: { roundState: string; item: { kind: 'exception' | 'review'; obligation: Guild4TeacherRoundDetail['obligations'][number] }; busy: boolean; onClose: () => void; onRun: (label: string, fn: () => Promise<any>) => void }) {
  const o = item.obligation;
  const [reason, setReason] = useState('');
  const [score, setScore] = useState(Number(o.latest_review?.score ?? 0));
  const [comment, setComment] = useState(String(o.latest_review?.comment ?? ''));
  const nextExcused = o.obligation_status !== 'EXCUSED';
  const validReason = reason.trim().length >= 2;

  if (item.kind === 'review') return <Modal isOpen onClose={onClose} title="FINALIZED 리뷰 정정" emoji="📝" size="lg"><div className="space-y-3"><p className="text-sm text-text-secondary"><b>{o.reviewer_name}</b> → <b>{o.target_name}</b>의 확정 리뷰를 append-only revision으로 정정합니다.</p><div className="grid grid-cols-5 sm:grid-cols-10 gap-1">{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <button key={n} type="button" onClick={() => setScore(n)} className={`h-9 rounded border font-black ${score === n ? 'border-gold bg-gold/10 text-gold' : 'border-line bg-bg-card'}`}>{n}</button>)}</div><textarea className="input-field w-full min-h-28" value={comment} onChange={(e) => setComment(e.target.value)}/><div className="text-xs text-text-muted text-right">{comment.trim().length}자 / 최소 20자</div><Field label="정정 사유"><input className="input-field w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="감사 이력에 남습니다"/></Field><button className="btn-primary w-full" disabled={busy || !validReason || score < 1 || comment.trim().length < 20} onClick={() => onRun('확정 리뷰를 정정했어요', () => guild4TeacherRpc.correctReview(supabase, { p_obligation_id: Number(o.obligation_id), p_score: score, p_comment: comment.trim(), p_reason: reason.trim() }))}>정정 저장</button></div></Modal>;

  return <Modal isOpen onClose={onClose} title={roundState === 'FINALIZED' ? 'FINALIZED 예외 정정' : nextExcused ? '평가 의무 EXCUSED' : 'EXCUSED 해제'} emoji="🛡️"><div className="space-y-3"><p className="text-sm text-text-secondary"><b>{o.reviewer_name}</b> → <b>{o.target_name}</b> 평가 의무를 <b>{nextExcused ? 'EXCUSED' : 'REQUIRED'}</b>로 변경합니다.</p><Field label="사유"><textarea className="input-field w-full min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="장기 결석, 전출, 평가 불가능한 특별 상황 등"/></Field><button className="btn-primary w-full" disabled={busy || !validReason} onClick={() => onRun(nextExcused ? '평가 의무를 EXCUSED 처리했어요' : '평가 의무를 복원했어요', () => roundState === 'FINALIZED' ? guild4TeacherRpc.correctException(supabase, { p_obligation_id: Number(o.obligation_id), p_excused: nextExcused, p_reason: reason.trim() }) : guild4TeacherRpc.setExcused(supabase, { p_obligation_id: Number(o.obligation_id), p_excused: nextExcused, p_reason: reason.trim() }))}>{nextExcused ? 'EXCUSED 적용' : 'REQUIRED 복원'}</button></div></Modal>;
}

function DeadlineModal({ deadline, busy, onClose, onSave }: { deadline: string; busy: boolean; onClose: () => void; onSave: (iso: string, reason: string) => void }) {
  const local = toLocalParts(deadline);
  const [date, setDate] = useState(local.date);
  const [hour, setHour] = useState(local.hour);
  const [minute, setMinute] = useState(local.minute);
  const [reason, setReason] = useState('동료평가 마감시간 조정');
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
  const complete = Boolean(date && hour && minute && reason.trim().length >= 2);
  return <Modal isOpen onClose={onClose} title="동료평가 마감 변경" emoji="⏰"><div className="space-y-3"><div className="grid grid-cols-[minmax(0,1fr)_95px_95px] gap-2"><input type="date" className="input-field w-full" value={date} onChange={(e) => setDate(e.target.value)}/><select className="input-field w-full" value={hour} onChange={(e) => setHour(e.target.value)}>{hours.map((h) => <option key={h} value={h}>{Number(h)}시</option>)}</select><select className="input-field w-full" value={minute} onChange={(e) => setMinute(e.target.value)}>{minutes.map((m) => <option key={m} value={m}>{Number(m)}분</option>)}</select></div><Field label="변경 사유"><input className="input-field w-full" value={reason} onChange={(e) => setReason(e.target.value)}/></Field><button className="btn-primary w-full" disabled={busy || !complete} onClick={() => onSave(new Date(`${date}T${hour}:${minute}`).toISOString(), reason.trim())}>마감 변경</button></div></Modal>;
}

function ReasonModal({ title, emoji, description, busy, onClose, onConfirm }: { title: string; emoji: string; description: string; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return <Modal isOpen onClose={onClose} title={title} emoji={emoji}><div className="space-y-3"><p className="text-sm text-text-secondary">{description}</p><Field label="사유"><textarea className="input-field w-full min-h-24" value={reason} onChange={(e) => setReason(e.target.value)}/></Field><button className="btn-primary w-full" disabled={busy || reason.trim().length < 2} onClick={() => onConfirm(reason.trim())}>확인</button></div></Modal>;
}

function StateBadge({ state }: { state: string }) { return <span className={`text-2xs rounded-full px-2 py-1 font-black ${stateStyle[state] ?? 'bg-bg-deep text-text-muted'}`}>{stateLabel[state] ?? state}</span>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="text-2xs font-black text-text-muted">{label}</div><div className="font-display text-lg mt-1">{value}</div></div>; }
function Th({ children }: { children: ReactNode }) { return <th className="px-3 py-2 text-left font-black">{children}</th>; }
function Td({ children }: { children: ReactNode }) { return <td className="px-3 py-2">{children}</td>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="text-xs font-black text-text-muted block mb-1">{label}</span>{children}</label>; }
function toLocalParts(value: string) { const d = new Date(value); const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString(); return { date: x.slice(0, 10), hour: x.slice(11, 13), minute: x.slice(14, 16) }; }
