// =====================================================================
// 교사 — 퀴즈 로얄 결과·기록 (문제별 답안·판정·정정, 운영 이력, CSV 내보내기)
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { InlineError, Seg, useAction } from '../ui';
import { quizRpc } from './quiz_rpc';
import { useReasonDialog } from './quiz_dialogs';
import type { QuizAnswer, QuizAuditRow, QuizQuestion, TeacherQuizState, Verdict } from './quiz_types';
import { KIND_LABEL, THEME_LABEL } from './quiz_types';

const ACTION_LABEL: Record<string, string> = {
  CREATE: '대회 생성', SAVE_SETUP: '설정 저장', SAVE_QUESTIONS: '문제 저장', OPEN_LOBBY: '대기실 열기', CLOSE_LOBBY: '대기실 닫기',
  START: '경기 시작', Q_START: '문제 시작', PAUSE: '일시정지', RESUME: '재개', LOCK: '마감', REVEAL: '답안 공개',
  FINALIZE: '채점 확정', VOID: '문제 무효', REISSUE: '재출제', STAGE_END: '구간 종료', PUBLISH_BOARD: '순위판 공개',
  CORRECT_GRADE: '점수 정정', SWAP_PLAYER: '선수 교체', EDIT_STARTED_QUESTION: '출제 후 정답 수정', EDIT_QUESTION: '문제 수정',
  ADD_QUESTION: '문제 추가', DELETE_QUESTION: '문제 삭제', CEREMONY_ADVANCE: '발표 다음 단계', RESNAP: '발표 다시 집계', END_EARLY: '대회 조기 종료',
};

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function QuizRecords({ st, onChanged }: { st: TeacherQuizState; onChanged: () => void }) {
  const [view, setView] = useState<'questions' | 'players' | 'audit'>('questions');
  const [audit, setAudit] = useState<QuizAuditRow[] | null>(null);
  const { run, error } = useAction();
  const reason = useReasonDialog();
  const positions = st.event.config.positions;
  const guildName = (gid: number | null) => st.guilds.find((g) => g.guild_id === gid)?.name ?? (gid ? `#${gid}` : '');

  useEffect(() => {
    if (view !== 'audit') return;
    let alive = true;
    quizRpc.audit(supabase, st.event.id).then((r) => { if (alive) setAudit(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, [view, st.event.id, st.event.version]);

  const answersOf = (q: QuizQuestion, attempt = q.attempt) => st.answers.filter((a) => a.question_id === q.id && a.attempt === attempt);
  const started = st.questions.filter((q) => q.started_at || q.attempt > 0);

  const correct = async (q: QuizQuestion, a: QuizAnswer) => {
    const to: Verdict = a.verdict === 'CORRECT' ? 'WRONG' : 'CORRECT';
    const why = await reason.ask('확정한 점수 정정', <>{guildName(a.guild_id)} · {q.seq}번 문제: {a.verdict === 'CORRECT' ? '정답 → 오답' : '오답 → 정답'}. 이미 공개한 순위판·발표에는 '정정 공표'(진행 화면) 또는 발표 '다시 집계'로 반영해요.</>, '정정하기');
    if (!why) return;
    const r = await run('correct', () => quizRpc.correct(supabase, st.event.id, q.id, a.guild_id, to, why), '점수를 정정했어요');
    if (r !== null) onChanged();
  };

  const exportCsv = () => {
    const header = ['번호', '구간', '포지션', '문제', '정답', '허용 표현', '유형', '주제', '배점', '제한(초)', '상태', '회차', '길드', '선수', '답안', '제출 시각', '판정', '점수', '일시정지(회)', '일시정지(ms)'];
    const lines = [header.map(csvCell).join(',')];
    for (const q of st.questions) {
      const rows = st.answers.filter((a) => a.question_id === q.id).sort((a, b) => a.attempt - b.attempt || a.guild_id - b.guild_id);
      const base = [q.seq, q.stage === 'TEAM' ? '단체' : '개인', q.position_index !== null ? positions[q.position_index] : '', q.prompt, q.answer_key,
        q.accepted.join(' | '), q.kind ? KIND_LABEL[q.kind] : '', q.theme ? THEME_LABEL[q.theme] : '', q.points, q.time_limit_sec,
        q.status === 'VOID' ? `무효(${q.void_reason ?? ''})` : q.graded_at ? '확정' : q.started_at ? '진행' : '미출제'];
      if (rows.length === 0) { lines.push([...base, '', '', '', '', '', '', '', q.pause_count, q.pause_ms].map(csvCell).join(',')); continue; }
      for (const a of rows) {
        lines.push([...base, a.attempt === q.attempt ? a.attempt : `${a.attempt}(지난 회차)`, guildName(a.guild_id), a.player_name ?? '', a.answer ?? '(미제출)',
          a.submitted_at ? new Date(a.submitted_at).toLocaleString('ko-KR') : '', a.verdict === 'CORRECT' ? 'O' : a.verdict === 'WRONG' ? 'X' : '',
          a.points ?? '', q.pause_count, q.pause_ms].map(csvCell).join(','));
      }
    }
    lines.push('');
    lines.push(['길드', '개인전', '단체전', '합계'].map(csvCell).join(','));
    for (const g of st.guilds) lines.push([g.name, st.scores[g.guild_id]?.ind ?? 0, st.scores[g.guild_id]?.team ?? 0, st.scores[g.guild_id]?.total ?? 0].map(csvCell).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${st.event.title.replace(/[\\/:*?"<>|]/g, '_')}_기록.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  // 학생 개인전 이력
  const players = useMemo(() => {
    const m = new Map<string, { name: string; guild: string; tries: number; correct: number; points: number }>();
    for (const q of st.questions.filter((x) => x.stage === 'INDIVIDUAL' && x.status === 'ACTIVE' && x.graded_at)) {
      for (const a of st.answers.filter((x) => x.question_id === q.id && x.attempt === q.attempt)) {
        if (!a.player_name) continue;
        const key = `${a.guild_id}:${a.player_student_id}`;
        const cur = m.get(key) ?? { name: a.player_name, guild: guildName(a.guild_id), tries: 0, correct: 0, points: 0 };
        cur.tries += 1;
        if (a.verdict === 'CORRECT') cur.correct += 1;
        cur.points += a.points ?? 0;
        m.set(key, cur);
      }
    }
    return [...m.values()].sort((a, b) => a.guild.localeCompare(b.guild) || b.points - a.points);
  }, [st.questions, st.answers]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tbx-stack">
      <div className="tbx-row tbx-row--between tbx-row--wrap" style={{ gap: 8 }}>
        <Seg<'questions' | 'players' | 'audit'> value={view} onChange={setView}
          options={[{ value: 'questions', label: `문제별 (${started.length})` }, { value: 'players', label: '선수별' }, { value: 'audit', label: '운영 이력' }]} />
        <button type="button" className="tbx-btn tbx-btn--sm" onClick={exportCsv}>CSV 내려받기</button>
      </div>
      {view === 'questions' && (
        <div className="tbx-stack">
          {started.length === 0 && <p className="tbx-small">아직 출제한 문제가 없어요.</p>}
          {started.map((q) => (
            <div key={q.id} className={`tbx-panel tbx-stack qz-rec${q.status === 'VOID' ? ' qz-qrow--void' : ''}`}>
              <div className="tbx-row tbx-row--between tbx-row--wrap">
                <span className="tbx-h3">{q.seq}. {q.stage === 'TEAM' ? '단체전' : `${positions[q.position_index ?? 0]}전`} — {q.prompt}</span>
                <span className="tbx-small">{q.points}점 · {q.time_limit_sec}초{q.pause_count ? ` · 정지 ${q.pause_count}회 ${Math.round(q.pause_ms / 1000)}초` : ''}{q.attempt ? ` · 재출제 ${q.attempt}회` : ''}{q.status === 'VOID' ? ` · 무효(${q.void_reason ?? ''})` : ''}</span>
              </div>
              <span className="tbx-small">정답 <b className="tbx-brass-text">{q.answer_key}</b>{q.accepted.length ? ` · 허용 ${q.accepted.join(' | ')}` : ''} · 시작 {fmtTime(q.started_at)} · 마감 {fmtTime(q.locked_at)} · 확정 {fmtTime(q.graded_at)}</span>
              <table className="qz-gtable">
                <thead><tr><th>길드</th><th>선수</th><th>답안</th><th>제출</th><th>판정</th><th>점수</th><th /></tr></thead>
                <tbody>
                  {answersOf(q).map((a) => (
                    <tr key={a.guild_id}>
                      <td>{guildName(a.guild_id)}</td><td>{a.player_name ?? (q.stage === 'TEAM' ? '길드 전원' : '')}</td>
                      <td className="qz-gtable__answer">{a.answer ?? <span className="tbx-small">미제출</span>}</td>
                      <td>{fmtTime(a.submitted_at)}</td>
                      <td>{a.verdict === 'CORRECT' ? <b className="tbx-signal-text">O</b> : a.verdict === 'WRONG' ? <b className="tbx-ember-text">X</b> : '—'}</td>
                      <td>{a.points ?? ''}</td>
                      <td>{q.graded_at && q.status === 'ACTIVE' && <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" onClick={() => void correct(q, a)}>정정</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {q.attempt > 0 && (
                <details className="tbx-small"><summary>지난 회차 답안 보기</summary>
                  {Array.from({ length: q.attempt }, (_, i) => i).map((att) => (
                    <div key={att}>{att}회차: {answersOf(q, att).map((a) => `${guildName(a.guild_id)} "${a.answer ?? '미제출'}"`).join(' · ') || '없음'}</div>
                  ))}
                </details>
              )}
            </div>
          ))}
        </div>
      )}
      {view === 'players' && (
        <div className="tbx-panel">
          <table className="qz-score">
            <thead><tr><th>길드</th><th>선수</th><th>출전 문제</th><th>정답</th><th>점수</th></tr></thead>
            <tbody>{players.map((p) => <tr key={`${p.guild}${p.name}`}><td>{p.guild}</td><td>{p.name}</td><td>{p.tries}</td><td>{p.correct}</td><td><b>{p.points}</b></td></tr>)}</tbody>
          </table>
          {players.length === 0 && <p className="tbx-small">아직 채점 확정한 개인전 문제가 없어요.</p>}
        </div>
      )}
      {view === 'audit' && (
        <div className="tbx-panel">
          {!audit ? <p className="tbx-small">불러오는 중…</p> : (
            <table className="qz-gtable">
              <thead><tr><th>시각</th><th>동작</th><th>문제</th><th>길드</th><th>내용</th></tr></thead>
              <tbody>
                {audit.slice().reverse().map((r) => {
                  const q = st.questions.find((x) => x.id === r.question_id);
                  return (
                    <tr key={r.id}>
                      <td>{new Date(r.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                      <td>{ACTION_LABEL[r.action] ?? r.action}</td>
                      <td>{q ? `${q.seq}번` : r.question_id ? `#${r.question_id}` : ''}</td>
                      <td>{guildName(r.guild_id)}</td>
                      <td className="qz-audit-detail">{describe(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      <InlineError error={error} />
      {reason.dialog}
    </div>
  );
}

function describe(r: QuizAuditRow): string {
  const d = r.detail ?? {};
  switch (r.action) {
    case 'CORRECT_GRADE': return `${d.before?.verdict === 'CORRECT' ? 'O' : 'X'}(${d.before?.points ?? 0}) → ${d.after?.verdict === 'CORRECT' ? 'O' : 'X'}(${d.after?.points ?? 0}) · 사유: ${d.reason ?? ''}`;
    case 'PAUSE': return `남은 ${Math.round((d.remaining_ms ?? 0) / 100) / 10}초${d.reason ? ` · ${d.reason}` : ''}`;
    case 'RESUME': return `정지 ${Math.round((d.paused_ms ?? 0) / 100) / 10}초`;
    case 'VOID': case 'REISSUE': case 'END_EARLY': return `사유: ${d.reason ?? ''}`;
    case 'SWAP_PLAYER': return `${d.before ?? ''} → ${d.after ?? ''} · 사유: ${d.reason ?? ''}`;
    case 'LOCK': return d.all_submitted ? '모두 제출(자동)' : d.early ? '조기 마감' : '시간 종료';
    case 'Q_START': case 'START': return d.force_reason ? `연결 안 된 태블릿(${(d.offline ?? []).join(', ')}) — 사유: ${d.force_reason}` : '';
    case 'EDIT_STARTED_QUESTION': return `정답 ${d.before?.answer_key ?? ''} → ${d.after?.answer_key ?? ''}`;
    case 'PUBLISH_BOARD': return d.auto ? '자동 공개' : d.label ?? '';
    default: return '';
  }
}
