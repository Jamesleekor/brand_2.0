import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import type { LiveAuctionItem, LiveAuctionState } from './types';

const AUCTION_REALTIME_REFRESH_MIN_MS = 750;
const AUCTION_REALTIME_JITTER_MS = 150;

export function useLiveAuctionState(includeScheduled = false) {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const refreshTimerRef = useRef<number | null>(null);
  const lastRefreshAtRef = useRef(0);

  const query = useQuery<LiveAuctionState>({
    queryKey: ['live-auction-state', classroomId, includeScheduled],
    queryFn: async () => {
      if (!classroomId) return { server_now: new Date().toISOString(), auction: null };
      const { data, error } = await supabase.rpc('get_live_auction_state', {
        p_classroom_id: classroomId,
        p_include_scheduled: includeScheduled,
      });
      if (error) throw new Error(error.message);
      return data as LiveAuctionState;
    },
    enabled: classroomId !== null,
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 1_000,
  });

  useEffect(() => {
    if (!classroomId) return;

    let disposed = false;

    const invalidateNow = () => {
      refreshTimerRef.current = null;
      if (disposed) return;

      lastRefreshAtRef.current = Date.now();
      void queryClient.invalidateQueries({ queryKey: ['live-auction-state', classroomId] });
    };

    const scheduleInvalidate = () => {
      if (disposed) return;

      const elapsed = Date.now() - lastRefreshAtRef.current;
      const baseWait = Math.max(0, AUCTION_REALTIME_REFRESH_MIN_MS - elapsed);

      if (baseWait === 0 && refreshTimerRef.current === null) {
        invalidateNow();
        return;
      }

      if (refreshTimerRef.current !== null) return;

      const jitter = Math.floor(Math.random() * AUCTION_REALTIME_JITTER_MS);
      refreshTimerRef.current = window.setTimeout(invalidateNow, baseWait + jitter);
    };

    // One Realtime channel per auction page. A successful bid emits both a bid
    // INSERT and an item UPDATE; throttling collapses that burst into at most one
    // state refresh every ~0.75s per client instead of one RPC per event/table.
    const channel = supabase
      .channel(`live-auction:${classroomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'auctions', filter: `classroom_id=eq.${classroomId}` },
        scheduleInvalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'auction_items' },
        scheduleInvalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'auction_bids' },
        scheduleInvalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'auction_results' },
        scheduleInvalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'auction_failures' },
        scheduleInvalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'auction_super_pass_rounds', filter: `classroom_id=eq.${classroomId}` },
        scheduleInvalidate,
      )
      .subscribe();

    return () => {
      disposed = true;
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [classroomId, queryClient]);

  const items = query.data?.items ?? [];
  const currentItem = useMemo(
    () => items.find((item) => item.is_current) ?? null,
    [items],
  );

  return {
    ...query,
    classroomId,
    state: query.data ?? null,
    auction: query.data?.auction ?? null,
    items,
    currentItem,
    recentBids: query.data?.recent_bids ?? [],
    superPass: query.data?.super_pass ?? null,
  };
}

export function useAuctionCountdown(
  serverNowIso: string | undefined,
  item: LiveAuctionItem | null,
  pausedAt: string | null | undefined,
  pausedRemainingSeconds: number | null | undefined,
) {
  const [tick, setTick] = useState(0);
  const syncLocalAtRef = useRef(Date.now());
  const syncServerAtRef = useRef(Date.now());

  useEffect(() => {
    syncLocalAtRef.current = Date.now();
    syncServerAtRef.current = serverNowIso ? new Date(serverNowIso).getTime() : Date.now();
  }, [serverNowIso]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 200);
    return () => window.clearInterval(timer);
  }, []);

  return useMemo(() => {
    void tick;
    if (!item) return { remainingMs: 0, remainingSeconds: 0, isExpired: false, isPaused: false };
    if (pausedAt) {
      const seconds = Math.max(0, pausedRemainingSeconds ?? 0);
      return {
        remainingMs: seconds * 1000,
        remainingSeconds: seconds,
        isExpired: false,
        isPaused: true,
      };
    }
    if (!item.bidding_ends_at) {
      return { remainingMs: 0, remainingSeconds: 0, isExpired: false, isPaused: false };
    }
    const estimatedServerNow = syncServerAtRef.current + (Date.now() - syncLocalAtRef.current);
    const remainingMs = Math.max(0, new Date(item.bidding_ends_at).getTime() - estimatedServerNow);
    return {
      remainingMs,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      isExpired: remainingMs <= 0,
      isPaused: false,
    };
  }, [item, pausedAt, pausedRemainingSeconds, tick]);
}

export function formatAuctionTime(totalSeconds: number) {
  const value = Math.max(0, totalSeconds);
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}


export function useServerDeadlineCountdown(
  serverNowIso: string | undefined,
  targetIso: string | null | undefined,
) {
  const [tick, setTick] = useState(0);
  const syncLocalAtRef = useRef(Date.now());
  const syncServerAtRef = useRef(Date.now());

  useEffect(() => {
    syncLocalAtRef.current = Date.now();
    syncServerAtRef.current = serverNowIso ? new Date(serverNowIso).getTime() : Date.now();
  }, [serverNowIso]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 200);
    return () => window.clearInterval(timer);
  }, []);

  return useMemo(() => {
    void tick;
    if (!targetIso) return { remainingMs: 0, remainingSeconds: 0, isExpired: false };
    const estimatedServerNow = syncServerAtRef.current + (Date.now() - syncLocalAtRef.current);
    const remainingMs = Math.max(0, new Date(targetIso).getTime() - estimatedServerNow);
    return {
      remainingMs,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      isExpired: remainingMs <= 0,
    };
  }, [targetIso, tick]);
}
