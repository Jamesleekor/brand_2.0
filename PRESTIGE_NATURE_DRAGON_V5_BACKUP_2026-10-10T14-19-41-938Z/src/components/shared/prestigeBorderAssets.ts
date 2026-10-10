/** Public artwork for the three 2026 luxury gallery prestige borders. */
export const PRESTIGE_BORDER_ARTWORK: Record<string, string> = {
  PRESTIGE_MOON_2026: 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/main/expedition/prestige/prestige_border_carcosa_moonglass.webp',
  PRESTIGE_TREE_2026: 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/main/expedition/prestige/prestige_border_worldtree_emerald.png',
  PRESTIGE_DRAGON_2026: 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/main/expedition/prestige/prestige_border_golden_dragon.png',
};

/** Other prestige borders continue to use the asset URL supplied by the catalog. */
export function prestigeBorderArtwork(itemUid: string, catalogUrl: string): string {
  return PRESTIGE_BORDER_ARTWORK[itemUid] ?? catalogUrl;
}
