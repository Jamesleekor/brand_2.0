// =====================================================================
// 학급 활동 공통 화면 — 운영 화면·중계 화면·학생 화면이 같은 그림을 쓴다.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BracketState, MatchResult, Unit, VoteConfig, VoteTally } from './toolbox_types';

// ---------------------------------------------------------------------
// 점수판
// ---------------------------------------------------------------------
type ScoreUnit = Pick<Unit, 'key' | 'label' | 'color'> & { mine?: boolean };

/** 공동 순위: 10·10·5 → 1·1·3 */
export function rankScores(units: ScoreUnit[], scores: Record<string, number>): Map<string, number> {
  const sorted = units.map((u) => scores[u.key] ?? 0).sort((a, b) => b - a);
  const ranks = new Map<string, number>();
  for (const u of units) ranks.set(u.key, sorted.indexOf(scores[u.key] ?? 0) + 1);
  return ranks;
}

export function ScoreboardBoard({ units, scores, sort, onPick, picked, compact }: {
  units: ScoreUnit[]; scores: Record<string, number>; sort: 'FIXED' | 'SCORE';
  onPick?: (key: string) => void; picked?: string | null; compact?: boolean;
}) {
  const ranks = useMemo(() => rankScores(units, scores), [units, scores]);
  const ordered = sort === 'SCORE' ? [...units].sort((a, b) => (scores[b.key] ?? 0) - (scores[a.key] ?? 0)) : units;
  const prev = useRef<Record<string, number>>(scores);
  const [deltas, setDeltas] = useState<Record<string, { v: number; id: number }>>({});
  useEffect(() => {
    const next: Record<string, { v: number; id: number }> = {};
    for (const u of units) {
      const d = (scores[u.key] ?? 0) - (prev.current[u.key] ?? 0);
      if (d !== 0) next[u.key] = { v: d, id: Date.now() + Math.random() };
    }
    prev.current = scores;
    if (Object.keys(next).length) setDeltas((old) => ({ ...old, ...next }));
  }, [scores]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="tbx-scores" data-compact={!!compact} style={compact ? { gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' } : undefined}>
      {ordered.map((u) => {
        const rank = ranks.get(u.key) ?? 0;
        const body = (
          <>
            <div className="tbx-score__name">
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.label}</span>
              {u.mine && <span className="tbx-chip tbx-chip--brass" style={{ padding: '3px 7px' }}>우리</span>}
            </div>
            <div className="tbx-score__value tbx-num">{(scores[u.key] ?? 0).toLocaleString()}</div>
            <div className="tbx-score__rank">{rank}위{units.filter((x) => (ranks.get(x.key) ?? 0) === rank).length > 1 ? ' (공동)' : ''}</div>
            {deltas[u.key] && <span key={deltas[u.key].id} className="tbx-score__delta" data-neg={deltas[u.key].v < 0}>{deltas[u.key].v > 0 ? '+' : ''}{deltas[u.key].v}</span>}
          </>
        );
        const style = { ['--team' as any]: u.color ?? '#e4bc72', ...(picked === u.key ? { borderColor: 'var(--tbx-brass)', boxShadow: '0 0 0 2px rgba(228,188,114,.35)' } : {}) };
        return onPick
          ? <button key={u.key} type="button" className="tbx-score" data-mine={u.mine} style={{ ...style, textAlign: 'left', cursor: 'pointer', color: 'inherit' }} onClick={() => onPick(u.key)} aria-pressed={picked === u.key}>{body}</button>
          : <div key={u.key} className="tbx-score" data-mine={u.mine} style={style}>{body}</div>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// 대진표 (서버 brand_toolbox.bracket_* 와 같은 규칙)
// ---------------------------------------------------------------------
export function bracketRounds(state: BracketState) { return Math.round(Math.log2(state.slots.length)); }

export function bracketSides(state: BracketState, match: string): [string | null, string | null] {
  const rounds = bracketRounds(state);
  if (match === 'T') {
    if (rounds < 2) return [null, null];
    const loser = (m: string) => {
      const s = bracketSides(state, m); const w = bracketWinner(state, m);
      if (!w || !s[0] || !s[1]) return null;
      return w === s[0] ? s[1] : s[0];
    };
    return [loser(`R${rounds - 1}-1`), loser(`R${rounds - 1}-2`)];
  }
  const [r, i] = match.slice(1).split('-').map(Number);
  if (r === 1) return [state.slots[2 * i - 2] ?? null, state.slots[2 * i - 1] ?? null];
  return [bracketWinner(state, `R${r - 1}-${2 * i - 1}`), bracketWinner(state, `R${r - 1}-${2 * i}`)];
}

export function bracketWinner(state: BracketState, match: string): string | null {
  const [a, b] = bracketSides(state, match);
  if (match.startsWith('R1-')) {
    if (!a && b) return b;
    if (!b && a) return a;
  }
  if (!a || !b) return null;
  const w = state.results?.[match]?.winner;
  return w && (w === a || w === b) ? w : null;
}

export function roundName(r: number, rounds: number) {
  const left = rounds - r;
  if (left === 0) return '결승';
  if (left === 1) return '준결승';
  return `${2 ** (left + 1)}강`;
}

export function BracketView({ state, units, onMatch, selected, reveal, highlightKeys }: {
  state: BracketState; units: (Pick<Unit, 'key' | 'label' | 'color'> & { mine?: boolean })[];
  onMatch?: (match: string) => void; selected?: string | null; reveal?: boolean; highlightKeys?: Set<string>;
}) {
  const rounds = bracketRounds(state);
  const label = (k: string | null) => (k ? units.find((u) => u.key === k)?.label ?? k : null);
  const color = (k: string | null) => (k ? units.find((u) => u.key === k)?.color : undefined);
  const final = `R${rounds}-1`;
  const champion = bracketWinner(state, final);
  const columns = Array.from({ length: rounds }, (_, idx) => {
    const r = idx + 1;
    const count = state.slots.length / 2 ** r;
    return { r, matches: Array.from({ length: count }, (_, i) => `R${r}-${i + 1}`) };
  });
  let deal = 0;
  const renderMatch = (id: string) => {
    const [a, b] = bracketSides(state, id);
    const w = bracketWinner(state, id);
    const res: MatchResult | undefined = state.results?.[id];
    const isBye = id.startsWith('R1-') && (!a || !b);
    const side = (k: string | null, score: number | undefined, other: string | null) => (
      <div className="tbx-match__side" data-win={!!w && w === k && !isBye} data-lose={!!w && !!k && w !== k} data-empty={!k}>
        {k && <span className="tbx-dot" style={{ background: color(k) ?? '#e4bc72' }} />}
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: highlightKeys?.has(k ?? '') ? 900 : undefined }}>
          {label(k) ?? (id.startsWith('R1-') ? '부전승' : (other ? '기다리는 중' : '·'))}
        </span>
        {score !== undefined && k && !isBye && <span className="tbx-match__score">{score}</span>}
      </div>
    );
    const body = (<>{side(a, res?.score_a, b)}{side(b, res?.score_b, a)}</>);
    const style = { animationDelay: `${(deal++) * 70}ms`, ...(selected === id ? { borderColor: 'var(--tbx-brass)', boxShadow: '0 0 0 2px rgba(228,188,114,.3)' } : {}) };
    const playable = !!a && !!b;
    return onMatch && playable
      ? <button key={id} type="button" className="tbx-match" style={style} onClick={() => onMatch(id)} aria-label={`${roundName(Number(id.split('-')[0].slice(1)), rounds)} ${label(a)} 대 ${label(b)}`}>{body}</button>
      : <div key={id} className="tbx-match" style={{ ...style, opacity: isBye ? 0.7 : 1 }}>{body}</div>;
  };
  return (
    <div className="tbx-stack" style={{ width: '100%' }}>
      <div className="tbx-bracket" data-reveal={reveal}>
        {columns.map((col) => (
          <div key={col.r} className="tbx-bracket__round">
            <div className="tbx-bracket__title">{roundName(col.r, rounds)}</div>
            <div className="tbx-bracket__matches">{col.matches.map((m) => renderMatch(m))}</div>
          </div>
        ))}
        <div className="tbx-bracket__round" style={{ minWidth: 150 }}>
          <div className="tbx-bracket__title">우승</div>
          <div className="tbx-bracket__matches" style={{ justifyContent: 'center', flex: 'none', marginTop: 'auto', marginBottom: 'auto' }}>
          <div className="tbx-match" style={{ borderColor: champion ? 'var(--tbx-brass)' : undefined, background: champion ? 'linear-gradient(180deg, rgba(228,188,114,.25), rgba(228,188,114,.06))' : undefined }}>
            <div className="tbx-match__side" style={{ minHeight: 64, justifyContent: 'center', fontSize: 18, fontWeight: 900, color: champion ? 'var(--tbx-brass-hi)' : 'var(--tbx-ivory-3)' }}>
              {champion ? <>🏆 {label(champion)}</> : '?'}
            </div>
          </div>
          </div>
          {state.third_place && rounds >= 2 && (
            <>
              <div className="tbx-bracket__title" style={{ marginTop: 14 }}>3위 결정전</div>
              {renderMatch('T')}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 투표 결과
// ---------------------------------------------------------------------
export function VoteResults({ config, tally, voters, confirmed }: {
  config: VoteConfig; tally: VoteTally; voters?: Record<string, string[]>; confirmed?: string[];
}) {
  const counts = tally.counts ?? {};
  const denominator = config.mode === 'YESNO' ? tally.submitted : (tally.choosers ?? tally.submitted);
  const max = Math.max(0, ...config.options.map((o) => counts[o.key] ?? 0));
  const ordered = config.mode === 'YESNO' ? config.options : [...config.options].sort((a, b) => (counts[b.key] ?? 0) - (counts[a.key] ?? 0));
  const ranks = rankScores(config.options.map((o) => ({ key: o.key, label: o.label })), counts);
  const judge = judgeYesNo(config, tally);
  return (
    <div className="tbx-stack" style={{ width: '100%' }}>
      {ordered.map((o) => {
        const c = counts[o.key] ?? 0;
        const pct = denominator > 0 ? Math.round((c / denominator) * 1000) / 10 : 0;
        return (
          <div key={o.key} className="tbx-vote-row" data-top={c === max && c > 0}>
            <div className="tbx-vote-row__line">
              {config.mode !== 'YESNO' && <span className="tbx-vote-row__rank">{ranks.get(o.key)}위</span>}
              <span className="tbx-vote-row__label">{o.label}</span>
              {confirmed?.includes(o.key) && <span className="tbx-chip tbx-chip--brass">당선</span>}
              <span className="tbx-vote-row__count tbx-num">{c}<small>표</small></span>
              <span className="tbx-vote-row__pct tbx-num">{pct}%</span>
            </div>
            <div className="tbx-bar"><div className="tbx-bar__fill" data-top={c === max && c > 0} style={{ width: `${denominator ? (c / denominator) * 100 : 0}%` }} /></div>
            {voters?.[o.key]?.length ? <div className="tbx-small" style={{ paddingLeft: 4 }}>{voters[o.key].join(', ')}</div> : null}
          </div>
        );
      })}
      <div className="tbx-row tbx-row--wrap" style={{ gap: 6 }}>
        <span className="tbx-chip">참여 {tally.submitted} / {tally.eligible}</span>
        {config.allow_abstain && <span className="tbx-chip">기권 {tally.abstain ?? 0}</span>}
        {(tally.not_voted ?? 0) > 0 && <span className="tbx-chip">미참여 {tally.not_voted}</span>}
        {(tally.invalidated ?? 0) > 0 && <span className="tbx-chip tbx-chip--ember">무효 {tally.invalidated}</span>}
      </div>
      <p className="tbx-small">
        {config.mode === 'YESNO'
          ? `비율 기준: 기권을 포함한 제출표 ${tally.submitted}표`
          : `비율 기준: 기권을 뺀 유효 투표자 ${denominator}명${config.max_choices > 1 ? ' · 여러 개를 고를 수 있어 합계가 100%를 넘을 수 있어요' : ''}`}
      </p>
      {judge && <div className={judge.pass ? 'tbx-notice tbx-notice--signal' : 'tbx-notice'}><span className="tbx-h3">{judge.pass ? '가결' : '부결'}</span> <span className="tbx-small">{judge.text}</span></div>}
    </div>
  );
}

export function judgeYesNo(config: VoteConfig, tally: VoteTally): { pass: boolean; text: string } | null {
  if (config.mode !== 'YESNO' || !config.judge || !tally.counts) return null;
  const yes = tally.counts.YES ?? 0;
  const no = tally.counts.NO ?? 0;
  if (config.judge.rule === 'ABSOLUTE') {
    return { pass: yes >= config.judge.threshold, text: `전체 대상 ${tally.eligible}명 중 찬성 ${config.judge.threshold}명 이상이 기준 (찬성 ${yes})` };
  }
  const valid = yes + no;
  const need = Math.floor(valid / 2) + 1;
  return { pass: valid > 0 && yes >= need, text: `기권을 뺀 찬반 ${valid}표 중 과반(${need}표) 찬성이 기준 (찬성 ${yes})` };
}

/** 선출 투표: 확정 당선자와 경계 동률 후보 */
export function electionOutcome(config: VoteConfig, counts: Record<string, number>) {
  // 결선 투표는 seats에 '남은 자리'가 들어 있다. confirmed는 앞선 확정자 이름(표시용)이다.
  const seats = Math.max(1, config.seats);
  const options = config.options;
  const sorted = [...options].sort((a, b) => (counts[b.key] ?? 0) - (counts[a.key] ?? 0));
  if (sorted.every((o) => (counts[o.key] ?? 0) === 0)) return { elected: [] as string[], tied: [] as string[], seatsLeft: seats };
  if (sorted.length <= seats) return { elected: sorted.filter((o) => (counts[o.key] ?? 0) > 0).map((o) => o.key), tied: [], seatsLeft: 0 };
  const cutoff = counts[sorted[seats - 1].key] ?? 0;
  const above = sorted.filter((o) => (counts[o.key] ?? 0) > cutoff).map((o) => o.key);
  const atCut = sorted.filter((o) => (counts[o.key] ?? 0) === cutoff).map((o) => o.key);
  if (above.length + atCut.length <= seats) return { elected: [...above, ...atCut], tied: [], seatsLeft: 0 };
  return { elected: above, tied: atCut, seatsLeft: seats - above.length };
}

// ---------------------------------------------------------------------
// 카드 구름 — 제목이 읽히고 눌리도록 겹치지 않게 흩어 놓는다.
// ---------------------------------------------------------------------
export function CardCloud({ cards, onOpen, selected, showHidden }: {
  cards: { id: number; title: string; author?: string; presented?: boolean; hidden?: boolean; changed?: boolean }[];
  onOpen?: (id: number) => void; selected?: number | null; showHidden?: boolean;
}) {
  const tilt = (id: number) => (((id * 2654435761) % 1000) / 1000 - 0.5) * 5;
  const visible = cards.filter((c) => showHidden || !c.hidden);
  if (visible.length === 0) return null;
  return (
    <div className="tbx-cloud">
      {visible.map((c, i) => (
        <button key={c.id} type="button" className="tbx-card" data-presented={c.presented} data-hidden={c.hidden}
          style={{ ['--tilt' as any]: `${tilt(c.id).toFixed(2)}deg`, animationDelay: `${Math.min(i, 30) * 40}ms`, outline: selected === c.id ? '3px solid var(--tbx-brass-hi)' : undefined }}
          onClick={() => onOpen?.(c.id)} disabled={!onOpen}>
          {c.title}
          {c.author && <small>{c.author}</small>}
          {c.hidden && <small>숨김</small>}
          {c.changed && <small style={{ color: '#9a4a1d' }}>수정됨</small>}
        </button>
      ))}
    </div>
  );
}
