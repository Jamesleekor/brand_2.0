// =====================================================================
// 교사 — 교실 대형 화면(중계 화면)
// ---------------------------------------------------------------------
// 운영 화면에서 새 창으로 띄운다. 비공개 정보(학생별 투표, 숨긴 카드,
// 작성자 숨김 상태의 이름, 운영 메모)는 서버가 처음부터 보내지 않는다.
// =====================================================================

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';
import { useLiveResource, useToolboxPulse } from '../useToolboxPulse';
import { toToolboxError, toolboxRpc } from '../toolbox_rpc';
import { Glyph, KIND_GLYPH, KIND_LABEL, useFullscreen, useToolboxPrefs } from '../ui';
import { BracketView, CardCloud, ScoreboardBoard, VoteResults, electionOutcome } from '../views';
import type { BroadcastState, VoteConfig } from '../toolbox_types';
import '../toolbox.css';

export function ToolboxBroadcastPage() {
  const { id } = useParams<{ id: string }>();
  const activityId = Number(id);
  const classroomId = useAuthStore((s) => s.context?.classroomId ?? null);
  const pulse = useToolboxPulse(supabase, classroomId, 'T');
  const [boardId, setBoardId] = useState<number | null>(null);
  const res = useLiveResource<BroadcastState>(`cast:${activityId}`, () => toolboxRpc.broadcast(supabase, activityId), {
    enabled: Number.isFinite(activityId), rev: pulse.rev, revInitial: pulse.initial, debounceMs: 60,
    relevant: () => { const a = Number(pulse.payload.activity_id ?? 0); return !a || a === activityId || a === boardId; },
  });
  const b = res.data;
  useEffect(() => { setBoardId(b?.config?.scoreboard_id ?? null); }, [b?.config?.scoreboard_id]);
  const fs = useFullscreen<HTMLDivElement>();
  const prefs = useToolboxPrefs();
  const lastPressCount = useRef(0);
  useEffect(() => {
    const n = b?.presses?.length ?? 0;
    if (n > lastPressCount.current && n === 1) prefs.play('buzz');
    lastPressCount.current = n;
  }, [b?.presses?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const gone = res.error && toToolboxError(res.error).code === 'P7T02';
  return (
    <div ref={fs.ref} className="tbx tbx-cast" data-reduce-motion={prefs.reduceMotion}>
      <div className="tbx-cast__bar">
        <div className="tbx-row" style={{ gap: '1.2vw', minWidth: 0 }}>
          {b && <Glyph name={KIND_GLYPH[b.kind]} size="lg" />}
          <div style={{ minWidth: 0 }}>
            <div className="tbx-cast__title">{b?.title ?? '모험가 도구함'}</div>
            {b && <div className="tbx-small" style={{ fontSize: 'clamp(13px, 1.1vw, 20px)' }}>{KIND_LABEL[b.kind]}</div>}
          </div>
        </div>
        <div className="tbx-row tbx-cast__controls">
          {!pulse.connected && <span className="tbx-chip tbx-chip--ember">연결 확인 중</span>}
          <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => prefs.setSound(!prefs.sound)}>{prefs.sound ? '🔊' : '🔇'}</button>
          <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => void fs.toggle()}>{fs.on ? '전체 화면 끝내기' : '⛶ 전체 화면'}</button>
        </div>
      </div>
      <div className="tbx-cast__main">
        {gone && <CastMessage title="이 활동은 끝났어요" body="운영 화면에서 새 활동을 열어 주세요." />}
        {!b && !gone && <CastMessage title="불러오는 중…" />}
        {b?.kind === 'BUZZER' && <CastBuzzer b={b} />}
        {b?.kind === 'SCOREBOARD' && <ScoreboardBoard units={b.participants} scores={b.state.scores ?? {}} sort={b.config.sort ?? 'FIXED'} />}
        {b?.kind === 'TOURNAMENT' && (b.state.revealed_at
          ? <div className="tbx-cast-bracket"><BracketView state={b.state} units={b.participants} reveal={Date.now() - new Date(b.state.revealed_at).getTime() < 20_000} /></div>
          : <CastMessage title="대진을 준비하고 있어요" body="곧 대진표가 공개돼요." />)}
        {b?.kind === 'VOTE' && <CastVote b={b} />}
        {b?.kind === 'CARDS' && <CastCards b={b} />}
      </div>
    </div>
  );
}

function CastMessage({ title, body }: { title: string; body?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="tbx-cast__title">{title}</div>
      {body && <p className="tbx-body" style={{ fontSize: 'clamp(16px, 1.6vw, 28px)', marginTop: '1.5vh' }}>{body}</p>}
    </div>
  );
}

function CastBuzzer({ b }: { b: BroadcastState }) {
  const s = b.state;
  const presses = b.presses ?? [];
  const label = (k: string) => b.participants.find((u) => u.key === k);
  const judgments: any[] = s.judgments ?? [];
  const board = b.scoreboard;
  return (
    <div style={{ width: '100%', display: 'grid', gridTemplateColumns: board ? 'minmax(0, 1.4fr) minmax(0, 1fr)' : '1fr', gap: '3vw', alignItems: 'start' }}>
      <div>
        <div className="tbx-row" style={{ gap: '1.2vw', marginBottom: '2.4vh' }}>
          <span className="tbx-chip" style={{ fontSize: 'clamp(14px, 1.3vw, 24px)', padding: '0.7em 1.1em' }}>{s.round_no ? `${s.round_no}번 문제` : '준비'}</span>
          <span className="tbx-chip tbx-chip--brass" style={{ fontSize: 'clamp(14px, 1.3vw, 24px)', padding: '0.7em 1.1em' }}>{s.points}점</span>
          {s.round_status === 'OPEN' && <span className="tbx-chip tbx-chip--live" style={{ fontSize: 'clamp(14px, 1.3vw, 24px)', padding: '0.7em 1.1em' }}>누르세요!</span>}
          {s.round_status === 'CLOSED' && <span className="tbx-chip" style={{ fontSize: 'clamp(14px, 1.3vw, 24px)', padding: '0.7em 1.1em' }}>입력 마감</span>}
        </div>
        {presses.length === 0 ? (
          <div className="tbx-cast__title" style={{ opacity: 0.85 }}>{s.round_status === 'OPEN' ? '가장 먼저 누를 사람은?' : '문제를 기다리는 중'}</div>
        ) : (
          <ol>
            {presses.slice(0, 8).map((p) => {
              const u = label(p.unit_key);
              const j = judgments.find((x) => x.unit_key === p.unit_key);
              return (
                <li key={p.unit_key} className="tbx-cast-rank" style={{ animation: 'tbx-pop .3s ease-out' }}>
                  <span className="tbx-cast-rank__n">{p.rank}</span>
                  {u?.color && <span className="tbx-dot" style={{ background: u.color, width: '1.2vw', height: '1.2vw', minWidth: 12, minHeight: 12 }} />}
                  <span className="tbx-cast-rank__who">{u?.type === 'STUDENT' ? p.student_name : u?.label}{u?.type !== 'STUDENT' && <span className="tbx-small" style={{ fontSize: '0.45em', marginLeft: '0.6em' }}>{p.student_name}</span>}</span>
                  {j && <span className={j.verdict === 'CORRECT' ? 'tbx-chip tbx-chip--brass' : 'tbx-chip'} style={{ fontSize: 'clamp(14px, 1.4vw, 26px)', padding: '0.6em 1em' }}>{j.verdict === 'CORRECT' ? `정답 +${j.points ?? s.points}` : '오답'}</span>}
                  {!j && p.rank > 1 && typeof p.ms === 'number' && <span className="tbx-cast-rank__ms">+{((p.ms - (presses[0].ms ?? 0)) / 1000).toFixed(2)}초</span>}
                </li>
              );
            })}
          </ol>
        )}
        {(b.false_starts?.length ?? 0) > 0 && (
          <div className="tbx-row tbx-row--wrap" style={{ marginTop: '2vh' }}>
            {b.false_starts!.map((f, i) => <span key={i} className="tbx-chip tbx-chip--ember" style={{ fontSize: 'clamp(13px, 1.1vw, 20px)' }}>부정출발 {f.student_name}</span>)}
          </div>
        )}
      </div>
      {board && <ScoreboardBoard units={b.participants} scores={board.scores ?? {}} sort="SCORE" compact />}
    </div>
  );
}

function CastVote({ b }: { b: BroadcastState }) {
  const cfg = b.config as VoteConfig;
  const tally = b.tally!;
  const revealed = !!tally.counts;
  const outcome = cfg.mode === 'CANDIDATE' && tally.counts ? electionOutcome(cfg, tally.counts) : null;
  if (!revealed) {
    const pct = tally.eligible ? tally.submitted / tally.eligible : 0;
    return (
      <div style={{ textAlign: 'center', width: 'min(70vw, 1000px)' }}>
        {cfg.description && <p className="tbx-body" style={{ fontSize: 'clamp(18px, 1.8vw, 32px)', marginBottom: '3vh', color: 'var(--tbx-ivory)' }}>{cfg.description}</p>}
        <div className="tbx-num" style={{ fontSize: 'clamp(64px, 11vw, 200px)', lineHeight: 1 }}>{tally.submitted}<span style={{ fontSize: '0.4em', color: 'var(--tbx-ivory-2)' }}> / {tally.eligible}</span></div>
        <div className="tbx-h2" style={{ fontSize: 'clamp(18px, 1.8vw, 32px)', marginTop: '1.5vh' }}>{b.status === 'OPEN' ? '명이 투표했어요' : '투표 마감 — 결과 발표를 기다려요'}</div>
        <div className="tbx-bar" style={{ marginTop: '4vh', height: 18 }}><div className="tbx-bar__fill" style={{ width: `${pct * 100}%` }} /></div>
        <p className="tbx-small" style={{ marginTop: '2vh', fontSize: 'clamp(13px, 1.1vw, 20px)' }}>{cfg.anonymous ? '누가 무엇을 골랐는지는 공개되지 않아요.' : '결과 발표 때 개인별 선택이 공개될 수 있어요.'}</p>
      </div>
    );
  }
  return (
    <div style={{ width: 'min(80vw, 1300px)' }}>
      <VoteResults config={cfg} tally={tally} voters={b.voters} confirmed={outcome?.elected} />
      {outcome && outcome.tied.length > 1 && <p className="tbx-h2" style={{ marginTop: '2vh', fontSize: 'clamp(18px, 1.6vw, 30px)' }}>남은 {outcome.seatsLeft}자리는 동률이라 결선 투표로 정해요.</p>}
      {b.state.decision_note && <p className="tbx-body" style={{ marginTop: '2vh', fontSize: 'clamp(16px, 1.4vw, 26px)' }}>📝 {b.state.decision_note}</p>}
    </div>
  );
}

function CastCards({ b }: { b: BroadcastState }) {
  const cards = b.cards ?? [];
  return (
    <div style={{ width: '100%', position: 'relative' }}>
      {cards.length === 0
        ? <CastMessage title="카드를 기다리고 있어요" body={`${b.submitted ?? 0} / ${b.eligible ?? 0}명 제출`} />
        : <CardCloud cards={cards.map((c) => ({ id: c.card_id, title: c.title, author: c.author, presented: c.presented }))} />}
      <div className="tbx-small" style={{ textAlign: 'center', fontSize: 'clamp(13px, 1.1vw, 20px)' }}>{b.submitted ?? 0} / {b.eligible ?? 0}명 제출{b.state.submission_open ? '' : ' · 제출 마감'}</div>
      {b.spotlight_card && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,6,14,.72)', display: 'grid', placeItems: 'center', zIndex: 10 }}>
          <div className="tbx-cast-spot">
            <h2>{b.spotlight_card.title}</h2>
            {b.spotlight_card.author && <div style={{ fontSize: 'clamp(14px, 1.3vw, 24px)', fontWeight: 800, color: '#6b5a3c', marginTop: '1vh' }}>{b.spotlight_card.author}</div>}
            <p>{b.spotlight_card.body}</p>
          </div>
        </div>
      )}
    </div>
  );
}
