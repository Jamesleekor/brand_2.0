import type { RaidV15Pattern, RaidV15PatternType } from '@/lib/rpc/raid_v15_admin_rpc';

/** Configuration editor only. Never run this generator during student combat. */
export type PatternDifficulty = 'EASY' | 'NORMAL' | 'HARD' | 'EXTREME';
export type SpecialPatternType = Extract<RaidV15PatternType,
  'ABSORB' | 'REFLECT' | 'ULTIMATE' | 'DOT' | 'SHIELD' | 'MULTI_CORE' |
  'SPLIT_TARGET' | 'REGEN' | 'SEAL' | 'DAMAGE_CHECK'>;

export interface RaidGeneratorPowerProfile {
  raid_id: number;
  eligible_count: number;
  total_raid_power: number;
  average_raid_power: number;
}
export interface RaidGeneratorContext {
  maxHp: number;
  damageCoefficient: number;
  varianceMin: number;
  varianceMax: number;
  critMultiplier: number;
  tapRateLimit: number;
  power: RaidGeneratorPowerProfile;
  existingPatterns: RaidV15Pattern[];
}
export interface GeneratedRaidPatternSet {
  seed: number;
  difficulty: PatternDifficulty;
  expectedBattleSeconds: number;
  baseBattleSeconds: number;
  patterns: RaidV15Pattern[];
  rerolls?: Array<{ index: number; seed: number }>;
}

type Point = { x: number; y: number; width: number; height: number };
const ANCHORS: Point[] = [
  { x: .13, y: .36, width: .15, height: .23 },
  { x: .43, y: .40, width: .14, height: .22 },
  { x: .71, y: .36, width: .15, height: .23 },
  { x: .29, y: .67, width: .15, height: .20 },
  { x: .57, y: .67, width: .15, height: .20 },
];
const TYPES: SpecialPatternType[] = ['ABSORB', 'REFLECT', 'ULTIMATE', 'DOT', 'SHIELD', 'MULTI_CORE', 'SPLIT_TARGET', 'REGEN', 'SEAL', 'DAMAGE_CHECK'];
const COMMON = new Set<RaidV15PatternType>(['WEAK_POINT', 'BREAK', 'ENRAGE']);
export const DIFFICULTY_LABEL: Record<PatternDifficulty, string> = {
  EASY: '쉬움', NORMAL: '보통', HARD: '어려움', EXTREME: '매우 어려움',
};
const LABELS: Record<SpecialPatternType, string> = {
  ABSORB: '힘의 흡수', REFLECT: '반사의 파동', ULTIMATE: '파멸의 일격',
  DOT: '잠식의 파동', SHIELD: '수호의 장막', MULTI_CORE: '다중 핵 공명',
  SPLIT_TARGET: '쌍극의 균형', REGEN: '재생의 심장', SEAL: '봉인의 균열',
  DAMAGE_CHECK: '화력 시험',
};
const STRENGTH: Record<PatternDifficulty, number> = { EASY: 0, NORMAL: 1, HARD: 2, EXTREME: 3 };
const WEIGHTS: Record<PatternDifficulty, number[]> = {
  EASY: [3, 2, 1, 3, 5, 2, 2, 3, 2, 4],
  NORMAL: [3, 3, 2, 3, 4, 3, 3, 3, 3, 4],
  HARD: [2, 3, 3, 3, 3, 5, 5, 4, 4, 4],
  EXTREME: [2, 2, 4, 3, 2, 6, 6, 5, 5, 4],
};
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number, digits = 3) => Number(v.toFixed(digits));
const isSpecial = (p: RaidV15Pattern) => !COMMON.has(p.pattern_type);

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function range(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}
function choice<T>(rng: () => number, candidates: T[], weights: number[]): T {
  const sum = weights.reduce((a, b) => a + b, 0);
  let pointer = rng() * sum;
  for (let i = 0; i < candidates.length; i++) {
    pointer -= weights[i];
    if (pointer <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}
function shuffle<T>(rng: () => number, input: T[]): T[] {
  const values = [...input];
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

/** Same raid-power sum and damage coefficient as raid_snapshot_student / submit_raid_tap_batch.
 * Human tap rate and participation are explicitly estimates, never presented as exact.
 */
export function estimateRaidDps(ctx: RaidGeneratorContext): number {
  if (!Number.isFinite(ctx.power.total_raid_power) || ctx.power.total_raid_power <= 0 || ctx.power.eligible_count <= 0) {
    throw new Error('학급 Raid Power가 없어 자동 계산할 수 없습니다. 먼저 학생 편린 보유 현황을 확인하세요.');
  }
  const avgVariance = (ctx.varianceMin + ctx.varianceMax) / 2;
  const expectedCritFactor = 1 + 0.05 * (Math.max(1, ctx.critMultiplier) - 1);
  const actualTapPerSecond = Math.min(Math.max(1, ctx.tapRateLimit), 3.2);
  const expectedParticipation = 0.72;
  return Math.max(1, ctx.power.total_raid_power * ctx.damageCoefficient * avgVariance * expectedCritFactor * actualTapPerSecond * expectedParticipation);
}
export function estimateRaidBaseSeconds(ctx: RaidGeneratorContext): number {
  const seconds = ctx.maxHp / estimateRaidDps(ctx);
  return Math.ceil(clamp(seconds, 35, 3600));
}

function createPattern(type: SpecialPatternType, difficulty: PatternDifficulty, ctx: RaidGeneratorContext, rng: () => number, durationOverride?: number): RaidV15Pattern {
  const level = STRENGTH[difficulty];
  const seconds = type === 'ABSORB' || type === 'REFLECT' ? range(rng, 3.5, 5.2) : range(rng, 8, 12.5);
  const duration = durationOverride ?? round(Math.max(2.5, seconds - level * .45), 1);
  const dps = estimateRaidDps(ctx);
  // Limit aggregate objective DPS below the expected class output, allowing real margin for missed clicks.
  const objectiveBudgetRatio = clamp(dps * duration * [0.30, 0.38, 0.46, 0.55][level] / ctx.maxHp, .0001, .18);
  const fail = round([.04, .065, .09, .12][level] * range(rng, .85, 1.15));
  const ratio = (factor = 1) => round(clamp(objectiveBudgetRatio * factor, .0001, .16), 5);
  const groggy = { groggy_seconds: 4, groggy_multiplier: 1.2 };
  const failPenalty = { fail_damage_fixed: 0, fail_damage_percent: fail };
  let config: Record<string, unknown>;
  switch (type) {
    case 'ABSORB':
      config = { heal_ratio: round(range(rng, [.40, .60, .80, 1][level], [.60, .80, 1, 1.15][level])) }; break;
    case 'REFLECT':
      config = { reflect_ratio: round(range(rng, .12 + level * .055, .17 + level * .075)), boss_damage_multiplier: round(.9 - level * .12) }; break;
    case 'ULTIMATE':
      config = { objective_hp_ratio: ratio(), ...groggy, ...failPenalty }; break;
    case 'DOT':
      config = { tick_interval_seconds: 1.5, tick_fixed_damage: 0, tick_barrier_percent: round(.004 + level * .002 + range(rng, 0, .002)), interrupt_target: {
        key: 'DOT_CORE', label: '잠식핵', ...ANCHORS[1], hp_ratio: ratio(.65),
      } }; break;
    case 'SHIELD':
      config = { shield_hp_ratio: ratio(), boss_damage_while_shield: 0, ...groggy }; break;
    case 'MULTI_CORE': {
      const count = [2, 2, 3, 4][level] + (level === 1 && rng() > .55 ? 1 : 0);
      const places = shuffle(rng, ANCHORS).slice(0, count);
      config = {
        mode: level >= 2 && rng() > .4 ? 'RANDOM_ORDER' : 'FIXED_ORDER',
        cores: places.map((point, index) => ({ key: `CORE_${index + 1}`, label: `${index + 1}번 핵`, ...point, hp_ratio: ratio(.72 / count) })),
        reset_on_wrong: false, wrong_barrier_fixed: 0, wrong_barrier_percent: round(fail * .22),
        wrong_boss_heal_ratio: 0, wrong_time_penalty_seconds: 0,
      }; break;
    }
    case 'SPLIT_TARGET':
      config = {
        targets: [
          { key: 'LEFT', label: '좌측 공명핵', ...ANCHORS[0], hp_ratio: ratio(.40) },
          { key: 'RIGHT', label: '우측 공명핵', ...ANCHORS[2], hp_ratio: ratio(.40) },
        ],
        max_difference_percent: [38, 30, 24, 20][level], unbalanced_efficiency: [.70, .55, .45, .38][level],
        success_bonus_damage_ratio: .01, ...groggy,
      }; break;
    case 'REGEN':
      config = {
        tick_interval_seconds: 1.5, heal_per_tick_fixed: 0,
        heal_per_tick_percent: round(.003 + level * .002), core_hp_ratio: ratio(.85),
        core: { key: 'REGEN_CORE', label: '재생핵', ...ANCHORS[1], hp_ratio: ratio(.85) },
      }; break;
    case 'SEAL': {
      const count = level >= 2 ? 3 : 2;
      const places = shuffle(rng, ANCHORS).slice(0, count);
      config = {
        seals: places.map((point, index) => ({ key: `SEAL_${index + 1}`, label: `${index + 1}번 봉인석`, ...point, hp_ratio: ratio(.72 / count) })),
        damage_reduction: round(.45 + level * .10), ...groggy,
      }; break;
    }
    case 'DAMAGE_CHECK':
      config = { target_damage_ratio: ratio(), ...groggy, ...failPenalty }; break;
  }
  return {
    client_key: `generated-${Math.floor(rng() * 1e9)}-${type}`,
    seq: 10, name: LABELS[type], pattern_type: type,
    trigger_kind: 'TIME_SECONDS', trigger_value: 30,
    duration_seconds: duration, config, is_enabled: true,
  };
}

function pickTypes(count: number, difficulty: PatternDifficulty, rng: () => number): SpecialPatternType[] {
  const pool = [...TYPES];
  const output: SpecialPatternType[] = [];
  while (output.length < count) {
    const weights = pool.map(type => WEIGHTS[difficulty][TYPES.indexOf(type)] * (
      output[output.length - 1] === 'ABSORB' && type === 'REFLECT' || output[output.length - 1] === 'REFLECT' && type === 'ABSORB' ? .15 : 1
    ));
    const type = choice(rng, pool, weights);
    output.push(type);
    pool.splice(pool.indexOf(type), 1); // 1..8 of 10; no duplicates/ultimate <=1
  }
  return output;
}

/** New drafts may have no saved V1.5 patterns yet. The DB seed RPC would create
 * default common mechanics, but its subsequent replacement deletes them; include
 * them in the same atomic pattern set instead of accidentally saving specials only.
 */
export function ensureRaidCommonPatterns(existing: RaidV15Pattern[]): RaidV15Pattern[] {
  if (existing.some(p => COMMON.has(p.pattern_type))) return existing;
  const base = (seq: number, name: string, type: RaidV15PatternType, time: number, duration: number, config: Record<string, unknown>): RaidV15Pattern => ({
    client_key: `generator-common-${seq}`, seq, name, pattern_type: type,
    trigger_kind: 'TIME_SECONDS', trigger_value: time,
    duration_seconds: duration, config, is_enabled: true,
  });
  const weak = { x: .42, y: .30, width: .16, height: .22, multiplier: 2, body_multiplier: 1 };
  const breakCfg = (hp: number) => ({ objective_hp_ratio: hp, groggy_seconds: 7, groggy_multiplier: 1.4, fail_damage_fixed: 0, fail_damage_percent: .1 });
  const common = [
    base(10, '약점 노출', 'WEAK_POINT', 25, 7, weak),
    base(20, '브레이크 미션', 'BREAK', 50, 10, breakCfg(.04)),
    base(30, '약점 재노출', 'WEAK_POINT', 100, 7, weak),
    base(40, '두 번째 브레이크', 'BREAK', 125, 9, breakCfg(.05)),
    base(50, '광폭화', 'ENRAGE', 150, 2, { boss_damage_multiplier: 1.25, player_damage_multiplier: 1 }),
  ];
  return [...existing, ...common];
}

function lockedIntervals(common: RaidV15Pattern[]): Array<[number, number]> {
  return common.filter(p => p.is_enabled && p.trigger_kind === 'TIME_SECONDS')
    .map(p => [Number(p.trigger_value), Number(p.trigger_value) + Number(p.duration_seconds)] as [number, number])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
}

function schedule(patterns: RaidV15Pattern[], duration: number, common: RaidV15Pattern[], difficulty: PatternDifficulty, rng: () => number): RaidV15Pattern[] {
  const cushion = [15, 12, 10, 8][STRENGTH[difficulty]];
  const base = Math.max(28, Math.min(38, duration * .09));
  const occupied = lockedIntervals(common);
  const ordered: RaidV15Pattern[] = [];
  let previousEnd = base - cushion;
  // Spread events across the planned battle time, then move forward to avoid all time-based common patterns.
  for (let i = 0; i < patterns.length; i++) {
    const desired = base + (duration - base - 24) * (i + .5) / patterns.length + range(rng, -4, 4);
    let start = Math.max(Math.ceil(desired), Math.ceil(previousEnd + cushion));
    let safe = false;
    for (let attempts = 0; attempts < 20 && !safe; attempts++) {
      const collision = occupied.find(([from, to]) => start < to + cushion && start + patterns[i].duration_seconds + cushion > from);
      if (collision) start = Math.ceil(collision[1] + cushion);
      else safe = true;
    }
    if (!safe) throw new Error('기존 공통 패턴과 충돌하지 않는 발동시간을 찾지 못했습니다.');
    occupied.push([start, start + patterns[i].duration_seconds]);
    ordered.push({ ...patterns[i], trigger_value: start });
    previousEnd = start + patterns[i].duration_seconds;
  }
  return ordered;
}

/** Deterministic for a given seed. Existing common mechanics are never regenerated or changed. */
export function generateRaidPatternSet(
  ctx: RaidGeneratorContext,
  count: number,
  difficulty: PatternDifficulty,
  seed: number = Math.floor(Math.random() * 0xffffffff),
): GeneratedRaidPatternSet {
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('특수 패턴 수는 1~8개여야 합니다.');
  if (!(difficulty in STRENGTH)) throw new Error('지원하지 않는 난이도입니다.');
  if (!Number.isFinite(ctx.maxHp) || ctx.maxHp <= 0 || !Number.isFinite(ctx.damageCoefficient) || ctx.damageCoefficient <= 0) {
    throw new Error('보스 HP 또는 공격 계수가 올바르지 않습니다.');
  }
  const common = ensureRaidCommonPatterns(ctx.existingPatterns).filter(p => !isSpecial(p));
  const rng = seededRandom(seed);
  const baseBattleSeconds = estimateRaidBaseSeconds(ctx);
  const patterns = pickTypes(count, difficulty, rng).map(type => createPattern(type, difficulty, ctx, rng));
  // Expected delay includes diverting attacks to objectives and pauses during counterattack patterns.
  const delay = patterns.reduce((sum, p) => sum + (['ABSORB','REFLECT'].includes(p.pattern_type) ? p.duration_seconds : p.duration_seconds * .55), 0);
  const minimumLength = 35 + patterns.reduce((a,p)=>a + p.duration_seconds + [15,12,10,8][STRENGTH[difficulty]],0) + common
    .filter(p=>p.is_enabled && p.trigger_kind==='TIME_SECONDS')
    .reduce((a,p)=>a+Number(p.duration_seconds),0);
  // Never invent extra boss lifetime merely to fit more events: low HP/huge raid power
  // means some patterns would never occur. Prompt the operator to lower count or raise HP.
  if (minimumLength > baseBattleSeconds * 1.3 + delay) {
    throw new Error('현재 보스 HP·학급 화력으로는 선택한 수의 패턴을 모두 진행하기 어렵습니다. 패턴 수를 줄이거나 보스 최대 HP를 높여주세요.');
  }
  let horizon = Math.max(baseBattleSeconds + delay, minimumLength);
  let arranged: RaidV15Pattern[] | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try { arranged = schedule(patterns, horizon, common, difficulty, rng); break; }
    catch { horizon += 35; }
  }
  if (!arranged) throw new Error('패턴 발동 시점을 배치하지 못했습니다.');
  const expectedBattleSeconds = Math.ceil(Math.max(horizon, arranged[arranged.length - 1].trigger_value + arranged[arranged.length - 1].duration_seconds + 18));
  const problems = validateGeneratedRaidPatterns(arranged, common, difficulty);
  if (problems.length) throw new Error(problems.join(' '));
  return { seed, difficulty, baseBattleSeconds, expectedBattleSeconds, patterns: arranged };
}

export function validateGeneratedRaidPatterns(
  specials: RaidV15Pattern[],
  common: RaidV15Pattern[],
  difficulty: PatternDifficulty,
): string[] {
  const result: string[] = [];
  const types = specials.map(p=>p.pattern_type);
  if (new Set(types).size !== types.length) result.push('특수 패턴 중복');
  if (types.filter(t=>t==='ULTIMATE' || t==='BOSS_STRIKE').length > 1) result.push('필살기 중복');
  const gap = [15,12,10,8][STRENGTH[difficulty]];
  const items = [...specials, ...common].filter(p=>p.is_enabled && p.trigger_kind==='TIME_SECONDS')
    .map(p=>({start:Number(p.trigger_value),end:Number(p.trigger_value)+Number(p.duration_seconds)}))
    .sort((a,b)=>a.start-b.start);
  for (let i=1; i<items.length; i++) {
    if (items[i].start < items[i-1].end + gap - .01) result.push('시간 간격 충돌');
  }
  if (specials.some(p=>!Number.isFinite(p.duration_seconds) || p.duration_seconds < .5 || p.duration_seconds > 120)) result.push('패턴 지속시간 오류');
  if (specials.some(p=>p.trigger_value < 25)) result.push('초반 보호시간 미확보');
  return [...new Set(result)];
}

/** Preserve existing common Seq values because AFTER_PATTERN triggers may refer to them.
 * Assign unique Seq values to generated specials; execution itself is governed by triggers.
 */
export function mergeGeneratedRaidPatterns(existing: RaidV15Pattern[], specials: RaidV15Pattern[]): RaidV15Pattern[] {
  const common = ensureRaidCommonPatterns(existing).filter(p => !isSpecial(p));
  const oldSpecialSeqs = new Set(existing.filter(isSpecial).map(p => p.seq));
  if (common.some(p => p.trigger_kind === 'AFTER_PATTERN' && oldSpecialSeqs.has(p.trigger_value))) {
    throw new Error('공통 패턴에 교체할 특수패턴을 참조하는 AFTER_PATTERN 설정이 있습니다. 선행 패턴 참조를 먼저 수정해주세요.');
  }
  const used = new Set(common.map(p => p.seq));
  const newlyAssigned = specials.map((pattern, index) => {
    let seq = 200 + index * 10;
    while (used.has(seq) && seq < 999) seq++;
    if (seq >= 999) throw new Error('사용 가능한 패턴 순서(Seq)가 부족합니다.');
    used.add(seq);
    const { id: _id, client_key: _key, ...withoutDatabaseId } = pattern;
    return { ...withoutDatabaseId, seq, config: structuredClone(pattern.config) };
  });
  return [...common.map(({ id: _id, client_key: _key, ...p }) => ({ ...p, config: structuredClone(p.config) })), ...newlyAssigned];
}

export function describeGeneratedPattern(pattern: RaidV15Pattern): string {
  const c=pattern.config;
  const n=(key:string)=>Number(c[key] ?? 0);
  const compact=(number:number)=>Math.round(number).toLocaleString('ko-KR');
  switch(pattern.pattern_type){
    case 'ABSORB': return `${Math.round(n('heal_ratio')*100)}% 회복 · ${pattern.duration_seconds}초`;
    case 'REFLECT': return `${Math.round(n('reflect_ratio')*100)}% 반사 · ${pattern.duration_seconds}초`;
    case 'SHIELD': return `보호막 ${(n('shield_hp_ratio')*100).toFixed(2)}% · ${pattern.duration_seconds}초`;
    case 'MULTI_CORE': return `${Array.isArray(c.cores)?c.cores.length:0} CORE · ${c.mode==='RANDOM_ORDER'?'무작위':'순서'} · ${pattern.duration_seconds}초`;
    case 'SPLIT_TARGET': return `허용 편차 ${compact(n('max_difference_percent'))}% · ${pattern.duration_seconds}초`;
    case 'SEAL': return `봉인석 ${Array.isArray(c.seals)?c.seals.length:0}개 · ${pattern.duration_seconds}초`;
    case 'ULTIMATE': case 'BOSS_STRIKE': case 'DAMAGE_CHECK': return `요구 화력 ${(n(pattern.pattern_type==='DAMAGE_CHECK'?'target_damage_ratio':'objective_hp_ratio')*100).toFixed(2)}% · ${pattern.duration_seconds}초`;
    case 'DOT': return `지속 피해 · ${pattern.duration_seconds}초`;
    case 'REGEN': return `재생핵 · ${pattern.duration_seconds}초`;
    default: return `${pattern.duration_seconds}초`;
  }
}

/** Reroll exactly one slot: its start time and duration remain fixed, preserving neighbouring events. */
export function rerollRaidPatternSlot(
  ctx: RaidGeneratorContext,
  set: GeneratedRaidPatternSet,
  index: number,
  seed: number = Math.floor(Math.random() * 0xffffffff),
): GeneratedRaidPatternSet {
  if (!Number.isInteger(index) || index < 0 || index >= set.patterns.length) throw new Error('패턴 위치가 올바르지 않습니다.');
  const rng = seededRandom(seed);
  const excluded = new Set(set.patterns.filter((_, i) => i !== index).map(p => p.pattern_type));
  const pool = TYPES.filter(type => !excluded.has(type));
  if (!pool.length) throw new Error('재생성 가능한 패턴이 없습니다.');
  const type = choice(rng, pool, pool.map(t => WEIGHTS[set.difficulty][TYPES.indexOf(t)]));
  const previous = set.patterns[index];
  const next = createPattern(type, set.difficulty, ctx, rng, previous.duration_seconds);
  next.trigger_value = previous.trigger_value;
  next.client_key = `reroll-${seed}-${index}`;
  const patterns = set.patterns.map((p,i)=>i===index?next:p);
  const errors = validateGeneratedRaidPatterns(patterns,ensureRaidCommonPatterns(ctx.existingPatterns).filter(p=>!isSpecial(p)),set.difficulty);
  if (errors.length) throw new Error(errors.join(' '));
  return { ...set, patterns, rerolls: [...(set.rerolls ?? []), { index, seed }] };
}
