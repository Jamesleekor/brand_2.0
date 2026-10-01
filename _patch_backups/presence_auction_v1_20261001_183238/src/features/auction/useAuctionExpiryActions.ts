import { useEffect, useRef } from 'react';
import { studentRpc } from '@/lib/rpc/student_rpc';
import { supabase } from '@/lib/supabase/client';

type ExpiryResult = { success: boolean; data?: { status?: string } | null };
function useExpiryAction(key: string | null, delayMs: number, action: () => Promise<ExpiryResult>, refresh: () => unknown) {
  const actionRef = useRef(action);
  const refreshRef = useRef(refresh);
  actionRef.current = action;
  refreshRef.current = refresh;
  useEffect(() => {
    if (!key) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (disposed) return;
      let retry = false;
      try {
        const result = await actionRef.current();
        retry = !result.success || result.data?.status === 'BUSY' || result.data?.status === 'NOT_EXPIRED';
      } catch {
        retry = true;
      }
      if (disposed) return;
      void Promise.resolve(refreshRef.current()).catch(() => {});
      if (retry) timer = setTimeout(() => void run(), 3_000 + Math.floor(Math.random() * 1_000));
    };
    // The operating panel resolves first. Students and broadcasts are delayed failover.
    timer = setTimeout(() => void run(), delayMs);
    return () => { disposed = true; clearTimeout(timer); };
  }, [key, delayMs]);
}

export function useAuctionExpiryActions(options: {
  itemId: number | null;
  bidDeadline: string | null;
  bidExpired: boolean;
  paused: boolean;
  roundId: number | null;
  applicationDeadline: string | null;
  applicationExpired: boolean;
  applying: boolean;
  operatingPanel?: boolean;
  refresh: () => unknown;
}) {
  const [delay] = useRef([options.operatingPanel ? 0 : 5_000 + Math.floor(Math.random() * 4_000)]).current;
  const bidKey = options.itemId && options.bidDeadline && options.bidExpired && !options.paused && !options.applying
    ? `${options.itemId}:${options.bidDeadline}` : null;
  const applicationKey = options.itemId && options.roundId && options.applicationDeadline && options.applicationExpired && options.applying && !options.paused
    ? `${options.itemId}:${options.roundId}:${options.applicationDeadline}` : null;
  useExpiryAction(bidKey, delay, () => studentRpc.finalizeLiveAuctionItemIfExpired(supabase, { p_item_id: options.itemId! }), options.refresh);
  useExpiryAction(applicationKey, delay, () => studentRpc.resolveAuctionSuperPassPhaseIfExpired(supabase, { p_item_id: options.itemId! }), options.refresh);
}
