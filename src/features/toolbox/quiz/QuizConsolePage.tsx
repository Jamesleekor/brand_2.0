// =====================================================================
// 교사 — 퀴즈 로얄 진행 화면 (교사 PC 한 곳에서 모든 조작)
// ---------------------------------------------------------------------
// 기본 흐름: 시작 → (자동 마감) → 답안 공개 → 채점 확정 → 다음
// 정답·실제 점수는 이 화면에만 보인다. 교실 화면(중계)은 공개된 것만 받는다.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import { InlineError, Notice, Seg, colorAt, useAction, useConfirm } from '../ui';
import { toToolboxError } from '../toolbox_rpc';
import { isAlreadyDone, offlineGuilds, quizRpc, type QAction } from './quiz_rpc';
import { serverNow, useCountdown, useQuizLive } from './useQuizLive';
import { GuildMark, PhaseChip, QuizMedia, TimerBar, TimerText, openQuizScreen, rankMap } from './quiz_ui';
import { useReasonDialog } from './quiz_dialogs';
import { CheckTab, QuestionEditor } from './QuizSetupPage';
import { QuizRecords } from './QuizRecords';
import type { QuizAnswer, QuizQuestion, ResultSnapshot, TeacherQuizState, Verdict } from './quiz_types';
import { KIND_LABEL, QPHASE_LABEL, THEME_LABEL } from './quiz_types';
import '../toolbox.css';
import './quiz.css';

export function QuizConsolePage() {
  const { id } = useParams<{ id: string }>();
  const quizId = Number(id);
  const navigate = useNavigate();
  const live = useQuizLive<TeacherQuizState>(supabase, Number.isFinite(quizId) ? `Q${quizId}-T` : null,
    () => quizRpc.state(supabase, quizId), {
      enabled: Number.isFinite(quizId), versionOf: (d) => d.event.version, serverNowOf: (d) => d.server_now,
      relevant: (p) => p.event !== 'MEDIA', intervalMs: 30_000,
    });
  const [view, setView] = useState<'run' | 'records'>('run');
  const st = live.data;
  if (!Number.isFinite(quizId)) return null;

  return (
    <TeacherShell>
      <div className="tbx tbx-teacher-page qz-page qz-console">
        <div className="tbx-row tbx-row--between tbx-row--wrap" style={{ gap: 10 }}>
          <div className="tbx-row" style={{ gap: 8 }}>
            <button type="button" className="tbx-btn tbx-btn--ghost tbx-btn--sm" onClick={() => navigate('/teacher/toolbox')}>← 도구함</button>
            <button type="button" className="tbx-btn tbx-btn--ghost tbx-btn--sm" onClick={() => navigate(`/teacher/toolbox/quiz/${quizId}/setup`)}>준비 화면</button>
          </div>
          <div className="tbx-row tbx-row--wrap" style={{ gap: 8 }}>
            {!live.connected && <span className="tbx-chip tbx-chip--ember" title="실시간 연결이 끊겨 3초마다 확인해요">연결 확인 중</span>}
            {st && <PhaseChip phase={st.event.phase} q={st.event.eff_q_phase} />}
            <Seg<'run' | 'records'> value={view} onChange={setView} options={[{ value: 'run', label: '진행' }, { value: 'records', label: '결과·기록' }]} />
            <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--brass" onClick={() => openQuizScreen(quizId)}>🖥 중계 화면 새 창</button>
          </div>
        </div>
        <h1 className="tbx-h1">{st?.event.title ?? '퀴즈 로얄'}{st?.event.is_rehearsal ? ' · 리허설' : ''}</h1>
        {live.error && <Notice tone="ember" icon="⚠️">{toToolboxError(live.error).message} <button type="button" className="tbx-btn tbx-btn--sm" onClick={live.refresh}>다시 읽기</button></Notice>}
        {!st ? <p className="tbx-small">불러오는 중…</p> : view === 'records' ? <QuizRecords st={st} onChanged={live.refresh} /> : (
          st.event.phase === 'SETUP' || st.event.phase === 'LOBBY' ? (
            <CheckTab st={st} onSaved={live.refresh} onStarted={live.refresh} />
          ) : st.event.phase === 'IND_CEREMONY' || st.event.phase === 'FINAL_CEREMONY' ? (
            <CeremonyControl st={st} onChanged={live.refresh} />
          ) : st.event.phase === 'COMPLETED' ? (
            <FinalSummary st={st} />
          ) : (
            <RunPanel st={st} onChanged={live.refresh} />
          )
        )}
      </div>
    </TeacherShell>
  );
}

// ---------------------------------------------------------------------
// 진행 패널
// ---------------------------------------------------------------------
function RunPanel({ st, onChanged }: { st: TeacherQuizState; onChanged: () => void }) {
  const ev = st.event;
  const cfg = ev.config;
  const q = st.questions.find((x) => x.id === ev.current_question_id) ?? null;
  const { run, busy, error } = useAction();
  const { ask, dialog } = useConfirm();
  const reason = useReasonDialog();
  const [peek, setPeek] = useState(false);
  const [editing, setEditing] = useState<QuizQuestion | 'new' | null>(null);
  const [presence, setPresence] = useState<Record<string, string | null>>({});
  const [presenceNow, setPresenceNow] = useState(0);
  const qPhase = ev.eff_q_phase;
  const ms = useCountdown(qPhase === 'LIVE' ? 'LIVE' : ev.q_phase, ev.deadline_at, ev.remaining_ms);

  // 태블릿 접속 상태: 8초마다 가볍게
  useEffect(() => {
    let alive = true;
    const tick = () => quizRpc.presence(supabase, ev.id).then((r) => { if (alive) { setPresence(r.devices); setPresenceNow(Date.parse(r.server_now)); } }).catch(() => undefined);
    void tick();
    const iv = window.setInterval(() => { void tick(); }, 8_000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [ev.id]);
  const online = (gid: number) => {
    const at = presence[String(gid)] ?? st.guilds.find((g) => g.guild_id === gid)?.device_seen_at ?? null;
    const now = presenceNow || serverNow();
    return !!at && now - Date.parse(at) < 40_000;
  };

  // 시간이 끝나면(유예 포함) 서버에 마감을 한 번 알려 모든 화면을 '마감'으로 맞춘다
  const autoLocked = useRef<string>('');
  useEffect(() => {
    if (!q || ev.q_phase !== 'LIVE' || ms === null || ms > 0) return;
    const key = `${q.id}:${q.attempt}`;
    if (autoLocked.current === key) return;
    autoLocked.current = key;
    const t = window.setTimeout(() => {
      void quizRpc.q(supabase, ev.id, q.id, q.attempt, 'LOCK').catch(() => undefined).finally(onChanged);
    }, cfg.grace_ms + 400);
    return () => window.clearTimeout(t);
  }, [ms === 0, ev.q_phase, q?.id, q?.attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPeek(false); }, [q?.id, q?.attempt]);

  if (!q) {
    return (
      <div className="tbx-panel tbx-stack">
        <Notice icon="ℹ️">이 구간에 남은 문제가 없어요. 문제를 추가하거나 대회를 종료해 주세요.</Notice>
        <button type="button" className="tbx-btn tbx-btn--brass" onClick={() => setEditing('new')}>문제 1개 추가</button>
        {editing && <QuestionEditor st={st} q={null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
      </div>
    );
  }

  const answers: QuizAnswer[] = st.answers.filter((a) => a.question_id === q.id && a.attempt === q.attempt);
  const byGuild = new Map(answers.map((a) => [a.guild_id, a]));
  const stageQs = st.questions.filter((x) => x.stage === q.stage && x.status === 'ACTIVE');
  const stageIdx = stageQs.filter((x) => x.seq <= q.seq).length;
  const posQs = stageQs.filter((x) => x.position_index === q.position_index);
  const posIdx = posQs.filter((x) => x.seq <= q.seq).length;
  const allActive = st.questions.filter((x) => x.status === 'ACTIVE');
  const overallIdx = allActive.filter((x) => x.seq <= q.seq).length;
  const prev = st.questions.filter((x) => x.stage === q.stage && x.seq < q.seq).sort((a, b) => b.seq - a.seq)[0];
  const handoff = ev.q_phase === 'IDLE' && q.stage === 'INDIVIDUAL' && (!prev || prev.position_index !== q.position_index);
  const nextQ = stageQs.filter((x) => x.seq > q.seq && !x.graded_at).sort((a, b) => a.seq - b.seq)[0];
  const isLastInStage = !nextQ;
  const submittedCount = answers.filter((a) => a.submitted_at).length;
  const playerOf = (gid: number) => st.roster.find((r) => r.guild_id === gid && r.position_index === q.position_index)?.name ?? null;
  const posLabel = q.position_index !== null ? cfg.positions[q.position_index] : null;

  const act = async (action: QAction, args: Record<string, unknown> = {}, success?: string) => {
    try {
      await quizRpc.q(supabase, ev.id, q.id, q.attempt, action, args);
      onChanged();
      return true;
    } catch (e) {
      if (isAlreadyDone(e)) { onChanged(); return true; }
      const off = offlineGuilds(e);
      if (off && action === 'START') {
        const why = await reason.ask('연결되지 않은 태블릿이 있어요', <>{off.join(', ')} 태블릿이 40초 넘게 연결되지 않았어요. 그래도 시작하려면 사유를 적어 주세요. (자동으로 시작하지 않아요)</>, '그래도 시작');
        if (!why) return false;
        const r = await run(action, () => quizRpc.q(supabase, ev.id, q.id, q.attempt, action, { ...args, reason: why }), success);
        onChanged();
        return r !== null;
      }
      const msg = toToolboxError(e).message;
      if (action === 'REVEAL' && /마감하고 공개/.test(msg)) {
        if (!(await ask('아직 답을 받는 중이에요', '지금 마감하고 다섯 길드의 답을 공개할까요?', '마감하고 공개'))) return false;
        const r = await run(action, () => quizRpc.q(supabase, ev.id, q.id, q.attempt, 'REVEAL', { lock: true }));
        onChanged();
        return r !== null;
      }
      await run(action, () => Promise.reject(e));
      return false;
    }
  };

  const grade = async (gid: number, v: Verdict | null) => {
    const res = await run(`g${gid}`, () => quizRpc.grade(supabase, ev.id, q.id, q.attempt, gid, v));
    if (res !== null) onChanged();
  };

  const correct = async (gid: number, cur: Verdict | null) => {
    const to: Verdict = cur === 'CORRECT' ? 'WRONG' : 'CORRECT';
    const g = st.guilds.find((x) => x.guild_id === gid);
    const why = await reason.ask('확정한 점수 정정', <>{g?.name}: {cur === 'CORRECT' ? '정답 → 오답' : '오답 → 정답'}({to === 'CORRECT' ? `+${q.points}` : `-${q.points}`}점). 누적 점수는 다시 계산돼요. 이미 공개한 순위판은 '정정 공표'를 눌러야 바뀌어요.</>, '정정하기', { placeholder: '예: 띄어쓰기 표기 차이 인정' });
    if (!why) return;
    const res = await run('correct', () => quizRpc.correct(supabase, ev.id, q.id, gid, to, why), '점수를 정정했어요');
    if (res !== null) onChanged();
  };

  const voidQ = async () => {
    const why = await reason.ask('이 문제 무효 처리', '이 문제의 점수를 모든 길드에서 빼요. 답안 기록은 남아요.', '무효 처리', { danger: true, placeholder: '예: 문제 오류' });
    if (why) await act('VOID', { reason: why }, '무효 처리했어요');
  };
  const reissue = async () => {
    const why = await reason.ask('같은 문제 다시 내기', '지난 답안은 기록으로 남고 점수에서 빠져요. 다섯 길드 모두 새로 답해요.', '다시 내기', { placeholder: '예: 태블릿 와이파이 끊김' });
    if (why) await act('REISSUE', { reason: why }, '다시 낼 준비가 됐어요');
  };
  const endQuiz = async () => {
    const why = await reason.ask('대회를 지금 끝낼까요?', '진행 중인 문제는 마감되고, 지금까지의 기록은 모두 남아요. 되돌릴 수 없어요.', '대회 종료', { danger: true });
    if (why) { const r = await run('end', () => quizRpc.end(supabase, ev.id, why), '대회를 종료했어요'); if (r !== null) onChanged(); }
  };

  // 지금 단계의 주 버튼
  let primary: { label: string; onClick: () => void; tone?: string; disabled?: boolean } | null = null;
  if (q.status === 'VOID') primary = { label: isLastInStage ? (q.stage === 'INDIVIDUAL' ? '개인전 결과 발표로 →' : '최종 결과 발표로 →') : '다음 문제 →', onClick: () => void act('NEXT') };
  else if (ev.q_phase === 'IDLE' || ev.q_phase === 'SHOWN') primary = { label: ev.q_phase === 'SHOWN' ? '▶ 답 받기 시작' : '▶ 문제 시작', onClick: () => void act('START'), tone: 'signal' };
  else if (ev.q_phase === 'LIVE' && qPhase === 'LIVE') primary = { label: `답 받는 중 ${submittedCount}/${st.guilds.length}`, onClick: () => undefined, disabled: true };
  else if (ev.q_phase === 'LIVE') primary = { label: '마감 처리 중…', onClick: () => void act('LOCK'), disabled: false };
  else if (ev.q_phase === 'PAUSED') primary = { label: '▶ 재개', onClick: () => void act('RESUME'), tone: 'signal' };
  else if (ev.q_phase === 'LOCKED') primary = { label: '📣 답안 공개', onClick: () => void act('REVEAL'), tone: 'brass' };
  else if (ev.q_phase === 'REVEALED') primary = { label: '✔ 채점 확정', onClick: () => void act('FINALIZE'), tone: 'brass',
    disabled: answers.some((a) => a.verdict === null && a.answer && a.answer.trim() !== '') };
  else if (ev.q_phase === 'GRADED') primary = { label: isLastInStage ? (q.stage === 'INDIVIDUAL' ? '개인전 결과 발표로 →' : '최종 결과 발표로 →') : '다음 문제 →', onClick: () => void act('NEXT'), tone: 'signal' };

  const scores = st.scores;
  const totals: Record<string, number> = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v.total]));
  const ranks = rankMap(totals);
  const board = ev.public_board;
  const boardRanks = rankMap(board?.scores ?? {});
  const showAnswers = peek || ['REVEALED', 'GRADED'].includes(ev.q_phase);

  return (
    <div className="qz-run">
      <div className="qz-run__main tbx-stack">
        <div className="qz-run__head">
          <span className="tbx-chip tbx-chip--brass">{q.stage === 'INDIVIDUAL' ? '개인전' : '단체전'}</span>
          {posLabel && <span className="tbx-chip">{posLabel}전 {posIdx}/{posQs.length}</span>}
          <span className="tbx-chip">구간 {stageIdx}/{stageQs.length}</span>
          <span className="tbx-chip">전체 {overallIdx}/{allActive.length}</span>
          {q.attempt > 0 && <span className="tbx-chip tbx-chip--violet">재출제 {q.attempt}회차</span>}
          {q.status === 'VOID' && <span className="tbx-chip tbx-chip--ember">무효</span>}
          <span className="tbx-grow" />
          <span className="tbx-chip">{QPHASE_LABEL[qPhase]}</span>
        </div>

        {handoff && (
          <Notice tone="signal" icon="🔁">
            <b>{posLabel}전 출전</b> — 태블릿을 다음 선수에게 넘겨요:{' '}
            {st.guilds.map((g) => `${g.name} ${playerOf(g.guild_id) ?? '(비어 있음)'}`).join(' · ')}
          </Notice>
        )}

        <div className="tbx-panel qz-qcard">
          <div className="qz-qcard__prompt">{q.prompt}</div>
          {q.media_type && (
            <div className="qz-qcard__media">
              <QuizMedia client={supabase} type={q.media_type} path={q.media_path} url={q.media_url} mode="thumb" />
              {(q.media_type === 'VIDEO' || q.media_type === 'YOUTUBE') && (
                <div className="tbx-row" style={{ gap: 6 }}>
                  <span className="tbx-small">교실 화면 영상:</span>
                  <button type="button" className="tbx-btn tbx-btn--sm" disabled={ev.q_phase === 'IDLE'} onClick={() => void act('MEDIA', { cmd: 'play' })}>▶ 재생</button>
                  <button type="button" className="tbx-btn tbx-btn--sm" disabled={ev.q_phase === 'IDLE'} onClick={() => void act('MEDIA', { cmd: 'pause' })}>⏸ 멈춤</button>
                  <button type="button" className="tbx-btn tbx-btn--sm" disabled={ev.q_phase === 'IDLE'} onClick={() => void act('MEDIA', { cmd: 'restart' })}>⟲ 처음부터</button>
                </div>
              )}
            </div>
          )}
          <div className="qz-qcard__key">
            <span>정답 <b>{q.answer_key}</b></span>
            {q.accepted.length > 0 && <span className="tbx-small">허용: {q.accepted.join(' | ')}</span>}
            {q.note && <span className="tbx-small">메모: {q.note}</span>}
            <span className="tbx-small">{q.points}점 · {q.time_limit_sec}초{q.kind ? ` · ${KIND_LABEL[q.kind]}` : ''}{q.theme ? ` · ${THEME_LABEL[q.theme]}` : ''}</span>
            <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" onClick={() => setEditing(q)}>정답 수정</button>
          </div>
        </div>

        <div className="qz-controls">
          <div className="qz-controls__clock">
            <TimerText ms={ms ?? (ev.q_phase === 'IDLE' || ev.q_phase === 'SHOWN' ? q.time_limit_sec * 1000 : 0)} total={q.time_limit_sec} big />
            <TimerBar ms={ms ?? (ev.q_phase === 'IDLE' || ev.q_phase === 'SHOWN' ? q.time_limit_sec * 1000 : 0)} total={q.time_limit_sec} />
          </div>
          <div className="qz-controls__buttons">
            {ev.q_phase === 'IDLE' && q.status === 'ACTIVE' && (
              <button type="button" className="tbx-btn" onClick={() => void act('SHOW')} title="지문·미디어를 먼저 보여 주고, 답은 아직 받지 않아요(영상 문제에 좋아요)">👁 문제만 보여 주기</button>
            )}
            {ev.q_phase === 'LIVE' && qPhase === 'LIVE' && (
              <>
                <button type="button" className="tbx-btn" onClick={() => void act('PAUSE')}>⏸ 일시정지</button>
                <button type="button" className="tbx-btn" onClick={() => void act('LOCK')}>🔒 지금 마감</button>
              </>
            )}
            {ev.q_phase === 'PAUSED' && <button type="button" className="tbx-btn" onClick={() => void act('LOCK')}>🔒 지금 마감</button>}
            {(ev.q_phase === 'LOCKED' || ev.q_phase === 'REVEALED') && (
              <button type="button" className="tbx-btn" onClick={() => void act('AUTO_GRADE')} title="아직 판정하지 않은 길드에 자동 판정 후보를 채워요">🤖 자동 후보 적용</button>
            )}
            {primary && (
              <button type="button" className={`tbx-btn tbx-btn--lg ${primary.tone === 'signal' ? 'tbx-btn--signal' : primary.tone === 'brass' ? 'tbx-btn--brass' : ''}`}
                disabled={primary.disabled || !!busy} onClick={primary.onClick}>{primary.label}</button>
            )}
          </div>
        </div>
        {ev.q_phase === 'REVEALED' && answers.some((a) => a.verdict === null && a.answer && a.answer.trim() !== '') && (
          <p className="tbx-small tbx-brass-text">제출한 답마다 O/X를 고르면 '채점 확정'이 켜져요. 미제출은 자동으로 0점이에요.</p>
        )}

        <div className="tbx-panel tbx-panel--flush">
          <div className="qz-gtable__head">
            <span className="tbx-h3">길드 답안 {submittedCount}/{st.guilds.length}</span>
            {!['REVEALED', 'GRADED'].includes(ev.q_phase) && (
              <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" aria-pressed={peek} onClick={() => setPeek((v) => !v)}>
                {peek ? '🙈 답안 접기' : '👀 답안 미리 보기(교사만)'}
              </button>
            )}
          </div>
          <table className="qz-gtable">
            <thead><tr><th>길드</th><th>{q.stage === 'INDIVIDUAL' ? '출전 선수' : '단체전'}</th><th>태블릿</th><th>제출</th><th>답안</th><th>후보</th><th>판정</th><th>점수</th></tr></thead>
            <tbody>
              {st.guilds.map((g, i) => {
                const a = byGuild.get(g.guild_id);
                const submitted = !!a?.submitted_at;
                const canGrade = ev.q_phase === 'LOCKED' || ev.q_phase === 'REVEALED';
                return (
                  <tr key={g.guild_id}>
                    <td><span className="tbx-row" style={{ gap: 8 }}><GuildMark name={g.name} logo={g.logo_url} color={colorAt(i)} /><b>{g.name}</b></span></td>
                    <td>{q.stage === 'INDIVIDUAL' ? (playerOf(g.guild_id) ?? '—') : '길드 전원'}</td>
                    <td>{online(g.guild_id) ? <span className="qz-dot qz-dot--on" title="연결됨" /> : <span className="qz-dot qz-dot--off" title="40초 넘게 연결 없음" />}</td>
                    <td>{submitted ? <span className="tbx-chip tbx-chip--live">제출</span> : ev.q_phase === 'LIVE' || ev.q_phase === 'PAUSED' ? <span className="tbx-chip">작성 중</span> : <span className="tbx-chip tbx-chip--ember">미제출</span>}</td>
                    <td className="qz-gtable__answer">{showAnswers ? (a?.answer ?? <span className="tbx-small">—</span>) : submitted ? '••••' : ''}</td>
                    <td>{a?.auto_match === true ? <span className="tbx-chip tbx-chip--live">일치</span> : a?.answer ? <span className="tbx-chip">확인</span> : ''}</td>
                    <td>
                      {ev.q_phase === 'GRADED' && q.status === 'ACTIVE' ? (
                        <span className="tbx-row" style={{ gap: 6 }}>
                          <b className={a?.verdict === 'CORRECT' ? 'tbx-signal-text' : 'tbx-ember-text'}>{a?.verdict === 'CORRECT' ? 'O' : 'X'}</b>
                          <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" onClick={() => void correct(g.guild_id, a?.verdict ?? null)}>정정</button>
                        </span>
                      ) : canGrade && a ? (
                        <span className="qz-ox">
                          <button type="button" aria-pressed={a.verdict === 'CORRECT'} className="qz-ox__o" disabled={busy === `g${g.guild_id}`}
                            onClick={() => void grade(g.guild_id, a.verdict === 'CORRECT' ? null : 'CORRECT')}>O</button>
                          <button type="button" aria-pressed={a.verdict === 'WRONG'} className="qz-ox__x" disabled={busy === `g${g.guild_id}`}
                            onClick={() => void grade(g.guild_id, a.verdict === 'WRONG' ? null : 'WRONG')}>X</button>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="tbx-num">{ev.q_phase === 'GRADED' && q.status === 'ACTIVE' ? (a?.points ?? 0) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <InlineError error={error} />
      </div>

      <aside className="qz-run__side tbx-stack">
        <div className="tbx-panel tbx-stack">
          <h2 className="tbx-h3">실제 점수 <span className="tbx-small">(교사만)</span></h2>
          <table className="qz-score">
            <thead><tr><th>순위</th><th>길드</th><th>개인</th><th>단체</th><th>합계</th></tr></thead>
            <tbody>
              {[...st.guilds].sort((a, b) => (totals[b.guild_id] ?? 0) - (totals[a.guild_id] ?? 0)).map((g) => (
                <tr key={g.guild_id}><td>{ranks.get(String(g.guild_id))}</td><td>{g.name}</td>
                  <td>{scores[g.guild_id]?.ind ?? 0}</td><td>{scores[g.guild_id]?.team ?? 0}</td><td><b>{scores[g.guild_id]?.total ?? 0}</b></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tbx-panel tbx-stack">
          <div className="tbx-row tbx-row--between"><h2 className="tbx-h3">교실 순위판(공개 점수)</h2>
            <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => void run('board', () => quizRpc.screen(supabase, ev.id, { board: ev.screen.board === 'HIDE' ? 'SHOW' : 'HIDE' })).then(onChanged)}>
              {ev.screen.board === 'HIDE' ? '보이기' : '숨기기'}
            </button></div>
          <p className="tbx-small">마지막 공개: {board?.label ?? '없음'}{ev.screen.board === 'HIDE' ? ' · 지금 교실 화면에서 숨김' : ''}</p>
          {board && (
            <ol className="qz-mini">
              {[...st.guilds].sort((a, b) => (board.scores[b.guild_id] ?? 0) - (board.scores[a.guild_id] ?? 0)).map((g) => (
                <li key={g.guild_id}><span>{boardRanks.get(String(g.guild_id))}</span><span>{g.name}</span><b>{board.scores[g.guild_id] ?? 0}</b></li>
              ))}
            </ol>
          )}
          {ev.checkpoint_ready && <Notice tone="signal" icon="📊">중간 공개 시점이에요. 버튼을 누르면 교실 순위판이 지금 점수로 바뀌어요.</Notice>}
          {st.board_stale && !ev.checkpoint_ready && <p className="tbx-small tbx-brass-text">공개 점수와 실제 점수가 달라요(아직 공개 전이거나 정정됨).</p>}
          <button type="button" className={ev.checkpoint_ready ? 'tbx-btn tbx-btn--signal' : 'tbx-btn'} disabled={!st.board_stale || ev.q_phase === 'LIVE' || ev.q_phase === 'PAUSED'}
            onClick={() => void run('pub', () => quizRpc.publishBoard(supabase, ev.id), '교실 순위판을 갱신했어요').then(onChanged)}>
            {ev.checkpoint_ready ? '📊 순위판 공개' : '순위판 지금 공개(정정 공표)'}
          </button>
        </div>
        <div className="tbx-panel tbx-stack">
          <h2 className="tbx-h3">다음</h2>
          {nextQ ? (
            <p className="tbx-small">다음 문제: {nextQ.stage === 'INDIVIDUAL' ? `${cfg.positions[nextQ.position_index ?? 0]}전` : '단체전'} — {nextQ.prompt.slice(0, 40)}{nextQ.prompt.length > 40 ? '…' : ''}</p>
          ) : <p className="tbx-small">이 문제가 {q.stage === 'INDIVIDUAL' ? '개인전' : '단체전'} 마지막이에요. 확정 뒤 대형 발표로 넘어가요.</p>}
          {nextQ && nextQ.position_index !== q.position_index && q.stage === 'INDIVIDUAL' && (
            <p className="tbx-small">교체 예정: {st.guilds.map((g) => `${g.name} ${st.roster.find((r) => r.guild_id === g.guild_id && r.position_index === nextQ.position_index)?.name ?? '?'}`).join(' · ')}</p>
          )}
          <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => setEditing('new')}>문제 1개 추가</button>
        </div>
        <div className="tbx-panel tbx-stack qz-danger">
          <h2 className="tbx-h3">비상</h2>
          <button type="button" className="tbx-btn tbx-btn--sm" disabled={ev.q_phase === 'IDLE' && q.attempt === 0 && !q.started_at} onClick={() => void reissue()}>⟲ 이 문제 다시 내기</button>
          <button type="button" className="tbx-btn tbx-btn--sm" disabled={q.status === 'VOID'} onClick={() => void voidQ()}>⊘ 이 문제 무효</button>
          <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--danger" onClick={() => void endQuiz()}>대회 종료</button>
        </div>
      </aside>
      {editing && <QuestionEditor st={st} q={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
      {dialog}
      {reason.dialog}
    </div>
  );
}

// ---------------------------------------------------------------------
// 대형 발표 조종
// ---------------------------------------------------------------------
function CeremonyControl({ st, onChanged }: { st: TeacherQuizState; onChanged: () => void }) {
  const ev = st.event;
  const isInd = ev.phase === 'IND_CEREMONY';
  const res: ResultSnapshot | null = isInd ? ev.ind_result : ev.final_result;
  const { run, busy, error } = useAction();
  const { ask, dialog } = useConfirm();
  const n = res?.guilds.length ?? 0;
  const step = ev.ceremony_step;
  const shownSet = new Set((res?.guilds ?? []).slice(0, Math.min(step, n)).map((g) => g.guild_id));
  const scoreMap = Object.fromEntries((res?.guilds ?? []).map((g) => [String(g.guild_id), g.score]));
  const ranks = rankMap(scoreMap);
  const hasTeam = ev.config.use_team && st.questions.some((q) => q.stage === 'TEAM' && q.status === 'ACTIVE');
  const stale = useMemo(() => (res?.guilds ?? []).some((g) => (isInd ? st.scores[g.guild_id]?.ind : st.scores[g.guild_id]?.total) !== g.score), [res, st.scores, isInd]);

  const doAct = async (a: 'STEP' | 'BACK' | 'RESNAP' | 'ADVANCE') => {
    if (a === 'ADVANCE' && !isInd && !(await ask('대회를 마칠까요?', '최종 결과가 기록으로 저장되고 학생 태블릿의 퀴즈 입구가 사라져요.', '대회 마치기'))) return;
    const r = await run(a, () => quizRpc.ceremony(supabase, ev.id, a));
    if (r !== null) onChanged();
  };

  return (
    <div className="tbx-stack">
      <div className="tbx-panel tbx-stack">
        <h2 className="tbx-h2">{isInd ? '개인전 결과 발표' : '최종 결과 발표'}</h2>
        <p className="tbx-small">버튼을 누를 때마다 교실 화면에 낮은 순위부터 한 길드씩 공개돼요. 마지막 한 번은 전체 순위 화면이에요. 누르기 전에는 화면이 저절로 바뀌지 않아요.</p>
        <div className="tbx-row tbx-row--wrap" style={{ gap: 8 }}>
          <button type="button" className="tbx-btn" disabled={step <= 0 || !!busy} onClick={() => void doAct('BACK')}>← 한 단계 전</button>
          <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--lg" disabled={step >= n + 1 || !!busy} onClick={() => void doAct('STEP')}>
            {step === 0 ? '🎺 발표 시작(첫 길드 공개)' : step < n ? `다음 길드 공개 (${step}/${n})` : step === n ? '🏆 전체 순위 화면' : '모두 공개됨'}
          </button>
          <button type="button" className="tbx-btn tbx-btn--signal tbx-btn--lg" disabled={step < n + 1 || !!busy} onClick={() => void doAct('ADVANCE')}>
            {isInd ? (hasTeam ? '단체전 입장 →' : '최종 발표로 →') : '대회 마치기(기록 저장)'}
          </button>
        </div>
        {stale && (
          <Notice icon="♻️">발표 집계 뒤 점수가 바뀌었어요(정정 등). {step === 0 ? <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => void doAct('RESNAP')}>다시 집계</button> : '처음 화면(0단계)으로 돌아가면 다시 집계할 수 있어요.'}</Notice>
        )}
        <InlineError error={error} />
      </div>
      <div className="tbx-panel tbx-stack">
        <h3 className="tbx-h3">발표 순서(교사만 미리 보기) — 개인전 만점 {res?.max_ind ?? 0}{!isInd ? ` · 단체전 만점 ${res?.max_team ?? 0}` : ''}</h3>
        <table className="qz-score">
          <thead><tr><th>공개 순서</th><th>순위</th><th>길드</th>{!isInd && <><th>개인</th><th>단체</th></>}<th>{isInd ? '개인전' : '합계'}</th><th>교실 화면</th></tr></thead>
          <tbody>
            {(res?.guilds ?? []).map((g, i) => (
              <tr key={g.guild_id}><td>{i + 1}</td><td>{ranks.get(String(g.guild_id))}위</td><td>{g.name}</td>
                {!isInd && <><td>{g.ind}</td><td>{g.team}</td></>}<td><b>{g.score}</b></td>
                <td>{shownSet.has(g.guild_id) ? <span className="tbx-chip tbx-chip--live">공개됨</span> : <span className="tbx-chip">대기</span>}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="tbx-small">동점이면 같은 순위로 보여요. 꼭 가려야 하면 단체전 뒤 '문제 1개 추가'로 동점 길드 추가 문제를 낼 수 있어요(정답 시간으로는 순위를 바꾸지 않아요).</p>
      </div>
      {dialog}
    </div>
  );
}

function FinalSummary({ st }: { st: TeacherQuizState }) {
  const res = st.event.final_result;
  const totals = Object.fromEntries(Object.entries(st.scores).map(([k, v]) => [k, v.total]));
  const ranks = rankMap(totals);
  return (
    <div className="tbx-panel tbx-stack">
      <h2 className="tbx-h2">대회 종료</h2>
      <p className="tbx-small">모든 문제·선수·답안·판정·정정 이력은 '결과·기록'에서 볼 수 있어요. 길드미션 보상은 이 결과를 보고 따로 반영해요(자동 지급 없음).</p>
      <table className="qz-score">
        <thead><tr><th>순위</th><th>길드</th><th>개인</th><th>단체</th><th>합계</th></tr></thead>
        <tbody>
          {[...st.guilds].sort((a, b) => (totals[b.guild_id] ?? 0) - (totals[a.guild_id] ?? 0)).map((g) => (
            <tr key={g.guild_id}><td>{ranks.get(String(g.guild_id))}</td><td>{g.name}</td><td>{st.scores[g.guild_id]?.ind ?? 0}</td><td>{st.scores[g.guild_id]?.team ?? 0}</td><td><b>{st.scores[g.guild_id]?.total ?? 0}</b></td></tr>
          ))}
        </tbody>
      </table>
      {res && <p className="tbx-small">최종 발표 집계 시각: {res.at ? new Date(res.at).toLocaleString('ko-KR') : ''}</p>}
    </div>
  );
}
