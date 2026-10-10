const LOCAL_PRESTIGE_ASSETS = `${import.meta.env.BASE_URL}prestige-borders/composable-v7/`;
const LOCAL_CARCOSA_ASSETS = `${import.meta.env.BASE_URL}prestige-borders/carcosa-v2/`;

/** Public artwork for the three 2026 luxury gallery prestige borders. */
export const PRESTIGE_BORDER_ARTWORK: Record<string, string> = {
  PRESTIGE_MOON_2026: `${LOCAL_CARCOSA_ASSETS}prestige_border_carcosa_moonglass.webp`,
  PRESTIGE_TREE_2026: `${LOCAL_PRESTIGE_ASSETS}prestige_border_worldtree_ornament_v4.webp`,
  PRESTIGE_DRAGON_2026: `${LOCAL_PRESTIGE_ASSETS}prestige_border_golden_dragon_ornament_v4.webp`,
};

/** Other prestige borders continue to use the asset URL supplied by the catalog. */
export function prestigeBorderArtwork(itemUid: string, catalogUrl: string): string {
  return PRESTIGE_BORDER_ARTWORK[itemUid] ?? catalogUrl;
}
