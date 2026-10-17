// 순서 정하기 — 모든 참가자에게 1번부터 순서를 한 번에 정한다.
// 공개 방식(한 번에 / 한 명씩)은 이미 정해진 순서를 보여주는 방법일 뿐이다.
// 발표 타이머를 켜면 '다음 사람'을 누를 때마다 타이머가 다시 시작된다.

import { useEffect } from 'react';
import { Seg, Stepper, formatClock, shuffle } from '../ui';
import { DockSep, DockToggle, StageShell, ToolDock, ToolHeader, rememberRecent, useLocalState, useParticipantEditor, useParticipants, useToolChrome, type PersonalToolProps } from './common';
import { TimerDial } from './TimerTool';
import { timerIdle, timerPause, timerRemaining, timerStart, useNow, type TimerData } from './timer_engine';

interface OrderSave {
  order: string[] | null;
  revealMode: 'ALL' | 'ONE';
  revealed: number;
  done: string[];
  round: number;
  timerOn: boolean;
  perPersonSec: number;
  timer: TimerData;
}
const INITIAL: OrderSave = { order: null, revealMode: 'ALL', revealed: 0, done: [], round: 0, timerOn: false, perPersonSec: 120, timer: timerIdle(120_000) };

export function OrderTool(props: PersonalToolProps) {
  const p = useParticipants(props, 'order');
  const { prefs, fs, chrome } = useToolChrome();
  const [save, setSave] = useLocalState<OrderSave>(`brand.toolbox.${props.ownerKey}.order.state`, INITIAL);
  const started = save.order !== null;
  const labels = new Map(p.units.map((u) => [u.key, u.label] as const));
  const order = (save.order ?? []).filter((k) => labels.has(k));
  const shown = save.revealMode === 'ALL' ? order.length : save.revealed;
  const current = order.find((k) => !save.done.includes(k));
  const finished = started && order.length > 0 && !current;
  const now = useNow(save.timerOn && save.timer.endsAt !== null);
  const remaining = timerRemaining(save.timer, now);

  useEffect(() => {
    if (save.timer.endsAt !== null && remaining <= 0 && !save.timer.alarmed) {
      setSave((s) => ({ ...s, timer: { ...s.timer, endsAt: null, pausedRemaining: 0, alarmed: true } }));
      prefs.play('alarm');
    }
  }, [remaining]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = () => {
    rememberRecent(props, '순서 정하기', p.items);
    setSave((s) => ({ ...s, order: shuffle(p.units.map((u) => u.key)), revealed: s.revealMode === 'ONE' ? 1 : 0, done: [], round: s.round + 1, timer: timerIdle(s.perPersonSec * 1000) }));
    prefs.play('reveal');
  };
  const reshuffleRest = () => {
    const doneKeys = order.filter((k) => save.done.includes(k));
    const rest = shuffle(order.filter((k) => !save.done.includes(k)));
    setSave((s) => ({ ...s, order: [...doneKeys, ...rest], revealed: Math.max(s.revealed, doneKeys.length + (s.revealMode === 'ONE' ? 1 : 0)) }));
  };
  const next = () => {
    if (!current) return;
    setSave((s) => {
      const done = [...s.done, current];
      const hasNext = order.some((k) => !done.includes(k));
      const revealed = s.revealMode === 'ONE' ? Math.min(order.length, Math.max(s.revealed, done.length + 1)) : s.revealed;
      const timer = s.timerOn && hasNext ? timerStart(timerIdle(s.perPersonSec * 1000), Date.now()) : timerIdle(s.perPersonSec * 1000);
      return { ...s, done, revealed, timer };
    });
    prefs.play('tick');
  };
  const undoDone = (key: string) => setSave((s) => ({ ...s, done: s.done.filter((k) => k !== key) }));

  const editor = useParticipantEditor({ props, ...p, locked: started, onUnlock: () => setSave((s) => ({ ...s, order: null, done: [] })) });

  const dock = (
    <ToolDock primary={!started
      ? <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--lg" disabled={p.units.length === 0} onClick={begin}>순서 정하기</button>
      : <>
          <button type="button" className="tbx-btn" disabled={!current || save.done.length === 0} onClick={reshuffleRest} title="발표를 마친 사람 순서는 그대로 두고 나머지만 섞어요">남은 순서만 다시 섞기</button>
          <button type="button" className="tbx-btn tbx-btn--ghost" onClick={begin}>전체 다시 섞기</button>
        </>}>
      {editor.chip}
      <Seg value={save.revealMode} onChange={(v) => setSave((s) => ({ ...s, revealMode: v, revealed: v === 'ONE' ? Math.max(1, s.done.length + 1) : s.revealed }))}
        options={[{ value: 'ALL', label: '한 번에 모두' }, { value: 'ONE', label: '한 명씩 공개' }]} label="공개 방식" />
      <DockSep />
      <DockToggle checked={save.timerOn} label="발표 타이머" title="‘다음 사람’을 누르면 타이머가 처음부터 다시 시작돼요"
        onChange={(v) => setSave((s) => ({ ...s, timerOn: v, timer: timerIdle(s.perPersonSec * 1000) }))} />
      {save.timerOn && (
        <span className="tbx-dock-field">한 사람당
          <Stepper value={Math.round(save.perPersonSec / 10) * 10} min={10} max={1800} step={10} label="한 사람당 발표 시간(초)"
            onChange={(v) => setSave((s) => ({ ...s, perPersonSec: v, timer: timerIdle(v * 1000) }))} suffix={formatClock(save.perPersonSec * 1000)} />
        </span>
      )}
    </ToolDock>
  );

  return (
    <div className="tbx tbx-page" data-reduce-motion={prefs.reduceMotion}>
      <ToolHeader tool="order" right={chrome} />
      <StageShell fs={fs} prefs={prefs} fill dock={dock}>
        {!started ? (
          <div className="tbx-empty tbx-empty--stage">
            <p className="tbx-stage-title">{p.units.length ? `${p.units.length}명의 순서를 정할 수 있어요` : '참가자를 먼저 넣어 주세요'}</p>
            <p className="tbx-small">정한 순서는 공개 방식과 상관없이 바뀌지 않아요.</p>
            {p.units.length === 0 && <div className="tbx-stage-actions"><button type="button" className="tbx-btn tbx-btn--lg" onClick={editor.open}>👥 참가자 고르기</button></div>}
          </div>
        ) : (
          <div className="tbx-stack" style={{ width: '100%', gap: 16, alignSelf: 'flex-start' }}>
            <div className="tbx-stage-head" aria-live="polite">
              {current
                ? <span className="tbx-stage-title">지금 차례 <span className="tbx-brass-text">{order.indexOf(current) + 1}번 {labels.get(current)}</span></span>
                : <span className="tbx-stage-title">모든 순서가 끝났어요</span>}
              <span className="tbx-chip">{save.round}회차 · 완료 {save.done.length} / {order.length}</span>
            </div>
            <div className="tbx-order-layout" data-timer={save.timerOn}>
              <ol className="tbx-order-cols">
                {order.map((k, i) => {
                  const visible = i < shown || save.done.includes(k);
                  const isDone = save.done.includes(k);
                  const isNow = k === current;
                  return (
                    <li key={k} className="tbx-order-item" data-now={isNow} data-done={isDone} data-hidden={!visible}>
                      <span className={isDone ? 'tbx-rank tbx-rank--done' : isNow ? 'tbx-rank tbx-rank--1' : 'tbx-rank'}>{i + 1}</span>
                      <span className="tbx-order-item__name" title={visible ? labels.get(k) : undefined}>{visible ? labels.get(k) : '· · ·'}</span>
                      {isDone && <button type="button" className="tbx-btn tbx-btn--ghost tbx-btn--sm" onClick={() => undoDone(k)}>완료 취소</button>}
                      {isNow && <span className="tbx-chip tbx-chip--brass">발표 중</span>}
                    </li>
                  );
                })}
              </ol>
              {save.timerOn && (
                <div className="tbx-order-timer">
                  <TimerDial remaining={finished ? 0 : remaining} total={save.perPersonSec * 1000} warnAt={Math.min(30_000, save.perPersonSec * 250)} size="compact" />
                  <div className="tbx-row">
                    {save.timer.endsAt !== null
                      ? <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => setSave((s) => ({ ...s, timer: timerPause(s.timer, Date.now()) }))}>일시 정지</button>
                      : <button type="button" className="tbx-btn tbx-btn--sm" disabled={finished || remaining <= 0} onClick={() => setSave((s) => ({ ...s, timer: timerStart(s.timer, Date.now()) }))}>시작</button>}
                    <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" onClick={() => setSave((s) => ({ ...s, timer: timerIdle(s.perPersonSec * 1000) }))}>처음으로</button>
                  </div>
                </div>
              )}
            </div>
            <div className="tbx-stage-actions">
              <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--xl" disabled={!current} onClick={next}>
                {current ? (order.indexOf(current) === order.length - 1 ? '마지막 발표 끝' : '다음 사람') : '끝'}
              </button>
              {save.revealMode === 'ONE' && shown < order.length && (
                <button type="button" className="tbx-btn tbx-btn--lg" onClick={() => setSave((s) => ({ ...s, revealed: s.revealed + 1 }))}>다음 순서 공개</button>
              )}
            </div>
          </div>
        )}
      </StageShell>
      {editor.modal}
    </div>
  );
}
