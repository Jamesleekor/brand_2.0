import { useEffect, useRef } from 'react';
import { studentRpc } from '@/lib/rpc/student_rpc';
import { supabase } from '@/lib/supabase/client';

// AUCTION_EXPIRY_HERD_GUARD_V1 (2026-10-01)
// 타이머가 끝나면 선생님 운영 화면이 낙찰 처리를 맡는다.
// 학생·방송 화면은 "선생님 화면이 꺼져 있을 때를 대비한 예비"일 뿐이므로
// 충분히 기다린 뒤(25~40초), 최대 2번만 시도한다.
// 그 사이 선생님 화면이 처리하면 상품이 바뀌어 예비 시도는 자동으로 취소된다.
// (이전에는 5~9초 뒤 24명이 동시에 시도하고 3~4초마다 무한 재시도 → 서버 과부하 악순환)
const OPERATING_RETRY_MS = 3_000;
const OPERATING_RETRY_JITTER_MS = 1_000;
const FAILOVER_DELAY_MS = 25_000;
const FAILOVER_DELAY_JITTER_MS = 15_000;
const FAILOVER_RETRY_MS = 20_000;
const FAILOVER_RETRY_JITTER_MS = 10_000;
const FAILOVER_MAX_ATTEMPTS = 2;

type ExpiryResult = { success: boolean; data?: { status?: string } | null };
type RetryPolicy = { retryMs: number; retryJitterMs: number; maxAttempts: number };

function useExpiryAction(
  key: string | null,
  delayMs: number,
  policy: RetryPolicy,
  action: () => Promise<ExpiryResult>,
  refresh: () => unknown,
) {
  const actionRef = useRef(action);
  const refreshRef = useRef(refresh);
  const policyRef = useRef(policy);
  actionRef.current = action;
  refreshRef.current = refresh;
  policyRef.current = policy;
  useEffect(() => {
    if (!key) return;
    let disposed = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (disposed) return;
      attempts += 1;
      let retry = false;
      try {
        const result = await actionRef.current();
        retry = !result.success || result.data?.status === 'BUSY' || result.data?.status === 'NOT_EXPIRED';
      } catch {
        retry = true;
      }
      if (disposed) return;
      void Promise.resolve(refreshRef.current()).catch(() => {});
      const { retryMs, retryJitterMs, maxAttempts } = policyRef.current;
      if (retry && attempts < maxAttempts) {
        timer = setTimeout(() => void run(), retryMs + Math.floor(Math.random() * retryJitterMs));
      }
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
  const [delay] = useRef([options.operatingPanel ? 0 : FAILOVER_DELAY_MS + Math.floor(Math.random() * FAILOVER_DELAY_JITTER_MS)]).current;
  const policy: RetryPolicy = options.operatingPanel
    ? { retryMs: OPERATING_RETRY_MS, retryJitterMs: OPERATING_RETRY_JITTER_MS, maxAttempts: Number.POSITIVE_INFINITY }
    : { retryMs: FAILOVER_RETRY_MS, retryJitterMs: FAILOVER_RETRY_JITTER_MS, maxAttempts: FAILOVER_MAX_ATTEMPTS };
  const bidKey = options.itemId && options.bidDeadline && options.bidExpired && !options.paused && !options.applying
    ? `${options.itemId}:${options.bidDeadline}` : null;
  const applicationKey = options.itemId && options.roundId && options.applicationDeadline && options.applicationExpired && options.applying && !options.paused
    ? `${options.itemId}:${options.roundId}:${options.applicationDeadline}` : null;
  useExpiryAction(bidKey, delay, policy, () => studentRpc.finalizeLiveAuctionItemIfExpired(supabase, { p_item_id: options.itemId! }), options.refresh);
  useExpiryAction(applicationKey, delay, policy, () => studentRpc.resolveAuctionSuperPassPhaseIfExpired(supabase, { p_item_id: options.itemId! }), options.refresh);
}
