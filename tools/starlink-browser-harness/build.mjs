// Bundles the REAL StarlinkGame component with mocked RPC/supabase modules.
// usage: NODE_PATH=<dir containing esbuild/react> node build.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const mocks = { '@/lib/rpc/arcade_rpc': path.join(here, 'mock_arcade_rpc.ts'), '@/lib/supabase/client': path.join(here, 'mock_supabase_client.ts') };
await esbuild.build({
  entryPoints: [path.join(here, 'entry.tsx')], bundle: true, outfile: path.join(here, 'bundle.js'), format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' }, nodePaths: (process.env.NODE_PATH || '').split(':').filter(Boolean), logLevel: 'warning',
  plugins: [{ name: 'mock-alias', setup(b) { b.onResolve({ filter: /^@\// }, (args) => mocks[args.path] ? { path: mocks[args.path] } : { path: path.join(here, '../../src', args.path.slice(2)) }); } }],
});
console.log('bundle ok');
