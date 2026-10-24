// RAID_LOOT_V1_2_CONFIG_PANEL_20261018
// 레이드 구성 > 🎁 전리품 설정
// - 저장 시 서버가 모든 값을 다시 검사합니다(가격·이벤트 전용 여부·학급).
// - 전투가 시작되면 저장이 막히므로, 전투 시작 전 마지막 저장값이 곧 "잠긴 설정"입니다.
// - 🎬 연출 미리보기는 지금 입력 중인 값(저장 전 포함)으로 리허설합니다. 지급·기록은 생기지 않습니다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import type { RaidStatus } from '@/lib/rpc/raid_admin_rpc';
import {
  raidLootRpc,
  type RaidLootAvailableCharacter,
  type RaidLootConfigPayload,
  type RaidLootConfigView,
  type RaidLootMode,
  type RaidLootRange,
  type RaidLootRehearsalScript,
  type RaidLootSlot1Kind,
  type RaidLootSlot2Kind,
} from '@/lib/rpc/raid_loot_rpc';
import { RaidLootRehearsalOverlay } from './RaidLootCeremonyOverlay';

type RangeForm = { min: string; max: string; step: string };
type PoolForm = Record<number, { selected: boolean; factor: string }>;

type LootForm = {
  enabled: boolean;
  slot1: { mode: RaidLootMode; gold: RangeForm; crystal: RangeForm; fixedKind: RaidLootSlot1Kind; fixedAmount: string };
  slot2: { mode: RaidLootMode; fragments: RangeForm; fixedKind: RaidLootSlot2Kind; fixedAmount: string; fixedCharacterId: number | null };
  pool: PoolForm;
};

const EMPTY_RANGE: RangeForm = { min: '', max: '', step: '1' };

function rangeToForm(range: RaidLootRange | null | undefined): RangeForm {
  if (!range) return { ...EMPTY_RANGE };
  return { min: String(range.min), max: String(range.max), step: String(range.step ?? 1) };
}

function formToRange(range: RangeForm): RaidLootRange | null {
  if (range.min.trim() === '' && range.max.trim() === '') return null;
  return { min: Number(range.min), max: Number(range.max), step: Number(range.step || 1) };
}

function toNumberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildForm(view: RaidLootConfigView): LootForm {
  const cfg = view.config;
  const pool: PoolForm = {};
  for (const item of cfg?.pool ?? []) {
    pool[item.character_id] = { selected: item.is_selected, factor: String(Number(item.manual_factor ?? 1)) };
  }
  return {
    enabled: cfg?.enabled ?? false,
    slot1: {
      mode: cfg?.slot1?.mode ?? 'AUTO',
      gold: rangeToForm(cfg?.slot1?.gold),
      crystal: rangeToForm(cfg?.slot1?.crystal),
      fixedKind: cfg?.slot1?.fixed_kind ?? 'GOLD',
      fixedAmount: cfg?.slot1?.fixed_amount != null ? String(cfg.slot1.fixed_amount) : '',
    },
    slot2: {
      mode: cfg?.slot2?.mode ?? 'AUTO',
      fragments: rangeToForm(cfg?.slot2?.fragments),
      fixedKind: cfg?.slot2?.fixed_kind ?? 'FRAGMENTS',
      fixedAmount: cfg?.slot2?.fixed_amount != null ? String(cfg.slot2.fixed_amount) : '',
      fixedCharacterId: cfg?.slot2?.fixed_character_id ?? null,
    },
    pool,
  };
}

function buildPayload(form: LootForm, available: RaidLootAvailableCharacter[]): RaidLootConfigPayload {
  const availableIds = new Set(available.map((item) => item.character_id));
  return {
    enabled: form.enabled,
    slot1: {
      mode: form.slot1.mode,
      gold: formToRange(form.slot1.gold),
      crystal: formToRange(form.slot1.crystal),
      fixed_kind: form.slot1.mode === 'AUTO' ? null : form.slot1.fixedKind,
      fixed_amount: form.slot1.mode === 'FIXED_ITEM' ? toNumberOrNull(form.slot1.fixedAmount) : null,
    },
    slot2: {
      mode: form.slot2.mode,
      fragments: formToRange(form.slot2.fragments),
      fixed_kind: form.slot2.mode === 'AUTO' ? null : form.slot2.fixedKind,
      fixed_amount: form.slot2.mode === 'FIXED_ITEM' && form.slot2.fixedKind === 'FRAGMENTS' ? toNumberOrNull(form.slot2.fixedAmount) : null,
      fixed_character_id: form.slot2.mode === 'FIXED_ITEM' && form.slot2.fixedKind === 'CHARACTER' ? form.slot2.fixedCharacterId : null,
    },
    // 지금 후보 조건을 만족하는 편린 중 체크한 것만 보냅니다(서버가 다시 검사).
    pool: Object.entries(form.pool)
      .map(([id, value]) => ({ character_id: Number(id), manual_factor: Number(value.factor || 1), is_selected: value.selected }))
      .filter((item) => item.is_selected && availableIds.has(item.character_id)),
  };
}

function weightOf(price: number, factor: number) {
  return Math.sqrt(1000 / Math.max(1, price)) * (Number.isFinite(factor) ? factor : 1);
}

export default function RaidLootConfigPanel({ raidId, raidStatus }: { raidId: number; raidStatus: RaidStatus }) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['teacher-raid-loot-config', raidId] as const, [raidId]);
  const configQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await raidLootRpc.getConfig(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
  });

  const view = configQuery.data;
  const [form, setForm] = useState<LootForm | null>(null);
  const [loadedVersion, setLoadedVersion] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [copyFrom, setCopyFrom] = useState<number | ''>('');
  const [rehearsalSource, setRehearsalSource] = useState<number | ''>('');
  const [rehearsal, setRehearsal] = useState<{ script: RaidLootRehearsalScript | null; loading: boolean; error: string | null } | null>(null);

  // 서버 값이 바뀌면(처음 로드·저장·복사) 입력 폼을 다시 채웁니다.
  useEffect(() => {
    if (!view) return;
    const key = `${raidId}:${view.config?.config_version ?? 0}:${view.config?.updated_at ?? ''}`;
    if (key === loadedVersion) return;
    setForm(buildForm(view));
    setLoadedVersion(key);
    if (rehearsalSource === '' && view.rehearsal_sources.length > 0) {
      const own = view.rehearsal_sources.find((item) => item.raid_id === raidId);
      setRehearsalSource((own ?? view.rehearsal_sources[0]).raid_id);
    }
  }, [loadedVersion, raidId, rehearsalSource, view]);

  useEffect(() => { setLoadedVersion(null); setMessage(null); }, [raidId]);

  const editable = Boolean(view?.editable) && (raidStatus === 'DRAFT' || raidStatus === 'LOBBY_OPEN');
  const available = view?.available_characters ?? [];

  const poolRows = useMemo(() => {
    if (!form) return [];
    const selected = available.filter((item) => form.pool[item.character_id]?.selected);
    const total = selected.reduce((sum, item) => sum + weightOf(item.base_price_crystal, Number(form.pool[item.character_id]?.factor || 1)), 0);
    return available.map((item) => {
      const entry = form.pool[item.character_id];
      const factor = Number(entry?.factor || 1);
      const weight = weightOf(item.base_price_crystal, factor);
      return {
        ...item,
        selected: Boolean(entry?.selected),
        factor: entry?.factor ?? '1',
        weight,
        probability: entry?.selected && total > 0 ? weight / total : 0,
      };
    });
  }, [available, form]);

  const selectedRows = poolRows.filter((row) => row.selected);
  const inverted = selectedRows.some((a) => selectedRows.some((b) => a.base_price_crystal > b.base_price_crystal && a.weight > b.weight + 1e-9));
  const filteredRows = poolRows.filter((row) => !search.trim() || row.display_name.includes(search.trim()) || (row.character_uid ?? '').includes(search.trim()));
  // RAID_ADMIN_LAYOUT_LOOT_20261023: 전체 선택 체크박스 상태
  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every((row) => row.selected);
  const someVisibleSelected = filteredRows.some((row) => row.selected);
  const fixedCharacter = form?.slot2.fixedCharacterId ? available.find((item) => item.character_id === form.slot2.fixedCharacterId) ?? null : null;

  const update = useCallback((fn: (draft: LootForm) => LootForm) => {
    setForm((current) => (current ? fn(current) : current));
    setMessage(null);
  }, []);

  // 후보 일괄 선택/해제 — 지금 목록에 보이는 편린(검색 중이면 검색 결과)만 바꾸고, 이미 입력한 교사 가중치는 그대로 둡니다.
  const setVisibleSelected = (selected: boolean) => {
    const ids = filteredRows.map((row) => row.character_id);
    update((d) => {
      const pool = { ...d.pool };
      for (const id of ids) pool[id] = { selected, factor: pool[id]?.factor ?? '1' };
      return { ...d, pool };
    });
  };

  const save = async () => {
    if (!form || !view || !editable) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await raidLootRpc.saveConfig(supabase, raidId, buildPayload(form, available), view.config?.config_version ?? null);
      if (result.success === false) {
        setMessage({ tone: 'error', text: result.error });
        return;
      }
      queryClient.setQueryData(queryKey, result.data);
      setMessage({ tone: 'ok', text: form.enabled ? '저장했습니다. 이 레이드는 토벌 성공 시 전리품 획득식을 진행할 수 있습니다.' : '저장했습니다. (전리품 OFF 상태)' });
    } finally {
      setSaving(false);
    }
  };

  // 저장할 수 없는 레이드(지난 레이드 등): 다른 레이드 설정을 "미리보기용으로만" 입력칸에 불러옵니다. 저장하지 않습니다.
  const loadForPreview = async () => {
    if (copyFrom === '') return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await raidLootRpc.getConfig(supabase, Number(copyFrom));
      if (result.success === false) {
        setMessage({ tone: 'error', text: result.error });
        return;
      }
      const other = buildForm(result.data);
      // 이 레이드의 ON/OFF 상태는 바꾸지 않습니다.
      setForm((current) => ({ ...other, enabled: current?.enabled ?? false }));
      setMessage({ tone: 'ok', text: '설정을 미리보기용으로 불러왔어요. (저장되지 않음)' });
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (copyFrom === '' || !editable) return;
    if (!window.confirm('고른 레이드의 전리품 구성(금액·조각 수량·후보 편린·가중치)으로 지금 입력값을 덮어씁니다. 진행할까요?')) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await raidLootRpc.copyConfig(supabase, Number(copyFrom), raidId);
      if (result.success === false) {
        setMessage({ tone: 'error', text: result.error });
        return;
      }
      queryClient.setQueryData(queryKey, result.data);
      const dropped = result.data.copy_dropped ?? [];
      setMessage({ tone: 'ok', text: dropped.length ? `복사했습니다. 다만 조건이 바뀐 편린은 빠졌어요: ${dropped.join(' / ')}` : '설정을 복사했습니다.' });
    } finally {
      setSaving(false);
    }
  };

  const loadRehearsal = useCallback(async () => {
    if (!form || rehearsalSource === '') return;
    setMessage(null);
    setRehearsal({ script: null, loading: true, error: null });
    const result = await raidLootRpc.rehearse(supabase, Number(rehearsalSource), 'DRAFT', null, buildPayload(form, available));
    if (result.success === false) {
      // 설정이 덜 채워진 경우 등: 큰 화면 대신 패널 안에 무엇을 채우면 되는지 보여줍니다.
      setRehearsal(null);
      setMessage({ tone: 'error', text: `연출 미리보기를 시작하지 못했어요. ${result.error.replace('리허설할 설정이 아직 완성되지 않았습니다: ', '먼저 채워 주세요 → ')}` });
      return;
    }
    setRehearsal({ script: result.data, loading: false, error: null });
  }, [available, form, rehearsalSource]);

  if (configQuery.isLoading || !form || !view) {
    if (configQuery.isError) {
      return <div className="mt-5 rounded-card-md border border-red-400/40 bg-red-950/30 p-4 text-base font-bold text-red-100">전리품 설정을 불러오지 못했습니다: {configQuery.error instanceof Error ? configQuery.error.message : '알 수 없는 오류'}</div>;
    }
    return <div className="mt-5 flex min-h-24 items-center justify-center"><LoadingSpinner /></div>;
  }

  return (
    <div className="mt-5 space-y-5">
      {/* 머리말 */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-card-lg border border-amber-300/30 bg-amber-500/5 p-4">
        <div className="min-w-0">
          <h3 className="text-xl font-black text-white">🎁 레이드 전리품 설정</h3>
          <p className="mt-1 text-base font-bold leading-6 text-amber-100">토벌 성공 시 전리품 2개 · 전체 피해량 1% 이상 기여자 추첨 · 기여 1위 가중치는 최하위의 최대 2배 · 적격자 1명이면 두 전리품 독식</p>
          <p className="mt-1 text-sm font-bold text-cyan-100">기존 레이드 골드 보상(성공 100% / 실패 30%, 순위 보너스)은 그대로 지급되며 전리품은 별도입니다.</p>
        </div>
        <label className={cn('flex items-center gap-3 rounded-full border px-4 py-2 text-base font-black', form.enabled ? 'border-amber-200/60 bg-amber-500/20 text-yellow-50' : 'border-cyan-300/30 bg-bg-deep text-cyan-100')}>
          <input type="checkbox" className="h-5 w-5 accent-amber-300" checked={form.enabled} disabled={!editable} onChange={(e) => update((d) => ({ ...d, enabled: e.target.checked }))} />
          {form.enabled ? '전리품 ON' : '전리품 OFF'}
        </label>
      </div>

      {!editable ? (
        <div className="rounded-card-md border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-base font-black text-amber-100">
          <div>🔒 {view.has_ceremony ? '이미 전리품 획득식을 진행한 레이드입니다.' : '전투가 시작된 레이드입니다.'} 이 레이드의 전리품 설정은 저장할 수 없어요.</div>
          <div className="mt-1 text-sm font-bold leading-5 text-yellow-50">
            🎬 미리보기 모드: 아래 칸에 값을 넣어 보면 <b>연출 미리보기에만</b> 쓰이고 저장되지 않아요. 실제로 쓸 설정은 다음 레이드(초안)에서 저장하세요.
          </div>
        </div>
      ) : null}

      {view.drift_warnings.length > 0 ? (
        <div className="rounded-card-md border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-base font-bold leading-6 text-amber-100">
          <div className="font-black">⚠ 저장 후 영입 설정이 바뀌었습니다. {editable ? '다시 저장하면 지금 값으로 맞춰집니다.' : '잠긴 값 그대로 지급됩니다.'}</div>
          {view.drift_warnings.map((w) => <div key={w.character_id}>· {w.message}</div>)}
        </div>
      ) : null}

      {/* 제1전리품 */}
      <section className="rounded-card-lg border border-cyan-300/20 bg-bg-deep p-4">
        <h4 className="text-lg font-black text-white">제1전리품 <span className="ml-2 text-base text-amber-100">GOLD 60% · CRYSTAL 40%</span></h4>
        <ModePicker
          value={form.slot1.mode}
          disabled={saving}
          onChange={(mode) => update((d) => ({ ...d, slot1: { ...d.slot1, mode } }))}
          labels={{ AUTO: '자동 무작위 (60:40)', FIXED_KIND: '종류 지정 (수량은 범위 추첨)', FIXED_ITEM: '종류·수량 모두 고정' }}
        />
        {form.slot1.mode !== 'AUTO' ? (
          <KindPicker
            value={form.slot1.fixedKind}
            options={[['GOLD', '🪙 GOLD'], ['CRYSTAL', '💎 CRYSTAL']]}
            disabled={saving}
            onChange={(kind) => update((d) => ({ ...d, slot1: { ...d.slot1, fixedKind: kind as RaidLootSlot1Kind } }))}
          />
        ) : null}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {form.slot1.mode === 'FIXED_ITEM' ? (
            <AmountInput label={`고정 수량 (${form.slot1.fixedKind})`} value={form.slot1.fixedAmount} disabled={saving} onChange={(v) => update((d) => ({ ...d, slot1: { ...d.slot1, fixedAmount: v } }))} />
          ) : null}
          {(form.slot1.mode === 'AUTO' || (form.slot1.mode === 'FIXED_KIND' && form.slot1.fixedKind === 'GOLD')) ? (
            <RangeInput label="🪙 GOLD 수량 범위" value={form.slot1.gold} disabled={saving} onChange={(v) => update((d) => ({ ...d, slot1: { ...d.slot1, gold: v } }))} />
          ) : null}
          {(form.slot1.mode === 'AUTO' || (form.slot1.mode === 'FIXED_KIND' && form.slot1.fixedKind === 'CRYSTAL')) ? (
            <RangeInput label="💎 CRYSTAL 수량 범위" value={form.slot1.crystal} disabled={saving} onChange={(v) => update((d) => ({ ...d, slot1: { ...d.slot1, crystal: v } }))} />
          ) : null}
        </div>
      </section>

      {/* 제2전리품 */}
      <section className="rounded-card-lg border border-cyan-300/20 bg-bg-deep p-4">
        <h4 className="text-lg font-black text-white">제2전리품 <span className="ml-2 text-base text-amber-100">편린 조각 60% · 완성 편린 40%</span></h4>
        <ModePicker
          value={form.slot2.mode}
          disabled={saving}
          onChange={(mode) => update((d) => ({ ...d, slot2: { ...d.slot2, mode } }))}
          labels={{ AUTO: '자동 무작위 (60:40)', FIXED_KIND: '종류 지정', FIXED_ITEM: '수량 또는 편린 확정' }}
        />
        {form.slot2.mode !== 'AUTO' ? (
          <KindPicker
            value={form.slot2.fixedKind}
            options={[['FRAGMENTS', '🔹 편린 조각'], ['CHARACTER', '✨ 완성 편린']]}
            disabled={saving}
            onChange={(kind) => update((d) => ({ ...d, slot2: { ...d.slot2, fixedKind: kind as RaidLootSlot2Kind } }))}
          />
        ) : null}

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {(form.slot2.mode === 'AUTO' || (form.slot2.mode === 'FIXED_KIND' && form.slot2.fixedKind === 'FRAGMENTS')) ? (
            <RangeInput label="🔹 편린 조각 수량 범위 (원정대 공용 조각)" value={form.slot2.fragments} disabled={saving} onChange={(v) => update((d) => ({ ...d, slot2: { ...d.slot2, fragments: v } }))} />
          ) : null}
          {form.slot2.mode === 'FIXED_ITEM' && form.slot2.fixedKind === 'FRAGMENTS' ? (
            <AmountInput label="고정 조각 수량" value={form.slot2.fixedAmount} disabled={saving} onChange={(v) => update((d) => ({ ...d, slot2: { ...d.slot2, fixedAmount: v } }))} />
          ) : null}
        </div>

        {form.slot2.mode === 'FIXED_ITEM' && form.slot2.fixedKind === 'CHARACTER' ? (
          <div className="mt-3 rounded-card-md border border-amber-200/40 bg-amber-500/10 px-4 py-3 text-base font-black text-yellow-50">
            {fixedCharacter
              ? <>📌 확정 편린: 「{fixedCharacter.display_name}」 · 기준가 {fixedCharacter.base_price_crystal.toLocaleString('ko-KR')}C — 제2전리품은 반드시 이 편린입니다(당첨 학생은 그대로 추첨).</>
              : '아래 목록에서 [이 편린 확정]을 눌러 확정할 편린을 고르세요.'}
          </div>
        ) : null}

        {/* 완성 편린 후보 */}
        {(form.slot2.mode === 'AUTO' || form.slot2.fixedKind === 'CHARACTER') ? (
          <div className="mt-4 rounded-card-md border border-cyan-300/15 bg-black/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-base font-black text-white">
                완성 편린 후보 <span className="ml-1 text-cyan-100">선택 {selectedRows.length} / {poolRows.length}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* RAID_ADMIN_LAYOUT_LOOT_20261023: 전체 선택 체크박스 (검색 중이면 검색 결과만) */}
                <label className={cn('flex items-center gap-2 rounded-card-md border border-cyan-300/40 bg-cyan-500/10 px-3 py-1.5 text-sm font-black text-cyan-50', (saving || form.slot2.mode === 'FIXED_ITEM' || filteredRows.length === 0) && 'opacity-40')}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-cyan-300"
                    checked={allVisibleSelected}
                    ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                    disabled={saving || form.slot2.mode === 'FIXED_ITEM' || filteredRows.length === 0}
                    onChange={(e) => setVisibleSelected(e.target.checked)}
                  />
                  {search.trim() ? '검색 결과 모두 선택' : '모두 선택'}
                </label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="편린 이름 검색"
                  className="w-48 rounded-card-md border border-cyan-300/20 bg-black/30 px-3 py-1.5 text-sm font-bold text-white outline-none focus:border-cyan-300/60"
                />
              </div>
            </div>
            <div className="mt-1 text-sm font-bold leading-5 text-cyan-100">
              크리스탈 영입 · 기준가 1,000C 이상 · 활성 편린만 보입니다. (이벤트 전용 = 한정판은 목록에 나오지 않아요)
              {' '}출현 가중치 = √(1000 ÷ 기준가) × 교사 가중치. 교사 가중치를 바꾸면 그 값이 우선합니다.
            </div>
            {inverted ? (
              <div className="mt-2 rounded-card-md border border-fuchsia-300/40 bg-fuchsia-500/10 px-3 py-2 text-sm font-black text-fuchsia-100">
                ℹ 가격보다 교사 가중치가 우선 적용 중 — 일부 고가 편린이 저가 편린보다 더 잘 나옵니다.
              </div>
            ) : null}
            {/* RAID_ADMIN_LAYOUT_LOOT_20261023: 후보 카드를 2열로 배치 (카드를 눌러도 체크됨) */}
            <div className="mt-3 grid max-h-[520px] gap-1.5 overflow-y-auto pr-1 md:grid-cols-2">
              {filteredRows.length === 0 ? <div className="py-6 text-center text-base font-bold text-amber-100 md:col-span-2">조건을 만족하는 편린이 없습니다.</div> : null}
              {filteredRows.map((row) => {
                const isFixed = form.slot2.fixedCharacterId === row.character_id && form.slot2.mode === 'FIXED_ITEM';
                return (
                  <div key={row.character_id} className={cn('flex min-w-0 items-center gap-2 rounded-card-md border px-2.5 py-2', isFixed ? 'border-amber-200/60 bg-amber-500/10' : row.selected ? 'border-cyan-300/30 bg-cyan-500/5' : 'border-white/10 bg-bg-deep')}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-5 w-5 flex-none accent-cyan-300"
                        checked={row.selected}
                        disabled={saving || form.slot2.mode === 'FIXED_ITEM'}
                        onChange={(e) => update((d) => ({ ...d, pool: { ...d.pool, [row.character_id]: { selected: e.target.checked, factor: d.pool[row.character_id]?.factor ?? '1' } } }))}
                      />
                      {row.image_url ? <img src={row.image_url} alt="" className="h-9 w-9 flex-none rounded-lg object-cover" /> : <span className="flex-none text-2xl">{row.emoji ?? '✨'}</span>}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black text-white">{row.display_name}</span>
                        <span className="block text-xs font-black text-amber-100">{row.base_price_crystal.toLocaleString('ko-KR')}C</span>
                      </span>
                    </label>
                    <div className="flex flex-none flex-col items-end gap-1">
                      <label className="flex items-center gap-1 text-xs font-black text-cyan-100">
                        ×
                        <input
                          type="number"
                          min={0.25}
                          max={4}
                          step={0.25}
                          value={row.factor}
                          aria-label={`${row.display_name} 교사 가중치`}
                          disabled={saving || form.slot2.mode === 'FIXED_ITEM'}
                          onChange={(e) => update((d) => ({ ...d, pool: { ...d.pool, [row.character_id]: { selected: d.pool[row.character_id]?.selected ?? false, factor: e.target.value } } }))}
                          className="w-14 rounded-md border border-cyan-300/20 bg-black/30 px-1.5 py-0.5 text-xs font-bold text-white outline-none disabled:opacity-50"
                        />
                      </label>
                      <span className="text-[11px] font-black text-cyan-100">
                        {row.selected && form.slot2.mode !== 'FIXED_ITEM' ? `출현 ${(row.probability * 100).toFixed(1)}%` : `가중치 ${row.weight.toFixed(3)}`}
                      </span>
                    </div>
                    {form.slot2.mode === 'FIXED_ITEM' && form.slot2.fixedKind === 'CHARACTER' ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => update((d) => ({ ...d, slot2: { ...d.slot2, fixedCharacterId: row.character_id } }))}
                        className={cn('flex-none rounded-card-md border px-2 py-1 text-xs font-black disabled:opacity-40', isFixed ? 'border-amber-200 bg-amber-500/30 text-yellow-50' : 'border-amber-200/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20')}
                      >
                        {isFixed ? '📌 확정됨' : '확정'}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {form.slot2.mode === 'AUTO' || form.slot2.mode === 'FIXED_KIND' ? (
              <div className="mt-2 text-sm font-bold text-cyan-100">
                한 편린을 반드시 내보내려면 제2전리품 방식을 [수량 또는 편린 확정] → [✨ 완성 편린]으로 바꾼 뒤 [이 편린 확정]을 누르세요.
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 rounded-card-md border border-fuchsia-300/25 bg-fuchsia-500/5 px-4 py-2 text-sm font-black text-fuchsia-100">
          중복 완성 편린: 당첨자가 이미 가진 편린이면 기준가 × 90% 크리스탈을 대신 지급합니다 (고정 규칙).
        </div>
      </section>

      {/* 서버 검사 결과 */}
      {view.issues.length > 0 ? (
        <div className="rounded-card-md border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-base font-bold leading-6 text-amber-100">
          <div className="font-black">저장된 설정에서 채워야 할 곳 (전리품을 켜기 전에 필요)</div>
          {view.issues.map((issue) => <div key={issue}>· {issue}</div>)}
        </div>
      ) : null}

      {message ? (
        <div className={cn('rounded-card-md border px-4 py-3 text-base font-black', message.tone === 'ok' ? 'border-emerald-300/40 bg-emerald-500/10 text-emerald-100' : 'border-red-300/40 bg-red-950/40 text-red-100')}>
          {message.text}
        </div>
      ) : null}

      {/* 하단 조작 */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-card-lg border border-cyan-300/20 bg-bg-deep p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-black text-cyan-100">🎬 연출 미리보기에 쓸 지난 레이드</span>
            <select
              value={rehearsalSource}
              onChange={(e) => setRehearsalSource(e.target.value === '' ? '' : Number(e.target.value))}
              className="rounded-card-md border border-cyan-300/20 bg-black/30 px-3 py-2 text-base font-bold text-white"
            >
              {view.rehearsal_sources.length === 0 ? <option value="">토벌 성공한 레이드가 없습니다</option> : null}
              {view.rehearsal_sources.map((item) => (
                <option key={item.raid_id} value={item.raid_id}>{item.title} · {item.boss_name} ({item.participant_count}명)</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadRehearsal()}
            disabled={rehearsalSource === ''}
            className="rounded-card-md border border-cyan-300/50 bg-cyan-500/15 px-4 py-2 text-base font-black text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-40"
          >
            🎬 연출 미리보기
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {view.copy_sources.length > 0 ? (
            <div className="flex items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-sm font-black text-cyan-100">{editable ? '다른 레이드 설정 복사' : '다른 레이드 설정 불러오기 (미리보기용)'}</span>
                <select
                  value={copyFrom}
                  onChange={(e) => setCopyFrom(e.target.value === '' ? '' : Number(e.target.value))}
                  className="rounded-card-md border border-cyan-300/20 bg-black/30 px-3 py-2 text-base font-bold text-white disabled:opacity-50"
                >
                  <option value="">선택</option>
                  {view.copy_sources.map((item) => <option key={item.raid_id} value={item.raid_id}>{item.title}</option>)}
                </select>
              </label>
              {editable ? (
                <button type="button" onClick={() => void copy()} disabled={copyFrom === '' || saving} className="rounded-card-md border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-base font-black text-cyan-100 disabled:opacity-40">복사</button>
              ) : (
                <button type="button" onClick={() => void loadForPreview()} disabled={copyFrom === '' || saving} className="rounded-card-md border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-base font-black text-cyan-100 disabled:opacity-40">불러오기</button>
              )}
            </div>
          ) : null}
          {editable ? (
            <button type="button" onClick={() => void save()} disabled={saving} className="btn-primary text-base disabled:opacity-40">
              {saving ? '저장 중…' : '🎁 전리품 설정 저장'}
            </button>
          ) : (
            <span className="rounded-card-md border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-sm font-black text-amber-100">🔒 이 레이드는 저장 불가 (미리보기 전용)</span>
          )}
        </div>
      </div>
      <div className="text-sm font-bold leading-5 text-cyan-100">
        금액·수량은 선생님이 정하는 값이며 기본값이 없습니다. 미리보기는 지금 입력값(저장 전 포함)으로 지난 레이드의 실제 명단·피해량에 적용해 보여주며, 지급·기록은 생기지 않습니다.
      </div>

      {rehearsal ? (
        <RaidLootRehearsalOverlay
          container="fixed"
          script={rehearsal.script}
          loading={rehearsal.loading}
          error={rehearsal.error}
          onClose={() => setRehearsal(null)}
          onAgain={() => void loadRehearsal()}
        />
      ) : null}
    </div>
  );
}

function ModePicker({ value, onChange, disabled, labels }: { value: RaidLootMode; onChange: (mode: RaidLootMode) => void; disabled: boolean; labels: Record<RaidLootMode, string> }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {(['AUTO', 'FIXED_KIND', 'FIXED_ITEM'] as RaidLootMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          disabled={disabled}
          onClick={() => onChange(mode)}
          className={cn('rounded-card-md border px-3 py-2 text-base font-black disabled:opacity-50', value === mode ? 'border-gold/60 bg-gold/15 text-yellow-100' : 'border-cyan-300/20 bg-black/20 text-cyan-100 hover:border-cyan-300/50')}
        >
          {value === mode ? '● ' : '○ '}{labels[mode]}
        </button>
      ))}
    </div>
  );
}

function KindPicker({ value, options, onChange, disabled }: { value: string; options: Array<[string, string]>; onChange: (kind: string) => void; disabled: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map(([kind, label]) => (
        <button
          key={kind}
          type="button"
          disabled={disabled}
          onClick={() => onChange(kind)}
          className={cn('rounded-full border px-4 py-1.5 text-base font-black disabled:opacity-50', value === kind ? 'border-amber-200/70 bg-amber-500/20 text-yellow-50' : 'border-white/15 bg-black/20 text-white hover:border-amber-200/40')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RangeInput({ label, value, onChange, disabled }: { label: string; value: RangeForm; onChange: (value: RangeForm) => void; disabled: boolean }) {
  const field = (key: keyof RangeForm, text: string) => (
    <label className="block min-w-0">
      <span className="mb-1 block text-sm font-black text-cyan-100">{text}</span>
      <input
        type="number"
        min={1}
        value={value[key]}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
        className="w-full min-w-0 rounded-card-md border border-cyan-300/20 bg-black/30 px-3 py-2 text-base font-bold text-white outline-none focus:border-cyan-300/60 disabled:opacity-50"
      />
    </label>
  );
  return (
    <div className="rounded-card-md border border-cyan-300/15 bg-black/20 p-3">
      <div className="mb-2 text-base font-black text-white">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        {field('min', '최소')}
        {field('max', '최대')}
        {field('step', '간격')}
      </div>
      <div className="mt-1 text-xs font-bold text-cyan-100">최소~최대 사이에서 간격 단위로 같은 확률로 뽑힙니다. (최대−최소)가 간격으로 나누어떨어져야 해요.</div>
    </div>
  );
}

function AmountInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <label className="block rounded-card-md border border-cyan-300/15 bg-black/20 p-3">
      <span className="mb-1 block text-base font-black text-white">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-card-md border border-cyan-300/20 bg-black/30 px-3 py-2 text-base font-bold text-white outline-none focus:border-cyan-300/60 disabled:opacity-50"
      />
    </label>
  );
}
