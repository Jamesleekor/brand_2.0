import './phase2_rules.test';
import './phase3_state_machine.test';
import './phase4_basic_ai.test';
import './phase5_search_safety.test';
import './phase5_tazza.test';
import { runRegisteredTests } from './testHarness';

void runRegisteredTests().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
