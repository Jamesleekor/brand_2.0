import { useCallback, useEffect, useRef } from 'react';

import {
  raidStudentRpc,
  type RaidTapBatchResult,
  type RaidTapInput,
} from '@/lib/rpc/raid_student_rpc';
import { supabase } from '@/lib/supabase/client';

interface PendingBatch {
  id: string;
  taps: RaidTapInput[];
  attempts: number;
}

interface UseRaidTapBatcherArgs {
  raidId: number;
  enabled: boolean;
  onResult: (result: RaidTapBatchResult) => void;
  onError?: (message: string) => void;
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
  onResult,
  onError,
}: UseRaidTapBatcherArgs) {
  const queueRef = useRef<RaidTapInput[]>([]);
  const retryRef = useRef<PendingBatch | null>(null);
  const inFlightRef = useRef(false);
  const enabledRef = useRef(enabled);
  const mountedRef = useRef(true);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const flush = useCallback(async () => {
    if (!mountedRef.current || inFlightRef.current || !enabledRef.current) return;

    let pending = retryRef.current;
    if (!pending) {
      if (queueRef.current.length === 0) return;
      pending = {
        id: makeBatchId(),
        taps: queueRef.current.splice(0, 25),
        attempts: 0,
      };
    }

    inFlightRef.current = true;
    const attempted: PendingBatch = {
      ...pending,
      attempts: pending.attempts + 1,
    };

    const response = await raidStudentRpc.submitTapBatch(
      supabase,
      raidId,
      attempted.id,
      attempted.taps,
    );

    if (!mountedRef.current) return;

    if (response.success) {
      retryRef.current = null;
      onResultRef.current(response.data);
    } else if (attempted.attempts < 3) {
      // Same batch id + same taps: server idempotency makes network retries safe.
      retryRef.current = attempted;
    } else {
      retryRef.current = null;
      onErrorRef.current?.(
        response.error || '공격 정보를 서버에 전달하지 못했습니다.',
      );
    }

    inFlightRef.current = false;
  }, [raidId]);

  useEffect(() => {
    mountedRef.current = true;
    const timer = window.setInterval(() => {
      void flush();
    }, 250);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      queueRef.current = [];
      retryRef.current = null;
      inFlightRef.current = false;
    };
  }, [flush]);

  const queueTap = useCallback((tap: RaidTapInput) => {
    if (!enabledRef.current) return false;

    // Keep a bounded client queue even if a Chromebook produces accidental burst input.
    if (queueRef.current.length >= 80) return false;

    queueRef.current.push(tap);
    return true;
  }, []);

  return {
    queueTap,
    flush,
  };
}
