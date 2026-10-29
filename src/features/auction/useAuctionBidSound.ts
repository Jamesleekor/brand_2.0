// AUCTION_SFX_6_CUES_20261029
// 교사 경매 중계 화면 전용. 모든 판정은 이미 수신한 경매 상태로 수행하며,
// 효과음 때문에 별도 RPC / Realtime 구독을 만들지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveAuctionItem } from './types';

const AUCTION_SFX_ROOT = 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/sound/';
const AUCTION_SFX = {
  bidSmall: AUCTION_SFX_ROOT + 'Auction_sfx_coin-clatter.mp3',
  bidMedium: AUCTION_SFX_ROOT + 'Auction_sfx_coin-spill.mp3',
  bidHigh: AUCTION_SFX_ROOT + 'Auction_sfx_coin-shower.mp3',
  newProduct: AUCTION_SFX_ROOT + 'Auction_sfx_new_product.mp3',
  sold: AUCTION_SFX_ROOT + 'Auction_sfx_bid-success.mp3',
  countdown: AUCTION_SFX_ROOT + 'dragon-studio-slow-cinematic-clock-ticking-405471.mp3',
} as const;
type AuctionCue = keyof typeof AUCTION_SFX;

export function auctionBidSoundKey(item: LiveAuctionItem | null): string | null {
  if (!item?.top_bid) return null;
  return String(item.id) + ':' + String(item.current_attempt) + ':' + String(item.top_bid.bid_id);
}

/** 입찰 차액이 아닌 실제 최고 입찰가(단위: GOLD) 기준. */
export function auctionBidCue(amount: number): 'bidSmall' | 'bidMedium' | 'bidHigh' {
  if (amount >= 4000) return 'bidHigh';
  if (amount >= 1000) return 'bidMedium';
  return 'bidSmall';
}

type AuctionSoundOptions = {
  auctionId: number | null;
  item: LiveAuctionItem | null;
  items: LiveAuctionItem[];
  remainingSeconds: number;
  paused: boolean;
  applying: boolean;
  isStateDelayed: boolean;
  ready: boolean;
};

type SoundSnapshot = {
  auctionId: number | null;
  itemId: number | null;
  attempt: number | null;
  bidKey: string | null;
  soldKeys: Set<string>;
};

/**
 * 현재 스냅샷을 먼저 기준선으로 삼으므로 새로고침/화면 최초 진입 시 과거 입찰·낙찰음은 재생하지 않는다.
 * 입찰·낙찰의 새 변화는 서버 폴링에서 감지한다. 소리를 꺼둔 동안의 이벤트도 나중에 몰아서 재생하지 않는다.
 */
export function useAuctionBidSound({
  auctionId,
  item,
  items,
  remainingSeconds,
  paused,
  applying,
  isStateDelayed,
  ready,
}: AuctionSoundOptions) {
  const [enabled, setEnabled] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const soundsRef = useRef<Map<AuctionCue, HTMLAudioElement>>(new Map());
  const previousRef = useRef<SoundSnapshot | null>(null);
  const countdownDeadlineRef = useRef<string | null>(null);
  const pendingNewProductTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(false);
  enabledRef.current = enabled;

  const audioFor = useCallback((cue: AuctionCue): HTMLAudioElement | null => {
    if (typeof Audio === 'undefined') return null;
    const cached = soundsRef.current.get(cue);
    if (cached) return cached;
    const audio = new Audio(AUCTION_SFX[cue]);
    audio.preload = 'auto';
    audio.loop = cue === 'countdown';
    audio.volume = cue === 'countdown' ? 0.38 : cue === 'bidSmall' ? 0.72 : 0.88;
    soundsRef.current.set(cue, audio);
    return audio;
  }, []);

  const stopCountdown = useCallback(() => {
    const audio = soundsRef.current.get('countdown');
    if (!audio) return;
    audio.pause();
    try { audio.currentTime = 0; } catch { /* 아직 미로딩된 오디오 */ }
  }, []);

  const playCue = useCallback((cue: Exclude<AuctionCue, 'countdown'>) => {
    const audio = audioFor(cue);
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch { /* 다운로드 전일 수 있음 */ }
    void audio.play().catch(() => {
      setAudioError('경매 효과음을 재생하지 못했습니다. 음원 URL 및 브라우저 소리 설정을 확인해주세요.');
    });
  }, [audioFor]);

  const toggleSound = useCallback(async () => {
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      countdownDeadlineRef.current = null;
      if (pendingNewProductTimerRef.current !== null) {
        window.clearTimeout(pendingNewProductTimerRef.current);
        pendingNewProductTimerRef.current = null;
      }
      for (const audio of soundsRef.current.values()) {
        audio.pause();
        try { audio.currentTime = 0; } catch { /* 미로딩 오디오 */ }
      }
      return;
    }
    try {
      const audio = audioFor('bidSmall');
      if (!audio) throw new Error('이 브라우저는 경매 효과음 재생을 지원하지 않습니다.');
      // 이 클릭이 브라우저 자동재생 정책에 필요한 사용자 제스처다.
      audio.currentTime = 0;
      await audio.play();
      enabledRef.current = true;
      setEnabled(true);
      setAudioError(null);
      // 사용자가 소리를 켠 뒤 나머지 음원을 준비한다. 서버 요청은 발생하지 않는다.
      (Object.keys(AUCTION_SFX) as AuctionCue[]).forEach((cue) => {
        const resource = audioFor(cue);
        if (resource && cue !== 'bidSmall') resource.load();
      });
    } catch (error) {
      enabledRef.current = false;
      setEnabled(false);
      setAudioError(error instanceof Error ? error.message : '경매 효과음을 활성화하지 못했습니다.');
    }
  }, [audioFor]);

  const itemId = item?.id ?? null;
  const attempt = item?.current_attempt ?? null;
  const topBidKey = auctionBidSoundKey(item);
  const bidAmount = item?.top_bid?.amount ?? null;

  useEffect(() => {
    if (!ready) return;
    const soldKeys = new Set(items.filter((entry) => entry.final_status === 'SOLD')
      .map((entry) => String(entry.id) + ':' + String(entry.current_attempt)));
    const next: SoundSnapshot = { auctionId, itemId, attempt, bidKey: topBidKey, soldKeys };
    const previous = previousRef.current;
    previousRef.current = next;

    // 첫 상태·다른 경매 회차 진입 시 과거의 기록을 소리로 재생하지 않는다.
    if (!previous) return;
    if (previous.auctionId !== auctionId) {
      if (enabled && !isStateDelayed && itemId !== null) {
        playCue('newProduct');
      }
      return;
    }
    if (!enabled || isStateDelayed || auctionId === null) return;

    const newSale = [...soldKeys].some((key) => !previous.soldKeys.has(key));
    const newProduct = itemId !== null && previous.itemId !== itemId;
    const newBid = itemId !== null
      && itemId === previous.itemId
      && attempt === previous.attempt
      && topBidKey !== null
      && previous.bidKey !== topBidKey;

    if (newSale) {
      stopCountdown();
      playCue('sold');
    }
    if (newProduct) {
      // 같은 서버 응답에서 이전 상품 정산과 다음 상품 시작이 같이 관측될 때도 두 효과를 보장한다.
      if (newSale) {
        if (pendingNewProductTimerRef.current !== null) window.clearTimeout(pendingNewProductTimerRef.current);
        pendingNewProductTimerRef.current = window.setTimeout(() => {
          pendingNewProductTimerRef.current = null;
          if (enabledRef.current) playCue('newProduct');
        }, 1000);
      } else {
        playCue('newProduct');
      }
    } else if (newBid && bidAmount !== null) {
      playCue(auctionBidCue(bidAmount));
    }
  }, [ready, auctionId, itemId, attempt, topBidKey, bidAmount, items, enabled, isStateDelayed, playCue, stopCountdown]);

  const deadline = item?.bidding_ends_at ?? null;
  useEffect(() => {
    // SUPER PASS 신청 단계 / 일시정지 / 낙찰 / 입찰 연장 시 시계음을 멈추거나 다시 시작한다.
    const shouldTick = ready && enabled && !isStateDelayed && auctionId !== null
      && itemId !== null && item?.final_status === null && deadline !== null && !paused && !applying
      && remainingSeconds > 0 && remainingSeconds <= 10;
    if (!shouldTick) {
      countdownDeadlineRef.current = null;
      stopCountdown();
      return;
    }

    const clockKey = String(auctionId) + ':' + String(itemId) + ':' + deadline;
    if (countdownDeadlineRef.current !== clockKey) {
      stopCountdown();
      countdownDeadlineRef.current = clockKey;
    }
    const audio = audioFor('countdown');
    if (audio?.paused) {
      void audio.play().catch(() => {
        setAudioError('마감 카운트다운 효과음을 재생하지 못했습니다.');
      });
    }
  }, [ready, enabled, isStateDelayed, auctionId, itemId, deadline, paused, applying, remainingSeconds, audioFor, stopCountdown]);

  useEffect(() => () => {
    // 탭 종료·다른 페이지 이동 시 지연 효과와 모든 음원을 정지한다.
    if (pendingNewProductTimerRef.current !== null) window.clearTimeout(pendingNewProductTimerRef.current);
    // 탭 종료·다른 페이지 이동 시 카운트다운을 포함한 모든 사운드를 즉시 정지한다.
    for (const audio of soundsRef.current.values()) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    soundsRef.current.clear();
  }, []);

  return { enabled, audioError, toggleSound };
}
