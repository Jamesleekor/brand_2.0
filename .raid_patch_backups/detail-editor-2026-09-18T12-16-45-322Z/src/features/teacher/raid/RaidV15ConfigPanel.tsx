// RAID_V15_E5_CONFIGURATION_PANEL
// RAID_V15_CONFIGURATION_UX_CLEANUP_20260916
// RAID_BETA1_AUDIO_LABEL_FIX_20260918
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  raidV15AdminRpc,
  type RaidV15AudioProfile,
  type RaidV15CombatConfig,
  type RaidV15Pattern,
  type RaidV15PatternType,
  type RaidV15TriggerKind,
} from '@/lib/rpc/raid_v15_admin_rpc';
import type { RaidStatus } from '@/lib/rpc/raid_admin_rpc';
import { cn } from '@/lib/utils/cn';

type TabKey = 'COMBAT' | 'PATTERNS' | 'AUDIO';

type PatternTypeOption = {
  value: RaidV15PatternType;
  label: string;
  name: string;
  common?: boolean;
};

const DEFAULT_COMBAT: RaidV15CombatConfig = {
  enabled: true,
  barrier_base_per_adventurer: 4000,
  barrier_resonance_factor: 0.1,
  presence_window_seconds: 20,
  default_groggy_seconds: 7,
  default_groggy_multiplier: 1.4,
  enrage_boss_damage_multiplier: 1.25,
  enrage_player_damage_multiplier: 1,
  boss_attack_interval_seconds: 10,
  boss_attack_telegraph_seconds: 3,
  boss_attack_fixed_damage: 0,
  boss_attack_barrier_ratio: 0.04,
  boss_attack_name: '차원 충격',
};

const EMPTY_AUDIO: Omit<RaidV15AudioProfile, 'raid_id' | 'configured'> = {
  lobby_bgm_url: null,
  battle_bgm_url: null,
  enrage_bgm_url: null,
  raid_start_sfx_url: null,
  raid_success_bgm_url: null,
  raid_failure_bgm_url: null,
  normal_hit_sfx_url: null,
  crit_hit_sfx_url: null,
  powerful_hit_sfx_url: null,
  devastating_hit_sfx_url: null,
  break_start_sfx_url: null,
  break_success_sfx_url: null,
  break_fail_sfx_url: null,
  barrier_hit_sfx_url: null,
  barrier_critical_sfx_url: null,
  master_volume: 0.85,
  bgm_volume: 0.55,
  sfx_volume: 0.8,
};

const PATTERN_TYPES: PatternTypeOption[] = [
  { value: 'WEAK_POINT', label: '🎯 약점 노출(WEAK_POINT)', name: '약점 노출', common: true },
  { value: 'BREAK', label: '💥 무력화(BREAK)', name: '무력화', common: true },
  { value: 'ENRAGE', label: '🔥 광폭화(ENRAGE)', name: '광폭화', common: true },
  { value: 'ABSORB', label: '🌀 흡수(ABSORB)', name: '흡수' },
  { value: 'REFLECT', label: '↩️ 반사(REFLECT)', name: '반사' },
  { value: 'ULTIMATE', label: '☄️ 필살기 차단(ULTIMATE)', name: '필살기 차단' },
  { value: 'DOT', label: '☠️ 지속 피해(DOT)', name: '지속 피해' },
  { value: 'SHIELD', label: '🛡️ 보호막(SHIELD)', name: '보호막' },
  { value: 'MULTI_CORE', label: '🔷 다중 핵(MULTI_CORE)', name: '다중 핵' },
  { value: 'SPLIT_TARGET', label: '⚖️ 분산 공격(SPLIT_TARGET)', name: '분산 공격' },
  { value: 'REGEN', label: '💚 재생(REGEN)', name: '재생' },
  { value: 'SEAL', label: '🔒 봉인(SEAL)', name: '봉인' },
  { value: 'DAMAGE_CHECK', label: '⏱️ 화력 검증(DAMAGE_CHECK)', name: '화력 검증' },
];

const TRIGGERS: Array<{ value: RaidV15TriggerKind; label: string }> = [
  { value: 'TIME_SECONDS', label: '전투 경과 시간(TIME_SECONDS)' },
  { value: 'TIME_REMAINING', label: '남은 시간(TIME_REMAINING)' },
  { value: 'HP_RATIO', label: '보스 체력(HP_RATIO)' },
  { value: 'BARRIER_RATIO', label: '공명방벽(BARRIER_RATIO)' },
  { value: 'AFTER_PATTERN', label: '다른 패턴 이후(AFTER_PATTERN)' },
  { value: 'RANDOM_WINDOW', label: '무작위 시간창(RANDOM_WINDOW)' },
  { value: 'MANUAL', label: '수동 발동(MANUAL)' },
];

export default function RaidV15ConfigPanel({ raidId, raidStatus }: { raidId: number; raidStatus: RaidStatus }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('COMBAT');
  const [combat, setCombat] = useState<RaidV15CombatConfig>(DEFAULT_COMBAT);
  const [patterns, setPatterns] = useState<RaidV15Pattern[]>([]);
  const [audio, setAudio] = useState<Omit<RaidV15AudioProfile, 'raid_id' | 'configured'>>(EMPTY_AUDIO);
  const [loadedRaid, setLoadedRaid] = useState<number | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const combatQuery = useQuery({
    queryKey: ['teacher-raid-v15-combat', raidId],
    queryFn: async () => {
      const result = await raidV15AdminRpc.combat(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
  });

  const audioQuery = useQuery({
    queryKey: ['teacher-raid-v15-audio', raidId],
    queryFn: async () => {
      const result = await raidV15AdminRpc.audio(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
  });

  useEffect(() => {
    if (loadedRaid === raidId) return;
    if (!combatQuery.data || !audioQuery.data) return;
    setCombat({ ...DEFAULT_COMBAT, ...(combatQuery.data.config ?? {}) });
    setPatterns((combatQuery.data.patterns ?? []).map(normalizePattern));
    const { raid_id: _raidId, configured: _configured, ...audioData } = audioQuery.data;
    setAudio({ ...EMPTY_AUDIO, ...audioData });
    setLoadedRaid(raidId);
  }, [audioQuery.data, combatQuery.data, loadedRaid, raidId]);

  useEffect(() => { setLoadedRaid(null); }, [raidId]);

  const editableCombat = raidStatus === 'DRAFT' || raidStatus === 'LOBBY_OPEN';
  const editableAudio = raidStatus !== 'ARCHIVED';
  const commonPatterns = useMemo(() => patterns.filter((pattern) => isCommon(pattern.pattern_type)), [patterns]);
  const specialPatterns = useMemo(() => patterns.filter((pattern) => !isCommon(pattern.pattern_type)), [patterns]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['teacher-raid-v15-combat', raidId] });
    await queryClient.invalidateQueries({ queryKey: ['teacher-raid-v15-audio', raidId] });
    setLoadedRaid(null);
  };

  const saveCombat = async () => {
    if (!editableCombat || !validateCombat(combat)) return;
    setSaving('COMBAT');
    try {
      const result = await raidV15AdminRpc.saveCombat(supabase, raidId, { config: combat });
      if (result.success === false) return window.alert(result.error);
      window.alert('전투 기믹 설정을 저장했습니다.');
      await refresh();
    } finally {
      setSaving(null);
    }
  };

  const savePatterns = async () => {
    if (!editableCombat) return;
    const normalized = patterns.map((pattern, index) => {
      const { client_key: _clientKey, ...serverPattern } = pattern;
      return {
        ...serverPattern,
        seq: Number(pattern.seq || (index + 1) * 10),
        config: pattern.config ?? {},
      };
    });
    if (!validatePatterns(normalized)) return;
    setSaving('PATTERNS');
    try {
      const result = await raidV15AdminRpc.saveCombat(supabase, raidId, { patterns: normalized });
      if (result.success === false) return window.alert(result.error);
      window.alert('패턴 구성을 저장했습니다.');
      await refresh();
    } finally {
      setSaving(null);
    }
  };

  const triggerManual = async (pattern: RaidV15Pattern) => {
    if (raidStatus !== 'ACTIVE') return window.alert('수동 패턴은 전투 진행(ACTIVE) 상태에서만 발동할 수 있습니다.');
    if (!pattern.id) return window.alert('수동 패턴을 먼저 저장해주세요.');
    const key = `TRIGGER-${pattern.id}`;
    setSaving(key);
    try {
      const result = await raidV15AdminRpc.triggerPattern(supabase, raidId, pattern.id);
      if (result.success === false) return window.alert(result.error);
      window.alert(`수동 패턴 발동: ${result.data?.pattern_name ?? pattern.name}`);
      await refresh();
    } finally {
      setSaving(null);
    }
  };

  const saveAudio = async () => {
    if (!editableAudio) return;
    setSaving('AUDIO');
    try {
      const result = await raidV15AdminRpc.saveAudio(supabase, raidId, audio);
      if (result.success === false) return window.alert(result.error);
      window.alert('중계 오디오 프로필을 저장했습니다.');
      await refresh();
    } finally {
      setSaving(null);
    }
  };

  if (combatQuery.isError || audioQuery.isError) {
    const err = combatQuery.error ?? audioQuery.error;
    return (
      <section className="rounded-card-lg border border-red-400/40 bg-red-950/20 p-5 text-base font-bold text-red-100">
        레이드 구성 정보를 불러오지 못했습니다: {err instanceof Error ? err.message : '알 수 없는 오류'}
      </section>
    );
  }

  if (combatQuery.isLoading || audioQuery.isLoading || loadedRaid !== raidId) {
    return <section className="rounded-card-lg border border-cyan-400/25 bg-bg-card p-6"><div className="flex min-h-[160px] items-center justify-center"><LoadingSpinner /></div></section>;
  }

  return (
    <section className="rounded-card-lg border border-cyan-400/25 bg-bg-card p-5 shadow-[0_0_28px_rgba(34,211,238,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-base font-black tracking-[0.08em] text-cyan-200">레이드 구성(RAID CONFIGURATION)</div>
          <h2 className="mt-1 text-xl font-black text-white">⚙️ 전투 기믹 · 패턴 · 중계 오디오</h2>
          <p className="mt-2 text-base font-bold leading-6 text-amber-100">실제 서버 전투 엔진이 사용하는 값입니다. 전투가 시작되면 전투·패턴 설정은 읽기 전용이 됩니다.</p>
        </div>
        {!editableCombat ? <span className="rounded-full border border-amber-300/40 bg-amber-500/10 px-4 py-2 text-base font-black text-amber-100">🔒 전투 설정 읽기 전용</span> : null}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <TabButton active={tab === 'COMBAT'} onClick={() => setTab('COMBAT')}>🛡 전투 기믹</TabButton>
        <TabButton active={tab === 'PATTERNS'} onClick={() => setTab('PATTERNS')}>🧩 패턴 에디터 <span className="ml-1">{patterns.length}</span></TabButton>
        <TabButton active={tab === 'AUDIO'} onClick={() => setTab('AUDIO')}>🔊 오디오 프로필</TabButton>
      </div>

      {tab === 'COMBAT' ? <CombatEditor value={combat} onChange={setCombat} disabled={!editableCombat} saving={saving === 'COMBAT'} onSave={saveCombat} /> : null}
      {tab === 'PATTERNS' ? (
        <div className="mt-5 space-y-6">
          <PatternSection
            title="공통 기믹"
            description="약점 노출(WEAK_POINT) · 무력화(BREAK) · 광폭화(ENRAGE). 패턴별 무력화/광폭화 값이 있으면 전투 기믹 탭의 기본값보다 우선합니다."
            patterns={commonPatterns}
            allPatterns={patterns}
            setPatterns={setPatterns}
            disabled={!editableCombat}
            raidStatus={raidStatus}
            savingKey={saving}
            onTriggerManual={triggerManual}
          />
          <PatternSection
            title="보스(Boss) 특수 패턴"
            description="보스당 2개 안팎의 핵심 패턴을 권장합니다. 필요하면 추가 패턴을 더 등록할 수 있습니다."
            patterns={specialPatterns}
            allPatterns={patterns}
            setPatterns={setPatterns}
            disabled={!editableCombat}
            raidStatus={raidStatus}
            savingKey={saving}
            onTriggerManual={triggerManual}
            special
          />
          <div className="flex justify-end"><button type="button" onClick={savePatterns} disabled={!editableCombat || saving !== null} className="btn-primary text-base disabled:opacity-40">{saving === 'PATTERNS' ? '저장 중…' : '🧩 전체 패턴 저장'}</button></div>
        </div>
      ) : null}
      {tab === 'AUDIO' ? <AudioEditor value={audio} onChange={setAudio} disabled={!editableAudio} saving={saving === 'AUDIO'} onSave={saveAudio} /> : null}
    </section>
  );
}

function CombatEditor({ value, onChange, disabled, saving, onSave }: { value: RaidV15CombatConfig; onChange: (v: RaidV15CombatConfig) => void; disabled: boolean; saving: boolean; onSave: () => void }) {
  const set = <K extends keyof RaidV15CombatConfig>(key: K, next: RaidV15CombatConfig[K]) => onChange({ ...value, [key]: next });

  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-4 2xl:grid-cols-3">
        <ConfigCard title="🛡 공명방벽" subtitle="1인당 방벽 = 기본 방벽 + (공명력 × 추가 배율)">
          <div className="sm:col-span-2"><ToggleRow label="공명방벽 사용" checked={value.enabled} onChange={(next) => set('enabled', next)} disabled={disabled} /></div>
          <NumberInput label="학생 1인당 기본 방벽" value={value.barrier_base_per_adventurer} onChange={(next) => set('barrier_base_per_adventurer', next)} disabled={disabled} step={100} />
          <NumberInput label="공명력으로 추가되는 공명방벽 배율" suffix="%" value={ratioToPercent(value.barrier_resonance_factor)} onChange={(next) => set('barrier_resonance_factor', percentToRatio(next))} disabled={disabled} step={1} />
          <NumberInput label="출전 인정 최근 접속 시간" suffix="초" value={value.presence_window_seconds} onChange={(next) => set('presence_window_seconds', Math.round(next))} disabled={disabled} step={1} />
        </ConfigCard>

        <ConfigCard title="⚔️ 보스(Boss) 기본 공격" subtitle="고정 방벽 피해 + 최대 방벽 비례 피해(%)가 함께 설정되면 합산됩니다.">
          <div className="sm:col-span-2"><TextInput label="공격 이름" value={value.boss_attack_name} onChange={(next) => set('boss_attack_name', next)} disabled={disabled} /></div>
          <NumberInput label="공격 간격" suffix="초" value={value.boss_attack_interval_seconds} onChange={(next) => set('boss_attack_interval_seconds', next)} disabled={disabled} step={1} />
          <NumberInput label="예고 시간" suffix="초" value={value.boss_attack_telegraph_seconds} onChange={(next) => set('boss_attack_telegraph_seconds', next)} disabled={disabled} step={0.5} />
          <NumberInput label="고정 방벽 피해" value={value.boss_attack_fixed_damage} onChange={(next) => set('boss_attack_fixed_damage', next)} disabled={disabled} step={100} />
          <NumberInput label="최대 방벽 비례 피해" suffix="%" value={ratioToPercent(value.boss_attack_barrier_ratio)} onChange={(next) => set('boss_attack_barrier_ratio', percentToRatio(next))} disabled={disabled} step={0.5} />
        </ConfigCard>

        <ConfigCard title="✨ 무력화(Groggy) · 광폭화(Enrage)" subtitle="아래 값은 기본값입니다. 패턴 카드에 개별 값이 있으면 패턴 값이 우선 적용됩니다.">
          <NumberInput label="기본 무력화 지속 시간" suffix="초" value={value.default_groggy_seconds} onChange={(next) => set('default_groggy_seconds', next)} disabled={disabled} step={0.5} />
          <NumberInput label="무력화 시 피해 증가율" suffix="%" value={multiplierToIncreasePercent(value.default_groggy_multiplier)} onChange={(next) => set('default_groggy_multiplier', increasePercentToMultiplier(next))} disabled={disabled} step={5} />
          <NumberInput label="광폭화 시 보스 대미지 증가율" suffix="%" value={multiplierToIncreasePercent(value.enrage_boss_damage_multiplier)} onChange={(next) => set('enrage_boss_damage_multiplier', increasePercentToMultiplier(next))} disabled={disabled} step={5} />
          <NumberInput label="광폭화 시 학생 대미지 변화율" suffix="%" value={multiplierToIncreasePercent(value.enrage_player_damage_multiplier)} onChange={(next) => set('enrage_player_damage_multiplier', increasePercentToMultiplier(next))} disabled={disabled} step={5} />
        </ConfigCard>
      </div>
      <div className="flex justify-end"><button type="button" onClick={onSave} disabled={disabled || saving} className="btn-primary text-base disabled:opacity-40">{saving ? '저장 중…' : '🛡 전투 기믹 저장'}</button></div>
    </div>
  );
}

function PatternSection({ title, description, patterns, allPatterns, setPatterns, disabled, raidStatus, savingKey, onTriggerManual, special = false }: { title: string; description: string; patterns: RaidV15Pattern[]; allPatterns: RaidV15Pattern[]; setPatterns: (v: RaidV15Pattern[]) => void; disabled: boolean; raidStatus: RaidStatus; savingKey: string | null; onTriggerManual: (pattern: RaidV15Pattern) => void; special?: boolean }) {
  const update = (target: RaidV15Pattern, next: RaidV15Pattern) => setPatterns(allPatterns.map((pattern) => pattern === target ? next : pattern));
  const remove = (target: RaidV15Pattern) => setPatterns(allPatterns.filter((pattern) => pattern !== target));
  const add = () => {
    const type: RaidV15PatternType = special ? 'ABSORB' : 'WEAK_POINT';
    const seq = Math.min(999, (Math.max(0, ...allPatterns.map((pattern) => Number(pattern.seq) || 0)) || 0) + 10);
    setPatterns([...allPatterns, makePattern(type, seq)]);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-white">{title}</h3>
          <p className="mt-1 max-w-5xl text-base font-bold leading-6 text-cyan-100">{description}</p>
        </div>
        <button type="button" onClick={add} disabled={disabled} className="rounded-card-md border border-cyan-300/40 bg-cyan-500/10 px-4 py-2 text-base font-black text-cyan-100 disabled:opacity-40">+ 패턴 추가</button>
      </div>
      <div className="space-y-4">
        {patterns.length === 0 ? <div className="rounded-card-md border border-dashed border-cyan-400/25 bg-bg-deep p-5 text-center text-base font-bold text-amber-100">등록된 패턴이 없습니다.</div> : null}
        {patterns.map((pattern) => (
          <PatternCard
            key={pattern.client_key ?? `db-${pattern.id ?? 'missing'}`}
            pattern={pattern}
            onChange={(next) => update(pattern, next)}
            onDelete={() => remove(pattern)}
            disabled={disabled}
            common={!special}
            canTriggerManual={raidStatus === 'ACTIVE' && pattern.trigger_kind === 'MANUAL' && Boolean(pattern.id)}
            triggering={savingKey === `TRIGGER-${pattern.id ?? 0}`}
            onTriggerManual={() => onTriggerManual(pattern)}
          />
        ))}
      </div>
    </div>
  );
}

function PatternCard({ pattern, onChange, onDelete, disabled, common, canTriggerManual, triggering, onTriggerManual }: { pattern: RaidV15Pattern; onChange: (p: RaidV15Pattern) => void; onDelete: () => void; disabled: boolean; common: boolean; canTriggerManual: boolean; triggering: boolean; onTriggerManual: () => void }) {
  const set = <K extends keyof RaidV15Pattern>(key: K, value: RaidV15Pattern[K]) => onChange({ ...pattern, [key]: value });
  const allowedTypes = PATTERN_TYPES.filter((type) => common ? type.common : !type.common);
  const displayType = pattern.pattern_type === 'BOSS_STRIKE' ? 'ULTIMATE' : pattern.pattern_type;
  const changeType = (type: RaidV15PatternType) => onChange({ ...pattern, pattern_type: type, name: defaultPatternName(type), config: defaultPatternConfig(type) });
  const ratioTrigger = pattern.trigger_kind === 'HP_RATIO' || pattern.trigger_kind === 'BARRIER_RATIO';
  const displayTriggerValue = pattern.trigger_kind === 'MANUAL' ? 0 : ratioTrigger ? ratioToPercent(pattern.trigger_value) : pattern.trigger_value;

  return (
    <div className={cn('rounded-card-md border p-4', pattern.is_enabled ? 'border-cyan-300/30 bg-bg-deep' : 'border-amber-300/20 bg-black/20 opacity-70')}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[100px_minmax(190px,1.3fr)_minmax(210px,1.2fr)_minmax(230px,1.2fr)_170px_135px]">
        <NumberInput label="순서(Seq)" value={pattern.seq} onChange={(next) => set('seq', Math.round(next))} disabled={disabled} step={10} />
        <TextInput label="패턴 이름" value={pattern.name} onChange={(next) => set('name', next)} disabled={disabled} />
        <SelectInput label="기믹 종류(Type)" value={displayType} options={allowedTypes} onChange={(next) => changeType(next as RaidV15PatternType)} disabled={disabled} />
        <SelectInput label="발동 조건(Trigger)" value={pattern.trigger_kind} options={TRIGGERS} onChange={(next) => set('trigger_kind', next as RaidV15TriggerKind)} disabled={disabled} />
        <NumberInput
          label={triggerValueLabel(pattern.trigger_kind)}
          value={displayTriggerValue}
          onChange={(next) => set('trigger_value', ratioTrigger ? percentToRatio(next) : next)}
          disabled={disabled || pattern.trigger_kind === 'MANUAL'}
          step={ratioTrigger ? 1 : 1}
          suffix={ratioTrigger ? '%' : undefined}
        />
        <NumberInput label="지속 시간" suffix="초" value={pattern.duration_seconds} onChange={(next) => set('duration_seconds', next)} disabled={disabled} step={0.5} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {pattern.trigger_kind === 'MANUAL' ? <button type="button" onClick={onTriggerManual} disabled={!canTriggerManual || triggering} className="rounded-card-md border border-gold/50 bg-gold/10 px-3 py-2 text-base font-black text-yellow-100 disabled:opacity-40">{triggering ? '발동 중…' : '▶ 수동 발동'}</button> : null}
        <button type="button" onClick={() => set('is_enabled', !pattern.is_enabled)} disabled={disabled} className="rounded-card-md border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-base font-black text-cyan-100 disabled:opacity-40">{pattern.is_enabled ? '사용(ON)' : '미사용(OFF)'}</button>
        <button type="button" onClick={onDelete} disabled={disabled} className="rounded-card-md border border-red-300/30 bg-red-500/10 px-3 py-2 text-base font-black text-red-100 disabled:opacity-40">삭제</button>
      </div>

      {pattern.trigger_kind === 'RANDOM_WINDOW' ? (
        <div className="mt-3 max-w-[260px]"><NumberInput label="무작위 시간창 종료" suffix="초" value={numberFrom(pattern.config.window_end_seconds, pattern.trigger_value + 10)} onChange={(next) => set('config', { ...pattern.config, window_end_seconds: next })} disabled={disabled} step={1} /></div>
      ) : null}

      <PatternConfigFields pattern={pattern} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function PatternConfigFields({ pattern, onChange, disabled }: { pattern: RaidV15Pattern; onChange: (p: RaidV15Pattern) => void; disabled: boolean }) {
  const type = pattern.pattern_type === 'BOSS_STRIKE' ? 'ULTIMATE' : pattern.pattern_type;
  const config = pattern.config ?? {};
  const setConfig = (key: string, value: unknown) => onChange({ ...pattern, config: { ...config, [key]: value } });
  const direct = (key: string, fallback: number, label: string, step = 1, suffix?: string) => <NumberInput key={key} label={label} value={numberFrom(config[key], fallback)} onChange={(next) => setConfig(key, next)} disabled={disabled} step={step} suffix={suffix} />;
  const percent = (key: string, fallback: number, label: string, step = 1) => <NumberInput key={key} label={label} value={ratioToPercent(numberFrom(config[key], fallback))} onChange={(next) => setConfig(key, percentToRatio(next))} disabled={disabled} step={step} suffix="%" />;
  const increase = (key: string, fallback: number, label: string, step = 5) => <NumberInput key={key} label={label} value={multiplierToIncreasePercent(numberFrom(config[key], fallback))} onChange={(next) => setConfig(key, increasePercentToMultiplier(next))} disabled={disabled} step={step} suffix="%" />;
  const json = (key: string, label: string, fallback: unknown) => <JsonInput key={key} label={label} value={config[key] ?? fallback} onChange={(next) => setConfig(key, next)} disabled={disabled} />;
  const toggle = (key: string, fallback: boolean, label: string) => <ToggleRow key={key} label={label} checked={booleanFrom(config[key], fallback)} onChange={(next) => setConfig(key, next)} disabled={disabled} />;

  let fields: ReactNode[] = [];
  let help: string | null = null;

  switch (type) {
    case 'WEAK_POINT':
      fields = [
        direct('x', 0.42, '약점 X 위치(0~1)', 0.01),
        direct('y', 0.30, '약점 Y 위치(0~1)', 0.01),
        direct('width', 0.16, '약점 폭(0~1)', 0.01),
        direct('height', 0.22, '약점 높이(0~1)', 0.01),
        increase('multiplier', 2, '약점 적중 피해 증가율'),
        percent('body_multiplier', 1, '약점 외 보스 피해 적용률'),
      ];
      break;
    case 'BREAK':
    case 'ULTIMATE':
      fields = [
        percent('objective_hp_ratio', type === 'ULTIMATE' ? 0.05 : 0.04, type === 'BREAK' ? '무력화 요구 체력' : '필살기 차단 요구 체력', 0.5),
        direct('groggy_seconds', 7, '성공 시 무력화 지속 시간', 0.5, '초'),
        increase('groggy_multiplier', 1.4, '무력화 시 피해 증가율'),
        direct('fail_damage_fixed', 0, '실패 시 고정 방벽 피해', 100),
        percent('fail_damage_percent', type === 'ULTIMATE' ? 0.15 : 0.12, '실패 시 최대 방벽 비례 피해', 1),
      ];
      help = '실패 시 고정 방벽 피해와 최대 방벽 비례 피해(%)를 둘 다 설정하면 두 피해가 합산되어 공명방벽에 적용됩니다.';
      break;
    case 'ABSORB':
      fields = [percent('heal_ratio', 1, '공격 피해 대비 보스 회복률', 5)];
      break;
    case 'REFLECT':
      fields = [percent('reflect_ratio', 0.3, '공격 피해 중 방벽 반사율', 5), percent('boss_damage_multiplier', 1, '반사 중 보스 피해 적용률', 5)];
      break;
    case 'DOT':
      fields = [
        direct('tick_interval_seconds', 1, '지속 피해 간격', 0.25, '초'),
        direct('tick_fixed_damage', 0, '틱당 고정 방벽 피해', 100),
        percent('tick_barrier_percent', 0.03, '틱당 최대 방벽 비례 피해', 0.5),
        json('interrupt_target', '중단 목표(JSON, 고급 설정)', null),
      ];
      help = '중단 목표가 없으면 지속시간 동안 피해만 주는 패턴입니다. 중단 목표가 있으면 해당 목표를 파괴해 조기 종료할 수 있습니다.';
      break;
    case 'SHIELD':
      fields = [
        percent('shield_hp_ratio', 0.05, '보호막 체력(보스 최대 HP 대비)', 0.5),
        percent('boss_damage_while_shield', 0, '보호막 유지 중 보스 피해 적용률', 5),
        direct('groggy_seconds', 4, '파괴 성공 시 무력화 시간', 0.5, '초'),
        increase('groggy_multiplier', 1.2, '무력화 시 피해 증가율'),
      ];
      break;
    case 'MULTI_CORE':
      fields = [
        <SelectConfig key="mode" label="핵 파괴 방식(Mode)" value={String(config.mode ?? 'FIXED_ORDER')} options={[{ value: 'ANY_ORDER', label: '자유 순서(ANY_ORDER)' }, { value: 'FIXED_ORDER', label: '고정 순서(FIXED_ORDER)' }, { value: 'RANDOM_ORDER', label: '무작위 순서(RANDOM_ORDER)' }]} onChange={(next) => setConfig('mode', next)} disabled={disabled} />,
        percent('wrong_barrier_percent', 0.02, '오답 시 최대 방벽 비례 피해', 0.5),
        direct('wrong_barrier_fixed', 0, '오답 시 고정 방벽 피해', 100),
        percent('wrong_boss_heal_ratio', 0, '오답 공격 피해 대비 보스 회복률', 5),
        direct('wrong_time_penalty_seconds', 0, '오답 시 제한시간 감소', 0.5, '초'),
        toggle('reset_on_wrong', false, '오답 시 핵 진행도 초기화'),
        json('cores', '핵 배열(JSON, 고급 설정)', []),
      ];
      help = '오답 고정 피해와 최대 방벽 비례 피해(%)를 함께 설정하면 두 값이 합산됩니다.';
      break;
    case 'SPLIT_TARGET':
      fields = [
        direct('max_difference_percent', 25, '허용 공격 불균형', 1, '%'),
        percent('unbalanced_efficiency', 0.35, '불균형 상태의 공격 효율', 5),
        percent('success_bonus_damage_ratio', 0.02, '성공 시 보스 추가 피해(최대 HP 대비)', 0.5),
        direct('groggy_seconds', 4, '성공 시 무력화 시간', 0.5, '초'),
        increase('groggy_multiplier', 1.2, '무력화 시 피해 증가율'),
        json('targets', '분산 목표 배열(JSON, 고급 설정)', []),
      ];
      break;
    case 'REGEN':
      fields = [
        direct('tick_interval_seconds', 1, '회복 간격', 0.25, '초'),
        direct('heal_per_tick_fixed', 0, '틱당 고정 체력 회복', 100),
        percent('heal_per_tick_percent', 0.01, '틱당 체력 회복(보스 최대 HP 대비)', 0.5),
        percent('core_hp_ratio', 0.02, '재생핵 체력(보스 최대 HP 대비)', 0.5),
        json('core', '재생핵(JSON, 고급 설정)', null),
      ];
      break;
    case 'SEAL':
      fields = [
        percent('damage_reduction', 0.7, '봉인 유지 중 보스 피해 감소율', 5),
        direct('groggy_seconds', 3, '봉인 해제 후 무력화 시간', 0.5, '초'),
        increase('groggy_multiplier', 1.15, '무력화 시 피해 증가율'),
        json('seals', '봉인석 배열(JSON, 고급 설정)', []),
      ];
      break;
    case 'DAMAGE_CHECK':
      fields = [
        percent('target_damage_ratio', 0.06, '요구 누적 피해(보스 최대 HP 대비)', 0.5),
        direct('groggy_seconds', 3, '성공 시 무력화 시간', 0.5, '초'),
        increase('groggy_multiplier', 1.15, '무력화 시 피해 증가율'),
        direct('fail_damage_fixed', 0, '실패 시 고정 방벽 피해', 100),
        percent('fail_damage_percent', 0.10, '실패 시 최대 방벽 비례 피해', 1),
      ];
      help = '실패 고정 방벽 피해와 최대 방벽 비례 피해(%)를 둘 다 설정하면 합산됩니다.';
      break;
    case 'ENRAGE':
      fields = [increase('boss_damage_multiplier', 1.25, '광폭화 시 보스 대미지 증가율'), increase('player_damage_multiplier', 1, '광폭화 시 학생 대미지 변화율')];
      help = '이 패턴에 값을 입력하면 전투 기믹 탭의 광폭화 기본값보다 이 값이 우선 적용됩니다.';
      break;
  }

  return (
    <div className="mt-4 border-t border-cyan-300/10 pt-4">
      <div className="mb-3 text-base font-black text-cyan-200">기믹 세부 설정(TYPE CONFIG)</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{fields}</div>
      {help ? <div className="mt-3 rounded-card-md border border-amber-300/20 bg-amber-500/5 px-4 py-3 text-base font-bold leading-6 text-amber-100">💡 {help}</div> : null}
    </div>
  );
}

function AudioEditor({ value, onChange, disabled, saving, onSave }: { value: Omit<RaidV15AudioProfile, 'raid_id' | 'configured'>; onChange: (v: Omit<RaidV15AudioProfile, 'raid_id' | 'configured'>) => void; disabled: boolean; saving: boolean; onSave: () => void }) {
  const set = (key: keyof typeof value, next: string | number | null) => onChange({ ...value, [key]: next });
  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-3 lg:grid-cols-3">
        <VolumeControl label="전체 음량(Master)" value={value.master_volume} onChange={(next) => set('master_volume', next)} disabled={disabled} />
        <VolumeControl label="배경음악(BGM)" value={value.bgm_volume} onChange={(next) => set('bgm_volume', next)} disabled={disabled} />
        <VolumeControl label="효과음(SFX)" value={value.sfx_volume} onChange={(next) => set('sfx_volume', next)} disabled={disabled} />
      </div>
      <AudioGroup title="🎵 배경음악(BGM)" fields={[[ 'lobby_bgm_url', '로비 배경음악(Lobby BGM)' ], [ 'battle_bgm_url', '전투 배경음악(Battle BGM)' ], [ 'enrage_bgm_url', '광폭화 배경음악(Enrage BGM)' ], [ 'raid_success_bgm_url', '성공 배경음악(Success BGM)' ], [ 'raid_failure_bgm_url', '실패 배경음악(Failure BGM)' ]]} value={value} set={set} disabled={disabled} />
      <AudioGroup title="⚔️ 공격 효과음(SFX)" fields={[[ 'raid_start_sfx_url', '레이드 시작(Raid Start)' ], [ 'normal_hit_sfx_url', '일반 타격(Normal Hit)' ], [ 'crit_hit_sfx_url', '치명타(Critical Hit)' ], [ 'powerful_hit_sfx_url', '강력한 일격(Powerful Hit)' ], [ 'devastating_hit_sfx_url', '압도적 일격(Devastating Hit)' ]]} value={value} set={set} disabled={disabled} />
      <AudioGroup title="🛡 기믹 효과음(SFX)" fields={[[ 'break_start_sfx_url', '특수 패턴 예고(Pattern Warning)' ], [ 'break_success_sfx_url', '특수 패턴 파훼 성공(Pattern Success)' ], [ 'break_fail_sfx_url', '특수 패턴 파훼 실패(Pattern Fail)' ], [ 'barrier_hit_sfx_url', '공명방벽 피격(Barrier Hit)' ], [ 'barrier_critical_sfx_url', '공명방벽 위험(Barrier Critical)' ]]} value={value} set={set} disabled={disabled} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-base font-bold leading-6 text-cyan-100">효과음은 중계 화면에서 미리 로드해 재사용합니다. 강력/압도적 일격 URL이 비어 있으면 치명타 또는 일반 타격 효과음을 자동으로 사용합니다.</p>
        <button type="button" onClick={onSave} disabled={disabled || saving} className="btn-primary text-base disabled:opacity-40">{saving ? '저장 중…' : '🔊 오디오 저장'}</button>
      </div>
    </div>
  );
}

function AudioGroup({ title, fields, value, set, disabled }: { title: string; fields: Array<[keyof Omit<RaidV15AudioProfile, 'raid_id' | 'configured'>, string]>; value: Omit<RaidV15AudioProfile, 'raid_id' | 'configured'>; set: (key: keyof typeof value, next: string | number | null) => void; disabled: boolean }) {
  return (
    <div className="rounded-card-md border border-cyan-300/15 bg-bg-deep p-4">
      <h3 className="mb-3 text-lg font-black text-white">{title}</h3>
      <div className="grid gap-3 lg:grid-cols-2">
        {fields.map(([key, label]) => <TextInput key={String(key)} label={label} value={String(value[key] ?? '')} onChange={(next) => set(key, next.trim() || null)} disabled={disabled} placeholder="https://..." />)}
      </div>
    </div>
  );
}

function VolumeControl({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <label className="rounded-card-md border border-cyan-300/15 bg-bg-deep p-4">
      <div className="flex justify-between text-base font-black text-cyan-100"><span>{label}</span><span>{Math.round(value * 100)}%</span></div>
      <input type="range" min="0" max="1" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} className="mt-3 w-full accent-cyan-300" />
    </label>
  );
}

function ConfigCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-card-md border border-cyan-300/15 bg-bg-deep p-4">
      <h3 className="text-lg font-black text-white">{title}</h3>
      <p className="mb-4 mt-1 text-base font-bold leading-6 text-cyan-100">{subtitle}</p>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={cn('rounded-card-md border px-4 py-2 text-base font-black transition', active ? 'border-gold/60 bg-gold/15 text-yellow-100' : 'border-cyan-300/20 bg-bg-deep text-cyan-100 hover:border-cyan-300/50')}>{children}</button>;
}

function ToggleRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return <label className="flex min-h-[42px] items-center justify-between gap-3 text-base font-black text-cyan-100"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} className="h-5 w-5 accent-cyan-300" /></label>;
}

function NumberInput({ label, value, onChange, disabled, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; disabled: boolean; step?: number; suffix?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-base font-black leading-5 text-cyan-100">{label}</span>
      <div className="flex max-w-[190px] items-center gap-2">
        <input type="number" value={Number.isFinite(value) ? roundForInput(value) : 0} step={step} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} className="min-w-0 w-full rounded-card-md border border-cyan-300/20 bg-black/30 px-3 py-2 text-base font-bold text-white outline-none focus:border-cyan-300/60 disabled:opacity-50" />
        {suffix ? <span className="flex-none text-base font-black text-amber-100">{suffix}</span> : null}
      </div>
    </label>
  );
}

function TextInput({ label, value, onChange, disabled, placeholder = '' }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean; placeholder?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-base font-black leading-5 text-cyan-100">{label}</span>
      <input type="text" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="w-full rounded-card-md border border-cyan-300/20 bg-black/30 px-3 py-2 text-base font-bold text-white outline-none placeholder:text-cyan-100/30 focus:border-cyan-300/60 disabled:opacity-50" />
    </label>
  );
}

function SelectInput({ label, value, options, onChange, disabled }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-base font-black leading-5 text-cyan-100">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="w-full rounded-card-md border border-cyan-300/20 bg-black/60 px-3 py-2 text-base font-bold text-white outline-none focus:border-cyan-300/60 disabled:opacity-50">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function SelectConfig(props: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void; disabled: boolean }) {
  return <SelectInput {...props} />;
}

function JsonInput({ label, value, onChange, disabled }: { label: string; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  const [draft, setDraft] = useState(() => value == null ? '' : JSON.stringify(value));
  useEffect(() => setDraft(value == null ? '' : JSON.stringify(value)), [value]);
  return (
    <label className="block md:col-span-2">
      <span className="mb-1 block text-base font-black text-cyan-100">{label}</span>
      <textarea
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          try {
            onChange(draft.trim() ? JSON.parse(draft) : null);
          } catch {
            window.alert(`${label}: JSON 형식을 확인해주세요.`);
            setDraft(value == null ? '' : JSON.stringify(value));
          }
        }}
        disabled={disabled}
        className="w-full rounded-card-md border border-cyan-300/20 bg-black/30 px-3 py-2 font-mono text-base font-bold text-white outline-none focus:border-cyan-300/60 disabled:opacity-50"
      />
    </label>
  );
}

function normalizePattern(pattern: RaidV15Pattern): RaidV15Pattern {
  return {
    ...pattern,
    client_key: pattern.client_key ?? (pattern.id ? `db-${pattern.id}` : makeClientKey()),
    pattern_type: pattern.pattern_type === 'BOSS_STRIKE' ? 'ULTIMATE' : pattern.pattern_type,
    config: pattern.config ?? {},
  };
}

function isCommon(type: RaidV15PatternType) {
  const normalized = type === 'BOSS_STRIKE' ? 'ULTIMATE' : type;
  return normalized === 'WEAK_POINT' || normalized === 'BREAK' || normalized === 'ENRAGE';
}

function triggerValueLabel(trigger: RaidV15TriggerKind) {
  if (trigger === 'HP_RATIO') return '발동 보스 체력';
  if (trigger === 'BARRIER_RATIO') return '발동 공명방벽';
  if (trigger === 'AFTER_PATTERN') return '선행 패턴 순서';
  if (trigger === 'RANDOM_WINDOW') return '무작위 시작 시간';
  if (trigger === 'TIME_REMAINING') return '남은 시간';
  if (trigger === 'MANUAL') return '수동 발동';
  return '발동 시간';
}

function numberFrom(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanFrom(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function defaultPatternName(type: RaidV15PatternType) {
  return PATTERN_TYPES.find((option) => option.value === type)?.name ?? type;
}

function defaultPatternConfig(type: RaidV15PatternType): Record<string, unknown> {
  switch (type) {
    case 'WEAK_POINT': return { x: 0.42, y: 0.3, width: 0.16, height: 0.22, multiplier: 2, body_multiplier: 1 };
    case 'BREAK': return { objective_hp_ratio: 0.04, groggy_seconds: 7, groggy_multiplier: 1.4, fail_damage_fixed: 3000, fail_damage_percent: 0.12 };
    case 'ENRAGE': return { boss_damage_multiplier: 1.25, player_damage_multiplier: 1 };
    case 'ABSORB': return { heal_ratio: 1 };
    case 'REFLECT': return { reflect_ratio: 0.3, boss_damage_multiplier: 1 };
    case 'ULTIMATE': return { objective_hp_ratio: 0.05, groggy_seconds: 7, groggy_multiplier: 1.4, fail_damage_fixed: 8000, fail_damage_percent: 0.18 };
    case 'DOT': return { tick_interval_seconds: 1, tick_fixed_damage: 0, tick_barrier_percent: 0.03, interrupt_target: null };
    case 'SHIELD': return { shield_hp_ratio: 0.05, boss_damage_while_shield: 0, groggy_seconds: 4, groggy_multiplier: 1.2 };
    case 'MULTI_CORE': return { mode: 'FIXED_ORDER', cores: [], reset_on_wrong: false, wrong_barrier_fixed: 0, wrong_barrier_percent: 0.02, wrong_boss_heal_ratio: 0, wrong_time_penalty_seconds: 0 };
    case 'SPLIT_TARGET': return { targets: [], max_difference_percent: 25, unbalanced_efficiency: 0.35, success_bonus_damage_ratio: 0.02, groggy_seconds: 4, groggy_multiplier: 1.2 };
    case 'REGEN': return { tick_interval_seconds: 1, heal_per_tick_fixed: 0, heal_per_tick_percent: 0.01, core_hp_ratio: 0.02, core: null };
    case 'SEAL': return { seals: [], damage_reduction: 0.7, groggy_seconds: 3, groggy_multiplier: 1.15 };
    case 'DAMAGE_CHECK': return { target_damage_ratio: 0.06, groggy_seconds: 3, groggy_multiplier: 1.15, fail_damage_fixed: 0, fail_damage_percent: 0.10 };
    default: return {};
  }
}

function makeClientKey() {
  return `new-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function makePattern(type: RaidV15PatternType, seq: number): RaidV15Pattern {
  return {
    client_key: makeClientKey(),
    seq,
    name: defaultPatternName(type),
    pattern_type: type,
    trigger_kind: 'TIME_SECONDS',
    trigger_value: 30,
    duration_seconds: type === 'ABSORB' ? 4 : 7,
    config: defaultPatternConfig(type),
    is_enabled: true,
  };
}

function validateCombat(config: RaidV15CombatConfig) {
  if (config.barrier_base_per_adventurer < 0 || config.barrier_base_per_adventurer > 1_000_000) { window.alert('학생 1인당 기본 방벽은 0~1,000,000 범위입니다.'); return false; }
  if (config.barrier_resonance_factor < 0 || config.barrier_resonance_factor > 100) { window.alert('공명력으로 추가되는 공명방벽 배율을 확인해주세요.'); return false; }
  if (!Number.isInteger(config.presence_window_seconds) || config.presence_window_seconds < 5 || config.presence_window_seconds > 120) { window.alert('출전 인정 최근 접속 시간은 5~120초 정수입니다.'); return false; }
  if (config.default_groggy_seconds < 1 || config.default_groggy_seconds > 60) { window.alert('기본 무력화(Groggy) 시간은 1~60초입니다.'); return false; }
  if (config.default_groggy_multiplier < 1 || config.default_groggy_multiplier > 10) { window.alert('무력화(Groggy) 피해 증가율을 확인해주세요.'); return false; }
  if (config.enrage_boss_damage_multiplier < 1 || config.enrage_boss_damage_multiplier > 10) { window.alert('광폭화(Enrage) 보스 대미지 증가율을 확인해주세요.'); return false; }
  if (config.enrage_player_damage_multiplier < 0.1 || config.enrage_player_damage_multiplier > 10) { window.alert('광폭화(Enrage) 학생 대미지 변화율을 확인해주세요.'); return false; }
  if (config.boss_attack_interval_seconds < 2 || config.boss_attack_interval_seconds > 120) { window.alert('보스(Boss) 기본 공격 간격은 2~120초입니다.'); return false; }
  if (config.boss_attack_telegraph_seconds < 0 || config.boss_attack_telegraph_seconds > 30 || config.boss_attack_telegraph_seconds >= config.boss_attack_interval_seconds) { window.alert('보스(Boss) 공격 예고 시간은 0~30초이며 공격 간격보다 짧아야 합니다.'); return false; }
  if (config.boss_attack_fixed_damage < 0) { window.alert('고정 방벽 피해는 0 이상이어야 합니다.'); return false; }
  if (config.boss_attack_barrier_ratio < 0 || config.boss_attack_barrier_ratio > 1) { window.alert('최대 방벽 비례 피해는 0~100% 범위입니다.'); return false; }
  if (!config.boss_attack_name.trim()) { window.alert('보스(Boss) 기본 공격 이름을 입력해주세요.'); return false; }
  return true;
}

function validatePatterns(patterns: RaidV15Pattern[]) {
  const seqs = new Set<number>();
  const bySeq = new Map<number, RaidV15Pattern>();
  for (const pattern of patterns) {
    if (!Number.isInteger(pattern.seq) || pattern.seq < 1 || pattern.seq > 999) { window.alert('패턴 순서(Seq)는 1~999 정수여야 합니다.'); return false; }
    if (seqs.has(pattern.seq)) { window.alert(`패턴 순서(Seq) ${pattern.seq}가 중복됩니다.`); return false; }
    seqs.add(pattern.seq);
    bySeq.set(pattern.seq, pattern);
    if (!pattern.name.trim()) { window.alert('모든 패턴에 이름을 입력해주세요.'); return false; }
    if (pattern.duration_seconds < 0.5 || pattern.duration_seconds > 120) { window.alert(`${pattern.name}: 지속 시간은 0.5~120초입니다.`); return false; }
    if ((pattern.trigger_kind === 'HP_RATIO' || pattern.trigger_kind === 'BARRIER_RATIO') && (pattern.trigger_value < 0 || pattern.trigger_value > 1)) { window.alert(`${pattern.name}: 발동 비율은 0~100%입니다.`); return false; }
    if ((pattern.trigger_kind === 'TIME_SECONDS' || pattern.trigger_kind === 'TIME_REMAINING' || pattern.trigger_kind === 'RANDOM_WINDOW') && pattern.trigger_value < 0) { window.alert(`${pattern.name}: 시간 조건은 0 이상이어야 합니다.`); return false; }
    if (pattern.trigger_kind === 'AFTER_PATTERN' && (!Number.isInteger(pattern.trigger_value) || pattern.trigger_value < 1 || pattern.trigger_value > 999)) { window.alert(`${pattern.name}: 다른 패턴 이후(AFTER_PATTERN)는 선행 패턴 순서(Seq) 1~999를 입력합니다.`); return false; }
    if (pattern.trigger_kind === 'RANDOM_WINDOW') {
      const windowEnd = numberFrom(pattern.config?.window_end_seconds, pattern.trigger_value + 10);
      if (windowEnd <= pattern.trigger_value) { window.alert(`${pattern.name}: 무작위 시간창 종료는 시작(${pattern.trigger_value}초)보다 커야 합니다.`); return false; }
    }
  }

  for (const pattern of patterns) {
    if (pattern.trigger_kind !== 'AFTER_PATTERN') continue;
    const target = bySeq.get(pattern.trigger_value);
    if (!target) { window.alert(`${pattern.name}: 참조할 순서(Seq) ${pattern.trigger_value}가 존재하지 않습니다.`); return false; }
    if (target.seq === pattern.seq) { window.alert(`${pattern.name}: 자기 자신을 선행 패턴으로 참조할 수 없습니다.`); return false; }
    if (pattern.is_enabled && !target.is_enabled) { window.alert(`${pattern.name}: 사용 중인 패턴은 미사용(OFF) 패턴을 선행 조건으로 지정할 수 없습니다.`); return false; }
  }

  const links = new Map<number, number>();
  for (const pattern of patterns) if (pattern.is_enabled && pattern.trigger_kind === 'AFTER_PATTERN') links.set(pattern.seq, pattern.trigger_value);
  for (const startSeq of links.keys()) {
    const seen = new Set<number>();
    let current: number | undefined = startSeq;
    while (current !== undefined && links.has(current)) {
      if (seen.has(current)) { window.alert(`다른 패턴 이후(AFTER_PATTERN) 순환참조가 있습니다. Seq ${[...seen, current].join(' → ')}`); return false; }
      seen.add(current);
      current = links.get(current);
    }
  }
  return true;
}

function ratioToPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function percentToRatio(value: number) {
  return Number.isFinite(value) ? value / 100 : 0;
}

function multiplierToIncreasePercent(value: number) {
  return (numberFrom(value, 1) - 1) * 100;
}

function increasePercentToMultiplier(value: number) {
  return 1 + (Number.isFinite(value) ? value : 0) / 100;
}

function roundForInput(value: number) {
  return Math.round(value * 1000) / 1000;
}
