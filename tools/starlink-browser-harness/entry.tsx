import { createRoot } from 'react-dom/client';
import { StarlinkGame } from '../../src/features/arcade/games/starlink_04/ui/StarlinkGame';
import { createStarlinkRun, applyStarlinkEvent, advanceStarlinkRun } from '../../src/features/arcade/games/starlink_04/starlinkRuntime';
import { areStarlinkCellsAdjacent8 } from '../../src/features/arcade/games/starlink_04/starlinkBoard';

declare global { interface Window { __engine: unknown; __recorded: unknown[]; __exited: number } }
const params = new URLSearchParams(location.search);
window.__SEED = Number(params.get('seed') ?? 6059);
window.__recorded = [];
window.__exited = 0;
window.__engine = { createStarlinkRun, applyStarlinkEvent, advanceStarlinkRun, areStarlinkCellsAdjacent8 };
const bootstrap = { run_id: 4242, game_code: 'starlink_04', rule_version: 'v0.3', countdown_started_at: new Date().toISOString(), countdown_ends_at: new Date(Date.now() + 5000).toISOString(), schedule_seed: 123, config: {}, is_prerelease_test: false, run_context: 'STANDARD' as const };
createRoot(document.getElementById('root')!).render(
  <StarlinkGame bootstrap={bootstrap} myRank={null} myBestScore={1000} isRankingUpdating={false}
    onRecorded={(r, s) => { window.__recorded.push({ r, s }); }}
    onExit={() => { window.__exited += 1; }}
    onInlineError={(m) => { document.getElementById('err')!.textContent = m; }} />,
);
