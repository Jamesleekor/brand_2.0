import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const outDir = resolve('.starlink-test-build');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const tscPath = process.env.TSC_PATH ? resolve(process.env.TSC_PATH) : resolve('node_modules/typescript/bin/tsc');
const compile = spawnSync(process.execPath, [tscPath, '-p', 'tsconfig.starlink-tests.json'], {
  stdio: 'inherit',
});
if (compile.status !== 0) process.exit(compile.status ?? 1);

writeFileSync(resolve(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const runner = resolve(outDir, 'src/features/arcade/games/starlink_04/tests/run-tests.js');
const execute = spawnSync(process.execPath, [runner], { stdio: 'inherit' });
process.exit(execute.status ?? 1);
