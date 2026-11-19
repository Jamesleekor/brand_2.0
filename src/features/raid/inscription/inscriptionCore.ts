// RAID_INSCRIPTION_V1_20261118 — 주문 각인 공통 규칙(학생 전투 화면 · 연습 모드 · 교사 리허설이 함께 씀)
// 서버(raid_inscription_profile / raid_inscription_make_sequence)와 같은 숫자·규칙을 쓴다.
import type { RaidInscriptionDifficulty, RaidInscriptionPublicState } from '@/lib/rpc/raid_student_rpc';

/** 기본 키 7개(왼손 A S D F · 오른손 J K L) */
export const INSCRIPTION_BASE_KEYS = ['A', 'S', 'D', 'F', 'J', 'K', 'L'] as const;
/** 어려움 이상: 가운데 G H 추가 → 9개 */
export const INSCRIPTION_GH_KEYS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'] as const;

export function inscriptionKeys(useGh: boolean | null | undefined): string[] {
  return [...(useGh ? INSCRIPTION_GH_KEYS : INSCRIPTION_BASE_KEYS)];
}

/** 서버 기본값과 같은 고정 시간(ms) */
export const INSCRIPTION_DEFAULTS = {
  missLockMs: 400,
  revealMs: 2600,
  countdownMs: 3000,
  latencySlackMs: 1500,
  minMsPerLetter: 120,
  sequencePool: 40,
  volunteerButtonDelayMs: 1000,
} as const;

export interface InscriptionPreset {
  key: 'EASY' | 'NORMAL' | 'HARD' | 'EXTREME';
  label: string;
  letterCount: number;
  useGh: boolean;
  timeLimitMs: number;
  note: string;
}

/** 난이도 표(시뮬레이션으로 정한 기본값). 극한(16글자)은 교사 직접 설정 전용 */
export const INSCRIPTION_PRESETS: InscriptionPreset[] = [
  { key: 'EASY', label: '쉬움', letterCount: 8, useGh: false, timeLimitMs: 20000, note: '8글자 · 20초 · 키 7개' },
  { key: 'NORMAL', label: '보통', letterCount: 10, useGh: false, timeLimitMs: 22000, note: '10글자 · 22초 · 키 7개' },
  { key: 'HARD', label: '어려움', letterCount: 12, useGh: true, timeLimitMs: 26000, note: '12글자 · 26초 · G·H 추가' },
  { key: 'EXTREME', label: '극한', letterCount: 16, useGh: true, timeLimitMs: 40000, note: '16글자 · 40초 · 선생님 설정 전용' },
];

export function inscriptionDifficultyLabel(difficulty: RaidInscriptionDifficulty | null | undefined): string {
  if (difficulty === 'HARD') return '어려움';
  if (difficulty === 'NORMAL') return '보통';
  if (difficulty === 'CUSTOM') return '특수';
  return '쉬움';
}

/**
 * 연습용 문자열 하나. 서버와 같은 규칙: 같은 글자가 세 번 연속으로 나오지 않는다.
 */
export function makeInscriptionSequence(letterCount: number, useGh: boolean): string {
  const keys = inscriptionKeys(useGh);
  const length = Math.max(1, Math.min(32, Math.round(letterCount)));
  let out = '';
  for (let i = 0; i < length; i += 1) {
    let next = keys[Math.floor(Math.random() * keys.length)];
    while (out.length >= 2 && out[out.length - 1] === next && out[out.length - 2] === next) {
      next = keys[Math.floor(Math.random() * keys.length)];
    }
    out += next;
  }
  return out;
}

export function makeInscriptionPool(letterCount: number, useGh: boolean, size: number = INSCRIPTION_DEFAULTS.sequencePool): string[] {
  return Array.from({ length: Math.max(1, size) }, () => makeInscriptionSequence(letterCount, useGh));
}

/**
 * 키보드 이벤트 → 글자. event.code(KeyA…)로 읽어서 한글 입력 상태·Caps Lock과 상관없이 같은 글자가 나온다.
 * 알파벳 키가 아니면 null(무시).
 */
export function inscriptionLetterFromEvent(event: KeyboardEvent): string | null {
  const code = event.code ?? '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  return null;
}

export function parseServerMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 지금 이 화면이 전투를 멈추고 각인 화면을 띄워야 하는지(결과 화면 3초 포함) */
export function inscriptionShowsOverlay(state: RaidInscriptionPublicState | null | undefined, serverNow: number): boolean {
  if (!state) return false;
  if (state.phase === 'VOLUNTEERING' || state.phase === 'SELECTED' || state.phase === 'PLAYING') return true;
  if (state.phase === 'RESOLVED' || state.phase === 'CANCELLED') {
    const resumeAt = parseServerMs(state.resume_at);
    return resumeAt != null && serverNow < resumeAt;
  }
  return false;
}

export function formatSeconds(ms: number, digits = 1): string {
  return (Math.max(0, ms) / 1000).toFixed(digits);
}
