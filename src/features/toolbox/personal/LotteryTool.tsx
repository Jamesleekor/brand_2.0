// 제비뽑기 — 결과 문구와 개수로 제비를 만들고, 똑같이 생긴 제비를 섞어 둔다.
// 제비를 고르는 순간 그 제비에 미리 정해진 결과가 공개된다.

import { useMemo, useState } from 'react';
import { Modal, Notice, Seg, Stepper, shuffle } from '../ui';
import { DockChip, StageShell, ToolDock, ToolHeader, rememberRecent, useLocalState, useParticipantEditor, useParticipants, useToolChrome, type PersonalToolProps } from './common';

interface ResultSpec { id: string; label: string; count: number; win: boolean }
interface Lot { result: string; win: boolean; openedBy?: string; order?: number }
interface LotterySave {
  mode: 'ASSIGN' | 'FREE';
  results: ResultSpec[];
  lots: Lot[] | null;
  /** ASSIGN 모드에서 지금 뽑을 사람 */
  current: string | null;
}

const INITIAL: LotterySave = {
  mode: 'ASSIGN',
  results: [{ id: 'a', label: '당첨', count: 1, win: true }, { id: 'b', label: '꽝', count: 1, win: false }],
  lots: null,
  current: null,
};

export function LotteryTool(props: PersonalToolProps) {
  const p = useParticipants(props, 'lottery');
  const { prefs, fs, chrome } = useToolChrome();
  const [save, setSave] = useLocalState<LotterySave>(`brand.toolbox.${props.ownerKey}.lottery.state`, INITIAL);
  const [newLabel, setNewLabel] = useState('');
  const [resultsOpen, setResultsOpen] = useState(false);
  const started = save.lots !== null;
  const total = save.results.reduce((n, r) => n + r.count, 0);
  const people = p.units;
  const assign = save.mode === 'ASSIGN';
  const mismatch = assign ? total - people.length : 0;
  const opened = save.lots?.filter((l) => l.openedBy !== undefined).length ?? 0;
  const assignedKeys = useMemo(() => new Set((save.lots ?? []).map((l) => l.openedBy).filter(Boolean) as string[]), [save.lots]);
  const waiting = people.filter((u) => !assignedKeys.has(u.key));

  const fitToPeople = () => {
    if (!assign || people.length === 0) return;
    const wins = save.results.filter((r) => r.win).reduce((n, r) => n + r.count, 0);
    const lose = save.results.find((r) => !r.win);
    if (!lose) return;
    setSave((s) => ({ ...s, results: s.results.map((r) => (r.id === lose.id ? { ...r, count: Math.max(0, people.length - wins - s.results.filter((x) => !x.win && x.id !== lose.id).reduce((n, x) => n + x.count, 0)) } : r)) }));
  };

  const start = () => {
    const pool: Lot[] = [];
    for (const r of save.results) for (let i = 0; i < r.count; i += 1) pool.push({ result: r.label, win: r.win });
    rememberRecent(props, '제비뽑기', p.items);
    setSave((s) => ({ ...s, lots: shuffle(pool), current: assign ? people[0]?.key ?? null : null }));
    prefs.play('reveal');
  };

  const pick = (index: number) => {
    if (!save.lots || save.lots[index].openedBy !== undefined) return;
    if (assign && !save.current) return;
    const who = assign ? save.current! : `#${opened + 1}`;
    const lots = save.lots.map((l, i) => (i === index ? { ...l, openedBy: who, order: opened + 1 } : l));
    const nextWaiting = people.filter((u) => u.key !== who && !assignedKeys.has(u.key));
    setSave((s) => ({ ...s, lots, current: assign ? nextWaiting[0]?.key ?? null : null }));
    prefs.play(save.lots[index].win ? 'win' : 'reveal');
  };

  const openRest = () => {
    if (!save.lots) return;
    let n = opened;
    const queue = assign ? waiting.map((u) => u.key) : [];
    const lots = save.lots.map((l) => (l.openedBy !== undefined ? l : { ...l, openedBy: assign ? queue.shift() ?? `#${n + 1}` : `#${n + 1}`, order: ++n }));
    setSave((s) => ({ ...s, lots, current: null }));
  };

  const labelOf = (key?: string) => (key && !key.startsWith('#') ? people.find((u) => u.key === key)?.label ?? '' : key ?? '');
  const lastOpened = save.lots?.filter((l) => l.order === opened)[0];
  const editor = useParticipantEditor({ props, ...p, locked: started, onUnlock: () => setSave((s) => ({ ...s, lots: null, current: null })) });

  const resultsSummary = save.results.map((r) => `${r.label || '(빈 문구)'} ${r.count}`).join(' · ');
  const resultsEditor = (
    <div className="tbx-stack">
      {save.results.map((r) => (
        <div key={r.id} className="tbx-row" style={{ gap: 6 }}>
          <input className="tbx-input tbx-grow" value={r.label} maxLength={20} disabled={started} aria-label="결과 문구"
            onChange={(e) => setSave((s) => ({ ...s, results: s.results.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)) }))} />
          <Stepper value={r.count} min={0} max={200} label={`${r.label} 개수`}
            onChange={(v) => !started && setSave((s) => ({ ...s, results: s.results.map((x) => (x.id === r.id ? { ...x, count: v } : x)) }))} />
          <button type="button" className={r.win ? 'tbx-btn tbx-btn--sm tbx-btn--square tbx-btn--brass' : 'tbx-btn tbx-btn--sm tbx-btn--square'} disabled={started}
            aria-pressed={r.win} title="당첨으로 표시하면 열었을 때 황금색으로 보여요"
            onClick={() => setSave((s) => ({ ...s, results: s.results.map((x) => (x.id === r.id ? { ...x, win: !x.win } : x)) }))}>★</button>
          {save.results.length > 1 && (
            <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--square tbx-btn--ghost" disabled={started} aria-label={`${r.label} 지우기`}
              onClick={() => setSave((s) => ({ ...s, results: s.results.filter((x) => x.id !== r.id) }))}>×</button>
          )}
        </div>
      ))}
      {!started && (
        <div className="tbx-row">
          <input className="tbx-input tbx-grow" placeholder="결과 추가 (예: 청소 당번)" maxLength={20} value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newLabel.trim()) { setSave((s) => ({ ...s, results: [...s.results, { id: Date.now().toString(36), label: newLabel.trim(), count: 1, win: false }] })); setNewLabel(''); } }} />
          <button type="button" className="tbx-btn tbx-btn--sm" disabled={!newLabel.trim()}
            onClick={() => { setSave((s) => ({ ...s, results: [...s.results, { id: Date.now().toString(36), label: newLabel.trim(), count: 1, win: false }] })); setNewLabel(''); }}>추가</button>
        </div>
      )}
      <p className="tbx-hint">★을 켠 결과는 열었을 때 황금색으로 보여요. 제비는 모두 {total}개예요.</p>
      {!started && assign && people.length > 0 && mismatch !== 0 && (
        <Notice tone="ember" icon="⚖️">
          참가자는 {people.length}명인데 제비는 {total}개예요. {mismatch < 0 ? `${-mismatch}개가 부족해요.` : `${mismatch}개가 많아요.`}
          <div style={{ marginTop: 8 }}><button type="button" className="tbx-btn tbx-btn--sm" onClick={fitToPeople}>당첨이 아닌 제비로 맞추기</button></div>
        </Notice>
      )}
    </div>
  );
  const canStart = !(total === 0 || save.results.some((r) => !r.label.trim()) || (assign && (people.length === 0 || mismatch !== 0)));

  const dock = (
    <ToolDock primary={!started
      ? <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--lg" disabled={!canStart} onClick={start}>제비 섞기</button>
      : <>
          <button type="button" className="tbx-btn" disabled={opened === (save.lots?.length ?? 0)} onClick={openRest}>남은 제비 모두 열기</button>
          <button type="button" className="tbx-btn tbx-btn--ghost" onClick={() => setSave((s) => ({ ...s, lots: null, current: null }))}>새로 섞기</button>
        </>}>
      <Seg value={save.mode} onChange={(v) => setSave((s) => ({ ...s, mode: v }))} label="뽑는 방식"
        options={[{ value: 'ASSIGN', label: '한 사람씩 배정' }, { value: 'FREE', label: '제비만 뽑기' }]} />
      {assign && editor.chip}
      <DockChip icon="🎟️" label="결과" value={resultsSummary} disabled={started} title={started ? '새로 섞기를 누르면 결과를 바꿀 수 있어요' : '결과 문구와 개수를 정해요'}
        tone={!started && assign && people.length > 0 && mismatch !== 0 ? 'ember' : undefined} onClick={() => setResultsOpen(true)} />
      {!started && assign && people.length > 0 && mismatch !== 0 && (
        <>
          <span className="tbx-dock-warn">참가 {people.length}명 · 제비 {total}개</span>
          <button type="button" className="tbx-btn tbx-btn--sm" onClick={fitToPeople}>꽝으로 맞추기</button>
        </>
      )}
    </ToolDock>
  );

  const history = started && opened > 0 ? (
    <section className="tbx-panel tbx-stack" aria-label="뽑은 결과">
      <div className="tbx-row tbx-row--between"><h2 className="tbx-h3">뽑은 결과</h2><span className="tbx-count">{opened} / {save.lots?.length ?? 0}</span></div>
      <ol className="tbx-results-strip">
        {[...(save.lots ?? [])].filter((l) => l.order).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((l) => (
          <li key={l.order} className="tbx-results-strip__item">
            <span className={l.win ? 'tbx-rank tbx-rank--1' : 'tbx-rank'}>{l.order}</span>
            <span>{labelOf(l.openedBy)}</span>
            <span className={l.win ? 'tbx-chip tbx-chip--brass' : 'tbx-chip'}>{l.result}</span>
          </li>
        ))}
      </ol>
    </section>
  ) : null;

  return (
    <div className="tbx tbx-page" data-reduce-motion={prefs.reduceMotion}>
      <ToolHeader tool="lottery" right={chrome} />
      <StageShell fs={fs} prefs={prefs} fill dock={dock} below={history}>
        {!started ? (
          <div className="tbx-empty tbx-empty--stage">
            <p className="tbx-stage-title">제비 {total}개를 만들 준비가 됐어요</p>
            <p className="tbx-small">{assign ? `참가자 ${people.length}명에게 한 장씩 배정해요. ` : '참가자 없이 제비만 하나씩 열어요. '}결과는 {resultsSummary}</p>
            <div className="tbx-stage-actions">
              {assign && people.length === 0 && <button type="button" className="tbx-btn tbx-btn--lg" onClick={editor.open}>👥 참가자 고르기</button>}
              <button type="button" className="tbx-btn tbx-btn--lg" onClick={() => setResultsOpen(true)}>🎟️ 결과 정하기</button>
            </div>
          </div>
        ) : (
          <div className="tbx-stack" style={{ width: '100%', gap: 16, alignSelf: 'flex-start' }}>
            <div className="tbx-stage-head" aria-live="polite">
              {assign
                ? (save.current
                  ? <span className="tbx-stage-title">지금 뽑을 사람 <span className="tbx-brass-text">{labelOf(save.current)}</span></span>
                  : <span className="tbx-stage-title">모두 뽑았어요</span>)
                : <span className="tbx-stage-title">아무 제비나 골라요</span>}
              <span className="tbx-chip">남은 제비 {(save.lots?.length ?? 0) - opened}개</span>
            </div>
            {assign && waiting.length > 1 && (
              <div className="tbx-waiting" aria-label="뽑을 사람 고르기">
                {waiting.map((u) => (
                  <button key={u.key} type="button" className="tbx-btn tbx-btn--sm" aria-pressed={u.key === save.current}
                    onClick={() => setSave((s) => ({ ...s, current: u.key }))}>{u.label}</button>
                ))}
              </div>
            )}
            <div className="tbx-lots">
              {save.lots!.map((lot, i) => {
                const open = lot.openedBy !== undefined;
                return (
                  <button key={i} type="button" className="tbx-lot" data-open={open} data-win={lot.win}
                    disabled={open || (assign && !save.current)} onClick={() => pick(i)}
                    aria-label={open ? `${lot.result}, ${labelOf(lot.openedBy)}` : `${i + 1}번 제비`}>
                    {open ? <>{lot.result}<span className="tbx-lot__who">{labelOf(lot.openedBy)}</span></> : i + 1}
                  </button>
                );
              })}
            </div>
            {lastOpened && (
              <div className="tbx-reveal" key={opened}>
                <div className="tbx-reveal__label">{labelOf(lastOpened.openedBy)}의 제비</div>
                <div className="tbx-reveal__value" style={{ color: lastOpened.win ? 'var(--tbx-brass-hi)' : 'var(--tbx-ivory)' }}>{lastOpened.result}</div>
              </div>
            )}
          </div>
        )}
      </StageShell>
      {editor.modal}
      <Modal open={resultsOpen} onClose={() => setResultsOpen(false)} title="결과와 개수"
        footer={<button type="button" className="tbx-btn tbx-btn--brass" onClick={() => setResultsOpen(false)}>완료</button>}>
        {resultsEditor}
      </Modal>
    </div>
  );
}
