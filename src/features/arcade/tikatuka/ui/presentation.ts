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
  return side === 'player' ? '당신' : '상대 AI';
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
  if (difficulty <= 3) return { minMs: 1_200, maxMs: 1_600 };
  if (difficulty <= 7) return { minMs: 1_400, maxMs: 1_900 };
  return { minMs: 1_600, maxMs: 2_200 };
}

function placementBoardLabel(actor: Side, target: Side): string {
  if (actor === 'player') return target === 'player' ? '당신 보드' : '상대 보드';
  return target === 'ai' ? '자기 보드' : '당신 보드';
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
        text: `🃏 타짜! ${sideLabel(event.side)}가 숫자 ${event.previous.value}을(를) 버리고 다시 굴립니다`,
        tone: 'gold',
        durationMs: 2_400,
      };
    case 'DIE_HELD':
      return {
        text: `✋ 홀드! ${sideLabel(event.side)}가 ${event.die.kind === 'shield' ? '실드 주사위' : '일반 주사위'} ${event.die.value}을(를) 다음 자기 턴까지 보관합니다`,
        tone: 'gold',
        durationMs: 1_800,
      };
    case 'FORCED_PASS':
      return {
        text: `↪ 놓을 곳 없음 · ${sideLabel(event.side)}의 주사위 ${event.die.value}은(는) 사라지지 않고 다음 자기 턴까지 보존됩니다`,
        tone: 'neutral',
        durationMs: 1_600,
      };
    case 'DIE_PLACED':
      return {
        text: `${sideLabel(event.side)}가 ${placementBoardLabel(event.side, event.placement.targetSide)} ${rowLabel(event.placement.row)}에 ${event.die.kind === 'shield' ? `🛡️ 실드 주사위 ${event.die.value}` : `일반 주사위 ${event.die.value}`}을(를) 놓았습니다`,
        tone: event.side === 'player' ? 'player' : 'ai',
        durationMs: 1_250,
      };
    case 'DICE_KNOCKED': {
      const value = event.removedDice[0]?.value ?? '?';
      return {
        text: `💥 알까기! ${sideLabel(event.attackingSide)}가 ${sideLabel(event.targetSide)} ${rowLabel(event.row)}의 일반 ${value} 주사위 ${event.removedDice.length}개를 제거했습니다`,
        tone: 'danger',
        durationMs: 2_200,
      };
    }
    case 'SHIELD_QUEUED':
      return {
        text: `🛡️ 실드 획득! ${sideLabel(event.side)}의 다음 자기 턴에 숫자 ${event.value} 실드 주사위가 등장합니다`,
        tone: 'gold',
        durationMs: 2_000,
      };
    case 'SHIELD_GRANTED':
      return {
        text: `🛡️ 실드 주사위 등장! 숫자 ${event.die.value} · 알까기 면역 · 양쪽 보드의 빈 줄 어디든 배치 가능`,
        tone: 'gold',
        durationMs: 2_200,
      };
    case 'TURN_CHANGED':
      return {
        text: event.side === 'player' ? '▶ 당신의 턴' : '▶ 상대의 턴',
        tone: event.side === 'player' ? 'player' : 'ai',
        durationMs: 1_000,
      };
    case 'GAME_FINISHED':
      return {
        text: event.result.winner === 'draw'
          ? '⚖️ 무승부'
          : event.result.winner === 'player'
            ? '🏆 승리!'
            : '💀 패배',
        tone: event.result.winner === 'player' ? 'success' : event.result.winner === 'ai' ? 'danger' : 'neutral',
        durationMs: 1_800,
      };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
