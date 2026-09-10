import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { EmptyState, LoadingSpinner, Modal, PageHeader, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { newbieSupportRpc, type MentorHelpType, type NewbieQuest, type NewbieStudentBoard, type ProgramMentor } from '@/lib/rpc/newbie_support_rpc';
import { formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

const HELP_LABEL: Record<MentorHelpType, string> = {
  EXPLANATION: '방법 설명',
  COACHING: '코칭·조언',
  CHECKING: '함께 확인',
  TRANSACTION: '거래 참여',
  OTHER: '기타 도움',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '진행 중', SCHEDULED: '시작 대기', IN_PROGRESS: '진행 중', REVIEWING: '기간 종료 · 검토 중', READY_TO_COMPLETE: '최종 완료 가능', COMPLETION_PENDING: '최종 확인 대기', COMPLETED: '정착 완료', EXPIRED: '기간 종료', CANCELLED: '취소', DRAFT: '준비 중',
  PENDING: '검토 대기', APPROVED: '승인', REJECTED: '반려', REVOKED: '승인 회수',
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(new Date(`${value}T00:00:00+09:00`));
}

export default function NewbieSupportPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [claimQuestId, setClaimQuestId] = useState<number | null>(null);
  const [evidenceId, setEvidenceId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [mentorHelp, setMentorHelp] = useState<Record<number, MentorHelpType>>({});
  const [bestMentor, setBestMentor] = useState<number | null>(null);

  const board = useQuery<NewbieStudentBoard>({
    queryKey: ['newbie-support-student-board'],
    queryFn: async () => {
      const result = await newbieSupportRpc.studentBoard(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 10_000,
  });
  const mentorBoard = useQuery({
    queryKey: ['newbie-support-mentor-board'],
    queryFn: async () => {
      const result = await newbieSupportRpc.mentorBoard(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 10_000,
  });

  const refresh = () => {
    void board.refetch();
    void mentorBoard.refetch();
    void queryClient.invalidateQueries({ queryKey: ['newbie-support-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
  };

  const program = board.data?.program ?? null;
  const mentors = board.data?.mentors ?? [];
  const quests = board.data?.quests ?? [];
  const claimQuest = claimQuestId === null ? null : quests.find((q) => q.program_quest_id === claimQuestId) ?? null;
  const approved = program?.approved_count ?? 0;
  const total = program?.total_count ?? 27;
  const progress = total > 0 ? Math.min(100, Math.round((approved / total) * 100)) : 0;
  const eligibleBest = mentors.filter((m) => m.base_reward_eligible);
  const canRequestCompletion = !!program && approved === total && quests.every((q) => q.pending_count === 0) && program.status === 'ACTIVE' && !program.completion_requested_at;

  const openClaim = (quest: NewbieQuest) => {
    setClaimQuestId(quest.program_quest_id);
    setEvidenceId(quest.evidence_candidates[0]?.evidence_ref_id ? Number(quest.evidence_candidates[0].evidence_ref_id) : null);
    setNote('');
    setMentorHelp({});
  };

  const submitClaim = async () => {
    if (!claimQuest || !evidenceId) return;
    const payload = Object.entries(mentorHelp).map(([id, help_type]) => ({ mentor_assignment_id: Number(id), help_type }));
    await call(() => newbieSupportRpc.submitClaim(supabase, {
      p_program_quest_id: claimQuest.program_quest_id,
      p_evidence_ref_id: evidenceId,
      p_mentor_help: payload,
      p_student_note: note.trim() || null,
    }), {
      successTitle: '정착 퀘스트 완료 요청을 보냈어요',
      successDescription: '선생님이 근거를 확인해 승인하면 BV가 지급됩니다.',
      onSuccess: () => { setClaimQuestId(null); refresh(); },
    });
  };

  const requestCompletion = async () => {
    if (!program || !canRequestCompletion) return;
    if (eligibleBest.length > 0 && bestMentor === null) return;
    await call(() => newbieSupportRpc.requestCompletion(supabase, {
      p_program_id: program.program_id,
      p_best_mentor_student_id: bestMentor,
    }), {
      successTitle: '🌱 정착 완료 요청을 보냈어요',
      successDescription: '선생님의 최종 정산 후 완료 보너스와 멘토 보상이 지급됩니다.',
      onSuccess: refresh,
    });
  };

  const mentorAssignments = mentorBoard.data?.assignments ?? [];

  if (board.isLoading || mentorBoard.isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  if (board.isError || mentorBoard.isError) return <EmptyState emoji="⚠️" title="정착 지원 정보를 불러오지 못했어요" description={board.error instanceof Error ? board.error.message : mentorBoard.error instanceof Error ? mentorBoard.error.message : '잠시 후 다시 시도해주세요.'} action={<button className="btn-secondary" onClick={refresh}>다시 불러오기</button>} />;

  return <div className="pb-10">
    <PageHeader title="정착 지원 프로그램" emoji="🌱" onBack={() => navigate('/home')} />
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-5">
      {!program && mentorAssignments.length === 0 && <EmptyState emoji="🌱" title="현재 진행 중인 정착 지원이 없어요" description="정착 대상 또는 멘토로 지정되면 이곳에 진행 상황이 표시됩니다." />}

      {program && <section className="space-y-4">
        <div className="glass-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black text-brand-glow">후발 합류자 정착 프로그램</div>
              <h2 className="mt-1 font-display text-xl text-brand-gradient">🌱 잃어버린 기회를 다시 열기</h2>
              <p className="mt-2 text-sm text-text-secondary">일반 활동의 보상은 모두와 같고, 정착 퀘스트를 추가로 수행해 놓친 참여 기회를 복원합니다.</p>
            </div>
            <span className="rounded-pill border border-line-brand bg-brand-primary/10 px-3 py-1 text-xs font-black text-gold">{STATUS_LABEL[program.effective_status] ?? program.effective_status}</span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <Metric label="완료" value={`${approved} / ${total}`} />
            <Metric label="복원 BV" value={`${formatNumber(program.regular_recovered_bv)} / ${formatNumber(program.regular_pool_bv)}`} />
            <Metric label="전체 완료 보너스" value={`+${formatNumber(program.completion_bonus_bv)} BV`} />
            <Metric label="기간" value={`${dateLabel(program.start_on)} ~ ${dateLabel(program.end_on)}`} />
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-bg-deep"><div className="h-full bg-brand-primary transition-all" style={{ width: `${progress}%` }} /></div>
          <div className="mt-1 text-right text-xs font-black text-text-muted">{progress}%</div>
        </div>

        <div className="glass-card p-4">
          <div className="mb-3 flex items-center justify-between"><h3 className="font-display text-lg">🤝 나의 멘토</h3><span className="text-xs text-text-muted">유효 도움 3회 이상 → 정착 완료 시 2,000 CRYSTAL</span></div>
          <div className="grid gap-2 sm:grid-cols-3">{mentors.map((m) => <div key={m.mentor_assignment_id} className="rounded-card-md border border-line bg-bg-deep p-3"><div className="font-black text-white">{m.brand_name || m.student_name}</div><div className="mt-1 text-xs text-text-secondary">유효 도움 {m.valid_help_count}회 {m.base_reward_eligible ? '✅' : ''}</div>{m.is_best && <div className="mt-2 text-xs font-black text-gold">⭐ Best Mentor</div>}</div>)}</div>
        </div>

        <div className="space-y-3">
          {quests.map((quest) => <QuestCard key={quest.program_quest_id} quest={quest} onRequest={() => openClaim(quest)} disabled={isLoading || program.effective_status !== 'IN_PROGRESS' || program.status !== 'ACTIVE'} />)}
        </div>

        {approved === total && <div className="glass-card border border-success/30 p-5">
          <h3 className="font-display text-lg text-success">🎉 모든 정착 퀘스트 승인 완료</h3>
          {program.completion_requested_at ? <p className="mt-2 text-sm text-text-secondary">최종 완료 요청을 보냈습니다. 선생님의 정산을 기다리고 있어요.</p> : <>
            <p className="mt-2 text-sm text-text-secondary">마지막으로 가장 큰 도움을 준 멘토를 선택하고 정착 완료를 요청하세요.</p>
            {eligibleBest.length > 0 ? <div className="mt-3 grid gap-2 sm:grid-cols-3">{eligibleBest.map((m) => <button key={m.student_id} type="button" onClick={() => setBestMentor(m.student_id)} className={cn('rounded-card-md border p-3 text-left',bestMentor===m.student_id?'border-gold bg-gold/10':'border-line bg-bg-deep')}><div className="font-black text-white">⭐ {m.brand_name || m.student_name}</div><div className="text-xs text-text-muted">유효 도움 {m.valid_help_count}회</div></button>)}</div> : <p className="mt-3 rounded-card-md border border-warning/30 bg-warning-bg p-3 text-xs text-warning">Best Mentor 조건(유효 도움 3회)을 충족한 멘토가 아직 없습니다. 선생님이 최종 정산에서 예외 사유를 확인할 수 있습니다.</p>}
            <button className="btn-primary mt-4" disabled={!canRequestCompletion || isLoading || (eligibleBest.length>0 && bestMentor===null)} onClick={() => void requestCompletion()}>정착 완료 요청</button>
          </>}
        </div>}
      </section>}

      {mentorAssignments.length > 0 && <section className="glass-card p-5">
        <h2 className="font-display text-xl text-brand-gradient">🤝 멘토 활동</h2>
        <p className="mt-1 text-sm text-text-secondary">대신 수행하는 것이 아니라, 정착민이 스스로 할 수 있도록 설명·코칭·확인을 돕는 역할입니다.</p>
        <div className="mt-4 space-y-3">{mentorAssignments.map((a:any) => <div key={a.mentor_assignment_id} className="rounded-card-md border border-line bg-bg-deep p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-black text-white">{a.target_brand_name || a.target_student_name} 정착 지원</div><div className="mt-1 text-xs text-text-secondary">퀘스트 {a.approved_count}/{a.total_count} · 내 유효 도움 {a.my_valid_help_count}/{a.required_help_count}</div></div><span className="text-xs font-black text-gold">{a.base_reward_eligible ? '보상 자격 ✅' : '도움 기록 필요'}</span></div>{a.help_history?.length>0 && <div className="mt-3 space-y-1">{a.help_history.slice(0,5).map((h:any) => <div key={`${h.claim_id}-${h.created_at}`} className="text-xs text-text-muted">• {h.quest_title} · {HELP_LABEL[h.help_type as MentorHelpType] ?? h.help_type} · {h.status==='VALID'?'유효':'확인 중/미인정'}</div>)}</div>}</div>)}</div>
      </section>}
    </div>

    <ClaimModal quest={claimQuest} mentors={mentors} evidenceId={evidenceId} setEvidenceId={setEvidenceId} mentorHelp={mentorHelp} setMentorHelp={setMentorHelp} note={note} setNote={setNote} loading={isLoading} onRefresh={() => void board.refetch()} onClose={() => setClaimQuestId(null)} onSubmit={() => void submitClaim()} />
  </div>;
}

function Metric({ label, value }: { label:string; value:string }) { return <div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="text-[10px] font-black uppercase tracking-wide text-text-muted">{label}</div><div className="mt-1 text-sm font-black text-white">{value}</div></div>; }

function evidenceGuide(questCode?: string): string {
  switch (questCode) {
    case 'P2P_SELL_REVIEW': return '정착 시작 후 서비스를 판매하고 주문이 완료된 뒤, 구매자가 유효한 후기와 평점을 남기면 근거에 나타납니다.';
    case 'P2P_BUY_REVIEW': return '정착 시작 후 친구의 서비스를 구매하고 주문 완료 뒤 직접 후기와 평점을 남기면 근거에 나타납니다.';
    case 'COLLECTION_FIRST': return '정착 시작 당시 이미 완성한 컬렉션은 제외됩니다. 시작 이후 새 편린 컬렉션을 완성하면 근거에 나타납니다.';
    case 'COLLECTION_SECOND': return '첫 번째 컬렉션 퀘스트가 승인된 뒤, 다른 편린 컬렉션을 새로 완성하면 근거에 나타납니다.';
    case 'PUBLIC_REQUEST_DELIVERY': return '이 정착 프로그램에 지정된 공공의뢰를 수락하고 정착 기간 안에 작품을 납품하면 근거에 나타납니다.';
    case 'CLASS_HELP_BONUS_300': return '수업 참여 또는 학급 도움을 한 뒤 선생님이 +300 BV를 지급하면, 그 지급 기록이 자동으로 근거에 나타납니다. 학생이 별도로 기록을 입력할 필요는 없습니다.';
    case 'ARCADE_FOCUS_50000': return '정착 시작 후 집중 반응 일반 플레이에서 50,000점 이상 유효 기록을 만들면 근거에 나타납니다.';
    default: return '아직 서버에서 확인된 완료 기록이 없습니다. 조건을 달성한 뒤 근거를 다시 확인해주세요.';
  }
}

function QuestCard({ quest, onRequest, disabled }: { quest:NewbieQuest; onRequest:()=>void; disabled:boolean }) {
  const done = quest.approved_count;
  const target = quest.target_count;
  const hasOpenSlot = done + quest.pending_count < target;
  const canOpenRequest = hasOpenSlot && !disabled;
  const buttonLabel = done >= target ? '완료' : !hasOpenSlot ? '검토 대기 중' : '완료 요청';
  return <div className="glass-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="rounded-pill bg-brand-primary/15 px-2 py-0.5 text-[10px] font-black text-brand-glow">{done}/{target}</span><h3 className="font-black text-white">{quest.title}</h3></div><p className="mt-1 text-xs text-text-secondary">{quest.description}</p>{quest.quest_code==='CLASS_HELP_BONUS_300'&&<p className="mt-2 text-xs leading-5 text-gold/90">💡 선생님이 수업 참여·학급 도움 보상으로 +300 BV를 지급한 기록이 완료 근거가 됩니다.</p>}</div><button className="btn-secondary text-xs" disabled={!canOpenRequest} onClick={onRequest}>{buttonLabel}</button></div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{quest.slots.map((slot) => <div key={slot.slot_id} className="rounded-card-md border border-line bg-bg-deep px-3 py-2"><div className="flex items-center justify-between text-xs"><span className="font-black text-text-secondary">{slot.occurrence_no}회차</span><span className="font-black text-bv">+{formatNumber(slot.reward_bv)} BV</span></div>{slot.claim && <div className={cn('mt-1 text-[10px] font-black',slot.claim.status==='APPROVED'?'text-success':slot.claim.status==='PENDING'?'text-warning':'text-text-muted')}>{STATUS_LABEL[slot.claim.status] ?? slot.claim.status}{slot.claim.review_note ? ' · ' + slot.claim.review_note : ''}</div>}</div>)}</div>
  </div>;
}

function ClaimModal({ quest, mentors, evidenceId, setEvidenceId, mentorHelp, setMentorHelp, note, setNote, loading, onRefresh, onClose, onSubmit }: {
  quest:NewbieQuest|null; mentors:ProgramMentor[]; evidenceId:number|null; setEvidenceId:(id:number|null)=>void;
  mentorHelp:Record<number,MentorHelpType>; setMentorHelp:(v:Record<number,MentorHelpType>)=>void; note:string; setNote:(v:string)=>void; loading:boolean; onRefresh:()=>void; onClose:()=>void; onSubmit:()=>void;
}) {
  const candidates = quest?.evidence_candidates ?? [];
  const evidenceIsSelectable = evidenceId !== null && candidates.some((c:any) => Number(c.evidence_ref_id) === evidenceId);
  const selected = evidenceIsSelectable ? candidates.find((c:any) => Number(c.evidence_ref_id) === evidenceId) as any : undefined;
  const hasEvidence = candidates.length > 0;
  return <Modal isOpen={!!quest} onClose={onClose} title={quest?.title ?? '정착 퀘스트'} emoji="🌱" size="lg"><div className="space-y-4">
    {quest?.quest_code==='CLASS_HELP_BONUS_300'&&<div className="rounded-card-md border border-gold/20 bg-gold/5 p-3 text-sm leading-6 text-text-secondary"><b className="text-gold">이 퀘스트는 이렇게 인정돼요.</b><br/>수업 참여나 학급 도움을 한 뒤 선생님이 <b className="text-white">정확히 +300 BV</b>를 지급하면 해당 거래가 자동으로 완료 근거 후보가 됩니다.</div>}
    <div><label className="mb-1 block text-xs font-black text-text-secondary">완료 근거</label>{hasEvidence?<><select className="input-field w-full" value={evidenceIsSelectable ? evidenceId! : ''} onChange={(e)=>setEvidenceId(e.target.value?Number(e.target.value):null)}><option value="">근거 선택</option>{candidates.map((c:any)=><option key={c.evidence_ref_id} value={c.evidence_ref_id}>{c.primary_label}{c.secondary_label ? ' · ' + c.secondary_label : ''}</option>)}</select>{selected && <div className="mt-2 rounded-card-md border border-line bg-bg-deep p-3 text-xs text-text-secondary"><div className="font-black text-white">{selected.primary_label}</div>{selected.secondary_label && <div>{selected.secondary_label}</div>}<div className="mt-1">{selected.summary}</div></div>}</>:<div className="rounded-card-lg border border-line bg-bg-deep p-4"><div className="flex items-start gap-3"><div className="text-xl">🔎</div><div className="min-w-0"><div className="font-black text-white">아직 선택할 수 있는 완료 근거가 없어요</div><p className="mt-1 text-sm leading-6 text-text-secondary">{evidenceGuide(quest?.quest_code)}</p><button type="button" className="btn-secondary mt-3 text-xs" disabled={loading} onClick={onRefresh}>근거 다시 확인</button></div></div></div>}</div>
    <div><div className="mb-2 text-xs font-black text-text-secondary">이번 퀘스트에 도움을 준 멘토 (선택)</div><div className="space-y-2">{mentors.map((m)=>{const checked=mentorHelp[m.mentor_assignment_id]!==undefined;return <div key={m.mentor_assignment_id} className="flex items-center gap-2 rounded-card-md border border-line bg-bg-deep p-2"><input type="checkbox" checked={checked} onChange={(e)=>{const next={...mentorHelp};if(e.target.checked)next[m.mentor_assignment_id]='EXPLANATION';else delete next[m.mentor_assignment_id];setMentorHelp(next);}}/><span className="min-w-0 flex-1 text-sm font-bold text-white">{m.brand_name||m.student_name}</span>{checked&&<select className="input-field py-1 text-xs" value={mentorHelp[m.mentor_assignment_id]} onChange={(e)=>setMentorHelp({...mentorHelp,[m.mentor_assignment_id]:e.target.value as MentorHelpType})}>{Object.entries(HELP_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>}</div>})}</div></div>
    <div><label className="mb-1 block text-xs font-black text-text-secondary">선생님께 남길 메모 (선택)</label><textarea className="input-field min-h-20 w-full" maxLength={500} value={note} onChange={(e)=>setNote(e.target.value)} /></div>
    <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>취소</button><button className="btn-primary" disabled={!evidenceIsSelectable||loading} onClick={onSubmit}>{hasEvidence?'완료 요청 보내기':'근거가 생기면 요청 가능'}</button></div>
  </div></Modal>;
}
