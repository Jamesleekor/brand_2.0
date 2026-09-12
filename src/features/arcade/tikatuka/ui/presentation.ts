import type { Difficulty, GameEvent, RowId, Side } from '../engine';

export const RAKARUKA_DICE_REVEAL_MS = 2_000;
export const RAKARUKA_TAZZA_REVEAL_MS = 2_500;
export const RAKARUKA_AI_RESULT_HOLD_MS = 1_500;
export const RAKARUKA_UI_EVENT = 'rakaruka-ui-event';

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
  if (difficulty <= 3) return { minMs: 1_500, maxMs: 1_900 };
  if (difficulty <= 7) return { minMs: 1_700, maxMs: 2_200 };
  return { minMs: 1_900, maxMs: 2_500 };
}

function placementBoardLabel(actor: Side, target: Side): string {
  if (actor === 'player') return target === 'player' ? '당신 보드' : '상대 보드';
  return target === 'ai' ? '자기 보드' : '당신 보드';
}

function emitUiEvent(event: GameEvent) {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent<GameEvent>(RAKARUKA_UI_EVENT, { detail: event }));
}

export function getEventLogText(event: GameEvent): string | null {
  switch (event.type) {
    case 'DIE_ROLLED':
      return `${sideLabel(event.side)} · 주사위 ${event.die.value} 굴림`;
    case 'TAZZA_USED':
      return `${sideLabel(event.side)} · 타짜 사용 (${event.previous.value} → ${event.next.value})`;
    case 'DIE_HELD':
      return `${sideLabel(event.side)} · 홀드 ${event.die.kind === 'shield' ? '실드 ' : ''}${event.die.value}`;
    case 'FORCED_PASS':
      return `${sideLabel(event.side)} · 놓을 수 없어 ${event.die.value} 보존`;
    case 'DIE_PLACED':
      return `${sideLabel(event.side)} · ${placementBoardLabel(event.side, event.placement.targetSide)} ${rowLabel(event.placement.row)}에 ${event.die.kind === 'shield' ? '실드 ' : ''}${event.die.value} 배치`;
    case 'DICE_KNOCKED': {
      const value = event.attackingDie?.value ?? event.removedDice[0]?.value ?? '?';
      return `${sideLabel(event.attackingSide)} · ${value}로 ${sideLabel(event.targetSide)} ${rowLabel(event.row)} 알까기 → ${event.removedDice.length}개 제거`;
    }
    case 'SHIELD_QUEUED':
      return `${sideLabel(event.side)} · 알까기 보상 실드 ${event.value} 예약`;
    case 'SHIELD_GRANTED':
      return `${sideLabel(event.side)} · 실드 주사위 ${event.die.value} 등장`;
    case 'TURN_CHANGED':
      return null;
    case 'GAME_FINISHED':
      return event.result.winner === 'player' ? '게임 종료 · 당신 승리' : event.result.winner === 'ai' ? '게임 종료 · 상대 AI 승리' : '게임 종료 · 무승부';
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function getEventPresentation(event: GameEvent): TikatukaEventPresentation {
  emitUiEvent(event);

  switch (event.type) {
    case 'DIE_ROLLED':
      return {
        text: `${sideLabel(event.side)}가 주사위를 굴립니다`,
        tone: event.side === 'player' ? 'player' : 'ai',
        durationMs: RAKARUKA_DICE_REVEAL_MS + (event.side === 'ai' ? RAKARUKA_AI_RESULT_HOLD_MS : 0),
      };
    case 'TAZZA_USED':
      return {
        text: `🃏 타짜! ${sideLabel(event.side)}가 숫자 ${event.previous.value}을(를) 버리고 다시 굴립니다`,
        tone: 'gold',
        durationMs: RAKARUKA_TAZZA_REVEAL_MS + (event.side === 'ai' ? RAKARUKA_AI_RESULT_HOLD_MS : 0),
      };
    case 'DIE_HELD':
      return {
        text: `✋ 홀드! ${sideLabel(event.side)}가 ${event.die.kind === 'shield' ? '실드 주사위' : '일반 주사위'} ${event.die.value}을(를) 다음 자기 턴까지 보관합니다`,
        tone: 'gold',
        durationMs: 2_200,
      };
    case 'FORCED_PASS':
      return {
        text: `↪ 놓을 곳 없음 · ${sideLabel(event.side)}의 주사위 ${event.die.value}은(는) 사라지지 않고 다음 자기 턴까지 보존됩니다`,
        tone: 'neutral',
        durationMs: 1_900,
      };
    case 'DIE_PLACED':
      return {
        text: `${sideLabel(event.side)}가 ${placementBoardLabel(event.side, event.placement.targetSide)} ${rowLabel(event.placement.row)}에 ${event.die.kind === 'shield' ? `🛡️ 실드 주사위 ${event.die.value}` : `일반 주사위 ${event.die.value}`}을(를) 놓았습니다`,
        tone: event.side === 'player' ? 'player' : 'ai',
        durationMs: 1_800,
      };
    case 'DICE_KNOCKED': {
      const value = event.attackingDie?.value ?? event.removedDice[0]?.value ?? '?';
      return {
        text: `💥 알까기! ${sideLabel(event.attackingSide)}가 숫자 ${value} 주사위를 배치하지 않고 공격에 사용해 ${sideLabel(event.targetSide)} ${rowLabel(event.row)}의 같은 숫자 일반 주사위 ${event.removedDice.length}개를 제거했습니다`,
        tone: 'danger',
        durationMs: 3_000,
      };
    }
    case 'SHIELD_QUEUED':
      return {
        text: `🛡️ 알까기 성공 보상! ${sideLabel(event.side)}의 다음 자기 턴에 숫자 ${event.value} 실드 주사위가 등장합니다`,
        tone: 'gold',
        durationMs: 2_400,
      };
    case 'SHIELD_GRANTED':
      return {
        text: `🛡️ 실드 주사위 등장! 숫자 ${event.die.value} · 알까기 면역 · 양쪽 보드의 빈 줄 어디든 배치 가능`,
        tone: 'gold',
        durationMs: 2_500,
      };
    case 'TURN_CHANGED':
      return {
        text: event.side === 'player' ? '▶ 당신의 턴' : '▶ 상대의 턴',
        tone: event.side === 'player' ? 'player' : 'ai',
        durationMs: 1_200,
      };
    case 'GAME_FINISHED':
      return {
        text: event.result.winner === 'draw'
          ? '⚖️ 무승부'
          : event.result.winner === 'player'
            ? '🏆 승리!'
            : '💀 패배',
        tone: event.result.winner === 'player' ? 'success' : event.result.winner === 'ai' ? 'danger' : 'neutral',
        durationMs: 2_000,
      };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}