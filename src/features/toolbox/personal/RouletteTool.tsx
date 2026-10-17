// 룰렛 — 남은 항목이 모두 같은 크기의 칸을 가진다. 결과를 먼저 정하고,
// 원판은 그 결과 칸에 멈추도록 돌기만 한다(연출과 결과가 항상 같다).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Notice, randomInt } from '../ui';
import { DockToggle, StageShell, ToolDock, ToolHeader, rememberRecent, useLocalState, useParticipantEditor, useParticipants, useToolChrome, type PersonalToolProps } from './common';
import type { Unit } from '../toolbox_types';

interface RouletteSave {
  noRepeat: boolean;
  history: { key: string; label: string; at: number }[];
  excluded: string[];
  rotation: number;
}

const INITIAL: RouletteSave = { noRepeat: true, history: [], excluded: [], rotation: 0 };

export function RouletteTool(props: PersonalToolProps) {
  const p = useParticipants(props, 'roulette');
  const { prefs, fs, chrome } = useToolChrome();
  const [save, setSave] = useLocalState<RouletteSave>(`brand.toolbox.${props.ownerKey}.roulette.state`, INITIAL);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<Unit | null>(null);
  // 돌리는 동안과 결과를 보여주는 동안은 그 판의 원판을 그대로 둔다.
  const [frozen, setFrozen] = useState<Unit[] | null>(null);
  const wheelRef = useRef<SVGGElement | null>(null);

  const pool = useMemo(() => (save.noRepeat ? p.units.filter((u) => !save.excluded.includes(u.key)) : p.units), [p.units, save.excluded, save.noRepeat]);
  const empty = p.units.length > 0 && pool.length === 0;

  useEffect(() => { setFrozen(null); setWinner(null); }, [p.items]);

  const spin = () => {
    if (spinning || pool.length === 0) return;
    const index = randomInt(pool.length);
    const chosen = pool[index];
    const seg = 360 / pool.length;
    // 칸 안에서 멈추는 위치도 무작위(가장자리 10%는 피함)
    const inside = seg * (0.1 + (randomInt(800) / 1000));
    const targetMod = (360 - (index * seg + inside)) % 360;
    const current = ((save.rotation % 360) + 360) % 360;
    const turns = prefs.reduceMotion ? 0 : 5 + randomInt(3);
    const delta = turns * 360 + ((targetMod - current + 360) % 360 || 360);
    const next = save.rotation + delta;
    if (save.history.length === 0) rememberRecent(props, '룰렛', p.items);
    setWinner(null);
    setFrozen(pool);
    setSpinning(true);
    setSave((s) => ({ ...s, rotation: next }));
    if (!prefs.reduceMotion) {
      // 칸 경계를 지날 때마다 짧은 소리
      let ticks = Math.floor(delta / seg);
      const step = Math.max(40, 3800 / Math.max(ticks, 1));
      const t = window.setInterval(() => { if (ticks-- <= 0) window.clearInterval(t); else prefs.play('tick'); }, step);
    }
    window.setTimeout(() => {
      setSpinning(false);
      setWinner(chosen);
      prefs.play('win');
      setSave((s) => ({
        ...s,
        history: [{ key: chosen.key, label: chosen.label, at: Date.now() }, ...s.history].slice(0, 200),
        excluded: s.noRepeat ? Array.from(new Set([...s.excluded, chosen.key])) : s.excluded,
      }));
    }, prefs.reduceMotion ? 350 : 4300);
  };

  const restore = () => { setSave((s) => ({ ...s, excluded: [] })); setWinner(null); setFrozen(null); };

  // 항목을 바꿔도 지금까지 뽑힌 기록은 그대로 둔다(예전과 같음). 도는 중에는 바꾸지 않는다.
  const editor = useParticipantEditor({ props, ...p, title: '룰렛 항목', disabled: spinning });
  const resetAll = () => { setSave(() => ({ ...INITIAL, noRepeat: save.noRepeat, rotation: save.rotation })); setWinner(null); setFrozen(null); };

  const dock = (
    <ToolDock primary={save.history.length > 0
      ? <button type="button" className="tbx-btn tbx-btn--ghost" disabled={spinning} onClick={resetAll}>기록 지우고 새로 시작</button>
      : undefined}>
      {editor.chip}
      <DockToggle checked={save.noRepeat} disabled={spinning} label="뽑힌 항목은 다시 안 나오게"
        title={save.noRepeat ? '뽑힌 항목은 다음 판부터 원판에서 빠져요' : '같은 항목이 여러 번 뽑힐 수 있어요'}
        onChange={(v) => setSave((s) => ({ ...s, noRepeat: v, excluded: v ? s.excluded : [] }))} />
      {p.units.length > 0 && <span className="tbx-dock-field">{save.noRepeat ? `남은 ${pool.length} / 전체 ${p.units.length}` : `전체 ${p.units.length}`}</span>}
    </ToolDock>
  );

  return (
    <div className="tbx tbx-page" data-reduce-motion={prefs.reduceMotion}>
      <ToolHeader tool="roulette" right={chrome} />
      <StageShell fs={fs} prefs={prefs} fill dock={dock}>
        {p.units.length === 0 ? (
          <div className="tbx-empty tbx-empty--stage">
            <p className="tbx-stage-title">돌릴 항목을 먼저 넣어 주세요</p>
            <p className="tbx-small">학생, 길드, 직접 입력한 항목 모두 넣을 수 있어요.</p>
            <div className="tbx-stage-actions"><button type="button" className="tbx-btn tbx-btn--brass tbx-btn--lg" onClick={editor.open}>👥 항목 고르기</button></div>
          </div>
        ) : (
          <div className="tbx-roulette">
            <Wheel units={frozen ?? (pool.length ? pool : p.units)} highlight={!spinning ? winner?.key : undefined} rotation={save.rotation} spinning={spinning} reduce={prefs.reduceMotion} wheelRef={wheelRef}
              onSpin={spin} disabled={spinning || pool.length === 0} />
            <div className="tbx-roulette__side">
              <div style={{ minHeight: 96, display: 'grid', placeItems: 'center' }} aria-live="polite">
                {winner && !spinning ? (
                  <div className="tbx-reveal">
                    <div className="tbx-reveal__label">{save.history.length}번째로 뽑힌 항목</div>
                    <div className="tbx-reveal__value">{winner.label}</div>
                  </div>
                ) : empty ? (
                  <Notice icon="🎯">모든 항목이 한 번씩 뽑혔어요. 다시 모두 넣으면 처음부터 뽑을 수 있어요.</Notice>
                ) : (
                  <p className="tbx-small" style={{ textAlign: 'center' }}>{spinning ? '원판이 돌고 있어요…' : '가운데나 아래 버튼을 눌러 돌려요.'}</p>
                )}
              </div>
              <div className="tbx-stage-actions">
                <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--xl" onClick={spin} disabled={spinning || pool.length === 0}>
                  {spinning ? '도는 중…' : pool.length === 0 ? '남은 항목 없음' : '돌리기'}
                </button>
                {save.noRepeat && save.excluded.length > 0 && <button type="button" className="tbx-btn tbx-btn--lg" onClick={restore} disabled={spinning}>모두 다시 넣기</button>}
              </div>
              <section className="tbx-well">
                <div className="tbx-row tbx-row--between" style={{ marginBottom: 4 }}>
                  <span className="tbx-h3">뽑힌 기록</span>
                  <span className="tbx-count">{save.history.length}번</span>
                </div>
                {save.history.length === 0 ? <p className="tbx-small">아직 돌리지 않았어요.</p> : (
                  <ol className="tbx-list tbx-history">
                    {save.history.map((h, i) => (
                      <li key={h.at + h.key} className="tbx-list__row" style={{ minHeight: 40, padding: '6px 2px' }}>
                        <span className={i === 0 ? 'tbx-rank tbx-rank--1' : 'tbx-rank'}>{save.history.length - i}</span>
                        <span className="tbx-h3">{h.label}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </div>
        )}
      </StageShell>
      {editor.modal}
    </div>
  );
}

function Wheel({ units, highlight, rotation, spinning, reduce, wheelRef, onSpin, disabled }: {
  units: Unit[]; highlight?: string; rotation: number; spinning: boolean; reduce: boolean; wheelRef: React.MutableRefObject<SVGGElement | null>;
  onSpin: () => void; disabled: boolean;
}) {
  const n = units.length;
  const seg = 360 / n;
  const r = 100;
  const showNames = n <= 24;
  const arc = (i: number) => {
    const a0 = ((i * seg) - 90) * Math.PI / 180;
    const a1 = (((i + 1) * seg) - 90) * Math.PI / 180;
    const large = seg > 180 ? 1 : 0;
    if (n === 1) return `M 0 -${r} A ${r} ${r} 0 1 1 -0.01 -${r} Z`;
    return `M 0 0 L ${r * Math.cos(a0)} ${r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`;
  };
  const fill = (i: number, u: Unit) => u.color ?? (n % 2 === 1 && i === n - 1 && n > 1 ? '#4a3d6b' : (i % 2 === 0 ? '#3a2f55' : '#2a2240'));
  const ink = (i: number, u: Unit) => (u.color ? '#1a1422' : (i % 2 === 0 ? '#f3d59a' : '#f4ecdd'));
  const fontSize = n <= 6 ? 11 : n <= 12 ? 9 : n <= 18 ? 7.4 : 6.2;
  return (
    <div className="tbx-wheel tbx-wheel--hero">
      <svg className="tbx-wheel__pointer" viewBox="0 0 28 34" aria-hidden="true">
        <path d="M14 33 L2 6 Q14 -2 26 6 Z" fill="#f3d59a" stroke="#2a1f0e" strokeWidth="1.5" />
        <circle cx="14" cy="9" r="3" fill="#2a1f0e" />
      </svg>
      <svg viewBox="-112 -112 224 224" role="img" aria-label={`룰렛 원판, ${n}칸`}>
        <circle r="110" fill="#120e1b" stroke="#a8854a" strokeWidth="3" />
        <circle r="104" fill="none" stroke="rgba(228,188,114,.35)" strokeWidth="1" />
        <g ref={wheelRef} style={{ transform: `rotate(${rotation}deg)`, transition: spinning ? `transform ${reduce ? 0.3 : 4.2}s cubic-bezier(.12,.72,.08,1)` : 'none' }}>
          {units.map((u, i) => (
            <g key={u.key}>
              <path d={arc(i)} fill={u.key === highlight ? '#f3d59a' : fill(i, u)} stroke="#120e1b" strokeWidth="0.8" />
              <text transform={`rotate(${i * seg + seg / 2}) translate(0 -${r * 0.62}) rotate(${i * seg + seg / 2 > 180 ? 90 : -90})`} textAnchor="middle" dominantBaseline="middle"
                fill={u.key === highlight ? '#2a1f0e' : ink(i, u)} fontSize={fontSize} fontWeight={800}>
                {showNames ? clip(u.label, n <= 8 ? 8 : 6) : i + 1}
              </text>
            </g>
          ))}
          {Array.from({ length: Math.min(n, 48) }).map((_, i) => (
            <circle key={i} cx={Math.cos(((i * (360 / Math.min(n, 48))) - 90) * Math.PI / 180) * 107} cy={Math.sin(((i * (360 / Math.min(n, 48))) - 90) * Math.PI / 180) * 107} r="1.4" fill="#f3d59a" />
          ))}
        </g>
      </svg>
      <button type="button" className="tbx-wheel__hub" onClick={onSpin} disabled={disabled} aria-label="룰렛 돌리기">{spinning ? '…' : '돌리기'}</button>
      {!showNames && (
        <ol className="tbx-small" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 10, columns: 3, columnGap: 12 }}>
          {units.map((u, i) => <li key={u.key}>{i + 1}. {u.label}</li>)}
        </ol>
      )}
    </div>
  );
}

function clip(s: string, n: number) { return s.length > n ? `${s.slice(0, n - 1)}…` : s; }

