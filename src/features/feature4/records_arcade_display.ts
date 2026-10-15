import type { HallOfGloryEntry } from '@/lib/rpc/records_history_rpc';

/** Presentation only: historical identities, scores and snapshot data remain untouched. */
export function arcadeKoreanText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/Focus\s*\+\s*Reaction\s*\+\s*Combo/gi, '집중 반응')
    .replace(/Pure\s+Reaction\s+Speed/gi, '순수 반응 속도')
    .replace(/순수 반응속도/g, '순수 반응 속도')
    .replace(/FINALIZED/gi, '공인기록')
    .replace(/TOP\s*(\d+)/gi, '상위 $1위');
}

export function arcadeGameLabel(entry: HallOfGloryEntry): string {
  const code = String(entry.metadata?.game_code ?? '');
  if (code === 'focus_reaction_01' || entry.record_type.endsWith('__focus_reaction_01')) return '집중 반응';
  if (code === 'pure_reaction_02' || entry.record_type.endsWith('__pure_reaction_02')) return '순수 반응 속도';
  const name = entry.metadata?.game_name;
  return arcadeKoreanText(typeof name === 'string' ? name : entry.title.replace(/\s*역대 최고 점수$/, ''));
}

export function arcadeRecordGroups(entries: HallOfGloryEntry[]): HallOfGloryEntry[][] {
  const groups = new Map<string, HallOfGloryEntry[]>();
  for (const entry of entries) {
    const rows = groups.get(entry.record_type) ?? [];
    rows.push(entry);
    groups.set(entry.record_type, rows);
  }
  return [...groups.values()]
    .map(rows => [...rows].sort((a, b) => (a.rank_position ?? Infinity) - (b.rank_position ?? Infinity) || a.sort_order - b.sort_order || a.id - b.id))
    .sort((a, b) => a[0].sort_order - b[0].sort_order || a[0].record_type.localeCompare(b[0].record_type));
}
