// 타이머·스톱워치

import { useEffect, useState } from 'react';
import { Seg, formatClock } from '../ui';
import { StageShell, ToolHeader, useLocalState, useToolChrome, type PersonalToolProps } from './common';
import {
  swElapsed, swIdle, timerAdjust, timerIdle, timerPause, timerRemaining, timerReset, timerStart, useNow,
  type StopwatchData, type TimerData,
} from './timer_engine';

const PRESETS = [1, 3, 5, 10, 15];

export function TimerDial({ remaining, total, warnAt = 60_000, size = 'normal' }: { remaining: number; total: number; warnAt?: number; size?: 'normal' | 'compact' }) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;
  const r = 46;
  const c = 2 * Math.PI * r;
  const done = remaining <= 0;
  const warn = !done && remaining <= warnAt;
  return (
    <div className="tbx-dial" data-warn={warn} data-done={done} style={size === 'compact' ? { width: 'min(56vw, 220px)' } : undefined}
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
        <div className="tbx-dial__time" style={size === 'compact' ? { fontSize: 40 } : undefined}>{formatClock(remaining)}</div>
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

  return (
    <div className="tbx tbx-page" data-reduce-motion={prefs.reduceMotion}>
      <ToolHeader tool="timer" right={chrome} />
      <Seg value={mode} onChange={setMode} options={[{ value: 'timer', label: '타이머' }, { value: 'stopwatch', label: '스톱워치' }]} label="모드" />
      <div className="tbx-split">
        <StageShell fs={fs} prefs={prefs} tall corner={fs.on ? <button className="tbx-btn tbx-btn--sm" onClick={() => void fs.toggle()}>전체 화면 끝내기</button> : undefined}>
          {mode === 'timer' ? (
            <div className="tbx-stack" style={{ alignItems: 'center', gap: 22 }}>
              <TimerDial remaining={remaining} total={timer.durationMs} />
              <div className="tbx-row tbx-row--wrap" style={{ justifyContent: 'center' }}>
                {timer.endsAt !== null
                  ? <button type="button" className="tbx-btn tbx-btn--xl" onClick={() => setTimer((t) => timerPause(t, Date.now()))}>일시 정지</button>
                  : <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--xl" disabled={remaining <= 0} onClick={() => setTimer((t) => timerStart(t, Date.now()))}>{idle ? '시작' : '다시 시작'}</button>}
                <button type="button" className="tbx-btn tbx-btn--lg" disabled={idle} onClick={() => setTimer((t) => timerReset(t))}>처음으로</button>
              </div>
              <div className="tbx-row tbx-row--wrap" style={{ justifyContent: 'center' }}>
                <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => setTimer((t) => timerAdjust(t, -60_000, Date.now()))} disabled={remaining <= 0}>−1분</button>
                <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => setTimer((t) => timerAdjust(t, -10_000, Date.now()))} disabled={remaining <= 0}>−10초</button>
                <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => setTimer((t) => timerAdjust(t, 10_000, Date.now()))}>+10초</button>
                <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => setTimer((t) => timerAdjust(t, 60_000, Date.now()))}>+1분</button>
              </div>
            </div>
          ) : (
            <div className="tbx-stack" style={{ alignItems: 'center', gap: 22 }}>
              <div className="tbx-num" style={{ fontSize: 'clamp(52px, 13vw, 96px)', lineHeight: 1 }} role="timer">{formatClock(elapsed, true)}</div>
              <div className="tbx-row tbx-row--wrap" style={{ justifyContent: 'center' }}>
                {sw.startedAt !== null
                  ? <button type="button" className="tbx-btn tbx-btn--xl" onClick={() => setSw((x) => ({ ...x, startedAt: null, accumulated: swElapsed(x, Date.now()) }))}>일시 정지</button>
                  : <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--xl" onClick={() => setSw((x) => ({ ...x, startedAt: Date.now() }))}>{elapsed > 0 ? '이어서' : '시작'}</button>}
                <button type="button" className="tbx-btn tbx-btn--lg" disabled={sw.startedAt === null} onClick={() => setSw((x) => ({ ...x, laps: [swElapsed(x, Date.now()), ...x.laps].slice(0, 99) }))}>구간 기록</button>
                <button type="button" className="tbx-btn tbx-btn--lg tbx-btn--ghost" disabled={elapsed === 0} onClick={() => setSw(swIdle)}>초기화</button>
              </div>
              {sw.laps.length > 0 && (
                <ol className="tbx-list" style={{ width: 'min(100%, 360px)', maxHeight: 240, overflow: 'auto' }}>
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
              )}
            </div>
          )}
        </StageShell>

        {mode === 'timer' && (
          <section className="tbx-panel tbx-stack">
            <h2 className="tbx-h2">시간 정하기</h2>
            <div className="tbx-row tbx-row--wrap">
              {PRESETS.map((min) => (
                <button key={min} type="button" className="tbx-btn tbx-btn--sm" disabled={!idle} aria-pressed={timer.durationMs === min * 60_000}
                  onClick={() => applyDuration(min * 60_000)}>{min}분</button>
              ))}
            </div>
            <div className="tbx-row" style={{ gap: 6 }}>
              {[['시간', h, setH, 23], ['분', m, setM, 59], ['초', s, setS, 59]].map(([label, v, set, max]: any) => (
                <label key={label} style={{ flex: 1 }}>
                  <span className="tbx-label">{label}</span>
                  <input className="tbx-input tbx-input--num" inputMode="numeric" disabled={!idle} value={v}
                    onChange={(e) => set(Math.min(max, Math.max(0, Number(e.target.value.replace(/\D/g, '') || 0))))} />
                </label>
              ))}
            </div>
            <button type="button" className="tbx-btn tbx-btn--block" disabled={!idle || h * 3600 + m * 60 + s === 0}
              onClick={() => applyDuration((h * 3600 + m * 60 + s) * 1000)}>이 시간으로 맞추기</button>
            {!idle && <p className="tbx-hint">시간을 새로 정하려면 ‘처음으로’를 눌러 주세요. 실행 중에는 아래 ±버튼으로 바꿀 수 있어요.</p>}
            <p className="tbx-hint">다른 화면에 갔다 와도 시간은 계속 흘러요. 일시 정지한 동안만 멈춰요.</p>
          </section>
        )}
      </div>
    </div>
  );
}
