// =====================================================================
// 교사 — 학급 활동 만들기
// ---------------------------------------------------------------------
// 설정과 참가자를 정해 서버에 만들고, 바로 운영 화면으로 간다.
// 시작한 뒤에는 참가자·규칙이 고정된다(바꾸려면 새로 만든다).
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';
import { ParticipantPicker } from '../ParticipantPicker';
import { buildUnits, isAbsent, studentLabel, useClassRoster } from '../roster';
import { toolboxRpc } from '../toolbox_rpc';
import { Glyph, InlineError, KIND_GLYPH, KIND_LABEL, Notice, Seg, Stepper, Toggle, shuffle, useAction } from '../ui';
import { BracketView, roundName } from '../views';
import type { BracketState, ClassActivityKind, RosterItem, Unit } from '../toolbox_types';
import '../toolbox.css';

function defaultTitle(kind: ClassActivityKind) {
  const d = new Date();
  return `${KIND_LABEL[kind]} ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function nextPow2(n: number) { let p = 2; while (p < n) p *= 2; return p; }

/** 부전승을 앞쪽 경기부터 고르게 배치한다. 빈 칸끼리 붙는 경기는 생기지 않는다. */
export function seedSlots(keys: string[]): (string | null)[] {
  const size = nextPow2(keys.length);
  const byes = size - keys.length;
  const slots: (string | null)[] = [];
  let k = 0;
  for (let m = 0; m < size / 2; m += 1) {
    slots.push(keys[k++] ?? null);
    slots.push(m < byes ? null : keys[k++] ?? null);
  }
  return slots;
}

export function CreateActivityPage() {
  const { kind: kindParam } = useParams<{ kind: string }>();
  const kind = (kindParam ?? '').toUpperCase() as ClassActivityKind;
  const navigate = useNavigate();
  const location = useLocation();
  const classroomId = useAuthStore((s) => s.context?.classroomId ?? null);
  const { roster } = useClassRoster(supabase, classroomId, true);
  const incomingTeams = ((location.state as any)?.teams ?? null) as RosterItem[] | null;

  const [title, setTitle] = useState(() => defaultTitle(kind));
  const [items, setItems] = useState<RosterItem[]>(incomingTeams ?? []);
  const [openNow, setOpenNow] = useState(true);
  const { run, busy, error } = useAction();

  // 공통 설정
  const [sort, setSort] = useState<'FIXED' | 'SCORE'>('FIXED');
  const [share, setShare] = useState(true);
  // 버저
  const [mode, setMode] = useState<'INDIVIDUAL' | 'TEAM'>(incomingTeams ? 'TEAM' : 'INDIVIDUAL');
  const [teamPress, setTeamPress] = useState<'ANY' | 'REP'>('ANY');
  const [reps, setReps] = useState<Record<string, number>>({});
  const [closeOnFirst, setCloseOnFirst] = useState(false);
  const [showFalse, setShowFalse] = useState(false);
  const [withBoard, setWithBoard] = useState(true);
  const [points, setPoints] = useState(10);
  // 대진표
  const [thirdPlace, setThirdPlace] = useState(false);
  const [slots, setSlots] = useState<(string | null)[] | null>(null);
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  // 투표
  const [voteMode, setVoteMode] = useState<'YESNO' | 'MULTI' | 'CANDIDATE'>('YESNO');
  const [description, setDescription] = useState('');
  const [optionsText, setOptionsText] = useState('');
  const [candidates, setCandidates] = useState<RosterItem[]>([]);
  const [position, setPosition] = useState('경제수호대');
  const [maxChoices, setMaxChoices] = useState(1);
  const [seats, setSeats] = useState(1);
  const [allowAbstain, setAllowAbstain] = useState(false);
  const [anonymous, setAnonymous] = useState(true);
  const [reveal, setReveal] = useState<'AFTER_CLOSE' | 'LIVE'>('AFTER_CLOSE');
  const [closeMode, setCloseMode] = useState<'MANUAL' | 'TIME'>('MANUAL');
  const [closeTime, setCloseTime] = useState('');
  const [judgeOn, setJudgeOn] = useState(false);
  const [judgeRule, setJudgeRule] = useState<'MAJORITY' | 'ABSOLUTE'>('MAJORITY');
  const [judgeThreshold, setJudgeThreshold] = useState(13);
  const [shuffleOpts, setShuffleOpts] = useState(false);
  // 카드
  const [prompt, setPrompt] = useState('');
  const [showAuthor, setShowAuthor] = useState(true);

  const isEligibleKind = kind === 'VOTE' || kind === 'CARDS';
  // 투표·카드: 학급 전체(오늘 결석 제외)로 미리 채운다.
  useEffect(() => {
    if (!roster || !isEligibleKind || items.length) return;
    setItems(roster.students.filter((s) => !s.is_test && !isAbsent(roster, s.id))
      .map((s) => ({ type: 'STUDENT' as const, student_id: s.id, label: studentLabel(s, roster.students) })));
  }, [roster]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAllowAbstain(voteMode === 'CANDIDATE'); if (voteMode === 'YESNO') setMaxChoices(1); }, [voteMode]);

  const units: Unit[] = useMemo(() => buildUnits(items, roster), [items, roster]);
  const eligibleIds = useMemo(() => Array.from(new Set(units.flatMap((u) => (u.student_id ? [u.student_id] : (u.members ?? []).map((m) => m.student_id))))), [units]);
  useEffect(() => { setJudgeThreshold(Math.floor(eligibleIds.length / 2) + 1); }, [eligibleIds.length]);
  useEffect(() => { setSlots(null); }, [units.length, items]);
  const candidateUnits = useMemo(() => buildUnits(candidates, roster), [candidates, roster]);
  const voteOptions = voteMode === 'MULTI' ? optionsText.split('\n').map((x) => x.trim()).filter(Boolean) : [];

  if (!['BUZZER', 'SCOREBOARD', 'TOURNAMENT', 'VOTE', 'CARDS'].includes(kind)) return null;

  // ---------- 검증 ----------
  const problems: string[] = [];
  if (!title.trim()) problems.push('활동 제목을 적어 주세요.');
  if (kind === 'SCOREBOARD' && units.length < 1) problems.push('점수를 매길 팀을 하나 이상 넣어 주세요.');
  if (kind === 'TOURNAMENT' && units.length < 2) problems.push('대진표에는 참가자가 둘 이상 필요해요.');
  if (kind === 'BUZZER') {
    if (units.length < 1) problems.push('버저 참가자를 넣어 주세요.');
    if (mode === 'INDIVIDUAL' && units.some((u) => u.type !== 'STUDENT')) problems.push('개인전에는 학생만 넣을 수 있어요. 길드는 ‘구성원 넣기’로 넣어 주세요.');
    if (mode === 'TEAM' && units.some((u) => u.type === 'STUDENT' || u.type === 'MANUAL')) problems.push('팀전에는 길드(길드로 넣기)나 팀 만들기 결과만 넣을 수 있어요.');
    if (mode === 'TEAM' && units.some((u) => (u.members ?? []).length === 0)) problems.push('학생 계정이 연결된 구성원이 없는 팀이 있어요.');
    if (mode === 'TEAM' && teamPress === 'REP' && units.some((u) => !reps[u.key])) problems.push('팀마다 대표를 정해 주세요.');
    const all = units.flatMap((u) => (u.student_id ? [u.student_id] : (u.members ?? []).map((m) => m.student_id)));
    if (new Set(all).size !== all.length) problems.push('한 학생이 두 팀에 들어 있어요.');
  }
  if (isEligibleKind && eligibleIds.length === 0) problems.push('참여할 학생을 한 명 이상 골라 주세요.');
  if (kind === 'VOTE') {
    if (voteMode === 'MULTI' && (voteOptions.length < 2 || voteOptions.length > 12)) problems.push('선택지는 2~12개로 적어 주세요.');
    if (voteMode === 'MULTI' && new Set(voteOptions.map((x) => x.toLowerCase())).size !== voteOptions.length) problems.push('같은 선택지가 두 번 들어 있어요.');
    if (voteMode === 'CANDIDATE' && candidateUnits.length < 1) problems.push('후보를 한 명 이상 골라 주세요.');
    const optionCount = voteMode === 'MULTI' ? voteOptions.length : voteMode === 'CANDIDATE' ? candidateUnits.length : 2;
    if (voteMode !== 'YESNO' && maxChoices > optionCount) problems.push('고를 수 있는 개수가 선택지 수보다 많아요.');
    if (voteMode === 'CANDIDATE' && seats > candidateUnits.length) problems.push('선출 인원이 후보 수보다 많아요.');
    if (closeMode === 'TIME' && !closeTime) problems.push('마감 시각을 정해 주세요.');
  }

  const closeAtIso = () => {
    if (closeMode !== 'TIME' || !closeTime) return undefined;
    const [h, m] = closeTime.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  };

  const currentSlots = slots ?? seedSlots(units.map((u) => u.key));
  const bracketPreview: BracketState = { slots: currentSlots, third_place: thirdPlace, results: {}, revealed_at: null };

  const create = async () => {
    const t = title.trim();
    void toolboxRpc.saveRoster(supabase, t.slice(0, 40), items, true).catch(() => undefined);
    const res = await run('create', async () => {
      if (kind === 'SCOREBOARD') {
        return toolboxRpc.create(supabase, { kind, title: t, participants: units, open: openNow, config: { sort, share_to_students: share } });
      }
      if (kind === 'BUZZER') {
        let scoreboardId: number | undefined;
        if (withBoard) {
          const b = await toolboxRpc.create(supabase, { kind: 'SCOREBOARD', title: `${t} 점수`, participants: units, open: true, config: { sort: 'FIXED', share_to_students: true } });
          scoreboardId = b.id;
        }
        try {
          return await toolboxRpc.create(supabase, { kind, title: t, participants: units, open: true, config: {
            mode, team_press: teamPress, reps, close_on_first: closeOnFirst, show_false_starts: showFalse, points, scoreboard_id: scoreboardId } });
        } catch (e) {
          // 버저를 못 만들면 함께 만든 점수판도 지워 빈 기록을 남기지 않는다.
          if (scoreboardId) await toolboxRpc.remove(supabase, scoreboardId).catch(() => undefined);
          throw e;
        }
      }
      if (kind === 'TOURNAMENT') {
        return toolboxRpc.create(supabase, { kind, title: t, participants: units, open: true, config: { slots: currentSlots, third_place: thirdPlace, share_to_students: share } });
      }
      if (kind === 'VOTE') {
        const options = voteMode === 'MULTI' ? voteOptions.map((label) => ({ label }))
          : voteMode === 'CANDIDATE' ? candidateUnits.map((u) => ({ student_id: u.student_id })) : [];
        return toolboxRpc.create(supabase, { kind, title: t, participants: [], open: openNow, config: {
          mode: voteMode, eligible: eligibleIds, options, description, position: voteMode === 'CANDIDATE' ? position : undefined,
          max_choices: voteMode === 'YESNO' ? 1 : maxChoices, seats, allow_abstain: allowAbstain, anonymous, reveal,
          close_at: closeAtIso(), shuffle: shuffleOpts,
          judge: voteMode === 'YESNO' && judgeOn ? { enabled: true, rule: judgeRule, threshold: judgeThreshold } : undefined } });
      }
      return toolboxRpc.create(supabase, { kind, title: t, participants: [], open: openNow, config: { eligible: eligibleIds, prompt, show_author: showAuthor } });
    }, '활동을 만들었어요');
    if (res) navigate(`/teacher/toolbox/activity/${res.id}`, { replace: true });
  };

  const pickerOptions = kind === 'BUZZER'
    ? (mode === 'INDIVIDUAL' ? { guildAsUnit: false, guildAsMembers: true, manual: false } : { guildAsUnit: true, guildAsMembers: false, manual: false })
    : isEligibleKind ? { studentsOnly: true, guildAsMembers: true, manual: false } : {};

  return (
    <TeacherShell>
      <div className="tbx tbx-teacher-page">
        <button type="button" className="tbx-btn tbx-btn--ghost tbx-btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/teacher/toolbox')}>← 모험가 도구함</button>
        <div className="tbx-hero">
          <Glyph name={KIND_GLYPH[kind]} size="lg" />
          <div><h1 className="tbx-h1">{KIND_LABEL[kind]} 만들기</h1><p className="tbx-small">시작한 뒤에는 참가자와 규칙이 고정돼요. 바꾸려면 새로 만들어요.</p></div>
        </div>
        {incomingTeams && <Notice icon="🧩">팀 만들기에서 만든 팀 {incomingTeams.length}개를 가져왔어요. 이름·색·구성원이 그대로 들어가요.</Notice>}

        <div className="tbx-split" style={{ gridTemplateColumns: undefined }}>
          <div className="tbx-stack tbx-stack--loose">
            <section className="tbx-panel tbx-stack">
              <label><span className="tbx-label">활동 제목</span>
                <input className="tbx-input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} /></label>
            </section>

            {kind === 'BUZZER' && (
              <section className="tbx-panel tbx-stack">
                <h2 className="tbx-h2">참가 방식</h2>
                <Seg block value={mode} onChange={(v) => { setMode(v); setItems([]); }} options={[{ value: 'INDIVIDUAL', label: '개인전' }, { value: 'TEAM', label: '팀전' }]} label="참가 방식" />
                {mode === 'TEAM' && (
                  <Seg block value={teamPress} onChange={setTeamPress} options={[{ value: 'ANY', label: '구성원 누구나 누르기' }, { value: 'REP', label: '팀 대표 1명만' }]} label="누르는 사람" />
                )}
                <p className="tbx-small">{mode === 'INDIVIDUAL' ? '학생 한 명 한 명이 자기 이름으로 눌러요.' : teamPress === 'ANY' ? '팀원 누구나 누를 수 있고, 팀마다 첫 입력만 순서에 들어가요.' : '팀마다 정한 대표만 누를 수 있어요.'}</p>
              </section>
            )}

            {kind === 'VOTE' && (
              <section className="tbx-panel tbx-stack">
                <h2 className="tbx-h2">투표 방식</h2>
                <Seg block value={voteMode} onChange={setVoteMode} options={[{ value: 'YESNO', label: '찬반' }, { value: 'MULTI', label: '다지선다' }, { value: 'CANDIDATE', label: '후보 선출' }]} label="투표 방식" />
                <label><span className="tbx-label">설명 (선택)</span>
                  <textarea className="tbx-textarea" style={{ minHeight: 70 }} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="무엇을 정하는 투표인지 적어요" /></label>
                {voteMode === 'MULTI' && (
                  <label><span className="tbx-label">선택지 (한 줄에 하나, 2~12개)</span>
                    <textarea className="tbx-textarea" value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder={'과학관\n박물관\n놀이공원'} />
                    <span className="tbx-hint" style={{ display: 'block' }}>{voteOptions.length}개</span></label>
                )}
                {voteMode === 'CANDIDATE' && (
                  <>
                    <label><span className="tbx-label">선출할 직책</span><input className="tbx-input" value={position} maxLength={40} onChange={(e) => setPosition(e.target.value)} /></label>
                    <div><span className="tbx-label">후보 (우리 반 학생)</span>
                      <ParticipantPicker client={supabase} classroomId={classroomId} roster={roster} value={candidates} onChange={setCandidates}
                        options={{ teacher: true, studentsOnly: true, guildAsMembers: false, manual: false }} /></div>
                    <div className="tbx-row tbx-row--between"><span className="tbx-h3">선출 인원</span><Stepper value={seats} min={1} max={Math.max(1, candidateUnits.length)} onChange={setSeats} label="선출 인원" suffix="명" /></div>
                  </>
                )}
                {voteMode !== 'YESNO' && (
                  <div className="tbx-row tbx-row--between"><span className="tbx-h3">한 사람이 고를 수 있는 개수</span>
                    <Stepper value={maxChoices} min={1} max={Math.max(1, voteMode === 'MULTI' ? voteOptions.length : candidateUnits.length)} onChange={setMaxChoices} label="최대 선택 수" suffix="개" /></div>
                )}
                <hr className="tbx-divider" />
                <Toggle checked={allowAbstain} onChange={setAllowAbstain} title="기권 선택지 넣기" hint="기권은 미참여와 따로 세요" />
                <Toggle checked={anonymous} onChange={setAnonymous} title="익명 투표" hint={anonymous ? '학생 화면과 중계 화면에는 누가 무엇을 골랐는지 보이지 않아요. 운영 화면에서만 확인할 수 있어요.' : '결과 발표 때 개인별 선택을 중계 화면에 공개할 수 있어요.'} />
                <Toggle checked={shuffleOpts} onChange={setShuffleOpts} title="학생마다 선택지 순서 섞기" />
                <div><span className="tbx-label">결과 공개</span>
                  <Seg block value={reveal} onChange={setReveal} options={[{ value: 'AFTER_CLOSE', label: '마감 후 공개 버튼으로' }, { value: 'LIVE', label: '진행 중에도 공개' }]} label="결과 공개" /></div>
                <div><span className="tbx-label">마감</span>
                  <Seg block value={closeMode} onChange={setCloseMode} options={[{ value: 'MANUAL', label: '직접 마감' }, { value: 'TIME', label: '시각 정하기' }]} label="마감 방식" />
                  {closeMode === 'TIME' && <input type="time" className="tbx-input" style={{ marginTop: 8, maxWidth: 160 }} value={closeTime} onChange={(e) => setCloseTime(e.target.value)} />}</div>
                {voteMode === 'YESNO' && (
                  <>
                    <Toggle checked={judgeOn} onChange={setJudgeOn} title="가결·부결 자동 판정" hint="끄면 득표 현황만 보여줘요" />
                    {judgeOn && (
                      <div className="tbx-well tbx-stack">
                        <Seg block value={judgeRule} onChange={setJudgeRule} options={[{ value: 'MAJORITY', label: '찬반표 과반' }, { value: 'ABSOLUTE', label: '정한 인원 이상 찬성' }]} label="판정 기준" />
                        {judgeRule === 'ABSOLUTE'
                          ? <div className="tbx-row tbx-row--between"><span className="tbx-small">전체 {eligibleIds.length}명 중 찬성</span><Stepper value={judgeThreshold} min={1} max={Math.max(1, eligibleIds.length)} onChange={setJudgeThreshold} suffix="명 이상" label="필요 찬성 수" /></div>
                          : <p className="tbx-small">기권을 뺀 찬성+반대 표 중 절반을 넘으면 가결이에요. 같으면 부결이에요.</p>}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {kind === 'CARDS' && (
              <section className="tbx-panel tbx-stack">
                <label><span className="tbx-label">안내 문구 (주제)</span>
                  <input className="tbx-input" maxLength={200} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="예: 오늘 배운 고려의 대외 교류 한 가지" /></label>
                <Toggle checked={showAuthor} onChange={setShowAuthor} title="발표 화면에 작성자 이름 보이기" hint="꺼도 운영 화면에서는 누가 썼는지 볼 수 있어요" />
              </section>
            )}

            <section className="tbx-panel tbx-stack">
              <div className="tbx-row tbx-row--between">
                <h2 className="tbx-h2">{isEligibleKind ? '참여 대상' : kind === 'SCOREBOARD' ? '점수판 팀' : '참가자'}</h2>
                {isEligibleKind && <span className="tbx-count">{eligibleIds.length}명</span>}
              </div>
              <ParticipantPicker client={supabase} classroomId={classroomId} roster={roster} value={items} onChange={setItems}
                options={{ teacher: true, ...pickerOptions }} />
              {kind === 'BUZZER' && mode === 'TEAM' && teamPress === 'REP' && units.length > 0 && (
                <div className="tbx-stack">
                  <span className="tbx-h3">팀 대표</span>
                  {units.map((u) => (
                    <div key={u.key} className="tbx-row tbx-row--wrap">
                      <span className="tbx-chip"><span className="tbx-dot" style={{ background: u.color }} />{u.label}</span>
                      {(u.members ?? []).map((m) => (
                        <button key={m.student_id} type="button" className="tbx-btn tbx-btn--sm" aria-pressed={reps[u.key] === m.student_id}
                          style={reps[u.key] === m.student_id ? { borderColor: 'var(--tbx-brass)', color: 'var(--tbx-brass-hi)' } : undefined}
                          onClick={() => setReps((r) => ({ ...r, [u.key]: m.student_id }))}>{m.label}</button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="tbx-stack tbx-stack--loose" style={{ position: 'sticky', top: 76 }}>
            {kind === 'BUZZER' && (
              <section className="tbx-panel tbx-stack">
                <h2 className="tbx-h2">진행 설정</h2>
                <Toggle checked={withBoard} onChange={setWithBoard} title="점수판 함께 만들기" hint="정답 판정 때 문제 배점이 점수판에 더해져요" />
                <div className="tbx-row tbx-row--between"><span className="tbx-h3">첫 문제 배점</span><Stepper value={points} min={1} max={100000} onChange={setPoints} suffix="점" label="첫 문제 배점" /></div>
                <Toggle checked={closeOnFirst} onChange={setCloseOnFirst} title="첫 입력만 받고 바로 닫기" hint="끄면 모든 참가자의 순서를 받아요" />
                <Toggle checked={showFalse} onChange={setShowFalse} title="중계 화면에 부정출발 표시" hint="라운드 전에 누른 학생은 5초 동안 잠겨요" />
              </section>
            )}
            {(kind === 'SCOREBOARD') && (
              <section className="tbx-panel tbx-stack">
                <h2 className="tbx-h2">보이는 방식</h2>
                <Seg block value={sort} onChange={setSort} options={[{ value: 'FIXED', label: '팀 자리 고정' }, { value: 'SCORE', label: '점수순 정렬' }]} label="정렬" />
                <p className="tbx-small">자리를 고정하면 점수가 바뀌어도 팀 위치가 그대로라 잘못 누를 일이 줄어요.</p>
                <Toggle checked={share} onChange={setShare} title="학생 화면에 점수판 보이기" />
              </section>
            )}
            {kind === 'TOURNAMENT' && units.length >= 2 && (
              <section className="tbx-panel tbx-stack">
                <div className="tbx-row tbx-row--between">
                  <h2 className="tbx-h2">대진 미리 보기</h2>
                  <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => { setSlots(seedSlots(shuffle(units.map((u) => u.key)))); setSwapFrom(null); }}>무작위로 섞기</button>
                </div>
                <p className="tbx-small">{currentSlots.length}강 · 부전승 {currentSlots.filter((s) => s === null).length}개 · {roundName(1, Math.log2(currentSlots.length))}부터</p>
                <p className="tbx-small">칸 두 개를 차례로 누르면 자리를 바꿔요.</p>
                <div className="tbx-stack tbx-stack--tight">
                  {Array.from({ length: currentSlots.length / 2 }).map((_, m) => (
                    <div key={m} className="tbx-match">
                      {[2 * m, 2 * m + 1].map((i) => {
                        const k = currentSlots[i];
                        const u = units.find((x) => x.key === k);
                        return (
                          <button key={i} type="button" className="tbx-match__side" data-empty={!k}
                            style={{ width: '100%', background: swapFrom === i ? 'rgba(228,188,114,.2)' : 'transparent', border: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                            onClick={() => {
                              if (swapFrom === null) { setSwapFrom(i); return; }
                              const next = currentSlots.slice(); [next[swapFrom], next[i]] = [next[i], next[swapFrom]];
                              const pairOk = Array.from({ length: next.length / 2 }).every((__, j) => next[2 * j] !== null || next[2 * j + 1] !== null);
                              if (pairOk) setSlots(next);
                              setSwapFrom(null);
                            }}>
                            {u && <span className="tbx-dot" style={{ background: u.color ?? '#e4bc72' }} />}{u?.label ?? '부전승'}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <Toggle checked={thirdPlace} onChange={setThirdPlace} title="3위 결정전" disabled={currentSlots.length < 4} />
                <Toggle checked={share} onChange={setShare} title="학생 화면에 대진표 보이기" />
                <details><summary className="tbx-small" style={{ cursor: 'pointer' }}>전체 대진 모양 보기</summary><BracketView state={bracketPreview} units={units} /></details>
              </section>
            )}
            <section className="tbx-panel tbx-stack">
              {(kind === 'VOTE' || kind === 'CARDS' || kind === 'SCOREBOARD') && (
                <Toggle checked={openNow} onChange={setOpenNow} title="만들자마자 학생에게 열기" hint={openNow ? '바로 학생 화면에 나타나요' : '운영 화면에서 ‘시작’을 눌러야 학생에게 보여요'} />
              )}
              {problems.length > 0 && <Notice tone="ember" icon="✋">{problems[0]}</Notice>}
              <InlineError error={error} />
              <button type="button" className="tbx-btn tbx-btn--brass tbx-btn--xl tbx-btn--block" disabled={problems.length > 0 || busy !== null} onClick={() => void create()}>
                {busy ? '만드는 중…' : (kind === 'VOTE' || kind === 'CARDS' || kind === 'SCOREBOARD') && !openNow ? '만들어 두기' : '만들고 시작하기'}
              </button>
            </section>
          </div>
        </div>
      </div>
    </TeacherShell>
  );
}
