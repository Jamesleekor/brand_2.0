import type { Difficulty, GameEvent, RowId, Side } from '../engine';

export const RAKARUKA_DICE_REVEAL_MS = 2_000;

export type TikatukaEventTone = 'neutral' | 'player' | 'ai' | 'gold' | 'danger' | 'success';

export interface TikatukaEventPresentation {
  text: string;
  tone: TikatukaEventTone;
  durationMs: number;
}

export interface ThinkingDelayRange {
  minMs: number;
  maxMs: number;
}

export function sideLabel(side: Side): string {
  return side === 'player' ? '플레이어' : '상대';
}

export function rowLabel(row: RowId): string {
  if (row === 'top') return '상단';
  if (row === 'middle') return '중단';
  return '하단';
}

export function difficultyLabel(difficulty: Difficulty): string {
  if (difficulty <= 2) return '입문';
  if (difficulty <= 4) return '초급';
  if (difficulty <= 6) return '중급';
  if (difficulty <= 8) return '상급';
  return '최상급';
}

export function getAiThinkingDelayRange(difficulty: Difficulty): ThinkingDelayRange {
  if (difficulty <= 3) return { minMs: 400, maxMs: 700 };
  if (difficulty <= 7) return { minMs: 600, maxMs: 900 };
  return { minMs: 800, maxMs: 1_200 };
}

export function getEventPresentation(event: GameEvent): TikatukaEventPresentation {
  switch (event.type) {
    case 'DIE_ROLLED':
      return {
        text: `${sideLabel(event.side)}가 주사위를 굴립니다`,
        tone: event.side === 'player' ? 'player' : 'ai',
        durationMs: RAKARUKA_DICE_REVEAL_MS,
      };
    case 'TAZZA_USED':
      return {
        text: `${sideLabel(event.side)}가 타짜를 사용해 다시 굴립니다`,
        tone: 'gold',
        durationMs: RAKARUKA_DICE_REVEAL_MS,
      };
    case 'DIE_HELD':
      return {
        text: `${sideLabel(event.side)} 홀드 · ${event.die.kind === 'shield' ? '🛡️ ' : ''}${event.die.value} 보관`,
        tone: 'gold',
        durationMs: 560,
      };
    case 'FORCED_PASS':
      return {
        text: `${sideLabel(event.side)} 놓을 곳 없음 · 주사위 ${event.die.value} 보존`,
        tone: 'neutral',
        durationMs: 520,
      };
    case 'DIE_PLACED':
      return {
        text: `${sideLabel(event.side)} ${rowLabel(event.placement.row)} 배치 · ${event.die.kind === 'shield' ? '🛡️ ' : ''}${event.die.value}`,
        tone: event.side === 'player' ? 'player' : 'ai',
        durationMs: 380,
      };
    case 'DICE_KNOCKED':
      return {
        text: `알까기! ${event.removedDice[0]?.value ?? ''} × ${event.removedDice.length} 제거`,
        tone: 'danger',
        durationMs: 620,
      };
    case 'SHIELD_QUEUED':
      return {
        text: `${sideLabel(event.side)} 다음 턴 🛡️${event.value} 획득`,
        tone: 'gold',
        durationMs: 520,
      };
    case 'SHIELD_GRANTED':
      return {
        text: `${sideLabel(event.side)} 실드 주사위 🛡️${event.die.value}`,
        tone: 'gold',
        durationMs: 620,
      };
    case 'TURN_CHANGED':
      return {
        text: event.side === 'player' ? '당신의 턴' : '상대의 턴',
        tone: event.side === 'player' ? 'player' : 'ai',
        durationMs: 320,
      };
    case 'GAME_FINISHED':
      return {
        text: event.result.winner === 'draw'
          ? '무승부'
          : event.result.winner === 'player'
            ? '승리!'
            : '패배',
        tone: event.result.winner === 'player' ? 'success' : event.result.winner === 'ai' ? 'danger' : 'neutral',
        durationMs: 820,
      };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
