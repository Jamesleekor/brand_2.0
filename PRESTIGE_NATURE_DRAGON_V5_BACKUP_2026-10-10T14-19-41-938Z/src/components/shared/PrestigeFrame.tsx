import type { CSSProperties, ReactNode } from 'react';

import { prestigeBorderArtwork, PRESTIGE_BORDER_ARTWORK } from '@/components/shared/prestigeBorderAssets';
import type { OwnedPrestigeBorder } from '@/hooks/usePrestigeBorders';
import { cn } from '@/lib/utils/cn';
import './prestigeFrameCarcosa.css';

export type PrestigeFrameVariant =
  | 'friend' | 'guild' | 'rankingChampion' | 'rankingPodium'
  | 'rankingElite' | 'rankingTopTen' | 'rankingStandard'
  | 'raidLobby' | 'raidBroadcast';

type PrestigeFrameProps = {
  border: OwnedPrestigeBorder | null | undefined;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  variant?: PrestigeFrameVariant;
};

const LOCAL_CARCOSA_ASSETS = `${import.meta.env.BASE_URL}prestige-borders/carcosa-v2/`;
const MOON_ORNAMENT_URL = 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/main/expedition/prestige/prestige_border_carcosa_moon_ornament_v2.webp';

function accentFor(border: OwnedPrestigeBorder) {
  const identity = `${border.itemUid} ${border.name}`.toLowerCase();
  if (/dragon|용|황금/.test(identity)) return { edge: '#FFD18A', glow: 'rgba(255,186,91,.38)' };
  if (/tree|forest|world|세계수|숲/.test(identity)) return { edge: '#91DBB1', glow: 'rgba(107,221,153,.30)' };
  return { edge: '#AECDF8', glow: 'rgba(117,190,255,.32)' };
}

/** Independent rails and ornaments retain their aspect ratio at every card width. */
export function PrestigeFrame({ border, children, className, compact = false, variant }: PrestigeFrameProps) {
  if (!border) return <>{children}</>;

  if (border.itemUid === 'PRESTIGE_MOON_2026') {
    const frameVariant = variant ?? (compact ? 'raidLobby' : 'friend');
    const assetStyles = {
      '--carcosa-horizontal': `url("${LOCAL_CARCOSA_ASSETS}prestige_border_carcosa_glass_horizontal_v2.webp")`,
      '--carcosa-vertical': `url("${LOCAL_CARCOSA_ASSETS}prestige_border_carcosa_glass_vertical_v2.webp")`,
      '--carcosa-orb': `url("${LOCAL_CARCOSA_ASSETS}prestige_border_carcosa_orb_corner_v2.webp")`,
    } as CSSProperties;
    return (
      <div className={cn('carcosa-frame relative isolate min-w-0', className)} data-prestige-border={border.itemUid} data-carcosa-variant={frameVariant} style={assetStyles}>
        <div className="carcosa-frame__content relative z-10 h-full min-w-0">{children}</div>
        <div className="carcosa-frame__rail carcosa-frame__rail--top" aria-hidden="true" />
        <div className="carcosa-frame__rail carcosa-frame__rail--bottom" aria-hidden="true" />
        <div className="carcosa-frame__rail carcosa-frame__rail--left" aria-hidden="true" />
        <div className="carcosa-frame__rail carcosa-frame__rail--right" aria-hidden="true" />
        <img className="carcosa-frame__ornament carcosa-frame__ornament--moon" aria-hidden="true" alt="" src={MOON_ORNAMENT_URL} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = `${LOCAL_CARCOSA_ASSETS}prestige_border_carcosa_moon_ornament_v2.webp`; }} />
        <span className="carcosa-frame__ornament carcosa-frame__ornament--orb" aria-hidden="true" />
      </div>
    );
  }

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
      <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 z-20 border-transparent', compact ? 'border-[12px]' : hasArtwork ? 'border-[26px]' : 'border-[14px]')}
        style={{
          borderImageSource: `url(${JSON.stringify(imageUrl)})`,
          borderImageSlice: hasArtwork ? '32% 24%' : '20%',
          borderImageWidth: hasArtwork ? (compact ? '12px' : '26px') : (compact ? '6px' : '14px'),
          borderImageRepeat: 'stretch',
        }} />
    </div>
  );
}
