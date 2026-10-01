import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import type { LiveAuctionItem, LiveAuctionState } from './types';


export function useLiveAuctionState(includeScheduled = false) {
  const classroomId = useClassroomId();
  // AUCTION_EMERGENCY_POLLING_V1: avoid Postgres Changes fan-out during live bidding.
  const [pollMs] = useState(() => (includeScheduled ? 1_500 : 2_500) + Math.floor(Math.random() * 500));

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
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 1_000,
  });

  const refetch = useCallback(() => query.refetch({ cancelRefetch: false }), [query.refetch]);

  const items = query.data?.items ?? [];
  const currentItem = useMemo(
    () => items.find((item) => item.is_current) ?? null,
    [items],
  );

  return {
    ...query,
    refetch,
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
