// 사다리타기 — 위의 참가자와 아래의 결과를 같은 수로 놓고, 가로줄을 무작위로 놓는다.
// 가로줄 규칙상 출발점마다 도착점이 하나씩 정해진다(겹치는 도착점 없음).

import { useMemo, useState } from 'react';
import { Modal, Notice, randomInt } from '../ui';
import { DockChip, StageShell, ToolDock, ToolHeader, rememberRecent, useElementWidth, useLocalState, useParticipantEditor, useParticipants, useToolChrome, useViewportHeight, type PersonalToolProps } from './common';

interface LadderSave { resultsText: string; rungs: boolean[][] | null; revealed: string[] }
const INITIAL: LadderSave = { resultsText: '', rungs: null, revealed: [] };

/** 세로줄 사이 최소 간격. 이보다 좁아지면(휴대폰) 옆으로 밀어서 본다. */
const MIN_COL = 40;

function makeRungs(n: number): boolean[][] {
  const rows = Math.max(10, Math.min(28, n * 2 + 4));
  const out: boolean[][] = [];
  for (let r = 0; r < rows; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < n - 1; c += 1) row.push(!row[c - 1] && randomInt(100) < 42);
    out.push(row);
  }
  // 이웃한 세로줄 사이마다 가로줄이 하나 이상 있도록 보정
  for (let c = 0; c < n - 1; c += 1) {
    if (!out.some((row) => row[c])) {
      const r = randomInt(rows);
      if (!out[r][c - 1] && !out[r][c + 1]) out[r][c] = true;
      else { const r2 = (r + 1) % rows; out[r2][c] = true; if (out[r2][c - 1]) out[r2][c - 1] = false; if (out[r2][c + 1]) out[r2][c + 1] = false; }
    }
  }
  return out;
}

function trace(rungs: boolean[][], start: number) {
  let c = start;
  const pts: [number, number][] = [[c, -0.6]];
  rungs.forEach((row, r) => {
    const y = r + 0.5;
    if (row[c]) { pts.push([c, y], [c + 1, y]); c += 1; }
    else if (c > 0 && row[c - 1]) { pts.push([c, y], [c - 1, y]); c -= 1; }
  });
  pts.push([c, rungs.length + 0.6]);
  return { end: c, pts };
}

export function LadderTool(props: PersonalToolProps) {
  const p = useParticipants(props, 'ladder');
  const { prefs, fs, chrome } = useToolChrome();
  const [save, setSave] = useLocalState<LadderSave>(`brand.toolbox.${props.ownerKey}.ladder.state`, INITIAL);
  const [active, setActive] = useState<string | null>(null);
  const n = p.units.length;
  const results = save.resultsText.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 64);
  const started = save.rungs !== null && save.rungs[0]?.length === Math.max(n - 1, 0);
  const paths = useMemo(() => (started ? p.units.map((_, i) => trace(save.rungs!, i)) : []), [started, save.rungs, p.units]);
  const endToUnit = new Map(paths.map((t, i) => [t.end, p.units[i]?.key] as const));

  const start = () => {
    rememberRecent(props, '사다리타기', p.items);
    setSave((s) => ({ ...s, rungs: makeRungs(n), revealed: [] }));
  };
  const reveal = (key: string) => {
    setActive(key);
    setSave((s) => ({ ...s, revealed: s.revealed.includes(key) ? s.revealed : [...s.revealed, key] }));
    prefs.play('reveal');
  };
  const revealAll = () => { setSave((s) => ({ ...s, revealed: p.units.map((u) => u.key) })); setActive(null); };

  // 무대 폭을 재서 세로줄 간격을 정한다 → 24명도 한 화면에 모두 보인다.
  const [measureRef, boxW] = useElementWidth<HTMLDivElement>();
  const vh = useViewportHeight();
  const [resultsOpen, setResultsOpen] = useState(false);
  const COL_W = boxW > 0 ? Math.max(MIN_COL, Math.min(120, Math.floor(boxW / Math.max(n, 1)))) : 76;
  const dense = COL_W < 60;
  const rows = save.rungs?.length ?? 10;
  // 사다리 높이도 화면 높이에 맞춘다(머리말·이름줄·결과줄 몫을 빼고).
  const ROW_H = Math.max(14, Math.min(26, Math.floor(((fs.on ? vh - 250 : vh - 520)) / (rows + 1.2))));
  const width = Math.max(n, 1) * COL_W;
  const height = (rows + 1.2) * ROW_H;
  const x = (c: number) => c * COL_W + COL_W / 2;
  const y = (r: number) => (r + 0.6) * ROW_H;
  const pathD = (pts: [number, number][]) => pts.map(([c, r], i) => `${i ? 'L' : 'M'}${x(c)} ${y(r)}`).join(' ');
  const pathLen = (pts: [number, number][]) => pts.reduce((s, [c, r], i) => (i ? s + Math.abs(x(c) - x(pts[i - 1][0])) + Math.abs(y(r) - y(pts[i - 1][1])) : 0), 0);
  const activeIndex = p.units.findIndex((u) => u.key === active);
  const grid = { display: 'grid', gridTemplateColumns: `repeat(${Math.max(n, 1)}, ${COL_W}px)`, width } as const;
  const cellPad = dense ? '0 2px' : '0 4px';
  const editor = useParticipantEditor({ props, ...p, locked: started, onUnlock: () => setSave((s) => ({ ...s, rungs: null, revealed: [] })) });
  const mismatch = n >= 2 && results.length !== n;
  const fillNumbers = () => setSave((s) => ({ ...s, resultsText: Array.from({ length: n }, (_, i) => `${i + 1}번`).join('\n') }));
  const fillOneWin = () => setSave((s) => ({ ...s, resultsText: ['당첨', ...Array.from({ length: n - 1 }, () => '꽝')].join('\n') }));

  const dock = (
    <ToolDock primary={!started
      ? <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--lg" disabled={n < 2 || results.length !== n} onClick={start}>사다리 만들기</button>
      : <>
          <button type="button" className="tbx-btn" onClick={revealAll} disabled={save.revealed.length === n}>모두 공개</button>
          <button type="button" className="tbx-btn tbx-btn--ghost" onClick={() => setSave((s) => ({ ...s, rungs: null, revealed: [] }))}>새 사다리</button>
        </>}>
      {editor.chip}
      <DockChip icon="🏁" label="아래 결과" value={`${results.length} / ${n}`} tone={mismatch ? 'ember' : undefined} disabled={started}
        title={started ? '새 사다리를 누르면 결과를 바꿀 수 있어요' : '한 줄에 하나씩 적어요'} onClick={() => setResultsOpen(true)} />
      {!started && mismatch && <span className="tbx-dock-warn">결과를 참가자 수({n})와 맞춰 주세요</span>}
    </ToolDock>
  );

  return (
    <div className="tbx tbx-page" data-reduce-motion={prefs.reduceMotion}>
      <ToolHeader tool="ladder" right={chrome} />
      <StageShell fs={fs} prefs={prefs} fill dock={dock}>
        {!started ? (
          <div className="tbx-empty tbx-empty--stage">
            <p className="tbx-stage-title">{n >= 2 ? `${n}명의 사다리를 만들 수 있어요` : '참가자를 두 명 이상 넣어 주세요'}</p>
            <p className="tbx-small">결과도 참가자 수와 똑같이 적어야 해요. 지금 결과 {results.length}개.</p>
            <div className="tbx-stage-actions">
              {n < 2 && <button type="button" className="tbx-btn tbx-btn--lg" onClick={editor.open}>👥 참가자 고르기</button>}
              {n >= 2 && <button type="button" className="tbx-btn tbx-btn--lg" onClick={fillNumbers}>1번부터 번호로 채우기</button>}
              {n >= 2 && <button type="button" className="tbx-btn tbx-btn--lg" onClick={fillOneWin}>당첨 1 · 나머지 꽝</button>}
              <button type="button" className="tbx-btn tbx-btn--lg" onClick={() => setResultsOpen(true)}>🏁 결과 직접 적기</button>
            </div>
          </div>
        ) : (
          <div className="tbx-stack" style={{ width: '100%', gap: 10, alignSelf: 'flex-start' }}>
            <div className="tbx-stage-head">
              <span className="tbx-stage-title">이름을 누르면 길을 따라 내려가요</span>
              <span className="tbx-chip">{save.revealed.length} / {n}</span>
            </div>
            <div className="tbx-ladder" ref={measureRef} data-dense={dense}>
              <div className="tbx-ladder__inner" style={{ width }}>
                <div style={{ ...grid, gap: 0 }}>
                  {p.units.map((u) => (
                    <div key={u.key} style={{ padding: cellPad }}>
                      <button type="button" className="tbx-ladder__name" data-done={save.revealed.includes(u.key)} title={u.label} onClick={() => reveal(u.key)}>{u.label}</button>
                    </div>
                  ))}
                </div>
                <svg width={width} height={height} role="img" aria-label="사다리">
                  {Array.from({ length: n }).map((_, c) => <line key={c} x1={x(c)} x2={x(c)} y1={y(-0.6)} y2={y(rows + 0.6)} stroke="rgba(244,236,221,.32)" strokeWidth="3" strokeLinecap="round" />)}
                  {save.rungs!.map((row, r) => row.map((on, c) => on && (
                    <line key={`${r}-${c}`} x1={x(c)} x2={x(c + 1)} y1={y(r + 0.5)} y2={y(r + 0.5)} stroke="rgba(244,236,221,.32)" strokeWidth="3" strokeLinecap="round" />
                  )))}
                  {paths.map((t, i) => {
                    const key = p.units[i].key;
                    if (!save.revealed.includes(key)) return null;
                    const len = pathLen(t.pts);
                    const isActive = i === activeIndex;
                    return (
                      <path key={key} d={pathD(t.pts)} fill="none" stroke={isActive ? '#f3d59a' : (p.units[i].color ?? 'rgba(228,188,114,.55)')}
                        strokeWidth={isActive ? 5 : 3.5} strokeLinejoin="round" strokeLinecap="round"
                        style={isActive && !prefs.reduceMotion ? { strokeDasharray: len, strokeDashoffset: len, animation: `tbx-draw ${Math.min(2.4, 0.6 + len / 900)}s ease-in-out forwards` } : undefined} />
                    );
                  })}
                </svg>
                <div style={{ ...grid, gap: 0 }}>
                  {Array.from({ length: n }).map((_, c) => {
                    const owner = endToUnit.get(c);
                    const hit = owner !== undefined && save.revealed.includes(owner);
                    const ownerLabel = hit ? p.units.find((u) => u.key === owner)?.label : undefined;
                    return (
                      <div key={c} style={{ padding: cellPad }}>
                        <div className="tbx-ladder__result" data-hit={hit && owner === active} title={hit ? results[c] : undefined}>{hit ? results[c] : '?'}</div>
                        {hit && <div className="tbx-ladder__owner" title={ownerLabel}>{ownerLabel}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <style>{'@keyframes tbx-draw { to { stroke-dashoffset: 0; } }'}</style>
          </div>
        )}
      </StageShell>
      {editor.modal}
      <Modal open={resultsOpen} onClose={() => setResultsOpen(false)} title="아래 결과"
        footer={<button type="button" className="tbx-btn tbx-btn--brass" onClick={() => setResultsOpen(false)}>완료</button>}>
        <div className="tbx-stack">
          <div className="tbx-row tbx-row--between"><span className="tbx-small">한 줄에 하나씩 적어요. 참가자 수와 같아야 해요.</span><span className="tbx-count">{results.length} / {n}</span></div>
          <textarea className="tbx-textarea" style={{ minHeight: 220 }} disabled={started} placeholder={'한 줄에 하나씩 적어요\n예: 발표, 정리, 칠판'} value={save.resultsText}
            onChange={(e) => setSave((s) => ({ ...s, resultsText: e.target.value }))} aria-label="결과 목록" />
          {!started && n >= 2 && (
            <div className="tbx-row tbx-row--wrap">
              <button type="button" className="tbx-btn tbx-btn--sm" onClick={fillNumbers}>1번부터 번호로 채우기</button>
              <button type="button" className="tbx-btn tbx-btn--sm" onClick={fillOneWin}>당첨 1 · 나머지 꽝</button>
            </div>
          )}
          {!started && mismatch && <Notice tone="ember" icon="⚖️">결과가 {results.length}개예요. 참가자 {n}명과 같은 수로 맞춰 주세요.</Notice>}
        </div>
      </Modal>
    </div>
  );
}
