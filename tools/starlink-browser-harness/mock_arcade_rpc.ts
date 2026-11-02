// Browser harness only. Simulates the two Starlink RPCs with the SAME engine the
// server uses (replayStarlinkRun), so the harness can assert that what the
// component submits replays to the score the student saw.
import { replayStarlinkRun } from '../../src/features/arcade/games/starlink_04/starlinkRuntime';
import { STARLINK_V03_RULES } from '../../src/features/arcade/games/starlink_04/starlinkRules';

declare global { interface Window { __SEED: number; __SUBMISSIONS: unknown[]; __BEGINS: number; __FAIL_NEXT_SUBMIT?: boolean } }
window.__SUBMISSIONS = [];
window.__BEGINS = 0;
const nonce = '7f3d1c2e-9a41-4b6c-8f0a-2d5e6b7c8d9e';

export function arcadeErrorMessage(e: { error: string }) { return e.error; }
export const arcadeStudentRpc = {
  beginStarlinkRun: async (_c: unknown, input: { p_run_id: number }) => {
    window.__BEGINS += 1;
    await new Promise((r) => setTimeout(r, 40));
    return { success: true, data: { run_id: input.p_run_id, play_started_at: new Date().toISOString(), config: { ...STARLINK_V03_RULES, game_code: 'starlink_04', countdown_ms: 5000 }, gameplay_seed: window.__SEED, run_nonce: nonce, run_context: 'STANDARD', seed_source: 'STANDARD_RANDOM' } };
  },
  submitStarlinkRun: async (_c: unknown, input: { p_run_id: number; p_run_nonce: string; p_input_events: any[]; p_client_end_wall_ms: number }) => {
    window.__SUBMISSIONS.push(JSON.parse(JSON.stringify(input)));
    await new Promise((r) => setTimeout(r, 60));
    if (window.__FAIL_NEXT_SUBMIT) { window.__FAIL_NEXT_SUBMIT = false; throw new Error('network down (simulated)'); }
    if (input.p_run_nonce !== nonce) return { success: false, type: 'SERVER', error: 'nonce', code: 'P0285' };
    const r = replayStarlinkRun(window.__SEED, input.p_input_events, input.p_client_end_wall_ms);
    return { success: true, data: { accepted: true, run_id: input.p_run_id, official_score: r.official_score, official_duration_ms: 60000, stats: { max_combo: r.stats.maxCombo }, run_context: 'STANDARD' } };
  },
};
