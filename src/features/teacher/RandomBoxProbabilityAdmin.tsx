import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { LoadingSpinner, useRpcCall } from '@/components/shared/components';
import { randomBoxRpc, type TeacherRandomBoxProbabilityAdmin } from '@/lib/rpc/random_box_rpc';
import { supabase } from '@/lib/supabase/client';

type Props = { classroomId: number };

function percentFromBp(bp: number) {
  return (bp / 100).toFixed(bp % 100 === 0 ? 0 : 1);
}

export function RandomBoxProbabilityAdmin({ classroomId }: Props) {
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState(true);
  const [note, setNote] = useState('');
  const [presetName, setPresetName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');

  const query = useQuery<TeacherRandomBoxProbabilityAdmin>({
    queryKey: ['teacher-random-box-probability-admin', classroomId],
    queryFn: async () => {
      const result = await randomBoxRpc.teacherProbabilityAdmin(supabase, classroomId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!query.data) return;
    setDraft(Object.fromEntries(query.data.rewards.map((r) => [r.reward_code, percentFromBp(r.weight_bp)])));
    setReveal(query.data.reveal_probabilities);
  }, [query.data]);

  const parsed = useMemo(() => {
    const weights: Record<string, number> = {};
    let totalBp = 0;
    let valid = true;
    for (const reward of query.data?.rewards ?? []) {
      const n = Number(draft[reward.reward_code] ?? '');
      if (!Number.isFinite(n) || n <= 0) {
        valid = false;
        continue;
      }
      const bp = Math.round(n * 100);
      if (Math.abs(bp / 100 - n) > 0.000001) valid = false;
      weights[reward.reward_code] = bp;
      totalBp += bp;
    }
    return { weights, totalBp, valid: valid && Object.keys(weights).length === (query.data?.rewards.length ?? 0) };
  }, [draft, query.data?.rewards]);

  const totalPercent = parsed.totalBp / 100;
  const canSave = parsed.valid && parsed.totalBp === 10000 && !isLoading;

  const refreshAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['teacher-random-box-probability-admin', classroomId] });
    await queryClient.invalidateQueries({ queryKey: ['student-random-box-board'] });
  };

  const save = async () => {
    if (!canSave) return;
    const result = await call(
      () => randomBoxRpc.teacherSaveProbabilityConfig(supabase, classroomId, parsed.weights, reveal, note),
      { successTitle: '랜덤상자 확률을 저장했습니다' },
    );
    if (result !== null) {
      setNote('');
      await refreshAll();
    }
  };

  const applyPreset = () => {
    const preset = query.data?.presets.find((p) => String(p.id) === selectedPreset);
    if (!preset) return;
    setDraft(Object.fromEntries((query.data?.rewards ?? []).map((r) => [
      r.reward_code,
      percentFromBp(Number(preset.weights[r.reward_code] ?? 0)),
    ])));
  };

  const savePreset = async () => {
    if (!canSave || !presetName.trim()) return;
    const result = await call(
      () => randomBoxRpc.teacherSaveProbabilityPreset(supabase, classroomId, presetName, parsed.weights),
      { successTitle: '확률 프리셋을 저장했습니다' },
    );
    if (result !== null) {
      setPresetName('');
      await refreshAll();
    }
  };

  const deletePreset = async () => {
    const preset = query.data?.presets.find((p) => String(p.id) === selectedPreset);
    if (!preset || preset.name === '기본 확률') return;
    const result = await call(
      () => randomBoxRpc.teacherDeleteProbabilityPreset(supabase, classroomId, preset.id),
      { successTitle: '확률 프리셋을 삭제했습니다' },
    );
    if (result !== null) {
      setSelectedPreset('');
      await refreshAll();
    }
  };

  if (query.isLoading) {
    return <div className="rounded-card-lg border border-line bg-bg-card p-5"><LoadingSpinner size="sm" /></div>;
  }

  if (query.isError || !query.data) {
    return (
      <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-4">
        <div className="font-black text-danger">랜덤상자 확률 설정을 불러오지 못했습니다.</div>
        <div className="mt-1 text-xs font-bold text-text-secondary">{query.error instanceof Error ? query.error.message : '알 수 없는 오류'}</div>
        <button type="button" onClick={() => void query.refetch()} className="btn-secondary mt-3">다시 불러오기</button>
      </div>
    );
  }

  const selected = query.data.presets.find((p) => String(p.id) === selectedPreset);

  return (
    <div className="rounded-card-lg border border-crystal/30 bg-bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-crystal">Random Box · probability control</div>
          <h2 className="mt-1 font-display text-lg text-white">🎲 랜덤상자 확률 설정</h2>
          <p className="mt-1 text-xs font-bold leading-relaxed text-text-secondary">
            저장된 값은 다음 상자 개봉부터 서버 추첨에 즉시 적용됩니다. 합계가 정확히 100%일 때만 저장할 수 있습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          className={`rounded-pill border px-3 py-2 text-xs font-black ${reveal ? 'border-success/40 bg-success-bg text-success' : 'border-line bg-bg-deep text-text-secondary'}`}
        >
          학생 확률 공개 {reveal ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-5">
        {query.data.rewards.map((reward) => (
          <label key={reward.reward_code} className="rounded-card-md border border-line bg-bg-deep p-3">
            <span className="block text-[10px] font-black text-text-muted">{reward.label}</span>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.1"
                value={draft[reward.reward_code] ?? ''}
                onChange={(e) => setDraft((prev) => ({ ...prev, [reward.reward_code]: e.target.value }))}
                className="login-input min-w-0 flex-1 text-right"
              />
              <span className="text-xs font-black text-text-secondary">%</span>
            </div>
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2 rounded-card-md border border-line bg-bg-deep p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-black">
          합계 <span className={parsed.totalBp === 10000 ? 'text-success' : 'text-danger'}>{totalPercent.toFixed(2)}%</span>
          {parsed.totalBp !== 10000 && <span className="ml-2 text-xs text-danger">100.00%가 되어야 저장됩니다.</span>}
        </div>
        <div className="text-[10px] font-bold text-text-muted">1% = 100bp · 서버는 1~10,000 정수 구간으로 추첨</div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_auto]">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={120}
          placeholder="변경 메모 (선택) · 예: 11월 재출시 기본 확률"
          className="login-input"
        />
        <button type="button" disabled={!canSave} onClick={() => void save()} className="btn-primary disabled:opacity-40">
          {isLoading ? '저장 중…' : '확률 저장'}
        </button>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <div className="rounded-card-md border border-line bg-bg-deep p-3">
          <div className="font-black text-white">📌 프리셋</div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <select value={selectedPreset} onChange={(e) => setSelectedPreset(e.target.value)} className="login-input flex-1">
              <option value="">프리셋 선택</option>
              {query.data.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="button" disabled={!selectedPreset} onClick={applyPreset} className="btn-secondary disabled:opacity-40">불러오기</button>
            <button type="button" disabled={!selected || selected.name === '기본 확률'} onClick={() => void deletePreset()} className="btn-secondary disabled:opacity-40">삭제</button>
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} maxLength={40} placeholder="현재 확률을 새 프리셋으로 저장" className="login-input flex-1" />
            <button type="button" disabled={!canSave || !presetName.trim()} onClick={() => void savePreset()} className="btn-secondary disabled:opacity-40">프리셋 저장</button>
          </div>
        </div>

        <div className="rounded-card-md border border-line bg-bg-deep p-3">
          <div className="font-black text-white">🕘 최근 변경 이력</div>
          {query.data.history.length === 0 ? (
            <div className="mt-2 text-xs font-bold text-text-muted">아직 확률 변경 이력이 없습니다.</div>
          ) : (
            <div className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-1">
              {query.data.history.map((h) => (
                <div key={h.id} className="rounded-md border border-line/60 bg-bg-card px-2.5 py-2 text-[10px] font-bold text-text-secondary">
                  <span className="text-white">{new Date(h.created_at).toLocaleString('ko-KR')}</span>
                  <span className="ml-2">{h.change_note || '메모 없음'}</span>
                  <span className="ml-2 text-text-muted">· 학생 공개 {h.reveal_probabilities ? 'ON' : 'OFF'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
