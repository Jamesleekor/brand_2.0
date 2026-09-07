import type { BrandFontCatalogEntry, BrandFontWeight } from './fontCatalog';
function baseRoot() { const raw = (import.meta.env.VITE_FONT_ASSET_BASE as string | undefined) ?? '/fonts'; return raw.replace(/\/$/, ''); }
export function runtimeFontUrl(entry: BrandFontCatalogEntry, weight: BrandFontWeight) { return `${baseRoot()}/${entry.slug}/${weight}.woff2`; }
export function previewFontUrl(entry: BrandFontCatalogEntry) { return `${baseRoot()}/${entry.slug}/preview.woff2`; }
