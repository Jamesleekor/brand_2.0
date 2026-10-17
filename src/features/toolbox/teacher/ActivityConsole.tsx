// =====================================================================
// 교사 — 학급 활동 운영 화면
// ---------------------------------------------------------------------
// 왼쪽은 조작, 오른쪽은 중계 화면과 같은 미리 보기.
// 중계 화면(교실 대형 화면)은 '중계 화면 열기'로 새 창에 띄운다.
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';
import { useLiveResource, useToolboxPulse } from '../useToolboxPulse';
import { toToolboxError, toolboxRpc } from '../toolbox_rpc';
import { Glyph, InlineError, KIND_GLYPH, KIND_LABEL, Modal, Notice, Seg, Stepper, Toggle, randomInt, relTime, useAction, useConfirm } from '../ui';
import { BracketView, CardCloud, ScoreboardBoard, VoteResults, bracketRounds, bracketSides, electionOutcome, roundName } from '../views';
import { statusChip } from './TeacherToolbox';
import type { BracketState, CardRow, ScoreEvent, TeacherActivityState, VoteConfig } from '../toolbox_types';
import '../toolbox.css';

export function openBroadcast(id: number) {
  const url = new URL(window.location.href);
  url.hash = `/teacher/toolbox/screen/${id}`;
  window.open(url.href, `tbx-screen-${id}`, 'noopener');
}

export function ActivityConsolePage() {
  const { id } = useParams<{ id: string }>();
  const activityId = Number(id);
  const navigate = useNavigate();
  const classroomId = useAuthStore((s) => s.context?.classroomId ?? null);
  const pulse = useToolboxPulse(supabase, classroomId, 'T');
  const [linkedBoard, setLinkedBoard] = useState<number | null>(null);
  const res = useLiveResource<TeacherActivityState>(`console:${activityId}`, () => toolboxRpc.teacherState(supabase, activityId), {
    enabled: Number.isFinite(activityId), rev: pulse.rev, revInitial: pulse.initial,
    relevant: () => {
      const a = Number(pulse.payload.activity_id ?? 0);
      return !a || a === activityId || (linkedBoard !== null && a === linkedBoard);
    },
    debounceMs: 90,
  });
  const st = res.data;
  useEffect(() => { setLinkedBoard(st?.config?.scoreboard_id ?? null); }, [st?.config?.scoreboard_id]);
  const { run, busy } = useAction();
  const { ask, dialog } = useConfirm();
  const [renaming, setRenaming] = useState<string | null>(null);

  const act = async <T,>(key: string, fn: () => Promise<T>, ok?: string) => { const r = await run(key, fn, ok); res.refresh(); return r; };
  const finish = async () => {
    if (!st) return;
    const keeps = st.kind === 'VOTE' || st.kind === 'SCOREBOARD';
    const body = keeps
      ? <>활동을 끝내면 학생 화면에서 사라지고 <b>기록</b>으로 남아요. 끝낸 기록은 읽기만 할 수 있어요.</>
      : <>이 활동은 기록으로 남지 않아요. 끝내면 {st.kind === 'CARDS' ? '학생이 낸 카드 내용' : st.kind === 'BUZZER' ? '버저 순서와 판정' : '대진 결과'}이 모두 사라져요.{st.kind === 'BUZZER' && st.config.scoreboard_id ? ' 함께 만든 점수판의 점수는 점수판 기록에 남아요.' : ''}</>;
    if (!(await ask('활동을 끝낼까요?', body, '끝내기', !keeps))) return;
    const r = await run('end', () => toolboxRpc.setStatus(supabase, st.id, 'ENDED'), '활동을 끝냈어요');
    if (r) { if (keeps) res.refresh(); else navigate('/teacher/toolbox', { replace: true }); }
  };

  if (!Number.isFinite(activityId)) return null;
  return (
    <TeacherShell>
      <div className="tbx tbx-teacher-page">
        <button type="button" className="tbx-btn tbx-btn--ghost tbx-btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/teacher/toolbox')}>← 모험가 도구함</button>
        {res.error && !st && <Notice tone="ember" icon="⚠️">{toToolboxError(res.error).message} <button type="button" className="tbx-btn tbx-btn--sm" onClick={res.refresh}>다시 불러오기</button></Notice>}
        {!st && !res.error && <p className="tbx-small">불러오는 중…</p>}
        {st && (
          <>
            <div className="tbx-row tbx-row--between tbx-row--wrap" style={{ gap: 14 }}>
              <div className="tbx-hero" style={{ minWidth: 0 }}>
                <Glyph name={KIND_GLYPH[st.kind]} size="lg" />
                <div style={{ minWidth: 0 }}>
                  {renaming === null ? (
                    <button type="button" className="tbx-h1" style={{ background: 'none', border: 0, color: 'inherit', padding: 0, cursor: st.status === 'ENDED' ? 'default' : 'text', textAlign: 'left' }}
                      onClick={() => st.status !== 'ENDED' && setRenaming(st.title)} title="눌러서 제목 바꾸기">{st.title}</button>
                  ) : (
                    <form className="tbx-row" onSubmit={async (e) => { e.preventDefault(); await act('rename', () => toolboxRpc.rename(supabase, st.id, renaming)); setRenaming(null); }}>
                      <input className="tbx-input" autoFocus value={renaming} maxLength={60} onChange={(e) => setRenaming(e.target.value)} />
                      <button className="tbx-btn tbx-btn--sm tbx-btn--brass" type="submit">저장</button>
                      <button className="tbx-btn tbx-btn--sm" type="button" onClick={() => setRenaming(null)}>취소</button>
                    </form>
                  )}
                  <div className="tbx-row tbx-row--wrap" style={{ gap: 6, marginTop: 4 }}>
                    {statusChip(st)}
                    <span className="tbx-small">{KIND_LABEL[st.kind]} — {relTime(st.created_at)} 만듦</span>
                    {!pulse.connected && <span className="tbx-chip tbx-chip--ember">실시간 연결 확인 중</span>}
                  </div>
                </div>
              </div>
              <div className="tbx-row tbx-row--wrap">
                {st.status === 'READY' && <button type="button" className="tbx-btn tbx-btn--brass" disabled={busy !== null} onClick={() => void act('open', () => toolboxRpc.setStatus(supabase, st.id, 'OPEN'), '학생에게 열었어요')}>시작하기</button>}
                {st.status !== 'ENDED' && <button type="button" className="tbx-btn" onClick={() => openBroadcast(st.id)}>⛶ 중계 화면 열기</button>}
                {st.status !== 'ENDED' && <button type="button" className="tbx-btn tbx-btn--danger" disabled={busy !== null} onClick={() => void finish()}>끝내기</button>}
              </div>
            </div>
            {st.status === 'ENDED' && <Notice icon="📚">끝난 활동의 기록이에요. 읽기만 할 수 있어요.</Notice>}
            {st.kind === 'BUZZER' && <BuzzerConsole st={st} act={act} busy={busy} />}
            {st.kind === 'SCOREBOARD' && <ScoreboardConsole st={st} act={act} busy={busy} ask={ask} />}
            {st.kind === 'TOURNAMENT' && <TournamentConsole st={st} act={act} busy={busy} ask={ask} />}
            {st.kind === 'VOTE' && <VoteConsole st={st} act={act} busy={busy} ask={ask} />}
            {st.kind === 'CARDS' && <CardsConsole st={st} act={act} busy={busy} />}
          </>
        )}
      </div>
      {dialog}
    </TeacherShell>
  );
}

type Act = <T>(key: string, fn: () => Promise<T>, ok?: string) => Promise<T | null>;
type Ask = (title: string, body: React.ReactNode, confirm?: string, danger?: boolean) => Promise<boolean>;

// ---------------------------------------------------------------------
// 버저
// ---------------------------------------------------------------------
function BuzzerConsole({ st, act, busy }: { st: TeacherActivityState; act: Act; busy: string | null }) {
  const s = st.state;
  const [points, setPoints] = useState<number>(s.points ?? 10);
  useEffect(() => { setPoints(s.points ?? 10); }, [s.round_no]); // eslint-disable-line react-hooks/exhaustive-deps
  const units = st.participants;
  const unitOf = (k: string) => units.find((u) => u.key === k);
  const judgments: any[] = s.judgments ?? [];
  const live = st.status === 'OPEN';
  const open = s.round_status === 'OPEN';
  const liveCorrect = judgments.some((j) => j.verdict === 'CORRECT');
  const PRESETS = [5, 10, 50, 100];
  const fsUpcoming = (st.false_starts ?? []).filter((f) => new Date(f.locked_until).getTime() > Date.now() - 60_000);

  return (
    <div className="tbx-split tbx-split--console">
      <div className="tbx-stack tbx-stack--loose">
        <section className="tbx-panel tbx-stack">
          <div className="tbx-row tbx-row--between"><h2 className="tbx-h2">{open ? `${s.round_no}번 문제 진행 중` : `다음 문제 ${(s.round_no ?? 0) + 1}번`}</h2>{open && <span className="tbx-chip tbx-chip--live">입력 받는 중</span>}</div>
          <div>
            <span className="tbx-label">이 문제 배점</span>
            <div className="tbx-row tbx-row--wrap">
              {PRESETS.map((p) => (
                <button key={p} type="button" className="tbx-btn tbx-btn--sm" aria-pressed={points === p} disabled={open || !live}
                  style={points === p ? { borderColor: 'var(--tbx-brass)', color: 'var(--tbx-brass-hi)' } : undefined} onClick={() => setPoints(p)}>{p}점</button>
              ))}
              <Stepper value={points} min={1} max={100000} onChange={setPoints} label="배점" suffix="점" />
            </div>
            {!st.config.scoreboard_id && <p className="tbx-hint">점수판이 연결되지 않아 판정만 기록돼요.</p>}
          </div>
          {open
            ? <button type="button" className="tbx-btn tbx-btn--lg tbx-btn--block" disabled={busy !== null} onClick={() => void act('close', () => toolboxRpc.buzzer(supabase, st.id, 'CLOSE_ROUND'))}>입력 마감</button>
            : <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--xl tbx-btn--block" disabled={busy !== null || !live} onClick={() => void act('open', () => toolboxRpc.buzzer(supabase, st.id, 'OPEN_ROUND', { points }))}>
                {(s.round_no ?? 0) + 1}번 문제 열기 · {points}점
              </button>}
          <p className="tbx-hint">문제를 열기 전에 누른 학생은 5초 동안 잠겨요. 순서는 서버에 도착한 순서예요.</p>
        </section>

        {fsUpcoming.length > 0 && (
          <section className="tbx-panel">
            <h2 className="tbx-h3" style={{ marginBottom: 6 }}>부정출발 (문제 열기 전에 누름 · 5초 잠금)</h2>
            <div className="tbx-selected">{fsUpcoming.map((f) => <span key={f.student_id + f.pressed_at} className="tbx-chip tbx-chip--ember">{f.student_name}</span>)}</div>
          </section>
        )}

        {st.scoreboard && (
          <section className="tbx-panel tbx-stack">
            <div className="tbx-row tbx-row--between"><h2 className="tbx-h3">연결된 점수판</h2><a className="tbx-btn tbx-btn--sm tbx-btn--ghost" href={`#/teacher/toolbox/activity/${st.scoreboard.id}`}>점수판 열기</a></div>
            <ScoreboardBoard units={units} scores={st.scoreboard.scores ?? {}} sort="SCORE" compact />
          </section>
        )}
      </div>

      <section className="tbx-panel tbx-stack">
        <div className="tbx-row tbx-row--between">
          <h2 className="tbx-h2">{s.round_no ? `${s.round_no}번 문제 접수 순서` : '접수 순서'}</h2>
          <span className="tbx-small">{st.presses?.length ?? 0} / {units.length}</span>
        </div>
        {(st.presses?.length ?? 0) === 0 ? (
          <div className="tbx-empty"><Glyph name="buzzer" /><p className="tbx-small">{open ? '누른 학생이 생기면 여기에 바로 나타나요.' : '문제를 열면 학생 버저가 켜져요.'}</p></div>
        ) : (
          <ol className="tbx-list">
            {st.presses!.map((p) => {
              const j = judgments.find((x) => x.unit_key === p.unit_key);
              const u = unitOf(p.unit_key);
              return (
                <li key={p.unit_key} className="tbx-list__row">
                  <span className={p.rank === 1 ? 'tbx-rank tbx-rank--1' : 'tbx-rank'}>{p.rank}</span>
                  <span className="tbx-grow">
                    <span className="tbx-h3" style={{ display: 'block', fontSize: 17 }}>{u?.type === 'STUDENT' ? p.student_name : u?.label ?? p.unit_key}</span>
                    {u?.type !== 'STUDENT' && <span className="tbx-small">누른 사람 {p.student_name}</span>}
                  </span>
                  {j ? (
                    <>
                      <span className={j.verdict === 'CORRECT' ? 'tbx-chip tbx-chip--brass' : 'tbx-chip'}>{j.verdict === 'CORRECT' ? `정답${j.points ? ` +${j.points}` : ''}` : '오답'}</span>
                      <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" disabled={busy !== null || !live} onClick={() => void act('unjudge', () => toolboxRpc.buzzer(supabase, st.id, 'UNJUDGE', { unit_key: p.unit_key }))}>판정 취소</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--brass" disabled={busy !== null || !live}
                        onClick={() => void act('judge', () => toolboxRpc.buzzer(supabase, st.id, 'JUDGE', { unit_key: p.unit_key, verdict: 'CORRECT', extra: liveCorrect }))}>
                        {liveCorrect ? '추가 정답' : `정답 +${s.points}`}
                      </button>
                      <button type="button" className="tbx-btn tbx-btn--sm" disabled={busy !== null || !live} onClick={() => void act('judge', () => toolboxRpc.buzzer(supabase, st.id, 'JUDGE', { unit_key: p.unit_key, verdict: 'WRONG' }))}>오답</button>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <p className="tbx-hint">오답을 골라도 다음 순서에 자동으로 넘기지 않아요. 다음 사람에게 기회를 주거나 새 문제를 열어요.</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------
// 점수판
// ---------------------------------------------------------------------
function ScoreboardConsole({ st, act, busy, ask }: { st: TeacherActivityState; act: Act; busy: string | null; ask: Ask }) {
  const [picked, setPicked] = useState<string | null>(st.participants[0]?.key ?? null);
  const [custom, setCustom] = useState(10);
  const [setTo, setSetTo] = useState('');
  const scores: Record<string, number> = st.state.scores ?? {};
  const live = st.status !== 'ENDED';
  const label = (k: string) => st.participants.find((u) => u.key === k)?.label ?? k;
  const add = (delta: number) => picked && act('score', () => toolboxRpc.score(supabase, st.id, 'ADD', { unit_key: picked, delta }));
  const events: ScoreEvent[] = st.events ?? [];
  const batches = useMemo(() => {
    const map = new Map<number, ScoreEvent[]>();
    for (const e of events) map.set(e.batch_id, [...(map.get(e.batch_id) ?? []), e]);
    return [...map.values()];
  }, [events]);

  return (
    <div className="tbx-split tbx-split--console">
      <div className="tbx-stack tbx-stack--loose">
        {live && (
          <section className="tbx-panel tbx-stack">
            <h2 className="tbx-h2">{picked ? `${label(picked)} 점수 바꾸기` : '팀을 골라 주세요'}</h2>
            <div className="tbx-quick">
              {[1, 5, 10].map((n) => <button key={`p${n}`} type="button" className="tbx-btn tbx-btn--lg" disabled={!picked || busy !== null} onClick={() => void add(n)}>+{n}</button>)}
              {[1, 5].map((n) => <button key={`m${n}`} type="button" className="tbx-btn tbx-btn--lg" disabled={!picked || busy !== null} onClick={() => void add(-n)}>−{n}</button>)}
            </div>
            <div className="tbx-row tbx-row--wrap">
              <Stepper value={custom} min={1} max={1000000} onChange={setCustom} label="바꿀 점수" />
              <button type="button" className="tbx-btn tbx-btn--brass" disabled={!picked || busy !== null} onClick={() => void add(custom)}>+{custom}</button>
              <button type="button" className="tbx-btn" disabled={!picked || busy !== null} onClick={() => void add(-custom)}>−{custom}</button>
            </div>
            <form className="tbx-row" onSubmit={(e) => { e.preventDefault(); if (picked && setTo.trim() !== '') void act('set', () => toolboxRpc.score(supabase, st.id, 'SET', { unit_key: picked, value: Number(setTo) })).then(() => setSetTo('')); }}>
              <input className="tbx-input" style={{ maxWidth: 140 }} inputMode="numeric" placeholder="점수 직접 입력" value={setTo} onChange={(e) => setSetTo(e.target.value.replace(/[^0-9-]/g, ''))} />
              <button type="submit" className="tbx-btn" disabled={!picked || setTo.trim() === '' || busy !== null}>이 점수로 바꾸기</button>
            </form>
            <hr className="tbx-divider" />
            <div className="tbx-row tbx-row--wrap">
              <button type="button" className="tbx-btn" disabled={busy !== null || !events.some((e) => !e.undone_at)} onClick={() => void act('undo', () => toolboxRpc.score(supabase, st.id, 'UNDO_LAST'), '방금 바꾼 점수를 되돌렸어요')}>방금 바꾼 것 취소</button>
              <button type="button" className="tbx-btn tbx-btn--ghost" disabled={busy !== null}
                onClick={async () => { if (await ask('모든 점수를 0으로 할까요?', '초기화도 기록에 남고, ‘방금 바꾼 것 취소’로 되돌릴 수 있어요.', '초기화', true)) void act('reset', () => toolboxRpc.score(supabase, st.id, 'RESET')); }}>모두 0점으로</button>
            </div>
            <Seg value={st.config.sort ?? 'FIXED'} onChange={(v) => void act('sort', () => toolboxRpc.score(supabase, st.id, 'SET_SORT', { sort: v }))}
              options={[{ value: 'FIXED', label: '팀 자리 고정' }, { value: 'SCORE', label: '점수순' }]} label="정렬" />
            <Toggle checked={st.share_to_students} onChange={(v) => void act('share', () => toolboxRpc.score(supabase, st.id, 'SET_SHARE', { share: v }))} title="학생 화면에 보이기" />
          </section>
        )}
        <section className="tbx-panel">
          <h2 className="tbx-h3" style={{ marginBottom: 6 }}>바꾼 기록</h2>
          {batches.length === 0 ? <p className="tbx-small">아직 바꾼 점수가 없어요.</p> : (
            <ol className="tbx-list" style={{ maxHeight: 360, overflow: 'auto' }}>
              {batches.map((b) => {
                const first = b[0];
                const undone = !!first.undone_at;
                const text = first.source === 'RESET' ? '모두 0점으로 초기화'
                  : first.source === 'BUZZER' ? `${label(first.unit_key)} ${first.delta > 0 ? '+' : ''}${first.delta} — 버저 ${first.detail.round_no}번 문제 정답 (${first.detail.student_name ?? ''})`
                  : first.source === 'SET' ? `${label(first.unit_key)} ${first.detail.from} → ${first.detail.to}`
                  : `${label(first.unit_key)} ${first.delta > 0 ? '+' : ''}${first.delta}`;
                return (
                  <li key={first.batch_id} className="tbx-list__row" style={{ opacity: undone ? 0.5 : 1 }}>
                    <span className="tbx-grow"><span className="tbx-h3" style={{ display: 'block', fontSize: 14, textDecoration: undone ? 'line-through' : undefined }}>{text}</span>
                      <span className="tbx-small">{new Date(first.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}{undone ? ' — 취소됨' : ''}</span></span>
                    {!undone && live && <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" disabled={busy !== null} onClick={() => void act('undo1', () => toolboxRpc.score(supabase, st.id, 'UNDO', { event_id: first.id }))}>취소</button>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
      <section className="tbx-panel tbx-stack">
        <div className="tbx-row tbx-row--between"><h2 className="tbx-h2">점수판</h2><span className="tbx-small">{live ? '팀을 누르면 그 팀 점수를 바꿔요' : '최종 점수'}</span></div>
        <ScoreboardBoard units={st.participants} scores={scores} sort={st.config.sort ?? 'FIXED'} onPick={live ? setPicked : undefined} picked={live ? picked : null} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------
// 대진표
// ---------------------------------------------------------------------
function TournamentConsole({ st, act, busy, ask }: { st: TeacherActivityState; act: Act; busy: string | null; ask: Ask }) {
  const state = st.state as BracketState;
  const [match, setMatch] = useState<string | null>(null);
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [note, setNote] = useState('');
  const [notePublic, setNotePublic] = useState(false);
  const sides = match ? bracketSides(state, match) : [null, null];
  const result = match ? state.results?.[match] : undefined;
  useEffect(() => {
    setScoreA(result?.score_a?.toString() ?? ''); setScoreB(result?.score_b?.toString() ?? '');
    setNote(result?.note ?? ''); setNotePublic(!!result?.note_public);
  }, [match]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = (k: string | null) => st.participants.find((u) => u.key === k)?.label ?? '';
  const rounds = bracketRounds(state);
  const live = st.status === 'OPEN';

  const affectsLater = (m: string) => {
    if (!state.results?.[m]) return false;
    const r = m === 'T' ? rounds + 1 : Number(m.slice(1).split('-')[0]);
    return Object.keys(state.results).some((k) => k !== m && (k === 'T' ? r < rounds : Number(k.slice(1).split('-')[0]) > r));
  };
  const setWinner = async (winner: string) => {
    if (!match) return;
    if (result && result.winner !== winner && affectsLater(match)
      && !(await ask('승자를 바꿀까요?', '이 경기 다음으로 이어지는 경기 중 참가자가 바뀌는 경기의 결과와 점수가 지워져요. 다른 쪽 경기는 그대로예요.', '바꾸기', true))) return;
    const args: Record<string, unknown> = { match_id: match, winner, note, note_public: notePublic };
    if (scoreA !== '') args.score_a = Number(scoreA);
    if (scoreB !== '') args.score_b = Number(scoreB);
    await act('win', () => toolboxRpc.tournament(supabase, st.id, 'SET_RESULT', args));
  };
  const scoreTie = scoreA !== '' && scoreB !== '' && Number(scoreA) === Number(scoreB);

  return (
    <div className="tbx-stack tbx-stack--loose">
      {!state.revealed_at && live && (
        <Notice icon="🎬">
          대진이 준비됐어요. 공개하면 중계 화면과 학생 화면에서 대진표가 만들어지는 연출이 나와요.
          <div style={{ marginTop: 8 }}><button type="button" className="tbx-btn tbx-btn--brass" disabled={busy !== null} onClick={() => void act('reveal', () => toolboxRpc.tournament(supabase, st.id, 'REVEAL'), '대진을 공개했어요')}>대진 공개</button></div>
        </Notice>
      )}
      <div className="tbx-split">
        <section className="tbx-panel">
          <BracketView state={state} units={st.participants} onMatch={live ? setMatch : undefined} selected={match} />
          {live && <p className="tbx-hint">두 참가자가 정해진 경기를 누르면 승자를 고를 수 있어요.</p>}
        </section>
        <section className="tbx-panel tbx-stack">
          {!match ? <p className="tbx-small">경기를 골라 주세요.</p> : (
            <>
              <h2 className="tbx-h2">{match === 'T' ? '3위 결정전' : roundName(Number(match.slice(1).split('-')[0]), rounds)} {match !== 'T' && `${match.split('-')[1]}경기`}</h2>
              <div className="tbx-row" style={{ gap: 8 }}>
                <label style={{ flex: 1 }}><span className="tbx-label">{label(sides[0])}</span><input className="tbx-input tbx-input--num" inputMode="numeric" value={scoreA} onChange={(e) => setScoreA(e.target.value.replace(/\D/g, ''))} placeholder="점수" /></label>
                <span className="tbx-h3" style={{ marginTop: 22 }}>:</span>
                <label style={{ flex: 1 }}><span className="tbx-label">{label(sides[1])}</span><input className="tbx-input tbx-input--num" inputMode="numeric" value={scoreB} onChange={(e) => setScoreB(e.target.value.replace(/\D/g, ''))} placeholder="점수" /></label>
              </div>
              <label><span className="tbx-label">메모 (선택)</span><input className="tbx-input" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <Toggle checked={notePublic} onChange={setNotePublic} title="메모를 학생·중계 화면에 보이기" />
              {scoreTie && <Notice icon="⚖️">점수가 같아요. 재경기 등으로 승자가 정해지면 골라 주세요.</Notice>}
              <div className="tbx-row tbx-row--wrap">
                {[sides[0], sides[1]].map((k) => k && (
                  <button key={k} type="button" className={result?.winner === k ? 'tbx-btn tbx-btn--brass tbx-btn--lg' : 'tbx-btn tbx-btn--lg'} disabled={busy !== null} onClick={() => void setWinner(k)}>
                    {label(k)} 승{result?.winner === k ? ' ✓' : ''}
                  </button>
                ))}
              </div>
              {result && (
                <div className="tbx-row tbx-row--wrap">
                  <button type="button" className="tbx-btn tbx-btn--sm" disabled={busy !== null} onClick={() => {
                    const args: Record<string, unknown> = { match_id: match, note, note_public: notePublic };
                    if (scoreA !== '') args.score_a = Number(scoreA);
                    if (scoreB !== '') args.score_b = Number(scoreB);
                    void act('note', () => toolboxRpc.tournament(supabase, st.id, 'UPDATE_NOTE', args), '저장했어요');
                  }}>점수·메모만 저장</button>
                  <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" disabled={busy !== null} onClick={async () => {
                    if (affectsLater(match) && !(await ask('결과를 지울까요?', '이 경기 다음으로 이어지는 경기 결과도 함께 지워져요.', '지우기', true))) return;
                    await act('clear', () => toolboxRpc.tournament(supabase, st.id, 'CLEAR_RESULT', { match_id: match }));
                  }}>결과 지우기</button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 투표
// ---------------------------------------------------------------------
function VoteConsole({ st, act, busy, ask }: { st: TeacherActivityState; act: Act; busy: string | null; ask: Ask }) {
  const cfg = st.config as VoteConfig;
  const tally = st.tally!;
  const navigate = useNavigate();
  const [showBallots, setShowBallots] = useState(false);
  const [ballots, setBallots] = useState<Awaited<ReturnType<typeof toolboxRpc.voteBallots>>['ballots'] | null>(null);
  const [invalidating, setInvalidating] = useState<{ id: number; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState(st.state.decision_note ?? '');
  const { run, error } = useAction();
  const revealed = !!st.state.revealed;
  const loadBallots = async () => { const r = await run('ballots', () => toolboxRpc.voteBallots(supabase, st.id)); if (r) setBallots(r.ballots); };
  useEffect(() => { if (showBallots) void loadBallots(); }, [showBallots, st.rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const outcome = cfg.mode === 'CANDIDATE' && tally.counts ? electionOutcome(cfg, tally.counts) : null;
  const optLabel = (k: string) => (k === 'ABSTAIN' ? '기권' : cfg.options.find((o) => o.key === k)?.label ?? k);

  const createRunoff = async () => {
    if (!outcome || outcome.tied.length < 2) return;
    const confirmed = [...(cfg.confirmed ?? []), ...outcome.elected];
    const r = await act('runoff', () => toolboxRpc.create(supabase, { kind: 'VOTE', title: `${st.title} 결선`, participants: [], open: false, config: {
      mode: 'CANDIDATE', eligible: st.eligible_student_ids, position: cfg.position, description: `남은 ${outcome.seatsLeft}자리를 정하는 결선 투표예요.`,
      options: outcome.tied.map((k) => ({ student_id: cfg.options.find((o) => o.key === k)?.student_id })),
      seats: outcome.seatsLeft, max_choices: Math.min(cfg.max_choices, outcome.seatsLeft), allow_abstain: cfg.allow_abstain,
      anonymous: cfg.anonymous, reveal: cfg.reveal, runoff_of: st.id, confirmed: confirmed.map((k) => optLabel(k)),
    } }), '결선 투표를 만들었어요');
    if (r) navigate(`/teacher/toolbox/activity/${r.id}`);
  };
  const createMultiRunoff = async (keys: string[]) => {
    const r = await act('runoff', () => toolboxRpc.create(supabase, { kind: 'VOTE', title: `${st.title} 결선`, participants: [], open: false, config: {
      mode: 'MULTI', eligible: st.eligible_student_ids, description: '1위가 같은 선택지만으로 다시 정해요.',
      options: keys.map((k) => ({ label: optLabel(k) })), max_choices: 1, allow_abstain: cfg.allow_abstain, anonymous: cfg.anonymous, reveal: cfg.reveal, runoff_of: st.id,
    } }), '결선 투표를 만들었어요');
    if (r) navigate(`/teacher/toolbox/activity/${r.id}`);
  };
  const multiTop = cfg.mode === 'MULTI' && tally.counts ? (() => {
    const max = Math.max(...cfg.options.map((o) => tally.counts![o.key] ?? 0));
    const tops = cfg.options.filter((o) => (tally.counts![o.key] ?? 0) === max && max > 0).map((o) => o.key);
    return tops.length > 1 ? tops : null;
  })() : null;

  return (
    <div className="tbx-split tbx-split--console">
      <div className="tbx-stack tbx-stack--loose">
        <section className="tbx-panel tbx-stack">
          <h2 className="tbx-h2">진행</h2>
          <div className="tbx-row tbx-row--wrap">
            <span className="tbx-chip">{cfg.mode === 'YESNO' ? '찬반' : cfg.mode === 'MULTI' ? '다지선다' : `후보 선출 ${cfg.seats}명`}</span>
            <span className="tbx-chip">{cfg.anonymous ? '익명' : '기명'}</span>
            <span className="tbx-chip">{cfg.reveal === 'LIVE' ? '진행 중 공개' : '마감 후 공개'}</span>
            {cfg.close_at && <span className="tbx-chip">{new Date(cfg.close_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 자동 마감</span>}
            {cfg.runoff_of && <span className="tbx-chip tbx-chip--violet">결선</span>}
          </div>
          {cfg.confirmed?.length ? <p className="tbx-small">이미 확정: {cfg.confirmed.join(', ')}</p> : null}
          <div className="tbx-row tbx-row--wrap">
            {st.status === 'OPEN' && <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--lg" disabled={busy !== null}
              onClick={async () => { if (await ask('투표를 마감할까요?', '마감하면 다시 열 수 없어요. 더 받으려면 새 회차를 만들어요.', '마감')) void act('close', () => toolboxRpc.setStatus(supabase, st.id, 'CLOSED'), '마감했어요'); }}>투표 마감</button>}
            {(st.status === 'CLOSED' || (cfg.reveal === 'LIVE' && st.status === 'OPEN')) && !revealed && (
              <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--lg" disabled={busy !== null} onClick={() => void act('reveal', () => toolboxRpc.vote(supabase, st.id, 'REVEAL'), '결과를 공개했어요')}>결과 공개</button>)}
            {revealed && st.status !== 'ENDED' && <button type="button" className="tbx-btn" disabled={busy !== null} onClick={() => void act('hide', () => toolboxRpc.vote(supabase, st.id, 'HIDE_RESULT'))}>결과 다시 가리기</button>}
            {revealed && !cfg.anonymous && st.status !== 'ENDED' && (
              <button type="button" className="tbx-btn" disabled={busy !== null} onClick={() => void act('names', () => toolboxRpc.vote(supabase, st.id, 'REVEAL_NAMES', { on: !st.state.reveal_names }))}>
                {st.state.reveal_names ? '개인별 선택 가리기' : '개인별 선택 중계 화면에 공개'}</button>)}
          </div>
          {st.status === 'OPEN' && <p className="tbx-hint">결과는 운영 화면에서만 미리 보여요. 학생과 중계 화면은 참여 수만 봐요.</p>}
        </section>

        <section className="tbx-panel tbx-stack">
          <div className="tbx-row tbx-row--between"><h2 className="tbx-h3">참여 현황</h2><span className="tbx-count">{tally.submitted} / {tally.eligible}</span></div>
          {(st.not_voted?.length ?? 0) > 0
            ? <><span className="tbx-small">아직 투표하지 않은 학생</span><div className="tbx-selected">{st.not_voted!.map((s) => <span key={s.student_id} className="tbx-chip">{s.name}</span>)}</div></>
            : <p className="tbx-small">대상 학생이 모두 투표했어요.</p>}
        </section>

        <section className="tbx-panel tbx-stack">
          <button type="button" className="tbx-btn tbx-btn--ghost" style={{ alignSelf: 'flex-start' }} aria-expanded={showBallots} onClick={() => setShowBallots(!showBallots)}>
            {showBallots ? '학생별 투표 확인 닫기' : '🔐 학생별 투표 확인'}
          </button>
          {showBallots && (
            <>
              <Notice icon="🔐">운영 화면에서만 보여요. 교실 화면에 띄워 둔 상태라면 먼저 확인해 주세요.{cfg.anonymous ? ' 학생에게는 “다른 친구들은 알 수 없어요”라고 안내돼요.' : ''}</Notice>
              <InlineError error={error} />
              {!ballots ? <p className="tbx-small">불러오는 중…</p> : ballots.length === 0 ? <p className="tbx-small">아직 낸 표가 없어요.</p> : (
                <ol className="tbx-list" style={{ maxHeight: 380, overflow: 'auto' }}>
                  {ballots.map((b) => (
                    <li key={b.student_id} className="tbx-list__row" style={{ opacity: b.invalidated_at ? 0.6 : 1 }}>
                      <span className="tbx-grow">
                        <span className="tbx-h3" style={{ display: 'block' }}>{b.name} <span className="tbx-small">— {b.choices.map(optLabel).join(', ')}</span></span>
                        <span className="tbx-small">{b.revision > 1 ? `${b.revision}번 바꿈 · ` : ''}{new Date(b.updated_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}{b.invalidated_at ? ` · 무효: ${b.invalidated_reason}` : ''}</span>
                      </span>
                      {!revealed && st.status !== 'ENDED' && (b.invalidated_at
                        ? <button type="button" className="tbx-btn tbx-btn--sm" disabled={busy !== null} onClick={() => void act('restore', () => toolboxRpc.vote(supabase, st.id, 'RESTORE', { student_id: b.student_id }))}>무효 취소</button>
                        : <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" onClick={() => { setInvalidating({ id: b.student_id, name: b.name }); setReason(''); }}>무효 처리</button>)}
                    </li>
                  ))}
                </ol>
              )}
              <p className="tbx-hint">운영국은 표를 다른 선택으로 바꿀 수 없어요. 잘못된 표는 사유를 남기고 무효 처리해요(결과 공개 전까지).</p>
            </>
          )}
        </section>
      </div>

      <section className="tbx-panel tbx-stack">
        <div className="tbx-row tbx-row--between"><h2 className="tbx-h2">{revealed ? '결과 (공개됨)' : '결과 (운영 화면에만 보임)'}</h2></div>
        {cfg.description && <p className="tbx-small">{cfg.description}</p>}
        <VoteResults config={cfg} tally={tally} confirmed={outcome?.elected} />
        {outcome && st.status !== 'OPEN' && (
          <div className="tbx-well tbx-stack">
            <span className="tbx-h3">선출 결과</span>
            <p className="tbx-small">당선: {outcome.elected.length ? outcome.elected.map(optLabel).join(', ') : '아직 없음'}{cfg.confirmed?.length ? ` (앞선 확정: ${cfg.confirmed.join(', ')})` : ''}</p>
            {outcome.tied.length > 1 && (
              <>
                <Notice icon="⚖️">남은 {outcome.seatsLeft}자리에 {outcome.tied.map(optLabel).join(', ')} 후보가 같은 표를 얻었어요. 임의로 정하지 않아요.</Notice>
                <button type="button" className="tbx-btn tbx-btn--brass" disabled={busy !== null} onClick={() => void createRunoff()}>동률 후보로 결선 투표 만들기</button>
              </>
            )}
            {tally.choosers === 0 && <p className="tbx-small">후보를 고른 표가 없어 당선자를 정하지 않았어요.</p>}
            <p className="tbx-hint">선출 결과는 경제수호대 등 실제 직책에 자동으로 반영되지 않아요.</p>
          </div>
        )}
        {multiTop && st.status !== 'OPEN' && (
          <div className="tbx-well tbx-stack">
            <Notice icon="⚖️">1위가 {multiTop.map(optLabel).join(', ')}로 같아요.</Notice>
            <button type="button" className="tbx-btn tbx-btn--brass" disabled={busy !== null} onClick={() => void createMultiRunoff(multiTop)}>1위 선택지로 결선 투표 만들기</button>
          </div>
        )}
        {st.status !== 'OPEN' && st.status !== 'ENDED' && (
          <form className="tbx-stack tbx-stack--tight" onSubmit={(e) => { e.preventDefault(); void act('note', () => toolboxRpc.vote(supabase, st.id, 'DECISION_NOTE', { note }), '결정 메모를 저장했어요'); }}>
            <span className="tbx-label">결정 메모 (선택)</span>
            <textarea className="tbx-textarea" style={{ minHeight: 64 }} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="결선에서도 같으면 운영국이 정한 내용을 적어요. 투표 결과는 바뀌지 않아요." />
            <button type="submit" className="tbx-btn tbx-btn--sm" style={{ alignSelf: 'flex-start' }} disabled={busy !== null}>메모 저장</button>
          </form>
        )}
        {st.status === 'ENDED' && st.state.decision_note && <Notice icon="📝">{st.state.decision_note}</Notice>}
      </section>

      <Modal open={!!invalidating} onClose={() => setInvalidating(null)} title={`${invalidating?.name ?? ''} 학생의 표를 무효로 할까요?`}
        footer={<>
          <button type="button" className="tbx-btn" onClick={() => setInvalidating(null)}>취소</button>
          <button type="button" className="tbx-btn tbx-btn--danger" disabled={!reason.trim()} onClick={async () => {
            if (!invalidating) return;
            const r = await act('inv', () => toolboxRpc.vote(supabase, st.id, 'INVALIDATE', { student_id: invalidating.id, reason: reason.trim() }), '무효 처리했어요');
            if (r) setInvalidating(null);
          }}>무효 처리</button>
        </>}>
        <p className="tbx-body" style={{ marginBottom: 10 }}>무효 표는 집계에서 빠지고, 사유와 함께 기록에 남아요. 학생은 이 표를 다시 바꿀 수 없어요.</p>
        <textarea className="tbx-textarea" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유 (예: 다른 학생 기기로 대신 투표함을 확인)" />
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------
// 카드 구름
// ---------------------------------------------------------------------
function CardsConsole({ st, act, busy }: { st: TeacherActivityState; act: Act; busy: string | null }) {
  const cards: CardRow[] = st.cards ?? [];
  const [view, setView] = useState<'cloud' | 'list'>('cloud');
  const [onlyPending, setOnlyPending] = useState(false);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [openRevision, setOpenRevision] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<CardRow | null>(null);
  const live = st.status === 'OPEN';
  const spotlight = st.state.spotlight as number | null;
  const showAuthor = !!st.config.show_author;
  const filtered = cards.filter((c) => (!onlyPending || !c.presented) && (!q.trim() || c.title.includes(q) || c.body.includes(q) || c.name.includes(q)));
  const latest = cards.find((c) => c.student_id === openId) ?? null;
  const changed = !!latest && openRevision !== null && latest.revision !== openRevision;
  const shown = snapshot ?? latest;

  const openCard = (id: number) => {
    const c = cards.find((x) => x.student_id === id);
    setOpenId(id); setOpenRevision(c?.revision ?? null); setSnapshot(c ?? null);
  };
  const pickRandom = () => {
    const pool = cards.filter((c) => !c.presented && !c.hidden);
    if (pool.length) openCard(pool[randomInt(pool.length)].student_id);
  };
  const pendingCount = cards.filter((c) => !c.presented && !c.hidden).length;

  return (
    <div className="tbx-split tbx-split--console">
      <div className="tbx-stack tbx-stack--loose">
        <section className="tbx-panel tbx-stack">
          <div className="tbx-row tbx-row--between"><h2 className="tbx-h2">제출</h2><span className="tbx-count">{cards.length} / {st.eligible_count}</span></div>
          {live && <Toggle checked={!!st.state.submission_open} onChange={(v) => void act('sub', () => toolboxRpc.cards(supabase, st.id, 'SET_SUBMISSION', { on: v }))}
            title={st.state.submission_open ? '제출 받는 중' : '제출 닫힘'} hint="닫아도 카드 열람과 발표는 계속할 수 있어요" />}
          {live && <Toggle checked={showAuthor} onChange={(v) => void act('author', () => toolboxRpc.cards(supabase, st.id, 'SET_SHOW_AUTHOR', { on: v }))}
            title="발표 화면에 작성자 이름" hint={showAuthor ? '보여요' : '숨겨요. 이 화면에서는 계속 보여요'} />}
          {(st.not_submitted?.length ?? 0) > 0 && (<><span className="tbx-small">아직 내지 않은 학생</span><div className="tbx-selected">{st.not_submitted!.map((s) => <span key={s.student_id} className="tbx-chip">{s.name}</span>)}</div></>)}
        </section>
        <section className="tbx-panel tbx-stack">
          <h2 className="tbx-h2">발표 진행</h2>
          <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--lg" disabled={pendingCount === 0} onClick={pickRandom}>
            {pendingCount === 0 ? (cards.length ? '모든 카드를 발표했어요' : '아직 카드가 없어요') : `아직 발표 안 한 카드 중 무작위 (${pendingCount})`}
          </button>
          {spotlight && <button type="button" className="tbx-btn" disabled={busy !== null} onClick={() => void act('spot', () => toolboxRpc.cards(supabase, st.id, 'SPOTLIGHT', { student_id: null }))}>중계 화면 카드 닫기</button>}
          <p className="tbx-hint">무작위로 골라도 발표 완료로 바뀌지 않아요. 발표가 끝나면 카드에서 ‘발표 완료’를 눌러요.</p>
        </section>
      </div>

      <section className="tbx-panel tbx-stack">
        <div className="tbx-row tbx-row--between tbx-row--wrap">
          <Seg value={view} onChange={setView} options={[{ value: 'cloud', label: '카드 구름' }, { value: 'list', label: '목록' }]} label="보기" />
          <div className="tbx-row">
            <input className="tbx-input" style={{ maxWidth: 180 }} placeholder="제목·내용·이름 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className="tbx-btn tbx-btn--sm" aria-pressed={onlyPending} onClick={() => setOnlyPending(!onlyPending)}>{onlyPending ? '모두 보기' : '미발표만'}</button>
          </div>
        </div>
        {filtered.length === 0 ? <div className="tbx-empty"><Glyph name="cards" /><p className="tbx-small">{cards.length ? '조건에 맞는 카드가 없어요.' : '학생이 카드를 내면 여기에 모여요.'}</p></div>
          : view === 'cloud' ? (
            <CardCloud cards={filtered.map((c) => ({ id: c.student_id, title: c.title, author: c.name, presented: c.presented, hidden: c.hidden }))} onOpen={openCard} selected={openId} showHidden />
          ) : (
            <ol className="tbx-list">
              {filtered.map((c) => (
                <li key={c.student_id} className="tbx-list__row" style={{ opacity: c.hidden ? 0.6 : 1 }}>
                  <span className="tbx-grow"><button type="button" className="tbx-h3" style={{ background: 'none', border: 0, color: 'inherit', padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => openCard(c.student_id)}>{c.title}</button>
                    <span className="tbx-small" style={{ display: 'block' }}>{c.name}{c.revision > 1 ? ` · ${c.revision - 1}번 고침` : ''}</span></span>
                  {c.hidden && <span className="tbx-chip tbx-chip--ember">숨김</span>}
                  {c.presented && <span className="tbx-chip tbx-chip--brass">발표함</span>}
                </li>
              ))}
            </ol>
          )}
      </section>

      <Modal open={openId !== null && !!shown} wide onClose={() => { setOpenId(null); setSnapshot(null); }} title={shown?.title ?? ''}
        footer={live && shown ? <>
          <button type="button" className="tbx-btn tbx-btn--ghost" disabled={busy !== null} onClick={() => void act('hide', () => toolboxRpc.cards(supabase, st.id, 'HIDE', { student_id: shown.student_id, on: !latest?.hidden }))}>{latest?.hidden ? '숨김 풀기' : '숨기기'}</button>
          <button type="button" className="tbx-btn" disabled={busy !== null || !!latest?.hidden} onClick={() => void act('spot', () => toolboxRpc.cards(supabase, st.id, 'SPOTLIGHT', { student_id: spotlight === shown.student_id ? null : shown.student_id }))}>{spotlight === shown.student_id ? '중계 화면에서 닫기' : '중계 화면에 펼치기'}</button>
          <button type="button" className={latest?.presented ? 'tbx-btn' : 'tbx-btn tbx-btn--brass'} disabled={busy !== null} onClick={() => void act('pres', () => toolboxRpc.cards(supabase, st.id, 'PRESENTED', { student_id: shown.student_id, on: !latest?.presented }))}>{latest?.presented ? '발표 완료 취소' : '발표 완료'}</button>
        </> : undefined}>
        {shown && (
          <div className="tbx-stack">
            <div className="tbx-row tbx-row--wrap">
              <span className="tbx-chip">{shown.name}{shown.brand_name ? ` (${shown.brand_name})` : ''}</span>
              {latest?.hidden && <span className="tbx-chip tbx-chip--ember">숨김 — 발표 화면과 무작위 선택에서 빠져요</span>}
              {latest?.presented && <span className="tbx-chip tbx-chip--brass">발표함</span>}
            </div>
            {changed && (
              <Notice icon="✏️">학생이 이 카드를 고쳤어요. <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => { setSnapshot(latest); setOpenRevision(latest!.revision); }}>최신 내용으로 보기</button></Notice>
            )}
            <div className="tbx-well" style={{ maxHeight: '52vh', overflow: 'auto' }}>
              <p style={{ whiteSpace: 'pre-wrap', fontSize: 17, lineHeight: 1.75, color: 'var(--tbx-ivory)' }}>{shown.body}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
