import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  calculateMvpFoundationData,
  createMvpFoundationSession,
  finalizeMvpFoundationSession,
  getMvpFoundationSession,
  getMvpFoundationStudentDetail,
  listMvpFoundationSessions,
  saveMvpFoundationInput,
  updateMvpFoundationSession,
  type MvpFoundationBoard,
  type MvpFoundationGrade,
  type MvpFoundationInputState,
  type MvpFoundationStudentDetail,
  type MvpFoundationStudentRow,
} from '@/lib/rpc/mvp_foundation_rpc';

const GRADES: readonly MvpFoundationGrade[] = ['S+', 'S', 'A+', 'A', 'B'];

type SortKey =
  | 'bv'
  | 'growth'
  | 'dailyQuest'
  | 'achievementCount'
  | 'achievementScore'
  | 'guildScore'
  | 'contribution'
  | 'donation'
  | 'serviceSales';

type SettingsState = {
  title: string;
  evaluationStart: string;
  evaluationEnd: string;
  comparisonStart: string;
  comparisonEnd: string;
};

function dateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function defaultNewSession(): SettingsState {
  const now = new Date();
  const evalStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const evalEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const compareStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const compareEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    title: `${now.getFullYear()}년 ${now.getMonth() + 1}월 MVP 예선`,
    evaluationStart: dateInputValue(evalStart),
    evaluationEnd: dateInputValue(evalEnd),
    comparisonStart: dateInputValue(compareStart),
    comparisonEnd: dateInputValue(compareEnd),
  };
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('ko-KR');
}

function formatDecimal(value: number): string {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) return String((error as { message?: unknown }).message ?? '오류가 발생했습니다.');
  return String(error ?? '오류가 발생했습니다.');
}

function inputFromRow(row: MvpFoundationStudentRow): MvpFoundationInputState {
  return {
    is_preliminary_candidate: row.is_preliminary_candidate,
    preparation_responsibility_grade: row.preparation_responsibility_grade,
    participation_listening_grade: row.participation_listening_grade,
    assignment_performance_grade: row.assignment_performance_grade,
    improvement_growth_grade: row.improvement_growth_grade,
    notes: row.notes,
  };
}

function evaluationComplete(row: MvpFoundationStudentRow): boolean {
  return Boolean(
    row.preparation_responsibility_grade
    && row.participation_listening_grade
    && row.assignment_performance_grade
    && row.improvement_growth_grade,
  );
}

export default function MvpFoundationAdmin() {
  const queryClient = useQueryClient();
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<SettingsState>(() => defaultNewSession());
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'CANDIDATES'>('ALL');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('bv');
  const [sortDesc, setSortDesc] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [assessmentStudent, setAssessmentStudent] = useState<MvpFoundationStudentRow | null>(null);
  const [detailStudent, setDetailStudent] = useState<MvpFoundationStudentRow | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ['mvp-foundation-sessions'],
    queryFn: () => listMvpFoundationSessions(supabase),
  });

  useEffect(() => {
    if (selectedSessionId !== null) return;
    const first = sessionsQuery.data?.[0];
    if (first) setSelectedSessionId(first.id);
  }, [selectedSessionId, sessionsQuery.data]);

  const boardQuery = useQuery({
    queryKey: ['mvp-foundation-board', selectedSessionId],
    queryFn: () => getMvpFoundationSession(supabase, selectedSessionId as number),
    enabled: selectedSessionId !== null,
  });

  const board = boardQuery.data;
  const isDraft = board?.session.status === 'DRAFT';

  useEffect(() => {
    if (!board?.session) return;
    setSettings({
      title: board.session.title,
      evaluationStart: board.session.evaluation_start_date,
      evaluationEnd: board.session.evaluation_end_date,
      comparisonStart: board.session.comparison_start_date,
      comparisonEnd: board.session.comparison_end_date,
    });
  }, [board?.session.id, board?.session.updated_at]);

  const visibleStudents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    const rows = (board?.students ?? []).filter((row) => {
      if (filter === 'CANDIDATES' && !row.is_preliminary_candidate) return false;
      return !needle || row.student_name.toLocaleLowerCase('ko-KR').includes(needle) || (row.brand_name ?? '').toLocaleLowerCase('ko-KR').includes(needle);
    });
    const getValue = (row: MvpFoundationStudentRow): number => {
      if (sortKey === 'growth') return row.bv_growth_rate ?? -Infinity;
      if (sortKey === 'dailyQuest') return row.daily_quest_completion_rate ?? -Infinity;
      if (sortKey === 'achievementCount') return row.achievement_count;
      if (sortKey === 'achievementScore') return row.achievement_score;
      if (sortKey === 'guildScore') return row.guild_score;
      if (sortKey === 'contribution') return row.personal_contribution_score;
      if (sortKey === 'donation') return row.donation_gold;
      if (sortKey === 'serviceSales') return row.secondary_job_sales_completed;
      return row.evaluation_bv_earned;
    };
    return [...rows].sort((a, b) => {
      const diff = getValue(a) - getValue(b);
      if (diff !== 0) return diff * (sortDesc ? -1 : 1);
      return a.student_name.localeCompare(b.student_name, 'ko');
    });
  }, [board?.students, filter, search, sortKey, sortDesc]);

  const candidateCount = board?.candidate_count ?? 0;
  const evaluatedCount = useMemo(() => (board?.students ?? []).filter(evaluationComplete).length, [board?.students]);
  const canFinalize = Boolean(isDraft && board?.calculated && candidateCount === 12 && evaluatedCount === (board?.students.length ?? 0) && (board?.students.length ?? 0) > 0);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['mvp-foundation-sessions'] }),
      queryClient.invalidateQueries({ queryKey: ['mvp-foundation-board', selectedSessionId] }),
    ]);
  };

  const run = async (key: string, work: () => Promise<void>, success?: string) => {
    if (busy) return;
    setBusy(key); setMessage(null);
    try {
      await work();
      if (success) setMessage({ type: 'success', text: success });
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleCreate = () => run('create', async () => {
    const id = await createMvpFoundationSession(supabase, {
      title: createForm.title,
      evaluationStart: createForm.evaluationStart,
      evaluationEnd: createForm.evaluationEnd,
      comparisonStart: createForm.comparisonStart,
      comparisonEnd: createForm.comparisonEnd,
    });
    setSelectedSessionId(id);
    setShowCreate(false);
    setCreateForm(defaultNewSession());
    await queryClient.invalidateQueries({ queryKey: ['mvp-foundation-sessions'] });
  }, '새 MVP 회차를 만들었습니다. 기간을 확인한 뒤 데이터를 계산해주세요.');

  const saveSettings = async () => {
    if (!selectedSessionId || !settings) return;
    await updateMvpFoundationSession(supabase, {
      sessionId: selectedSessionId,
      title: settings.title,
      evaluationStart: settings.evaluationStart,
      evaluationEnd: settings.evaluationEnd,
      comparisonStart: settings.comparisonStart,
      comparisonEnd: settings.comparisonEnd,
    });
  };

  const handleSaveSettings = () => run('settings', async () => {
    await saveSettings();
    await invalidate();
  }, '회차 설정을 저장했습니다.');

  const handleCalculate = () => run('calculate', async () => {
    if (!selectedSessionId) return;
    await saveSettings();
    await calculateMvpFoundationData(supabase, selectedSessionId);
    await invalidate();
  }, board?.calculated ? '최신 원본 데이터로 다시 계산했습니다. 교사 입력은 유지됩니다.' : 'MVP 기초 데이터를 계산했습니다.');

  const saveRowInput = async (row: MvpFoundationStudentRow, next: MvpFoundationInputState) => {
    if (!selectedSessionId) return;
    await saveMvpFoundationInput(supabase, { sessionId: selectedSessionId, studentId: row.student_id, ...next });
    await invalidate();
  };

  const handleCandidate = (row: MvpFoundationStudentRow) => run(`candidate-${row.student_id}`, async () => {
    if (!row.is_preliminary_candidate && candidateCount >= 12) throw new Error('예선 후보는 최대 12명입니다. 기존 후보를 한 명 해제한 뒤 선택해주세요.');
    await saveRowInput(row, { ...inputFromRow(row), is_preliminary_candidate: !row.is_preliminary_candidate });
  });

  const handleFinalize = () => {
    if (!selectedSessionId || !board) return;
    if (!canFinalize) {
      setMessage({ type: 'error', text: `확정 조건을 확인해주세요. 후보 ${candidateCount}/12 · 수업평가 ${evaluatedCount}/${board.students.length}` });
      return;
    }
    const ok = window.confirm(
      `${board.session.title} 기초 데이터를 확정할까요?\n\n평가기간: ${board.session.evaluation_start_date} ~ ${board.session.evaluation_end_date}\n비교기간: ${board.session.comparison_start_date} ~ ${board.session.comparison_end_date}\n예선 진출: 12명\n\n확정 후 통계·후보·수업평가·비고를 수정하거나 다시 계산할 수 없습니다.`,
    );
    if (!ok) return;
    void run('finalize', async () => {
      await finalizeMvpFoundationSession(supabase, selectedSessionId);
      await invalidate();
    }, 'MVP 기초 데이터가 확정되었습니다. 이 회차는 불변 스냅샷으로 보존됩니다.');
  };

  return (
    <TeacherShell>
      <div className="space-y-4">
        <Header onCreate={() => { setCreateForm(defaultNewSession()); setShowCreate(true); }} />

        {message && <MessageBox type={message.type}>{message.text}</MessageBox>}
        {sessionsQuery.isError && <MessageBox type="error">회차 목록을 불러오지 못했습니다: {errorMessage(sessionsQuery.error)}</MessageBox>}

        <section className="rounded-card-lg border border-line bg-bg-card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="MVP 회차">
              <select
                className="h-10 min-w-[260px] rounded-card-md border border-line bg-bg-deep px-3 text-sm font-bold text-white"
                value={selectedSessionId ?? ''}
                onChange={(e) => setSelectedSessionId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">회차를 선택하세요</option>
                {(sessionsQuery.data ?? []).map((session) => (
                  <option key={session.id} value={session.id}>{session.status === 'FINALIZED' ? '🔒' : '📝'} {session.title}</option>
                ))}
              </select>
            </Field>
            {board && <StatusBadge status={board.session.status} />}
            {board && <div className="ml-auto text-right text-2xs font-bold text-text-muted">마지막 계산 {formatDateTime(board.session.last_calculated_at)}</div>}
          </div>
        </section>

        {selectedSessionId === null && !sessionsQuery.isLoading && (
          <EmptyState title="첫 MVP 회차를 만들어주세요." description="평가기간과 비교기간을 지정하면 24명의 기초 데이터를 한 번에 계산할 수 있습니다." onCreate={() => setShowCreate(true)} />
        )}

        {boardQuery.isLoading && <LoadingSpinner />}
        {boardQuery.isError && <MessageBox type="error">회차 데이터를 불러오지 못했습니다: {errorMessage(boardQuery.error)}</MessageBox>}

        {board && settings && (
          <>
            <SessionSettings
              value={settings}
              onChange={setSettings}
              readOnly={!isDraft}
              calculated={board.calculated}
              busy={busy}
              onSave={handleSaveSettings}
              onCalculate={handleCalculate}
            />

            <ProgressStrip
              candidateCount={candidateCount}
              evaluatedCount={evaluatedCount}
              studentCount={board.students.length}
              status={board.session.status}
            />

            {board.summary.personal_contribution_warning && (
              <div className="rounded-card-md border border-warning/25 bg-warning/5 px-3 py-2 text-2xs font-bold text-text-secondary">
                ℹ️ {board.summary.personal_contribution_warning}
              </div>
            )}

            {!board.calculated ? (
              <EmptyState title="아직 자동 통계를 계산하지 않았습니다." description="평가기간과 비교기간을 확인하고 ‘데이터 계산’을 눌러주세요." onCreate={isDraft ? handleCalculate : undefined} actionLabel="데이터 계산" />
            ) : (
              <section className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                  <div>
                    <h2 className="font-display text-base text-white">학생별 MVP 기초 데이터</h2>
                    <p className="text-2xs font-bold text-text-muted">기본 정렬은 평가기간 획득 BV입니다. 종합 MVP 점수는 자동 계산하지 않습니다.</p>
                  </div>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <button type="button" onClick={() => setFilter('ALL')} className={filter === 'ALL' ? 'btn-primary h-9 px-3 text-xs' : 'h-9 rounded-card-md border border-line px-3 text-xs font-black text-text-secondary'}>전체 {board.students.length}</button>
                    <button type="button" onClick={() => setFilter('CANDIDATES')} className={filter === 'CANDIDATES' ? 'btn-primary h-9 px-3 text-xs' : 'h-9 rounded-card-md border border-line px-3 text-xs font-black text-text-secondary'}>예선 진출 {candidateCount}</button>
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="학생 검색" className="h-9 w-28 rounded-card-md border border-line bg-bg-deep px-2 text-xs font-bold text-white" />
                    <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="h-9 rounded-card-md border border-line bg-bg-deep px-2 text-xs font-bold text-white">
                      <option value="bv">획득 BV</option><option value="growth">BV 성장률</option><option value="dailyQuest">일일퀘</option><option value="achievementCount">업적 수</option><option value="achievementScore">업적 점수</option><option value="guildScore">길드 점수</option><option value="contribution">개인 기여도</option><option value="donation">기부량</option><option value="serviceSales">서비스 판매</option>
                    </select>
                    <button type="button" onClick={() => setSortDesc((v) => !v)} className="h-9 rounded-card-md border border-line px-3 text-xs font-black text-text-secondary">{sortDesc ? '↓' : '↑'}</button>
                  </div>
                </div>
                <MvpTable
                  rows={visibleStudents}
                  isDraft={Boolean(isDraft)}
                  busy={busy}
                  onCandidate={handleCandidate}
                  onAssessment={setAssessmentStudent}
                  onDetail={setDetailStudent}
                />
              </section>
            )}

            <section className="flex flex-wrap items-center justify-between gap-3 rounded-card-lg border border-line-brand/35 bg-bg-card p-4">
              <div>
                <h3 className="font-display text-sm text-white">{isDraft ? '최종 확정' : '확정 스냅샷'}</h3>
                <p className="mt-1 text-2xs font-bold text-text-muted">
                  {isDraft ? `예선 후보 12명 + 4개 수업평가 ${board.students.length}명 전체 입력 후 확정할 수 있습니다.` : `확정일 ${formatDateTime(board.session.finalized_at)} · 원본 데이터가 바뀌어도 이 기록은 변하지 않습니다.`}
                </p>
              </div>
              {isDraft && (
                <button type="button" disabled={!canFinalize || Boolean(busy)} onClick={handleFinalize} className="btn-primary disabled:cursor-not-allowed disabled:opacity-40">
                  {busy === 'finalize' ? '확정 중…' : '🔒 MVP 기초 데이터 확정'}
                </button>
              )}
            </section>
          </>
        )}
      </div>

      {showCreate && <CreateSessionModal value={createForm} onChange={setCreateForm} busy={busy === 'create'} onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
      {assessmentStudent && board && <AssessmentModal row={assessmentStudent} readOnly={!isDraft} busy={Boolean(busy)} onClose={() => setAssessmentStudent(null)} onSave={async (input) => {
        await run(`assessment-${assessmentStudent.student_id}`, async () => {
          await saveRowInput(assessmentStudent, input);
          setAssessmentStudent(null);
        }, `${assessmentStudent.student_name} 학생의 수업평가를 저장했습니다.`);
      }} />}
      {detailStudent && selectedSessionId && <StudentDetailModal sessionId={selectedSessionId} row={detailStudent} onClose={() => setDetailStudent(null)} />}
    </TeacherShell>
  );
}

function Header({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="rounded-card-lg border border-line bg-bg-card/80 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-card-md border border-line-brand/40 bg-brand-primary/15 text-2xl">👑</div>
          <div><h1 className="font-display text-xl tracking-tight text-brand-gradient">MVP 기초 데이터</h1><p className="text-2xs font-bold text-text-muted">월간 MVP 예선 12인 선정을 위한 정량 통계 + 교사 정성평가 기록실</p></div>
        </div>
        <button type="button" onClick={onCreate} className="btn-primary">＋ 새 MVP 회차</button>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: 'DRAFT' | 'FINALIZED' }) {
  return status === 'FINALIZED'
    ? <span className="rounded-pill border border-success/35 bg-success/10 px-3 py-1.5 text-xs font-black text-success">🔒 확정</span>
    : <span className="rounded-pill border border-warning/35 bg-warning/10 px-3 py-1.5 text-xs font-black text-warning">📝 초안</span>;
}

function SessionSettings({ value, onChange, readOnly, calculated, busy, onSave, onCalculate }: {
  value: SettingsState; onChange: (next: SettingsState) => void; readOnly: boolean; calculated: boolean; busy: string | null; onSave: () => void; onCalculate: () => void;
}) {
  return (
    <section className="rounded-card-lg border border-line bg-bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-display text-sm text-white">회차와 기간 설정</h2><p className="text-2xs font-bold text-text-muted">두 기간은 KST 날짜 기준이며 서로 독립적으로 지정합니다.</p></div>{readOnly && <span className="text-2xs font-black text-text-muted">확정 회차 · 읽기 전용</span>}</div>
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto]">
        <Field label="회차명"><input disabled={readOnly} value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} className="h-10 w-full rounded-card-md border border-line bg-bg-deep px-3 text-xs font-bold text-white disabled:opacity-60" /></Field>
        <Field label="평가 시작"><input disabled={readOnly} type="date" value={value.evaluationStart} onChange={(e) => onChange({ ...value, evaluationStart: e.target.value })} className="h-10 w-full rounded-card-md border border-line bg-bg-deep px-2 text-xs font-bold text-white disabled:opacity-60" /></Field>
        <Field label="평가 종료"><input disabled={readOnly} type="date" value={value.evaluationEnd} onChange={(e) => onChange({ ...value, evaluationEnd: e.target.value })} className="h-10 w-full rounded-card-md border border-line bg-bg-deep px-2 text-xs font-bold text-white disabled:opacity-60" /></Field>
        <Field label="비교 시작"><input disabled={readOnly} type="date" value={value.comparisonStart} onChange={(e) => onChange({ ...value, comparisonStart: e.target.value })} className="h-10 w-full rounded-card-md border border-line bg-bg-deep px-2 text-xs font-bold text-white disabled:opacity-60" /></Field>
        <Field label="비교 종료"><input disabled={readOnly} type="date" value={value.comparisonEnd} onChange={(e) => onChange({ ...value, comparisonEnd: e.target.value })} className="h-10 w-full rounded-card-md border border-line bg-bg-deep px-2 text-xs font-bold text-white disabled:opacity-60" /></Field>
        {!readOnly && <div className="flex items-end gap-2"><button type="button" onClick={onSave} disabled={Boolean(busy)} className="h-10 rounded-card-md border border-line px-3 text-xs font-black text-text-secondary disabled:opacity-50">저장</button><button type="button" onClick={onCalculate} disabled={Boolean(busy)} className="btn-primary h-10 whitespace-nowrap disabled:opacity-50">{busy === 'calculate' ? '계산 중…' : calculated ? '↻ 다시 계산' : '데이터 계산'}</button></div>}
      </div>
    </section>
  );
}

function ProgressStrip({ candidateCount, evaluatedCount, studentCount, status }: { candidateCount: number; evaluatedCount: number; studentCount: number; status: 'DRAFT' | 'FINALIZED' }) {
  return (
    <section className="grid gap-2 sm:grid-cols-3">
      <MetricCard icon="🏁" label="예선 진출 후보" value={`${candidateCount} / 12`} good={candidateCount === 12} />
      <MetricCard icon="📝" label="수업평가 완료" value={`${evaluatedCount} / ${studentCount}`} good={studentCount > 0 && evaluatedCount === studentCount} />
      <MetricCard icon={status === 'FINALIZED' ? '🔒' : '🧮'} label="기록 상태" value={status === 'FINALIZED' ? '확정 스냅샷' : '초안 · 재계산 가능'} good={status === 'FINALIZED'} />
    </section>
  );
}

function MetricCard({ icon, label, value, good }: { icon: string; label: string; value: string; good?: boolean }) {
  return <div className={`rounded-card-md border p-3 ${good ? 'border-success/35 bg-success/5' : 'border-line bg-bg-card'}`}><div className="text-2xs font-black text-text-muted">{icon} {label}</div><div className={`mt-1 text-lg font-black ${good ? 'text-success' : 'text-white'}`}>{value}</div></div>;
}

function MvpTable({ rows, isDraft, busy, onCandidate, onAssessment, onDetail }: {
  rows: MvpFoundationStudentRow[]; isDraft: boolean; busy: string | null; onCandidate: (row: MvpFoundationStudentRow) => void; onAssessment: (row: MvpFoundationStudentRow) => void; onDetail: (row: MvpFoundationStudentRow) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1460px] w-full text-left">
        <thead className="bg-bg-deep/80 text-[10px] font-black text-text-muted"><tr>
          <th className="px-3 py-2">예선</th><th className="px-3 py-2">학생</th><th className="px-3 py-2 text-right">획득 BV</th><th className="px-3 py-2 text-right">성장률</th><th className="px-3 py-2 text-right">일일퀘</th><th className="px-3 py-2 text-right">업적</th><th className="px-3 py-2 text-right">업적점수</th><th className="px-3 py-2 text-right">길드점수</th><th className="px-3 py-2 text-right">개인기여도*</th><th className="px-3 py-2 text-right">기부</th><th className="px-3 py-2 text-right">서비스</th><th className="px-3 py-2">수업평가</th><th className="px-3 py-2">비고</th><th className="px-3 py-2">근거</th>
        </tr></thead>
        <tbody className="divide-y divide-line/70">
          {rows.map((row) => (
            <tr key={row.student_id} className={row.is_preliminary_candidate ? 'bg-gold/5' : 'hover:bg-bg-deep/30'}>
              <td className="px-3 py-3"><button type="button" disabled={!isDraft || Boolean(busy)} onClick={() => onCandidate(row)} className={`h-7 rounded-pill border px-2 text-[10px] font-black ${row.is_preliminary_candidate ? 'border-gold bg-gold/15 text-gold' : 'border-line text-text-muted'} disabled:cursor-not-allowed disabled:opacity-60`}>{row.is_preliminary_candidate ? '✓ 후보' : '+ 후보'}</button></td>
              <td className="px-3 py-3"><div className="font-black text-white">{row.student_name}</div><div className="mt-0.5 text-[9px] font-bold text-text-muted">{row.guild_name ?? '길드 없음'}{row.brand_name ? ` · ${row.brand_name}` : ''}</div></td>
              <td className="px-3 py-3 text-right font-mono text-sm font-black text-brand-secondary">+{formatNumber(row.evaluation_bv_earned)}</td>
              <td className="px-3 py-3 text-right"><Growth row={row} /></td>
              <td className="px-3 py-3 text-right"><div className="font-black text-white">{row.daily_quest_completion_rate == null ? '-' : `${row.daily_quest_completion_rate.toFixed(1)}%`}</div><div className="text-[9px] font-bold text-text-muted">{row.daily_quest_completed_days}/{row.daily_quest_target_days}일</div></td>
              <td className="px-3 py-3 text-right"><button type="button" onClick={() => onDetail(row)} className="font-black text-white hover:text-gold">{row.achievement_count}개 ›</button></td>
              <td className="px-3 py-3 text-right font-black text-white">{formatNumber(row.achievement_score)}</td>
              <td className="px-3 py-3 text-right font-black text-white">{formatDecimal(row.guild_score)}</td>
              <td className="px-3 py-3 text-right"><div className="font-black text-white">{formatDecimal(row.personal_contribution_score)}</div><div className="text-[8px] font-bold text-warning">월 집계</div></td>
              <td className="px-3 py-3 text-right font-black text-white">{formatNumber(row.donation_gold)}</td>
              <td className="px-3 py-3 text-right font-black text-white">{row.secondary_job_sales_completed}건</td>
              <td className="px-3 py-3"><button type="button" onClick={() => onAssessment(row)} className={`rounded-card-md border px-2.5 py-1.5 text-[10px] font-black ${evaluationComplete(row) ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`}>{evaluationComplete(row) ? `${row.preparation_responsibility_grade} · ${row.participation_listening_grade} · ${row.assignment_performance_grade} · ${row.improvement_growth_grade}` : '평가 입력'}</button></td>
              <td className="max-w-[180px] px-3 py-3 text-[10px] font-bold text-text-secondary"><div className="line-clamp-2">{row.notes || '-'}</div></td>
              <td className="px-3 py-3"><button type="button" onClick={() => onDetail(row)} className="rounded-card-md border border-line px-2 py-1 text-[10px] font-black text-text-secondary hover:text-white">상세 ›</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="p-8 text-center text-xs font-bold text-text-muted">조건에 맞는 학생이 없습니다.</div>}
      <div className="border-t border-line px-4 py-2 text-[9px] font-bold text-text-muted">* 개인 기여도는 시스템의 공식 월 단위 집계값입니다. 임의의 날짜별 점수로 쪼개지 않습니다.</div>
    </div>
  );
}

function Growth({ row }: { row: MvpFoundationStudentRow }) {
  if (row.bv_growth_status === 'NEW') return <span className="font-black text-brand-secondary">NEW</span>;
  const value = row.bv_growth_rate ?? 0;
  return <span className={`font-mono text-xs font-black ${value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-text-secondary'}`}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
}

function AssessmentModal({ row, readOnly, busy, onClose, onSave }: {
  row: MvpFoundationStudentRow; readOnly: boolean; busy: boolean; onClose: () => void; onSave: (input: MvpFoundationInputState) => Promise<void>;
}) {
  const [form, setForm] = useState<MvpFoundationInputState>(() => inputFromRow(row));
  const allFilled = Boolean(form.preparation_responsibility_grade && form.participation_listening_grade && form.assignment_performance_grade && form.improvement_growth_grade);
  return (
    <ModalShell title={`${row.student_name} · 수업 참여 평가`} subtitle="숫자로 환산하지 않는 교사 정성평가입니다." onClose={onClose}>
      <div className="space-y-4">
        <GradeField label="수업준비와 책임" value={form.preparation_responsibility_grade} onChange={(v) => setForm({ ...form, preparation_responsibility_grade: v })} readOnly={readOnly} />
        <GradeField label="참여와 경청" value={form.participation_listening_grade} onChange={(v) => setForm({ ...form, participation_listening_grade: v })} readOnly={readOnly} />
        <GradeField label="과제 수행" value={form.assignment_performance_grade} onChange={(v) => setForm({ ...form, assignment_performance_grade: v })} readOnly={readOnly} />
        <GradeField label="개선과 성장" value={form.improvement_growth_grade} onChange={(v) => setForm({ ...form, improvement_growth_grade: v })} readOnly={readOnly} />
        <Field label="특이사항 / 비고"><textarea disabled={readOnly} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={2000} rows={5} placeholder="정량 데이터로 드러나지 않는 성장, 태도, 책임감 등을 기록하세요." className="w-full resize-y rounded-card-md border border-line bg-bg-deep p-3 text-xs font-bold leading-relaxed text-white disabled:opacity-60" /><div className="mt-1 text-right text-[9px] font-bold text-text-muted">{(form.notes ?? '').length}/2000</div></Field>
        {!readOnly && <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="h-9 rounded-card-md border border-line px-4 text-xs font-black text-text-secondary">취소</button><button type="button" disabled={!allFilled || busy} onClick={() => void onSave(form)} className="btn-primary h-9 disabled:opacity-40">{busy ? '저장 중…' : '평가 저장'}</button></div>}
      </div>
    </ModalShell>
  );
}

function GradeField({ label, value, onChange, readOnly }: { label: string; value: MvpFoundationGrade | null; onChange: (value: MvpFoundationGrade) => void; readOnly: boolean }) {
  return <div><div className="mb-2 text-xs font-black text-text-secondary">{label}</div><div className="grid grid-cols-5 gap-2">{GRADES.map((grade) => <button key={grade} type="button" disabled={readOnly} onClick={() => onChange(grade)} className={`h-10 rounded-card-md border text-sm font-black transition ${value === grade ? 'border-gold bg-gold/15 text-gold' : 'border-line bg-bg-deep text-text-secondary hover:text-white'} disabled:cursor-default`}>{grade}</button>)}</div></div>;
}

function StudentDetailModal({ sessionId, row, onClose }: { sessionId: number; row: MvpFoundationStudentRow; onClose: () => void }) {
  const query = useQuery({ queryKey: ['mvp-foundation-detail', sessionId, row.student_id], queryFn: () => getMvpFoundationStudentDetail(supabase, sessionId, row.student_id) });
  return <ModalShell title={`${row.student_name} · 데이터 근거`} subtitle="메인 통계가 어떤 공식 기록에서 계산됐는지 확인합니다." onClose={onClose} wide>
    {query.isLoading ? <LoadingSpinner /> : query.isError ? <MessageBox type="error">상세 데이터를 불러오지 못했습니다: {errorMessage(query.error)}</MessageBox> : query.data ? <StudentDetail detail={query.data} /> : null}
  </ModalShell>;
}

function StudentDetail({ detail }: { detail: MvpFoundationStudentDetail }) {
  const s = detail.student;
  const ev = detail.evidence;
  const achievements = Array.isArray(ev.achievements) ? ev.achievements : [];
  const dqDays = Array.isArray(ev.daily_quest?.days) ? ev.daily_quest?.days ?? [] : [];
  const donations = Array.isArray(ev.donations) ? ev.donations : [];
  const services = Array.isArray(ev.services) ? ev.services : [];
  const contributionRows = Array.isArray(ev.personal_contribution?.rows) ? ev.personal_contribution?.rows ?? [] : [];
  const guildRows = Array.isArray(ev.guild_score?.guilds) ? ev.guild_score?.guilds ?? [] : [];
  const bvEvents = Array.isArray(ev.bv?.evaluation_events) ? ev.bv?.evaluation_events ?? [] : [];
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4"><MiniStat label="획득 BV" value={`+${formatNumber(s.evaluation_bv_earned)}`} /><MiniStat label="차감 BV" value={`-${formatNumber(s.evaluation_bv_deducted)}`} /><MiniStat label="순증 BV" value={`${s.evaluation_bv_net >= 0 ? '+' : ''}${formatNumber(s.evaluation_bv_net)}`} /><MiniStat label="비교기간 BV" value={`+${formatNumber(s.comparison_bv_earned)}`} /></div>
    <DetailSection title={`BV 변동 근거 · ${bvEvents.length}건`}><EvidenceList rows={bvEvents} render={(x) => `${dateShort(x.created_at)} · ${signed(x.amount)} BV · ${String(x.memo ?? x.source_type ?? '')}`} empty="해당 기간 BV 변동 기록이 없습니다." /></DetailSection>
    <DetailSection title={`일일퀘스트 · ${s.daily_quest_completed_days}/${s.daily_quest_target_days}일`}><EvidenceList rows={dqDays} render={(x) => `${String(x.date ?? '')} · ${Boolean(x.completed) ? '✓ 4종 완료' : `${String(x.pass_count ?? 0)}/4 완료`}`} empty="정산 완료된 일일퀘스트 대상일이 없습니다." /></DetailSection>
    <DetailSection title={`업적 · ${s.achievement_count}개 · ${formatNumber(s.achievement_score)}점`}><EvidenceList rows={achievements} render={(x) => `${dateShort(x.achieved_at)} · [${String(x.grade ?? '')}] ${String(x.name ?? '')} · ${String(x.score ?? 0)}점`} empty="평가기간 신규 업적이 없습니다." /></DetailSection>
    <div className="grid gap-4 md:grid-cols-2"><DetailSection title={`길드 점수 · ${formatDecimal(s.guild_score)}`}><EvidenceList rows={guildRows} render={(x) => `${String(x.guild_name ?? '길드')} · ${formatDecimal(Number(x.points ?? 0))}점 · ${String(x.event_count ?? 0)}개 이벤트`} empty="해당 기간 길드 점수 기록이 없습니다." /></DetailSection><DetailSection title={`개인 기여도 · ${formatDecimal(s.personal_contribution_score)} · 월 집계`}><EvidenceList rows={contributionRows} render={(x) => `${String(x.year_month ?? '')} · ${String(x.guild_name ?? '')} · 최종 ${formatDecimal(Number(x.final_total ?? 0))}`} empty="겹치는 월 공식 기여도 집계가 없습니다." /></DetailSection></div>
    <div className="grid gap-4 md:grid-cols-2"><DetailSection title={`기부 · ${formatNumber(s.donation_gold)} GOLD`}><EvidenceList rows={donations} render={(x) => `${dateShort(x.created_at)} · ${formatNumber(Number(x.amount ?? 0))} GOLD · ${String(x.memo ?? '')}`} empty="평가기간 기부가 없습니다." /></DetailSection><DetailSection title={`2차직업 서비스 판매 · ${s.secondary_job_sales_completed}건`}><EvidenceList rows={services} render={(x) => `${dateShort(x.completed_at)} · ${String(x.service_title ?? '')} → ${String(x.buyer_name ?? '구매자')} · ${formatNumber(Number(x.price_gold ?? 0))} GOLD`} empty="평가기간 완료된 서비스 판매가 없습니다." /></DetailSection></div>
  </div>;
}

function EvidenceList({ rows, render, empty }: { rows: Array<Record<string, unknown>>; render: (row: Record<string, unknown>) => string; empty: string }) {
  if (rows.length === 0) return <div className="text-[10px] font-bold text-text-muted">{empty}</div>;
  return <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">{rows.map((row, index) => <div key={index} className="rounded-card-md border border-line/70 bg-bg-deep/60 px-2.5 py-2 text-[10px] font-bold text-text-secondary">{render(row)}</div>)}</div>;
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-card-md border border-line bg-bg-card p-3"><h3 className="mb-2 text-xs font-black text-white">{title}</h3>{children}</section>; }
function MiniStat({ label, value }: { label: string; value: string }) { return <div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="text-[9px] font-black text-text-muted">{label}</div><div className="mt-1 font-mono text-sm font-black text-white">{value}</div></div>; }
function dateShort(value: unknown): string { if (!value) return '-'; const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' }).format(d); }
function signed(value: unknown): string { const n = Number(value ?? 0); return `${n > 0 ? '+' : ''}${formatNumber(n)}`; }

function CreateSessionModal({ value, onChange, busy, onClose, onCreate }: { value: SettingsState; onChange: (next: SettingsState) => void; busy: boolean; onClose: () => void; onCreate: () => void }) {
  return <ModalShell title="새 MVP 회차" subtitle="기간은 생성 후 DRAFT 상태에서도 수정할 수 있습니다." onClose={onClose}><div className="space-y-3">
    <Field label="회차명"><input value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} className="h-10 w-full rounded-card-md border border-line bg-bg-deep px-3 text-xs font-bold text-white" /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="평가 시작"><input type="date" value={value.evaluationStart} onChange={(e) => onChange({ ...value, evaluationStart: e.target.value })} className="h-10 w-full rounded-card-md border border-line bg-bg-deep px-2 text-xs font-bold text-white" /></Field><Field label="평가 종료"><input type="date" value={value.evaluationEnd} onChange={(e) => onChange({ ...value, evaluationEnd: e.target.value })} className="h-10 w-full rounded-card-md border border-line bg-bg-deep px-2 text-xs font-bold text-white" /></Field><Field label="비교 시작"><input type="date" value={value.comparisonStart} onChange={(e) => onChange({ ...value, comparisonStart: e.target.value })} className="h-10 w-full rounded-card-md border border-line bg-bg-deep px-2 text-xs font-bold text-white" /></Field><Field label="비교 종료"><input type="date" value={value.comparisonEnd} onChange={(e) => onChange({ ...value, comparisonEnd: e.target.value })} className="h-10 w-full rounded-card-md border border-line bg-bg-deep px-2 text-xs font-bold text-white" /></Field></div>
    <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className="h-9 rounded-card-md border border-line px-4 text-xs font-black text-text-secondary">취소</button><button type="button" disabled={busy || value.title.trim().length < 2} onClick={onCreate} className="btn-primary h-9 disabled:opacity-40">{busy ? '생성 중…' : '회차 만들기'}</button></div>
  </div></ModalShell>;
}

function ModalShell({ title, subtitle, onClose, wide, children }: { title: string; subtitle?: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}><div className={`max-h-[90vh] w-full overflow-y-auto rounded-card-lg border border-line bg-bg-base shadow-2xl ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}><div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-bg-base/95 px-5 py-4 backdrop-blur-card"><div><h2 className="font-display text-lg text-white">{title}</h2>{subtitle && <p className="mt-1 text-2xs font-bold text-text-muted">{subtitle}</p>}</div><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-card-md border border-line text-text-secondary hover:text-white">✕</button></div><div className="p-5">{children}</div></div></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="mb-1 block text-[10px] font-black text-text-muted">{label}</span>{children}</label>; }
function MessageBox({ type, children }: { type: 'success' | 'error'; children: ReactNode }) { return <div className={`rounded-card-md border px-4 py-3 text-xs font-bold ${type === 'success' ? 'border-success/35 bg-success/10 text-success' : 'border-danger/35 bg-danger/10 text-danger'}`}>{children}</div>; }
function EmptyState({ title, description, onCreate, actionLabel = '새 회차 만들기' }: { title: string; description: string; onCreate?: () => void; actionLabel?: string }) { return <section className="rounded-card-lg border border-dashed border-line bg-bg-card/60 p-10 text-center"><div className="text-3xl">📊</div><h2 className="mt-3 font-display text-base text-white">{title}</h2><p className="mx-auto mt-2 max-w-xl text-xs font-bold text-text-muted">{description}</p>{onCreate && <button type="button" onClick={onCreate} className="btn-primary mt-5">{actionLabel}</button>}</section>; }
