import { useCallback, useEffect, useRef } from 'react';

import {
  isRaidTapBatchBusyResult,
  raidStudentRpc,
  type RaidTapBatchResult,
  type RaidTapInput,
} from '@/lib/rpc/raid_student_rpc';
import { supabase } from '@/lib/supabase/client';

// RAID_V15_24P_CONCURRENCY_CLIENT_HOTFIX

interface PendingBatch {
  id: string;
  taps: RaidTapInput[];
  attempts: number;
}

export type RaidTapQueueResult =
  | 'QUEUED'
  | 'RATE_LIMITED'
  | 'QUEUE_FULL'
  | 'DISABLED';

export interface RaidTapBatcherDiagnostics {
  rawTapAttempts: number;
  queuedTapCount: number;
  rateLimitedCount: number;
  queueFullCount: number;
  queueDepth: number;
  retryTapCount: number;
  inFlight: boolean;
  busyStreak: number;
  busyResponses: number;
  rpcCalls: number;
  successfulBatches: number;
  networkRetries: number;
  acceptedTaps: number;
  rejectedTaps: number;
  lastRpcMs: number;
  averageRpcMs: number;
  maxRpcMs: number;
  batchIntervalMs: number;
  tapRateLimitPerSecond: number;
}

interface UseRaidTapBatcherArgs {
  raidId: number;
  enabled: boolean;
  tapRateLimitPerSecond: number;
  onResult: (result: RaidTapBatchResult) => void;
  onError?: (message: string) => void;
  onDiagnostics?: (diagnostics: RaidTapBatcherDiagnostics) => void;
}

function makeBatchId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `raid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useRaidTapBatcher({
  raidId,
  enabled,
  tapRateLimitPerSecond,
  onResult,
  onError,
  onDiagnostics,
}: UseRaidTapBatcherArgs) {
  const queueRef = useRef<RaidTapInput[]>([]);
  const retryRef = useRef<PendingBatch | null>(null);
  const inFlightRef = useRef(false);
  const nextAttemptAtRef = useRef(0);
  const nextFreshBatchAtRef = useRef(0);
  const busyStreakRef = useRef(0);
  const enabledRef = useRef(enabled);
  const tapRateLimitRef = useRef(Math.max(1, Number(tapRateLimitPerSecond) || 1));
  const tokenBucketRef = useRef({
    tokens: Math.max(1, Number(tapRateLimitPerSecond) || 1),
    updatedAt: performance.now(),
  });
  const mountedRef = useRef(true);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const onDiagnosticsRef = useRef(onDiagnostics);
  const lastDiagnosticsEmitAtRef = useRef(0);
  const diagnosticsRef = useRef({
    rawTapAttempts: 0,
    queuedTapCount: 0,
    rateLimitedCount: 0,
    queueFullCount: 0,
    busyResponses: 0,
    rpcCalls: 0,
    successfulBatches: 0,
    networkRetries: 0,
    acceptedTaps: 0,
    rejectedTaps: 0,
    lastRpcMs: 0,
    rpcDurationTotalMs: 0,
    maxRpcMs: 0,
  });
  // V2: keep attack RPC around 12~16/s for 24 players while local hit feedback stays immediate.
  // Per-device jitter prevents all Chromebooks from flushing on the same millisecond.
  const batchIntervalMsRef = useRef(1550 + Math.floor(Math.random() * 451));
  // A lightweight local scheduler lets BUSY retries honor retry_after_ms without
  // increasing the cadence of brand-new attack batches.
  const schedulerIntervalMsRef = useRef(125);

  useEffect(() => {
    enabledRef.current = enabled;
    if (enabled) {
      const rate = tapRateLimitRef.current;
      tokenBucketRef.current = { tokens: rate, updatedAt: performance.now() };
    }
  }, [enabled]);

  useEffect(() => {
    const rate = Math.max(1, Number(tapRateLimitPerSecond) || 1);
    tapRateLimitRef.current = rate;
    tokenBucketRef.current = {
      tokens: Math.min(rate, tokenBucketRef.current.tokens),
      updatedAt: performance.now(),
    };
  }, [tapRateLimitPerSecond]);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onDiagnosticsRef.current = onDiagnostics;
  }, [onDiagnostics]);

  const emitDiagnostics = useCallback((force = false) => {
    const callback = onDiagnosticsRef.current;
    if (!callback) return;

    const now = performance.now();
    if (!force && now - lastDiagnosticsEmitAtRef.current < 500) return;
    lastDiagnosticsEmitAtRef.current = now;

    const stats = diagnosticsRef.current;
    callback({
      rawTapAttempts: stats.rawTapAttempts,
      queuedTapCount: stats.queuedTapCount,
      rateLimitedCount: stats.rateLimitedCount,
      queueFullCount: stats.queueFullCount,
      queueDepth: queueRef.current.length,
      retryTapCount: retryRef.current?.taps.length ?? 0,
      inFlight: inFlightRef.current,
      busyStreak: busyStreakRef.current,
      busyResponses: stats.busyResponses,
      rpcCalls: stats.rpcCalls,
      successfulBatches: stats.successfulBatches,
      networkRetries: stats.networkRetries,
      acceptedTaps: stats.acceptedTaps,
      rejectedTaps: stats.rejectedTaps,
      lastRpcMs: Math.round(stats.lastRpcMs),
      averageRpcMs:
        stats.rpcCalls > 0 ? Math.round(stats.rpcDurationTotalMs / stats.rpcCalls) : 0,
      maxRpcMs: Math.round(stats.maxRpcMs),
      batchIntervalMs: batchIntervalMsRef.current,
      tapRateLimitPerSecond: tapRateLimitRef.current,
    });
  }, []);

  const flush = useCallback(async () => {
    if (!mountedRef.current || inFlightRef.current || !enabledRef.current) return;

    const now = performance.now();
    let pending = retryRef.current;

    if (pending) {
      // BUSY / network retry: honor the retry clock independently from the normal batch cadence.
      if (now < nextAttemptAtRef.current) return;
    } else {
      // Brand-new batches remain intentionally slow (~1.55–2.0s per client).
      if (now < nextFreshBatchAtRef.current) return;
      if (queueRef.current.length === 0) return;

      pending = {
        id: makeBatchId(),
        // Roughly two seconds of allowed taps per request. The server token bucket has ~3s capacity.
        taps: queueRef.current.splice(
          0,
          Math.max(1, Math.ceil(tapRateLimitRef.current * 2)),
        ),
        attempts: 0,
      };
      nextFreshBatchAtRef.current = now + batchIntervalMsRef.current;
    }

    inFlightRef.current = true;
    const attempted: PendingBatch = {
      ...pending,
      attempts: pending.attempts + 1,
    };

    const rpcStartedAt = performance.now();
    diagnosticsRef.current.rpcCalls += 1;

    const response = await raidStudentRpc.submitTapBatch(
      supabase,
      raidId,
      attempted.id,
      attempted.taps,
    );

    const rpcDurationMs = performance.now() - rpcStartedAt;
    diagnosticsRef.current.lastRpcMs = rpcDurationMs;
    diagnosticsRef.current.rpcDurationTotalMs += rpcDurationMs;
    diagnosticsRef.current.maxRpcMs = Math.max(
      diagnosticsRef.current.maxRpcMs,
      rpcDurationMs,
    );

    if (!mountedRef.current) return;

    if (response.success) {
      if (isRaidTapBatchBusyResult(response.data)) {
        // BUSY is intentional server-side backpressure, not a failed attack.
        // Keep the exact same batch id + taps so the eventual retry remains idempotent.
        retryRef.current = pending;
        busyStreakRef.current += 1;
        diagnosticsRef.current.busyResponses += 1;

        const serverDelay = Math.max(50, Number(response.data.retry_after_ms) || 0);
        const jitter = 80 + Math.floor(Math.random() * 171);
        const multiplier = Math.pow(1.5, Math.min(busyStreakRef.current - 1, 4));
        const backoffMs = Math.min(1500, Math.round((serverDelay + jitter) * multiplier));
        nextAttemptAtRef.current = performance.now() + backoffMs;
      } else {
        retryRef.current = null;
        busyStreakRef.current = 0;
        nextAttemptAtRef.current = 0;
        diagnosticsRef.current.successfulBatches += 1;
        diagnosticsRef.current.acceptedTaps += Number(response.data.accepted ?? 0);
        diagnosticsRef.current.rejectedTaps += Number(response.data.rejected ?? 0);
        onResultRef.current(response.data);
      }
    } else if (attempted.attempts < 3) {
      // Same batch id + same taps: server idempotency makes network retries safe.
      // Use a short bounded retry delay so a transient network failure cannot spin at 125ms.
      retryRef.current = attempted;
      busyStreakRef.current = 0;
      diagnosticsRef.current.networkRetries += 1;
      const networkBackoffMs = Math.min(
        1200,
        250 * attempted.attempts + 100 + Math.floor(Math.random() * 201),
      );
      nextAttemptAtRef.current = performance.now() + networkBackoffMs;
    } else {
      retryRef.current = null;
      busyStreakRef.current = 0;
      nextAttemptAtRef.current = 0;
      const errorMessage =
        'error' in response
          ? response.error
          : '공격 정보를 서버에 전달하지 못했습니다.';
      onErrorRef.current?.(errorMessage);
    }

    inFlightRef.current = false;
    emitDiagnostics(true);
  }, [emitDiagnostics, raidId]);

  useEffect(() => {
    mountedRef.current = true;
    nextFreshBatchAtRef.current = performance.now() + batchIntervalMsRef.current;

    const timer = window.setInterval(() => {
      void flush();
      emitDiagnostics();
    }, schedulerIntervalMsRef.current);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      queueRef.current = [];
      retryRef.current = null;
      inFlightRef.current = false;
      nextAttemptAtRef.current = 0;
      nextFreshBatchAtRef.current = 0;
      busyStreakRef.current = 0;
    };
  }, [emitDiagnostics, flush]);

  const queueTap = useCallback((tap: RaidTapInput): RaidTapQueueResult => {
    diagnosticsRef.current.rawTapAttempts += 1;
    if (!enabledRef.current) return 'DISABLED';

    // Keep at most about three seconds of valid-rate input; never build a long latency backlog.
    const rate = tapRateLimitRef.current;
    const queueLimit = Math.max(3, Math.ceil(rate * 3));
    if (queueRef.current.length >= queueLimit) {
      diagnosticsRef.current.queueFullCount += 1;
      return 'QUEUE_FULL';
    }

    // Presentation-side token bucket: only taps that can plausibly be accepted by the
    // authoritative server enter the queue and receive an immediate damage popup.
    // Capacity is intentionally one second of taps; the server remains more permissive (~3s).
    const now = performance.now();
    const bucket = tokenBucketRef.current;
    const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
    bucket.tokens = Math.min(rate, bucket.tokens + elapsedSeconds * rate);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      diagnosticsRef.current.rateLimitedCount += 1;
      return 'RATE_LIMITED';
    }

    bucket.tokens -= 1;
    queueRef.current.push(tap);
    diagnosticsRef.current.queuedTapCount += 1;
    return 'QUEUED';
  }, []);

  // RAID_CLASH_V1_20261028: 격돌이 시작되면 아직 보내지 않은 탭과 재시도 묶음을 버린다.
  // (격돌이 끝난 뒤 격돌 이전 탭이 버프 배율로 들어가지 않게)
  const clearPending = useCallback(() => {
    queueRef.current = [];
    retryRef.current = null;
    nextAttemptAtRef.current = 0;
    busyStreakRef.current = 0;
  }, []);

  return {
    queueTap,
    flush,
    clearPending,
  };
}
