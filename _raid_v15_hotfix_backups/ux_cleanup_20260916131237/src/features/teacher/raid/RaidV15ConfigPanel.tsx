// RAID_V15_E5_CONFIGURATION_PANEL
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
  lobby_bgm_url: null, battle_bgm_url: null, enrage_bgm_url: null,
  raid_start_sfx_url: null, raid_success_bgm_url: null, raid_failure_bgm_url: null,
  normal_hit_sfx_url: null, crit_hit_sfx_url: null, powerful_hit_sfx_url: null, devastating_hit_sfx_url: null,
  break_start_sfx_url: null, break_success_sfx_url: null, break_fail_sfx_url: null,
  barrier_hit_sfx_url: null, barrier_critical_sfx_url: null,
  master_volume: 0.85, bgm_volume: 0.55, sfx_volume: 0.8,
};

const PATTERN_TYPES: Array<{ value: RaidV15PatternType; label: string; common?: boolean }> = [
  { value: 'WEAK_POINT', label: '🎯 약점 노출', common: true },
  { value: 'BREAK', label: '💥 Break', common: true },
  { value: 'ENRAGE', label: '🔥 Enrage', common: true },
  { value: 'ABSORB', label: '🌀 흡수' },
  { value: 'REFLECT', label: '↩️ 반격' },
  { value: 'ULTIMATE', label: '☄️ 대형 필살기' },
  { value: 'DOT', label: '☠️ 지속 피해' },
  { value: 'SHIELD', label: '🛡️ 보호막' },
  { value: 'MULTI_CORE', label: '🔷 다중 핵' },
  { value: 'SPLIT_TARGET', label: '⚖️ 분산 공격' },
  { value: 'REGEN', label: '💚 재생' },
  { value: 'SEAL', label: '🔒 봉인' },
  { value: 'DAMAGE_CHECK', label: '⏱️ 시간 압박' },
];

const TRIGGERS: Array<{ value: RaidV15TriggerKind; label: string }> = [
  { value: 'TIME_SECONDS', label: '전투 경과 초' },
  { value: 'TIME_REMAINING', label: '남은 시간 초' },
  { value: 'HP_RATIO', label: 'Boss HP 비율' },
  { value: 'BARRIER_RATIO', label: '공명방벽 비율' },
  { value: 'AFTER_PATTERN', label: '다른 패턴 이후' },
  { value: 'RANDOM_WINDOW', label: '랜덤 시간창' },
  { value: 'MANUAL', label: '수동' },
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
  const commonPatterns = useMemo(() => patterns.filter((p) => isCommon(p.pattern_type)), [patterns]);
  const specialPatterns = useMemo(() => patterns.filter((p) => !isCommon(p.pattern_type)), [patterns]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['teacher-raid-v15-combat', raidId] });
    await queryClient.invalidateQueries({ queryKey: ['teacher-raid-v15-audio', raidId] });
    setLoadedRaid(null);
  };

  const saveCombat = async () => {
    if (!editableCombat) return;
    if (!validateCombat(combat)) return;
    setSaving('COMBAT');
    try {
      const result = await raidV15AdminRpc.saveCombat(supabase, raidId, { config: combat });
      if (result.success === false) return window.alert(result.error);
      window.alert('전투 기믹 설정을 저장했습니다.');
      await refresh();
    } finally { setSaving(null); }
  };

  const savePatterns = async () => {
    if (!editableCombat) return;
    const normalized = patterns.map((p, index) => {
      const { client_key: _clientKey, ...serverPattern } = p;
      return { ...serverPattern, seq: Number(p.seq || (index + 1) * 10), config: p.config ?? {} };
    });
    if (!validatePatterns(normalized)) return;
    setSaving('PATTERNS');
    try {
      const result = await raidV15AdminRpc.saveCombat(supabase, raidId, { patterns: normalized });
      if (result.success === false) return window.alert(result.error);
      window.alert('패턴 구성을 저장했습니다.');
      await refresh();
    } finally { setSaving(null); }
  };

  const triggerManual = async (pattern: RaidV15Pattern) => {
    if (raidStatus !== 'ACTIVE') return window.alert('수동 패턴은 ACTIVE 상태에서만 발동할 수 있습니다.');
    if (!pattern.id) return window.alert('수동 패턴을 먼저 저장해주세요.');
    const key = `TRIGGER-${pattern.id}`;
    setSaving(key);
    try {
      const result = await raidV15AdminRpc.triggerPattern(supabase, raidId, pattern.id);
      if (result.success === false) return window.alert(result.error);
      window.alert(`수동 패턴 발동: ${result.data?.pattern_name ?? pattern.name}`);
      await refresh();
    } finally { setSaving(null); }
  };

  const saveAudio = async () => {
    if (!editableAudio) return;
    setSaving('AUDIO');
    try {
      const result = await raidV15AdminRpc.saveAudio(supabase, raidId, audio);
      if (result.success === false) return window.alert(result.error);
      window.alert('중계 오디오 프로필을 저장했습니다.');
      await refresh();
    } finally { setSaving(null); }
  };

  if (combatQuery.isError || audioQuery.isError) {
    const err = combatQuery.error ?? audioQuery.error;
    return <section className="rounded-card-lg border border-red-400/40 bg-red-950/20 p-5 text-sm font-bold text-red-100">V1.5 설정을 불러오지 못했습니다: {err instanceof Error ? err.message : '알 수 없는 오류'}</section>;
  }
  if (combatQuery.isLoading || audioQuery.isLoading || loadedRaid !== raidId) {
    return <section className="rounded-card-lg border border-cyan-400/25 bg-bg-card p-6"><div className="flex min-h-[160px] items-center justify-center"><LoadingSpinner /></div></section>;
  }

  return (
    <section className="rounded-card-lg border border-cyan-400/25 bg-bg-card p-4 shadow-[0_0_28px_rgba(34,211,238,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">RAID V1.5 CONFIGURATION</div>
          <h2 className="mt-1 text-lg font-black text-white">⚙️ 전투 기믹 · 패턴 · 중계 오디오</h2>
          <p className="mt-1 text-xs font-bold text-amber-100">실제 서버 전투 엔진이 사용하는 설정입니다. 전투 시작 후에는 전투·패턴 설정이 잠깁니다.</p>
        </div>
        {!editableCombat ? <span className="rounded-full border border-amber-300/40 bg-amber-500/10 px-3 py-1 text-[11px] font-black text-amber-100">🔒 전투 설정 읽기 전용</span> : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <TabButton active={tab === 'COMBAT'} onClick={() => setTab('COMBAT')}>🛡 전투 기믹</TabButton>
        <TabButton active={tab === 'PATTERNS'} onClick={() => setTab('PATTERNS')}>🧩 패턴 에디터 <span className="ml-1 text-[10px]">{patterns.length}</span></TabButton>
        <TabButton active={tab === 'AUDIO'} onClick={() => setTab('AUDIO')}>🔊 오디오 프로필</TabButton>
      </div>

      {tab === 'COMBAT' ? <CombatEditor value={combat} onChange={setCombat} disabled={!editableCombat} saving={saving === 'COMBAT'} onSave={saveCombat} /> : null}
      {tab === 'PATTERNS' ? (
        <div className="mt-4 space-y-5">
          <PatternSection title="공통 기믹" description="WEAK_POINT · BREAK · ENRAGE. GROGGY 기본값은 전투 기믹 탭에서 설정합니다." patterns={commonPatterns} allPatterns={patterns} setPatterns={setPatterns} disabled={!editableCombat} raidStatus={raidStatus} savingKey={saving} onTriggerManual={triggerManual} />
          <PatternSection title="보스 특수 패턴" description="Boss당 2개 정도를 권장합니다. 필요한 경우 더 추가할 수 있습니다." patterns={specialPatterns} allPatterns={patterns} setPatterns={setPatterns} disabled={!editableCombat} raidStatus={raidStatus} savingKey={saving} onTriggerManual={triggerManual} special />
          <div className="flex justify-end"><button type="button" onClick={savePatterns} disabled={!editableCombat || saving !== null} className="btn-primary disabled:opacity-40">{saving === 'PATTERNS' ? '저장 중…' : '🧩 전체 패턴 저장'}</button></div>
        </div>
      ) : null}
      {tab === 'AUDIO' ? <AudioEditor value={audio} onChange={setAudio} disabled={!editableAudio} saving={saving === 'AUDIO'} onSave={saveAudio} /> : null}
    </section>
  );
}

function CombatEditor({ value, onChange, disabled, saving, onSave }: { value: RaidV15CombatConfig; onChange: (v: RaidV15CombatConfig) => void; disabled: boolean; saving: boolean; onSave: () => void }) {
  const set = <K extends keyof RaidV15CombatConfig>(key: K, next: RaidV15CombatConfig[K]) => onChange({ ...value, [key]: next });
  return <div className="mt-4 space-y-4">
    <div className="grid gap-3 lg:grid-cols-3">
      <ConfigCard title="🛡 공명방벽" subtitle="출전 모험가들의 공용 생존 자원">
        <ToggleRow label="공명방벽 사용" checked={value.enabled} onChange={(v) => set('enabled', v)} disabled={disabled} />
        <NumberInput label="학생 기본 방벽 기여" value={value.barrier_base_per_adventurer} onChange={(v) => set('barrier_base_per_adventurer', v)} disabled={disabled} step={100} />
        <NumberInput label="공명력 배율" value={value.barrier_resonance_factor} onChange={(v) => set('barrier_resonance_factor', v)} disabled={disabled} step={0.01} />
        <NumberInput label="출전 판정 창(초)" value={value.presence_window_seconds} onChange={(v) => set('presence_window_seconds', v)} disabled={disabled} step={1} />
      </ConfigCard>
      <ConfigCard title="⚔️ Boss 기본 공격" subtitle="공명방벽에 주기적으로 들어오는 서버 공격">
        <TextInput label="공격 이름" value={value.boss_attack_name} onChange={(v) => set('boss_attack_name', v)} disabled={disabled} />
        <NumberInput label="공격 간격(초)" value={value.boss_attack_interval_seconds} onChange={(v) => set('boss_attack_interval_seconds', v)} disabled={disabled} step={1} />
        <NumberInput label="예고 시간(초)" value={value.boss_attack_telegraph_seconds} onChange={(v) => set('boss_attack_telegraph_seconds', v)} disabled={disabled} step={0.5} />
        <NumberInput label="고정 피해" value={value.boss_attack_fixed_damage} onChange={(v) => set('boss_attack_fixed_damage', v)} disabled={disabled} step={100} />
        <NumberInput label="방벽 비율 피해 (0~1)" value={value.boss_attack_barrier_ratio} onChange={(v) => set('boss_attack_barrier_ratio', v)} disabled={disabled} step={0.01} />
      </ConfigCard>
      <ConfigCard title="✨ Groggy · Enrage" subtitle="공통 기믹의 기본 배율">
        <NumberInput label="기본 Groggy(초)" value={value.default_groggy_seconds} onChange={(v) => set('default_groggy_seconds', v)} disabled={disabled} step={0.5} />
        <NumberInput label="Groggy 피해 배율" value={value.default_groggy_multiplier} onChange={(v) => set('default_groggy_multiplier', v)} disabled={disabled} step={0.05} />
        <NumberInput label="Enrage Boss 피해 배율" value={value.enrage_boss_damage_multiplier} onChange={(v) => set('enrage_boss_damage_multiplier', v)} disabled={disabled} step={0.05} />
        <NumberInput label="Enrage 학생 피해 배율" value={value.enrage_player_damage_multiplier} onChange={(v) => set('enrage_player_damage_multiplier', v)} disabled={disabled} step={0.05} />
      </ConfigCard>
    </div>
    <div className="flex justify-end"><button type="button" onClick={onSave} disabled={disabled || saving} className="btn-primary disabled:opacity-40">{saving ? '저장 중…' : '🛡 전투 기믹 저장'}</button></div>
  </div>;
}

function PatternSection({ title, description, patterns, allPatterns, setPatterns, disabled, raidStatus, savingKey, onTriggerManual, special = false }: { title: string; description: string; patterns: RaidV15Pattern[]; allPatterns: RaidV15Pattern[]; setPatterns: (v: RaidV15Pattern[]) => void; disabled: boolean; raidStatus: RaidStatus; savingKey: string | null; onTriggerManual: (pattern: RaidV15Pattern) => void; special?: boolean }) {
  const update = (target: RaidV15Pattern, next: RaidV15Pattern) => setPatterns(allPatterns.map((p) => p === target ? next : p));
  const remove = (target: RaidV15Pattern) => setPatterns(allPatterns.filter((p) => p !== target));
  const add = () => {
    const type: RaidV15PatternType = special ? 'ABSORB' : 'WEAK_POINT';
    const seq = Math.min(999, (Math.max(0, ...allPatterns.map((p) => Number(p.seq) || 0)) || 0) + 10);
    setPatterns([...allPatterns, makePattern(type, seq)]);
  };
  return <div>
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <div><h3 className="text-sm font-black text-white">{title}</h3><p className="mt-0.5 text-[11px] font-bold text-cyan-100">{description}</p></div>
      <button type="button" onClick={add} disabled={disabled} className="rounded-card-md border border-cyan-300/40 bg-cyan-500/10 px-3 py-2 text-xs font-black text-cyan-100 disabled:opacity-40">+ 패턴 추가</button>
    </div>
    <div className="space-y-3">
      {patterns.length === 0 ? <div className="rounded-card-md border border-dashed border-cyan-400/25 bg-bg-deep p-5 text-center text-xs font-bold text-amber-100">등록된 패턴이 없습니다.</div> : null}
      {patterns.map((pattern) => <PatternCard key={pattern.client_key ?? `db-${pattern.id ?? 'missing'}`} pattern={pattern} onChange={(next) => update(pattern, next)} onDelete={() => remove(pattern)} disabled={disabled} common={!special} canTriggerManual={raidStatus === 'ACTIVE' && pattern.trigger_kind === 'MANUAL' && Boolean(pattern.id)} triggering={savingKey === `TRIGGER-${pattern.id ?? 0}`} onTriggerManual={() => onTriggerManual(pattern)} />)}
    </div>
  </div>;
}

function PatternCard({ pattern, onChange, onDelete, disabled, common, canTriggerManual, triggering, onTriggerManual }: { pattern: RaidV15Pattern; onChange: (p: RaidV15Pattern) => void; onDelete: () => void; disabled: boolean; common: boolean; canTriggerManual: boolean; triggering: boolean; onTriggerManual: () => void }) {
  const set = <K extends keyof RaidV15Pattern>(key: K, value: RaidV15Pattern[K]) => onChange({ ...pattern, [key]: value });
  const allowedTypes = PATTERN_TYPES.filter((t) => common ? t.common : !t.common);
  const displayType = pattern.pattern_type === 'BOSS_STRIKE' ? 'ULTIMATE' : pattern.pattern_type;
  const changeType = (type: RaidV15PatternType) => onChange({ ...pattern, pattern_type: type, name: defaultPatternName(type), config: defaultPatternConfig(type) });
  return <div className={cn('rounded-card-md border p-3', pattern.is_enabled ? 'border-cyan-300/30 bg-bg-deep' : 'border-amber-300/20 bg-black/20 opacity-70')}>
    <div className="grid gap-2 xl:grid-cols-[86px_1.5fr_1.2fr_1.1fr_110px_92px_minmax(150px,auto)]">
      <NumberInput compact label="순서" value={pattern.seq} onChange={(v) => set('seq', Math.round(v))} disabled={disabled} step={10} />
      <TextInput compact label="패턴 이름" value={pattern.name} onChange={(v) => set('name', v)} disabled={disabled} />
      <SelectInput label="종류" value={displayType} options={allowedTypes} onChange={(v) => changeType(v as RaidV15PatternType)} disabled={disabled} />
      <SelectInput label="Trigger" value={pattern.trigger_kind} options={TRIGGERS} onChange={(v) => set('trigger_kind', v as RaidV15TriggerKind)} disabled={disabled} />
      <NumberInput compact label={triggerValueLabel(pattern.trigger_kind)} value={pattern.trigger_kind === 'MANUAL' ? 0 : pattern.trigger_value} onChange={(v) => set('trigger_value', v)} disabled={disabled || pattern.trigger_kind === 'MANUAL'} step={pattern.trigger_kind.includes('RATIO') ? 0.05 : 1} />
      <NumberInput compact label="지속(초)" value={pattern.duration_seconds} onChange={(v) => set('duration_seconds', v)} disabled={disabled} step={0.5} />
      <div className="flex items-end gap-1.5 pb-0.5">{pattern.trigger_kind === 'MANUAL' ? <button type="button" onClick={onTriggerManual} disabled={!canTriggerManual || triggering} className="rounded-card-md border border-gold/50 bg-gold/10 px-2 py-2 text-[10px] font-black text-yellow-100 disabled:opacity-40">{triggering ? '발동 중…' : '▶ 발동'}</button> : null}<button type="button" onClick={() => set('is_enabled', !pattern.is_enabled)} disabled={disabled} className="rounded-card-md border border-cyan-300/30 bg-cyan-500/10 px-2 py-2 text-[10px] font-black text-cyan-100 disabled:opacity-40">{pattern.is_enabled ? 'ON' : 'OFF'}</button><button type="button" onClick={onDelete} disabled={disabled} className="rounded-card-md border border-red-300/30 bg-red-500/10 px-2 py-2 text-[10px] font-black text-red-100 disabled:opacity-40">삭제</button></div>
    </div>
    {pattern.trigger_kind === 'RANDOM_WINDOW' ? <div className="mt-2 max-w-[220px]"><NumberInput label="랜덤 시간창 종료(초)" value={numberFrom(pattern.config.window_end_seconds, pattern.trigger_value + 10)} onChange={(v) => set('config', { ...pattern.config, window_end_seconds: v })} disabled={disabled} step={1} /></div> : null}
    <PatternConfigFields pattern={pattern} onChange={onChange} disabled={disabled} />
  </div>;
}

function PatternConfigFields({ pattern, onChange, disabled }: { pattern: RaidV15Pattern; onChange: (p: RaidV15Pattern) => void; disabled: boolean }) {
  const type = pattern.pattern_type === 'BOSS_STRIKE' ? 'ULTIMATE' : pattern.pattern_type;
  const config = pattern.config ?? {};
  const setConfig = (key: string, value: unknown) => onChange({ ...pattern, config: { ...config, [key]: value } });
  const n = (key: string, fallback: number, label: string, step = 0.01) => <NumberInput key={key} label={label} value={numberFrom(config[key], fallback)} onChange={(v) => setConfig(key, v)} disabled={disabled} step={step} />;
  const json = (key: string, label: string, fallback: unknown) => <JsonInput key={key} label={label} value={config[key] ?? fallback} onChange={(v) => setConfig(key, v)} disabled={disabled} />;
  let fields: ReactNode[] = [];
  switch (type) {
    case 'WEAK_POINT': fields = [n('x',0.42,'X'),n('y',0.30,'Y'),n('width',0.16,'폭'),n('height',0.22,'높이'),n('multiplier',2,'약점 배율',0.1),n('body_multiplier',1,'본체 배율',0.1)]; break;
    case 'BREAK': case 'ULTIMATE': fields = [n('objective_hp_ratio',type==='ULTIMATE'?0.05:0.04,'목표 HP 비율',0.005),n('groggy_seconds',7,'Groggy 초',0.5),n('groggy_multiplier',1.4,'Groggy 배율',0.05),n('fail_damage_fixed',0,'실패 고정 피해',100),n('fail_damage_percent',type==='ULTIMATE'?15:12,'실패 방벽 %',1)]; break;
    case 'ABSORB': fields = [n('heal_ratio',1,'회복 비율',0.1)]; break;
    case 'REFLECT': fields = [n('reflect_ratio',0.3,'반사 비율',0.05),n('boss_damage_multiplier',1,'Boss 피해 배율',0.1)]; break;
    case 'DOT': fields = [n('tick_interval_seconds',1,'Tick 간격(초)',0.25),n('tick_fixed_damage',0,'Tick 고정 피해',100),n('tick_barrier_percent',0.03,'Tick 방벽 비율',0.005),json('interrupt_target','중단 목표 JSON',null)]; break;
    case 'SHIELD': fields = [n('shield_hp_ratio',0.05,'Shield HP 비율',0.005),n('boss_damage_while_shield',0,'Shield 중 Boss 피해 배율',0.1),n('groggy_seconds',4,'Groggy 초',0.5),n('groggy_multiplier',1.2,'Groggy 배율',0.05)]; break;
    case 'MULTI_CORE': fields = [<SelectConfig key="mode" label="핵 모드" value={String(config.mode ?? 'FIXED_ORDER')} options={[{value:'ANY_ORDER',label:'자유 순서'},{value:'FIXED_ORDER',label:'고정 순서'},{value:'RANDOM_ORDER',label:'랜덤 순서'}]} onChange={(v)=>setConfig('mode',v)} disabled={disabled}/>,n('wrong_barrier_percent',0.02,'오답 방벽 비율',0.005),n('wrong_boss_heal_ratio',0,'오답 Boss 회복 비율',0.01),n('wrong_time_penalty_seconds',0,'오답 시간 페널티',0.5),json('cores','핵 배열 JSON',[])]; break;
    case 'SPLIT_TARGET': fields = [n('max_difference_percent',25,'허용 불균형 %',1),n('unbalanced_efficiency',0.35,'불균형 공격 효율',0.05),n('success_bonus_damage_ratio',0.02,'성공 추가 Boss 피해',0.005),n('groggy_seconds',4,'Groggy 초',0.5),json('targets','분산 목표 배열 JSON',[])]; break;
    case 'REGEN': fields = [n('tick_interval_seconds',1,'회복 Tick(초)',0.25),n('heal_per_tick_fixed',0,'Tick 고정 회복',100),n('heal_per_tick_percent',0.01,'Tick HP 회복 비율',0.005),n('core_hp_ratio',0.02,'재생핵 HP 비율',0.005),json('core','재생핵 JSON',null)]; break;
    case 'SEAL': fields = [n('damage_reduction',0.7,'Boss 피해 감소율',0.05),n('groggy_seconds',3,'Groggy 초',0.5),n('groggy_multiplier',1.15,'Groggy 배율',0.05),json('seals','봉인석 배열 JSON',[])]; break;
    case 'DAMAGE_CHECK': fields = [n('target_damage_ratio',0.06,'목표 실제 피해 비율',0.005),n('groggy_seconds',3,'Groggy 초',0.5),n('groggy_multiplier',1.15,'Groggy 배율',0.05),n('fail_damage_fixed',0,'실패 고정 피해',100),n('fail_damage_percent',10,'실패 방벽 %',1)]; break;
    case 'ENRAGE': fields = [n('boss_damage_multiplier',1.25,'Boss 피해 배율',0.05),n('player_damage_multiplier',1,'학생 피해 배율',0.05)]; break;
  }
  return <div className="mt-3 border-t border-cyan-300/10 pt-3"><div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">TYPE CONFIG</div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{fields}</div></div>;
}

function AudioEditor({ value, onChange, disabled, saving, onSave }: { value: Omit<RaidV15AudioProfile, 'raid_id' | 'configured'>; onChange: (v: Omit<RaidV15AudioProfile, 'raid_id' | 'configured'>) => void; disabled: boolean; saving: boolean; onSave: () => void }) {
  const set = (key: keyof typeof value, next: string | number | null) => onChange({ ...value, [key]: next });
  return <div className="mt-4 space-y-4">
    <div className="grid gap-3 lg:grid-cols-3"><VolumeControl label="Master" value={value.master_volume} onChange={(v)=>set('master_volume',v)} disabled={disabled}/><VolumeControl label="BGM" value={value.bgm_volume} onChange={(v)=>set('bgm_volume',v)} disabled={disabled}/><VolumeControl label="SFX" value={value.sfx_volume} onChange={(v)=>set('sfx_volume',v)} disabled={disabled}/></div>
    <AudioGroup title="🎵 BGM" fields={[[ 'lobby_bgm_url','Lobby BGM'],['battle_bgm_url','Battle BGM'],['enrage_bgm_url','Enrage BGM'],['raid_success_bgm_url','Success BGM'],['raid_failure_bgm_url','Failure BGM']]} value={value} set={set} disabled={disabled}/>
    <AudioGroup title="⚔️ 공격 SFX" fields={[[ 'raid_start_sfx_url','Raid Start'],['normal_hit_sfx_url','Normal Hit'],['crit_hit_sfx_url','Critical Hit'],['powerful_hit_sfx_url','Powerful Hit'],['devastating_hit_sfx_url','Devastating Hit']]} value={value} set={set} disabled={disabled}/>
    <AudioGroup title="🛡 기믹 SFX" fields={[[ 'break_start_sfx_url','Break Start'],['break_success_sfx_url','Break Success'],['break_fail_sfx_url','Break Fail'],['barrier_hit_sfx_url','Barrier Hit'],['barrier_critical_sfx_url','Barrier Critical']]} value={value} set={set} disabled={disabled}/>
    <div className="flex items-center justify-between gap-3"><p className="text-[11px] font-bold text-cyan-100">URL이 비어 있으면 E4-D 중계화면은 합성 SFX 또는 무음 BGM fallback을 사용합니다.</p><button type="button" onClick={onSave} disabled={disabled || saving} className="btn-primary disabled:opacity-40">{saving?'저장 중…':'🔊 오디오 저장'}</button></div>
  </div>;
}

function AudioGroup({ title, fields, value, set, disabled }: { title: string; fields: Array<[keyof Omit<RaidV15AudioProfile,'raid_id'|'configured'>,string]>; value: Omit<RaidV15AudioProfile,'raid_id'|'configured'>; set: (key:keyof typeof value,next:string|number|null)=>void; disabled:boolean }) {
  return <div className="rounded-card-md border border-cyan-300/15 bg-bg-deep p-3"><h3 className="mb-2 text-sm font-black text-white">{title}</h3><div className="grid gap-2 lg:grid-cols-2">{fields.map(([key,label])=><TextInput key={String(key)} label={label} value={String(value[key] ?? '')} onChange={(v)=>set(key,v.trim()||null)} disabled={disabled} placeholder="https://..." />)}</div></div>;
}

function VolumeControl({ label, value, onChange, disabled }: { label:string; value:number; onChange:(v:number)=>void; disabled:boolean }) { return <label className="rounded-card-md border border-cyan-300/15 bg-bg-deep p-3"><div className="flex justify-between text-xs font-black text-cyan-100"><span>{label}</span><span>{Math.round(value*100)}%</span></div><input type="range" min="0" max="1" step="0.01" value={value} onChange={(e)=>onChange(Number(e.target.value))} disabled={disabled} className="mt-2 w-full accent-cyan-300" /></label>; }
function ConfigCard({ title, subtitle, children }: { title:string; subtitle:string; children:ReactNode }) { return <div className="rounded-card-md border border-cyan-300/15 bg-bg-deep p-3"><h3 className="text-sm font-black text-white">{title}</h3><p className="mb-3 mt-0.5 text-[10px] font-bold text-cyan-100">{subtitle}</p><div className="space-y-2">{children}</div></div>; }
function TabButton({ active, onClick, children }: { active:boolean; onClick:()=>void; children:ReactNode }) { return <button type="button" onClick={onClick} className={cn('rounded-card-md border px-3 py-2 text-xs font-black transition',active?'border-gold/60 bg-gold/15 text-yellow-100':'border-cyan-300/20 bg-bg-deep text-cyan-100 hover:border-cyan-300/50')}>{children}</button>; }
function ToggleRow({ label, checked, onChange, disabled }: { label:string; checked:boolean; onChange:(v:boolean)=>void; disabled:boolean }) { return <label className="flex items-center justify-between gap-3 text-xs font-black text-cyan-100"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e)=>onChange(e.target.checked)} disabled={disabled} className="h-4 w-4 accent-cyan-300" /></label>; }
function NumberInput({ label, value, onChange, disabled, step=1, compact=false }: { label:string; value:number; onChange:(v:number)=>void; disabled:boolean; step?:number; compact?:boolean }) { return <label className="block"><span className="mb-1 block text-[10px] font-black text-cyan-100">{label}</span><input type="number" value={Number.isFinite(value)?value:0} step={step} onChange={(e)=>onChange(Number(e.target.value))} disabled={disabled} className={cn('w-full rounded-card-md border border-cyan-300/20 bg-black/30 px-2 text-xs font-bold text-white outline-none focus:border-cyan-300/60 disabled:opacity-50',compact?'py-2':'py-2.5')} /></label>; }
function TextInput({ label, value, onChange, disabled, placeholder='', compact=false }: { label:string; value:string; onChange:(v:string)=>void; disabled:boolean; placeholder?:string; compact?:boolean }) { return <label className="block"><span className="mb-1 block text-[10px] font-black text-cyan-100">{label}</span><input type="text" value={value} placeholder={placeholder} onChange={(e)=>onChange(e.target.value)} disabled={disabled} className={cn('w-full rounded-card-md border border-cyan-300/20 bg-black/30 px-2 text-xs font-bold text-white outline-none placeholder:text-cyan-100/30 focus:border-cyan-300/60 disabled:opacity-50',compact?'py-2':'py-2.5')} /></label>; }
function SelectInput({ label, value, options, onChange, disabled }: { label:string; value:string; options:Array<{value:string;label:string}>; onChange:(v:string)=>void; disabled:boolean }) { return <label className="block"><span className="mb-1 block text-[10px] font-black text-cyan-100">{label}</span><select value={value} onChange={(e)=>onChange(e.target.value)} disabled={disabled} className="w-full rounded-card-md border border-cyan-300/20 bg-black/60 px-2 py-2 text-xs font-bold text-white outline-none focus:border-cyan-300/60 disabled:opacity-50">{options.map((o)=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>; }
function SelectConfig(props:{label:string;value:string;options:Array<{value:string;label:string}>;onChange:(v:string)=>void;disabled:boolean}) { return <SelectInput {...props}/>; }
function JsonInput({ label, value, onChange, disabled }: { label:string; value:unknown; onChange:(v:unknown)=>void; disabled:boolean }) { const [draft,setDraft]=useState(()=>value==null?'':JSON.stringify(value)); useEffect(()=>setDraft(value==null?'':JSON.stringify(value)),[value]); return <label className="block sm:col-span-2"><span className="mb-1 block text-[10px] font-black text-cyan-100">{label}</span><textarea rows={2} value={draft} onChange={(e)=>setDraft(e.target.value)} onBlur={()=>{try{onChange(draft.trim()?JSON.parse(draft):null);}catch{window.alert(`${label}: JSON 형식을 확인해주세요.`);setDraft(value==null?'':JSON.stringify(value));}}} disabled={disabled} className="w-full rounded-card-md border border-cyan-300/20 bg-black/30 px-2 py-2 font-mono text-[10px] font-bold text-white outline-none focus:border-cyan-300/60 disabled:opacity-50" /></label>; }

function normalizePattern(p: RaidV15Pattern): RaidV15Pattern { return { ...p, client_key: p.client_key ?? (p.id ? `db-${p.id}` : makeClientKey()), pattern_type: p.pattern_type === 'BOSS_STRIKE' ? 'ULTIMATE' : p.pattern_type, config: p.config ?? {} }; }
function isCommon(type: RaidV15PatternType) { const t=type==='BOSS_STRIKE'?'ULTIMATE':type; return t==='WEAK_POINT'||t==='BREAK'||t==='ENRAGE'; }
function triggerValueLabel(trigger: RaidV15TriggerKind) { if(trigger==='HP_RATIO'||trigger==='BARRIER_RATIO') return '비율(0~1)'; if(trigger==='AFTER_PATTERN') return '이후 Seq'; if(trigger==='MANUAL') return '수동'; return '값'; }
function numberFrom(value: unknown, fallback:number) { const n=Number(value); return Number.isFinite(n)?n:fallback; }
function defaultPatternName(type:RaidV15PatternType) { const t=PATTERN_TYPES.find((x)=>x.value===type); return t?.label.replace(/^\S+\s/,'') ?? type; }
function defaultPatternConfig(type:RaidV15PatternType):Record<string,unknown> { switch(type){case'WEAK_POINT':return{x:.42,y:.3,width:.16,height:.22,multiplier:2,body_multiplier:1};case'BREAK':return{objective_hp_ratio:.04,groggy_seconds:7,groggy_multiplier:1.4,fail_damage_fixed:3000,fail_damage_percent:12};case'ENRAGE':return{boss_damage_multiplier:1.25,player_damage_multiplier:1};case'ABSORB':return{heal_ratio:1};case'REFLECT':return{reflect_ratio:.3,boss_damage_multiplier:1};case'ULTIMATE':return{objective_hp_ratio:.05,groggy_seconds:7,groggy_multiplier:1.4,fail_damage_fixed:8000,fail_damage_percent:18};case'DOT':return{tick_interval_seconds:1,tick_fixed_damage:0,tick_barrier_percent:.03,interrupt_target:null};case'SHIELD':return{shield_hp_ratio:.05,boss_damage_while_shield:0,groggy_seconds:4,groggy_multiplier:1.2};case'MULTI_CORE':return{mode:'FIXED_ORDER',cores:[],wrong_barrier_percent:.02};case'SPLIT_TARGET':return{targets:[],max_difference_percent:25,unbalanced_efficiency:.35,success_bonus_damage_ratio:.02,groggy_seconds:4};case'REGEN':return{tick_interval_seconds:1,heal_per_tick_percent:.01,core_hp_ratio:.02,core:null};case'SEAL':return{seals:[],damage_reduction:.7,groggy_seconds:3,groggy_multiplier:1.15};case'DAMAGE_CHECK':return{target_damage_ratio:.06,groggy_seconds:3,groggy_multiplier:1.15,fail_damage_percent:10};default:return{};} }
function makeClientKey() { return `new-${Date.now()}-${Math.random().toString(36).slice(2,10)}`; }
function makePattern(type:RaidV15PatternType,seq:number):RaidV15Pattern { return { client_key:makeClientKey(),seq,name:defaultPatternName(type),pattern_type:type,trigger_kind:'TIME_SECONDS',trigger_value:30,duration_seconds:type==='ABSORB'?4:7,config:defaultPatternConfig(type),is_enabled:true }; }
function validateCombat(c: RaidV15CombatConfig) {
  if (c.barrier_base_per_adventurer < 0 || c.barrier_base_per_adventurer > 1_000_000) { window.alert('학생 기본 방벽 기여는 0~1,000,000 범위입니다.'); return false; }
  if (c.barrier_resonance_factor < 0 || c.barrier_resonance_factor > 100) { window.alert('공명력 배율은 0~100 범위입니다.'); return false; }
  if (!Number.isInteger(c.presence_window_seconds) || c.presence_window_seconds < 5 || c.presence_window_seconds > 120) { window.alert('출전 판정 창은 5~120초 정수입니다.'); return false; }
  if (c.default_groggy_seconds < 1 || c.default_groggy_seconds > 60) { window.alert('기본 Groggy 시간은 1~60초입니다.'); return false; }
  if (c.default_groggy_multiplier < 1 || c.default_groggy_multiplier > 10) { window.alert('Groggy 피해 배율은 1~10 범위입니다.'); return false; }
  if (c.enrage_boss_damage_multiplier < 1 || c.enrage_boss_damage_multiplier > 10) { window.alert('Enrage Boss 피해 배율은 1~10 범위입니다.'); return false; }
  if (c.enrage_player_damage_multiplier < 0.1 || c.enrage_player_damage_multiplier > 10) { window.alert('Enrage 학생 피해 배율은 0.1~10 범위입니다.'); return false; }
  if (c.boss_attack_interval_seconds < 2 || c.boss_attack_interval_seconds > 120) { window.alert('Boss 공격 간격은 2~120초입니다.'); return false; }
  if (c.boss_attack_telegraph_seconds < 0 || c.boss_attack_telegraph_seconds > 30 || c.boss_attack_telegraph_seconds >= c.boss_attack_interval_seconds) { window.alert('Boss 공격 예고 시간은 0~30초이며 공격 간격보다 짧아야 합니다.'); return false; }
  if (c.boss_attack_fixed_damage < 0) { window.alert('Boss 고정 피해는 0 이상이어야 합니다.'); return false; }
  if (c.boss_attack_barrier_ratio < 0 || c.boss_attack_barrier_ratio > 1) { window.alert('방벽 비율 피해는 0~1 범위입니다.'); return false; }
  if (!c.boss_attack_name.trim()) { window.alert('Boss 공격 이름을 입력해주세요.'); return false; }
  return true;
}
function validatePatterns(ps: RaidV15Pattern[]) {
  const seqs = new Set<number>();
  const bySeq = new Map<number, RaidV15Pattern>();
  for (const p of ps) {
    if (!Number.isInteger(p.seq) || p.seq < 1 || p.seq > 999) { window.alert('패턴 순서는 1~999 정수여야 합니다.'); return false; }
    if (seqs.has(p.seq)) { window.alert(`패턴 순서 ${p.seq}가 중복됩니다.`); return false; }
    seqs.add(p.seq); bySeq.set(p.seq, p);
    if (!p.name.trim()) { window.alert('모든 패턴에 이름을 입력해주세요.'); return false; }
    if (p.duration_seconds < 0.5 || p.duration_seconds > 120) { window.alert(`${p.name}: 지속시간은 0.5~120초입니다.`); return false; }
    if ((p.trigger_kind === 'HP_RATIO' || p.trigger_kind === 'BARRIER_RATIO') && (p.trigger_value < 0 || p.trigger_value > 1)) { window.alert(`${p.name}: 비율 Trigger는 0~1입니다.`); return false; }
    if ((p.trigger_kind === 'TIME_SECONDS' || p.trigger_kind === 'TIME_REMAINING' || p.trigger_kind === 'RANDOM_WINDOW') && p.trigger_value < 0) { window.alert(`${p.name}: 시간 Trigger는 0 이상이어야 합니다.`); return false; }
    if (p.trigger_kind === 'AFTER_PATTERN' && (!Number.isInteger(p.trigger_value) || p.trigger_value < 1 || p.trigger_value > 999)) { window.alert(`${p.name}: AFTER_PATTERN은 다른 패턴의 Seq(1~999)를 입력합니다.`); return false; }
    if (p.trigger_kind === 'RANDOM_WINDOW') {
      const windowEnd = numberFrom(p.config?.window_end_seconds, p.trigger_value + 10);
      if (windowEnd <= p.trigger_value) { window.alert(`${p.name}: 랜덤 시간창 종료는 시작(${p.trigger_value}초)보다 커야 합니다.`); return false; }
    }
  }
  for (const p of ps) {
    if (p.trigger_kind !== 'AFTER_PATTERN') continue;
    const target = bySeq.get(p.trigger_value);
    if (!target) { window.alert(`${p.name}: 참조할 Seq ${p.trigger_value}가 존재하지 않습니다.`); return false; }
    if (target.seq === p.seq) { window.alert(`${p.name}: 자기 자신을 AFTER_PATTERN으로 참조할 수 없습니다.`); return false; }
    if (p.is_enabled && !target.is_enabled) { window.alert(`${p.name}: 활성 패턴은 비활성 Seq ${target.seq}를 참조할 수 없습니다.`); return false; }
  }
  const links = new Map<number, number>();
  for (const p of ps) if (p.is_enabled && p.trigger_kind === 'AFTER_PATTERN') links.set(p.seq, p.trigger_value);
  for (const startSeq of links.keys()) {
    const seen = new Set<number>();
    let current: number | undefined = startSeq;
    while (current !== undefined && links.has(current)) {
      if (seen.has(current)) { window.alert(`AFTER_PATTERN 순환참조가 있습니다. Seq ${[...seen, current].join(' → ')}`); return false; }
      seen.add(current); current = links.get(current);
    }
  }
  return true;
}
