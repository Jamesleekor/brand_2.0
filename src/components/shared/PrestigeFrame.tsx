import type { CSSProperties, ReactNode } from 'react';

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

/** Nine-slice keeps decorative corners intact in narrow and tall student cards. */
export function PrestigeFrame({ border, children, className, compact = false }: PrestigeFrameProps) {
  if (!border) return <>{children}</>;
  const accent = accentFor(border);
  const style: CSSProperties = {
    borderColor: accent.edge,
    boxShadow: `0 0 16px ${accent.glow}, inset 0 0 10px ${accent.glow}`,
  };

  return (
    <div className={cn('relative isolate min-w-0 rounded-card-lg border-2', className)} style={style} data-prestige-border={border.itemUid}>
      <div className="relative z-10 h-full min-w-0">{children}</div>
      <div
        aria-hidden="true"
        className={cn('pointer-events-none absolute inset-0 z-20 border-transparent', compact ? 'border-[6px]' : 'border-[14px]')}
        style={{
          borderImageSource: `url(${JSON.stringify(border.resourceUrl)})`,
          borderImageSlice: '20%',
          borderImageWidth: compact ? '6px' : '14px',
          borderImageRepeat: 'stretch',
        }}
      />
    </div>
  );
}
