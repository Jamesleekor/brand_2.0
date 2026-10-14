import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import {
  raidV15AdminRpc, type RaidV15CombatConfig, type RaidV15Pattern,
} from '@/lib/rpc/raid_v15_admin_rpc';
import {
  DIFFICULTY_LABEL, describeGeneratedPattern, ensureRaidCommonPatterns, generateRaidPatternSet, mergeGeneratedRaidPatterns,
  rerollRaidPatternSlot, validateGeneratedRaidPatterns,
  type GeneratedRaidPatternSet, type PatternDifficulty, type RaidGeneratorContext,
} from './raidPatternEngine';

type Props = {
  raidId: number;
  bossName: string;
  visualReady: boolean;
  rewardEnabled: boolean;
  maxHp: number;
  damageCoefficient: number;
  varianceMin: number;
  varianceMax: number;
  critMultiplier: number;
  tapRateLimit: number;
  patterns: RaidV15Pattern[];
  combat: RaidV15CombatConfig;
  disabled: boolean;
  onApplied: () => Promise<void>;
  onOpenLobby?: () => void;
};

const SPECIAL_SET = new Set(['ABSORB','REFLECT','ULTIMATE','BOSS_STRIKE','DOT','SHIELD','MULTI_CORE','SPLIT_TARGET','REGEN','SEAL','DAMAGE_CHECK']);
const sec = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
function detailText(pattern: RaidV15Pattern): string {
  const cfg = pattern.config;
  const fmt = (key: string) => `${(Number(cfg[key] ?? 0) * 100).toFixed(1)}%`;
  switch (pattern.pattern_type) {
    case 'ULTIMATE': case 'BOSS_STRIKE': case 'DAMAGE_CHECK':
      return `실패 방벽 피해 ${fmt('fail_damage_percent')} · 무력화 ${cfg.groggy_seconds ?? 0}초`;
    case 'MULTI_CORE': return `오답 시 방벽 피해 ${fmt('wrong_barrier_percent')} · 순서 ${cfg.mode === 'RANDOM_ORDER' ? '무작위' : '고정'}`;
    case 'SPLIT_TARGET': return `허용 격차 ${cfg.max_difference_percent}% · 불균형 공격 효율 ${fmt('unbalanced_efficiency')}`;
    case 'DOT': return `1회 방벽 피해 ${fmt('tick_barrier_percent')} · 피해 간격 ${cfg.tick_interval_seconds}초`;
    case 'REGEN': return `틱당 보스 회복 ${fmt('heal_per_tick_percent')} · 재생핵 파괴 가능`;
    case 'SHIELD': return `보스 본체 피해 효율 ${fmt('boss_damage_while_shield')} · 보호막 파괴 시 무력화`;
    case 'SEAL': return `방어력 감소 ${fmt('damage_reduction')} · 봉인석 파괴 가능`;
    case 'ABSORB': case 'REFLECT': return '패턴 중 무분별한 공격을 피하고 전투 상태를 확인해야 합니다.';
    default: return '';
  }
}
const buttonSecondary = 'rounded-lg border border-cyan-300/30 bg-cyan-500/5 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-40';

export default function RaidPatternGenerator({
  raidId, bossName, visualReady, rewardEnabled, maxHp, damageCoefficient, varianceMin, varianceMax,
  critMultiplier, tapRateLimit, patterns, combat, disabled, onApplied, onOpenLobby,
}: Props) {
  const queryClient = useQueryClient();
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<PatternDifficulty>('NORMAL');
  const [preview, setPreview] = useState<GeneratedRaidPatternSet | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [applied, setApplied] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);

  const powerQuery = useQuery({
    queryKey: ['teacher-raid-pattern-power', raidId],
    queryFn: async () => {
      const response = await raidV15AdminRpc.generatorPower(supabase, raidId);
      if (response.success === false) throw new Error(response.error);
      return {
        ...response.data,
        eligible_count: Number(response.data.eligible_count),
        total_raid_power: Number(response.data.total_raid_power),
        average_raid_power: Number(response.data.average_raid_power),
      };
    },
    enabled: !disabled,
    staleTime: 30_000,
  });

  const ctx: RaidGeneratorContext | null = useMemo(() => powerQuery.data ? ({
    maxHp, damageCoefficient, varianceMin, varianceMax, critMultiplier, tapRateLimit,
    power: powerQuery.data, existingPatterns: patterns,
  }) : null, [powerQuery.data, maxHp, damageCoefficient, varianceMin, varianceMax, critMultiplier, tapRateLimit, patterns]);
  const existingSpecials = patterns.filter(p => SPECIAL_SET.has(p.pattern_type));
  const baseline = useMemo(() => {
    if (!ctx) return null;
    try { return generateRaidPatternSet(ctx, count, difficulty, 947151).baseBattleSeconds; }
    catch { return null; }
  }, [ctx, count, difficulty]);

  const createPreview = () => {
    if (!ctx) { setError('학급 Raid Power를 불러오지 못했습니다.'); return; }
    setError(null);
    setApplied(false);
    setExpandedIndex(null);
    try {
      if (10 - excluded.length < count) throw new Error('제외하지 않은 패턴 종류가 선택한 개수보다 적습니다.');
      // Up to eight unique available patterns. Advanced exclusions are optional and kept unobtrusive.
      let generated: GeneratedRaidPatternSet | null = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        const candidate = generateRaidPatternSet(ctx, count, difficulty);
        if (candidate.patterns.every(p => !excluded.includes(p.pattern_type))) { generated = candidate; break; }
      }
      if (!generated) throw new Error('제외 조건이 많아 패턴을 만들 수 없습니다. 제외할 패턴을 줄여주세요.');
      setPreview(generated);
    } catch (e) { setError(e instanceof Error ? e.message : '패턴을 생성하지 못했습니다.'); }
  };

  const reroll = (index: number) => {
    if (!ctx || !preview) return;
    setError(null);
    try {
      let next: GeneratedRaidPatternSet | null = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        const candidate = rerollRaidPatternSlot(ctx, preview, index);
        if (!excluded.includes(candidate.patterns[index].pattern_type)) { next = candidate; break; }
      }
      if (!next) throw new Error('조건에 맞는 다른 패턴이 없습니다.');
      setPreview(next);
      setExpandedIndex(null);
    } catch (e) { setError(e instanceof Error ? e.message : '재생성할 수 없습니다.'); }
  };

  const applyPreview = async () => {
    if (!ctx || !preview || disabled || saving) return;
    const common = ensureRaidCommonPatterns(patterns).filter(p => !SPECIAL_SET.has(p.pattern_type));
    const violations = validateGeneratedRaidPatterns(preview.patterns, common, preview.difficulty);
    if (violations.length) { setError(violations.join(' · ')); return; }
    if (existingSpecials.length > 0 && !window.confirm(`현재 특수 패턴 ${existingSpecials.length}개를 새 구성 ${preview.patterns.length}개로 교체할까요?\n공통 패턴은 유지됩니다.`)) return;
    setSaving(true);
    setError(null);
    try {
      const merged = mergeGeneratedRaidPatterns(patterns, preview.patterns).map(({ client_key: _clientKey, ...p }) => p);
      const result = await raidV15AdminRpc.saveCombat(supabase, raidId, {
        config: { ...combat, metadata: { ...(combat.metadata ?? {}), pattern_generator: {
          version: 1, seed: preview.seed, rerolls: preview.rerolls ?? [],
          difficulty: preview.difficulty, expected_battle_seconds: preview.expectedBattleSeconds,
          special_count: preview.patterns.length,
        } } },
        patterns: merged,
      });
      if (result.success === false) throw new Error(result.error);
      const persisted = (result.data.patterns ?? []).filter(p => SPECIAL_SET.has(p.pattern_type));
      if (persisted.length !== preview.patterns.length) {
        throw new Error('DB 저장 후 패턴 개수가 일치하지 않습니다. 설정을 새로고침해 확인해주세요.');
      }
      // The server canonicalizes ULTIMATE to BOSS_STRIKE.
      for (const item of preview.patterns) {
        if (!persisted.some(p => (p.pattern_type === (item.pattern_type === 'ULTIMATE' ? 'BOSS_STRIKE' : item.pattern_type)) &&
            Number(p.trigger_value) === Number(item.trigger_value))) {
          throw new Error('DB 저장값 검증에 실패했습니다. 화면을 새로고침하여 확인해주세요.');
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['teacher-raid-v15-combat', raidId] });
      await onApplied();
      setApplied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '패턴 적용에 실패했습니다. 기존 구성을 확인해주세요.');
    } finally { setSaving(false); }
  };

  const options: PatternDifficulty[] = ['EASY', 'NORMAL', 'HARD', 'EXTREME'];
  const selectCls = 'w-full rounded-lg border border-cyan-300/30 bg-[#111b29] px-3 py-2 text-sm font-black text-white focus:border-cyan-200 focus:outline-none';
  return (
    <div className="rounded-xl border border-cyan-300/25 bg-[#0b1724] p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-black tracking-[0.16em] text-cyan-200">PHASE 2 · SPECIAL PATTERN</div>
          <h3 className="text-base font-black text-white">특수 패턴 자동 구성</h3>
        </div>
        <span className="text-xs font-bold text-amber-100">기존 전투 기믹만 사용</span>
      </div>
      <div className="flex flex-wrap items-end gap-2 sm:gap-3">
        <label className="min-w-[100px] flex-1 sm:max-w-[132px]">
          <span className="mb-1 block text-xs font-black text-cyan-100">패턴 수</span>
          <select value={count} onChange={e => { setCount(Number(e.target.value)); setPreview(null); setApplied(false); }} className={selectCls} disabled={disabled || saving}>
            {Array.from({ length: 8 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}개</option>)}
          </select>
        </label>
        <label className="min-w-[125px] flex-1 sm:max-w-[154px]">
          <span className="mb-1 block text-xs font-black text-cyan-100">난이도</span>
          <select value={difficulty} onChange={e => { setDifficulty(e.target.value as PatternDifficulty); setPreview(null); setApplied(false); }} className={selectCls} disabled={disabled || saving}>
            {options.map(d => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
          </select>
        </label>
        <div className="min-w-[128px] flex-1 pb-0.5 sm:max-w-[160px]">
          <div className="text-[11px] font-bold text-cyan-100">예상 전투</div>
          <div className="text-lg font-black tabular-nums text-white">{preview ? sec(preview.expectedBattleSeconds) : baseline === null ? '계산 불가' : `약 ${sec(baseline)}+`}</div>
          <div className="text-[10px] font-bold text-amber-100">학급 Raid Power 기준 추정</div>
        </div>
        <button className="btn-primary min-h-[40px] px-4 text-sm disabled:opacity-40" disabled={disabled || saving || powerQuery.isPending || powerQuery.isError} onClick={createPreview} type="button">
          ✦ {preview ? '전체 다시 생성' : '특수 패턴 생성'}
        </button>
      </div>
      {powerQuery.isError && <div role="alert" className="mt-2 text-xs font-bold text-red-200">학급 전투력 정보를 불러올 수 없습니다. {powerQuery.error instanceof Error ? powerQuery.error.message : ''} <button type="button" className="underline" onClick={()=>void powerQuery.refetch()}>다시 시도</button></div>}
      {patterns.every(p => SPECIAL_SET.has(p.pattern_type)) && <div className="mt-1 text-[11px] font-bold text-amber-100">최초 적용 시 공통 기믹 5개도 함께 구성됩니다.</div>}
      {powerQuery.data && <div className="mt-2 text-[11px] font-bold text-cyan-100">현재 {powerQuery.data.eligible_count}명 · 평균 Raid Power {powerQuery.data.average_raid_power.toLocaleString('ko-KR')} · 실전 공격 속도는 추정값입니다.</div>}
      <div className="mt-2">
        <button type="button" onClick={()=>setAdvanced(!advanced)} className="text-[11px] font-bold text-cyan-100 underline-offset-4 hover:underline" aria-expanded={advanced}>고급 설정 {advanced ? '⌃' : '⌄'}</button>
        {advanced && <div className="mt-2 flex flex-wrap gap-2" aria-label="생성에서 제외할 패턴">
          {(['ABSORB','REFLECT','ULTIMATE','DOT','SHIELD','MULTI_CORE','SPLIT_TARGET','REGEN','SEAL','DAMAGE_CHECK'] as const).map(type=><label key={type} className="inline-flex items-center gap-1 rounded-lg border border-cyan-300/20 px-2 py-1 text-[11px] font-bold text-cyan-100"><input type="checkbox" checked={excluded.includes(type)} onChange={e=>{setExcluded(prev=>e.target.checked?[...prev,type]:prev.filter(t=>t!==type));setPreview(null);setApplied(false);}} disabled={disabled || saving} />{type} 제외</label>)}
        </div>}
      </div>

      {preview && <div className="mt-3 border-t border-cyan-300/20 pt-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-black text-white">
          <span>{preview.patterns.length}개 · {DIFFICULTY_LABEL[preview.difficulty]} · 예상 {sec(preview.expectedBattleSeconds)}</span>
          <span className="font-bold text-cyan-100">개별 ↻ 재생성 / 눌러서 상세 확인</span>
        </div>
        <div className="divide-y divide-cyan-300/10 rounded-lg border border-cyan-300/15 bg-black/10">
          {preview.patterns.map((pattern, i)=><div key={pattern.client_key ?? i}>
            <div className="flex min-w-0 items-center gap-2 px-2 py-2 text-xs sm:gap-3">
              <span className="w-5 flex-none text-center font-black text-cyan-100">{String(i+1).padStart(2,'0')}</span>
              <span className="w-12 flex-none font-mono font-bold text-amber-100">{sec(pattern.trigger_value)}</span>
              <button type="button" aria-expanded={expandedIndex===i} onClick={()=>setExpandedIndex(expandedIndex===i?null:i)} className="min-w-0 flex-1 text-left sm:flex sm:items-center sm:gap-3">
                <span className="block min-w-[116px] truncate font-black text-white">{pattern.name}</span>
                <span className="block min-w-0 truncate font-bold text-cyan-100 sm:ml-auto">{describeGeneratedPattern(pattern)}</span>
              </button>
              <button type="button" title="이 패턴만 다시 생성" aria-label={`${i+1}번 패턴 다시 생성`} onClick={()=>reroll(i)} disabled={saving || disabled} className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-cyan-100 hover:bg-cyan-400/15 disabled:opacity-40">↻</button>
            </div>
            {expandedIndex===i && <div className="border-t border-cyan-300/10 bg-[#101f30]/70 px-3 py-2 text-xs font-bold text-amber-100">
              {pattern.pattern_type} · {detailText(pattern)}
            </div>}
          </div>) }
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <button className={buttonSecondary} type="button" disabled={disabled || saving} onClick={createPreview}>전체 다시 생성</button>
          <button className="btn-primary px-4 py-2 text-sm disabled:opacity-40" type="button" disabled={disabled || saving} onClick={()=>void applyPreview()}>{saving ? '적용 중…' : '이 구성 적용'}</button>
        </div>
      </div>}
      {applied && <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-cyan-300/20 pt-3">
        <div className="min-w-0 text-xs font-black text-white">
          <div className="mb-1 text-[10px] tracking-[0.13em] text-cyan-100">PHASE 3 · REVIEW</div>
          <div className="truncate">{bossName} · 패턴 {preview?.patterns.length}개 적용</div>
          <div className="mt-1 font-bold text-amber-100">영상 {visualReady ? '✓' : '미등록'} · 전투 설정 ✓ · 보상 {rewardEnabled ? '사용' : '미사용'}</div>
          {!visualReady && <div className="mt-1 font-bold text-red-200">로비 개방 전 보스 영상을 등록해주세요.</div>}
        </div>
        {!disabled && onOpenLobby && <button type="button" disabled={!visualReady} onClick={onOpenLobby} className={buttonSecondary}>로비 개방 →</button>}
      </div>}
      {error && <div role="alert" className="mt-3 rounded-lg border border-red-300/30 bg-red-950/20 p-2 text-xs font-bold text-red-100">{error}</div>}
    </div>
  );
}
