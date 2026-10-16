import assert from 'node:assert/strict';
import { getChestOpeningConfig, nextChestOpeningPhase } from '../src/features/character/expedition/chestOpening.ts';

for (const tier of ['COMMON', 'INTERMEDIATE', 'RARE']) {
  const config = getChestOpeningConfig(tier);
  assert.ok(config.chargeMs > 0 && config.burstMs > 0);
  // A slow response cannot reveal an unconfirmed reward.
  assert.equal(nextChestOpeningPhase('CHARGING', true, false, false), 'CHARGING');
  // A fast response still waits for the minimum opening sequence.
  assert.equal(nextChestOpeningPhase('CHARGING', false, true, false), 'CHARGING');
  assert.equal(nextChestOpeningPhase('CHARGING', true, true, false), 'BURST');
  assert.equal(nextChestOpeningPhase('BURST', true, true, false), 'BURST');
  // Reduced motion removes cinematic waiting but still requires a result.
  assert.equal(nextChestOpeningPhase('CHARGING', false, false, true), 'CHARGING');
  assert.equal(nextChestOpeningPhase('CHARGING', false, true, true), 'REVEALED');
  assert.equal(nextChestOpeningPhase('REVEALED', true, true, false), 'REVEALED');
}
assert.ok(getChestOpeningConfig('RARE').chargeMs > getChestOpeningConfig('INTERMEDIATE').chargeMs);
assert.ok(getChestOpeningConfig('INTERMEDIATE').chargeMs > getChestOpeningConfig('COMMON').chargeMs);
assert.deepEqual(getChestOpeningConfig('UNKNOWN'), getChestOpeningConfig('COMMON'));
console.log('PASS: opening phases, slow/fast responses, reduced motion and tier durations.');
