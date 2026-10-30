// =====================================================================
// 학생 — 열린 학급 활동 화면 (버저 · 투표 · 카드 · 점수판 · 대진표)
// ---------------------------------------------------------------------
// 학생은 자기 응답만 보내고, 자기에게 공개된 것만 본다.
// 상태는 신호(S)가 왔을 때만 다시 읽고, 24명이 동시에 읽지 않도록 퍼뜨린다.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';
import { useLiveResource, useToolboxPulse } from '../useToolboxPulse';
import { toToolboxError, toolboxRpc } from '../toolbox_rpc';
import { Glyph, InlineError, KIND_GLYPH, KIND_LABEL, Notice, useAction, useToolboxPrefs } from '../ui';
import { BracketView, ScoreboardBoard, VoteResults } from '../views';
import type { BuzzResult, StudentActivityState } from '../toolbox_types';
import '../toolbox.css';

export function StudentActivityPage() {
  const { id } = useParams<{ id: string }>();
  const activityId = Number(id);
  const navigate = useNavigate();
  const classroomId = useAuthStore((s) => s.context?.classroomId ?? null);
  const studentId = useAuthStore((s) => s.context?.studentId ?? null);
  const pulse = useToolboxPulse(supabase, classroomId, 'S');
  const res = useLiveResource<StudentActivityState>(`act:${activityId}`, () => toolboxRpc.studentState(supabase, activityId), {
    enabled: Number.isFinite(activityId), rev: pulse.rev, revInitial: pulse.initial,
    relevant: () => !pulse.payload.activity_id || Number(pulse.payload.activity_id) === activityId || pulse.payload.event === 'CLEANUP',
    debounceMs: 120, jitterMs: 700,
  });
  const st = res.data;

  // 버저: 라운드가 열렸다는 신호는 다시 읽기를 기다리지 않고 바로 반영한다.
  useEffect(() => {
    const p = pulse.payload;
    if (Number(p.activity_id) !== activityId || p.kind !== 'BUZZER' || !p.round_status) return;
    res.setData((prev) => {
      if (!prev || (prev.round_no ?? 0) > Number(p.round_no ?? 0)) return prev;
      const newRound = Number(p.round_no ?? 0) !== (prev.round_no ?? 0);
      return { ...prev, round_no: Number(p.round_no ?? 0), round_status: p.round_status, opened_at: p.opened_at ?? prev.opened_at,
        my_press: newRound ? null : prev.my_press, my_verdict: newRound ? null : prev.my_verdict };
    });
  }, [pulse.rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = st?.title ?? '학급 활동';
  return (
    <div className="tbx">
      <PageHeader title="모험가 도구함" onBack={() => navigate('/toolbox', { replace: true })} />
      <div className="tbx-page">
        {st?.available && st.kind && (
          <div className="tbx-hero">
            <Glyph name={KIND_GLYPH[st.kind]} size="lg" />
            <div className="tbx-grow">
              <h1 className="tbx-h1">{title}</h1>
              <p className="tbx-small">{KIND_LABEL[st.kind]}</p>
            </div>
            {!pulse.connected && <span className="tbx-chip tbx-chip--ember" title="실시간 연결이 끊겨 잠시 뒤 다시 확인해요">연결 확인 중</span>}
          </div>
        )}
        {res.loading && !st && <p className="tbx-small">불러오는 중…</p>}
        {res.error && !st && <Notice tone="ember" icon="⚠️">{toToolboxError(res.error).message} <button className="tbx-btn tbx-btn--sm" onClick={res.refresh}>다시 불러오기</button></Notice>}
        {st && !st.available && (
          <div className="tbx-panel tbx-empty">
            <Glyph name="kit" size="lg" />
            <p className="tbx-h2">이 활동은 끝났거나 참여할 수 없어요</p>
            <button type="button" className="tbx-btn" style={{ marginTop: 14 }} onClick={() => navigate('/toolbox')}>도구함으로</button>
          </div>
        )}
        {st?.available && st.kind === 'BUZZER' && <StudentBuzzer st={st} activityId={activityId} onChanged={res.refresh} setData={res.setData} />}
        {st?.available && st.kind === 'VOTE' && <StudentVote st={st} activityId={activityId} studentId={studentId} onChanged={res.refresh} />}
        {st?.available && st.kind === 'CARDS' && <StudentCards st={st} activityId={activityId} onChanged={res.refresh} />}
        {st?.available && st.kind === 'SCOREBOARD' && (
          <ScoreboardBoard units={st.units ?? []} scores={st.scores ?? {}} sort={st.sort ?? 'FIXED'} />
        )}
        {st?.available && st.kind === 'TOURNAMENT' && (
          st.state?.revealed_at
            ? <div className="tbx-panel"><BracketView state={st.state} units={st.units ?? []} reveal={recent(st.state.revealed_at, st.server_now)}
                highlightKeys={new Set((st.units ?? []).filter((u) => u.mine).map((u) => u.key))} /></div>
            : <div className="tbx-panel tbx-empty"><Glyph name="tournament" size="lg" /><p className="tbx-h2">대진표를 준비하고 있어요</p><p className="tbx-small" style={{ marginTop: 4 }}>운영국이 대진을 공개하면 여기에 나타나요.</p></div>
        )}
      </div>
    </div>
  );
}

function recent(iso: string, serverNow: string) {
  return new Date(serverNow).getTime() - new Date(iso).getTime() < 15_000;
}

// ---------------------------------------------------------------------
// 버저
// ---------------------------------------------------------------------
function StudentBuzzer({ st, activityId, onChanged, setData }: {
  st: StudentActivityState; activityId: number; onChanged: () => void;
  setData: (u: (p: StudentActivityState | undefined) => StudentActivityState | undefined) => void;
}) {
  const prefs = useToolboxPrefs();
  const [sending, setSending] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  // 서버 시계와 기기 시계 차이 (잠금 남은 시간을 맞게 보여주기 위해)
  const offset = useRef(0);
  useEffect(() => { offset.current = new Date(st.server_now).getTime() - Date.now(); }, [st.server_now]);
  const [tick, setTick] = useState(0);
  const lockedUntil = st.locked_until ? new Date(st.locked_until).getTime() : 0;
  const lockLeft = Math.max(0, lockedUntil - (Date.now() + offset.current));
  useEffect(() => {
    if (lockLeft <= 0) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 200);
    return () => window.clearInterval(t);
  }, [lockLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  void tick;

  if (!st.can_press) {
    return <Notice icon="ℹ️">{st.team_press === 'REP' ? '이 활동은 팀 대표만 버저를 누를 수 있어요.' : '이 버저에 참가하지 않았어요.'}</Notice>;
  }
  const open = st.round_status === 'OPEN';
  const pressed = !!st.my_press;
  const state = lockLeft > 0 ? 'lock' : pressed ? 'done' : open ? 'live' : 'wait';

  const press = async () => {
    if (sending || state === 'done' || state === 'lock') return;
    setSending(true);
    setLastError(null);
    try {
      const r: BuzzResult = await toolboxRpc.buzz(supabase, activityId);
      offset.current = new Date(r.server_now).getTime() - Date.now();
      if (r.result === 'ACCEPTED' || r.result === 'ALREADY') {
        prefs.play('buzz');
        setData((p) => (p ? { ...p, my_press: { rank: r.rank, by_me: r.result === 'ACCEPTED' ? true : (r as any).by_me, student_name: '' }, round_status: 'OPEN' } : p));
      } else if (r.result === 'FALSE_START' || r.result === 'LOCKED') {
        prefs.play('lock');
        setData((p) => (p ? { ...p, locked_until: r.locked_until } : p));
      } else if (r.result === 'ROUND_FULL') {
        setLastError('이번 문제는 이미 첫 번째 입력이 들어왔어요.');
        onChanged();
      } else {
        onChanged();
      }
    } catch (e) {
      // 접수됐는지 모르는 상태를 '접수됨'으로 보이지 않는다.
      setLastError(`${toToolboxError(e).message} 접수됐는지 화면이 다시 확인해요.`);
      onChanged();
    } finally {
      setSending(false);
    }
  };

  const label = sending ? '보내는 중' : state === 'lock' ? 'LOCK' : state === 'done' ? `${st.my_press!.rank}번째` : state === 'live' ? '누르기' : '대기';
  return (
    <div className="tbx-stack" style={{ alignItems: 'center', gap: 28 }}>
      <div className="tbx-row tbx-row--wrap" style={{ justifyContent: 'center' }}>
        {st.my_unit && <span className="tbx-chip tbx-chip--brass"><span className="tbx-dot" style={{ background: st.my_unit.color ?? 'var(--tbx-brass)' }} />{st.my_unit.label}</span>}
        <span className="tbx-chip">{(st.round_no ?? 0) > 0 ? `${st.round_no}번 문제` : '첫 문제 대기'}</span>
        {(st.points ?? 0) > 0 && <span className="tbx-chip">{st.points}점</span>}
      </div>
      <button type="button" className="tbx-buzzer" data-state={state} onPointerDown={(e) => { e.preventDefault(); void press(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void press(); } }}
        aria-label={`버저 ${label}`} aria-live="polite">
        {label}
      </button>
      <div style={{ minHeight: 64, textAlign: 'center' }} aria-live="polite">
        {state === 'wait' && <p className="tbx-h3">운영국이 문제를 열면 버튼이 밝아져요</p>}
        {state === 'wait' && <p className="tbx-small" style={{ marginTop: 4 }}>열리기 전에 누르면 5초 동안 잠겨요.</p>}
        {state === 'live' && <p className="tbx-h3 tbx-brass-text">지금 누를 수 있어요</p>}
        {state === 'lock' && <p className="tbx-h3 tbx-ember-text">너무 빨랐어요! {Math.ceil(lockLeft / 1000)}초 뒤에 다시 누를 수 있어요</p>}
        {state === 'done' && (
          <>
            <p className="tbx-h2">{st.my_press!.by_me ? `${st.my_press!.rank}번째로 접수됐어요` : `팀에서 ${st.my_press!.rank}번째로 접수됐어요`}</p>
            {st.my_verdict === 'CORRECT' && <p className="tbx-h2 tbx-brass-text" style={{ marginTop: 6 }}>정답!</p>}
            {st.my_verdict === 'WRONG' && <p className="tbx-h3" style={{ marginTop: 6 }}>아쉬워요, 다음 문제를 기다려요</p>}
            {!st.my_verdict && <p className="tbx-small" style={{ marginTop: 4 }}>순서는 서버에 도착한 순서예요.</p>}
          </>
        )}
        {lastError && <p className="tbx-field-error">{lastError}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 투표
// ---------------------------------------------------------------------
function seededOrder<T>(items: T[], seed: number): T[] {
  const a = items.slice();
  let x = seed * 9301 + 49297;
  for (let i = a.length - 1; i > 0; i -= 1) { x = (x * 9301 + 49297) % 233280; const j = Math.floor((x / 233280) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function StudentVote({ st, activityId, studentId, onChanged }: { st: StudentActivityState; activityId: number; studentId: number | null; onChanged: () => void }) {
  const cfg = st.config!;
  const mine = st.my_ballot;
  const [picked, setPicked] = useState<string[]>(mine?.choices ?? []);
  const [editing, setEditing] = useState(!mine);
  useEffect(() => { if (mine) { setPicked(mine.choices); } }, [mine?.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const { run, busy, error } = useAction();
  const options = useMemo(() => (cfg.shuffle ? seededOrder(cfg.options, (studentId ?? 1) * 31 + activityId) : cfg.options), [cfg, studentId, activityId]);
  const open = st.status === 'OPEN';
  const multi = cfg.max_choices > 1;
  const abstained = picked.includes('ABSTAIN');

  const toggle = (key: string) => {
    if (key === 'ABSTAIN') { setPicked(abstained ? [] : ['ABSTAIN']); return; }
    const base = picked.filter((k) => k !== 'ABSTAIN');
    if (base.includes(key)) setPicked(base.filter((k) => k !== key));
    else if (!multi) setPicked([key]);
    else if (base.length < cfg.max_choices) setPicked([...base, key]);
  };
  const submit = async () => {
    const r = await run('vote', () => toolboxRpc.submitVote(supabase, activityId, picked), mine ? '투표를 바꿨어요' : '투표했어요');
    if (r) { setEditing(false); onChanged(); }
  };

  return (
    <div className="tbx-stack tbx-stack--loose">
      {cfg.description && <p className="tbx-body" style={{ color: 'var(--tbx-ivory)' }}>{cfg.description}</p>}
      <Notice icon="🔒">
        {cfg.anonymous ? '누가 무엇을 골랐는지 다른 친구들은 알 수 없어요.' : '이 투표는 결과 발표 때 누가 무엇을 골랐는지 공개될 수 있어요.'}
        {open && ' 마감 전까지는 내 표를 바꿀 수 있어요.'}
      </Notice>
      {mine?.invalidated && <Notice tone="ember" icon="⚠️">운영국이 내 표를 확인하고 있어요. 지금은 바꿀 수 없어요.</Notice>}

      {st.revealed && st.tally?.counts ? (
        <section className="tbx-panel tbx-stack">
          <h2 className="tbx-h2">결과</h2>
          <VoteResults config={cfg} tally={st.tally} />
          {st.decision_note && <Notice icon="📝">{st.decision_note}</Notice>}
          {mine && <MyChoicePeek text={mine.choices.map((k) => (k === 'ABSTAIN' ? '기권' : cfg.options.find((o) => o.key === k)?.label)).join(', ')} />}
        </section>
      ) : (
        <section className="tbx-panel tbx-stack">
          <div className="tbx-row tbx-row--between">
            <h2 className="tbx-h2">{cfg.mode === 'CANDIDATE' ? `${cfg.position ?? ''} 후보` : '선택지'}</h2>
            <span className="tbx-small" style={{ fontWeight: 800 }}>{multi ? `최대 ${cfg.max_choices}개` : '하나만'} 고를 수 있어요</span>
          </div>
          {!editing && mine ? (
            <>
              <div className="tbx-notice tbx-notice--signal"><span className="tbx-notice__icon">✓</span>
                <div><b>투표했어요</b><MyChoicePeek text={mine.choices.map((k) => (k === 'ABSTAIN' ? '기권' : cfg.options.find((o) => o.key === k)?.label)).join(', ')} /></div>
              </div>
              {open && !mine.invalidated && <button type="button" className="tbx-btn" onClick={() => setEditing(true)}>내 표 바꾸기</button>}
            </>
          ) : (
            <>
              <div className="tbx-stack tbx-stack--tight">
                {options.map((o) => (
                  <button key={o.key} type="button" className="tbx-choice" data-multi={multi} aria-pressed={picked.includes(o.key)} disabled={!open} onClick={() => toggle(o.key)}>
                    <span className="tbx-choice__mark" />
                    <span>{o.label}{o.desc && <small>{o.desc}</small>}</span>
                  </button>
                ))}
                {cfg.allow_abstain && (
                  <button type="button" className="tbx-choice" aria-pressed={abstained} disabled={!open} onClick={() => toggle('ABSTAIN')} style={{ fontSize: 15 }}>
                    <span className="tbx-choice__mark" /><span>기권<small>아무도 고르지 않아요</small></span>
                  </button>
                )}
              </div>
              <InlineError error={error} />
              {open ? (
                <div className="tbx-row">
                  <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--lg tbx-grow" disabled={picked.length === 0 || busy !== null} onClick={() => void submit()}>
                    {busy ? '보내는 중…' : mine ? '이대로 바꾸기' : '투표하기'}
                  </button>
                  {mine && <button type="button" className="tbx-btn tbx-btn--lg" onClick={() => { setPicked(mine.choices); setEditing(false); }}>취소</button>}
                </div>
              ) : <Notice icon="⏱️">투표가 마감되었어요. 결과는 운영국이 공개해요.</Notice>}
            </>
          )}
          <p className="tbx-small">참여 {st.tally?.submitted ?? 0} / {st.tally?.eligible ?? 0}명{cfg.close_at ? ` · ${new Date(cfg.close_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 마감` : ''}</p>
        </section>
      )}
    </div>
  );
}

/** 내가 고른 것: 옆자리 친구가 화면을 보더라도 드러나지 않게 기본은 가리고, 누르면 4초만 보여 준다. */
function MyChoicePeek({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!show) return;
    const t = window.setTimeout(() => setShow(false), 4000);
    return () => window.clearTimeout(t);
  }, [show]);
  return (
    <div className="tbx-small" style={{ marginTop: 2 }}>
      내가 고른 것:{' '}
      {show
        ? <b>{text}</b>
        : <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" style={{ padding: '2px 10px', minHeight: 0 }} onClick={() => setShow(true)}>👁 눌러서 확인</button>}
    </div>
  );
}

// ---------------------------------------------------------------------
// 발표 카드
// ---------------------------------------------------------------------
function StudentCards({ st, activityId, onChanged }: { st: StudentActivityState; activityId: number; onChanged: () => void }) {
  const mine = st.my_card;
  const [title, setTitle] = useState(mine?.title ?? '');
  const [body, setBody] = useState(mine?.body ?? '');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (mine && !dirty) { setTitle(mine.title); setBody(mine.body); } }, [mine?.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const { run, busy, error } = useAction();
  const open = st.status === 'OPEN' && st.submission_open;
  const t = title.trim(); const b = body.trim();
  const valid = t.length >= 1 && t.length <= 40 && b.length >= 1 && b.length <= 2000;

  return (
    <div className="tbx-stack tbx-stack--loose">
      {st.prompt && <div className="tbx-panel"><span className="tbx-small" style={{ fontWeight: 800 }}>주제</span><p className="tbx-h2" style={{ marginTop: 4 }}>{st.prompt}</p></div>}
      <Notice icon={st.show_author ? '👤' : '🙈'}>
        {st.show_author ? '발표 화면에 내 이름이 함께 보여요.' : '발표 화면에는 내 이름이 보이지 않아요. 운영국은 누가 썼는지 확인할 수 있어요.'}
        {' '}내 카드는 다른 친구들의 화면에 보이지 않고, 교실 발표 화면에만 나와요.
      </Notice>
      <section className="tbx-panel tbx-stack">
        <label>
          <span className="tbx-label">제목</span>
          <input className="tbx-input" value={title} maxLength={60} disabled={!open} placeholder="한눈에 보이는 짧은 제목"
            onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
          <span className="tbx-hint" style={{ display: 'block', color: t.length > 40 ? '#ffb4a8' : undefined }}>{t.length} / 40자</span>
        </label>
        <label>
          <span className="tbx-label">내용</span>
          <textarea className="tbx-textarea" style={{ minHeight: 180 }} value={body} maxLength={2100} disabled={!open} placeholder="발표할 내용을 적어요"
            onChange={(e) => { setBody(e.target.value); setDirty(true); }} />
          <span className="tbx-hint" style={{ display: 'block', color: b.length > 2000 ? '#ffb4a8' : undefined }}>{b.length.toLocaleString()} / 2,000자 · 남은 {Math.max(0, 2000 - b.length).toLocaleString()}자</span>
        </label>
        <InlineError error={error} />
        {open ? (
          <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--lg" disabled={!valid || busy !== null || (!!mine && !dirty)}
            onClick={async () => { const r = await run('card', () => toolboxRpc.submitCard(supabase, activityId, t, b), mine ? '카드를 고쳤어요' : '카드를 냈어요'); if (r) { setDirty(false); onChanged(); } }}>
            {busy ? '보내는 중…' : mine ? (dirty ? '고친 내용 보내기' : '제출함') : '카드 내기'}
          </button>
        ) : <Notice icon="⏱️">{mine ? '제출이 닫혔어요. 낸 카드는 그대로 남아 있어요.' : '지금은 카드를 낼 수 없어요.'}</Notice>}
        {mine && <p className="tbx-small">마지막으로 낸 시각 {new Date(mine.updated_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</p>}
      </section>
    </div>
  );
}

