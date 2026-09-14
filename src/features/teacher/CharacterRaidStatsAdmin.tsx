import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner, useRpcCall } from '@/components/shared/components';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import {
  characterRaidAdminRpc,
  type CharacterRaidElement,
  type TeacherCharacterRaidStatRow,
} from '@/lib/rpc/character_raid_admin_rpc';
import { cn } from '@/lib/utils/cn';

// CHARACTER_RAID_STATS_ADMIN_V1
// Teacher-only editor for Shard resonance / raid critical bonus.

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
type ElementFilter = 'ALL' | CharacterRaidElement;
type DraftValue = { power: string; crit: string };

const ELEMENTS: Array<{ key: ElementFilter; label: string }> = [
  { key: 'ALL', label: '전체 속성' },
  { key: 'FIRE', label: '🔥 화' },
  { key: 'WATER', label: '💧 수' },
  { key: 'WIND', label: '💫 풍' },
  { key: 'EARTH', label: '🪨 토' },
  { key: 'LIGHT', label: '✦ 빛' },
  { key: 'DARK', label: '☾ 암' },
];

const ELEMENT_META: Record<CharacterRaidElement, { label: string; icon: string; className: string }> = {
  FIRE: { label: '화', icon: '🔥', className: 'border-red-400/50 bg-red-500/15 text-red-100' },
  WATER: { label: '수', icon: '💧', className: 'border-blue-400/50 bg-blue-500/15 text-blue-100' },
  WIND: { label: '풍', icon: '💫', className: 'border-yellow-300/50 bg-yellow-400/15 text-yellow-100' },
  EARTH: { label: '토', icon: '🪨', className: 'border-amber-700/70 bg-amber-900/35 text-amber-100' },
  LIGHT: { label: '빛', icon: '✦', className: 'border-yellow-200/70 bg-gradient-to-r from-yellow-400/20 via-white/10 to-amber-400/20 text-yellow-100 shadow-[0_0_14px_rgba(250,204,21,0.18)]' },
  DARK: { label: '암', icon: '☾', className: 'border-purple-400/60 bg-gradient-to-r from-purple-600/25 via-fuchsia-500/10 to-violet-600/25 text-purple-100 shadow-[0_0_14px_rgba(168,85,247,0.18)]' },
};

export default function CharacterRaidStatsAdmin() {
  const queryClient = useQueryClient();
  const { call } = useRpcCall();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [elementFilter, setElementFilter] = useState<ElementFilter>('ALL');
  const [drafts, setDrafts] = useState<Record<number, DraftValue>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const statsQuery = useQuery<TeacherCharacterRaidStatRow[]>({
    queryKey: ['teacher-character-raid-stats'],
    queryFn: async () => {
      const result = await characterRaidAdminRpc.list(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data ?? [];
    },
  });

  const rows = statsQuery.data ?? [];
  const activeRows = useMemo(() => rows.filter((row) => row.is_active), [rows]);
  const totalPower = useMemo(
    () => activeRows.reduce((sum, row) => sum + Number(row.raid_power ?? 0), 0),
    [activeRows],
  );
  const averagePower = activeRows.length > 0 ? Math.round(totalPower / activeRows.length) : 0;
  const highestCritBp = useMemo(
    () => activeRows.reduce((max, row) => Math.max(max, Number(row.raid_crit_bonus_bp ?? 0)), 0),
    [activeRows],
  );

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    return rows.filter((row) => {
      if (statusFilter === 'ACTIVE' && !row.is_active) return false;
      if (statusFilter === 'INACTIVE' && row.is_active) return false;
      if (elementFilter !== 'ALL') {
        if (row.primary_element !== elementFilter && row.secondary_element !== elementFilter) return false;
      }
      if (!needle) return true;
      return [row.character_uid, row.name, row.epithet]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [elementFilter, rows, search, statusFilter]);

  const dirtyCount = useMemo(
    () => rows.filter((row) => isRowDirty(row, drafts[row.character_id])).length,
    [drafts, rows],
  );

  const updateDraft = (row: TeacherCharacterRaidStatRow, key: keyof DraftValue, value: string) => {
    setDrafts((current) => ({
      ...current,
      [row.character_id]: {
        power: current[row.character_id]?.power ?? String(row.raid_power),
        crit: current[row.character_id]?.crit ?? formatCritBp(row.raid_crit_bonus_bp),
        [key]: value,
      },
    }));
  };

  const resetDraft = (characterId: number) => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[characterId];
      return next;
    });
  };

  const saveRow = async (row: TeacherCharacterRaidStatRow) => {
    const draft = drafts[row.character_id];
    if (!draft || !isRowDirty(row, draft)) return;

    const power = Number(draft.power);
    const critPercent = Number(draft.crit);
    if (!Number.isInteger(power) || power < 0) {
      window.alert('공명력은 0 이상의 정수로 입력해주세요.');
      return;
    }
    if (!Number.isFinite(critPercent) || critPercent < 0 || critPercent > 100) {
      window.alert('치명타율은 0.00% ~ 100.00% 범위로 입력해주세요.');
      return;
    }
    const critBp = Math.round(critPercent * 100);

    const before = `공명력 ${formatNumber(row.raid_power)} / 치명타율 +${formatCritBp(row.raid_crit_bonus_bp)}%`;
    const after = `공명력 ${formatNumber(power)} / 치명타율 +${formatCritBp(critBp)}%`;
    if (!window.confirm(`${row.character_uid} ${row.name}\n\n${before}\n→ ${after}\n\n이 값으로 저장할까요?`)) return;

    setSavingId(row.character_id);
    try {
      await call(
        () => characterRaidAdminRpc.update(supabase, row.character_id, power, critBp),
        {
          successTitle: `${row.name} 능력치 저장 완료`,
          successDescription: after,
          onSuccess: () => {
            resetDraft(row.character_id);
            void queryClient.invalidateQueries({ queryKey: ['teacher-character-raid-stats'] });
            void queryClient.invalidateQueries({ queryKey: ['character-raid-stats'] });
          },
        },
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <TeacherShell>
      <div className="space-y-5 pb-10">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-1 text-xs font-black uppercase tracking-[0.16em] text-crystal">RAID CONTROL · SHARD STATS</div>
            <h1 className="font-display text-2xl tracking-tight text-brand-gradient">⚡ 편린 능력치 관리</h1>
            <p className="mt-1 text-sm font-bold text-amber-100">
              레이드와 원정대에 사용되는 편린별 공명력과 자체 치명타율을 직접 조정합니다.
            </p>
          </div>
          <button type="button" onClick={() => void statsQuery.refetch()} className="btn-secondary self-start lg:self-auto">
            ↻ 새로고침
          </button>
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard icon="✦" label="활성 편린" value={`${activeRows.length}종`} tone="crystal" />
          <SummaryCard icon="⚡" label="총 공명력" value={formatNumber(totalPower)} tone="gold" />
          <SummaryCard icon="◇" label="평균 공명력" value={formatNumber(averagePower)} tone="white" />
          <SummaryCard icon="🎯" label="최고 자체 치명타율" value={`+${formatCritBp(highestCritBp)}%`} tone="success" />
        </section>

        <section className="rounded-card-lg border border-line bg-bg-card p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2">
              {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={cn(
                    'rounded-pill border px-3 py-2 text-xs font-black transition',
                    statusFilter === key
                      ? 'border-gold/70 bg-gold/15 text-yellow-100'
                      : 'border-line bg-bg-deep text-white hover:border-crystal/50',
                  )}
                >
                  {key === 'ALL' ? '전체' : key === 'ACTIVE' ? '활성' : '비활성'}
                </button>
              ))}
              <select
                value={elementFilter}
                onChange={(event) => setElementFilter(event.target.value as ElementFilter)}
                className="rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-black text-white outline-none focus:border-crystal/70"
              >
                {ELEMENTS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2 xl:max-w-md">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="UID · 이름 · 수식어 검색"
                className="min-w-0 flex-1 rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-sm font-bold text-white outline-none placeholder:text-amber-100/60 focus:border-crystal/70"
              />
              {dirtyCount > 0 && (
                <span className="whitespace-nowrap rounded-pill border border-gold/50 bg-gold/15 px-3 py-2 text-xs font-black text-yellow-100">
                  미저장 {dirtyCount}건
                </span>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs font-bold text-cyan-100">
            치명타율은 % 단위로 입력합니다. 예: 1.80 입력 → 편린 자체 치명타율 +1.80%.
          </p>
        </section>

        {statsQuery.isLoading ? (
          <div className="flex min-h-[420px] items-center justify-center"><LoadingSpinner size="lg" /></div>
        ) : statsQuery.isError ? (
          <div className="rounded-card-lg border border-danger/50 bg-danger-bg p-6 text-center">
            <div className="text-3xl">⚠️</div>
            <h2 className="mt-2 font-display text-lg text-white">편린 능력치를 불러오지 못했습니다</h2>
            <p className="mt-2 break-all text-sm font-bold text-red-100">
              {statsQuery.error instanceof Error ? statsQuery.error.message : '알 수 없는 오류'}
            </p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-card-lg border border-line bg-bg-card">
            <EmptyState emoji="🔎" title="조건에 맞는 편린이 없습니다" description="검색어나 필터를 바꿔보세요." />
          </div>
        ) : (
          <section className="space-y-2">
            <div className="px-1 text-xs font-black text-amber-100">
              {filteredRows.length} / {rows.length}종 표시
            </div>
            {filteredRows.map((row) => {
              const draft = drafts[row.character_id];
              const powerValue = draft?.power ?? String(row.raid_power);
              const critValue = draft?.crit ?? formatCritBp(row.raid_crit_bonus_bp);
              const dirty = isRowDirty(row, draft);
              const saving = savingId === row.character_id;
              return (
                <article
                  key={row.character_id}
                  className={cn(
                    'grid gap-4 rounded-card-lg border bg-bg-card p-4 transition lg:grid-cols-[minmax(250px,1.2fr)_minmax(180px,0.65fr)_minmax(180px,0.65fr)_auto] lg:items-center',
                    dirty ? 'border-gold/70 shadow-[0_0_18px_rgba(245,158,11,0.08)]' : 'border-line',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-pill border border-crystal/40 bg-crystal/10 px-2 py-1 font-mono text-[11px] font-black text-cyan-100">
                        {row.character_uid}
                      </span>
                      {!row.is_active && (
                        <span className="rounded-pill border border-warning/50 bg-warning/10 px-2 py-1 text-[10px] font-black text-yellow-100">비활성</span>
                      )}
                    </div>
                    <div className="mt-2 text-lg font-black text-white">
                      {row.epithet ? <span className="mr-2 text-amber-100">「{row.epithet}」</span> : null}
                      {row.name}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {row.primary_element && (
                        <ElementBadge element={row.primary_element} points={row.primary_points} />
                      )}
                      {row.secondary_element && Number(row.secondary_points ?? 0) > 0 && (
                        <ElementBadge element={row.secondary_element} points={row.secondary_points} />
                      )}
                    </div>
                  </div>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-black text-yellow-100">⚡ 공명력</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={powerValue}
                      onChange={(event) => updateDraft(row, 'power', event.target.value)}
                      className="w-full rounded-card-md border border-gold/35 bg-bg-deep px-3 py-2.5 font-mono text-base font-black text-white outline-none focus:border-gold/80"
                    />
                    <span className="mt-1 block text-[11px] font-bold text-amber-100">현재 저장값 {formatNumber(row.raid_power)}</span>
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-black text-cyan-100">🎯 치명타율 (%)</span>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        value={critValue}
                        onChange={(event) => updateDraft(row, 'crit', event.target.value)}
                        className="w-full rounded-card-md border border-crystal/35 bg-bg-deep px-3 py-2.5 pr-8 font-mono text-base font-black text-white outline-none focus:border-crystal/80"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-black text-cyan-100">%</span>
                    </div>
                    <span className="mt-1 block text-[11px] font-bold text-cyan-100">현재 +{formatCritBp(row.raid_crit_bonus_bp)}%</span>
                  </label>

                  <div className="flex gap-2 lg:justify-end">
                    {dirty && (
                      <button
                        type="button"
                        onClick={() => resetDraft(row.character_id)}
                        disabled={saving}
                        className="rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-xs font-black text-white transition hover:border-white/40 disabled:opacity-50"
                      >
                        되돌리기
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void saveRow(row)}
                      disabled={!dirty || saving}
                      className="btn-primary min-w-[88px] px-4 py-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {saving ? '저장 중...' : dirty ? '저장' : '저장됨'}
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </TeacherShell>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'gold' | 'crystal' | 'success' | 'white';
}) {
  const toneClass = {
    gold: 'border-gold/40 text-yellow-100',
    crystal: 'border-crystal/40 text-cyan-100',
    success: 'border-success/40 text-emerald-100',
    white: 'border-white/25 text-white',
  }[tone];
  return (
    <div className={cn('rounded-card-lg border bg-bg-card p-4', toneClass)}>
      <div className="flex items-center gap-2 text-xs font-black"><span className="text-lg">{icon}</span>{label}</div>
      <div className="mt-2 font-mono text-xl font-black text-white">{value}</div>
    </div>
  );
}

function ElementBadge({ element, points }: { element: CharacterRaidElement; points: number | null }) {
  const meta = ELEMENT_META[element];
  return (
    <span className={cn('rounded-pill border px-2.5 py-1 text-[11px] font-black', meta.className)}>
      {meta.icon} {meta.label} {Number(points ?? 0)}
    </span>
  );
}

function isRowDirty(row: TeacherCharacterRaidStatRow, draft: DraftValue | undefined) {
  if (!draft) return false;
  const power = Number(draft.power);
  const crit = Number(draft.crit);
  if (!Number.isFinite(power) || !Number.isFinite(crit)) return true;
  return power !== Number(row.raid_power) || Math.round(crit * 100) !== Number(row.raid_crit_bonus_bp);
}

function formatCritBp(value: number) {
  return (Number(value ?? 0) / 100).toFixed(2);
}

function formatNumber(value: number) {
  return Number(value ?? 0).toLocaleString('ko-KR');
}
