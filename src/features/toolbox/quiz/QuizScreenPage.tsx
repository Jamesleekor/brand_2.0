// =====================================================================
// 교실 대형 화면(중계) — 퀴즈 로얄
// ---------------------------------------------------------------------
// 교사 PC 확장 화면에 새 창으로 띄운다. 서버(teacher_quiz_screen_state)가
// 공개된 것만 보내므로, 이 화면에는 정답·미공개 답안·실제 점수가 아예 오지 않는다.
//   문제 표시 → 제출 현황(잠긴 카드) → 다섯 답 일제 공개 → 정답·정오 → 다음
// 작은 순위판은 '마지막으로 공개한 점수'만 보여 준다.
// =====================================================================

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase/client';
import { colorAt, useFullscreen, useToolboxPrefs } from '../ui';
import { toToolboxError } from '../toolbox_rpc';
import { quizRpc } from './quiz_rpc';
import { useCountdown, useQuizLive } from './useQuizLive';
import { GuildMark, QuizMedia, TimerBar, TimerText, rankMap } from './quiz_ui';
import type { ResultGuild, ScreenGuild, ScreenState } from './quiz_types';
import '../toolbox.css';
import './quiz.css';

export function QuizScreenPage() {
  const { id } = useParams<{ id: string }>();
  const quizId = Number(id);
  const live = useQuizLive<ScreenState>(supabase, Number.isFinite(quizId) ? `Q${quizId}-T` : null,
    () => quizRpc.screenState(supabase, quizId), {
      enabled: Number.isFinite(quizId), versionOf: (d) => d.version, serverNowOf: (d) => d.server_now,
      relevant: (p) => !['MEDIA', 'GRADE_DRAFT', 'QUESTIONS', 'CORRECT'].includes(String(p.event ?? '')), intervalMs: 20_000,
    });
  const fs = useFullscreen<HTMLDivElement>();
  const prefs = useToolboxPrefs();
  // 브라우저는 이 창에서 한 번 누르기 전에는 소리 있는 영상·효과음을 막는다 → 처음 한 번 눌러 준다
  const [activated, setActivated] = useState(false);
  const s = live.data;
  const ms = useCountdown(s?.q_phase, s?.deadline_at, s?.remaining_ms);
  const mediaCmd = live.payload.event === 'MEDIA' ? { cmd: String(live.payload.media ?? ''), rev: live.rev } : null;

  // 효과음: 공개·마감·발표
  const prevKey = useRef('');
  useEffect(() => {
    if (!s) return;
    const key = `${s.phase}:${s.question?.id ?? ''}:${s.question?.attempt ?? ''}:${s.q_phase}:${s.result?.step ?? ''}`;
    if (prevKey.current && prevKey.current !== key) {
      if (s.q_phase === 'REVEALED') prefs.play('reveal');
      else if (s.q_phase === 'LOCKED') prefs.play('lock');
      else if (s.q_phase === 'GRADED') prefs.play('reveal');
      else if ((s.phase === 'IND_CEREMONY' || s.phase === 'FINAL_CEREMONY') && (s.result?.step ?? 0) > 0) {
        if ((s.result?.step ?? 0) > (s.result?.total ?? 0)) prefs.play('win'); else prefs.play('reveal');
      }
    }
    prevKey.current = key;
  }, [s?.phase, s?.q_phase, s?.question?.id, s?.question?.attempt, s?.result?.step]); // eslint-disable-line react-hooks/exhaustive-deps

  // 마지막 5초 똑딱
  const lastTick = useRef(-1);
  useEffect(() => {
    if (ms === null || s?.q_phase !== 'LIVE') return;
    const sec = Math.ceil(ms / 1000);
    if (sec <= 5 && sec >= 1 && sec !== lastTick.current) { lastTick.current = sec; prefs.play('tick'); }
  }, [ms === null ? null : Math.ceil(ms / 1000)]); // eslint-disable-line react-hooks/exhaustive-deps

  const playing = s && (s.phase === 'INDIVIDUAL' || s.phase === 'TEAM');
  const boardOn = !!s && playing && s.board.visible && !!s.board.snapshot;

  return (
    <div ref={fs.ref} className="tbx qz-screen">
      {!activated && (
        <button type="button" className="qz-activate" onClick={() => { setActivated(true); prefs.play('tick'); void fs.toggle(); }}>
          <span className="qz-activate__title">교실 화면 시작</span>
          <span className="qz-activate__sub">이 창을 교실 화면(확장 모니터)으로 옮긴 뒤 한 번 눌러 주세요 — 전체 화면과 소리가 켜져요</span>
        </button>
      )}
      {!s ? (
        <div className="qz-screen__center"><p className="qz-screen__huge">{live.error ? toToolboxError(live.error).message : '불러오는 중…'}</p></div>
      ) : (
        <>
          <header className="qz-screen__top">
            <div className="qz-screen__brand">B.R.A.N.D <b>QUIZ ROYAL</b></div>
            <div className="qz-screen__where">
              {playing && s.question && (
                <>
                  <span>{s.question.stage === 'INDIVIDUAL' ? '개인전' : '단체전'}</span>
                  {s.question.position_label && <span>{s.question.position_label}전 {s.question.pos_index}/{s.question.pos_total}</span>}
                  <span>Q {s.question.stage_index}/{s.question.stage_total}</span>
                  <span className="qz-screen__pts">{s.question.points}점</span>
                </>
              )}
              {!playing && <span>{s.title}</span>}
            </div>
            <div className="qz-screen__clock">
              {playing && s.question && s.q_phase !== 'IDLE' && s.q_phase !== 'SHOWN' && <TimerText ms={ms ?? 0} total={s.question.time_limit_sec} big />}
              {playing && s.question && s.q_phase === 'SHOWN' && <TimerText ms={s.question.time_limit_sec * 1000} total={s.question.time_limit_sec} big />}
            </div>
          </header>
          {playing && s.question && (s.q_phase === 'LIVE' || s.q_phase === 'PAUSED') && (
            <TimerBar ms={ms} total={s.question.time_limit_sec} />
          )}
          <main className={boardOn ? 'qz-screen__body qz-screen__body--board' : 'qz-screen__body'}>
            <section className="qz-screen__stage">
              {(s.phase === 'SETUP' || s.phase === 'LOBBY') && <LobbyView s={s} />}
              {playing && <PlayView s={s} mediaCmd={mediaCmd} />}
              {(s.phase === 'IND_CEREMONY' || s.phase === 'FINAL_CEREMONY') && <CeremonyView s={s} />}
              {s.phase === 'COMPLETED' && <FinalView s={s} />}
            </section>
            {boardOn && <MiniBoard s={s} />}
          </main>
          <footer className="qz-screen__foot">
            {!live.connected && <span className="qz-screen__warn">연결 확인 중…</span>}
            {s.q_phase === 'PAUSED' && playing && <span className="qz-screen__warn">일시정지</span>}
            <span className="qz-screen__tools">
              <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => prefs.setSound(!prefs.sound)}>{prefs.sound ? '🔊' : '🔇'}</button>
              <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => void fs.toggle()}>{fs.on ? '창 모드' : '전체 화면'}</button>
            </span>
          </footer>
        </>
      )}
    </div>
  );
}

function LobbyView({ s }: { s: ScreenState }) {
  return (
    <div className="qz-screen__center">
      <p className="qz-screen__kicker">길드 대항</p>
      <h1 className="qz-screen__title">{s.title}</h1>
      <div className="qz-screen__lobby">
        {s.guilds.map((g, i) => (
          <div key={g.guild_id} className={g.online ? 'qz-lobby-card qz-lobby-card--on' : 'qz-lobby-card'}>
            <GuildMark name={g.name} logo={g.logo_url} color={colorAt(i)} />
            <span>{g.name}</span>
            <small>{g.online ? '준비 완료' : '연결 대기'}</small>
          </div>
        ))}
      </div>
      <p className="qz-screen__sub">곧 시작합니다</p>
    </div>
  );
}

function PlayView({ s, mediaCmd }: { s: ScreenState; mediaCmd: { cmd: string; rev: number } | null }) {
  const q = s.question;
  if (!q) return <div className="qz-screen__center"><p className="qz-screen__huge">다음 구간을 준비하고 있어요</p></div>;
  if (q.status === 'VOID') return <div className="qz-screen__center"><p className="qz-screen__huge">이 문제는 무효 처리되었어요</p></div>;

  if (s.q_phase === 'IDLE') {
    if (s.handoff) {
      return (
        <div className="qz-screen__center qz-handoff">
          <p className="qz-screen__kicker">선수 교체</p>
          <h1 className="qz-screen__title">{q.position_label}전</h1>
          <div className="qz-handoff__list">
            {s.guilds.map((g, i) => (
              <div key={g.guild_id} className="qz-handoff__item" style={{ borderColor: colorAt(i) }}>
                <span className="qz-handoff__guild">{g.name}</span>
                <span className="qz-handoff__player">{g.player ?? '—'}</span>
              </div>
            ))}
          </div>
          <p className="qz-screen__sub">출전 선수는 태블릿을 이어받으세요</p>
        </div>
      );
    }
    return (
      <div className="qz-screen__center">
        <p className="qz-screen__kicker">{q.stage === 'TEAM' ? '단체전' : `${q.position_label}전`}</p>
        <h1 className="qz-screen__title">Q{q.stage_index}</h1>
        <p className="qz-screen__sub">{q.points}점 · 제한 시간 {q.time_limit_sec}초</p>
      </div>
    );
  }

  const paused = s.q_phase === 'PAUSED';
  const submitted = s.guilds.filter((g) => g.submitted).length;
  return (
    <div className="qz-play">
      <div className={paused ? 'qz-play__question qz-play__question--hidden' : 'qz-play__question'}>
        {!paused && (
          <>
            <p className="qz-play__prompt">{q.prompt}</p>
            {q.media_type && <QuizMedia client={supabase} type={q.media_type} path={q.media_path} url={q.media_url} mode="screen" command={mediaCmd} />}
          </>
        )}
        {paused && <p className="qz-screen__huge">⏸ 경기가 일시정지되었습니다</p>}
      </div>
      {s.q_phase === 'GRADED' && q.answer_key && (
        <div className="qz-play__key">정답 <b>{q.answer_key}</b>{q.explanation ? <span>{q.explanation}</span> : null}</div>
      )}
      {s.q_phase === 'LOCKED' && <div className="qz-play__state">답안 마감 · {submitted}/{s.guilds.length} 제출</div>}
      {s.q_phase === 'SHOWN' && <div className="qz-play__state">문제를 읽어 보세요 — 곧 답을 받아요</div>}
      <div className="qz-cards" style={{ gridTemplateColumns: `repeat(${Math.min(s.guilds.length, 5)}, minmax(0, 1fr))` }}>
        {s.guilds.map((g, i) => <AnswerCard key={g.guild_id} g={g} i={i} s={s} />)}
      </div>
    </div>
  );
}

function AnswerCard({ g, i, s }: { g: ScreenGuild; i: number; s: ScreenState }) {
  const revealed = s.q_phase === 'REVEALED' || s.q_phase === 'GRADED';
  const graded = s.q_phase === 'GRADED';
  const cls = ['qz-card'];
  if (g.submitted) cls.push('qz-card--in');
  if (revealed) cls.push('qz-card--open');
  if (graded) cls.push(g.verdict === 'CORRECT' ? 'qz-card--correct' : 'qz-card--wrong');
  return (
    <div className={cls.join(' ')} style={{ ['--qz-c' as any]: colorAt(i) }}>
      <div className="qz-card__head">
        <span className="qz-card__guild">{g.name}</span>
        {g.player && <span className="qz-card__player">{g.player}</span>}
      </div>
      <div className="qz-card__body">
        {revealed ? (
          <span className={!g.answer ? 'qz-card__answer qz-card__answer--none'
            : g.answer.length > 14 ? 'qz-card__answer qz-card__answer--s' : g.answer.length > 6 ? 'qz-card__answer qz-card__answer--m' : 'qz-card__answer'}>{g.answer ?? '미제출'}</span>
        ) : g.submitted ? (
          <span className="qz-card__lock">🔒 제출 완료</span>
        ) : s.q_phase === 'LOCKED' ? (
          <span className="qz-card__lock qz-card__lock--none">미제출</span>
        ) : (
          <span className="qz-card__typing">작성 중…</span>
        )}
      </div>
      {graded && <div className="qz-card__verdict">{g.verdict === 'CORRECT' ? `⭕ +${g.points ?? 0}` : '❌'}</div>}
    </div>
  );
}

function MiniBoard({ s }: { s: ScreenState }) {
  const snap = s.board.snapshot!;
  const ranks = rankMap(snap.scores);
  const rows = [...s.guilds].sort((a, b) => (snap.scores[b.guild_id] ?? 0) - (snap.scores[a.guild_id] ?? 0));
  return (
    <aside className="qz-board" aria-label="공개 순위">
      <div className="qz-board__title">순위 <small>{snap.label}</small></div>
      <ol>
        {rows.map((g) => (
          <li key={g.guild_id}>
            <span className="qz-board__rank">{ranks.get(String(g.guild_id))}</span>
            <span className="qz-board__name">{g.name}</span>
            <b className="qz-board__score">{snap.scores[g.guild_id] ?? 0}</b>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function CeremonyView({ s }: { s: ScreenState }) {
  const r = s.result;
  const isInd = s.phase === 'IND_CEREMONY';
  const total = r?.total ?? 0;
  const step = r?.step ?? 0;
  const shown = r?.guilds ?? [];
  if (step === 0) {
    return (
      <div className="qz-screen__center">
        <p className="qz-screen__kicker">{isInd ? '개인전 종료' : '모든 경기 종료'}</p>
        <h1 className="qz-screen__title">{isInd ? '개인전 결과 발표' : '최종 결과 발표'}</h1>
        <p className="qz-screen__sub">{isInd ? `개인전 만점 ${r?.max_ind ?? 0}점` : `만점 ${(r?.max_ind ?? 0) + (r?.max_team ?? 0)}점 (개인전 ${r?.max_ind ?? 0} + 단체전 ${r?.max_team ?? 0})`}</p>
      </div>
    );
  }
  if (step > total) return <Podium guilds={shown} isInd={isInd} />;
  const latest = shown[shown.length - 1];
  return (
    <div className="qz-ceremony">
      {latest && (
        <div className="qz-ceremony__spot" key={latest.guild_id}>
          <span className="qz-ceremony__rank">{latest.rank}위</span>
          <span className="qz-ceremony__name">{latest.name}</span>
          <span className="qz-ceremony__score">{latest.score}<small>점</small></span>
          {!isInd && <span className="qz-ceremony__split">개인전 {latest.ind} + 단체전 {latest.team}</span>}
        </div>
      )}
      <div className="qz-ceremony__list">
        {shown.slice(0, -1).reverse().map((g) => (
          <div key={g.guild_id} className="qz-ceremony__row"><span>{g.rank}위</span><span>{g.name}</span><b>{g.score}</b></div>
        ))}
        {Array.from({ length: total - shown.length }, (_, i) => (
          <div key={`hidden${i}`} className="qz-ceremony__row qz-ceremony__row--hidden"><span>?</span><span>공개 전</span><b>—</b></div>
        ))}
      </div>
    </div>
  );
}

function Podium({ guilds, isInd }: { guilds: ResultGuild[]; isInd: boolean }) {
  const sorted = [...guilds].sort((a, b) => a.rank - b.rank);
  return (
    <div className="qz-podium">
      <h1 className="qz-screen__title">{isInd ? '개인전 순위' : '최종 순위'}</h1>
      <div className="qz-podium__rows">
        {sorted.map((g) => (
          <div key={g.guild_id} className={`qz-podium__row qz-podium__row--${Math.min(g.rank, 4)}`}>
            <span className="qz-podium__rank">{g.rank}위</span>
            <span className="qz-podium__name">{g.name}</span>
            {!isInd && <span className="qz-podium__split">개인 {g.ind} · 단체 {g.team}</span>}
            <b className="qz-podium__score">{g.score}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinalView({ s }: { s: ScreenState }) {
  const r = s.result;
  if (!r || !r.guilds?.length) return <div className="qz-screen__center"><h1 className="qz-screen__title">대회 종료</h1></div>;
  return <Podium guilds={r.guilds} isInd={false} />;
}
