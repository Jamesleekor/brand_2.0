import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { LoadingSpinner } from '@/components/shared/components';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { arcadeErrorMessage, arcadeTeacherRpc, type ArcadePrereleaseTestLeaderboardResult, type ArcadeVerificationOverview, type ArcadeVerificationOverviewRow } from '@/lib/rpc/arcade_rpc';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { useToastStore } from '@/stores/ui_store';

type PeriodKind = 'MONTHLY' | 'SEASON';
type PeriodStatus = 'DRAFT' | 'ACTIVE' | 'VERIFICATION' | 'READY_TO_FINALIZE' | 'FINALIZED';

interface PeriodRow {
  id: number;
  period_kind: PeriodKind;
  display_name: string;
  guild_season_id: number | null;
  contribution_year_month: string | null;
  starts_at: string;
  ends_at_exclusive: string;
  status: PeriodStatus;
}

interface SeasonRow { id: number; display_name: string; starts_on: string; ends_on: string; }
interface StudentRow { id: number; name: string; brand_name: string | null; role: string; transferred_at: string | null; }
interface PrereleaseTestAccessRow { access_id: number; student_id: number; student_name: string; student_brand_name: string | null; is_enabled: boolean; updated_at: string; }
interface AuditRow { run_id: number; student_name: string; status: string; is_prerelease_test: boolean; official_score: number | null; official_duration_ms: number | null; game_over_at: string | null; submitted_at: string | null; event_at: string; rejection_code: string | null; rejection_reason: string | null; invalidated: boolean; invalidation_reason: string | null; }

export default function TeacherArcadePage() {
  const classroomId = useClassroomId();
  const client = useQueryClient();
  const show = useToastStore((state) => state.show);
  const [kind, setKind] = useState<PeriodKind>('MONTHLY');
  const [displayName, setDisplayName] = useState('2026년 8월 Arcade');
  const [yearMonth, setYearMonth] = useState(koreaDateString().slice(0, 7));
  const [seasonId, setSeasonId] = useState('');
  const [startsAt, setStartsAt] = useState(`${koreaDateString()}T00:00`);
  const [endsAt, setEndsAt] = useState(`${nextMonthStart(koreaDateString().slice(0, 7))}T00:00`);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [auditPeriodId, setAuditPeriodId] = useState<number | null>(null);
  const [auditRows, setAuditRows] = useState<AuditRow[] | null>(null);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [prereleaseTestLeaderboard, setPrereleaseTestLeaderboard] = useState<ArcadePrereleaseTestLeaderboardResult | null>(null);
  const [isLoadingPrereleaseTestLeaderboard, setIsLoadingPrereleaseTestLeaderboard] = useState(false);
  const [invalidateTarget, setInvalidateTarget] = useState<number | null>(null);
  const [invalidationReason, setInvalidationReason] = useState('');
  const [testStudentId, setTestStudentId] = useState('');
  const [verificationPeriodId, setVerificationPeriodId] = useState<number | null>(null);
  const [verificationOverview, setVerificationOverview] = useState<ArcadeVerificationOverview | null>(null);
  const [isLoadingVerification, setIsLoadingVerification] = useState(false);
  const [verificationActionId, setVerificationActionId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['teacher-arcade', classroomId],
    enabled: Boolean(classroomId),
    queryFn: async () => {
      const [periods, seasons, games, students, testAccess] = await Promise.all([
        supabase.from('arcade_ranking_periods').select('id,period_kind,display_name,guild_season_id,contribution_year_month,starts_at,ends_at_exclusive,status').eq('classroom_id', classroomId!).order('starts_at', { ascending: false }),
        supabase.from('guild_seasons').select('id,display_name,starts_on,ends_on').eq('classroom_id', classroomId!).order('starts_on', { ascending: false }),
        supabase.from('arcade_games').select('id,code,internal_name,is_active,available_from,available_until').order('id'),
        supabase.from('students').select('id,name,brand_name,role,transferred_at').eq('classroom_id', classroomId!).order('name'),
        arcadeTeacherRpc.listPrereleaseTestAccess(supabase, { p_game_code: 'focus_reaction_01' }),
      ]);
      for (const [name, response] of Object.entries({ periods, seasons, games, students })) if (response.error) throw new Error(`[Arcade:${name}] ${response.error.message}`);
      if (testAccess.success === false) throw new Error(arcadeErrorMessage(testAccess));
      return { periods: (periods.data ?? []) as PeriodRow[], seasons: (seasons.data ?? []) as SeasonRow[], games: games.data ?? [], students: (students.data ?? []) as StudentRow[], testAccess: testAccess.data as PrereleaseTestAccessRow[] };
    },
  });

  const auditPeriod = useMemo(() => (query.data?.periods ?? []).find((period) => period.id === auditPeriodId) ?? query.data?.periods?.[0] ?? null, [auditPeriodId, query.data?.periods]);
  const verificationPeriods = useMemo(() => (query.data?.periods ?? []).filter((period) => period.period_kind === 'MONTHLY' && ['VERIFICATION', 'READY_TO_FINALIZE'].includes(period.status)), [query.data?.periods]);
  const verificationPeriod = verificationPeriods.find((period) => period.id === verificationPeriodId) ?? verificationPeriods[0] ?? null;

  const fillMonthlyTemplate = () => {
    const [year, month] = yearMonth.split('-').map(Number);
    if (!year || !month) return;
    const start = `${yearMonth}-01`;
    setDisplayName(`${year}년 ${month}월 Arcade`);
    setStartsAt(`${start}T00:00`);
    setEndsAt(`${nextMonthStart(yearMonth)}T00:00`);
  };

  const refresh = () => void client.invalidateQueries({ queryKey: ['teacher-arcade', classroomId] });
  const createPeriod = async () => {
    setActionError(null);
    const startsAtIso = localDateTimeToIso(startsAt);
    const endsAtIso = localDateTimeToIso(endsAt);
    if (!startsAtIso || !endsAtIso) {
      setActionError('시작과 종료 시각을 모두 입력해주세요.');
      return;
    }
    setIsSaving(true);
    const rpc = await arcadeTeacherRpc.createRankingPeriod(supabase, {
      p_period_kind: kind,
      p_display_name: displayName,
      p_guild_season_id: seasonId ? Number(seasonId) : null,
      p_contribution_year_month: kind === 'MONTHLY' ? yearMonth : null,
      p_starts_at: startsAtIso,
      p_ends_at_exclusive: endsAtIso,
    });
    setIsSaving(false);
    if (rpc.success === false) { setActionError(arcadeErrorMessage(rpc)); return; }
    refresh();
    setActionError(null);
  };

  const updateStatus = async (period: PeriodRow, nextStatus: 'DRAFT' | 'ACTIVE') => {
    setActionError(null);
    setIsSaving(true);
    const rpc = await arcadeTeacherRpc.updateRankingPeriod(supabase, {
      p_period_id: period.id,
      p_display_name: period.display_name,
      p_guild_season_id: period.guild_season_id,
      p_contribution_year_month: period.contribution_year_month,
      p_starts_at: period.starts_at,
      p_ends_at_exclusive: period.ends_at_exclusive,
      p_status: nextStatus,
    });
    setIsSaving(false);
    if (rpc.success === false) { setActionError(arcadeErrorMessage(rpc)); return; }
    refresh();
  };

  const endPeriodNow = async (period: PeriodRow) => {
    if (!window.confirm(`「${period.display_name}」 랭킹 기간을 지금 즉시 종료할까요?\n종료 후에는 학생의 새 Arcade 기록이 이 기간 랭킹에 포함되지 않습니다.\n월간 기간은 종료 후 기록 동결 → Top 10 인증 → 최종 확정 순서로 진행합니다.`)) return;
    setActionError(null);
    setIsSaving(true);
    const rpc = await arcadeTeacherRpc.endRankingPeriodNow(supabase, { p_period_id: period.id });
    setIsSaving(false);
    if (rpc.success === false) { setActionError(arcadeErrorMessage(rpc)); return; }
    show({ title: '랭킹 기간을 종료했어요', description: period.period_kind === 'MONTHLY' ? '이제 기록을 동결하고 Top 10 인증 단계를 시작할 수 있습니다.' : '새 기록 접수가 종료되었습니다.', variant: 'success' });
    refresh();
  };

  const freezePeriod = async (period: PeriodRow) => {
    if (!window.confirm(`「${period.display_name}」의 일반 기록을 지금 동결하고 기록 인증 단계를 시작할까요?\n동결 뒤에는 이 기간의 일반 기록이 더 이상 바뀌지 않습니다.`)) return;
    setActionError(null);
    setIsSaving(true);
    const rpc = await arcadeTeacherRpc.freezeMonthlyPeriod(supabase, { p_period_id: period.id });
    setIsSaving(false);
    if (rpc.success === false) { setActionError(arcadeErrorMessage(rpc)); return; }
    setVerificationPeriodId(period.id);
    show({ title: '기록을 동결했어요', description: '현재 Top 10부터 기록 인증을 진행할 수 있습니다.', variant: 'success' });
    refresh();
    await loadVerificationOverview(period.id);
  };

  const loadVerificationOverview = async (periodId = verificationPeriod?.id ?? null) => {
    if (!periodId) return;
    setIsLoadingVerification(true);
    setActionError(null);
    const rpc = await arcadeTeacherRpc.getVerificationOverview(supabase, { p_period_id: periodId, p_game_code: 'focus_reaction_01' });
    setIsLoadingVerification(false);
    if (rpc.success === false) { setActionError(arcadeErrorMessage(rpc)); return; }
    setVerificationPeriodId(periodId);
    setVerificationOverview(rpc.data);
  };

  const runVerificationAction = async (key: string, action: () => ReturnType<typeof arcadeTeacherRpc.startVerificationSession>) => {
    setVerificationActionId(key);
    setActionError(null);
    const rpc = await action();
    setVerificationActionId(null);
    if (rpc.success === false) { setActionError(arcadeErrorMessage(rpc)); return false; }
    refresh();
    await loadVerificationOverview();
    return true;
  };

  const finalizePeriod = async (period: PeriodRow) => {
    if (!window.confirm(`「${period.display_name}」의 인증 완료 Top 10을 최종 확정하고 Guild 2에 반영할까요?\n확정 뒤에는 일반 수정이 불가능합니다.`)) return;
    setActionError(null);
    setIsSaving(true);
    const rpc = await arcadeTeacherRpc.finalizeMonthlySnapshot(supabase, { p_period_id: period.id });
    setIsSaving(false);
    if (rpc.success === false) { setActionError(arcadeErrorMessage(rpc)); return; }
    refresh();
    setVerificationOverview(null);
  };

  const loadAudit = async () => {
    if (!auditPeriod) return;
    setIsLoadingAudit(true);
    setActionError(null);
    const rpc = await arcadeTeacherRpc.getRunAudit(supabase, { p_period_id: auditPeriod.id, p_game_code: 'focus_reaction_01' });
    setIsLoadingAudit(false);
    if (rpc.success === false) { setActionError(arcadeErrorMessage(rpc)); return; }
    setAuditRows(rpc.data as unknown as AuditRow[]);
  };

  const loadPrereleaseTestLeaderboard = async () => {
    if (!auditPeriod) return;
    setIsLoadingPrereleaseTestLeaderboard(true);
    setActionError(null);
    const rpc = await arcadeTeacherRpc.getPrereleaseTestLeaderboard(supabase, { p_period_id: auditPeriod.id, p_game_code: 'focus_reaction_01' });
    setIsLoadingPrereleaseTestLeaderboard(false);
    if (rpc.success === false) { setActionError(arcadeErrorMessage(rpc)); return; }
    setPrereleaseTestLeaderboard(rpc.data);
  };

  const invalidateRun = async (runId: number) => {
    setActionError(null);
    const rpc = await arcadeTeacherRpc.invalidateRun(supabase, { p_run_id: runId, p_reason: invalidationReason, p_idempotency_key: makeIdempotencyKey() });
    if (rpc.success === false) { setActionError(arcadeErrorMessage(rpc)); return; }
    setInvalidateTarget(null);
    setInvalidationReason('');
    await loadAudit();
  };

  const setPrereleaseTestAccess = async (enabled: boolean, studentId = Number(testStudentId)) => {
    if (!studentId) { setActionError('테스트할 학생을 선택해주세요.'); return; }
    setActionError(null);
    setIsSaving(true);
    const rpc = await arcadeTeacherRpc.setPrereleaseTestAccess(supabase, { p_student_id: studentId, p_game_code: 'focus_reaction_01', p_enabled: enabled });
    setIsSaving(false);
    if (rpc.success === false) { setActionError(arcadeErrorMessage(rpc)); return; }
    setTestStudentId('');
    refresh();
  };

  return <TeacherShell><div className="space-y-6">
    <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start"><div><h1 className="font-display text-2xl text-brand-gradient">🕹️ Arcade 운영</h1><p className="mt-1 text-sm font-bold text-text-secondary">기간을 열고, 종료 후 기록 인증을 거쳐 월간 Top 10과 Guild 2 점수를 안전하게 확정합니다.</p></div><Link className="btn-secondary" to="/teacher/guild/scores">📊 Guild 2 점수 보기</Link></div>
    {actionError && <div className="glass-card border-danger/40 p-4 text-sm font-bold text-danger">{actionError}</div>}
    {query.isLoading && <div className="py-16 text-center"><LoadingSpinner size="lg" /></div>}
    {query.isError && <div className="glass-card border-danger/40 p-4"><div className="font-black text-danger">Arcade 운영 정보를 불러오지 못했습니다.</div><p className="mt-2 text-xs text-text-secondary">{query.error instanceof Error ? query.error.message : '알 수 없는 오류'}</p><button className="btn-secondary mt-3" onClick={() => void query.refetch()}>다시 시도</button></div>}
    {query.data && <>
      <section className="glass-card p-5"><div className="mb-4"><h2 className="font-display text-lg text-white">새 랭킹 기간 만들기</h2><p className="mt-1 text-xs text-text-secondary">월간 기간은 Guild 2 반영 월을 가집니다. 날짜·시각은 한국(Asia/Seoul) 기준으로 입력하세요. 종료 시각은 포함하지 않는 경계입니다.</p></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><label className="text-xs font-black text-text-secondary">기간 종류<select className="input-field mt-1 w-full" value={kind} onChange={(event) => setKind(event.target.value as PeriodKind)}><option value="MONTHLY">월간 (Guild 2 반영)</option><option value="SEASON">시즌 랭킹</option></select></label><label className="text-xs font-black text-text-secondary">기간 이름<input className="input-field mt-1 w-full" value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} /></label><label className="text-xs font-black text-text-secondary">연결할 길드 시즌<select className="input-field mt-1 w-full" value={seasonId} onChange={(event) => setSeasonId(event.target.value)}><option value="">연결하지 않음</option>{query.data.seasons.map((season) => <option key={season.id} value={season.id}>{season.display_name} ({season.starts_on} ~ {season.ends_on})</option>)}</select></label>{kind === 'MONTHLY' && <label className="text-xs font-black text-text-secondary">Guild 2 반영 월<div className="mt-1 flex gap-2"><input className="input-field min-w-0 flex-1" type="month" value={yearMonth} onChange={(event) => setYearMonth(event.target.value)} /><button className="btn-secondary text-xs" onClick={fillMonthlyTemplate}>월 템플릿</button></div></label>}<label className="text-xs font-black text-text-secondary">시작 (포함)<input className="input-field mt-1 w-full" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label className="text-xs font-black text-text-secondary">종료 (이 시각 전까지)<input className="input-field mt-1 w-full" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div>
        <button className="btn-primary mt-4" disabled={isSaving} onClick={() => void createPeriod()}>{isSaving ? '저장 중...' : '초안 기간 만들기'}</button>
      </section>

      <section className="glass-card p-5"><div className="mb-4"><h2 className="font-display text-lg text-white">기간 상태와 월간 확정</h2><p className="mt-1 text-xs text-text-secondary">월간 기간은 종료 후 먼저 기록을 동결하고 Top 10 인증을 진행합니다. 현재 보상권 전원이 해결되어 READY 상태가 된 뒤에만 최종 snapshot과 Guild 2 반영을 확정합니다.</p></div>{!query.data.periods.length ? <p className="py-8 text-center text-sm text-text-secondary">아직 만든 기간이 없습니다.</p> : <div className="space-y-3">{query.data.periods.map((period) => { const ended = new Date(period.ends_at_exclusive).getTime() <= Date.now(); return <div key={period.id} className="rounded-card-md border border-line bg-bg-deep p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><b className="text-white">{period.display_name}</b><StatusPill status={period.status} /><span className="text-xs text-text-muted">{period.period_kind === 'MONTHLY' ? `Guild 2 ${period.contribution_year_month}` : '시즌 랭킹'}</span></div><p className="mt-1 text-xs text-text-secondary">{formatKst(period.starts_at)} ~ {formatKst(period.ends_at_exclusive)} 전</p></div><div className="flex flex-wrap gap-2">{period.status === 'DRAFT' && <button className="btn-primary text-xs" disabled={isSaving} onClick={() => void updateStatus(period, 'ACTIVE')}>기간 열기</button>}{period.status === 'ACTIVE' && !ended && <button className="btn-secondary text-xs" disabled={isSaving} onClick={() => void updateStatus(period, 'DRAFT')}>다시 초안으로</button>}{period.status === 'ACTIVE' && !ended && <button className="btn-danger text-xs" disabled={isSaving} onClick={() => void endPeriodNow(period)}>⏹ 랭킹 기간 즉시 종료</button>}{period.status === 'ACTIVE' && period.period_kind === 'MONTHLY' && <button className="btn-primary text-xs" disabled={!ended || isSaving} title={ended ? '일반 기록을 동결하고 기록 인증 단계를 시작합니다.' : '종료 시각 뒤에 동결할 수 있습니다.'} onClick={() => void freezePeriod(period)}>{ended ? '🔒 기록 동결 + 인증 시작' : '기간 종료 전'}</button>}{period.period_kind === 'MONTHLY' && ['VERIFICATION','READY_TO_FINALIZE'].includes(period.status) && <button className="btn-secondary text-xs" disabled={isLoadingVerification} onClick={() => void loadVerificationOverview(period.id)}>🏅 인증 관리</button>}{period.status === 'READY_TO_FINALIZE' && <button className="btn-primary text-xs" disabled={isSaving} onClick={() => void finalizePeriod(period)}>✅ 최종 랭킹 확정 + Guild 2 반영</button>}</div></div></div>; })}</div>}</section>

      {verificationPeriods.length > 0 && <section className="glass-card border-gold/40 p-5"><div className="mb-4"><h2 className="font-display text-lg text-white">🏅 기록 인증 관리</h2><p className="mt-1 text-xs text-text-secondary">현재 Top 10의 잠정 기록을 학교 관리 환경에서 인증합니다. 순위가 바뀌어 새 학생이 Top 10에 들어오면 그 학생도 인증 대상이 됩니다.</p></div><div className="flex flex-col gap-2 sm:flex-row"><select className="input-field min-w-0 flex-1" value={verificationPeriod?.id ?? ''} onChange={(event) => { const id = Number(event.target.value); setVerificationPeriodId(id); setVerificationOverview(null); }}><option value="">인증 기간 선택</option>{verificationPeriods.map((period) => <option key={period.id} value={period.id}>{period.display_name} · {period.status === 'READY_TO_FINALIZE' ? '최종 확정 대기' : '인증 중'}</option>)}</select><button className="btn-secondary" disabled={!verificationPeriod || isLoadingVerification} onClick={() => void loadVerificationOverview()}>{isLoadingVerification ? '불러오는 중...' : '인증 현황 불러오기'}</button></div>{verificationOverview && <VerificationOverviewTable overview={verificationOverview} busyKey={verificationActionId} runAction={runVerificationAction} />}</section>}

      <section className="glass-card border-brand-primary/30 p-5"><div className="mb-4"><h2 className="font-display text-lg text-white">사전 테스트 허용</h2><p className="mt-1 text-xs text-text-secondary">공개일 전에는 여기서 허용한 학생만 게임을 플레이할 수 있습니다. 테스트 기록은 서버 검증과 감사 기록에는 남지만, Top 10·월간 확정·Guild 2 점수에는 절대 반영되지 않습니다.</p></div><div className="flex flex-col gap-2 sm:flex-row"><select className="input-field min-w-0 flex-1" value={testStudentId} onChange={(event) => setTestStudentId(event.target.value)}><option value="">테스트할 학생 선택</option>{query.data.students.filter((student) => !student.transferred_at && ['STUDENT', 'STUDENT_LEADER', 'GUARD', 'TEST'].includes(student.role)).map((student) => <option key={student.id} value={student.id}>{student.brand_name || student.name} ({student.name})</option>)}</select><button className="btn-primary" disabled={isSaving || !testStudentId} onClick={() => void setPrereleaseTestAccess(true)}>{isSaving ? '저장 중...' : '사전 테스트 허용'}</button></div>{!query.data.testAccess.length ? <p className="mt-4 text-sm text-text-secondary">현재 사전 테스트가 허용된 학생이 없습니다.</p> : <div className="mt-4 space-y-2">{query.data.testAccess.map((access) => <div key={access.access_id} className="flex flex-wrap items-center justify-between gap-2 rounded-card-md border border-line bg-bg-deep p-3"><div><b className="text-sm text-white">{access.student_brand_name || access.student_name}</b><p className="mt-1 text-xs text-text-secondary">사전 테스트 허용됨 · 최근 변경 {formatKst(access.updated_at)}</p></div><button className="btn-secondary text-xs" disabled={isSaving} onClick={() => void setPrereleaseTestAccess(false, access.student_id)}>허용 해제</button></div>)}</div>}</section>

      <section className="glass-card border-brand-primary/30 p-5"><div className="mb-4"><h2 className="font-display text-lg text-white">사전 테스트 순위 확인</h2><p className="mt-1 text-xs text-text-secondary">공개 랭킹과 같은 방식으로 학생당 최고 기록 하나만 사용해 순위를 계산합니다. 이 표는 테스트 기록만 읽으며, 공개 Top 10·월간 확정·Guild 2에는 전혀 영향을 주지 않습니다.</p></div><div className="flex flex-col gap-2 sm:flex-row"><select className="input-field min-w-0 flex-1" value={auditPeriod?.id ?? ''} onChange={(event) => { setAuditPeriodId(Number(event.target.value)); setAuditRows(null); setPrereleaseTestLeaderboard(null); }}><option value="">기간 선택</option>{query.data.periods.map((period) => <option key={period.id} value={period.id}>{period.display_name}</option>)}</select><button className="btn-secondary" disabled={!auditPeriod || isLoadingPrereleaseTestLeaderboard} onClick={() => void loadPrereleaseTestLeaderboard()}>{isLoadingPrereleaseTestLeaderboard ? '순위 계산 중...' : '사전 테스트 순위 보기'}</button></div>{prereleaseTestLeaderboard && <PrereleaseTestLeaderboardCard leaderboard={prereleaseTestLeaderboard} />}</section>

      <section className="glass-card p-5"><div className="mb-4"><h2 className="font-display text-lg text-white">Game #01 감사 기록</h2><p className="mt-1 text-xs text-text-secondary">인정·거절·무효 처리된 기록을 모두 확인합니다. 점수 조작 의심 등 확실한 사유가 있을 때만 무효 처리하세요.</p></div><div className="flex flex-col gap-2 sm:flex-row"><select className="input-field min-w-0 flex-1" value={auditPeriod?.id ?? ''} onChange={(event) => { setAuditPeriodId(Number(event.target.value)); setAuditRows(null); setPrereleaseTestLeaderboard(null); }}><option value="">기간 선택</option>{query.data.periods.map((period) => <option key={period.id} value={period.id}>{period.display_name}</option>)}</select><button className="btn-secondary" disabled={!auditPeriod || isLoadingAudit} onClick={() => void loadAudit()}>{isLoadingAudit ? '불러오는 중...' : '감사 기록 불러오기'}</button></div>
        {auditRows && <AuditTable periodStatus={auditPeriod?.status ?? null} rows={auditRows} invalidateTarget={invalidateTarget} invalidationReason={invalidationReason} setInvalidateTarget={setInvalidateTarget} setInvalidationReason={setInvalidationReason} onInvalidate={invalidateRun} />}
      </section>
    </>}
  </div></TeacherShell>;
}

function VerificationOverviewTable({ overview, busyKey, runAction }: { overview: ArcadeVerificationOverview; busyKey: string | null; runAction: (key: string, action: () => ReturnType<typeof arcadeTeacherRpc.startVerificationSession>) => Promise<boolean> }) {
  const doReasonAction = async (label: string, key: string, action: (reason: string) => ReturnType<typeof arcadeTeacherRpc.startVerificationSession>) => {
    const reason = window.prompt(`${label} 사유를 입력하세요.`, '기술 오류 또는 교사 확인에 따른 처리');
    if (!reason || reason.trim().length < 2) return;
    await runAction(key, () => action(reason.trim()));
  };
  const setCorrection = async (row: ArcadeVerificationOverviewRow, noRecord: boolean) => {
    let sourceRunId: number | null = null;
    if (!noRecord) {
      const raw = window.prompt('공식 source로 사용할 VERIFIED run ID를 입력하세요.\n해당 기간의 일반 run 또는 이 기간 인증 run만 허용됩니다.');
      if (!raw) return;
      sourceRunId = Number(raw);
      if (!Number.isInteger(sourceRunId) || sourceRunId <= 0) return;
    }
    const reason = window.prompt(noRecord ? '공식 기록 없음 처리 사유를 입력하세요.' : '수동 source 보정 사유를 입력하세요.', '교사 확인에 따른 수동 보정');
    if (!reason || reason.trim().length < 2) return;
    await runAction(`correction-${row.student_id}`, () => arcadeTeacherRpc.setVerificationCorrection(supabase, {
      p_period_id: overview.period_id,
      p_game_code: overview.game_code,
      p_student_id: row.student_id,
      p_source_run_id: sourceRunId,
      p_reason: reason.trim(),
    }));
  };
  return <div className="mt-4 overflow-x-auto rounded-card-md border border-line"><div className="border-b border-line bg-bg-deep px-4 py-3 text-xs text-text-secondary">기간 상태 <b className={overview.period_status === 'READY_TO_FINALIZE' ? 'text-success' : 'text-gold'}>{overview.period_status === 'READY_TO_FINALIZE' ? '최종 확정 가능' : '기록 인증 진행 중'}</b> · 인증 완료 후 순위가 바뀌면 새 Top 10 학생이 자동으로 대상이 됩니다.</div><table className="w-full min-w-[1180px] text-xs"><thead className="border-b border-line text-left text-text-secondary"><tr><th className="p-3">현재 순위</th><th className="p-3">학생</th><th className="p-3 text-right">잠정 SCORE</th><th className="p-3 text-right">기준</th><th className="p-3 text-right">인증 최고</th><th className="p-3">기회</th><th className="p-3">상태</th><th className="p-3">관리</th></tr></thead><tbody>{overview.rows.map((row) => {
    const busy = busyKey !== null;
    const hasActiveRun = row.active_run_id !== null;
    const sessionActive = row.session_status === 'ACTIVE';
    const used = row.used_attempts ?? 0;
    const canEnd = sessionActive && !hasActiveRun && (row.success_achieved || (row.max_attempts !== null && used >= row.max_attempts));
    return <tr key={row.student_id} className={`border-b border-line/70 align-top last:border-0 ${row.is_current_reward_range ? '' : 'opacity-60'}`}><td className="p-3 font-display text-lg text-gold">{row.rank ?? '밖'}</td><td className="p-3"><b className="text-white">{row.brand_name || row.student_name}</b><div className="mt-1 text-[10px] text-text-muted">{row.student_name} · ID {row.student_id}</div>{!row.is_current_reward_range && <div className="mt-1 text-warning">현재 보상권 밖</div>}</td><td className="p-3 text-right font-black text-white">{Number(row.provisional_score).toLocaleString('ko-KR')}</td><td className="p-3 text-right text-white">{row.verification_threshold === null ? '세션 전' : Number(row.verification_threshold).toLocaleString('ko-KR')}</td><td className="p-3 text-right text-gold">{row.best_verification_score === null ? '—' : Number(row.best_verification_score).toLocaleString('ko-KR')}</td><td className="p-3"><b className="text-white">{used}/{row.max_attempts ?? 3}</b>{row.attempts.length > 0 && <div className="mt-1 space-y-0.5 text-[10px] text-text-secondary">{row.attempts.map((attempt) => <div key={attempt.attempt_id}>{attempt.opportunity_number}차 · {verificationAttemptLabel(attempt)}{attempt.status === 'TERMINAL' && attempt.consumed && !attempt.valid_run && <button className="ml-1 underline text-brand-primary disabled:opacity-40" disabled={busy || hasActiveRun} onClick={() => void doReasonAction('시도 복구', `restore-${attempt.attempt_id}`, (reason) => arcadeTeacherRpc.restoreVerificationAttempt(supabase, { p_attempt_id: attempt.attempt_id, p_reason: reason }))}>복구</button>}</div>)}</div>}</td><td className="p-3"><VerificationStatus row={row} />{hasActiveRun && <div className="mt-1 text-warning">run #{row.active_run_id} 진행 중</div>}</td><td className="p-3"><div className="flex max-w-[330px] flex-wrap gap-1.5">{row.is_current_reward_range && row.session_status !== 'ACTIVE' && row.session_status !== 'COMPLETED' && row.decision_kind === null && <button className="btn-primary text-[10px]" disabled={busy} onClick={() => void runAction(`start-${row.student_id}`, () => arcadeTeacherRpc.startVerificationSession(supabase, { p_period_id: overview.period_id, p_game_code: overview.game_code, p_student_id: row.student_id }))}>인증 시작</button>}{hasActiveRun && <button className="btn-danger text-[10px]" disabled={busy} onClick={() => void doReasonAction('기술 취소', `cancel-${row.active_run_id}`, (reason) => arcadeTeacherRpc.cancelVerificationRun(supabase, { p_run_id: row.active_run_id!, p_reason: reason }))}>기술 취소</button>}{canEnd && row.session_id && <button className="btn-primary text-[10px]" disabled={busy} onClick={() => void runAction(`end-${row.session_id}`, () => arcadeTeacherRpc.endVerificationSession(supabase, { p_session_id: row.session_id! }))}>인증 종료</button>}{row.session_id && !hasActiveRun && (row.session_status === 'ACTIVE' || (row.session_status === 'COMPLETED' && (row.decision_kind?.startsWith('SESSION_') ?? false))) && <button className="btn-secondary text-[10px]" disabled={busy} onClick={() => void doReasonAction('세션 초기화', `reset-${row.session_id}`, (reason) => arcadeTeacherRpc.resetVerificationSession(supabase, { p_session_id: row.session_id!, p_reason: reason }))}>초기화</button>} {!hasActiveRun && <button className="btn-secondary text-[10px]" disabled={busy} onClick={() => void setCorrection(row, false)}>source 보정</button>} {!hasActiveRun && <button className="btn-secondary text-[10px]" disabled={busy} onClick={() => void setCorrection(row, true)}>기록 없음</button>}</div></td></tr>;
  })}</tbody></table></div>;
}

function VerificationStatus({ row }: { row: ArcadeVerificationOverviewRow }) {
  if (row.decision_kind) return <span className={`rounded-pill px-2 py-0.5 font-black ${row.ranking_eligible ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>{row.ranking_eligible ? '공식 기록 확정' : '순위 제외'}</span>;
  if (row.session_status === 'COMPLETED') return <span className="rounded-pill bg-success/15 px-2 py-0.5 font-black text-success">세션 완료</span>;
  if (row.session_status === 'ACTIVE') return <span className="rounded-pill bg-gold/15 px-2 py-0.5 font-black text-gold">{row.success_achieved ? '기준 달성' : '인증 중'}</span>;
  return <span className="rounded-pill bg-bg-card px-2 py-0.5 font-black text-text-secondary">인증 대기</span>;
}
function verificationAttemptLabel(attempt: ArcadeVerificationOverviewRow['attempts'][number]) { if (attempt.status === 'TECHNICAL_CANCELLED') return '기술 취소'; if (attempt.status === 'RESTORED') return '복구됨'; if (attempt.status !== 'TERMINAL') return '진행 중'; if (!attempt.valid_run) return '유효 기록 없음'; return attempt.official_score === null ? '종료' : `${Number(attempt.official_score).toLocaleString('ko-KR')}점`; }

function AuditTable({ periodStatus, rows, invalidateTarget, invalidationReason, setInvalidateTarget, setInvalidationReason, onInvalidate }: { periodStatus: PeriodStatus | null; rows: AuditRow[]; invalidateTarget: number | null; invalidationReason: string; setInvalidateTarget: (id: number | null) => void; setInvalidationReason: (value: string) => void; onInvalidate: (id: number) => void }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-text-secondary">이 기간의 Game #01 기록이 없습니다.</p>;
  return <div className="mt-4 space-y-2">{periodStatus && periodStatus !== 'ACTIVE' && <p className="rounded-card-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">이 기간은 이미 동결 또는 확정 단계입니다. 일반 감사 무효화 대신 위의 기록 인증 관리에서 기술 취소·시도 복구·수동 보정을 사용하세요.</p>}{rows.map((row) => <div key={row.run_id} className="rounded-card-md border border-line bg-bg-deep p-3"><div className="flex flex-col justify-between gap-2 sm:flex-row"><div><div className="flex flex-wrap items-center gap-2"><b className="text-white">{row.student_name}</b><StatusPill status={row.status as PeriodStatus} />{row.is_prerelease_test && <span className="rounded-pill bg-brand-primary/15 px-2 py-0.5 text-[10px] font-black text-brand-primary">사전 테스트</span>}{row.invalidated && <span className="rounded-pill bg-danger/15 px-2 py-0.5 text-[10px] font-black text-danger">무효 처리됨</span>}</div><p className="mt-1 text-xs text-text-secondary">점수 {row.official_score === null ? '—' : Number(row.official_score).toLocaleString('ko-KR')} · 기준 시각 {formatKst(row.event_at)}</p>{row.is_prerelease_test && <p className="mt-1 text-xs text-brand-primary">순위·월간 확정·Guild 2 점수에 반영되지 않는 테스트 기록입니다.</p>}{row.rejection_code && <p className="mt-1 text-xs text-warning">거절: {row.rejection_code} · {row.rejection_reason}</p>}{row.invalidated && <p className="mt-1 text-xs text-danger">무효 사유: {row.invalidation_reason}</p>}</div>{periodStatus === 'ACTIVE' && !row.is_prerelease_test && !row.invalidated && <button className="btn-secondary h-fit text-xs" onClick={() => { setInvalidateTarget(row.run_id); setInvalidationReason(''); }}>무효 처리</button>}</div>{invalidateTarget === row.run_id && <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input className="input-field min-w-0 flex-1 text-xs" autoFocus value={invalidationReason} maxLength={300} onChange={(event) => setInvalidationReason(event.target.value)} placeholder="무효 처리 사유 (2자 이상)" /><button className="btn-primary text-xs" disabled={invalidationReason.trim().length < 2} onClick={() => onInvalidate(row.run_id)}>사유 남기고 무효 처리</button><button className="btn-secondary text-xs" onClick={() => setInvalidateTarget(null)}>취소</button></div>}</div>)}</div>;
}

function PrereleaseTestLeaderboardCard({ leaderboard }: { leaderboard: ArcadePrereleaseTestLeaderboardResult }) {
  if (!leaderboard.top10.length) return <p className="mt-4 rounded-card-md bg-bg-deep p-4 text-center text-sm text-text-secondary">이 기간에 서버가 인정한 사전 테스트 기록이 아직 없습니다.</p>;
  return <div className="mt-4 overflow-x-auto rounded-card-md border border-line"><div className="border-b border-line bg-bg-deep px-4 py-3 text-xs text-text-secondary">서로 다른 학생 <b className="text-white">{leaderboard.participant_count}명</b> · 학생 한 명이 여러 번 플레이했어도 최고점 하나만 표시됩니다.</div><table className="w-full min-w-[460px] text-sm"><thead className="border-b border-line text-left text-xs text-text-secondary"><tr><th className="p-3">순위</th><th className="p-3">학생</th><th className="p-3 text-right">서버 공식 점수</th><th className="p-3 text-right">기록 시각</th></tr></thead><tbody>{leaderboard.top10.map((row) => <tr key={row.rank} className="border-b border-line/70 last:border-0"><td className="p-3 font-display text-lg text-gold">{row.rank}</td><td className="p-3 font-black text-white">{row.student_name}</td><td className="p-3 text-right font-black text-white">{Number(row.official_score).toLocaleString('ko-KR')}</td><td className="p-3 text-right text-xs text-text-secondary">{formatKst(row.game_over_at)}</td></tr>)}</tbody></table></div>;
}

function StatusPill({ status }: { status: string }) { const label: Record<string, string> = { DRAFT: '초안', ACTIVE: '진행 중', VERIFICATION: '인증 중', READY_TO_FINALIZE: '확정 대기', FINALIZED: '확정', VERIFIED: '인정됨', REJECTED: '거절됨', PLAYING: '진행 중', COUNTDOWN: '준비 중', SUBMITTING: '검증 중' }; const color = status === 'FINALIZED' || status === 'VERIFIED' ? 'bg-success/15 text-success' : status === 'REJECTED' ? 'bg-warning/15 text-warning' : status === 'DRAFT' ? 'bg-bg-card text-text-secondary' : 'bg-brand-primary/15 text-brand-primary'; return <span className={`rounded-pill px-2 py-0.5 text-[10px] font-black ${color}`}>{label[status] ?? status}</span>; }
function koreaDateString() { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''; return `${value('year')}-${value('month')}-${value('day')}`; }
function nextMonthStart(yearMonth: string) { const [year, month] = yearMonth.split('-').map(Number); const date = new Date(Date.UTC(year, month, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`; }
function formatKst(value: string) { return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function makeIdempotencyKey() { return crypto.randomUUID(); }
function localDateTimeToIso(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
