import assert from 'node:assert/strict';
import { calculateExpeditionFitClient } from '../src/features/character/expedition/expeditionFit.ts';
import { assignExpeditionParty, swapExpeditionParty } from '../src/features/character/expedition/expeditionParty.ts';

const site = { major_element: 'FIRE', minor_element: 'LIGHT', specialty_code: 'RUINS' };
const party = [
  { character_id: 1, primary_element: 'WATER', primary_points: 6, secondary_element: 'EARTH', secondary_points: 2, specialty_code: 'NATURE' },
  { character_id: 2, primary_element: 'WATER', primary_points: 4, secondary_element: 'DARK', secondary_points: 4, specialty_code: 'RUINS' },
  { character_id: 3, primary_element: 'DARK', primary_points: 4, secondary_element: 'EARTH', secondary_points: 4, specialty_code: 'NATURE' },
];
const expected = [[[1, 2, 3], 96], [[1, 3, 2], 91], [[2, 1, 3], 92], [[2, 3, 1], 92], [[3, 1, 2], 88], [[3, 2, 1], 93]];
for (const [ids, fit] of expected) {
  const ordered = ids.map(id => party[id - 1]);
  const result = calculateExpeditionFitClient(site, ordered, 'ELEM_70_30_ROLES_V3');
  assert.equal(result.fitPercent, fit, ids.join(','));
  assert.equal(result.baseFitPercent, 85);
  assert.equal(result.baseFitPercent + result.captainBonusPercent + result.viceBonusPercent, fit);
  assert.equal(calculateExpeditionFitClient(site, ordered).fitPercent, 85);
  assert.equal(calculateExpeditionFitClient(site, ordered, 'ELEM_70_30_V1').fitPercent, 5);
}
const allSpecialists = party.map(c => ({ ...c, specialty_code: 'RUINS' }));
assert.equal(calculateExpeditionFitClient(site, allSpecialists, 'ELEM_70_30_ROLES_V3').viceBonusPercent, 5);
const saturated = party.map(c => ({ ...c, primary_element: 'WATER', primary_points: 6, secondary_element: 'DARK', secondary_points: 4, specialty_code: 'RUINS' }));
const cap = calculateExpeditionFitClient(site, saturated, 'ELEM_70_30_ROLES_V3');
assert.equal(cap.fitPercent, 130);
assert.equal(cap.viceBonusPercent, 0);
assert.equal(calculateExpeditionFitClient(site, [party[0], party[0], party[2]], 'ELEM_70_30_ROLES_V3'), null);
assert.equal(calculateExpeditionFitClient(site, party.slice(0, 2), 'ELEM_70_30_ROLES_V3'), null);

let state = assignExpeditionParty([null, null, null], 0, 1);
assert.deepEqual(state, { slots: [1, null, null], activeSlot: 1 });
state = assignExpeditionParty(state.slots, state.activeSlot, 2);
state = assignExpeditionParty(state.slots, state.activeSlot, 3);
assert.deepEqual(state.slots, [1, 2, 3]);
assert.deepEqual(assignExpeditionParty(state.slots, 0, 3).slots, [3, 2, 1]);
assert.deepEqual(assignExpeditionParty(state.slots, 1, 2).slots, [1, null, 3]);
assert.deepEqual(assignExpeditionParty([1, null, 3], 1, 1).slots, [null, 1, 3]);
assert.deepEqual(assignExpeditionParty([1, 2, 3], 1, 4).slots, [1, 4, 3]);
assert.deepEqual(swapExpeditionParty([1, null, 3], 0, 1), [null, 1, 3]);
assert.deepEqual(state.slots, [1, 2, 3]); // Helpers never mutate React state.
console.log('PASS: all six role orders, V1/V2 preservation, cap, specialty stacking, and slot assignment/swapping/removal.');
