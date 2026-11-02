import { useRef, useState } from 'react';
import { arcadeErrorMessage, arcadeTeacherRpc, type ArcadeForceFinalizePlan, type ArcadeForceFinalizePreview, type ArcadeForceFinalizeResult } from '@/lib/rpc/arcade_rpc';
import { supabase } from '@/lib/supabase/client';

interface PeriodLike {
  id: number;
  period_kind: 'MONTHLY' | 'SEASON';
  display_name: string;
  status: 'DRAFT' | 'ACTIVE' | 'VERIFICATION' | 'READY_TO_FINALIZE' | 'FINALIZED';
  ends_at_exclusive: string;
}

const PLAN_LABEL: Record<ArcadeForceFinalizePlan, { label: string; tone: string }> = {
  FINALIZE_SUCCESS: { label: '인증 성공 반영 (동결 기록·인증 최고점 중 높은 점수)', tone: 'text-emerald-200' },
  ADOPT_BEST_VERIFICATION: { label: '일반 기록 없음 → 유효 인증 최고점 채택', tone: 'text-emerald-200' },
  ADOPT_FROZEN_RECORD: { label: '보상권 미완료 → 동결 기록 채택', tone: 'text-amber-100' },
  CLOSE_KEEP_FROZEN_RANK: { label: '보상권 밖 미완료 → 세션 종료 (순위는 동결 기록)', tone: 'text-sky-100' },
  NO_RECORD: { label: '일반·인증 기록 모두 없음 → 공식 기록 없음', tone: 'text-rose-200' },
};

const SOURCE_LABEL = { OFFICIAL: '공인 확정', VERIFIED_NOW: '인증 반영', FROZEN_RECORD: '동결 기록' } as const;

/**
 * 운영국(교사) 전용: 미완료 학생이 남아 있어도 이번 달 Arcade를 즉시 확정.
 * 1) 영향 미리보기 → 2) 사유 + 확인 → 3) 서버 한 트랜잭션으로 확정(실패 시 전부 취소).
 */
export function TeacherArcadeForceFinalizePanel({ periods, onDone }: { periods: PeriodLike[]; onDone: () => void }) {
  const candidates = periods.filter((p) => p.period_kind === 'MONTHLY' && ['ACTIVE', 'VERIFICATION', 'READY_TO_FINALIZE'].includes(p.status));
  const [periodId, setPeriodId] = useState<number | null>(null);
  const period = candidates.find((p) => p.id === periodId) ?? candidates.find((p) => p.status !== 'ACTIVE') ?? candidates[0] ?? null;
  const [preview, setPreview] = useState<ArcadeForceFinalizePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [reason, setReason] = useState('미완료 학생이 있어 현재 기록으로 이번 달 Arcade를 확정');
  const [endNow, setEndNow] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ArcadeForceFinalizeResult | null>(null);

  const loadPreview = async () => {
    if (!period) return;
    setLoading(true); setError(null); setResult(null); setConfirmed(false);
    const rpc = await arcadeTeacherRpc.getForceFinalizePreview(supabase, { p_period_id: period.id });
    setLoading(false);
    if (rpc.success === false) { setError(arcadeErrorMessage(rpc)); setPreview(null); return; }
    setPreview(rpc.data);
  };

  const execute = async () => {
    if (!preview || runningRef.current) return;
    runningRef.current = true; setRunning(true); setError(null);
    try {
      const rpc = await arcadeTeacherRpc.forceFinalizePeriod(supabase, { p_period_id: preview.period_id, p_reason: reason.trim(), p_end_running_period: endNow });
      if (rpc.success === false) { setError(`${arcadeErrorMessage(rpc)}${rpc.type === 'SERVER' && rpc.code ? ` (${rpc.code})` : ''} — 아무것도 변경되지 않았습니다.`); return; }
      setResult(rpc.data);
      setPreview(null);
      onDone();
    } finally {
      runningRef.current = false; setRunning(false);
    }
  };

  const reasonOk = reason.trim().length >= 2 && reason.trim().length <= 500;
  const endFlagOk = !preview?.requires_end_flag || endNow;
  const canRun = Boolean(preview && preview.can_execute && !preview.already_finalized && reasonOk && endFlagOk && confirmed && !running);

  return <section id="arcade-force-finalize" className="glass-card border-rose-300/40 p-5">
    <div className="mb-4">
      <div className="text-xs font-black tracking-[0.16em] text-rose-200">MONTHLY FORCE FINALIZE</div>
      <h2 className="mt-1 font-display text-lg text-white">⏹ 미완료 포함 즉시 확정</h2>
      <p className="mt-1 text-xs text-white/85">공인 도전이 끝나지 않은 학생이 있어도 이번 달 Arcade(집중 반응·순수 반응속도·라카루카·스타링크)를 지금 확정합니다. 먼저 영향을 미리 보고, 사유를 적은 뒤 확정하세요. 서버가 한 번에 처리하며 중간에 실패하면 아무것도 바뀌지 않습니다.</p>
    </div>

    {!candidates.length ? <p className="rounded-card-md border border-white/15 bg-[#0d1330] p-4 text-sm text-white/85">확정할 수 있는 월간 기간이 없습니다.</p> : <>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select className="input-field min-w-0 flex-1" value={period?.id ?? ''} onChange={(e) => { setPeriodId(Number(e.target.value)); setPreview(null); setResult(null); }}>
          {candidates.map((p) => <option key={p.id} value={p.id}>{p.display_name} · {p.status === 'ACTIVE' ? '진행 중' : p.status === 'VERIFICATION' ? '인증 중' : '확정 대기'}</option>)}
        </select>
        <button className="btn-secondary" disabled={!period || loading || running} onClick={() => void loadPreview()}>{loading ? '계산 중...' : '🔍 확정 영향 미리보기'}</button>
      </div>

      {error && <p className="mt-3 rounded-card-md border border-rose-300/50 bg-rose-500/15 p-3 text-sm font-bold text-rose-100">{error}</p>}

      {result && <div className="mt-4 rounded-card-md border border-emerald-300/40 bg-emerald-500/10 p-4 text-sm text-white">
        <b className="text-emerald-200">{result.already_finalized ? '이미 확정된 기간입니다.' : '월간 Arcade를 확정했어요.'}</b>
        {!result.already_finalized && <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
          <li>진행 중 인증 플레이 기술 취소(기회 미차감): <b>{result.cancelled_verification_runs ?? 0}건</b></li>
          <li>인증 성공 반영: <b>{(result.finalized_success_sessions ?? 0) + (result.adopted_best_verification ?? 0)}명</b></li>
          <li>미완료 보상권 → 동결 기록 채택: <b>{result.adopted_provisional_results ?? 0}명</b></li>
          <li>종료된 인증 세션: <b>{result.overridden_sessions ?? 0}개</b></li>
          <li>라카루카 미완주 도전 종료: <b>{result.cancelled_rakaruka_sessions ?? 0}명</b></li>
          <li>월간 스냅샷: <b>{result.snapshot_count ?? 0}개 게임</b> · Guild 2 반영 완료</li>
        </ul>}
      </div>}

      {preview && <div className="mt-4 space-y-3">
        <div className="rounded-card-md border border-white/15 bg-[#0d1330] p-3 text-xs text-white">
          <b>{preview.period_name}</b> · 현재 상태 <b className="text-amber-100">{preview.status}</b> · Guild 2 반영월 <b>{preview.year_month}</b>
          {preview.already_finalized && <span className="ml-2 font-black text-emerald-200">이미 확정됨</span>}
          {preview.needs_freeze && <p className="mt-1 text-amber-100">일반 기록이 아직 동결되지 않았습니다. 확정하면 지금 기록을 동결합니다{preview.standard_runs_to_expire ? ` (방금 시작된 일반 플레이 ${preview.standard_runs_to_expire}건은 기록 없이 종료)` : ''}.</p>}
          {preview.requires_end_flag && <label className="mt-2 flex items-center gap-2 font-bold text-rose-100"><input type="checkbox" checked={endNow} onChange={(e) => setEndNow(e.target.checked)} />이 기간은 아직 진행 중입니다. 지금 종료하고 확정합니다.</label>}
        </div>

        {(preview.games ?? []).map((g) => <div key={g.game_id} className="rounded-card-md border border-white/15 bg-[#0d1330] p-3 text-xs text-white">
          <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{gameLabel(g.game_code, g.game_name)}</b>
            {g.frozen ? <span>활성 인증 세션 <b>{g.active_sessions ?? 0}</b> · 진행 중 플레이 <b className={g.in_progress_runs ? 'text-rose-200' : ''}>{g.in_progress_runs ?? 0}</b> · 이미 공인 <b>{g.already_official ?? 0}</b>{g.verification_closed ? ' · 인증 마감됨' : ''}</span>
              : <span>동결 대상 학생 <b>{g.students_with_record ?? 0}명</b></span>}
          </div>
          {g.plan_counts && <ul className="mt-2 grid gap-1 sm:grid-cols-2">{(Object.keys(PLAN_LABEL) as ArcadeForceFinalizePlan[]).filter((k) => (g.plan_counts?.[k] ?? 0) > 0).map((k) => <li key={k} className={PLAN_LABEL[k].tone}>• {PLAN_LABEL[k].label}: <b>{g.plan_counts![k]}명</b></li>)}</ul>}
          {!!g.projected_top10?.length && <details className="mt-2"><summary className="cursor-pointer font-black text-amber-100">확정 후 예상 Top 10 보기</summary>
            <ol className="mt-2 grid gap-1 sm:grid-cols-2">{g.projected_top10.map((r) => <li key={r.rank}>{r.rank}위 {r.student_name} <b>{Number(r.score).toLocaleString('ko-KR')}</b> <span className="text-sky-100">({SOURCE_LABEL[r.source]})</span></li>)}</ol>
          </details>}
        </div>)}

        {preview.rakaruka && preview.rakaruka.active > 0 && <div className="rounded-card-md border border-amber-200/30 bg-[#0d1330] p-3 text-xs text-amber-100">
          🎲 라카루카 공인 5판 도전 진행 중 <b>{preview.rakaruka.active}명</b> — 미완주로 종료되어 이번 달 라카루카 공식 순위에 들어가지 않습니다:
          <span className="text-white"> {preview.rakaruka.active_sessions.map((s) => `${s.student_name}(${s.games_played}/5판)`).join(', ')}</span>
        </div>}

        {!preview.already_finalized && preview.can_execute && <div className="rounded-card-md border border-rose-300/40 bg-rose-500/10 p-3">
          <label className="block text-xs font-black text-rose-100">확정 사유 (감사 기록에 남습니다)</label>
          <input className="input-field mt-1 w-full" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          <label className="mt-2 flex items-start gap-2 text-xs font-bold text-white"><input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />확정 후에는 이번 달 Arcade 순위·공인 기록·Guild 2 점수를 일반 수정으로 되돌릴 수 없음을 확인했습니다.</label>
          <button className="btn-danger mt-3 w-full" disabled={!canRun} onClick={() => void execute()}>{running ? '확정 처리 중... (창을 닫지 마세요)' : '⏹ 미완료 포함 지금 확정 + Guild 2 반영'}</button>
          {!endFlagOk && <p className="mt-1 text-xs text-rose-100">진행 중인 기간을 지금 종료하는 데 동의해야 확정할 수 있어요.</p>}
        </div>}
        {preview.generated_at && <p className="text-[11px] text-white/80">미리보기 계산 시각: {new Date(preview.generated_at).toLocaleTimeString('ko-KR')} · 학생이 플레이 중이면 실제 확정 시점 상태로 처리됩니다.</p>}
      </div>}
    </>}
  </section>;
}

function gameLabel(code: string, fallback: string) {
  if (code === 'focus_reaction_01') return 'Game #01 · 집중 반응';
  if (code === 'pure_reaction_02') return 'Game #02 · 순수 반응속도';
  if (code === 'starlink_04') return 'Game #04 · 스타링크';
  return fallback;
}
