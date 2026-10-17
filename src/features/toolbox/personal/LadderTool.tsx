// 사다리타기 — 위의 참가자와 아래의 결과를 같은 수로 놓고, 가로줄을 무작위로 놓는다.
// 가로줄 규칙상 출발점마다 도착점이 하나씩 정해진다(겹치는 도착점 없음).

import { useMemo, useState } from 'react';
import { Notice, randomInt } from '../ui';
import { ParticipantSection, StageShell, ToolHeader, rememberRecent, useLocalState, useParticipants, useToolChrome, type PersonalToolProps } from './common';

interface LadderSave { resultsText: string; rungs: boolean[][] | null; revealed: string[] }
const INITIAL: LadderSave = { resultsText: '', rungs: null, revealed: [] };

const COL_W = 76;
const ROW_H = 24;

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

  const width = Math.max(n, 1) * COL_W;
  const rows = save.rungs?.length ?? 10;
  const height = (rows + 1.2) * ROW_H;
  const x = (c: number) => c * COL_W + COL_W / 2;
  const y = (r: number) => (r + 0.6) * ROW_H;
  const pathD = (pts: [number, number][]) => pts.map(([c, r], i) => `${i ? 'L' : 'M'}${x(c)} ${y(r)}`).join(' ');
  const pathLen = (pts: [number, number][]) => pts.reduce((s, [c, r], i) => (i ? s + Math.abs(x(c) - x(pts[i - 1][0])) + Math.abs(y(r) - y(pts[i - 1][1])) : 0), 0);
  const activeIndex = p.units.findIndex((u) => u.key === active);
  const grid = { display: 'grid', gridTemplateColumns: `repeat(${Math.max(n, 1)}, ${COL_W}px)`, width } as const;

  return (
    <div className="tbx tbx-page" data-reduce-motion={prefs.reduceMotion}>
      <ToolHeader tool="ladder" right={chrome} />
      <div className="tbx-split">
        <StageShell fs={fs} prefs={prefs} tall corner={fs.on ? <button className="tbx-btn tbx-btn--sm" onClick={() => void fs.toggle()}>전체 화면 끝내기</button> : undefined}>
          {!started ? (
            <div className="tbx-empty">
              <p className="tbx-h2">{n >= 2 ? `${n}명의 사다리를 만들 수 있어요` : '참가자를 두 명 이상 넣어 주세요'}</p>
              <p className="tbx-small" style={{ marginTop: 6 }}>결과도 참가자 수와 똑같이 적어야 해요.</p>
            </div>
          ) : (
            <div className="tbx-stack" style={{ width: '100%', gap: 12 }}>
              <div className="tbx-row tbx-row--between">
                <span className="tbx-h3">이름을 누르면 길을 따라 내려가요</span>
                <span className="tbx-chip">{save.revealed.length} / {n}</span>
              </div>
              <div className="tbx-ladder">
                <div style={{ width, margin: '0 auto' }}>
                  <div style={{ ...grid, gap: 0 }}>
                    {p.units.map((u) => (
                      <div key={u.key} style={{ padding: '0 4px' }}>
                        <button type="button" className="tbx-ladder__name" data-done={save.revealed.includes(u.key)} onClick={() => reveal(u.key)}>{u.label}</button>
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
                      return (
                        <div key={c} style={{ padding: '0 4px' }}>
                          <div className="tbx-ladder__result" data-hit={hit && owner === active}>{hit ? results[c] : '?'}</div>
                          {hit && <div className="tbx-small" style={{ textAlign: 'center', marginTop: 4, fontWeight: 800 }}>{p.units.find((u) => u.key === owner)?.label}</div>}
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

        <div className="tbx-stack tbx-stack--loose">
          <ParticipantSection props={props} {...p} locked={started} onUnlock={() => setSave((s) => ({ ...s, rungs: null, revealed: [] }))} />
          <section className="tbx-panel tbx-stack">
            <div className="tbx-row tbx-row--between"><h2 className="tbx-h2">아래 결과</h2><span className="tbx-count">{results.length} / {n}</span></div>
            <textarea className="tbx-textarea" disabled={started} placeholder={'한 줄에 하나씩 적어요\n예: 발표, 정리, 칠판'} value={save.resultsText}
              onChange={(e) => setSave((s) => ({ ...s, resultsText: e.target.value }))} aria-label="결과 목록" />
            {!started && n >= 2 && (
              <div className="tbx-row tbx-row--wrap">
                <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => setSave((s) => ({ ...s, resultsText: Array.from({ length: n }, (_, i) => `${i + 1}번`).join('\n') }))}>1번부터 번호로 채우기</button>
                <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => setSave((s) => ({ ...s, resultsText: ['당첨', ...Array.from({ length: n - 1 }, () => '꽝')].join('\n') }))}>당첨 1 · 나머지 꽝</button>
              </div>
            )}
            {!started && n >= 2 && results.length !== n && <Notice tone="ember" icon="⚖️">결과가 {results.length}개예요. 참가자 {n}명과 같은 수로 맞춰 주세요.</Notice>}
            {!started
              ? <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--lg tbx-btn--block" disabled={n < 2 || results.length !== n} onClick={start}>사다리 만들기</button>
              : <div className="tbx-row tbx-row--wrap">
                  <button type="button" className="tbx-btn" onClick={revealAll} disabled={save.revealed.length === n}>모두 공개</button>
                  <button type="button" className="tbx-btn tbx-btn--ghost" onClick={() => setSave((s) => ({ ...s, rungs: null, revealed: [] }))}>새 사다리</button>
                </div>}
          </section>
        </div>
      </div>
    </div>
  );
}
