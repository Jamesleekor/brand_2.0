import { previewFontUrl, runtimeFontUrl } from './fontAssetUrl';
import type { BrandFontCatalogEntry, BrandFontWeight } from './fontCatalog';

const runtimeFacePromises = new Map<string, Promise<void>>();
const previewPromises = new Map<string, Promise<void>>();

function assertBrowser() {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
    throw new Error('FontFace API unavailable');
  }
}

async function loadFace(family: string, url: string, weight: BrandFontWeight) {
  assertBrowser();
  const face = new FontFace(family, `url("${url}") format("woff2")`, {
    style: 'normal',
    weight: String(weight),
  });
  const loaded = await face.load();
  const fontSet = document.fonts as FontFaceSet & { add(face: FontFace): FontFaceSet };
  fontSet.add(loaded);
}

function loadRuntimeFace(entry: BrandFontCatalogEntry, weight: BrandFontWeight): Promise<void> {
  const key = `${entry.itemUid}:${weight}`;
  const cached = runtimeFacePromises.get(key);
  if (cached) return cached;

  const promise = loadFace(entry.cssFamily, runtimeFontUrl(entry, weight), weight);
  runtimeFacePromises.set(key, promise);
  promise.catch(() => runtimeFacePromises.delete(key));
  return promise;
}

/** Load every available weight for the selected theme font. */
export function loadRuntimeFont(entry: BrandFontCatalogEntry): Promise<void> {
  return Promise.all(entry.weights.map((weight) => loadRuntimeFace(entry, weight))).then(() => undefined);
}

/**
 * Load only the default full-glyph face.
 * Used by the free-text market preview so arbitrary Korean text is not limited
 * by the tiny fixed-text preview subset.
 */
export function loadRuntimePreviewFont(entry: BrandFontCatalogEntry): Promise<void> {
  return loadRuntimeFace(entry, entry.defaultWeight);
}

/** Load the tiny fixed-text subset used on market cards. */
export function loadPreviewFont(entry: BrandFontCatalogEntry): Promise<void> {
  const key = entry.itemUid;
  const cached = previewPromises.get(key);
  if (cached) return cached;

  const promise = loadFace(entry.previewFamily, previewFontUrl(entry), entry.defaultWeight);
  previewPromises.set(key, promise);
  promise.catch(() => previewPromises.delete(key));
  return promise;
}

export function clearFontLoaderCachesForTests() {
  runtimeFacePromises.clear();
  previewPromises.clear();
}
