import { createInitialTikatukaState, type GameEvent } from '../engine';
import {
  RAKARUKA_DICE_REVEAL_MS,
  difficultyLabel,
  getAiThinkingDelayRange,
  getEventPresentation,
  rowLabel,
  sideLabel,
} from '../ui/presentation';
import { assert, assertEqual, test } from './testHarness';

test('phase6 UI: AI thinking delay follows confirmed difficulty bands', () => {
  assertEqual(getAiThinkingDelayRange(1).minMs, 400);
  assertEqual(getAiThinkingDelayRange(3).maxMs, 700);
  assertEqual(getAiThinkingDelayRange(4).minMs, 600);
  assertEqual(getAiThinkingDelayRange(7).maxMs, 900);
  assertEqual(getAiThinkingDelayRange(8).minMs, 800);
  assertEqual(getAiThinkingDelayRange(10).maxMs, 1200);
});

test('phase6 UI: difficulty labels cover all ten levels', () => {
  assertEqual(difficultyLabel(1), '입문');
  assertEqual(difficultyLabel(4), '초급');
  assertEqual(difficultyLabel(6), '중급');
  assertEqual(difficultyLabel(8), '상급');
  assertEqual(difficultyLabel(10), '최상급');
});

test('Rakaruka UI: side and row labels are Korean and turn-friendly', () => {
  assertEqual(sideLabel('player'), '플레이어');
  assertEqual(sideLabel('ai'), '상대');
  assertEqual(rowLabel('top'), '상단');
  assertEqual(rowLabel('middle'), '중단');
  assertEqual(rowLabel('bottom'), '하단');
});

test('Rakaruka UI: normal roll and Tazza hide the result for exactly two seconds', () => {
  const rolled = getEventPresentation({
    type: 'DIE_ROLLED',
    side: 'player',
    die: { id: 'roll', value: 6, kind: 'normal', owner: 'player' },
  });
  const tazza = getEventPresentation({
    type: 'TAZZA_USED',
    side: 'player',
    previousDie: { id: 'before', value: 1, kind: 'normal', owner: 'player' },
    newDie: { id: 'after', value: 6, kind: 'normal', owner: 'player' },
  });
  assertEqual(RAKARUKA_DICE_REVEAL_MS, 2_000);
  assertEqual(rolled.durationMs, 2_000);
  assertEqual(tazza.durationMs, 2_000);
  assert(!rolled.text.includes('6'), 'roll banner must not reveal the result before animation ends');
  assert(!tazza.text.includes('6'), 'Tazza banner must not reveal the replacement result before animation ends');
});

test('phase6 UI: knock and shield events produce readable event banners', () => {
  const knock: GameEvent = {
    type: 'DICE_KNOCKED',
    attackingSide: 'player',
    targetSide: 'ai',
    row: 'top',
    removedDice: [
      { id: 'a', value: 5, kind: 'normal', owner: 'ai' },
      { id: 'b', value: 5, kind: 'normal', owner: 'ai' },
    ],
  };
  const shield: GameEvent = { type: 'SHIELD_QUEUED', side: 'player', value: 5 };
  const knockPresentation = getEventPresentation(knock);
  const shieldPresentation = getEventPresentation(shield);
  assert(knockPresentation.text.includes('5 × 2'));
  assert(shieldPresentation.text.includes('🛡️5'));
  assert(knockPresentation.durationMs > 0);
  assert(shieldPresentation.durationMs > 0);
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
  assertEqual(presentation.text, '승리!');
  assertEqual(presentation.tone, 'success');
});
