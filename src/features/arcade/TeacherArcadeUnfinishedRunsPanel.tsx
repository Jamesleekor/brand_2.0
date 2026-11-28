import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

interface UnfinishedRun {
  run_id: number;
  student_name: string;
  brand_name: string | null;
  game_name: string;
  status: string;
  created_at: string;
  play_started_at: string | null;
  blocks_freeze: boolean;
  can_expire: boolean;
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '—';
}

export function TeacherArcadeUnfinishedRunsPanel({ periodId, periodName }: { periodId: number; periodName: string }) {
  const [showHistory, setShowHistory] = useState(false);
  const [reason, setReason] = useState('게임 이탈 또는 비정상 종료로 남은 미종료 기록 정리');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['teacher-arcade-unfinished-runs', periodId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('teacher_list_arcade_unfinished_runs', { p_period_id: periodId });
      if (error) throw new Error(error.message);
      if (!Array.isArray(data)) throw new Error('미종료 기록 응답 형식이 올바르지 않습니다.');
      return data as UnfinishedRun[];
    },
    refetchInterval: 15000,
  });
  const rows = query.data ?? [];
  const blockers = rows.filter((r) => r.blocks_freeze);
  const visible = showHistory ? rows : blockers;

  const expire = async (run: UnfinishedRun) => {
    if (busyId !== null || !run.can_expire || reason.trim().length < 2 || reason.trim().length > 500) return;
    if (!window.confirm(`${run.student_name} · ${run.game_name} (#${run.run_id})\n실제 플레이 중이 아닌지 확인하셨습니까? 종료하면 이 플레이의 결과는 제출할 수 없습니다. 기존 정상 점수는 유지됩니다.`)) return;
    setBusyId(run.run_id); setMessage(null); setError(null);
    try {
      const { error } = await supabase.rpc('teacher_expire_arcade_standard_run', {
        p_period_id: periodId, p_run_id: run.run_id, p_reason: reason.trim(),
      });
      if (error) throw new Error(error.message);
      setMessage(`#${run.run_id} 만료 처리 완료. 공인 도전 개방을 다시 시도하세요.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '종료 요청에 실패했습니다.');
    } finally {
      await query.refetch();
      setBusyId(null);
    }
  };

  return <section className="glass-card border-warning/30 p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-display text-lg text-white">미종료 Arcade 플레이 현황</h2>
        <p className="mt-1 text-xs text-text-secondary">{periodName} · 일반 플레이 전용 · 15초마다 갱신</p></div>
      <button className="btn-secondary" disabled={query.isFetching || busyId !== null} onClick={() => void query.refetch()}>새로고침</button>
    </div>
    <p className="mt-3 text-xs text-text-secondary">공인 도전 동결을 차단하는 최근 15분 이내 기록을 우선 표시합니다. 실제 게임 중인 학생은 종료하지 마세요. 제출된 점수 및 공인 도전은 변경하지 않습니다.</p>
    {query.isLoading ? <p className="mt-3 text-sm text-text-secondary">조회 중...</p> : query.isError ? <p role="alert" className="mt-3 text-sm text-warning">조회 실패: {query.error instanceof Error ? query.error.message : '다시 시도하세요.'}</p> : <>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <b className={blockers.length ? 'text-warning' : 'text-emerald-200'}>동결 차단 {blockers.length}건</b>
        <span className="text-text-secondary">기간 내 미종료 {rows.length}건</span>
        <label className="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} /> 이전 미종료 기록 포함</label>
      </div>
      {visible.length === 0 ? <p className="mt-3 text-sm text-text-secondary">표시할 미종료 기록이 없습니다.</p> : <>
        <label className="mt-3 block text-xs text-text-secondary">강제 종료 사유
          <input className="input-field mt-1 w-full" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="w-full text-left text-xs"><thead><tr className="text-text-secondary"><th className="p-2">학생 / 게임</th><th className="p-2">생성 / 시작 (KST)</th><th className="p-2">상태</th><th className="p-2">조치</th></tr></thead>
          <tbody>{visible.map((run) => <tr key={run.run_id} className="border-t border-line"><td className="p-2 text-white"><b>{run.student_name}</b> {run.brand_name && <span>({run.brand_name})</span>}<div className="text-text-secondary">{run.game_name} · #{run.run_id}</div></td>
            <td className="p-2 text-text-secondary">{formatTime(run.created_at)}<div>{formatTime(run.play_started_at)}</div></td>
            <td className="p-2 text-white">{run.status}{run.blocks_freeze && <div className="text-warning">동결 차단</div>}</td>
            <td className="p-2"><button className="btn-secondary text-xs" disabled={!run.can_expire || busyId !== null || reason.trim().length < 2} onClick={() => void expire(run)}>{busyId === run.run_id ? '종료 중...' : run.can_expire ? '강제 종료' : '제출 보호'}</button></td></tr>)}</tbody></table>
        </div>
      </>}
    </>}
    {message && <p role="status" className="mt-3 text-sm text-emerald-200">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-warning">{error}</p>}
  </section>;
}
