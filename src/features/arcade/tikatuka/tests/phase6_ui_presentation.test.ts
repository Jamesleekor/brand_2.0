import { createInitialTikatukaState, type GameEvent } from '../engine';
import {
  RAKARUKA_DICE_REVEAL_MS,
  difficultyLabel,
  getAiThinkingDelayRange,
  getEventLogText,
  getEventPresentation,
  rowLabel,
  sideLabel,
} from '../ui/presentation';
import { assert, assertEqual, test } from './testHarness';

test('Rakaruka UI: AI thinking delay is deliberately readable at every difficulty', () => {
  assertEqual(getAiThinkingDelayRange(1).minMs, 1500);
  assertEqual(getAiThinkingDelayRange(3).maxMs, 1900);
  assertEqual(getAiThinkingDelayRange(4).minMs, 1700);
  assertEqual(getAiThinkingDelayRange(7).maxMs, 2200);
  assertEqual(getAiThinkingDelayRange(8).minMs, 1900);
  assertEqual(getAiThinkingDelayRange(10).maxMs, 2500);
});

test('phase6 UI: difficulty labels cover all ten levels', () => {
  assertEqual(difficultyLabel(1), '입문');
  assertEqual(difficultyLabel(4), '초급');
  assertEqual(difficultyLabel(6), '중급');
  assertEqual(difficultyLabel(8), '상급');
  assertEqual(difficultyLabel(10), '최상급');
});

test('Rakaruka UI: side and row labels are Korean and turn-friendly', () => {
  assertEqual(sideLabel('player'), '당신');
  assertEqual(sideLabel('ai'), '상대 AI');
  assertEqual(rowLabel('top'), '상단');
  assertEqual(rowLabel('middle'), '중단');
  assertEqual(rowLabel('bottom'), '하단');
});

test('Rakaruka UI: normal roll hides the result for exactly two seconds and Tazza never leaks replacement value', () => {
  const rolled = getEventPresentation({
    type: 'DIE_ROLLED',
    side: 'player',
    die: { id: 'roll', value: 6, kind: 'normal', owner: 'player' },
  });
  const tazza = getEventPresentation({
    type: 'TAZZA_USED',
    side: 'player',
    previous: { id: 'before', value: 1, kind: 'normal', owner: 'player' },
    next: { id: 'after', value: 6, kind: 'normal', owner: 'player' },
  });
  assertEqual(RAKARUKA_DICE_REVEAL_MS, 2_000);
  assertEqual(rolled.durationMs, 2_000);
  assert(tazza.durationMs >= 2_000);
  assert(!rolled.text.includes('6'), 'roll banner must not reveal the result before animation ends');
  assert(!tazza.text.includes('6'), 'Tazza banner must not reveal the replacement result before animation ends');
});

test('Rakaruka UI: explicit knock and shield events produce readable banners and history text', () => {
  const attackingDie = { id: 'attack', value: 5, kind: 'normal', owner: 'player' } as const;
  const knock: GameEvent = {
    type: 'DICE_KNOCKED',
    attackingSide: 'player',
    targetSide: 'ai',
    row: 'top',
    attackingDie,
    removedDice: [
      { id: 'a', value: 5, kind: 'normal', owner: 'ai' },
      { id: 'b', value: 5, kind: 'normal', owner: 'ai' },
    ],
  };
  const shield: GameEvent = { type: 'SHIELD_QUEUED', side: 'player', value: 5 };
  const knockPresentation = getEventPresentation(knock);
  const shieldPresentation = getEventPresentation(shield);
  assert(knockPresentation.text.includes('알까기'));
  assert(knockPresentation.text.includes('2개'));
  assert(knockPresentation.text.includes('배치하지 않고'));
  assert(shieldPresentation.text.includes('실드'));
  assert((getEventLogText(knock) ?? '').includes('2개 제거'));
  assert(knockPresentation.durationMs >= 2500);
  assert(shieldPresentation.durationMs >= 2000);
});

test('phase6 UI: game-finished event reflects winner without recomputing rules', () => {
  const state = createInitialTikatukaState('ui-result', 5);
  const event: GameEvent = {
    type: 'GAME_FINISHED',
    result: {
      gameId: state.gameId,
      winner: 'player',
      difficulty: 5,
      playerRowWins: 2,
      aiRowWins: 1,
      tiedRows: 0,
      playerScore: 30,
      aiScore: 24,
      playerRawPips: 21,
      aiRawPips: 18,
      playerKnockCount: 2,
      aiKnockCount: 1,
      playerDiceRemoved: 3,
      aiDiceRemoved: 1,
      playerShieldsEarned: 2,
      aiShieldsEarned: 1,
      playerTazzaUsed: 1,
      aiTazzaUsed: 1,
      playerHoldUsed: 0,
      aiHoldUsed: 0,
      totalTurns: 17,
    },
  };
  const presentation = getEventPresentation(event);
  assertEqual(presentation.text, '🏆 승리!');
  assertEqual(presentation.tone, 'success');
});
