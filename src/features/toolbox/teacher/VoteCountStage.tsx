// =====================================================================
// 투표 — 한 표씩 개표 방송 (중계 화면)
// ---------------------------------------------------------------------
// 손으로 개표하던 재미를 그대로: 한 표를 펼칠 때마다 후보의 득표가 오르고,
// 순위가 바뀌면 카드가 실제로 자리를 옮긴다.
//   1위  = 가운데, 가장 크게, 금 프레임
//   2위  = 왼쪽, 은 프레임
//   3위  = 오른쪽, 동 프레임 (2위와 같은 크기)
//   4위~ = 아래쪽에 평범한 카드
// 화면은 서버가 '지금까지 공개된 표'로 계산해 준 숫자만 그린다.
// =====================================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toolboxRpc } from '../toolbox_rpc';
import { useAction } from '../ui';
import { electionOutcome, rankScores } from '../views';
import type { VoteConfig, VoteCountView, VoteOption } from '../toolbox_types';

type Tier = 'gold' | 'silver' | 'bronze';
const TIERS: Tier[] = ['gold', 'silver', 'bronze'];
const MEDAL: Record<Tier, string> = { gold: '🥇', silver: '🥈', bronze: '🥉' };

/**
 * 득표 순서. 같은 표라면 '그 표 수에 먼저 도달한 후보'가 앞에 선다.
 * (따라잡은 후보는 한 표 더 받아야 역전 — 실제 개표판과 같은 느낌)
 * 아직 0표인 후보끼리는 처음 등록한 순서를 따른다.
 */
export function countOrder(options: VoteOption[], counts: Record<string, number>, reached: Record<string, number>): VoteOption[] {
  return options
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      const d = (counts[b.o.key] ?? 0) - (counts[a.o.key] ?? 0);
      if (d !== 0) return d;
      const ra = reached[a.o.key] ?? Number.POSITIVE_INFINITY;
      const rb = reached[b.o.key] ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return a.i - b.i;
    })
    .map((x) => x.o);
}

/** 중계 화면·운영 화면이 함께 쓰는 개표 조작 */
export function useCountControls(activityId: number, shown: number | null, onChanged: () => void) {
  const { run, busy } = useAction();
  const go = async (action: 'COUNT_START' | 'COUNT_NEXT' | 'COUNT_UNDO' | 'COUNT_ALL' | 'COUNT_RESET', ok?: string) => {
    if (busy) return null;
    const args = shown !== null && (action === 'COUNT_NEXT' || action === 'COUNT_UNDO' || action === 'COUNT_ALL') ? { expect: shown } : {};
    const r = await run(action, () => toolboxRpc.vote(supabase, activityId, action, args), ok);
    onChanged();
    return r;
  };
  return { go, busy };
}

type Flash = { id: number; hit: string[]; gain: Record<string, number>; up: Record<string, number>; lead: string | null };

export function VoteCountStage({ config, count, reduceMotion, play }: {
  config: VoteConfig; count: VoteCountView; reduceMotion?: boolean;
  play?: (name: 'tick' | 'reveal' | 'win') => void;
}) {
  const counts = count.counts ?? {};
  const order = useMemo(() => countOrder(config.options, counts, count.reached ?? {}), [config.options, counts, count.reached]); // eslint-disable-line react-hooks/exhaustive-deps
  const ranks = useMemo(() => rankScores(config.options.map((o) => ({ key: o.key, label: o.label })), counts), [config.options, counts]);
  const done = count.total > 0 && count.shown >= count.total;
  const outcome = config.mode === 'CANDIDATE' && count.shown > 0 ? electionOutcome(config, counts) : null;
  const label = (k: string) => (k === 'ABSTAIN' ? '기권' : config.options.find((o) => o.key === k)?.label ?? k);

  // ---------- 한 표가 열릴 때의 효과(+1, 순위 상승, 선두 교체) ----------
  const prev = useRef<{ shown: number; order: string[]; counts: Record<string, number> }>({
    shown: count.shown, order: order.map((o) => o.key), counts,
  });
  const [flash, setFlash] = useState<Flash | null>(null);
  useEffect(() => {
    const p = prev.current;
    const keys = order.map((o) => o.key);
    if (count.shown > p.shown) {
      const hit = config.options.map((o) => o.key).filter((k) => (counts[k] ?? 0) > (p.counts[k] ?? 0));
      const gain: Record<string, number> = {};
      hit.forEach((k) => { gain[k] = (counts[k] ?? 0) - (p.counts[k] ?? 0); });
      const up: Record<string, number> = {};
      keys.forEach((k, i) => { const before = p.order.indexOf(k); if (before > i) up[k] = before - i; });
      const lead = p.shown > 0 && keys[0] !== p.order[0] && (counts[keys[0]] ?? 0) > 0 ? keys[0] : null;
      setFlash({ id: Date.now(), hit, gain, up, lead });
      if (count.shown >= count.total) play?.('win');
      else if (lead) play?.('reveal');
      else play?.('tick');
    } else if (count.shown < p.shown) {
      setFlash(null);
    }
    prev.current = { shown: count.shown, order: keys, counts };
  }, [count.shown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash((f) => (f && f.id === flash.id ? { ...f, up: {}, lead: null } : f)), 2200);
    return () => window.clearTimeout(t);
  }, [flash?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- 순위가 바뀌면 카드가 미끄러지듯 자리를 옮긴다(FLIP) ----------
  const nodes = useRef(new Map<string, HTMLElement>());
  const rects = useRef(new Map<string, DOMRect>());
  const signature = order.map((o) => o.key).join('|');
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    nodes.current.forEach((el, key) => {
      const r = el.getBoundingClientRect();
      next.set(key, r);
      const p = rects.current.get(key);
      if (!p || reduceMotion || typeof el.animate !== 'function' || r.width === 0) return;
      const dx = (p.left + p.width / 2) - (r.left + r.width / 2);
      const dy = (p.top + p.height / 2) - (r.top + r.height / 2);
      const s = Math.max(0.45, Math.min(2.2, p.width / r.width));
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${s})`, zIndex: 5 }, { transform: 'none', zIndex: 5 }],
        { duration: 700, easing: 'cubic-bezier(.2,.85,.25,1)' },
      );
    });
    rects.current = next;
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const bind = (key: string) => (el: HTMLElement | null) => { if (el) nodes.current.set(key, el); else nodes.current.delete(key); };

  const rankText = (k: string) => {
    if ((counts[k] ?? 0) === 0) return '—';
    const r = ranks.get(k) ?? 0;
    const tied = config.options.filter((o) => (counts[o.key] ?? 0) > 0 && ranks.get(o.key) === r).length > 1;
    return `${tied ? '공동 ' : ''}${r}위`;
  };
  const tagOf = (k: string): { text: string; tone: 'win' | 'race' } | null => {
    if (!outcome) return null;
    if (outcome.elected.includes(k)) return { text: done ? '당선' : '당선권', tone: 'win' };
    if (outcome.tied.includes(k)) return { text: done ? '동률' : '경합', tone: 'race' };
    return null;
  };

  const podium = order.slice(0, 3);
  const rest = order.slice(3);
  // 화면 배치: 왼쪽 2위 · 가운데 1위 · 오른쪽 3위
  const layout = [podium[1], podium[0], podium[2]].map((o, slot) => (o ? { o, tier: TIERS[[1, 0, 2][slot]] } : null));
  const pct = count.total ? count.shown / count.total : 0;
  const last = count.last ?? null;

  return (
    <div className="tbx-lc" data-done={done}>
      <div className="tbx-lc__top">
        <div className="tbx-lc__progress">
          <div className="tbx-row" style={{ gap: '1vw', alignItems: 'baseline' }}>
            <span className="tbx-lc__label">{done ? '개표 완료' : '개표 중'}</span>
            <span className="tbx-num tbx-lc__nums">{count.shown}<small> / {count.total}표</small></span>
            {count.abstain > 0 && <span className="tbx-chip">기권 {count.abstain}</span>}
          </div>
          <div className="tbx-bar tbx-lc__bar"><div className="tbx-bar__fill" style={{ width: `${pct * 100}%` }} /></div>
          {done && outcome && (
            <div className="tbx-lc__final">
              {outcome.elected.length > 0 && <span>🎉 당선: <b>{outcome.elected.map(label).join(', ')}</b></span>}
              {outcome.tied.length > 1 && <span>남은 {outcome.seatsLeft}자리는 {outcome.tied.map(label).join(', ')} 후보가 동률이라 결선 투표로 정해요.</span>}
            </div>
          )}
        </div>
        <div key={count.shown} className="tbx-lc__slip" data-empty={!last}>
          {count.shown === 0
            ? <><span className="tbx-lc__slip-no">개표 준비</span><span className="tbx-lc__slip-pick">곧 첫 표를 펼쳐요</span></>
            : <>
                <span className="tbx-lc__slip-no">제 {count.shown}표</span>
                <span className="tbx-lc__slip-pick">{last ? last.map(label).join(' · ') : '—'}</span>
              </>}
        </div>
      </div>

      <div className="tbx-podium" data-count={podium.length}>
        {layout.map((slot, i) => slot ? (
          <div key={slot.o.key} ref={bind(slot.o.key)} className="tbx-pod" data-tier={slot.tier}
            data-hit={flash?.hit.includes(slot.o.key) ?? false} data-elected={done && tagOf(slot.o.key)?.tone === 'win'}>
            {flash?.hit.includes(slot.o.key) && <span key={`glow-${flash.id}`} className="tbx-pod__glow" aria-hidden />}
            <div className="tbx-pod__rank">{MEDAL[slot.tier]} {rankText(slot.o.key)}</div>
            {flash?.lead === slot.o.key && <div key={`lead-${flash.id}`} className="tbx-pod__lead">👑 선두 교체!</div>}
            <div className="tbx-pod__name">{slot.o.label}</div>
            {slot.o.desc && <div className="tbx-pod__desc">{slot.o.desc}</div>}
            <div className="tbx-pod__count tbx-num">
              <span key={`n-${slot.o.key}-${counts[slot.o.key] ?? 0}`} className="tbx-pod__n">{counts[slot.o.key] ?? 0}</span><small>표</small>
            </div>
            <div className="tbx-row" style={{ justifyContent: 'center', gap: '.6vw', minHeight: '1.6em' }}>
              {(() => { const t = tagOf(slot.o.key); return t ? <span className="tbx-pod__tag" data-tone={t.tone}>{t.text}</span> : null; })()}
              {flash?.up[slot.o.key] ? <span key={`up-${flash.id}`} className="tbx-pod__up">▲{flash.up[slot.o.key]}</span> : null}
            </div>
            {flash?.hit.includes(slot.o.key) && <span key={`plus-${flash.id}`} className="tbx-pod__plus">+{flash.gain[slot.o.key] ?? 1}</span>}
          </div>
        ) : <div key={`empty-${i}`} aria-hidden />)}
      </div>

      {rest.length > 0 && (
        <div className="tbx-lc__rest">
          {rest.map((o) => {
            const t = tagOf(o.key);
            return (
              <div key={o.key} ref={bind(o.key)} className="tbx-lc__row" data-hit={flash?.hit.includes(o.key) ?? false}>
                {flash?.hit.includes(o.key) && <span key={`glow-${flash.id}`} className="tbx-pod__glow" aria-hidden />}
                <span className="tbx-lc__row-rank">{rankText(o.key)}</span>
                <span className="tbx-lc__row-name">{o.label}</span>
                {t && <span className="tbx-pod__tag" data-tone={t.tone}>{t.text}</span>}
                {flash?.up[o.key] ? <span key={`up-${flash.id}`} className="tbx-pod__up">▲{flash.up[o.key]}</span> : null}
                <span key={`n-${o.key}-${counts[o.key] ?? 0}`} className="tbx-lc__row-n tbx-num">{counts[o.key] ?? 0}<small>표</small></span>
                {flash?.hit.includes(o.key) && <span key={`plus-${flash.id}`} className="tbx-pod__plus tbx-pod__plus--sm">+{flash.gain[o.key] ?? 1}</span>}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
