// RAID_CLASH_V1_20261028 — 격돌(CLASH) 공용 계산 코어
// 판정·점수·배율 계산을 한 곳에 모은다. 학생 화면, 연습 모드, 중계 화면이 모두 이 파일을 쓴다.
// 서버(SQL)의 raid_clash_judge / raid_clash_hit_factor와 같은 규칙이어야 한다.
import type {
  RaidClashDifficulty,
  RaidClashJudgment,
  RaidClashKeyCode,
  RaidClashOutcome,
  RaidClashProfile,
  RaidClashSession,
  RaidClashWeakZone,
} from '@/lib/rpc/raid_student_rpc';

export const CLASH_KEYS: RaidClashKeyCode[] = ['KeyQ', 'KeyW', 'KeyE', 'KeyR'];

export const CLASH_KEY_LABEL: Record<RaidClashKeyCode, string> = {
  KeyQ: 'Q',
  KeyW: 'W',
  KeyE: 'E',
  KeyR: 'R',
};

export const CLASH_DIFFICULTY_LABEL: Record<RaidClashDifficulty, string> = {
  EASY: '쉬움',
  NORMAL: '보통',
  HARD: '어려움',
};

export const CLASH_JUDGMENT_STYLE: Record<RaidClashJudgment, { label: string; color: string; glow: string; text: string }> = {
  PERFECT: { label: 'PERFECT', color: '#facc15', glow: 'rgba(250,204,21,0.75)', text: '#fef3c7' },
  GOOD: { label: 'GOOD', color: '#38bdf8', glow: 'rgba(56,189,248,0.70)', text: '#e0f2fe' },
  BAD: { label: 'BAD', color: '#ef4444', glow: 'rgba(239,68,68,0.70)', text: '#fee2e2' },
  MISS: { label: 'MISS', color: '#7f1d1d', glow: 'rgba(127,29,29,0.65)', text: '#fecaca' },
};

const TIMING: Record<RaidClashDifficulty, Pick<RaidClashProfile, 'approach_ms' | 'spacing_ms' | 'perfect_ms' | 'good_ms' | 'bad_ms'>> = {
  EASY: { approach_ms: 1600, spacing_ms: 1700, perfect_ms: 100, good_ms: 230, bad_ms: 360 },
  NORMAL: { approach_ms: 1300, spacing_ms: 1400, perfect_ms: 80, good_ms: 180, bad_ms: 300 },
  HARD: { approach_ms: 1050, spacing_ms: 1150, perfect_ms: 55, good_ms: 125, bad_ms: 230 },
};

/** 서버 raid_clash_profile()과 같은 값. 연습 모드와 서버 응답이 없을 때만 쓴다. */
export function localClashProfile(difficulty: RaidClashDifficulty): RaidClashProfile {
  return {
    version: 1,
    difficulty,
    note_count: 8,
    keys: CLASH_KEYS,
    volunteer_ms: 5000,
    volunteer_grace_ms: 2000,
    volunteer_button_delay_ms: 1000,
    reveal_ms: 2600,
    ready_timeout_ms: 5000,
    countdown_ms: 3000,
    latency_slack_ms: 2500,
    early_slack_ms: 1200,
    ...TIMING[difficulty],
    points: { PERFECT: 2, GOOD: 1, BAD: 0, MISS: 0 },
    success_score: 8,
    great_score: 13,
    weak_zone: { x: 0.4, y: 0.26, width: 0.2, height: 0.26, multiplier: 2 },
  };
}

/** 오차(ms) → 판정. 경계값은 포함(<=). */
export function judgeClash(offsetMs: number | null | undefined, profile: Pick<RaidClashProfile, 'perfect_ms' | 'good_ms' | 'bad_ms'>): RaidClashJudgment {
  if (offsetMs == null || !Number.isFinite(offsetMs)) return 'MISS';
  const error = Math.abs(Math.round(offsetMs));
  if (error <= profile.perfect_ms) return 'PERFECT';
  if (error <= profile.good_ms) return 'GOOD';
  if (error <= profile.bad_ms) return 'BAD';
  return 'MISS';
}

export function clashPoints(judgment: RaidClashJudgment): number {
  if (judgment === 'PERFECT') return 2;
  if (judgment === 'GOOD') return 1;
  return 0;
}

export function clashOutcome(score: number, profile: Pick<RaidClashProfile, 'success_score' | 'great_score'>): RaidClashOutcome {
  if (score >= profile.great_score) return 'GREAT_SUCCESS';
  if (score >= profile.success_score) return 'SUCCESS';
  return 'FAILED';
}

/** play_starts_at 기준 i번째 노트의 이상적인 입력 시각(ms). */
export function clashIdealOffsetMs(profile: Pick<RaidClashProfile, 'countdown_ms' | 'approach_ms' | 'spacing_ms'>, index: number): number {
  return profile.countdown_ms + profile.approach_ms + index * profile.spacing_ms;
}

/** 현재 시각(로컬 ms)을 브라우저 이벤트 시계와 같은 기준으로 돌려준다. */
export function clashNowMs(): number {
  if (typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin)) {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
}

/** 키 이벤트가 실제로 일어난 시각(로컬 ms). 화면 프레임이 늦어도 정확하다. */
export function clashEventMs(event: { timeStamp: number }): number {
  if (typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin) && event.timeStamp > 0) {
    return performance.timeOrigin + event.timeStamp;
  }
  return clashNowMs();
}

export interface LocalClashNote {
  index: number;
  key: RaidClashKeyCode;
  /** 로컬 시계 기준 이상적인 입력 시각(ms) */
  idealMs: number;
}

/** 서버 노트(ideal_at)를 로컬 시계로 옮긴다. serverOffsetMs = 서버시각 - 로컬시각 */
export function toLocalNotes(session: RaidClashSession | null | undefined, serverOffsetMs: number): LocalClashNote[] {
  if (!session?.notes) return [];
  return session.notes
    .map((note) => ({ index: note.index, key: note.key, idealMs: Date.parse(note.ideal_at) - serverOffsetMs }))
    .filter((note) => Number.isFinite(note.idealMs))
    .sort((a, b) => a.index - b.index);
}

/** 지금 입력을 받을 노트: 고리가 보이기 시작했고 BAD 창이 아직 안 끝난, 가장 앞의 미판정 노트 */
export function activeClashNote(
  nowMs: number,
  notes: LocalClashNote[],
  judged: Partial<Record<number, RaidClashJudgment>>,
  profile: Pick<RaidClashProfile, 'approach_ms' | 'bad_ms'>,
): LocalClashNote | null {
  for (const note of notes) {
    if (judged[note.index]) continue;
    if (nowMs > note.idealMs + profile.bad_ms) continue;
    if (nowMs >= note.idealMs - profile.approach_ms) return note;
    return null;
  }
  return null;
}

/** 입력 없이 BAD 창이 끝난 노트들 → MISS로 보낸다 */
export function expiredClashNotes(
  nowMs: number,
  notes: LocalClashNote[],
  judged: Partial<Record<number, RaidClashJudgment>>,
  profile: Pick<RaidClashProfile, 'bad_ms'>,
): LocalClashNote[] {
  return notes.filter((note) => !judged[note.index] && nowMs > note.idealMs + profile.bad_ms);
}

/**
 * 고리 수축 진행도. 1 = 막 나타남(가장 큼), 0 = 판정 고리와 정확히 겹침, 음수 = 늦음.
 */
export function clashRingProgress(nowMs: number, idealMs: number, approachMs: number): number {
  return (idealMs - nowMs) / Math.max(1, approachMs);
}

export interface ClashAttackContext {
  buffActive: boolean;
  clashComponent: number;
  weakZone: RaidClashWeakZone | null;
}

export function clashAttackContext(session: RaidClashSession | null | undefined, nowServerMs: number): ClashAttackContext {
  const buffUntil = session?.buff_until ? Date.parse(session.buff_until) : Number.NaN;
  const active = Boolean(
    session &&
      session.phase === 'RESOLVED' &&
      Number(session.clash_component) > 0 &&
      Number.isFinite(buffUntil) &&
      buffUntil > nowServerMs,
  );
  return {
    buffActive: active,
    clashComponent: active ? Number(session?.clash_component ?? 0) : 0,
    weakZone: session?.weak_zone ?? null,
  };
}

export function insideClashWeakZone(zone: RaidClashWeakZone | null | undefined, x: number, y: number): boolean {
  if (!zone) return false;
  return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height;
}

/**
 * 서버 raid_clash_hit_factor와 같은 규칙.
 * 버프 중: max(약점 배율 + 격돌 성분, 기존 패턴 배율 × 그로기). 버프가 없으면 기존 패턴 배율 × 그로기 그대로.
 */
export function clashHitFactor(
  ctx: ClashAttackContext,
  x: number,
  y: number,
  patternMultiplier: number,
  groggyMultiplier: number,
): number {
  const legacy = patternMultiplier * groggyMultiplier;
  if (!ctx.buffActive) return legacy;
  const inZone = insideClashWeakZone(ctx.weakZone, x, y);
  const weak = inZone ? Math.max(0, Number(ctx.weakZone?.multiplier ?? 2)) : patternMultiplier;
  return Math.max(legacy, weak + Math.max(0, ctx.clashComponent));
}

export function clashPercentLabel(component: number): string {
  return `${Math.round(component * 100)}%`;
}

export function clashOutcomeCopy(outcome: RaidClashOutcome | null | undefined, component: number, weakMultiplier: number) {
  if (outcome === 'GREAT_SUCCESS') {
    return {
      title: '대성공!',
      detail: `10초간 격돌 ${clashPercentLabel(component)} · 약점 명중 시 ${clashPercentLabel(component + weakMultiplier)} · 보스 공격 16초 봉쇄`,
      tone: 'gold' as const,
    };
  }
  if (outcome === 'SUCCESS') {
    return {
      title: '격돌 성공!',
      detail: `10초간 격돌 ${clashPercentLabel(component)} · 약점 명중 시 ${clashPercentLabel(component + weakMultiplier)} · 보스 공격 10초 봉쇄`,
      tone: 'blue' as const,
    };
  }
  return {
    title: '격돌 실패',
    detail: '보스의 반격! 공명방벽이 피해를 입었습니다. 다 같이 다시 힘을 모아요!',
    tone: 'red' as const,
  };
}
