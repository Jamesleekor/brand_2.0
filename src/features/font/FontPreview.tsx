import { useEffect, useRef, useState } from 'react';
import { getFontCatalogEntry } from './fontCatalog';
import { loadPreviewFont, loadRuntimePreviewFont } from './fontLoader';

type FontPreviewMode = 'subset' | 'runtime';

export function FontPreview({
  itemUid,
  text,
  className = '',
  mode = 'subset',
}: {
  itemUid: string;
  text?: string;
  className?: string;
  mode?: FontPreviewMode;
}) {
  const entry = getFontCatalogEntry(itemUid);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((row) => row.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [itemUid]);

  useEffect(() => {
    let live = true;
    setReady(false);
    if (!entry || !nearViewport) return () => { live = false; };

    const load = mode === 'runtime' ? loadRuntimePreviewFont(entry) : loadPreviewFont(entry);
    void load
      .then(() => { if (live) setReady(true); })
      .catch(() => { if (live) setReady(false); });

    return () => { live = false; };
  }, [entry?.itemUid, nearViewport, mode]);

  const content = text ?? entry?.previewText ?? '나의 브랜드를 꾸며 보세요!';
  const family = mode === 'runtime' ? entry?.cssFamily : entry?.previewFamily;

  return (
    <div
      ref={hostRef}
      className={className}
      style={ready && family ? { fontFamily: `'${family}', var(--font-system-family)` } : undefined}
    >
      {content}
    </div>
  );
}
