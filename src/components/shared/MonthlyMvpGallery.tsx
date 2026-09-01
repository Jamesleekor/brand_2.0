import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils/cn';

type MvpPortrait = {
  month: string;
  name: string;
  imageUrl: string;
  accent: 'silver' | 'gold' | 'rose' | 'cyan';
  flip?: boolean;
};

export type MonthlyMvpGalleryVariant = 'login' | 'records';

const MVP_PORTRAITS: MvpPortrait[] = [
  {
    month: '3월',
    name: '김서영',
    imageUrl: 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/mvp/March_MVP.png',
    accent: 'silver',
  },
  {
    month: '4월',
    name: '류은우',
    imageUrl: 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/mvp/April_MVP.png',
    accent: 'gold',
  },
  {
    month: '5월',
    name: '한서현',
    imageUrl: 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/mvp/May_MVP.png',
    accent: 'rose',
    flip: true,
  },
  {
    month: '6월',
    name: '류은우',
    imageUrl: 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/mvp/June_MVP.png',
    accent: 'cyan',
  },
  {
    month: '7월',
    name: '김서영',
    imageUrl: 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/mvp/July_MVP.png',
    accent: 'gold',
  },
];

const MVP_ACCENT_CLASS: Record<MvpPortrait['accent'], string> = {
  silver: 'border-slate-300/30 hover:border-slate-200/60 hover:shadow-[0_12px_34px_rgba(160,190,220,0.20)]',
  gold: 'border-gold/35 hover:border-gold/70 hover:shadow-[0_12px_36px_rgba(255,217,61,0.22)]',
  rose: 'border-rose-400/35 hover:border-rose-300/65 hover:shadow-[0_12px_36px_rgba(244,63,94,0.20)]',
  cyan: 'border-crystal/35 hover:border-crystal/65 hover:shadow-[0_12px_36px_rgba(78,205,196,0.20)]',
};

export function MonthlyMvpGallery({ variant = 'records' }: { variant?: MonthlyMvpGalleryVariant }) {
  const [selected, setSelected] = useState<MvpPortrait | null>(null);
  const isLogin = variant === 'login';

  useEffect(() => {
    if (!selected) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected]);

  return (
    <section
      aria-labelledby={`monthly-mvp-heading-${variant}`}
      className={cn(
        'relative overflow-hidden',
        isLogin
          ? 'rounded-card-xl border border-gold/20 bg-[linear-gradient(145deg,rgba(255,217,61,0.065),rgba(177,151,252,0.075)_42%,rgba(15,11,26,0.76))] px-3 py-4 sm:px-4 sm:py-5 shadow-[0_18px_55px_rgba(0,0,0,0.30)]'
          : 'rounded-card-xl border border-gold/18 bg-bg-card/70 px-3 py-4 sm:px-4 sm:py-5',
      )}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/45 to-transparent" />
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.24em] sm:tracking-[0.30em] text-gold-200/85">
            CLASS LEGENDS · MONTHLY MVP
          </div>
          <h2 id={`monthly-mvp-heading-${variant}`} className={cn('mt-1 font-display font-black text-white', isLogin ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl')}>
            🏆 월간 MVP 명예전당
          </h2>
          <p className="mt-1 text-[10px] sm:text-xs font-bold text-text-muted">
            한 달을 대표한 최고의 모험가들
          </p>
        </div>
        {isLogin && (
          <div className="hidden sm:block shrink-0 rounded-pill border border-gold/25 bg-gold/10 px-3 py-1 text-[9px] font-black tracking-[0.12em] text-gold-100">
            HIGHEST HONOR
          </div>
        )}
      </div>

      <div className={cn('-mx-3 mt-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4 [scrollbar-width:thin] [scroll-snap-type:x_mandatory]', isLogin && 'mt-4')}>
        <div className="flex w-max gap-2.5 sm:gap-3 pr-3 sm:pr-4">
          {MVP_PORTRAITS.map((mvp) => (
            <button
              key={`${mvp.month}-${mvp.name}`}
              type="button"
              onClick={() => setSelected(mvp)}
              className={cn(
                'group relative shrink-0 overflow-hidden rounded-card-lg border bg-bg-deep text-left shadow-card transition duration-200 hover:-translate-y-1 hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 [scroll-snap-align:start]',
                isLogin ? 'w-[112px] sm:w-[128px] lg:w-[142px]' : 'w-[128px] sm:w-[148px] lg:w-[162px]',
                MVP_ACCENT_CLASS[mvp.accent],
              )}
              aria-label={`${mvp.month} MVP ${mvp.name} 크게 보기`}
            >
              <div className="relative aspect-[9/16] overflow-hidden bg-black">
                <img
                  src={mvp.imageUrl}
                  alt={`${mvp.month} MVP ${mvp.name}`}
                  className={cn(
                    'h-full w-full object-contain object-center transition-transform duration-300',
                    mvp.flip ? '-scale-x-100' : '',
                  )}
                  loading={isLogin ? 'eager' : 'lazy'}
                />
                <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/50 to-transparent" />
                <div className="absolute left-2 top-2 rounded-pill border border-white/20 bg-black/45 px-2.5 py-1 text-[9px] font-black tracking-[0.08em] text-white backdrop-blur-sm">
                  {mvp.month}
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-2.5 pb-2.5 pt-10 sm:px-3 sm:pb-3 sm:pt-12">
                  <div className="text-sm sm:text-[15px] font-black text-white">{mvp.name}</div>
                  <div className="mt-0.5 text-[8px] font-black tracking-[0.16em] text-white/65">MONTHLY MVP</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selected && <MvpLightbox mvp={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}


const LOGIN_MVP_LEFT = MVP_PORTRAITS.slice(0, 2);
const LOGIN_MVP_RIGHT = MVP_PORTRAITS.slice(2);

function repeatPortraits(items: MvpPortrait[], minimumItems: number) {
  const output: MvpPortrait[] = [];
  if (items.length === 0) return output;
  while (output.length < minimumItems) {
    output.push(...items);
  }
  return output;
}

/**
 * 로그인 데스크톱/크롬북 전용 월간 MVP 퍼레이드.
 * 본문 레이아웃을 밀지 않고 viewport 좌우에 고정되며,
 * 좌측은 위로 / 우측은 아래로 계속 흐른다.
 */
export function LoginMvpSideParade() {
  const [selected, setSelected] = useState<MvpPortrait | null>(null);

  useEffect(() => {
    if (!selected) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <style>{`
        /* ==========================================================
           Login MVP responsive system
           Primary target: 1366x768 Chromebook
           - < 640px: phone strips
           - 640~1023px: tablet strips
           - >= 1024px: left/right desktop parade
           - >= 1600px: large-desktop expansion
           ========================================================== */
        .brand-login-mvp-desktop { display: none; }
        .brand-login-mvp-mobile { display: block; }

        @keyframes brandMvpSideUp {
          from { transform: translateY(0); }
          to { transform: translateY(-50%); }
        }
        @keyframes brandMvpSideDown {
          from { transform: translateY(-50%); }
          to { transform: translateY(0); }
        }
        @keyframes brandMvpMobileLeft {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes brandMvpMobileRight {
          from { transform: translateX(-50%); }
          to { transform: translateX(0); }
        }

        .brand-mvp-side-track-up { animation: brandMvpSideUp 34s linear infinite; }
        .brand-mvp-side-track-down { animation: brandMvpSideDown 38s linear infinite; }
        .brand-mvp-mobile-left { animation: brandMvpMobileLeft 30s linear infinite; }
        .brand-mvp-mobile-right { animation: brandMvpMobileRight 34s linear infinite; }

        .brand-mvp-side-panel:hover .brand-mvp-side-track-up,
        .brand-mvp-side-panel:hover .brand-mvp-side-track-down,
        .brand-mvp-side-panel:focus-within .brand-mvp-side-track-up,
        .brand-mvp-side-panel:focus-within .brand-mvp-side-track-down,
        .brand-mvp-mobile-panel:hover .brand-mvp-mobile-left,
        .brand-mvp-mobile-panel:hover .brand-mvp-mobile-right,
        .brand-mvp-mobile-panel:focus-within .brand-mvp-mobile-left,
        .brand-mvp-mobile-panel:focus-within .brand-mvp-mobile-right {
          animation-play-state: paused;
        }

        /* Phone baseline: original images can never determine layout size. */
        .brand-mvp-mobile-tile {
          width: 72px;
          aspect-ratio: 9 / 16;
          height: auto;
          flex: 0 0 72px;
        }
        .brand-mvp-mobile-tile img,
        .brand-mvp-side-tile img {
          display: block;
          width: 100%;
          height: 100%;
          max-width: 100%;
          object-fit: contain;
          object-position: center center;
          background: #05050a;
        }

        /* Tablet: still top/bottom strips, but slightly larger than phone. */
        @media (min-width: 480px) {
          .brand-mvp-mobile-tile {
            width: 82px;
            aspect-ratio: 9 / 16;
            height: auto;
            flex-basis: 82px;
          }
        }
        @media (min-width: 640px) and (max-width: 1023px) {
          .brand-mvp-mobile-tile {
            width: 90px;
            aspect-ratio: 9 / 16;
            height: auto;
            flex-basis: 90px;
          }
        }

        /* Chromebook / compact desktop: 1366x768 is the reference viewport. */
        @media (min-width: 1024px) {
          .brand-login-mvp-desktop { display: block; }
          .brand-login-mvp-mobile { display: none !important; }
          .brand-mvp-side-panel {
            width: clamp(148px, 13vw, 190px);
            top: 12px;
            bottom: 12px;
          }
          .brand-mvp-side-panel-left { left: clamp(10px, 1.4vw, 22px); }
          .brand-mvp-side-panel-right { right: clamp(10px, 1.4vw, 22px); }
          .brand-mvp-side-tile {
            aspect-ratio: 9 / 16;
            height: auto;
          }
        }

        /* Large desktop: grow, but cap dimensions instead of following source image size. */
        @media (min-width: 1600px) {
          .brand-mvp-side-panel {
            width: clamp(210px, 12.5vw, 250px);
            top: 18px;
            bottom: 18px;
          }
          .brand-mvp-side-panel-left { left: clamp(18px, 2vw, 40px); }
          .brand-mvp-side-panel-right { right: clamp(18px, 2vw, 40px); }
          .brand-mvp-side-tile {
            aspect-ratio: 9 / 16;
            height: auto;
          }
        }

        /* Short-height Chromebook tuning. */
        @media (min-width: 1024px) and (max-height: 820px) {
          .brand-mvp-side-panel { top: 8px; bottom: 8px; }
          .brand-mvp-side-tile { aspect-ratio: 9 / 16; height: auto; }
          .brand-mvp-side-honor-label { font-size: 8px !important; padding: 4px 9px !important; }
        }

        @media (prefers-reduced-motion: reduce) {
          .brand-mvp-side-track-up,
          .brand-mvp-side-track-down,
          .brand-mvp-mobile-left,
          .brand-mvp-mobile-right {
            animation: none !important;
            transform: none !important;
          }
        }
      `}</style>

      <div className="brand-login-mvp-desktop pointer-events-none fixed inset-0 z-[80]" aria-hidden="false">
        <LoginMvpVerticalPanel side="left" items={LOGIN_MVP_LEFT} direction="up" onSelect={setSelected} />
        <LoginMvpVerticalPanel side="right" items={LOGIN_MVP_RIGHT} direction="down" onSelect={setSelected} />
      </div>

      {selected && <MvpLightbox mvp={selected} onClose={() => setSelected(null)} />}
    </>,
    document.body,
  );
}

function LoginMvpVerticalPanel({
  side,
  items,
  direction,
  onSelect,
}: {
  side: 'left' | 'right';
  items: MvpPortrait[];
  direction: 'up' | 'down';
  onSelect: (mvp: MvpPortrait) => void;
}) {
  const cycle = repeatPortraits(items, 4);
  const duplicated = [...cycle, ...cycle];

  return (
    <aside
      className={cn(
        'brand-mvp-side-panel pointer-events-auto fixed overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#090812]/90 shadow-[0_22px_60px_rgba(0,0,0,0.46)] backdrop-blur-sm',
        side === 'left' ? 'brand-mvp-side-panel-left' : 'brand-mvp-side-panel-right',
      )}
      aria-label={`${side === 'left' ? '왼쪽' : '오른쪽'} 월간 MVP 명예 퍼레이드`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-16 items-start justify-center bg-gradient-to-b from-[#090812] via-[#090812]/75 to-transparent pt-2.5">
        <div className="brand-mvp-side-honor-label rounded-pill border border-gold/25 bg-black/45 px-2.5 py-1 text-[8px] font-black tracking-[0.15em] text-gold-100 backdrop-blur-sm">
          MONTHLY MVP · HIGHEST HONOR
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-14 bg-gradient-to-t from-[#090812] to-transparent" />

      <div className={cn('will-change-transform', direction === 'up' ? 'brand-mvp-side-track-up' : 'brand-mvp-side-track-down')}>
        {duplicated.map((mvp, index) => (
          <LoginMvpPortraitTile key={`${side}-${mvp.month}-${mvp.name}-${index}`} mvp={mvp} onSelect={onSelect} />
        ))}
      </div>
    </aside>
  );
}

function LoginMvpPortraitTile({ mvp, onSelect }: { mvp: MvpPortrait; onSelect: (mvp: MvpPortrait) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mvp)}
      className={cn(
        'brand-mvp-side-tile group relative block w-full overflow-hidden border-b border-white/[0.07] bg-bg-deep text-left focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/70',
        MVP_ACCENT_CLASS[mvp.accent],
      )}
      aria-label={`${mvp.month} MVP ${mvp.name} 크게 보기`}
    >
      <div className="absolute inset-0">
        <img
          src={mvp.imageUrl}
          alt={`${mvp.month} MVP ${mvp.name}`}
          className={cn(mvp.flip && '-scale-x-100')}
          width={420}
          height={700}
          loading="eager"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/90" />
      <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-pill border border-white/20 bg-black/50 px-2.5 py-1 text-[9px] font-black tracking-[0.1em] text-white backdrop-blur-sm">
        {mvp.month}
      </div>
      <div className="absolute inset-x-0 bottom-0 px-2.5 pb-4 pt-12 text-center">
        <div className="text-[15px] font-black text-white drop-shadow-lg">{mvp.name}</div>
        <div className="mt-1 text-[8px] font-black tracking-[0.15em] text-white/65">MONTHLY MVP</div>
      </div>
    </button>
  );
}

/**
 * 1024px 미만 로그인 화면용 상/하 가로 퍼레이드.
 * 640~1023px는 tablet strip, 640px 미만은 phone strip 크기를 사용한다.
 */
export function LoginMvpMobileStrip({ position }: { position: 'top' | 'bottom' }) {
  const [selected, setSelected] = useState<MvpPortrait | null>(null);
  const items = position === 'top' ? LOGIN_MVP_LEFT : LOGIN_MVP_RIGHT;
  const cycle = repeatPortraits(items, position === 'top' ? 10 : 12);
  const duplicated = [...cycle, ...cycle];

  useEffect(() => {
    if (!selected) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected]);

  return (
    <>
      <section
        className="brand-login-mvp-mobile brand-mvp-mobile-panel relative z-10 w-full overflow-hidden border-y border-white/[0.07] bg-[#090812]/88 py-1.5 shadow-[0_12px_35px_rgba(0,0,0,0.28)]"
        aria-label={`${position === 'top' ? '상단' : '하단'} 월간 MVP 명예 퍼레이드`}
      >
        <div className="mb-1 flex items-center justify-center gap-2 px-3 text-center">
          <span className="text-[8px] font-black tracking-[0.16em] text-gold-100/80">MONTHLY MVP</span>
          <span className="text-[9px]" aria-hidden="true">🏆</span>
          <span className="text-[8px] font-black tracking-[0.1em] text-white/50">HIGHEST HONOR</span>
        </div>
        <div className={cn('flex w-max will-change-transform', position === 'top' ? 'brand-mvp-mobile-left' : 'brand-mvp-mobile-right')}>
          {duplicated.map((mvp, index) => (
            <button
              key={`${position}-${mvp.month}-${mvp.name}-${index}`}
              type="button"
              onClick={() => setSelected(mvp)}
              className="brand-mvp-mobile-tile group relative mx-1 shrink-0 overflow-hidden rounded-[9px] border border-white/10 bg-bg-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
              aria-label={`${mvp.month} MVP ${mvp.name} 크게 보기`}
            >
              <img src={mvp.imageUrl} alt={`${mvp.month} MVP ${mvp.name}`} className={cn(mvp.flip && '-scale-x-100')} loading="eager" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/90" />
              <div className="absolute left-1.5 top-1.5 rounded-pill border border-white/15 bg-black/50 px-1.5 py-0.5 text-[7px] font-black text-white">
                {mvp.month}
              </div>
              <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1.5 text-center text-[10px] font-black text-white">{mvp.name}</div>
            </button>
          ))}
        </div>
      </section>

      {selected && <MvpLightbox mvp={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function MvpLightbox({ mvp, onClose }: { mvp: MvpPortrait; onClose: () => void }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`${mvp.month} MVP ${mvp.name}`}
      onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative max-h-[92vh] w-full max-w-md overflow-hidden rounded-card-xl border border-white/[0.12] bg-bg-deep shadow-[0_30px_90px_rgba(0,0,0,0.65)]"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/[0.55] text-lg font-black text-white backdrop-blur-sm transition hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
          aria-label="MVP 이미지 닫기"
        >
          ×
        </button>
        <div className="relative max-h-[78vh] overflow-hidden bg-black">
          <img
            src={mvp.imageUrl}
            alt={`${mvp.month} MVP ${mvp.name}`}
            className={cn('max-h-[78vh] w-full object-contain', mvp.flip && '-scale-x-100')}
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-white/10 px-4 py-3.5">
          <div>
            <div className="text-[9px] font-black tracking-[0.18em] text-bv-200/75">MONTHLY MVP · {mvp.month}</div>
            <div className="mt-0.5 text-base font-black text-white">{mvp.name}</div>
          </div>
          <div className="text-2xl" aria-hidden="true">🏆</div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
