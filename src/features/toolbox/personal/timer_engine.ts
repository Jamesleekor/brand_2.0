// 타이머·스톱워치 시간 계산
// 시간은 '언제 끝나는지(종료 시각)'로 기억한다. 그래서 다른 탭으로 가거나
// 새로고침해도 흐른 시간이 그대로 반영되고, 일시 정지한 시간만 멈춘다.

import { useEffect, useRef, useState } from 'react';

export interface TimerData {
  durationMs: number;
  /** 실행 중일 때 끝나는 시각(ms) */
  endsAt: number | null;
  /** 일시 정지 중일 때 남은 시간 */
  pausedRemaining: number | null;
  /** 이미 알림을 울렸는지 (돌아왔을 때 반복 알림 방지) */
  alarmed: boolean;
}

export const timerIdle = (durationMs: number): TimerData => ({ durationMs, endsAt: null, pausedRemaining: null, alarmed: false });

export function timerRemaining(t: TimerData, now: number): number {
  if (t.endsAt !== null) return Math.max(0, t.endsAt - now);
  if (t.pausedRemaining !== null) return t.pausedRemaining;
  return t.durationMs;
}

export const timerStart = (t: TimerData, now: number): TimerData => ({
  ...t, endsAt: now + (t.pausedRemaining ?? t.durationMs), pausedRemaining: null, alarmed: false,
});
export const timerPause = (t: TimerData, now: number): TimerData => ({ ...t, endsAt: null, pausedRemaining: timerRemaining(t, now) });
export const timerReset = (t: TimerData): TimerData => timerIdle(t.durationMs);
export function timerAdjust(t: TimerData, deltaMs: number, now: number): TimerData {
  const remaining = Math.max(0, timerRemaining(t, now) + deltaMs);
  if (t.endsAt !== null) return { ...t, endsAt: now + remaining, alarmed: remaining > 0 ? false : t.alarmed };
  if (t.pausedRemaining !== null) return { ...t, pausedRemaining: remaining };
  return { ...t, durationMs: Math.max(1000, remaining) };
}

export interface StopwatchData { startedAt: number | null; accumulated: number; laps: number[] }
export const swIdle: StopwatchData = { startedAt: null, accumulated: 0, laps: [] };
export const swElapsed = (s: StopwatchData, now: number) => s.accumulated + (s.startedAt !== null ? now - s.startedAt : 0);

/** 화면이 보일 때만 자주 다시 그린다. */
export function useNow(active: boolean, intervalMs = 200): number {
  const [now, setNow] = useState(() => Date.now());
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!active) { setNow(Date.now()); return; }
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') setNow(Date.now()); }, intervalMs);
    const onVis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); if (raf.current) cancelAnimationFrame(raf.current); };
  }, [active, intervalMs]);
  return now;
}
