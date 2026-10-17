// 타이머·스톱워치

import { useEffect, useState } from 'react';
import { Seg, formatClock } from '../ui';
import { DockSep, StageShell, ToolDock, ToolHeader, useLocalState, useToolChrome, type PersonalToolProps } from './common';
import {
  swElapsed, swIdle, timerAdjust, timerIdle, timerPause, timerRemaining, timerReset, timerStart, useNow,
  type StopwatchData, type TimerData,
} from './timer_engine';

const PRESETS = [1, 3, 5, 10, 15];

export function TimerDial({ remaining, total, warnAt = 60_000, size = 'normal' }: { remaining: number; total: number; warnAt?: number; size?: 'normal' | 'compact' | 'hero' }) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;
  const r = 46;
  const c = 2 * Math.PI * r;
  const done = remaining <= 0;
  const warn = !done && remaining <= warnAt;
  return (
    <div className={size === 'hero' ? 'tbx-dial tbx-dial--hero' : size === 'compact' ? 'tbx-dial tbx-dial--compact' : 'tbx-dial'} data-warn={warn} data-done={done}
      role="timer" aria-label={`남은 시간 ${formatClock(remaining)}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(244,236,221,.08)" strokeWidth="6" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={done ? '#ff7b6b' : warn ? '#f3d59a' : '#e4bc72'} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} style={{ transition: 'stroke-dashoffset .25s linear, stroke .3s ease' }} />
        {Array.from({ length: 60 }).map((_, i) => (
          <line key={i} x1="50" y1="2.5" x2="50" y2={i % 5 === 0 ? 6 : 4.2} stroke="rgba(244,236,221,.28)" strokeWidth={i % 5 === 0 ? 0.9 : 0.5} transform={`rotate(${i * 6} 50 50)`} />
        ))}
      </svg>
      <div className="tbx-dial__text">
        <div className="tbx-dial__time">{formatClock(remaining)}</div>
        {done && <div className="tbx-h3 tbx-ember-text" style={{ marginTop: 8 }}>시간이 다 됐어요</div>}
      </div>
    </div>
  );
}

export function TimerTool(props: PersonalToolProps) {
  const { prefs, fs, chrome } = useToolChrome();
  const [mode, setMode] = useLocalState<'timer' | 'stopwatch'>(`brand.toolbox.${props.ownerKey}.timer.mode`, 'timer');
  const [timer, setTimer] = useLocalState<TimerData>(`brand.toolbox.${props.ownerKey}.timer.t`, timerIdle(5 * 60_000));
  const [sw, setSw] = useLocalState<StopwatchData>(`brand.toolbox.${props.ownerKey}.timer.sw`, swIdle);
  const running = mode === 'timer' ? timer.endsAt !== null : sw.startedAt !== null;
  const now = useNow(running, mode === 'stopwatch' ? 60 : 200);
  const remaining = timerRemaining(timer, now);
  const [h, setH] = useState(Math.floor(timer.durationMs / 3_600_000));
  const [m, setM] = useState(Math.floor((timer.durationMs % 3_600_000) / 60_000));
  const [s, setS] = useState(Math.floor((timer.durationMs % 60_000) / 1000));

  // 끝났을 때 알림은 한 번만
  useEffect(() => {
    if (timer.endsAt !== null && remaining <= 0 && !timer.alarmed) {
      setTimer((t) => ({ ...t, endsAt: null, pausedRemaining: 0, alarmed: true }));
      prefs.play('alarm');
    }
  }, [remaining, timer.endsAt, timer.alarmed]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyDuration = (ms: number) => {
    const clamped = Math.min(Math.max(ms, 1000), 24 * 3_600_000 - 1000);
    setTimer(timerIdle(clamped));
    setH(Math.floor(clamped / 3_600_000)); setM(Math.floor((clamped % 3_600_000) / 60_000)); setS(Math.floor((clamped % 60_000) / 1000));
  };
  const idle = timer.endsAt === null && timer.pausedRemaining === null;
  const elapsed = swElapsed(sw, now);

  const typed = h * 3600 + m * 60 + s;
  const dock = (
    <ToolDock>
      <Seg value={mode} onChange={setMode} options={[{ value: 'timer', label: '⏳ 타이머' }, { value: 'stopwatch', label: '⏱️ 스톱워치' }]} label="모드" />
      {mode === 'timer' && (
        <>
          <DockSep />
          {PRESETS.map((min) => (
            <button key={min} type="button" className="tbx-btn tbx-btn--sm" style={{ minHeight: 40 }} disabled={!idle} aria-pressed={timer.durationMs === min * 60_000}
              onClick={() => applyDuration(min * 60_000)}>{min}분</button>
          ))}
          <DockSep />
          <span className="tbx-time-input" title={idle ? '시간을 직접 적고 맞추기를 눌러요' : '시간을 새로 정하려면 ‘처음으로’를 눌러 주세요'}>
            {[['시', h, setH, 23], ['분', m, setM, 59], ['초', s, setS, 59]].map(([label, v, set, max]: any) => (
              <label key={label} className="tbx-time-input">
                <input className="tbx-input tbx-input--num" inputMode="numeric" disabled={!idle} value={v} aria-label={label === '시' ? '시간' : label}
                  onChange={(e) => set(Math.min(max, Math.max(0, Number(e.target.value.replace(/\D/g, '') || 0))))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && idle && typed > 0) applyDuration(typed * 1000); }} />
                <span>{label}</span>
              </label>
            ))}
          </span>
          <button type="button" className="tbx-btn tbx-btn--sm" style={{ minHeight: 40 }} disabled={!idle || typed === 0} onClick={() => applyDuration(typed * 1000)}>맞추기</button>
          {!idle && <span className="tbx-dock-field">실행 중에는 아래 ±버튼으로 바꿔요</span>}
        </>
      )}
    </ToolDock>
  );

  return (
    <div className="tbx tbx-page" data-reduce-motion={prefs.reduceMotion}>
      <ToolHeader tool="timer" right={chrome} />
      <StageShell fs={fs} prefs={prefs} fill dock={dock}>
        {mode === 'timer' ? (
          <div className="tbx-timer-hero">
            <TimerDial remaining={remaining} total={timer.durationMs} size="hero" />
            <div className="tbx-timer-hero__controls">
              {timer.endsAt !== null
                ? <button type="button" className="tbx-btn tbx-btn--xl" onClick={() => setTimer((t) => timerPause(t, Date.now()))}>일시 정지</button>
                : <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--xl" disabled={remaining <= 0} onClick={() => setTimer((t) => timerStart(t, Date.now()))}>{idle ? '시작' : '다시 시작'}</button>}
              <button type="button" className="tbx-btn tbx-btn--lg" disabled={idle} onClick={() => setTimer((t) => timerReset(t))}>처음으로</button>
              <div className="tbx-timer-hero__adjust" role="group" aria-label="시간 더하고 빼기">
                <button type="button" className="tbx-btn" onClick={() => setTimer((t) => timerAdjust(t, -60_000, Date.now()))} disabled={remaining <= 0}>−1분</button>
                <button type="button" className="tbx-btn" onClick={() => setTimer((t) => timerAdjust(t, 60_000, Date.now()))}>+1분</button>
                <button type="button" className="tbx-btn" onClick={() => setTimer((t) => timerAdjust(t, -10_000, Date.now()))} disabled={remaining <= 0}>−10초</button>
                <button type="button" className="tbx-btn" onClick={() => setTimer((t) => timerAdjust(t, 10_000, Date.now()))}>+10초</button>
              </div>
              <p className="tbx-hint" style={{ textAlign: 'center', maxWidth: 260 }}>다른 화면에 갔다 와도 시간은 계속 흘러요. 일시 정지한 동안만 멈춰요.</p>
            </div>
          </div>
        ) : (
          <div className="tbx-timer-layout" data-laps={sw.laps.length > 0}>
            <div className="tbx-stack" style={{ alignItems: 'center', gap: 26 }}>
              <div className="tbx-num tbx-stopwatch" role="timer">{formatClock(elapsed, true)}</div>
              <div className="tbx-stage-actions">
                {sw.startedAt !== null
                  ? <button type="button" className="tbx-btn tbx-btn--xl" onClick={() => setSw((x) => ({ ...x, startedAt: null, accumulated: swElapsed(x, Date.now()) }))}>일시 정지</button>
                  : <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--xl" onClick={() => setSw((x) => ({ ...x, startedAt: Date.now() }))}>{elapsed > 0 ? '이어서' : '시작'}</button>}
                <button type="button" className="tbx-btn tbx-btn--lg" disabled={sw.startedAt === null} onClick={() => setSw((x) => ({ ...x, laps: [swElapsed(x, Date.now()), ...x.laps].slice(0, 99) }))}>구간 기록</button>
                <button type="button" className="tbx-btn tbx-btn--lg tbx-btn--ghost" disabled={elapsed === 0} onClick={() => setSw(swIdle)}>초기화</button>
              </div>
            </div>
            {sw.laps.length > 0 && (
              <section className="tbx-well" style={{ width: '100%' }}>
                <div className="tbx-row tbx-row--between" style={{ marginBottom: 4 }}><span className="tbx-h3">구간 기록</span><span className="tbx-count">{sw.laps.length}개</span></div>
                <ol className="tbx-list" style={{ maxHeight: 'min(52vh, 420px)', overflow: 'auto' }}>
                  {sw.laps.map((t, i) => {
                    const prev = sw.laps[i + 1] ?? 0;
                    return (
                      <li key={sw.laps.length - i} className="tbx-list__row">
                        <span className="tbx-rank">{sw.laps.length - i}</span>
                        <span className="tbx-grow tbx-num" style={{ fontSize: 18 }}>{formatClock(t, true)}</span>
                        <span className="tbx-small">구간 +{formatClock(t - prev, true)}</span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}
          </div>
        )}
      </StageShell>
    </div>
  );
}
