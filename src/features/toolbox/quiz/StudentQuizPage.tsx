// =====================================================================
// 학생 — 길드 태블릿(크롬북) 퀴즈 로얄 화면
// ---------------------------------------------------------------------
// 길드 대표 계정 하나로 로그인해 두고, 선수가 바뀌면 기기만 넘긴다.
// * 서버 확인이 돌아온 뒤에만 '제출 완료'로 바뀐다. 실패하면 '미전송 — 다시 보내기'.
// * 다시 보내도 서버가 처음 받은 답만 남긴다(중복 제출 방어).
// * 쓰던 답은 기기에 잠깐 보관해 새로고침해도 돌아온다(마감된 문제는 제출 불가).
// =====================================================================

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { toToolboxError, type ToolboxError } from '../toolbox_rpc';
import { quizRpc } from './quiz_rpc';
import { useCountdown, useQuizLive } from './useQuizLive';
import { QuizMedia, TimerBar, TimerText } from './quiz_ui';
import type { StudentQuizState } from './quiz_types';
import '../toolbox.css';
import './quiz.css';

const DRAFT_KEY = 'brand.quiz.draft';

function readDraft(key: string): string {
  try { const raw = window.sessionStorage.getItem(DRAFT_KEY); const m = raw ? JSON.parse(raw) : {}; return typeof m[key] === 'string' ? m[key] : ''; } catch { return ''; }
}
function writeDraft(key: string, value: string) {
  try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ [key]: value })); } catch { /* 저장 못 해도 입력은 계속 */ }
}

export function StudentQuizPage() {
  const { id } = useParams<{ id: string }>();
  const quizId = Number(id);
  const navigate = useNavigate();
  const live = useQuizLive<StudentQuizState>(supabase, Number.isFinite(quizId) ? `Q${quizId}-D` : null,
    () => quizRpc.studentState(supabase, quizId), {
      enabled: Number.isFinite(quizId), versionOf: (d) => d.version, serverNowOf: (d) => d.server_now,
      // 15초마다 한 번 읽어 '연결됨'을 알리고, 신호를 놓쳤을 때의 안전망으로 쓴다
      intervalMs: 15_000,
    });
  const s = live.data;
  const q = s?.question ?? null;
  const ms = useCountdown(s?.q_phase, s?.deadline_at, s?.remaining_ms);
  const draftKey = q ? `${quizId}:${q.id}:${q.attempt}` : '';
  const [answer, setAnswer] = useState('');
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'failed'>('idle');
  const [sendError, setSendError] = useState<ToolboxError | null>(null);
  const [localDone, setLocalDone] = useState<{ key: string; answer: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 문제가 바뀌면 보관해 둔 답을 불러온다
  useEffect(() => {
    if (!draftKey) return;
    setAnswer(readDraft(draftKey));
    setSendState('idle');
    setSendError(null);
  }, [draftKey]);

  const mineSubmitted = !!q?.mine?.submitted_at || (localDone?.key === draftKey);
  const submittedAnswer = q?.mine?.answer ?? (localDone?.key === draftKey ? localDone.answer : null);
  const canType = s?.q_phase === 'LIVE' && (ms === null || ms > 0) && !mineSubmitted && q?.status === 'ACTIVE';

  useEffect(() => { if (canType) inputRef.current?.focus(); }, [canType]);

  const submit = async () => {
    if (!q || !canType || sendState === 'sending') return;
    const text = answer.trim();
    if (!text) { setSendError(toToolboxError({ code: 'P7T04', message: '답을 입력해 주세요' })); return; }
    setSendState('sending');
    setSendError(null);
    try {
      const r = await quizRpc.submit(supabase, quizId, q.id, q.attempt, text);
      setLocalDone({ key: draftKey, answer: r.answer });
      setSendState('idle');
      writeDraft(draftKey, '');
      live.refresh();
    } catch (e) {
      const err = toToolboxError(e);
      setSendError(err);
      // 시간 종료·일시정지 같은 상태 오류는 다시 보내도 소용없다
      setSendState(err.code === 'NETWORK' || err.code === 'UNKNOWN' || err.code === '' ? 'failed' : 'idle');
      live.refresh();
    }
  };

  if (!Number.isFinite(quizId)) return null;
  const err = live.error ? toToolboxError(live.error) : null;

  return (
    <div className="tbx qz-device">
      <PageHeader title="퀴즈 로얄" onBack={() => navigate('/toolbox', { replace: true })} />
      {!s ? (
        <div className="qz-device__center">
          <p className="qz-device__big">{err ? err.title : '불러오는 중…'}</p>
          {err && <p className="tbx-body">{err.message}</p>}
        </div>
      ) : (
        <div className="qz-device__wrap">
          <div className="qz-device__bar">
            <span className="qz-device__guild">{s.guild.name}</span>
            {q?.position_label && <span className="tbx-chip tbx-chip--brass">{q.position_label}전</span>}
            {q?.stage === 'TEAM' && <span className="tbx-chip tbx-chip--brass">단체전</span>}
            {s.player && q?.stage === 'INDIVIDUAL' && <span className="qz-device__player">출전 {s.player}</span>}
            <span className="tbx-grow" />
            {!live.connected && <span className="tbx-chip tbx-chip--ember">연결 확인 중</span>}
            {q && (s.q_phase === 'LIVE' || s.q_phase === 'PAUSED') && <TimerText ms={ms} total={q.time_limit_sec} />}
          </div>
          {q && (s.q_phase === 'LIVE' || s.q_phase === 'PAUSED') && <TimerBar ms={ms} total={q.time_limit_sec} />}
          <DeviceBody s={s} ms={ms} answer={answer} setAnswer={(v) => { setAnswer(v); if (draftKey) writeDraft(draftKey, v); }}
            canType={!!canType} submitted={mineSubmitted} submittedAnswer={submittedAnswer} sendState={sendState} sendError={sendError}
            onSubmit={() => void submit()} inputRef={inputRef} />
        </div>
      )}
    </div>
  );
}

function DeviceBody({ s, ms, answer, setAnswer, canType, submitted, submittedAnswer, sendState, sendError, onSubmit, inputRef }: {
  s: StudentQuizState; ms: number | null; answer: string; setAnswer: (v: string) => void; canType: boolean; submitted: boolean;
  submittedAnswer: string | null; sendState: 'idle' | 'sending' | 'failed'; sendError: ToolboxError | null; onSubmit: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const q = s.question;
  if (s.phase === 'SETUP' || s.phase === 'LOBBY') {
    return (
      <div className="qz-device__center">
        <p className="qz-device__kicker">{s.title}</p>
        <p className="qz-device__big">{s.guild.name} 길드 태블릿 연결 완료</p>
        {s.next_player && <p className="tbx-body">첫 출전: {s.first_position} <b>{s.next_player}</b></p>}
        <p className="tbx-body">운영국이 경기를 시작할 때까지 기다려 주세요.</p>
      </div>
    );
  }
  if (s.phase === 'IND_CEREMONY' || s.phase === 'FINAL_CEREMONY') {
    return <div className="qz-device__center"><p className="qz-device__big">🏆 결과 발표 중</p><p className="tbx-body">교실 화면을 봐 주세요.</p></div>;
  }
  if (s.phase === 'COMPLETED') {
    return <div className="qz-device__center"><p className="qz-device__big">대회가 끝났어요</p><p className="tbx-body">수고했어요! 운영국 안내에 따라 태블릿을 정리해 주세요.</p></div>;
  }
  if (!q) return <div className="qz-device__center"><p className="qz-device__big">다음 구간을 기다려요</p></div>;
  if (q.status === 'VOID') return <div className="qz-device__center"><p className="qz-device__big">이 문제는 무효 처리되었어요</p><p className="tbx-body">다음 문제를 기다려 주세요.</p></div>;

  if (s.q_phase === 'IDLE') {
    if (s.handoff && q.stage === 'INDIVIDUAL') {
      return (
        <div className="qz-device__center qz-device__handoff">
          <p className="qz-device__kicker">{q.position_label}전 출전</p>
          <p className="qz-device__huge">{s.player ?? '—'}</p>
          <p className="qz-device__big">선수가 태블릿을 이어받으세요</p>
          <p className="tbx-body">운영국이 문제를 시작하면 바로 나타나요.</p>
        </div>
      );
    }
    return (
      <div className="qz-device__center">
        <p className="qz-device__kicker">{q.stage === 'TEAM' ? '단체전 — 길드원 모두 함께 상의해요' : `${q.position_label}전 · 출전 ${s.player ?? ''}`}</p>
        <p className="qz-device__big">다음 문제를 기다려요</p>
        <p className="tbx-body">{q.points}점 · 제한 시간 {q.time_limit_sec}초</p>
      </div>
    );
  }

  if (s.q_phase === 'PAUSED') {
    return (
      <div className="qz-device__center qz-device__paused">
        <p className="qz-device__huge">⏸</p>
        <p className="qz-device__big">경기가 일시정지되었습니다</p>
        <p className="tbx-body">교사 안내를 기다리세요. {submitted ? '낸 답은 그대로 저장되어 있어요.' : '쓰던 답은 기기에 보관되어 있어요.'}</p>
      </div>
    );
  }

  const ended = s.q_phase !== 'LIVE' && s.q_phase !== 'SHOWN';
  const timeUp = s.q_phase === 'LIVE' && ms !== null && ms <= 0;
  return (
    <div className="qz-device__q">
      <p className="qz-device__prompt">{q.prompt}</p>
      {q.media_type && <QuizMedia client={supabase} type={q.media_type} path={q.media_path} url={q.media_url} mode="device" />}
      {s.q_phase === 'SHOWN' && <p className="qz-device__note">문제를 읽어 보세요. 곧 답을 받아요.</p>}

      {submitted ? (
        <div className="qz-device__done">
          <span className="qz-device__done-title">✅ 제출 완료 — 변경할 수 없어요</span>
          <span className="qz-device__done-answer">{submittedAnswer}</span>
        </div>
      ) : ended || timeUp ? (
        <div className="qz-device__done qz-device__done--closed">
          <span className="qz-device__done-title">답안 마감</span>
          <span className="tbx-body">{timeUp && s.q_phase === 'LIVE' ? '시간이 끝났어요.' : '이 문제는 답을 내지 않았어요.'}</span>
        </div>
      ) : (
        <form className="qz-device__form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
          <input ref={inputRef} className="tbx-input qz-device__input" value={answer} maxLength={s.max_len} disabled={!canType || sendState === 'sending'}
            placeholder={s.q_phase === 'SHOWN' ? '곧 입력할 수 있어요' : '답을 짧게 써요'} autoComplete="off" spellCheck={false}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault(); }} />
          <div className="qz-device__count">{answer.length}/{s.max_len}</div>
          <button type="submit" className="tbx-btn tbx-btn--brass tbx-btn--xl tbx-btn--block" disabled={!canType || sendState === 'sending' || !answer.trim()}>
            {sendState === 'sending' ? '전송 중…' : sendState === 'failed' ? '미전송 — 다시 보내기' : '정답 제출'}
          </button>
          <p className="qz-device__note">제출하면 바꿀 수 없어요.</p>
        </form>
      )}
      {sendError && <p className="tbx-field-error" role="alert">{sendError.title}: {sendError.message}</p>}

      {s.q_phase === 'GRADED' && (
        <div className={q.mine?.verdict === 'CORRECT' ? 'qz-device__result qz-device__result--o' : 'qz-device__result qz-device__result--x'}>
          <span>{q.mine?.verdict === 'CORRECT' ? `⭕ 정답! +${q.mine?.points ?? 0}점` : '❌ 아쉬워요'}</span>
          {q.answer_key && <span className="tbx-body">정답: <b>{q.answer_key}</b></span>}
        </div>
      )}
      {s.q_phase === 'REVEALED' && <p className="qz-device__note">교실 화면에서 다섯 길드의 답을 함께 확인해요.</p>}
    </div>
  );
}
