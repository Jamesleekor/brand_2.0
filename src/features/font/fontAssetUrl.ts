import type { BrandFontCatalogEntry, BrandFontWeight } from './fontCatalog';

function baseRoot() {
  const configured = (import.meta.env.VITE_FONT_ASSET_BASE as string | undefined)?.trim();
  if (configured) return configured.replace(/\/$/, '');

  // Vite/GitHub Pages serves public assets under BASE_URL (e.g. /brand_2.0/).
  // Using /fonts would incorrectly point at the domain root in production.
  const appBase = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${appBase}/fonts`;
}

export function runtimeFontUrl(entry: BrandFontCatalogEntry, weight: BrandFontWeight) {
  return `${baseRoot()}/${entry.slug}/${weight}.woff2`;
}

export function previewFontUrl(entry: BrandFontCatalogEntry) {
  return `${baseRoot()}/${entry.slug}/preview.woff2`;
}
