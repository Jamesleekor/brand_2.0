import { getFontCatalogEntry } from './fontCatalog';
import { loadRuntimeFont } from './fontLoader';
const SYSTEM_STACK = "'Pretendard Variable', 'Pretendard', 'Nunito', -apple-system, sans-serif";
let generation = 0;
export function resetThemeFont() { generation += 1; if (typeof document === 'undefined') return; document.documentElement.style.setProperty('--font-theme-family', SYSTEM_STACK); document.documentElement.removeAttribute('data-brand-font'); }
export async function applyThemeFont(itemUid: string | null | undefined) {
  const myGeneration = ++generation; const entry = getFontCatalogEntry(itemUid);
  if (!entry) { resetThemeFont(); return { applied: false as const, reason: 'default' as const }; }
  try { await loadRuntimeFont(entry); } catch (error) { if (myGeneration === generation) resetThemeFont(); return { applied: false as const, reason: 'load-error' as const, error }; }
  if (myGeneration !== generation || typeof document === 'undefined') return { applied: false as const, reason: 'superseded' as const };
  document.documentElement.style.setProperty('--font-theme-family', `'${entry.cssFamily}', ${SYSTEM_STACK}`); document.documentElement.dataset.brandFont = entry.itemUid;
  return { applied: true as const, itemUid: entry.itemUid };
}
