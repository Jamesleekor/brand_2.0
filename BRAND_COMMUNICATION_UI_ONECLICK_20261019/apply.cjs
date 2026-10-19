const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = b => crypto.createHash('sha256').update(b.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')).digest('hex');
const entries = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const isProject = root => {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name === 'brand-2.0-frontend'; } catch { return false; }
};
const candidates = process.argv[2] ? [path.resolve(process.argv[2])] : [__dirname, path.dirname(__dirname), process.cwd()];
const root = candidates.find(isProject);
if (!root) { console.error('[ERROR] Place this patch folder inside the project folder, then run APPLY.cmd.'); process.exit(1); }
let backup;
let written = [];
try {
  const pending = [];
  for (const entry of entries) {
    const source = path.join(__dirname, 'payload', entry.path);
    const target = path.join(root, entry.path);
    const next = fs.readFileSync(source);
    if (hash(next) !== entry.after) throw new Error('Patch payload is damaged: ' + entry.path);
    const previous = fs.existsSync(target) ? fs.readFileSync(target) : null;
    const current = previous === null ? null : hash(previous);
    if (current === entry.after) continue;
    if (current !== entry.before) throw new Error('Source differs from the patch baseline; no files changed: ' + entry.path);
    pending.push({ ...entry, target, previous, next });
  }
  if (!pending.length) { console.log('[OK] Already applied.'); process.exit(0); }
  backup = path.join(root, 'brand-patch-backups', 'communication-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex'));
  fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(backup, 'restore-info.json'), JSON.stringify(pending.map(e => ({ path: e.path, existed: e.previous !== null })), null, 2));
  for (const entry of pending) {
    if (entry.previous !== null) {
      const dest = path.join(backup, entry.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.previous);
    }
  }
  for (const entry of pending) {
    fs.mkdirSync(path.dirname(entry.target), { recursive: true });
    written.push(entry);
    fs.writeFileSync(entry.target, entry.next);
    if (hash(fs.readFileSync(entry.target)) !== entry.after) throw new Error('Write verification failed: ' + entry.path);
    console.log('[OK] ' + entry.path);
  }
  console.log('[OK] Applied. Backup: ' + backup);
  console.log('Next: run npm run build in your project folder.');
} catch (error) {
  let rollbackFailed = false;
  for (const entry of [...written].reverse()) {
    try {
      if (entry.previous !== null) fs.writeFileSync(entry.target, entry.previous);
      else fs.unlinkSync(entry.target);
    } catch (restoreError) { rollbackFailed = true; console.error('[RESTORE ERROR] ' + entry.path + ': ' + restoreError.message); }
  }
  console.error('[ERROR] ' + error.message);
  if (written.length) console.error(rollbackFailed ? 'Restore originals from backup: ' + backup : 'Original files restored.');
  process.exitCode = 1;
}
