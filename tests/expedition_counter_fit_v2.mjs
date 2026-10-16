import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calculateExpeditionFitClient,
  getExpeditionCounterElement,
} from '../src/features/character/expedition/expeditionFit.ts';

const counters = {
  WATER: 'EARTH', FIRE: 'WATER', WIND: 'FIRE',
  EARTH: 'WIND', LIGHT: 'DARK', DARK: 'LIGHT',
};
for (const [environment, expected] of Object.entries(counters)) {
  assert.equal(getExpeditionCounterElement(environment), expected);
  const site = {
    major_element: environment,
    minor_element: environment === 'FIRE' ? 'WIND' : 'FIRE',
    specialty_code: 'SANCTUARY',
  };
  const party = [1, 2, 3].map((character_id) => ({
    character_id, primary_element: expected, primary_points: 6,
    secondary_element: null, secondary_points: 0, specialty_code: 'RUINS',
  }));
  assert.equal(calculateExpeditionFitClient(site, party).fitPercent, 84);
}

// These fixtures were calculated by the production SQL helper after the fix.
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/expedition_counter_fit_v2.json', import.meta.url)));
for (const fixture of fixtures) {
  const actual = calculateExpeditionFitClient(fixture.site, fixture.party);
  assert.equal(actual.fitPercent, fixture.expectedFit, fixture.partyName);
  assert.equal(actual.fitGrade, fixture.expectedGrade, fixture.partyName);
  assert.equal(actual.traceContribution, fixture.expectedTrace, fixture.partyName);
  assert.equal(calculateExpeditionFitClient(fixture.site, fixture.party.slice(0, 2)), null);
  assert.equal(calculateExpeditionFitClient(fixture.site, Array(3).fill(fixture.party[0])), null);
}
console.log('PASS: six elemental counters and SQL/client parity (110% earth team, 36% water team).');
