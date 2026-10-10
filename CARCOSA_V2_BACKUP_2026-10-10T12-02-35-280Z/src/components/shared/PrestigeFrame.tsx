import type { CSSProperties, ReactNode } from 'react';

import { prestigeBorderArtwork, PRESTIGE_BORDER_ARTWORK } from '@/components/shared/prestigeBorderAssets';
import type { OwnedPrestigeBorder } from '@/hooks/usePrestigeBorders';
import { cn } from '@/lib/utils/cn';

type PrestigeFrameProps = {
  border: OwnedPrestigeBorder | null | undefined;
  children: ReactNode;
  className?: string;
  compact?: boolean;
};

function accentFor(border: OwnedPrestigeBorder) {
  const identity = `${border.itemUid} ${border.name}`.toLowerCase();
  if (/dragon|용|황금/.test(identity)) return { edge: '#FFD18A', glow: 'rgba(255,186,91,.38)' };
  if (/tree|forest|world|세계수|숲/.test(identity)) return { edge: '#91DBB1', glow: 'rgba(107,221,153,.30)' };
  return { edge: '#AECDF8', glow: 'rgba(117,190,255,.32)' };
}

/** The artwork is sliced so the large corner ornaments keep their shape on cards of different sizes. */
export function PrestigeFrame({ border, children, className, compact = false }: PrestigeFrameProps) {
  if (!border) return <>{children}</>;
  const accent = accentFor(border);
  const hasArtwork = Object.prototype.hasOwnProperty.call(PRESTIGE_BORDER_ARTWORK, border.itemUid);
  const imageUrl = prestigeBorderArtwork(border.itemUid, border.resourceUrl);
  const style: CSSProperties = {
    borderColor: accent.edge,
    boxShadow: `0 0 16px ${accent.glow}, inset 0 0 10px ${accent.glow}`,
  };

  return (
    <div className={cn('relative isolate min-w-0 rounded-card-lg border-2', hasArtwork && (compact ? 'px-1.5 py-1' : 'px-3 py-2'), className)} style={style} data-prestige-border={border.itemUid}>
      <div className="relative z-10 h-full min-w-0">{children}</div>
      <div
        aria-hidden="true"
        className={cn('pointer-events-none absolute inset-0 z-20 border-transparent', compact ? 'border-[12px]' : hasArtwork ? 'border-[26px]' : 'border-[14px]')}
        style={{
          borderImageSource: `url(${JSON.stringify(imageUrl)})`,
          borderImageSlice: hasArtwork ? '32% 24%' : '20%',
          borderImageWidth: hasArtwork ? (compact ? '12px' : '26px') : (compact ? '6px' : '14px'),
          borderImageRepeat: 'stretch',
        }}
      />
    </div>
  );
}
