// 룰렛 — 남은 항목이 모두 같은 크기의 칸을 가진다. 결과를 먼저 정하고,
// 원판은 그 결과 칸에 멈추도록 돌기만 한다(연출과 결과가 항상 같다).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Notice, Toggle, randomInt } from '../ui';
import { ParticipantSection, StageShell, ToolHeader, rememberRecent, useLocalState, useParticipants, useToolChrome, type PersonalToolProps } from './common';
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
  const [editing, setEditing] = useState(p.items.length === 0);
  const wheelRef = useRef<SVGGElement | null>(null);

  const pool = useMemo(() => (save.noRepeat ? p.units.filter((u) => !save.excluded.includes(u.key)) : p.units), [p.units, save.excluded, save.noRepeat]);
  const empty = p.units.length > 0 && pool.length === 0;

  useEffect(() => { if (p.units.length === 0) setEditing(true); }, [p.units.length]);
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

  return (
    <div className="tbx tbx-page" data-reduce-motion={prefs.reduceMotion}>
      <ToolHeader tool="roulette" right={chrome} />
      <div className="tbx-split">
        <StageShell fs={fs} prefs={prefs} tall corner={fs.on ? <button className="tbx-btn tbx-btn--sm" onClick={() => void fs.toggle()}>전체 화면 끝내기</button> : undefined}>
          {p.units.length === 0 ? (
            <div className="tbx-empty"><p className="tbx-h3">돌릴 항목을 먼저 넣어 주세요</p><p className="tbx-small" style={{ marginTop: 4 }}>학생, 길드, 직접 입력한 항목 모두 넣을 수 있어요.</p></div>
          ) : (
            <div className="tbx-stack" style={{ alignItems: 'center', gap: 18 }}>
              <Wheel units={frozen ?? (pool.length ? pool : p.units)} highlight={!spinning ? winner?.key : undefined} rotation={save.rotation} spinning={spinning} reduce={prefs.reduceMotion} wheelRef={wheelRef}
                onSpin={spin} disabled={spinning || pool.length === 0} />
              <div style={{ minHeight: 76 }} aria-live="polite">
                {winner && !spinning && (
                  <div className="tbx-reveal">
                    <div className="tbx-reveal__label">{save.history.length}번째로 뽑힌 항목</div>
                    <div className="tbx-reveal__value">{winner.label}</div>
                  </div>
                )}
                {empty && !winner && <Notice icon="🎯">모든 항목이 한 번씩 뽑혔어요. 다시 모두 넣으면 처음부터 뽑을 수 있어요.</Notice>}
              </div>
              <div className="tbx-row tbx-row--wrap" style={{ justifyContent: 'center' }}>
                <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--xl" onClick={spin} disabled={spinning || pool.length === 0}>
                  {spinning ? '도는 중…' : pool.length === 0 ? '남은 항목 없음' : '돌리기'}
                </button>
                {save.noRepeat && save.excluded.length > 0 && <button type="button" className="tbx-btn tbx-btn--lg" onClick={restore} disabled={spinning}>모두 다시 넣기</button>}
              </div>
            </div>
          )}
        </StageShell>

        <div className="tbx-stack tbx-stack--loose">
          <ParticipantSection props={props} {...p} locked={!editing && p.units.length > 0} onUnlock={() => setEditing(true)} title="룰렛 항목" />
          {editing && p.units.length > 0 && <button type="button" className="tbx-btn tbx-btn--block" onClick={() => setEditing(false)}>이 항목으로 돌리기</button>}
          <section className="tbx-panel">
            <Toggle checked={save.noRepeat} title="한 번 뽑힌 항목은 다시 안 나오게"
              hint={save.noRepeat ? '뽑힌 항목은 다음 판부터 원판에서 빠져요' : '같은 항목이 여러 번 뽑힐 수 있어요'}
              onChange={(v) => setSave((s) => ({ ...s, noRepeat: v, excluded: v ? s.excluded : [] }))} disabled={spinning} />
            <hr className="tbx-divider" />
            <div className="tbx-row tbx-row--between" style={{ padding: '8px 0' }}>
              <span className="tbx-h3">뽑힌 기록</span>
              <span className="tbx-small">{save.noRepeat ? `남은 ${pool.length} / 전체 ${p.units.length}` : `전체 ${p.units.length}`}</span>
            </div>
            {save.history.length === 0 ? <p className="tbx-small">아직 돌리지 않았어요.</p> : (
              <ol className="tbx-list" style={{ maxHeight: 260, overflow: 'auto' }}>
                {save.history.map((h, i) => (
                  <li key={h.at + h.key} className="tbx-list__row">
                    <span className={i === 0 ? 'tbx-rank tbx-rank--1' : 'tbx-rank'}>{save.history.length - i}</span>
                    <span className="tbx-h3">{h.label}</span>
                  </li>
                ))}
              </ol>
            )}
            {save.history.length > 0 && (
              <button type="button" className="tbx-btn tbx-btn--ghost tbx-btn--sm" style={{ marginTop: 8 }} disabled={spinning}
                onClick={() => { setSave(() => ({ ...INITIAL, noRepeat: save.noRepeat, rotation: save.rotation })); setWinner(null); setFrozen(null); }}>기록 지우고 새로 시작</button>
            )}
          </section>
        </div>
      </div>
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
    <div className="tbx-wheel">
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

