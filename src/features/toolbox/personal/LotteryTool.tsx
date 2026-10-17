// 제비뽑기 — 결과 문구와 개수로 제비를 만들고, 똑같이 생긴 제비를 섞어 둔다.
// 제비를 고르는 순간 그 제비에 미리 정해진 결과가 공개된다.

import { useMemo, useState } from 'react';
import { Notice, Seg, Stepper, shuffle } from '../ui';
import { ParticipantSection, StageShell, ToolHeader, rememberRecent, useLocalState, useParticipants, useToolChrome, type PersonalToolProps } from './common';

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

  return (
    <div className="tbx tbx-page" data-reduce-motion={prefs.reduceMotion}>
      <ToolHeader tool="lottery" right={chrome} />
      <div className="tbx-split">
        <StageShell fs={fs} prefs={prefs} tall corner={fs.on ? <button className="tbx-btn tbx-btn--sm" onClick={() => void fs.toggle()}>전체 화면 끝내기</button> : undefined}>
          {!started ? (
            <div className="tbx-empty">
              <p className="tbx-h2">제비 {total}개를 만들 준비가 됐어요</p>
              <p className="tbx-small" style={{ marginTop: 6 }}>오른쪽에서 결과와 개수를 정하고 ‘제비 섞기’를 눌러 주세요.</p>
            </div>
          ) : (
            <div className="tbx-stack" style={{ width: '100%', gap: 16 }}>
              {assign && (
                <div className="tbx-row tbx-row--between tbx-row--wrap" aria-live="polite">
                  {save.current
                    ? <span className="tbx-h2">지금 뽑을 사람 <span className="tbx-brass-text">{labelOf(save.current)}</span></span>
                    : <span className="tbx-h2">모두 뽑았어요</span>}
                  <span className="tbx-chip">남은 제비 {(save.lots?.length ?? 0) - opened}개</span>
                </div>
              )}
              {assign && waiting.length > 1 && (
                <div className="tbx-selected" aria-label="뽑을 사람 고르기">
                  {waiting.map((u) => (
                    <button key={u.key} type="button" className="tbx-btn tbx-btn--sm" aria-pressed={u.key === save.current}
                      style={u.key === save.current ? { borderColor: 'var(--tbx-brass)', color: 'var(--tbx-brass-hi)' } : undefined}
                      onClick={() => setSave((s) => ({ ...s, current: u.key }))}>{u.label}</button>
                  ))}
                </div>
              )}
              {!assign && <div className="tbx-row tbx-row--between"><span className="tbx-h2">아무 제비나 골라요</span><span className="tbx-chip">남은 제비 {(save.lots?.length ?? 0) - opened}개</span></div>}
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

        <div className="tbx-stack tbx-stack--loose">
          <section className="tbx-panel tbx-stack">
            <h2 className="tbx-h2">뽑는 방식</h2>
            <Seg block value={save.mode} onChange={(v) => setSave((s) => ({ ...s, mode: v }))} label="뽑는 방식"
              options={[{ value: 'ASSIGN', label: '한 사람씩 배정' }, { value: 'FREE', label: '제비만 뽑기' }]} />
            <p className="tbx-small">{assign ? '참가자마다 제비를 하나씩 뽑아요. 제비 수가 참가자 수와 같아야 해요.' : '참가자 없이 제비만 하나씩 열어요.'}</p>
          </section>

          {assign && <ParticipantSection props={props} {...p} locked={started} onUnlock={() => setSave((s) => ({ ...s, lots: null }))} />}

          <section className="tbx-panel tbx-stack">
            <div className="tbx-row tbx-row--between"><h2 className="tbx-h2">결과와 개수</h2><span className="tbx-count">제비 {total}개</span></div>
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
            {!started && assign && people.length > 0 && mismatch !== 0 && (
              <Notice tone="ember" icon="⚖️">
                참가자는 {people.length}명인데 제비는 {total}개예요. {mismatch < 0 ? `${-mismatch}개가 부족해요.` : `${mismatch}개가 많아요.`}
                <div style={{ marginTop: 8 }}><button type="button" className="tbx-btn tbx-btn--sm" onClick={fitToPeople}>당첨이 아닌 제비로 맞추기</button></div>
              </Notice>
            )}
            {!started ? (
              <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--lg tbx-btn--block"
                disabled={total === 0 || save.results.some((r) => !r.label.trim()) || (assign && (people.length === 0 || mismatch !== 0))} onClick={start}>제비 섞기</button>
            ) : (
              <div className="tbx-row tbx-row--wrap">
                <button type="button" className="tbx-btn" disabled={opened === (save.lots?.length ?? 0)} onClick={openRest}>남은 제비 모두 열기</button>
                <button type="button" className="tbx-btn tbx-btn--ghost" onClick={() => setSave((s) => ({ ...s, lots: null, current: null }))}>새로 섞기</button>
              </div>
            )}
          </section>

          {started && opened > 0 && (
            <section className="tbx-panel">
              <h2 className="tbx-h2" style={{ marginBottom: 6 }}>뽑은 결과</h2>
              <ol className="tbx-list" style={{ maxHeight: 280, overflow: 'auto' }}>
                {[...(save.lots ?? [])].filter((l) => l.order).sort((a, b) => (b.order ?? 0) - (a.order ?? 0)).map((l) => (
                  <li key={l.order} className="tbx-list__row">
                    <span className={l.win ? 'tbx-rank tbx-rank--1' : 'tbx-rank'}>{l.order}</span>
                    <span className="tbx-grow tbx-h3">{labelOf(l.openedBy)}</span>
                    <span className={l.win ? 'tbx-chip tbx-chip--brass' : 'tbx-chip'}>{l.result}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
