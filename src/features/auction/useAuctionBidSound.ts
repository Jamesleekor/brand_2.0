import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveAuctionItem } from './types';

export function auctionBidSoundKey(item: LiveAuctionItem | null): string | null {
  if (!item?.top_bid) return null;
  return `${item.id}:${item.current_attempt}:${item.top_bid.bid_id}`;
}

export function useAuctionBidSound(item: LiveAuctionItem | null) {
  const contextRef = useRef<AudioContext | null>(null);
  const previousRef = useRef<{ itemId: number; attempt: number; key: string | null } | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const chime = useCallback((context: AudioContext) => {
    if (context.state !== 'running') return;
    const start = context.currentTime;
    // Short, warm two-note bid bell. No downloads, timers or server requests.
    [880, 1174.66].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = start + index * 0.065;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.09, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.23);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(at);
      oscillator.stop(at + 0.25);
    });
  }, []);

  const toggleSound = useCallback(async () => {
    if (enabled) { setEnabled(false); return; }
    try {
      const browser = window as typeof window & { webkitAudioContext?: typeof AudioContext };
      const AudioContextClass = browser.AudioContext ?? browser.webkitAudioContext;
      if (!AudioContextClass) throw new Error('이 브라우저는 입찰음을 지원하지 않습니다.');
      const context = contextRef.current ?? new AudioContextClass();
      contextRef.current = context;
      await context.resume();
      if (context.state !== 'running') throw new Error('소리 버튼을 다시 눌러주세요.');
      setAudioError(null);
      setEnabled(true);
      chime(context);
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : '소리를 켜지 못했습니다.');
      setEnabled(false);
    }
  }, [enabled, chime]);

  const itemId = item?.id ?? null;
  const attempt = item?.current_attempt ?? null;
  const key = auctionBidSoundKey(item);
  useEffect(() => {
    if (itemId === null || attempt === null) { previousRef.current = null; return; }
    const previous = previousRef.current;
    previousRef.current = { itemId, attempt, key };
    // Loading a page or moving to another item never replays an old bid.
    if (!previous || previous.itemId !== itemId || previous.attempt !== attempt || !key || previous.key === key) return;
    if (enabled && contextRef.current) chime(contextRef.current);
  }, [itemId, attempt, key, enabled, chime]);

  useEffect(() => () => {
    const context = contextRef.current;
    contextRef.current = null;
    if (context) void context.close().catch(() => {});
  }, []);

  return { enabled, audioError, toggleSound };
}
