// RAID_CLASH_V1_20261028 — 교사용 「격돌 리허설」
// 실제 학생 화면(RaidClashOverlay)과 중계 화면(RaidClashBroadcastOverlay)을 그대로 쓰고,
// 서버 대신 이 브라우저 안의 가상 서버(아래 SimModel)가 모집 → 추첨 → 판정 → 결과를 진행한다.
// 실제 레이드·공명방벽·보상·DB에는 아무것도 기록하지 않는다.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type {
  RaidClashActionResult,
  RaidClashDifficulty,
  RaidClashEffects,
  RaidClashJudgment,
  RaidClashKeyCode,
  RaidClashOutcome,
  RaidClashPhase,
  RaidClashPlayer,
  RaidClashProfile,
  RaidClashPublicState,
  RaidClashSelected,
} from '@/lib/rpc/raid_student_rpc';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import { cn } from '@/lib/utils/cn';
import RaidClashOverlay, { ClashBuffOverlay, type RaidClashActions } from '@/features/raid/clash/RaidClashOverlay';
import {
  CLASH_DIFFICULTY_LABEL,
  CLASH_KEYS,
  CLASH_TEAM_SIZE,
  clashIdealOffsetMs,
  clashNowMs,
  clashPoints,
  clashTeamOutcome,
  judgeClash,
  localClashProfile,
} from '@/features/raid/clash/clashCore';
import RaidClashBroadcastOverlay, { useClashBroadcastCues, type ClashCuePlayer } from './RaidClashBroadcastOverlay';
import { RaidBroadcastAudioEngine } from './RaidBroadcastAudio';

const SIM_EFFECTS: RaidClashEffects = {
  GREAT_SUCCESS: { buff_seconds: 10, block_seconds: 16, clash_component: 3 },
  SUCCESS: { buff_seconds: 10, block_seconds: 10, clash_component: 1.5 },
  FAILED: { barrier_penalty_ratio_of_current: 0.2 },
};
const BOT_NAMES = ['가상학생 하늘', '가상학생 도윤', '가상학생 서연', '가상학생 지호', '가상학생 예린', '가상학생 민준', '가상학생 하은', '가상학생 시우', '가상학생 서아', '가상학생 준서'];
const ME_NAME = '선생님(나)';
const SIM_BARRIER = 100_000;
const SIM_LATENCY_MS = 60;
/** 결과 배너(5.5초) + 버프(최대 16초)가 끝날 때까지 화면을 계속 갱신한다. */
const KEEP_RENDERING_AFTER_RESOLVE_MS = 18_000;

type View = 'STUDENT' | 'BROADCAST' | 'BOTH';
type BotPlan = 'RANDOM' | 'GREAT' | 'SUCCESS' | 'FAIL';
type Who = 'me' | number; // number = 가상 학생 번호
type SimInput = { judgment: RaidClashJudgment; points: number };

// RAID_CLASH_V2_20261029: 대표 최대 3명. 슬롯(0~2)마다 준비 여부·판정·가상 오차를 따로 둔다.
interface SimModel {
  id: number;
  version: number;
  phase: RaidClashPhase;
  profile: RaidClashProfile;
  plan: BotPlan;
  noteKeys: RaidClashKeyCode[];
  triggeredAt: number;
  volunteerClosesAt: number;
  acceptUntil: number;
  volunteers: Who[];
  botJoinAt: number[];
  forceMe: boolean;
  /** 슬롯 순서대로 뽑힌 대표 */
  selected: Who[];
  ready: boolean[];
  selectedAt: number | null;
  readyDeadlineAt: number | null;
  playStartsAt: number | null;
  playDeadlineAt: number | null;
  inputs: Array<Partial<Record<number, SimInput>>>;
  botOffsets: Array<Array<number | null>>;
  outcome: RaidClashOutcome | null;
  outcomeReason: string | null;
  resolvedAt: number | null;
  buffUntil: number | null;
  blockUntil: number | null;
  component: number;
  penalty: number | null;
  barrierBefore: number;
  barrierAfter: number;
}

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function randomOffset(min: number, max: number) {
  const magnitude = min + Math.random() * Math.max(0, max - min);
  return Math.round(Math.random() < 0.5 ? -magnitude : magnitude);
}

/** 가상 대표가 낼 오차(ms). null = 누르지 않음(MISS) */
function makeBotOffsets(plan: BotPlan, p: RaidClashProfile): Array<number | null> {
  const pick = (grade: 'P' | 'G' | 'B' | 'M') => {
    if (grade === 'P') return randomOffset(0, p.perfect_ms * 0.8);
    if (grade === 'G') return randomOffset(p.perfect_ms + 5, p.good_ms * 0.95);
    if (grade === 'B') return randomOffset(p.good_ms + 5, p.bad_ms * 0.95);
    return null;
  };
  let grades: Array<'P' | 'G' | 'B' | 'M'>;
  if (plan === 'GREAT') grades = ['P', 'P', 'P', 'G', 'P', 'P', 'P', 'P']; // 15점
  else if (plan === 'SUCCESS') grades = ['P', 'G', 'P', 'B', 'G', 'P', 'M', 'G']; // 9점
  else if (plan === 'FAIL') grades = ['G', 'B', 'M', 'P', 'B', 'M', 'G', 'B']; // 4점
  else {
    grades = Array.from({ length: 8 }, () => {
      const r = Math.random();
      return r < 0.35 ? 'P' : r < 0.65 ? 'G' : r < 0.85 ? 'B' : 'M';
    });
  }
  return grades.map(pick);
}

function createModel(difficulty: RaidClashDifficulty, botCount: number, plan: BotPlan, forceMe: boolean): SimModel {
  const profile = localClashProfile(difficulty);
  const now = clashNowMs();
  const closes = now + profile.volunteer_ms;
  return {
    id: Date.now(),
    version: 1,
    phase: 'VOLUNTEERING',
    profile,
    plan,
    noteKeys: Array.from({ length: 8 }, () => CLASH_KEYS[Math.floor(Math.random() * CLASH_KEYS.length)]),
    triggeredAt: now,
    volunteerClosesAt: closes,
    acceptUntil: closes + profile.volunteer_grace_ms,
    volunteers: [],
    // 가상 학생들은 버튼이 풀린 뒤(1초) 모집이 끝나기 전 아무 때나 지원한다.
    botJoinAt: Array.from({ length: botCount }, () => now + profile.volunteer_button_delay_ms + 150 + Math.random() * (profile.volunteer_ms - profile.volunteer_button_delay_ms - 400)),
    forceMe,
    selected: [],
    ready: [],
    selectedAt: null,
    readyDeadlineAt: null,
    playStartsAt: null,
    playDeadlineAt: null,
    inputs: [],
    botOffsets: [],
    outcome: null,
    outcomeReason: null,
    resolvedAt: null,
    buffUntil: null,
    blockUntil: null,
    component: 0,
    penalty: null,
    barrierBefore: SIM_BARRIER,
    barrierAfter: SIM_BARRIER,
  };
}

// ── 가상 서버: 실제 서버(raid_clash_advance / resolve / start_play / finish_play / submit)와 같은 순서로 진행 ──
function resolve(m: SimModel, now: number, outcome: RaidClashOutcome, reason: string) {
  m.phase = 'RESOLVED';
  m.outcome = outcome;
  m.outcomeReason = reason;
  m.resolvedAt = now;
  if (outcome === 'FAILED') {
    m.penalty = Math.round(m.barrierBefore * SIM_EFFECTS.FAILED.barrier_penalty_ratio_of_current);
    m.barrierAfter = m.barrierBefore - m.penalty;
  } else {
    const effect = SIM_EFFECTS[outcome];
    m.component = effect.clash_component;
    m.buffUntil = now + effect.buff_seconds * 1000;
    m.blockUntil = now + effect.block_seconds * 1000;
    m.penalty = 0;
  }
  m.version += 1;
}

function simScore(m: SimModel, slot?: number) {
  const slots = slot == null ? m.inputs : [m.inputs[slot] ?? {}];
  return slots.reduce((total, map) => total + Object.values(map).reduce((sum, item) => sum + (item?.points ?? 0), 0), 0);
}

function simInputCount(m: SimModel) {
  return m.inputs.reduce((total, map) => total + Object.keys(map).length, 0);
}

/** 서버와 같은 팀 기준: 1인 기준(성공 8·대성공 13) × 뽑힌 인원 */
function simRule(m: SimModel) {
  const count = Math.max(1, m.selected.length || CLASH_TEAM_SIZE);
  return { count, success: m.profile.success_score * count, great: m.profile.great_score * count, max: 16 * count };
}

function startPlay(m: SimModel, now: number) {
  if (m.phase !== 'SELECTED' || m.selectedAt == null) return;
  const start = Math.max(now, m.selectedAt + m.profile.reveal_ms);
  m.phase = 'PLAYING';
  m.playStartsAt = start;
  m.playDeadlineAt = start + clashIdealOffsetMs(m.profile, 7) + m.profile.bad_ms + m.profile.latency_slack_ms;
  // 준비 시간 안에 준비 완료를 못 보낸 대표는 8개 모두 MISS(서버 NOT_READY와 같음)
  m.selected.forEach((_, slot) => {
    if (m.ready[slot]) return;
    for (let index = 0; index < 8; index += 1) m.inputs[slot][index] ??= { judgment: 'MISS', points: 0 };
  });
  m.version += 1;
}

function finishPlay(m: SimModel, now: number, reason: string) {
  if (m.phase !== 'PLAYING') return;
  m.selected.forEach((_, slot) => {
    for (let index = 0; index < 8; index += 1) m.inputs[slot][index] ??= { judgment: 'MISS', points: 0 };
  });
  resolve(m, now, clashTeamOutcome(simScore(m), simRule(m)), reason);
}

function record(m: SimModel, slot: number, index: number, judgment: RaidClashJudgment) {
  if (!m.inputs[slot] || m.inputs[slot][index]) return;
  m.inputs[slot][index] = { judgment, points: clashPoints(judgment) };
  m.version += 1;
}

function advance(m: SimModel, now: number) {
  if (m.phase === 'VOLUNTEERING') {
    m.botJoinAt.forEach((at, index) => {
      if (at <= now && at <= m.volunteerClosesAt && !m.volunteers.includes(index)) {
        m.volunteers.push(index);
        m.version += 1;
      }
    });
    if (now >= m.acceptUntil) {
      // 지원자 중 최대 3명을 무작위로 뽑는다. 「내가 지원하면 반드시 대표로」가 켜져 있으면 나를 먼저 넣는다.
      const pool = [...m.volunteers].sort(() => Math.random() - 0.5);
      const picks: Who[] = m.forceMe && pool.includes('me') ? ['me', ...pool.filter((who) => who !== 'me')] : pool;
      const selected = picks.slice(0, CLASH_TEAM_SIZE);
      if (selected.length === 0) {
        resolve(m, now, 'FAILED', 'NO_VOLUNTEER');
        return;
      }
      m.phase = 'SELECTED';
      m.selected = selected;
      m.ready = selected.map(() => false);
      m.inputs = selected.map(() => ({}));
      m.botOffsets = selected.map((who) => (who === 'me' ? [] : makeBotOffsets(m.plan, m.profile)));
      m.selectedAt = now;
      m.readyDeadlineAt = now + m.profile.reveal_ms + m.profile.ready_timeout_ms;
      m.version += 1;
    }
  }
  if (m.phase === 'SELECTED' && m.selectedAt != null) {
    // 가상 대표는 화면을 받자마자 준비 완료를 보낸다. 내가 대표면 오버레이가 actions.ready()를 부른다.
    if (now >= m.selectedAt + 400) {
      m.selected.forEach((who, slot) => {
        if (who !== 'me' && !m.ready[slot]) {
          m.ready[slot] = true;
          m.version += 1;
        }
      });
    }
    if (m.ready.every(Boolean)) startPlay(m, now);
    else if (m.readyDeadlineAt != null && now >= m.readyDeadlineAt) startPlay(m, now);
  }
  if (m.phase === 'PLAYING' && m.playStartsAt != null) {
    m.selected.forEach((who, slot) => {
      if (who === 'me') return;
      for (let index = 0; index < 8; index += 1) {
        if (m.inputs[slot][index]) continue;
        const ideal = (m.playStartsAt as number) + clashIdealOffsetMs(m.profile, index);
        const offset = m.botOffsets[slot]?.[index] ?? null;
        if (offset != null && now >= ideal + offset) record(m, slot, index, judgeClash(offset, m.profile));
        else if (offset == null && now >= ideal + m.profile.bad_ms + 50) record(m, slot, index, 'MISS');
      }
    });
    if (simInputCount(m) >= 8 * m.selected.length) finishPlay(m, now, 'SCORED');
    else if (m.playDeadlineAt != null && now >= m.playDeadlineAt) finishPlay(m, now, 'TIMEOUT');
  }
}

function selectedInfo(who: Who | null | undefined): RaidClashSelected | null {
  if (who == null) return null;
  return {
    participant_id: who === 'me' ? 0 : who + 1,
    student_name: who === 'me' ? ME_NAME : BOT_NAMES[who % BOT_NAMES.length],
    guild_name: '리허설 길드',
    guild_logo_url: null,
    character_name: null,
    character_image_url: null,
  };
}

/** 가상 서버 상태 → 실제 서버 raid_clash_public_state 와 같은 모양. asStudent=false 면 중계 화면용(나 = 관전자). */
function toPublicState(m: SimModel | null, asStudent: boolean): RaidClashPublicState | null {
  if (!m) return null;
  const now = clashNowMs();
  const p = m.profile;
  const rule = simRule(m);
  const mySlotIndex = asStudent ? m.selected.indexOf('me') : -1;
  const mySlot = mySlotIndex >= 0 ? mySlotIndex : null;
  const players: RaidClashPlayer[] = m.selected.map((who, slot) => ({
    ...(selectedInfo(who) as RaidClashSelected),
    slot,
    ready: Boolean(m.ready[slot]),
    judged: Object.keys(m.inputs[slot] ?? {}).length,
    score: simScore(m, slot),
  }));
  return {
    enabled: true,
    difficulty: p.difficulty,
    server_now: new Date(now).toISOString(),
    session: {
      id: m.id,
      version: m.version,
      phase: m.phase,
      frozen: m.phase === 'VOLUNTEERING' || m.phase === 'SELECTED' || m.phase === 'PLAYING',
      triggered_at: iso(m.triggeredAt) as string,
      volunteer_closes_at: iso(m.volunteerClosesAt) as string,
      volunteer_accept_until: iso(m.acceptUntil) as string,
      volunteer_count: m.volunteers.length,
      i_volunteered: asStudent && m.volunteers.includes('me'),
      i_am_selected: mySlot != null,
      my_slot: mySlot,
      planned_player_count: CLASH_TEAM_SIZE,
      player_count: rule.count,
      players,
      score_success: rule.success,
      score_great: rule.great,
      score_max: rule.max,
      selected: selectedInfo(m.selected[0]),
      selected_at: iso(m.selectedAt),
      ready_deadline_at: iso(m.readyDeadlineAt),
      play_starts_at: iso(m.playStartsAt),
      play_deadline_at: iso(m.playDeadlineAt),
      profile: p,
      effects: SIM_EFFECTS,
      notes: m.playStartsAt == null
        ? null
        : m.noteKeys.map((key, index) => ({ index, key, ideal_at: iso((m.playStartsAt as number) + clashIdealOffsetMs(p, index)) as string })),
      inputs: m.inputs.flatMap((map, slot) => Object.entries(map)
        .filter((entry): entry is [string, SimInput] => Boolean(entry[1]))
        .map(([index, item]) => ({ slot, index: Number(index), judgment: item.judgment, points: item.points }))
        .sort((a, b) => a.index - b.index)),
      score: simScore(m),
      outcome: m.outcome,
      outcome_reason: m.outcomeReason,
      resolved_at: iso(m.resolvedAt),
      frozen_seconds: m.resolvedAt == null ? null : Math.round(m.resolvedAt - m.triggeredAt) / 1000,
      buff_until: iso(m.buffUntil),
      buff_active: m.phase === 'RESOLVED' && m.buffUntil != null && m.buffUntil > now && m.component > 0,
      boss_attack_block_until: iso(m.blockUntil),
      clash_component: m.component,
      weak_zone: p.weak_zone,
      barrier_penalty_amount: m.penalty,
    },
  };
}

export default function RaidClashRehearsal({ raidId, defaultDifficulty }: { raidId: number; defaultDifficulty: RaidClashDifficulty }) {
  const [difficulty, setDifficulty] = useState<RaidClashDifficulty>(defaultDifficulty);
  const [view, setView] = useState<View>('STUDENT');
  const [botCount, setBotCount] = useState(5);
  const [botPlan, setBotPlan] = useState<BotPlan>('RANDOM');
  const [forceMe, setForceMe] = useState(true);
  const [audioOn, setAudioOn] = useState(false);
  const [, setTick] = useState(0);
  const modelRef = useRef<SimModel | null>(null);
  const audioRef = useRef<RaidBroadcastAudioEngine | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setDifficulty(defaultDifficulty), [defaultDifficulty]);

  const rerender = useCallback(() => setTick((value) => value + 1), []);

  // 진행 중에는 0.1초마다 가상 서버를 한 걸음씩 진행하고 화면을 다시 그린다(실제 전투 화면의 100ms 갱신과 같음).
  const model = modelRef.current;
  const running = model !== null && (model.phase !== 'RESOLVED' || clashNowMs() - (model.resolvedAt ?? 0) < KEEP_RENDERING_AFTER_RESOLVE_MS);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const current = modelRef.current;
      if (current) advance(current, clashNowMs());
      rerender();
    }, 100);
    return () => window.clearInterval(timer);
  }, [running, rerender]);

  useEffect(() => () => audioRef.current?.dispose(), []);

  const actions = useMemo<RaidClashActions>(() => {
    const reply = (data: Omit<RaidClashActionResult, 'clash'>): RpcResult<RaidClashActionResult> => ({
      success: true,
      data: { ...data, clash: toPublicState(modelRef.current, true) as RaidClashPublicState },
    });
    return {
      volunteer: async () => {
        await wait(SIM_LATENCY_MS);
        const m = modelRef.current;
        const now = clashNowMs();
        if (m) advance(m, now);
        if (!m || m.phase !== 'VOLUNTEERING') return reply({ accepted: false, reason: 'NOT_VOLUNTEERING' });
        if (now > m.acceptUntil) return reply({ accepted: false, reason: 'CLOSED' });
        if (!m.volunteers.includes('me')) {
          m.volunteers.push('me');
          m.version += 1;
        }
        return reply({ accepted: true, reason: null });
      },
      ready: async () => {
        await wait(SIM_LATENCY_MS);
        const m = modelRef.current;
        if (m) advance(m, clashNowMs());
        const slot = m ? m.selected.indexOf('me') : -1;
        if (!m || slot < 0) return reply({ accepted: false, reason: 'NOT_SELECTED' });
        if (m.phase === 'SELECTED') {
          m.ready[slot] = true;
          m.version += 1;
          if (m.ready.every(Boolean)) startPlay(m, clashNowMs());
        } else if (m.phase === 'PLAYING') {
          if (!m.ready[slot]) return reply({ accepted: false, reason: 'TOO_LATE' });
        } else return reply({ accepted: false, reason: 'NOT_READY_PHASE' });
        return reply({ accepted: true, reason: null });
      },
      submit: async (noteIndex, keyCode, offsetMs) => {
        await wait(SIM_LATENCY_MS);
        const m = modelRef.current;
        const now = clashNowMs();
        const slot = m ? m.selected.indexOf('me') : -1;
        if (!m || slot < 0) return reply({ accepted: false, reason: 'NOT_SELECTED' });
        const existing = m.inputs[slot]?.[noteIndex];
        if (existing) return reply({ accepted: true, duplicate: true, note_index: noteIndex, judgment: existing.judgment, points: existing.points });
        if (m.phase !== 'PLAYING' || m.playStartsAt == null || (m.playDeadlineAt != null && now > m.playDeadlineAt)) {
          advance(m, now);
          return reply({ accepted: false, reason: 'NOT_PLAYING' });
        }
        // 실제 서버와 같은 최소 검증: 키가 맞는지, 보낸 오차가 서버가 받은 시각과 너무 다르지 않은지
        const delta = Math.round(now - (m.playStartsAt + clashIdealOffsetMs(m.profile, noteIndex)));
        let judgment: RaidClashJudgment;
        let flag: string | null = null;
        if (keyCode == null || offsetMs == null) judgment = 'MISS';
        else if (keyCode !== m.noteKeys[noteIndex]) { judgment = 'MISS'; flag = 'WRONG_KEY'; }
        else if (delta - offsetMs < -m.profile.early_slack_ms || delta - offsetMs > m.profile.latency_slack_ms) { judgment = 'MISS'; flag = 'IMPLAUSIBLE_TIMING'; }
        else judgment = judgeClash(offsetMs, m.profile);
        record(m, slot, noteIndex, judgment);
        if (simInputCount(m) >= 8 * m.selected.length) finishPlay(m, now, 'SCORED');
        return reply({ accepted: true, duplicate: false, note_index: noteIndex, judgment, points: clashPoints(judgment), flag });
      },
    };
  }, []);

  const start = async () => {
    // 효과음은 「시작」 클릭 순간에만 켤 수 있다(브라우저 자동재생 정책).
    if (audioOn && !audioRef.current?.isUnlocked()) {
      const engine = audioRef.current ?? new RaidBroadcastAudioEngine();
      audioRef.current = engine;
      try {
        await engine.unlock();
        engine.setMuted(false);
      } catch {
        // 소리가 안 나도 리허설은 계속한다.
      }
    }
    modelRef.current = createModel(difficulty, botCount, botPlan, forceMe);
    rerender();
  };

  const stop = () => {
    modelRef.current = null;
    rerender();
  };

  const forceFinish = () => {
    const m = modelRef.current;
    if (!m) return;
    const now = clashNowMs();
    if (m.phase === 'PLAYING') finishPlay(m, now, 'FORCED');
    else if (m.phase === 'VOLUNTEERING' || m.phase === 'SELECTED') resolve(m, now, 'FAILED', 'FORCED');
    rerender();
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      // 전체 화면이 막힌 브라우저에서도 리허설은 계속한다.
    }
  };

  const studentClash = toPublicState(model, true);
  const broadcastClash = toPublicState(model, false);
  const playCue = useCallback<ClashCuePlayer>((cue, judgmentKey) => audioRef.current?.playClashCue(cue, judgmentKey), []);
  useClashBroadcastCues(broadcastClash, audioOn && view !== 'STUDENT' ? playCue : null);

  const names = useMemo(() => [ME_NAME, ...BOT_NAMES.slice(0, Math.max(botCount, 3))], [botCount]);
  const phaseLabel = !model
    ? '대기'
    : model.phase === 'VOLUNTEERING' ? '지원자 모집'
      : model.phase === 'SELECTED' ? '대표 공개'
        : model.phase === 'PLAYING' ? (model.selected.includes('me') ? `나 포함 대표 ${model.selected.length}명 도전 중` : `가상 대표 ${model.selected.length}명 도전 중`)
          : model.phase === 'RESOLVED' ? '결과' : '취소';

  return (
    <div className="rounded-card-lg border border-emerald-300/30 bg-emerald-950/25 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-black text-emerald-100">🎬 격돌 리허설 (전체 흐름 · 실전 영향 없음)</div>
          <p className="mt-1 text-sm font-bold leading-6 text-white">
            학생 화면·중계 화면을 실제와 똑같이 띄우고, 모집 → 추첨 → 고리 8개 → 결과 → 약점 노출까지 이 화면 안에서 진행합니다.
            가상 학생들이 함께 지원합니다. 레이드·공명방벽·보상에는 아무것도 기록되지 않습니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void start()}
            className="rounded-card-md border border-emerald-200/60 bg-emerald-500/30 px-4 py-2 text-sm font-black text-white">
            {model ? '↻ 처음부터 다시' : '▶ 리허설 시작'}
          </button>
          {model && (
            <button type="button" onClick={stop} className="rounded-card-md border border-white/25 bg-black/30 px-3 py-2 text-sm font-black text-white">■ 그만하기</button>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 text-sm font-black text-white md:grid-cols-2 xl:grid-cols-4">
        <Field label="보는 화면">
          {([['STUDENT', '학생 화면'], ['BROADCAST', '중계 화면'], ['BOTH', '둘 다']] as Array<[View, string]>).map(([key, label]) => (
            <Chip key={key} active={view === key} onClick={() => setView(key)}>{label}</Chip>
          ))}
        </Field>
        <Field label="난이도">
          {(['EASY', 'NORMAL', 'HARD'] as RaidClashDifficulty[]).map((item) => (
            <Chip key={item} active={difficulty === item} onClick={() => setDifficulty(item)}>{CLASH_DIFFICULTY_LABEL[item]}</Chip>
          ))}
        </Field>
        <Field label="가상 지원자 수">
          {[0, 2, 5, 10].map((count) => (
            <Chip key={count} active={botCount === count} onClick={() => setBotCount(count)}>{count}명</Chip>
          ))}
        </Field>
        <Field label="가상 대표 실력(1명당)">
          {([['RANDOM', '무작위'], ['GREAT', '대성공'], ['SUCCESS', '성공'], ['FAIL', '실패']] as Array<[BotPlan, string]>).map(([key, label]) => (
            <Chip key={key} active={botPlan === key} onClick={() => setBotPlan(key)}>{label}</Chip>
          ))}
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-black text-white">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-emerald-400" checked={forceMe} onChange={(event) => setForceMe(event.target.checked)} />
          내가 지원하면 반드시 대표로 뽑기 <span className="text-xs text-emerald-100">(끄면 실제처럼 지원자 중 무작위)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-emerald-400" checked={audioOn} onChange={(event) => setAudioOn(event.target.checked)} />
          중계 효과음 <span className="text-xs text-emerald-100">(시작 버튼을 누를 때 켜집니다)</span>
        </label>
        <button type="button" onClick={() => void toggleFullscreen()} className="rounded-full border border-white/25 px-3 py-1 text-xs font-black text-white">⛶ 전체 화면</button>
      </div>
      <div className="mt-2 text-xs font-bold text-emerald-100">
        내가 직접 해 보려면 「학생 화면」에서 모집 1초 뒤 「⚔ 격돌 지원」을 누르고 키보드 Q·W·E·R를 사용하세요. 지원자 중 최대 {CLASH_TEAM_SIZE}명이 대표가 되어 같은 고리를 함께 치고, 점수를 합쳐 결과가 정해집니다(3명: 성공 24·대성공 39점).
        지원하지 않으면 가상 학생들이 대표가 되고, 아무도 지원하지 않으면 실패 페널티가 나옵니다.
      </div>

      <div ref={stageRef} className="mt-4 space-y-3 overflow-auto bg-slate-950">
        {(view === 'STUDENT' || view === 'BOTH') && (
          <RehearsalStage label="학생 화면" model={model} phaseLabel={phaseLabel}>
            <RaidClashOverlay
              raidId={raidId}
              clash={studentClash}
              serverOffsetMs={0}
              attackBlocked={false}
              onClashUpdate={rerender}
              actions={actions}
            />
            <RehearsalBuff clash={studentClash} />
          </RehearsalStage>
        )}
        {(view === 'BROADCAST' || view === 'BOTH') && (
          <RehearsalStage label="중계 화면" model={model} phaseLabel={phaseLabel}>
            <RaidClashBroadcastOverlay
              clash={broadcastClash}
              serverOffsetMs={0}
              names={names}
              forceFinishing={false}
              onForceFinish={forceFinish}
            />
          </RehearsalStage>
        )}
      </div>
    </div>
  );
}

/** 학생 화면은 결과 이후 버프 표시가 전투 화면 쪽에 있으므로 여기서 따로 그린다(중계 오버레이는 자체 포함). */
function RehearsalBuff({ clash }: { clash: RaidClashPublicState | null }) {
  const session = clash?.session ?? null;
  if (!session || session.phase !== 'RESOLVED') return null;
  return <ClashBuffOverlay session={session} serverNow={clashNowMs()} />;
}

function RehearsalStage({ label, model, phaseLabel, children }: { label: string; model: SimModel | null; phaseLabel: string; children: ReactNode }) {
  const barrierNow = model && model.phase === 'RESOLVED' ? model.barrierAfter : SIM_BARRIER;
  return (
    <div className="relative isolate aspect-video w-full overflow-hidden rounded-card-md border border-sky-300/25 bg-[radial-gradient(circle_at_50%_40%,#3b0d0d,#120617_55%,#020617)]">
      {/* 가상 전투 배경: 보스와 공명방벽 */}
      <div className="pointer-events-none absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 select-none text-[clamp(5rem,16vw,12rem)] leading-none drop-shadow-[0_0_40px_rgba(239,68,68,0.45)]">👹</div>
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-[30]">
        <div className="mb-1 flex justify-between text-[11px] font-black text-sky-100">
          <span>가상 공명방벽</span>
          <span className="font-mono">{barrierNow.toLocaleString('ko-KR')} / {SIM_BARRIER.toLocaleString('ko-KR')}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full border border-sky-300/40 bg-black/60">
          <div className="h-full bg-gradient-to-r from-sky-400 to-cyan-200 transition-all duration-700" style={{ width: `${(barrierNow / SIM_BARRIER) * 100}%` }} />
        </div>
      </div>
      <div className="absolute left-3 top-3 z-[90] flex gap-1.5">
        <span className="rounded-full border border-white/25 bg-black/70 px-2.5 py-1 text-[11px] font-black text-white">{label}</span>
        <span className="rounded-full border border-emerald-300/40 bg-emerald-950/80 px-2.5 py-1 text-[11px] font-black text-emerald-100">리허설 · {phaseLabel}</span>
      </div>
      {!model && (
        <div className="absolute inset-0 flex items-center justify-center text-lg font-black text-sky-100">「▶ 리허설 시작」을 누르면 격돌이 발동합니다</div>
      )}
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-black text-emerald-100">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('rounded-full border px-3 py-1 text-xs font-black', active ? 'border-emerald-200 bg-emerald-500/30 text-white' : 'border-white/20 text-emerald-100 hover:bg-white/5')}>
      {children}
    </button>
  );
}
