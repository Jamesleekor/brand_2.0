import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils/cn';

import type { RaidVisualConfigV1, RaidVisualPlaybackState } from './raidVisualTypes';

const ANIMATED_IMAGE_RE = /\.(?:webp|gif|apng)(?:$|[?#])/i;

function cleanUrl(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function MediaLayer({
  url,
  bossName,
  poster,
  opacity,
  transitionMs,
  onReady,
  onError,
}: {
  url: string;
  bossName: string;
  poster: string | null;
  opacity: number;
  transitionMs: number;
  onReady: () => void;
  onError: () => void;
}) {
  const animatedImage = ANIMATED_IMAGE_RE.test(url);
  const style = {
    opacity,
    transitionDuration: `${transitionMs}ms`,
  };

  if (animatedImage) {
    return (
      <img
        src={url}
        alt={bossName}
        draggable={false}
        onLoad={onReady}
        onError={onError}
        style={style}
        className="absolute inset-0 h-full w-full object-cover transition-opacity ease-out"
      />
    );
  }

  return (
    <video
      src={url}
      poster={poster || undefined}
      muted
      loop
      autoPlay
      playsInline
      preload="auto"
      onCanPlay={onReady}
      onError={onError}
      style={style}
      className="absolute inset-0 h-full w-full object-cover transition-opacity ease-out"
    />
  );
}

export function RaidBossVisualStage({
  bossName,
  imageUrl,
  idleVideoUrl,
  visual,
  playbackState,
  className,
}: {
  bossName: string;
  imageUrl: string | null | undefined;
  idleVideoUrl: string | null | undefined;
  visual: RaidVisualConfigV1 | null | undefined;
  playbackState: RaidVisualPlaybackState;
  className?: string;
}) {
  const image = cleanUrl(imageUrl);
  const idle = cleanUrl(idleVideoUrl);
  const action = cleanUrl(visual?.media?.action_video_url);
  const state = cleanUrl(visual?.media?.state_video_url);
  const configuredCrossfadeMs = Number(visual?.media?.crossfade_ms ?? 240);
  const crossfadeMs = Number.isFinite(configuredCrossfadeMs)
    ? Math.max(0, Math.min(2000, configuredCrossfadeMs))
    : 240;
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [incomingUrl, setIncomingUrl] = useState<string | null>(null);
  const [incomingVisible, setIncomingVisible] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const configuredUrls = `${idle ?? ''}|${action ?? ''}|${state ?? ''}`;
  useEffect(() => {
    setFailedUrls(new Set());
  }, [configuredUrls]);

  const targetUrl = useMemo(() => {
    const requested =
      playbackState === 'ACTION' ? action : playbackState === 'STATE' ? state : idle;
    if (requested && !failedUrls.has(requested)) return requested;
    if (idle && !failedUrls.has(idle)) return idle;
    return null;
  }, [action, failedUrls, idle, playbackState, state]);

  useEffect(() => {
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }

    if (targetUrl === activeUrl) {
      setIncomingUrl(null);
      setIncomingVisible(false);
      setFadingOut(false);
      return;
    }

    if (!targetUrl) {
      setIncomingUrl(null);
      setIncomingVisible(false);
      setFadingOut(true);
      transitionTimerRef.current = setTimeout(() => {
        setActiveUrl(null);
        setFadingOut(false);
      }, crossfadeMs);
      return;
    }

    setIncomingUrl(targetUrl);
    setIncomingVisible(false);
    setFadingOut(false);

    return () => {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
    };
  }, [activeUrl, crossfadeMs, targetUrl]);

  useEffect(() => () => {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
  }, []);

  const markFailed = (url: string) => {
    setFailedUrls((current) => {
      const next = new Set(current);
      next.add(url);
      return next;
    });
    if (activeUrl === url) setActiveUrl(null);
    if (incomingUrl === url) {
      setIncomingUrl(null);
      setIncomingVisible(false);
    }
  };

  const revealIncoming = (url: string) => {
    if (incomingUrl !== url) return;
    requestAnimationFrame(() => {
      setIncomingVisible(true);
      transitionTimerRef.current = setTimeout(() => {
        setActiveUrl(url);
        setIncomingUrl(null);
        setIncomingVisible(false);
      }, crossfadeMs);
    });
  };

  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden="true">
      {image ? (
        <img
          src={image}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_center,rgba(88,28,135,0.35),rgba(2,6,23,1)_60%)] text-8xl">
          👾
        </div>
      )}

      {activeUrl && (
        <MediaLayer
          key={activeUrl}
          url={activeUrl}
          bossName={bossName}
          poster={image}
          opacity={incomingVisible || fadingOut ? 0 : 1}
          transitionMs={crossfadeMs}
          onReady={() => {}}
          onError={() => markFailed(activeUrl)}
        />
      )}

      {incomingUrl && (
        <MediaLayer
          key={incomingUrl}
          url={incomingUrl}
          bossName={bossName}
          poster={image}
          opacity={incomingVisible ? 1 : 0}
          transitionMs={crossfadeMs}
          onReady={() => revealIncoming(incomingUrl)}
          onError={() => markFailed(incomingUrl)}
        />
      )}
    </div>
  );
}
