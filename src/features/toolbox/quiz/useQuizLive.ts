// =====================================================================
// 퀴즈 로얄 — 실시간 신호 + 서버 시계
// ---------------------------------------------------------------------
// * 서버가 상태를 바꾸면 quiz_pulse 한 행의 rev만 오른다. 화면은 그 신호를 받았을 때만
//   자기에게 필요한 상태를 한 번 다시 읽는다(1초마다 묻지 않는다).
// * 실시간 연결이 끊기면 3초 간격으로 신호 행만 확인하고, 다시 연결되면 한 번 따라잡는다.
// * 응답 순서가 뒤바뀌어도 version이 더 낮은 응답은 버린다(오래된 화면으로 되돌아가지 않음).
// * 타이머 표시는 서버 시각과의 차이를 보정한 로컬 카운트다운이다. 마감 판정은 서버가 한다.
// =====================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { quizRpc } from './quiz_rpc';

const FALLBACK_POLL_MS = 3_000;

export interface QuizLive<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  connected: boolean;
  /** 마지막 신호의 내용(영상 재생 명령 등) */
  payload: Record<string, any>;
  rev: number;
  refresh: () => void;
}

interface Options<T> {
  enabled?: boolean;
  /** 신호 없이도 이 간격마다 한 번 읽는다(태블릿 접속 표시·안전망). 0이면 끔 */
  intervalMs?: number;
  /** 응답에서 version을 꺼낸다(낮은 version 응답은 버림) */
  versionOf?: (d: T) => number;
  /** 신호 내용으로 다시 읽을지 고른다 */
  relevant?: (payload: Record<string, any>) => boolean;
  /** 응답을 받았을 때 서버 시각 보정용 */
  serverNowOf?: (d: T) => string | undefined;
}

export function useQuizLive<T>(client: SupabaseClient, pulseKey: string | null, fetcher: () => Promise<T>, opts: Options<T> = {}): QuizLive<T> {
  const { enabled = true, intervalMs = 0, versionOf, relevant, serverNowOf } = opts;
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [payload, setPayload] = useState<Record<string, any>>({});
  const [rev, setRev] = useState(0);
  const fetcherRef = useRef(fetcher); fetcherRef.current = fetcher;
  const relevantRef = useRef(relevant); relevantRef.current = relevant;
  const versionRef = useRef(-1);
  const revRef = useRef(0);
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const alive = useRef(true);

  const run = useCallback(async () => {
    if (inFlight.current) { dirty.current = true; return; }
    inFlight.current = true;
    const sentAt = Date.now();
    try {
      const next = await fetcherRef.current();
      if (!alive.current) return;
      const v = versionOf ? versionOf(next) : 0;
      if (versionOf && v < versionRef.current) return; // 늦게 도착한 오래된 응답
      versionRef.current = v;
      const sn = serverNowOf?.(next);
      if (sn) noteServerTime(sn, sentAt, Date.now());
      setData(next);
      setError(null);
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
      if (dirty.current && alive.current) { dirty.current = false; void run(); }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const schedule = useCallback((delay: number) => {
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => { timer.current = null; void run(); }, delay);
  }, [run]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (timer.current !== null) window.clearTimeout(timer.current); };
  }, []);

  // 처음 읽기
  useEffect(() => {
    if (!enabled) return;
    versionRef.current = -1;
    setLoading(true);
    void run();
  }, [enabled, pulseKey, run]);

  // 신호 구독
  useEffect(() => {
    if (!enabled || !pulseKey) return;
    let pollTimer: number | null = null;
    let channel: RealtimeChannel | null = null;
    let stopped = false;
    const apply = (row: { rev?: number; payload?: Record<string, any> } | null | undefined) => {
      if (!row || stopped) return;
      const r = Number(row.rev ?? 0);
      if (r <= revRef.current) return;
      const first = revRef.current === 0;
      revRef.current = r;
      setRev(r);
      setPayload(row.payload ?? {});
      if (first) return; // 처음 읽은 신호 값은 방금 읽은 상태와 같다
      const rel = relevantRef.current;
      if (!rel || rel(row.payload ?? {})) schedule(60);
    };
    const poll = () => { void quizRpc.pulse(client, pulseKey).then(apply).catch(() => undefined); };
    const startPoll = () => { if (pollTimer === null) pollTimer = window.setInterval(() => { if (document.visibilityState === 'visible') poll(); }, FALLBACK_POLL_MS); };
    const stopPoll = () => { if (pollTimer !== null) window.clearInterval(pollTimer); pollTimer = null; };

    revRef.current = 0;
    poll();
    const topic = `quiz-pulse:${pulseKey}`;
    client.getChannels().filter((ch) => ch.topic === `realtime:${topic}`).forEach((ch) => { void client.removeChannel(ch); });
    channel = client
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_pulse', filter: `pulse_key=eq.${pulseKey}` },
        (msg) => apply((msg as unknown as { new?: { rev?: number; payload?: Record<string, any> } }).new))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          stopPoll();
          setConnected(true);
          // 끊긴 사이 놓친 변화를 한 번 따라잡는다
          poll();
          schedule(0);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnected(false);
          startPoll();
        }
      });
    return () => {
      stopped = true;
      stopPoll();
      if (channel) void client.removeChannel(channel);
    };
  }, [client, enabled, pulseKey, schedule]);

  // 주기적 안전망 + 화면 복귀 시 다시 읽기
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => { if (document.visibilityState === 'visible') schedule(30); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    const iv = intervalMs > 0 ? window.setInterval(() => { if (document.visibilityState === 'visible') schedule(0); }, intervalMs) : null;
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      if (iv !== null) window.clearInterval(iv);
    };
  }, [enabled, intervalMs, schedule]);

  return { data, error, loading, connected, payload, rev, refresh: () => schedule(0) };
}

// ---------------------------------------------------------------------
// 서버 시계 보정: (서버 시각) - (요청 중간 시점의 기기 시각). 가장 짧은 왕복의 값을 믿는다.
// ---------------------------------------------------------------------
let offsetMs = 0;
let bestRtt = Number.POSITIVE_INFINITY;
let bestAt = 0;

export function noteServerTime(serverIso: string, sentAt: number, receivedAt: number) {
  const server = Date.parse(serverIso);
  if (!Number.isFinite(server)) return;
  const rtt = receivedAt - sentAt;
  // 오래된 측정(2분)은 새 측정으로 바꿀 수 있게 한다(기기 시계가 흘러가는 경우)
  if (rtt <= bestRtt || Date.now() - bestAt > 120_000) {
    bestRtt = rtt;
    bestAt = Date.now();
    offsetMs = server - (sentAt + rtt / 2);
  }
}

export function serverNow(): number { return Date.now() + offsetMs; }

/** 남은 시간(ms). LIVE면 마감 시각까지, PAUSED면 저장된 남은 시간, 그 외 null */
export function useCountdown(qPhase: string | undefined, deadlineAt: string | null | undefined, remainingMs: number | null | undefined): number | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (qPhase !== 'LIVE' || !deadlineAt) return;
    const iv = window.setInterval(() => force((n) => n + 1), 200);
    return () => window.clearInterval(iv);
  }, [qPhase, deadlineAt]);
  if (qPhase === 'PAUSED') return remainingMs ?? null;
  if (qPhase === 'LIVE' && deadlineAt) return Math.max(0, Date.parse(deadlineAt) - serverNow());
  return null;
}
