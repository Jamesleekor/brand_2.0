// =====================================================================
// 모험가 도구함 — 실시간 신호
// ---------------------------------------------------------------------
// 화면은 활동 전체를 일정 간격으로 다시 묻지 않는다.
// 서버가 상태를 바꿀 때 toolbox_pulse 한 행의 rev만 올리고, 화면은 그
// 신호를 받았을 때만 자기에게 필요한 부분을 한 번 읽는다.
//
//   '<학급>-S' : 학생 화면용 신호 (학급 구성원 읽기)
//   '<학급>-T' : 운영·중계 화면용 신호 (교사만 읽기, 버저 입력 신호 포함)
//
// 같은 신호를 여러 컴포넌트가 써도 연결은 하나만 연다(참조 개수 관리).
// 실시간 연결이 끊긴 동안에만 느린 간격으로 신호 행을 확인한다.
// =====================================================================

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { toolboxRpc } from './toolbox_rpc';
import type { PulseRow } from './toolbox_types';

export interface PulseSnapshot {
  rev: number;
  payload: Record<string, any>;
  connected: boolean;
  /** 이 값이 화면을 처음 열 때 읽은 값인지 (실제 변경 신호가 아님) */
  initial: boolean;
}

interface Entry {
  key: string;
  refs: number;
  snapshot: PulseSnapshot;
  listeners: Set<() => void>;
  channel: RealtimeChannel | null;
  pollTimer: number | null;
  stopTimer: number | null;
}

const EMPTY: PulseSnapshot = { rev: 0, payload: {}, connected: false, initial: true };
const entries = new Map<string, Entry>();
const FALLBACK_POLL_MS = 10_000;

function emit(entry: Entry, next: Partial<PulseSnapshot>) {
  const merged = { ...entry.snapshot, ...next };
  if (merged.rev === entry.snapshot.rev && merged.connected === entry.snapshot.connected && merged.payload === entry.snapshot.payload && merged.initial === entry.snapshot.initial) return;
  entry.snapshot = merged;
  entry.listeners.forEach((l) => l());
}

function applyRow(entry: Entry, row: PulseRow | null, initial = false) {
  if (!row) return;
  if (Number(row.rev) <= entry.snapshot.rev) return;
  emit(entry, { rev: Number(row.rev), payload: row.payload ?? {}, initial });
}

function startPolling(entry: Entry, client: SupabaseClient, classroomId: number, audience: 'S' | 'T') {
  if (entry.pollTimer !== null) return;
  entry.pollTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void toolboxRpc.pulse(client, classroomId, audience).then((row) => applyRow(entry, row)).catch(() => undefined);
  }, FALLBACK_POLL_MS);
}

function stopPolling(entry: Entry) {
  if (entry.pollTimer !== null) window.clearInterval(entry.pollTimer);
  entry.pollTimer = null;
}

function acquire(client: SupabaseClient, classroomId: number, audience: 'S' | 'T'): Entry {
  const key = `${classroomId}-${audience}`;
  let entry = entries.get(key);
  if (entry) {
    entry.refs += 1;
    if (entry.stopTimer !== null) { window.clearTimeout(entry.stopTimer); entry.stopTimer = null; }
    return entry;
  }
  entry = { key, refs: 1, snapshot: EMPTY, listeners: new Set(), channel: null, pollTimer: null, stopTimer: null };
  entries.set(key, entry);
  const e = entry;

  void toolboxRpc.pulse(client, classroomId, audience).then((row) => applyRow(e, row, true)).catch(() => undefined);

  const topic = `toolbox-pulse:${key}`;
  client.getChannels().filter((ch) => ch.topic === `realtime:${topic}`).forEach((ch) => client.removeChannel(ch));
  e.channel = client
    .channel(topic)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'toolbox_pulse', filter: `pulse_key=eq.${key}` },
      (msg) => applyRow(e, ((msg as unknown as { new?: PulseRow }).new) ?? null))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        stopPolling(e);
        // 끊긴 사이 놓친 신호를 한 번 따라잡는다.
        void toolboxRpc.pulse(client, classroomId, audience).then((row) => applyRow(e, row)).catch(() => undefined);
        emit(e, { connected: true });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        emit(e, { connected: false });
        startPolling(e, client, classroomId, audience);
      }
    });
  return e;
}

function release(client: SupabaseClient, entry: Entry) {
  entry.refs -= 1;
  if (entry.refs > 0) return;
  // 화면 전환(홈 → 도구함) 사이에 연결을 닫았다 다시 여는 일을 피한다.
  entry.stopTimer = window.setTimeout(() => {
    if (entry.refs > 0) return;
    stopPolling(entry);
    if (entry.channel) void client.removeChannel(entry.channel);
    entries.delete(entry.key);
  }, 4_000);
}

export function useToolboxPulse(client: SupabaseClient, classroomId: number | null | undefined, audience: 'S' | 'T'): PulseSnapshot {
  const [entry, setEntry] = useState<Entry | null>(null);

  useEffect(() => {
    if (!classroomId) return;
    const acquired = acquire(client, classroomId, audience);
    setEntry(acquired);
    return () => { setEntry(null); release(client, acquired); };
  }, [client, classroomId, audience]);

  const subscribe = useCallback((cb: () => void) => {
    if (!entry) return () => undefined;
    entry.listeners.add(cb);
    return () => { entry.listeners.delete(cb); };
  }, [entry]);

  return useSyncExternalStore(subscribe, () => entry?.snapshot ?? EMPTY, () => EMPTY);
}

// =====================================================================
// useLiveResource — 신호가 올 때만 다시 읽는 데이터 훅
// =====================================================================

/** 활동 목록(시작·종료·제출 열림/닫힘·라운드)에 영향을 주는 신호만 고른다. 점수·대진 변경은 제외. */
export const LIFECYCLE_EVENTS = new Set(['CREATED', 'OPEN', 'CLOSED', 'ENDED', 'REMOVED', 'CLEANUP', 'RENAMED', 'SET_SUBMISSION', 'OPEN_ROUND', 'CLOSE_ROUND', 'REVEAL', 'HIDE_RESULT']);

export interface LiveResource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refresh: () => void;
  setData: (updater: (prev: T | undefined) => T | undefined) => void;
}

interface LiveOptions {
  enabled?: boolean;
  /** 신호 rev. 바뀔 때마다 다시 읽을지 판단한다. */
  rev?: number;
  /** rev가 화면을 처음 열 때 읽은 값이면 true (다시 읽지 않는다) */
  revInitial?: boolean;
  /** 이 신호가 나와 관련 있는지. 없으면 항상 다시 읽는다. */
  relevant?: () => boolean;
  /** 여러 신호를 한 번의 읽기로 묶는 시간 */
  debounceMs?: number;
  /** 학생 24명이 같은 순간에 읽지 않도록 퍼뜨리는 최대 지연 */
  jitterMs?: number;
}

export function useLiveResource<T>(depsKey: string, fetcher: () => Promise<T>, options: LiveOptions = {}): LiveResource<T> {
  const { enabled = true, rev, revInitial = false, relevant, debounceMs = 120, jitterMs = 0 } = options;
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const alive = useRef(true);
  const keyRef = useRef(depsKey);

  const run = useCallback(async () => {
    if (inFlight.current) { dirty.current = true; return; }
    inFlight.current = true;
    const key = keyRef.current;
    try {
      const next = await fetcherRef.current();
      if (alive.current && key === keyRef.current) { setDataState(next); setError(null); }
    } catch (e) {
      if (alive.current && key === keyRef.current) setError(e);
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
      if (dirty.current && alive.current) { dirty.current = false; void run(); }
    }
  }, []);

  const schedule = useCallback((delay: number) => {
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => { timer.current = null; void run(); }, delay);
  }, [run]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (timer.current !== null) window.clearTimeout(timer.current); };
  }, []);

  useEffect(() => {
    keyRef.current = depsKey;
    if (!enabled) return;
    setLoading(true);
    setDataState(undefined);
    void run();
  }, [depsKey, enabled, run]);

  // 처음 열 때 읽은 신호 값은 방금 읽은 데이터와 같으므로 다시 읽지 않는다.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (!enabled || rev === undefined || revInitial) return;
    if (relevant && !relevant()) return;
    schedule(debounceMs + Math.floor(Math.random() * (jitterMs + 1)));
  }, [rev]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => { if (document.visibilityState === 'visible') schedule(50); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, schedule]);

  const setData = useCallback((updater: (prev: T | undefined) => T | undefined) => setDataState((p) => updater(p)), []);
  return { data, error, loading, refresh: () => schedule(0), setData };
}
