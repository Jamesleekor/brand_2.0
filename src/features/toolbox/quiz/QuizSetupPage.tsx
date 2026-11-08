// =====================================================================
// 교사 — 퀴즈 로얄 준비 화면
//   1 기본 설정 · 2 길드·제출 계정 · 3 문제 · 4 출전표 · 5 점검·대기실
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';
import { InlineError, Modal, Notice, Seg, Stepper, Toggle, colorAt, useAction, useConfirm } from '../ui';
import { toToolboxError } from '../toolbox_rpc';
import { useClassRoster, studentLabel } from '../roster';
import { offlineGuilds, quizRpc } from './quiz_rpc';
import { useQuizLive } from './useQuizLive';
import { PASTE_COLUMNS, PASTE_TEMPLATE, parseQuestionTable, type ParsedRow } from './paste';
import { removeQuizMedia, uploadQuizMedia, mediaTypeOfUrl } from './quiz_media';
import { GuildMark, PhaseChip, QuizMedia, openQuizScreen } from './quiz_ui';
import { useReasonDialog } from './quiz_dialogs';
import type { QuizConfig, QuizQuestion, QuizQuestionInput, TeacherQuizState } from './quiz_types';
import { KIND_LABEL, THEME_LABEL } from './quiz_types';
import '../toolbox.css';
import './quiz.css';

type Tab = 'basic' | 'guilds' | 'questions' | 'roster' | 'check';

export function QuizSetupPage() {
  const { id } = useParams<{ id: string }>();
  const quizId = Number(id);
  const navigate = useNavigate();
  const classroomId = useAuthStore((s) => s.context?.classroomId ?? null);
  const live = useQuizLive<TeacherQuizState>(supabase, Number.isFinite(quizId) ? `Q${quizId}-T` : null,
    () => quizRpc.state(supabase, quizId), {
      enabled: Number.isFinite(quizId), versionOf: (d) => d.event.version, serverNowOf: (d) => d.server_now,
      relevant: (p) => p.event !== 'SUBMIT' && p.event !== 'MEDIA',
    });
  const { roster } = useClassRoster(supabase, classroomId, false);
  const [tab, setTab] = useState<Tab>('basic');
  const st = live.data;

  if (!Number.isFinite(quizId)) return null;
  const editable = st ? st.event.phase === 'SETUP' || st.event.phase === 'LOBBY' : false;

  return (
    <TeacherShell>
      <div className="tbx tbx-teacher-page qz-page">
        <div className="tbx-row tbx-row--between tbx-row--wrap" style={{ gap: 10 }}>
          <button type="button" className="tbx-btn tbx-btn--ghost tbx-btn--sm" onClick={() => navigate('/teacher/toolbox')}>← 모험가 도구함</button>
          <div className="tbx-row" style={{ gap: 8 }}>
            {st && <PhaseChip phase={st.event.phase} />}
            <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => openQuizScreen(quizId)}>
              🖥 중계 화면 새 창
            </button>
            <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--signal" onClick={() => navigate(`/teacher/toolbox/quiz/${quizId}`)}>진행 화면 →</button>
          </div>
        </div>
        <div className="tbx-hero">
          <span className="qz-hero-icon" aria-hidden="true">⚔️</span>
          <div className="tbx-grow">
            <h1 className="tbx-h1">{st?.event.title ?? '퀴즈 로얄'}{st?.event.is_rehearsal ? ' · 리허설' : ''}</h1>
            <p className="tbx-small">준비 → 대기실(태블릿 연결) → 경기 시작 순서로 진행해요. 정답은 이 화면과 진행 화면에만 보여요.</p>
          </div>
        </div>
        {live.error && <Notice tone="ember" icon="⚠️">{toToolboxError(live.error).message}</Notice>}
        {!editable && st && (
          <Notice icon="🔒">경기가 시작되어 기본 설정·참가 길드는 바꿀 수 없어요. 문제 추가·정답 수정·선수 교체는 계속 할 수 있어요.</Notice>
        )}
        <Seg<Tab> value={tab} onChange={setTab} block label="준비 단계" options={[
          { value: 'basic', label: '1 기본 설정' }, { value: 'guilds', label: '2 길드·제출 계정' },
          { value: 'questions', label: `3 문제${st ? ` (${st.questions.filter((q) => q.status === 'ACTIVE').length})` : ''}` },
          { value: 'roster', label: '4 출전표' }, { value: 'check', label: '5 점검·대기실' },
        ]} />
        {!st ? <p className="tbx-small">불러오는 중…</p> : (
          <>
            {(tab === 'basic' || tab === 'guilds') && <SetupForm st={st} tab={tab} editable={editable} roster={roster} onSaved={live.refresh} />}
            {tab === 'questions' && <QuestionsTab st={st} classroomId={classroomId} onSaved={live.refresh} />}
            {tab === 'roster' && <RosterTab st={st} roster={roster} onSaved={live.refresh} />}
            {tab === 'check' && <CheckTab st={st} onSaved={live.refresh} onStarted={() => navigate(`/teacher/toolbox/quiz/${quizId}`)} />}
          </>
        )}
      </div>
    </TeacherShell>
  );
}

// ---------------------------------------------------------------------
// 1·2. 기본 설정 + 길드·제출 계정 (한 번에 저장)
// ---------------------------------------------------------------------
type RosterData = ReturnType<typeof useClassRoster>['roster'];

function SetupForm({ st, tab, editable, roster, onSaved }: { st: TeacherQuizState; tab: 'basic' | 'guilds'; editable: boolean; roster: RosterData; onSaved: () => void }) {
  const [title, setTitle] = useState(st.event.title);
  const [rehearsal, setRehearsal] = useState(st.event.is_rehearsal);
  const [cfg, setCfg] = useState<QuizConfig>(st.event.config);
  const [posText, setPosText] = useState(st.event.config.positions.join(', '));
  const [guilds, setGuilds] = useState<Record<number, { on: boolean; device: number | null }>>({});
  const [dirty, setDirty] = useState(false);
  const { run, busy, error } = useAction();

  // 서버 값이 바뀌었고 손대지 않은 상태면 따라간다
  useEffect(() => {
    if (dirty) return;
    setTitle(st.event.title);
    setRehearsal(st.event.is_rehearsal);
    setCfg(st.event.config);
    setPosText(st.event.config.positions.join(', '));
    const g: Record<number, { on: boolean; device: number | null }> = {};
    for (const x of st.guilds) g[x.guild_id] = { on: true, device: x.device_student_id };
    setGuilds(g);
  }, [st.event.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof QuizConfig>(k: K, v: QuizConfig[K]) => { setCfg((c) => ({ ...c, [k]: v })); setDirty(true); };
  const positions = posText.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  const order = roster?.guilds ?? [];
  const chosen = order.filter((g) => guilds[g.id]?.on);

  const save = async () => {
    const payloadGuilds = chosen.map((g) => ({ guild_id: g.id, device_student_id: guilds[g.id]?.device ?? null }));
    const ok = await run('save', () => quizRpc.saveSetup(supabase, st.event.id, title.trim(), { ...cfg, positions }, payloadGuilds, rehearsal), '설정을 저장했어요');
    if (ok !== null) { setDirty(false); onSaved(); }
  };

  const disabled = !editable;
  return (
    <div className="tbx-stack">
      {tab === 'basic' ? (
        <div className="tbx-panel tbx-stack">
          <h2 className="tbx-h2">기본 설정</h2>
          <label className="tbx-label" htmlFor="qz-title">대회 이름</label>
          <input id="qz-title" className="tbx-input" maxLength={60} value={title} disabled={disabled} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
          <Toggle checked={rehearsal} disabled={disabled} onChange={(v) => { setRehearsal(v); setDirty(true); }} title="리허설 대회" hint="끝난 뒤 지울 수 있어요" />
          <div className="qz-grid2">
            <Toggle checked={cfg.use_individual} disabled={disabled} onChange={(v) => set('use_individual', v)} title="개인전 사용" hint="포지션별 대표가 같은 문제를 풀어요" />
            <Toggle checked={cfg.use_team} disabled={disabled} onChange={(v) => set('use_team', v)} title="단체전 사용" hint="길드원이 함께 상의해 답 하나를 내요" />
          </div>
          <label className="tbx-label" htmlFor="qz-pos">개인전 포지션 (쉼표로 구분, 1~8개)</label>
          <input id="qz-pos" className="tbx-input" value={posText} disabled={disabled} onChange={(e) => { setPosText(e.target.value); setDirty(true); }} />
          <p className="tbx-small">지금: {positions.map((p, i) => `${i + 1}. ${p}`).join(' · ') || '없음'}</p>
          <div className="qz-grid2">
            <div className="tbx-stack--tight tbx-stack"><span className="tbx-label">기본 배점 — 개인전</span><Stepper value={cfg.points_ind} min={0} max={1000} onChange={(v) => set('points_ind', v)} suffix="점" label="개인전 기본 배점" /></div>
            <div className="tbx-stack--tight tbx-stack"><span className="tbx-label">기본 배점 — 단체전</span><Stepper value={cfg.points_team} min={0} max={1000} onChange={(v) => set('points_team', v)} suffix="점" label="단체전 기본 배점" /></div>
            <div className="tbx-stack--tight tbx-stack"><span className="tbx-label">기본 시간 — 지식형</span><Stepper value={cfg.time_knowledge} min={5} max={600} step={5} onChange={(v) => set('time_knowledge', v)} suffix="초" label="지식형 기본 시간" /></div>
            <div className="tbx-stack--tight tbx-stack"><span className="tbx-label">기본 시간 — 추론형</span><Stepper value={cfg.time_reasoning} min={5} max={600} step={5} onChange={(v) => set('time_reasoning', v)} suffix="초" label="추론형 기본 시간" /></div>
          </div>
          <p className="tbx-small">배점·시간은 문제마다 따로 정할 수 있어요. 비워 둔 문제에만 기본값이 들어가요. 총점은 실제 문제 배점의 합으로 계산해요.</p>
          <h3 className="tbx-h3" style={{ marginTop: 8 }}>작은 순위판 공개 주기</h3>
          <div className="qz-grid2">
            <div className="tbx-stack--tight tbx-stack"><span className="tbx-label">개인전: 채점 확정 몇 문제마다 (0 = 안 함)</span><Stepper value={cfg.checkpoint_ind} min={0} max={50} onChange={(v) => set('checkpoint_ind', v)} suffix="문제" label="개인전 공개 주기" /></div>
            <div className="tbx-stack--tight tbx-stack"><span className="tbx-label">단체전: 채점 확정 몇 문제마다 (0 = 안 함)</span><Stepper value={cfg.checkpoint_team} min={0} max={50} onChange={(v) => set('checkpoint_team', v)} suffix="문제" label="단체전 공개 주기" /></div>
          </div>
          <Toggle checked={cfg.auto_checkpoint} onChange={(v) => set('auto_checkpoint', v)} disabled={disabled} title="공개 시점이 되면 바로 순위판 갱신"
            hint="끄면(권장) 공개 시점에 '순위판 공개' 버튼이 켜지고, 교사가 눌러야 바뀌어요. 각 구간 마지막 문제는 작은 갱신 대신 대형 발표로 넘어가요." />
          <h3 className="tbx-h3" style={{ marginTop: 8 }}>답안·시간</h3>
          <div className="qz-grid2">
            <div className="tbx-stack--tight tbx-stack"><span className="tbx-label">답안 글자 수 제한</span><Stepper value={cfg.max_len} min={10} max={300} step={10} onChange={(v) => set('max_len', v)} suffix="자" label="답안 글자 수" /></div>
            <div className="tbx-stack--tight tbx-stack"><span className="tbx-label">마감 유예(전송 지연 보정)</span><Stepper value={cfg.grace_ms} min={0} max={2000} step={250} onChange={(v) => set('grace_ms', v)} suffix="ms" label="마감 유예" /></div>
          </div>
          <p className="tbx-small">태블릿 화면은 0초에 마감으로 바뀌어요. 0초 직전에 누른 답이 전송 중이면 유예 시간 안에 도착한 것까지 받아요.</p>
        </div>
      ) : (
        <div className="tbx-panel tbx-stack">
          <h2 className="tbx-h2">참가 길드와 제출 대표 계정</h2>
          <p className="tbx-small">길드마다 크롬북 1대에 대표 학생 계정 하나로 로그인해 둬요. 선수가 바뀌어도 다시 로그인하지 않아요. 다른 계정으로는 그 길드 답을 낼 수 없어요.</p>
          {!roster ? <p className="tbx-small">학급 명단을 불러오는 중…</p> : (
            <div className="tbx-list">
              {order.map((g, i) => {
                const cur = guilds[g.id] ?? { on: false, device: null };
                const members = roster.students.filter((s) => g.member_ids.includes(s.id));
                return (
                  <div key={g.id} className="tbx-list__row qz-guild-row">
                    <input type="checkbox" aria-label={`${g.name} 참가`} checked={cur.on} disabled={disabled}
                      onChange={(e) => { setGuilds((m) => ({ ...m, [g.id]: { ...cur, on: e.target.checked } })); setDirty(true); }} />
                    <GuildMark name={g.name} logo={g.logo_url} color={colorAt(i)} />
                    <span className="tbx-grow"><span className="tbx-h3">{g.name}</span> <span className="tbx-small">{members.length}명</span></span>
                    <select className="tbx-select" aria-label={`${g.name} 제출 대표 계정`} value={cur.device ?? ''} disabled={disabled || !cur.on}
                      onChange={(e) => { setGuilds((m) => ({ ...m, [g.id]: { ...cur, device: e.target.value ? Number(e.target.value) : null } })); setDirty(true); }}>
                      <option value="">대표 계정 고르기</option>
                      {members.map((s) => <option key={s.id} value={s.id}>{studentLabel(s, roster.students)}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
          <p className="tbx-small">선택 {chosen.length}개 길드 · 대표 계정 미지정 {chosen.filter((g) => !guilds[g.id]?.device).length}개</p>
        </div>
      )}
      {editable && (
        <div className="tbx-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          {dirty && <span className="tbx-small tbx-brass-text">저장하지 않은 변경이 있어요</span>}
          <button type="button" className="tbx-btn tbx-btn--brass" disabled={busy === 'save' || !title.trim() || positions.length === 0} onClick={() => void save()}>
            {busy === 'save' ? '저장 중…' : '설정 저장'}
          </button>
        </div>
      )}
      <InlineError error={error} />
    </div>
  );
}

// ---------------------------------------------------------------------
// 3. 문제 — 표 붙여넣기 · 목록 · 편집 · 미디어
// ---------------------------------------------------------------------
function QuestionsTab({ st, classroomId, onSaved }: { st: TeacherQuizState; classroomId: number | null; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [editing, setEditing] = useState<QuizQuestion | 'new' | null>(null);
  const { run, busy, error } = useAction();
  const { ask, dialog } = useConfirm();
  const cfg = st.event.config;
  const bulkAllowed = st.event.phase === 'SETUP' || st.event.phase === 'LOBBY';
  const positions = cfg.positions;
  const qs = st.questions;

  const preview = () => setParsed(parseQuestionTable(text, positions));
  const okRows = (parsed ?? []).filter((r) => r.input);
  const badRows = (parsed ?? []).filter((r) => r.error);

  const saveParsed = async (mode: 'REPLACE' | 'APPEND') => {
    if (badRows.length > 0) return;
    if (mode === 'REPLACE' && qs.length > 0) {
      if (!(await ask('문제를 모두 바꿀까요?', <>지금 있는 문제 {qs.length}개를 지우고 붙여넣은 {okRows.length}개로 바꿔요. 올려 둔 미디어 파일 연결도 사라져요.</>, '모두 바꾸기', true))) return;
    }
    const old = mode === 'REPLACE' ? qs.map((q) => q.media_path) : [];
    const res = await run('paste', () => quizRpc.saveQuestions(supabase, st.event.id, okRows.map((r) => r.input!), mode), `문제 ${okRows.length}개를 저장했어요`);
    if (res) { void removeQuizMedia(supabase, old); setText(''); setParsed(null); onSaved(); }
  };

  const copyTemplate = async () => {
    try { await navigator.clipboard.writeText(PASTE_TEMPLATE); } catch { /* 복사 권한이 없으면 아래 표를 직접 보고 만든다 */ }
  };

  const del = async (q: QuizQuestion) => {
    if (!(await ask('문제를 지울까요?', <>「{q.prompt.slice(0, 40)}」</>, '지우기', true))) return;
    const res = await run(`del${q.id}`, () => quizRpc.deleteQuestion(supabase, st.event.id, q.id), '문제를 지웠어요');
    if (res) { void removeQuizMedia(supabase, [res.media_path]); onSaved(); }
  };

  // 통계(출제 비율 점검용)
  const active = qs.filter((q) => q.status === 'ACTIVE');
  const kindK = active.filter((q) => q.kind === 'KNOWLEDGE').length;
  const kindR = active.filter((q) => q.kind === 'REASONING').length;
  const brand = active.filter((q) => q.theme === 'BRAND_WORLD' || q.theme === 'BRAND_ECONOMY').length;
  const indPts = active.filter((q) => q.stage === 'INDIVIDUAL').reduce((s, q) => s + q.points, 0);
  const teamPts = active.filter((q) => q.stage === 'TEAM').reduce((s, q) => s + q.points, 0);

  const groups: { key: string; label: string; items: QuizQuestion[] }[] = [];
  if (cfg.use_individual) positions.forEach((p, i) => groups.push({ key: `p${i}`, label: `개인전 · ${p}`, items: qs.filter((q) => q.stage === 'INDIVIDUAL' && q.position_index === i) }));
  if (cfg.use_team) groups.push({ key: 'team', label: '단체전', items: qs.filter((q) => q.stage === 'TEAM') });

  return (
    <div className="tbx-stack">
      <div className="tbx-panel tbx-stack">
        <div className="tbx-section-head"><h2 className="tbx-h2">표에서 한꺼번에 붙여넣기</h2>
          <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => void copyTemplate()}>양식 복사</button></div>
        <p className="tbx-small">엑셀·구글 시트에서 칸을 선택해 복사(Ctrl+C)한 뒤 아래에 붙여넣어요(Ctrl+V). 첫 줄이 제목 줄이면 제목 이름으로 칸을 찾아요.</p>
        <div className="qz-cols" role="list" aria-label="칸 순서">{PASTE_COLUMNS.map((c) => <span key={c} role="listitem" className="tbx-chip">{c}</span>)}</div>
        <p className="tbx-small">구간 = 개인/단체 · 포지션 = {positions.join('·')} 또는 1~{positions.length} · 허용 표현은 | 로 여러 개 · 유형 = 지식/추론 · 주제 = 세계관/경제/상식/수업 · 배점·시간이 비면 기본값 · 미디어 주소 = https:// (YouTube·이미지·mp4). 내 컴퓨터의 그림·영상 파일은 저장한 뒤 문제마다 '미디어' 버튼으로 올려요.</p>
        <textarea className="tbx-textarea qz-paste" value={text} placeholder="여기에 붙여넣기" disabled={!bulkAllowed}
          onChange={(e) => { setText(e.target.value); setParsed(null); }} />
        {!bulkAllowed && <p className="tbx-small tbx-brass-text">경기 중에는 아래 '문제 1개 추가'를 써 주세요.</p>}
        <div className="tbx-row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="tbx-btn" disabled={!text.trim() || !bulkAllowed} onClick={preview}>미리 보기</button>
        </div>
        {parsed && (
          <div className="tbx-stack">
            <p className="tbx-h3">읽은 줄 {parsed.length}개 · 정상 {okRows.length}개{badRows.length ? <span className="tbx-ember-text"> · 고칠 줄 {badRows.length}개</span> : null}</p>
            {badRows.length > 0 && (
              <Notice tone="ember" icon="✏️">
                {badRows.slice(0, 8).map((r) => <div key={r.line}>{r.line}번째 줄: {r.error}</div>)}
                {badRows.length > 8 && <div>…외 {badRows.length - 8}줄</div>}
                <div>표를 고친 뒤 다시 붙여넣어 주세요. 고칠 줄이 있으면 저장하지 않아요.</div>
              </Notice>
            )}
            <div className="qz-table-wrap">
              <table className="qz-table">
                <thead><tr><th>#</th><th>구간</th><th>문제</th><th>정답</th><th>허용</th><th>유형·주제</th><th>배점</th><th>시간</th><th>미디어</th></tr></thead>
                <tbody>
                  {okRows.slice(0, 60).map((r) => {
                    const q = r.input!;
                    return (
                      <tr key={r.line}>
                        <td>{r.line}</td>
                        <td>{q.stage === 'TEAM' ? '단체' : `개인·${positions[q.position_index ?? 0]}`}</td>
                        <td className="qz-cell-prompt">{q.prompt}</td>
                        <td>{q.answer_key}</td>
                        <td>{q.accepted.join(' | ')}</td>
                        <td>{q.kind ? KIND_LABEL[q.kind] : '—'} · {q.theme ? THEME_LABEL[q.theme] : '—'}</td>
                        <td>{q.points ?? (q.stage === 'TEAM' ? cfg.points_team : cfg.points_ind)}</td>
                        <td>{q.time_limit_sec ?? (q.kind === 'REASONING' ? cfg.time_reasoning : cfg.time_knowledge)}초</td>
                        <td>{q.media_type ?? ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="tbx-row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="tbx-btn" disabled={badRows.length > 0 || okRows.length === 0 || busy === 'paste'} onClick={() => void saveParsed('APPEND')}>뒤에 추가</button>
              <button type="button" className="tbx-btn tbx-btn--brass" disabled={badRows.length > 0 || okRows.length === 0 || busy === 'paste'} onClick={() => void saveParsed('REPLACE')}>
                {qs.length > 0 ? '전체 바꾸기' : '저장'}
              </button>
            </div>
          </div>
        )}
        <InlineError error={error} />
      </div>

      <div className="tbx-panel tbx-stack">
        <div className="tbx-section-head">
          <h2 className="tbx-h2">문제 목록</h2>
          <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--brass" onClick={() => setEditing('new')}>문제 1개 추가</button>
        </div>
        <div className="qz-stats">
          <span className="tbx-chip">개인전 {indPts}점 · 단체전 {teamPts}점 · 총 {indPts + teamPts}점</span>
          <span className="tbx-chip">지식 {kindK} : 추론 {kindR}{active.length - kindK - kindR ? ` · 미분류 ${active.length - kindK - kindR}` : ''}</span>
          <span className={brand * 2 > active.length ? 'tbx-chip tbx-chip--live' : 'tbx-chip tbx-chip--ember'}>B.R.A.N.D 세계관·경제 {brand}/{active.length}{brand * 2 > active.length ? ' (절반 넘음)' : ' (절반 이하)'}</span>
        </div>
        {groups.map((g) => (
          <div key={g.key} className="tbx-stack--tight tbx-stack">
            <h3 className="tbx-h3">{g.label} <span className="tbx-small">{g.items.length}문제</span></h3>
            {g.items.length === 0 ? <p className="tbx-small tbx-ember-text">문제가 없어요</p> : (
              <div className="tbx-list">
                {g.items.map((q) => (
                  <QuestionRow key={q.id} q={q} st={st} classroomId={classroomId} onEdit={() => setEditing(q)} onDelete={() => void del(q)} onSaved={onSaved} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && <QuestionEditor st={st} q={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onSaved(); }} />}
      {dialog}
    </div>
  );
}

export function questionToInput(q: QuizQuestion): QuizQuestionInput {
  return {
    id: q.id, stage: q.stage, position_index: q.position_index, prompt: q.prompt, answer_key: q.answer_key, accepted: q.accepted,
    explanation: q.explanation, note: q.note, kind: q.kind, theme: q.theme, points: q.points, time_limit_sec: q.time_limit_sec,
    media_type: q.media_type, media_path: q.media_path, media_url: q.media_url, media_on_device: q.media_on_device,
  };
}

function QuestionRow({ q, st, classroomId, onEdit, onDelete, onSaved }: {
  q: QuizQuestion; st: TeacherQuizState; classroomId: number | null; onEdit: () => void; onDelete: () => void; onSaved: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const started = !!q.started_at || q.attempt > 0;
  const upload = async (file: File | undefined) => {
    if (!file || !classroomId) return;
    setUploading(true); setErr(null);
    try {
      const up = await uploadQuizMedia(supabase, classroomId, st.event.id, file);
      await quizRpc.upsertQuestion(supabase, st.event.id, { ...questionToInput(q), media_type: up.media_type, media_path: up.path, media_url: null,
        media_on_device: up.media_type === 'IMAGE' });
      if (q.media_path) void removeQuizMedia(supabase, [q.media_path]);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : toToolboxError(e).message);
    } finally { setUploading(false); }
  };
  const clearMedia = async () => {
    try {
      await quizRpc.upsertQuestion(supabase, st.event.id, { ...questionToInput(q), media_type: null, media_path: null, media_url: null });
      if (q.media_path) void removeQuizMedia(supabase, [q.media_path]);
      onSaved();
    } catch (e) { setErr(toToolboxError(e).message); }
  };
  return (
    <div className={`tbx-list__row qz-qrow${q.status === 'VOID' ? ' qz-qrow--void' : ''}`}>
      <span className="qz-qrow__no">{q.seq}</span>
      <span className="tbx-grow">
        <span className="qz-qrow__prompt">{q.prompt}</span>
        <span className="tbx-small" style={{ display: 'block' }}>
          정답 <b className="tbx-brass-text">{q.answer_key}</b>{q.accepted.length ? ` (허용: ${q.accepted.join(' | ')})` : ''} · {q.points}점 · {q.time_limit_sec}초
          {q.kind ? ` · ${KIND_LABEL[q.kind]}` : ''}{q.theme ? ` · ${THEME_LABEL[q.theme]}` : ''}
          {q.status === 'VOID' ? ` · 무효(${q.void_reason ?? ''})` : ''}{q.graded_at ? ' · 채점 완료' : started ? ' · 출제됨' : ''}
        </span>
        {err && <span className="tbx-field-error" role="alert">{err}</span>}
      </span>
      {q.media_type && (
        <span className="qz-qrow__media">
          <QuizMedia client={supabase} type={q.media_type} path={q.media_path} url={q.media_url} mode="thumb" />
          {!started && <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" onClick={() => void clearMedia()} title="미디어 빼기">✕</button>}
        </span>
      )}
      {!started && (
        <label className="tbx-btn tbx-btn--sm" title="이미지 또는 짧은 영상(50MB까지)">
          {uploading ? '올리는 중…' : q.media_type ? '미디어 바꾸기' : '미디어'}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" hidden disabled={uploading}
            onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      )}
      <button type="button" className="tbx-btn tbx-btn--sm" onClick={onEdit}>{started ? '정답 수정' : '편집'}</button>
      {!started && <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--ghost" onClick={onDelete}>지우기</button>}
    </div>
  );
}

export function QuestionEditor({ st, q, onClose, onSaved }: { st: TeacherQuizState; q: QuizQuestion | null; onClose: () => void; onSaved: () => void }) {
  const cfg = st.event.config;
  const started = !!q && (!!q.started_at || q.attempt > 0);
  const [f, setF] = useState<QuizQuestionInput>(() => q ? questionToInput(q) : {
    stage: cfg.use_individual ? 'INDIVIDUAL' : 'TEAM', position_index: cfg.use_individual ? 0 : null, prompt: '', answer_key: '', accepted: [],
    kind: 'KNOWLEDGE', theme: null, points: null, time_limit_sec: null, explanation: null, media_type: null, media_url: null, media_path: null, media_on_device: true,
  });
  const [acceptedText, setAcceptedText] = useState((q?.accepted ?? []).join(' | '));
  const [urlText, setUrlText] = useState(q?.media_type && !q.media_path ? q.media_url ?? '' : '');
  const { run, busy, error } = useAction();
  const set = <K extends keyof QuizQuestionInput>(k: K, v: QuizQuestionInput[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    const accepted = acceptedText.split(/[|;]/).map((x) => x.trim()).filter(Boolean);
    let media: Partial<QuizQuestionInput> = {};
    if (!f.media_path) {
      const t = urlText.trim() ? mediaTypeOfUrl(urlText) : null;
      media = { media_type: t, media_url: t ? urlText.trim() : null, media_on_device: t === 'IMAGE' ? f.media_on_device : false };
    }
    const res = await run('save', () => quizRpc.upsertQuestion(supabase, st.event.id, { ...f, ...media, accepted }), '문제를 저장했어요');
    if (res) onSaved();
  };

  return (
    <Modal open onClose={onClose} wide title={q ? (started ? '정답·해설 수정 (출제한 문제)' : '문제 편집') : '문제 추가'}
      footer={<>
        <button type="button" className="tbx-btn" onClick={onClose}>취소</button>
        <button type="button" className="tbx-btn tbx-btn--brass" disabled={busy === 'save' || !f.prompt.trim() || !f.answer_key.trim()} onClick={() => void save()}>
          {busy === 'save' ? '저장 중…' : '저장'}
        </button>
      </>}>
      <div className="tbx-stack">
        {started && <Notice icon="📝">이미 출제한 문제라 정답·허용 표현·해설·메모만 바꿀 수 있어요. 바꾼 내용은 기록에 남고, 확정 전 판정 후보가 다시 계산돼요.</Notice>}
        <div className="qz-grid2">
          <div className="tbx-stack--tight tbx-stack">
            <span className="tbx-label">구간</span>
            <Seg<'INDIVIDUAL' | 'TEAM'> value={f.stage} onChange={(v) => { set('stage', v); set('position_index', v === 'TEAM' ? null : 0); }}
              options={[{ value: 'INDIVIDUAL', label: '개인전' }, { value: 'TEAM', label: '단체전' }]} />
          </div>
          {f.stage === 'INDIVIDUAL' && (
            <div className="tbx-stack--tight tbx-stack">
              <label className="tbx-label" htmlFor="qz-e-pos">포지션</label>
              <select id="qz-e-pos" className="tbx-select" value={f.position_index ?? 0} disabled={started} onChange={(e) => set('position_index', Number(e.target.value))}>
                {cfg.positions.map((p, i) => <option key={p + i} value={i}>{i + 1}. {p}</option>)}
              </select>
            </div>
          )}
        </div>
        <label className="tbx-label" htmlFor="qz-e-prompt">문제</label>
        <textarea id="qz-e-prompt" className="tbx-textarea" maxLength={1000} rows={3} value={f.prompt} disabled={started} onChange={(e) => set('prompt', e.target.value)} />
        <div className="qz-grid2">
          <div className="tbx-stack--tight tbx-stack">
            <label className="tbx-label" htmlFor="qz-e-ans">정답(교사만 보임)</label>
            <input id="qz-e-ans" className="tbx-input" maxLength={300} value={f.answer_key} onChange={(e) => set('answer_key', e.target.value)} />
          </div>
          <div className="tbx-stack--tight tbx-stack">
            <label className="tbx-label" htmlFor="qz-e-acc">허용 표현 ( | 로 구분)</label>
            <input id="qz-e-acc" className="tbx-input" value={acceptedText} onChange={(e) => setAcceptedText(e.target.value)} placeholder="예: 인플레이션|물가 상승" />
          </div>
        </div>
        <p className="tbx-small">자동 판정 후보는 띄어쓰기·문장부호·대소문자를 무시하고 정답·허용 표현과 같은지만 봐요. 최종 판정은 교사가 해요.</p>
        <div className="qz-grid2">
          <div className="tbx-stack--tight tbx-stack">
            <span className="tbx-label">유형</span>
            <Seg<string> value={f.kind ?? ''} onChange={(v) => !started && set('kind', (v || null) as QuizQuestionInput['kind'])}
              options={[{ value: 'KNOWLEDGE', label: '지식' }, { value: 'REASONING', label: '추론' }, { value: '', label: '미분류' }]} />
          </div>
          <div className="tbx-stack--tight tbx-stack">
            <label className="tbx-label" htmlFor="qz-e-theme">주제</label>
            <select id="qz-e-theme" className="tbx-select" value={f.theme ?? ''} disabled={started} onChange={(e) => set('theme', (e.target.value || null) as QuizQuestionInput['theme'])}>
              <option value="">미분류</option>
              {Object.entries(THEME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="tbx-stack--tight tbx-stack">
            <span className="tbx-label">배점</span>
            <Stepper value={f.points ?? (f.stage === 'TEAM' ? cfg.points_team : cfg.points_ind)} min={0} max={1000} onChange={(v) => !started && set('points', v)} suffix="점" label="배점" />
          </div>
          <div className="tbx-stack--tight tbx-stack">
            <span className="tbx-label">제한 시간</span>
            <Stepper value={f.time_limit_sec ?? (f.kind === 'REASONING' ? cfg.time_reasoning : cfg.time_knowledge)} min={5} max={600} step={5}
              onChange={(v) => !started && set('time_limit_sec', v)} suffix="초" label="제한 시간" />
          </div>
        </div>
        <label className="tbx-label" htmlFor="qz-e-exp">해설 한 줄(채점 확정 뒤 교실 화면에 보임, 선택)</label>
        <input id="qz-e-exp" className="tbx-input" maxLength={300} value={f.explanation ?? ''} onChange={(e) => set('explanation', e.target.value || null)} />
        <label className="tbx-label" htmlFor="qz-e-note">채점 메모(교사만, 선택)</label>
        <input id="qz-e-note" className="tbx-input" maxLength={500} value={f.note ?? ''} onChange={(e) => set('note', e.target.value || null)} />
        {!started && !f.media_path && (
          <>
            <label className="tbx-label" htmlFor="qz-e-url">미디어 주소(선택: YouTube·이미지·mp4 https 주소)</label>
            <input id="qz-e-url" className="tbx-input" value={urlText} onChange={(e) => setUrlText(e.target.value)} placeholder="https://" />
            <p className="tbx-small">내 컴퓨터의 파일은 저장한 뒤 목록에서 '미디어' 버튼으로 올려요.</p>
          </>
        )}
        {!started && (f.media_type === 'IMAGE' || mediaTypeOfUrl(urlText) === 'IMAGE') && (
          <Toggle checked={f.media_on_device !== false} onChange={(v) => set('media_on_device', v)} title="태블릿에도 그림 보이기" hint="끄면 교실 화면에만 보여요" />
        )}
        <InlineError error={error} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// 4. 출전표 — 길드 × 포지션
// ---------------------------------------------------------------------
function RosterTab({ st, roster, onSaved }: { st: TeacherQuizState; roster: RosterData; onSaved: () => void }) {
  const positions = st.event.config.positions;
  const [draft, setDraft] = useState<Record<string, number | null>>({});
  const [dirty, setDirty] = useState(false);
  const { run, busy, error } = useAction();
  const reason = useReasonDialog();
  const midGame = st.event.phase === 'INDIVIDUAL';
  const locked = !['SETUP', 'LOBBY', 'INDIVIDUAL'].includes(st.event.phase);
  const startedPos = useMemo(() => new Set(st.questions.filter((q) => q.stage === 'INDIVIDUAL' && (q.started_at || q.attempt > 0)).map((q) => q.position_index)), [st.questions]);

  useEffect(() => {
    if (dirty) return;
    const d: Record<string, number | null> = {};
    for (const r of st.roster) d[`${r.guild_id}:${r.position_index}`] = r.student_id;
    setDraft(d);
  }, [st.event.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st.event.config.use_individual) return <Notice icon="ℹ️">개인전을 쓰지 않는 대회예요. 출전표가 필요 없어요.</Notice>;

  const save = async () => {
    let why: string | undefined;
    if (midGame) {
      const r = await reason.ask('경기 중 선수 교체', '아직 출제하지 않은 포지션만 바뀌어요. 이미 끝난 문제의 선수 기록은 그대로 남아요.', '교체하기');
      if (!r) return;
      why = r;
    }
    const rows = st.guilds.flatMap((g) => positions.map((_, i) => ({ guild_id: g.guild_id, position_index: i, student_id: draft[`${g.guild_id}:${i}`] ?? null })));
    const res = await run('roster', () => quizRpc.setRoster(supabase, st.event.id, rows, why), '출전표를 저장했어요');
    if (res) { setDirty(false); onSaved(); }
  };

  return (
    <div className="tbx-stack">
      <div className="tbx-panel tbx-stack">
        <h2 className="tbx-h2">개인전 출전표</h2>
        <p className="tbx-small">5인 길드는 포지션마다 한 명씩, 4인 길드는 한 명이 두 번 나와요. 결석생이 있으면 다른 길드원을 넣고 경고를 확인한 뒤 진행할 수 있어요.</p>
        <div className="qz-table-wrap">
          <table className="qz-table qz-roster">
            <thead><tr><th>길드</th>{positions.map((p, i) => <th key={i}>{p}{startedPos.has(i) ? ' 🔒' : ''}</th>)}</tr></thead>
            <tbody>
              {st.guilds.map((g) => {
                const rg = roster?.guilds.find((x) => x.id === g.guild_id);
                const members = roster ? roster.students.filter((s) => rg?.member_ids.includes(s.id)) : [];
                const counts = new Map<number, number>();
                positions.forEach((_, i) => { const v = draft[`${g.guild_id}:${i}`]; if (v) counts.set(v, (counts.get(v) ?? 0) + 1); });
                return (
                  <tr key={g.guild_id}>
                    <th scope="row">{g.name}<span className="tbx-small" style={{ display: 'block' }}>{members.length}명</span></th>
                    {positions.map((_, i) => {
                      const k = `${g.guild_id}:${i}`;
                      const v = draft[k] ?? null;
                      return (
                        <td key={i}>
                          <select className={`tbx-select${v && (counts.get(v) ?? 0) > 1 ? ' qz-dup' : ''}`} aria-label={`${g.name} ${positions[i]}`} value={v ?? ''}
                            disabled={locked || (midGame && startedPos.has(i))}
                            onChange={(e) => { setDraft((d) => ({ ...d, [k]: e.target.value ? Number(e.target.value) : null })); setDirty(true); }}>
                            <option value="">—</option>
                            {members.map((s) => <option key={s.id} value={s.id}>{studentLabel(s, roster!.students)}{(counts.get(s.id) ?? 0) > 0 && v !== s.id ? ` (${counts.get(s.id)})` : ''}</option>)}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {st.roster_check.errors.length > 0 && <Notice tone="ember" icon="⛔">{st.roster_check.errors.map((x) => <div key={x}>{x}</div>)}</Notice>}
        {st.roster_check.warnings.length > 0 && <Notice icon="⚠️">{st.roster_check.warnings.map((x) => <div key={x}>{x}</div>)}</Notice>}
        {!locked && (
          <div className="tbx-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            {dirty && <span className="tbx-small tbx-brass-text">저장하지 않은 변경이 있어요</span>}
            <button type="button" className="tbx-btn tbx-btn--brass" disabled={busy === 'roster'} onClick={() => void save()}>{busy === 'roster' ? '저장 중…' : '출전표 저장'}</button>
          </div>
        )}
        <InlineError error={error} />
      </div>
      {reason.dialog}
    </div>
  );
}

// ---------------------------------------------------------------------
// 5. 점검·대기실
// ---------------------------------------------------------------------
export function CheckTab({ st, onSaved, onStarted }: { st: TeacherQuizState; onSaved: () => void; onStarted: () => void }) {
  const { run, busy, error } = useAction();
  const reason = useReasonDialog();
  const [devices, setDevices] = useState<Record<string, string | null>>({});
  const [now, setNow] = useState(Date.now());
  const phase = st.event.phase;

  // 대기실에서는 8초마다 태블릿 접속 상태만 가볍게 확인
  useEffect(() => {
    if (phase !== 'LOBBY') return;
    let alive = true;
    const tick = () => quizRpc.presence(supabase, st.event.id).then((r) => {
      if (!alive) return;
      setDevices(r.devices);
      setNow(Date.parse(r.server_now));
    }).catch(() => undefined);
    void tick();
    const iv = window.setInterval(() => { void tick(); }, 8_000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [phase, st.event.id]);

  const online = (gid: number, fallback: string | null) => {
    const at = devices[String(gid)] ?? fallback;
    return !!at && now - Date.parse(at) < 40_000;
  };

  const start = async () => {
    try {
      await quizRpc.start(supabase, st.event.id);
      onStarted();
    } catch (e) {
      const off = offlineGuilds(e);
      if (off) {
        const why = await reason.ask('연결되지 않은 태블릿이 있어요', <>{off.join(', ')} 태블릿이 40초 넘게 연결되지 않았어요. 그래도 시작하려면 사유를 적어 주세요.</>, '그래도 시작');
        if (!why) return;
        const ok = await run('start', () => quizRpc.start(supabase, st.event.id, why), '경기를 시작했어요');
        if (ok !== null) onStarted();
      } else {
        await run('start', () => Promise.reject(e));
      }
    }
  };

  return (
    <div className="tbx-stack">
      <div className="tbx-panel tbx-stack">
        <h2 className="tbx-h2">시작 전 점검</h2>
        {st.ready_errors.length === 0 ? <Notice tone="signal" icon="✅">문제·출전표·제출 계정 준비가 끝났어요.</Notice> : (
          <Notice tone="ember" icon="⛔">{st.ready_errors.map((x) => <div key={x}>{x}</div>)}</Notice>
        )}
        {st.roster_check.warnings.length > 0 && <Notice icon="⚠️">{st.roster_check.warnings.map((x) => <div key={x}>{x}</div>)}</Notice>}
        <ul className="qz-checklist">
          <li>교사 PC는 Windows <b>확장 모드</b>(Win+P → 확장)로 연결하고, 중계 화면 창을 교실 화면 쪽으로 옮겨 전체 화면(F11)으로 띄워요. <b>복제 모드면 정답이 화면에 보여요.</b></li>
          <li>길드 크롬북 5대: 대표 계정으로 로그인 → 상단 <b>모험가 도구함</b> → 맨 위 <b>퀴즈 로얄</b> 카드를 눌러요(대기실을 연 뒤에 보여요).</li>
          <li>실전 전에 리허설 대회로 일시정지→재개, 태블릿 1대 새로고침, 교사 창 새로고침을 한 번씩 해 보세요.</li>
        </ul>
      </div>
      <div className="tbx-panel tbx-stack">
        <div className="tbx-section-head"><h2 className="tbx-h2">대기실 · 태블릿 연결</h2>{phase === 'LOBBY' && <span className="tbx-chip tbx-chip--live">대기실 열림</span>}</div>
        <div className="tbx-list">
          {st.guilds.map((g, i) => (
            <div key={g.guild_id} className="tbx-list__row">
              <GuildMark name={g.name} logo={g.logo_url} color={colorAt(i)} />
              <span className="tbx-grow"><span className="tbx-h3">{g.name}</span> <span className="tbx-small">제출 계정: {g.device_name ?? '미지정'}</span></span>
              {phase === 'LOBBY' ? (online(g.guild_id, g.device_seen_at)
                ? <span className="tbx-chip tbx-chip--live">● 연결됨</span>
                : <span className="tbx-chip tbx-chip--ember">○ 연결 안 됨</span>) : <span className="tbx-chip">대기실 닫힘</span>}
            </div>
          ))}
        </div>
        <div className="tbx-row tbx-row--wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
          {phase === 'SETUP' && (
            <button type="button" className="tbx-btn tbx-btn--brass" disabled={busy === 'lobby'}
              onClick={() => void run('lobby', () => quizRpc.openLobby(supabase, st.event.id, true), '대기실을 열었어요').then(onSaved)}>대기실 열기</button>
          )}
          {phase === 'LOBBY' && (
            <>
              <button type="button" className="tbx-btn" disabled={busy === 'lobby'}
                onClick={() => void run('lobby', () => quizRpc.openLobby(supabase, st.event.id, false), '준비 단계로 돌아갔어요').then(onSaved)}>대기실 닫기</button>
              <button type="button" className="tbx-btn tbx-btn--signal tbx-btn--lg" disabled={busy === 'start' || st.ready_errors.length > 0} onClick={() => void start()}>
                ⚔️ 경기 시작
              </button>
            </>
          )}
          {phase !== 'SETUP' && phase !== 'LOBBY' && <button type="button" className="tbx-btn tbx-btn--signal" onClick={onStarted}>진행 화면으로</button>}
        </div>
        <InlineError error={error} />
      </div>
      {reason.dialog}
    </div>
  );
}
