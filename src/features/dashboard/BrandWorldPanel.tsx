import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import type { TierThreshold } from '@/constants/tier_thresholds';
import { formatNumber } from '@/lib/utils/format';
import type { Tier } from '@/types/database_types';
import {
  getBrandWorldMap,
  getBrandWorldNode,
} from './brand_world_config';

interface BrandWorldSummaryButtonProps {
  tier: Tier;
  currentBv: number;
  nextTier: TierThreshold | null;
  isOpen: boolean;
  onToggle: () => void;
}

export function BrandWorldSummaryButton({ tier, currentBv, nextTier, isOpen, onToggle }: BrandWorldSummaryButtonProps) {
  const node = getBrandWorldNode(tier);
  const remaining = nextTier ? Math.max(0, nextTier.bvFrom - currentBv) : 0;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative z-10 mx-4 flex w-[calc(100%-32px)] items-center justify-between gap-3 rounded-card-lg border bg-gradient-to-r from-slate-950/80 via-indigo-950/70 to-slate-950/80 px-4 py-3 text-left shadow-card backdrop-blur-card transition lg:mx-0 lg:w-full ${isOpen ? 'border-cyan-200/40 rounded-b-none' : 'mb-2 border-cyan-300/20 hover:border-cyan-200/35'}`}
      aria-expanded={isOpen}
      aria-controls="brand-world-inline-panel"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-card-md border border-cyan-200/15 bg-cyan-300/10 text-xl">🌍</div>
        <div className="min-w-0">
          <div className="text-xs font-black tracking-[0.13em] text-cyan-100">BRAND WORLD</div>
          <div className="mt-0.5 truncate text-2xs font-bold text-slate-300">
            {node.regionLabel}{node.locationLabel !== node.regionLabel ? ` · ${node.locationLabel}` : ''} · {tier}
            {nextTier ? ` · 다음 티어까지 ${formatNumber(remaining)} BV` : ' · 최종 티어 도달'}
          </div>
        </div>
      </div>
      <span className="flex-none text-sm font-black text-cyan-100">{isOpen ? '접기 ˄' : '펼치기 ˅'}</span>
    </button>
  );
}

interface BrandWorldPanelProps {
  isOpen: boolean;
  onClose: () => void;
  tier: Tier;
  currentBv: number;
  nextTier: TierThreshold | null;
  achievementsEarned: number;
  achievementsTotal: number;
  studentName: string | null;
  brandName: string | null;
  markerAvatarUrl: string | null;
  markerEmoji: string | null;
}

export function BrandWorldPanel({
  isOpen,
  tier,
  studentName,
  brandName,
  markerAvatarUrl,
  markerEmoji,
}: BrandWorldPanelProps) {
  const [markerImageFailed, setMarkerImageFailed] = useState(false);
  const node = useMemo(() => getBrandWorldNode(tier), [tier]);
  const map = useMemo(() => getBrandWorldMap(tier), [tier]);
  const initial = (brandName?.trim() || studentName?.trim() || '?').slice(0, 1);

  useEffect(() => {
    setMarkerImageFailed(false);
  }, [markerAvatarUrl, tier]);

  const marker = !markerImageFailed && markerAvatarUrl ? (
    <img src={markerAvatarUrl} alt="내 위치" className="h-full w-full object-cover" onError={() => setMarkerImageFailed(true)} />
  ) : markerEmoji ? (
    <span className="text-xl leading-none">{markerEmoji}</span>
  ) : (
    <span className="text-sm font-black text-slate-950">{initial}</span>
  );

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.section
          id="brand-world-inline-panel"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="relative z-10 mx-4 mb-3 overflow-hidden rounded-b-[22px] border border-t-0 border-cyan-200/25 bg-[#090d18]/90 shadow-card backdrop-blur-xl lg:mx-0"
        >
          <div className="p-2.5 sm:p-3 lg:p-4">
            <div className="overflow-hidden rounded-[18px] border border-cyan-200/15 bg-slate-950/80 shadow-inner">
              <div className="relative w-full">
                <motion.img
                  key={map.id}
                  src={map.url}
                  alt={map.alt}
                  initial={{ opacity: 0.35, scale: 0.995 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="block h-auto w-full object-contain"
                  draggable={false}
                />

                <motion.div
                  key={tier}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${node.xPct}%`, top: `${node.yPct}%` }}
                  aria-label={`현재 위치 ${node.regionLabel}, ${node.locationLabel}, ${tier}`}
                >
                  <div className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border border-cyan-200/40 bg-cyan-300/10" />
                  <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-[3px] border-white bg-cyan-200 shadow-[0_0_24px_rgba(103,232,249,0.8)]">{marker}</div>
                  <div className="absolute left-1/2 top-[calc(100%+5px)] -translate-x-1/2 whitespace-nowrap rounded-pill border border-white/15 bg-slate-950/90 px-2 py-1 text-[9px] font-black text-white shadow-lg">HERE · {tier}</div>
                </motion.div>
              </div>
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
