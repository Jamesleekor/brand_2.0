import type { Difficulty, GameEvent, Side } from '../engine';

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
  return side === 'player' ? 'PLAYER' : 'AI';
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
        text: `${sideLabel(event.side)} 주사위 ${event.die.value}`,
        tone: event.side === 'player' ? 'player' : 'ai',
        durationMs: 360,
      };
    case 'TAZZA_USED':
      return {
        text: `${sideLabel(event.side)} 타짜의 손놀림 · ${event.previous.value} → ${event.next.value}`,
        tone: 'gold',
        durationMs: 520,
      };
    case 'DIE_HELD':
      return {
        text: `${sideLabel(event.side)} HOLD · ${event.die.kind === 'shield' ? '🛡️ ' : ''}${event.die.value} 보관`,
        tone: 'gold',
        durationMs: 440,
      };
    case 'FORCED_PASS':
      return {
        text: `${sideLabel(event.side)} 놓을 곳 없음 · 주사위 ${event.die.value} 보존`,
        tone: 'neutral',
        durationMs: 420,
      };
    case 'DIE_PLACED':
      return {
        text: `${sideLabel(event.side)} ${event.placement.row.toUpperCase()} 배치 · ${event.die.kind === 'shield' ? '🛡️ ' : ''}${event.die.value}`,
        tone: event.side === 'player' ? 'player' : 'ai',
        durationMs: 300,
      };
    case 'DICE_KNOCKED':
      return {
        text: `알까기! ${event.removedDice[0]?.value ?? ''} × ${event.removedDice.length} 제거`,
        tone: 'danger',
        durationMs: 520,
      };
    case 'SHIELD_QUEUED':
      return {
        text: `${sideLabel(event.side)} 다음 턴 🛡️${event.value} 획득`,
        tone: 'gold',
        durationMs: 420,
      };
    case 'SHIELD_GRANTED':
      return {
        text: `${sideLabel(event.side)} 실드 주사위 🛡️${event.die.value}`, 
        tone: 'gold',
        durationMs: 420,
      };
    case 'TURN_CHANGED':
      return {
        text: `${sideLabel(event.side)} TURN`,
        tone: event.side === 'player' ? 'player' : 'ai',
        durationMs: 220,
      };
    case 'GAME_FINISHED':
      return {
        text: event.result.winner === 'draw'
          ? 'DRAW'
          : event.result.winner === 'player'
            ? 'PLAYER VICTORY'
            : 'AI VICTORY',
        tone: event.result.winner === 'player' ? 'success' : event.result.winner === 'ai' ? 'danger' : 'neutral',
        durationMs: 720,
      };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
