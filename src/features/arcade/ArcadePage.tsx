import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, LoadingSpinner } from '@/components/shared/components';
import { FocusReactionGame, type FocusPlaySummary } from '@/features/arcade/FocusReactionGame';
import { arcadeErrorMessage, arcadeStudentRpc, type ArcadeRunBootstrap, type ArcadeRunSubmissionResult, type ArcadeVerificationState, type ArcadeVerificationAttempt } from '@/lib/rpc/arcade_rpc';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { useClassroomStudentGuilds } from '@/hooks/useStudentGuilds';

interface ArcadeGameRow {
  id: number;
  code: string;
  internal_name: string;
  is_active: boolean;
  available_from: string;
  available_until: string | null;
}

interface ArcadePeriodRow {
  id: number;
  period_kind: 'MONTHLY' | 'SEASON';
  display_name: string;
  contribution_year_month: string | null;
  starts_at: string;
  ends_at_exclusive: string;
  status: 'DRAFT' | 'ACTIVE' | 'VERIFICATION' | 'READY_TO_FINALIZE' | 'FINALIZED';
}

export default function ArcadePage() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();
  const { byStudentId: guildsByStudentId } = useClassroomStudentGuilds();
  const queryClient = useQueryClient();
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [bootstrap, setBootstrap] = useState<ArcadeRunBootstrap | null>(null);
  const [result, setResult] = useState<ArcadeRunSubmissionResult | null>(null);
  const [playSummary, setPlaySummary] = useState<FocusPlaySummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [isResultRankingUpdating, setIsResultRankingUpdating] = useState(false);

  const arcadeQuery = useQuery({
    queryKey: ['arcade', 'catalog', classroomId],
    enabled: Boolean(classroomId),
    queryFn: async () => {
      const [games, periods] = await Promise.all([
        supabase.from('arcade_games').select('id,code,internal_name,is_active,available_from,available_until').order('id'),
        supabase.from('arcade_ranking_periods').select('id,period_kind,display_name,contribution_year_month,starts_at,ends_at_exclusive,status').eq('classroom_id', classroomId!).order('starts_at', { ascending: false }),
      ]);
      if (games.error) throw new Error(games.error.message);
      if (periods.error) throw new Error(periods.error.message);
      return { games: (games.data ?? []) as ArcadeGameRow[], periods: (periods.data ?? []) as ArcadePeriodRow[] };
    },
  });

  const visiblePeriods = useMemo(() => (arcadeQuery.data?.periods ?? []).filter((period) => ['ACTIVE', 'VERIFICATION', 'READY_TO_FINALIZE', 'FINALIZED'].includes(period.status)), [arcadeQuery.data?.periods]);
  const selectedPeriod = visiblePeriods.find((period) => period.id === selectedPeriodId) ?? visiblePeriods[0] ?? null;
  const game = arcadeQuery.data?.games.find((entry) => entry.code === 'focus_reaction_01') ?? null;
  const gameAccessQuery = useQuery({
    queryKey: ['arcade', 'game-access', studentId, game?.code],
    enabled: Boolean(game && studentId),
    queryFn: async () => {
      const rpc = await arcadeStudentRpc.getGameAccess(supabase, { p_game_code: game!.code });
      if (rpc.success === false) throw new Error(arcadeErrorMessage(rpc));
      return rpc.data;
    },
  });
  const isPrereleaseTest = gameAccessQuery.data?.mode === 'PRERELEASE_TEST';

  const verificationQuery = useQuery({
    queryKey: ['arcade', 'verification-state', studentId, game?.code],
    enabled: Boolean(game && studentId),
    queryFn: async () => {
      const rpc = await arcadeStudentRpc.getVerificationState(supabase, { p_game_code: game!.code });
      if (rpc.success === false) throw new Error(arcadeErrorMessage(rpc));
      return rpc.data;
    },
  });
  const verificationState = verificationQuery.data ?? null;

  const leaderboardQuery = useQuery({
    queryKey: ['arcade', 'leaderboard', studentId, selectedPeriod?.id, game?.code],
    enabled: Boolean(studentId && selectedPeriod && game),
    queryFn: async () => {
      const rpc = await arcadeStudentRpc.getLeaderboard(supabase, { p_game_code: game!.code, p_period_id: selectedPeriod!.id });
      if (rpc.success === false) throw new Error(arcadeErrorMessage(rpc));
      return rpc.data;
    },
  });

  const startGame = async () => {
    if (!game || !selectedPeriod) return;
    setActionError(null);
    setResult(null);
    setPlaySummary(null);
    setIsResultRankingUpdating(false);
    setIsCreatingRun(true);
    const rpc = await arcadeStudentRpc.createRun(supabase, { p_game_code: game.code });
    setIsCreatingRun(false);
    if (rpc.success === false) {
      setActionError(arcadeErrorMessage(rpc));
      return;
    }
    setBootstrap(rpc.data);
  };

  const startVerificationGame = async (state: ArcadeVerificationState) => {
    if (!state.available || !state.session_id || !state.can_attempt || bootstrap) return;
    setActionError(null);
    setResult(null);
    setPlaySummary(null);
    setIsResultRankingUpdating(false);
    setIsCreatingRun(true);
    const rpc = await arcadeStudentRpc.createVerificationRun(supabase, {
      p_session_id: state.session_id,
      p_idempotency_key: crypto.randomUUID(),
    });
    setIsCreatingRun(false);
    if (rpc.success === false) {
      setActionError(arcadeErrorMessage(rpc));
      await verificationQuery.refetch();
      return;
    }
    if (state.period_id) setSelectedPeriodId(state.period_id);
    setBootstrap(rpc.data);
    await verificationQuery.refetch();
  };

  const handleRecorded = (nextResult: ArcadeRunSubmissionResult, summary: FocusPlaySummary) => {
    setResult({ ...nextResult, is_prerelease_test: bootstrap?.is_prerelease_test ?? false });
    setPlaySummary(summary);
    if (bootstrap?.run_context === 'VERIFICATION') {
      void queryClient.invalidateQueries({ queryKey: ['arcade', 'verification-state'] });
    }
    if (bootstrap?.is_prerelease_test) return;
    setIsResultRankingUpdating(true);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['arcade', 'leaderboard'] }),
      queryClient.invalidateQueries({ queryKey: ['arcade', 'verification-state'] }),
    ]).finally(() => setIsResultRankingUpdating(false));
  };

  const handleFinished = () => {
    setBootstrap(null);
    void queryClient.invalidateQueries({ queryKey: ['arcade', 'verification-state'] });
  };

  return <div className="min-h-screen">
    <PageHeader title="아케이드" emoji="🕹️" />
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-5">
      <section className="overflow-hidden rounded-card-xl border border-brand-primary/30 bg-gradient-to-br from-brand-primary/15 via-bg-card to-gold/10 p-5">
        <div className="text-xs font-black tracking-[0.18em] text-brand-primary">B.R.A.N.D ARCADE</div>
        <h1 className="mt-2 font-display text-3xl text-white">집중력과 반응의 시험장</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">한 번의 공식 기록은 서버가 다시 계산합니다. 점수는 화면에서 바꿀 수 없고, 월간 Top 10은 학생 한 명당 최고 기록 하나만 사용합니다.</p>
      </section>

      {arcadeQuery.isLoading && <div className="py-16 text-center"><LoadingSpinner size="lg" /></div>}
      {arcadeQuery.isError && <LoadError detail={arcadeQuery.error instanceof Error ? arcadeQuery.error.message : 'Arcade 정보를 불러오지 못했습니다.'} retry={() => void arcadeQuery.refetch()} />}
      {arcadeQuery.data && <>
        {!visiblePeriods.length && <div className="glass-card border-warning/40 p-5"><div className="font-black text-warning">아직 열린 Arcade 기간이 없어요.</div><p className="mt-2 text-sm text-text-secondary">선생님이 월간 또는 시즌 기간을 만들고 활성화하면 랭킹과 게임을 시작할 수 있습니다.</p></div>}

        {visiblePeriods.length > 0 && <section className="glass-card p-4">
          <div className="text-xs font-black text-text-secondary">랭킹 기간 선택</div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{visiblePeriods.map((period) => <button key={period.id} onClick={() => { setSelectedPeriodId(period.id); setResult(null); }} className={`shrink-0 rounded-pill border px-3 py-2 text-xs font-black ${selectedPeriod?.id === period.id ? 'border-gold bg-gold/15 text-gold' : 'border-line bg-bg-deep text-text-secondary'}`}>{period.display_name}<span className="ml-1 opacity-70">{periodStatusLabel(period.status)}</span></button>)}</div>
        </section>}

        {!bootstrap && verificationState?.available && <VerificationChallengeCard state={verificationState} isLoading={verificationQuery.isFetching || isCreatingRun} onStart={() => void startVerificationGame(verificationState)} />}

        {bootstrap && <FocusReactionGame bootstrap={bootstrap} myRank={leaderboardQuery.data?.my_rank ?? null} myBestScore={leaderboardQuery.data?.my_score ?? null} isRankingUpdating={isResultRankingUpdating || leaderboardQuery.isFetching} onRecorded={handleRecorded} onExit={handleFinished} onInlineError={setActionError} />}

        {!bootstrap && game && <section className="glass-card overflow-hidden border-brand-primary/20">
          <div className="grid gap-0 md:grid-cols-[1.1fr_.9fr]">
            <div className="p-5"><div className="flex items-start justify-between gap-4"><div><div className="text-4xl">🎯</div><h2 className="mt-3 font-display text-2xl text-white">집중 반응 #01</h2><p className="mt-1 text-sm text-text-secondary">4-Lane Visual Reaction · Go / No-Go</p></div><span className="rounded-pill bg-brand-primary/15 px-3 py-1 text-xs font-black text-brand-primary">Game #01</span></div>
              <ul className="mt-5 space-y-2 text-sm text-text-secondary"><li>• D / F / J / K 또는 터치로 4개 레인을 조작합니다.</li><li>• 파란 신호는 누르고, 빨간 ✕ 신호는 누르지 않습니다.</li><li>• Life 3, Combo, 실제 경과시간 기반 판정입니다.</li></ul>
              {gameAccessQuery.isLoading && <p className="mt-4 rounded-card-md bg-bg-deep p-3 text-xs text-text-secondary">게임 시작 권한을 확인하고 있어요.</p>}
              {gameAccessQuery.isError && <p className="mt-4 rounded-card-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger">게임 시작 권한을 확인하지 못했어요. 새로고침 후 다시 시도해주세요.</p>}
              {gameAccessQuery.data?.mode === 'CLOSED' && <p className="mt-4 rounded-card-md bg-warning/10 p-3 text-xs text-warning">이 게임은 한국 날짜 기준 {game.available_from}부터 열립니다.</p>}
              {isPrereleaseTest && <p className="mt-4 rounded-card-md border border-brand-primary/40 bg-brand-primary/10 p-3 text-xs font-bold text-brand-primary">사전 테스트 모드입니다. 이번 기록은 서버에서 검증되지만 순위와 Guild 2 점수에는 반영되지 않습니다.</p>}
              {!selectedPeriod && <p className="mt-4 rounded-card-md bg-warning/10 p-3 text-xs text-warning">플레이 전에 선생님이 랭킹 기간을 열어야 합니다.</p>}
              {actionError && <p className="mt-4 rounded-card-md border border-danger/40 bg-danger/10 p-3 text-sm font-bold text-danger">{actionError}</p>}
              {result && <ResultCard result={result} isVerification={result.run_context === 'VERIFICATION'} summary={playSummary} myRank={leaderboardQuery.data?.my_rank ?? null} myBestScore={leaderboardQuery.data?.my_score ?? null} isRankingUpdating={isResultRankingUpdating || leaderboardQuery.isFetching} onRetry={() => { setResult(null); setPlaySummary(null); setActionError(null); }} />}
              {!result && <button className="btn-primary mt-5 w-full" disabled={!gameAccessQuery.data?.can_start || !selectedPeriod || selectedPeriod.status !== 'ACTIVE' || isCreatingRun} onClick={() => void startGame()}>{isCreatingRun ? '준비 중...' : selectedPeriod?.status === 'FINALIZED' ? '확정된 기간입니다' : isPrereleaseTest ? '사전 테스트 시작' : '게임 시작'}</button>}
            </div>
            <div className="border-t border-line bg-bg-deep/70 p-5 md:border-l md:border-t-0"><h3 className="font-display text-lg text-gold">월간 보너스</h3><p className="mt-1 text-xs text-text-secondary">같은 기간에 한 학생은 최고 점수 하나만 랭킹에 들어갑니다.</p><div className="mt-4 grid grid-cols-2 gap-2 text-sm"><Bonus rank="1위" points="+30" /><Bonus rank="2위" points="+27" /><Bonus rank="3위" points="+24" /><Bonus rank="4~6위" points="+18" /><Bonus rank="7~10위" points="+15" /></div><p className="mt-4 text-xs text-text-muted">원본 보너스는 모두 기록되며, Guild 2 적용값은 학생별 최대 +90입니다.</p></div>
          </div>
        </section>}

        {selectedPeriod && <section className="glass-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-xl text-white">{selectedPeriod.display_name} Top 10</h2><p className="mt-1 text-xs text-text-secondary">동점은 공식 점수 → 먼저 게임 종료 → 기록 번호 순서로 결정됩니다.</p></div><span className={`rounded-pill px-3 py-1 text-xs font-black ${selectedPeriod.status === 'FINALIZED' ? 'bg-success/15 text-success' : 'bg-brand-primary/15 text-brand-primary'}`}>{selectedPeriod.status === 'FINALIZED' ? '월간 순위 확정' : selectedPeriod.status === 'VERIFICATION' ? '기록 인증 중' : selectedPeriod.status === 'READY_TO_FINALIZE' ? '최종 확정 대기' : '실시간 초안'}</span></div>
          {leaderboardQuery.isLoading && <div className="py-10 text-center"><LoadingSpinner /></div>}
          {leaderboardQuery.isError && <p className="mt-4 rounded-card-md bg-danger/10 p-3 text-sm text-danger">랭킹을 불러오지 못했어요. <button className="underline" onClick={() => void leaderboardQuery.refetch()}>다시 시도</button></p>}
          {leaderboardQuery.data && <Leaderboard rows={leaderboardQuery.data.top10} myRank={leaderboardQuery.data.my_rank} myScore={leaderboardQuery.data.my_score} guildNameByStudentId={new Map(Array.from(guildsByStudentId.entries()).map(([id, guild]) => [id, guild.guildName]))} />}
        </section>}
      </>}
    </main>
  </div>;
}

function Leaderboard({ rows, myRank, myScore, guildNameByStudentId }: { rows: Array<{ rank: number; student_id: number; student_name: string; official_score: number; game_over_at: string }>; myRank: number | null; myScore: number | null; guildNameByStudentId: Map<number, string> }) {
  if (!rows.length) return <p className="py-10 text-center text-sm text-text-secondary">아직 공식 기록이 없습니다. 첫 도전의 주인공이 되어보세요.</p>;
  return <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="border-b border-line text-left text-xs text-text-secondary"><tr><th className="p-2">순위</th><th className="p-2">학생</th><th className="p-2">소속 길드</th><th className="p-2 text-right">공식 점수</th><th className="p-2 text-right">기록 시각</th></tr></thead><tbody>{rows.map((row) => <tr key={row.rank} className="border-b border-line/70 last:border-0"><td className="p-2 font-display text-lg text-gold">{row.rank}</td><td className="p-2 font-black text-white">{row.student_name}</td><td className="p-2 text-xs font-black text-bv-100">{guildNameByStudentId.get(Number(row.student_id)) ?? '무소속'}</td><td className="p-2 text-right font-black text-white">{Number(row.official_score).toLocaleString('ko-KR')}</td><td className="p-2 text-right text-xs text-text-secondary">{formatKstDateTime(row.game_over_at)}</td></tr>)}</tbody></table><div className="mt-3 rounded-card-md bg-bg-deep p-3 text-xs text-text-secondary">내 순위: <b className="text-white">{myRank ? `${myRank}위` : 'Top 10 밖'}</b>{myScore !== null && <span className="ml-3">내 최고점: <b className="text-gold">{Number(myScore).toLocaleString('ko-KR')}</b></span>}</div></div>;
}

function ResultCard({ result, isVerification, summary, myRank, myBestScore, isRankingUpdating, onRetry }: { result: ArcadeRunSubmissionResult; isVerification: boolean; summary: FocusPlaySummary | null; myRank: number | null; myBestScore: number | null; isRankingUpdating: boolean; onRetry: () => void }) {
  const accepted = result.accepted;
  const prerelease = result.is_prerelease_test === true;
  const maxCombo = Number(result.stats?.max_combo ?? summary?.maxCombo ?? 0);
  return <div className={`mt-4 rounded-card-md border p-4 ${accepted ? 'border-success/40 bg-success/10' : 'border-warning/40 bg-warning/10'}`}><div className={`font-display text-lg ${accepted ? 'text-success' : 'text-warning'}`}>{accepted ? (prerelease ? '사전 테스트 기록 검증 완료!' : isVerification ? '기록 인증 시도 완료!' : '공식 기록 저장 완료!') : isVerification ? '이번 인증 시도는 유효 기록이 아니에요' : '공식 기록으로 인정되지 않았어요'}</div><p className="mt-1 text-sm text-text-secondary">{accepted ? `서버 계산 점수 ${Number(result.official_score ?? 0).toLocaleString('ko-KR')}점 · 플레이 시간 ${formatElapsed(result.official_duration_ms ?? summary?.durationMs ?? 0)}` : result.message ?? '입력 기록 검증 결과를 확인해주세요.'}</p>{accepted && <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-card-md bg-bg-deep p-2 text-text-secondary">최대 콤보 <b className="float-right text-gold">{maxCombo}</b></div><div className="rounded-card-md bg-bg-deep p-2 text-text-secondary">{prerelease ? '랭킹 반영 없음' : isRankingUpdating ? '순위 계산 중...' : <>현재 순위 <b className="float-right text-gold">{myRank === null ? '집계 중' : `${myRank}위`}</b></>}</div></div>}{accepted && !prerelease && !isVerification && myBestScore !== null && <p className="mt-2 text-xs text-text-secondary">내 최고점 <b className="text-white">{myBestScore.toLocaleString('ko-KR')}점</b></p>}{accepted && <div className="mt-2 text-xs text-text-secondary">{prerelease ? '사전 테스트 기록은 순위·월간 확정·Guild 2 점수에 반영되지 않습니다.' : isVerification ? '이 점수는 인증 세션의 판정에만 사용되며 다음 달 일반 랭킹에는 들어가지 않습니다.' : '점수와 순위는 서버가 입력 기록을 다시 계산한 결과입니다.'}</div>}<button className="btn-secondary mt-3 text-xs" onClick={onRetry}>다시 도전 준비</button></div>;
}

function VerificationChallengeCard({ state, isLoading, onStart }: { state: ArcadeVerificationState; isLoading: boolean; onStart: () => void }) {
  const attempts = state.attempts ?? [];
  const remaining = state.remaining_attempts ?? 0;
  const activeRun = state.active_run_id ?? null;
  return <section className="glass-card border-gold/40 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black tracking-[0.16em] text-gold">RECORD VERIFICATION</div><h2 className="mt-1 font-display text-2xl text-white">🏅 기록 인증 도전</h2><p className="mt-1 text-sm text-text-secondary">{state.period_name ?? '월간 Arcade'}의 보상권 기록을 학교 관리 환경에서 확인합니다.</p></div><span className="rounded-pill bg-gold/15 px-3 py-1 text-xs font-black text-gold">현재 {state.current_rank ? `${state.current_rank}위` : '순위 재계산 중'}</span></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-4"><VerifyStat label="잠정 SCORE" value={formatScore(state.provisional_score)} /><VerifyStat label="인증 기준" value={formatScore(state.verification_threshold)} /><VerifyStat label="사용 기회" value={`${state.used_attempts ?? 0}/${state.max_attempts ?? 3}`} /><VerifyStat label="남은 기회" value={`${remaining}회`} /></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-3">{Array.from({ length: state.max_attempts ?? 3 }, (_, index) => { const opportunity = index + 1; const attempt = [...attempts].reverse().find((row) => row.opportunity_number === opportunity && row.status !== 'RESTORED'); return <div key={opportunity} className="rounded-card-md border border-line bg-bg-deep p-3 text-xs"><b className="text-white">{opportunity}차</b><span className="float-right text-text-secondary">{attempt ? attemptStatusLabel(attempt) : '대기'}</span>{attempt?.official_score !== null && attempt?.official_score !== undefined && <div className="mt-2 font-display text-lg text-gold">{Number(attempt.official_score).toLocaleString('ko-KR')}점</div>}</div>; })}</div>
    {state.success_achieved && <p className="mt-4 rounded-card-md border border-success/40 bg-success/10 p-3 text-sm font-bold text-success">인증 기준을 이미 달성했어요. 남은 기회가 있다면 더 높은 공식 기록에 도전할 수 있습니다.</p>}
    {activeRun && <p className="mt-4 rounded-card-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">진행 중인 인증 run #{activeRun}이 있습니다. 페이지를 새로고침해 게임 화면을 잃었다면 선생님에게 기술 취소를 요청하세요. 이 경우 기회는 차감되지 않습니다.</p>}
    {state.session_status === 'COMPLETED' ? <p className="mt-4 text-sm font-bold text-text-secondary">이 인증 세션은 종료되었습니다. 최종 순위 재계산 결과를 기다려주세요.</p> : <button className="btn-primary mt-4 w-full" disabled={!state.can_attempt || isLoading || Boolean(activeRun)} onClick={onStart}>{isLoading ? '인증 준비 중...' : state.can_attempt ? '기록 인증 도전 시작' : '지금은 인증 도전을 시작할 수 없습니다'}</button>}
  </section>;
}

function VerifyStat({ label, value }: { label: string; value: string }) { return <div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="text-[10px] font-black text-text-muted">{label}</div><div className="mt-1 font-display text-lg text-white">{value}</div></div>; }
function formatScore(value: number | undefined) { return value === undefined ? '—' : `${Number(value).toLocaleString('ko-KR')}점`; }
function attemptStatusLabel(attempt: ArcadeVerificationAttempt) { if (attempt.status === 'TECHNICAL_CANCELLED') return '기술 취소'; if (attempt.status === 'RESTORED') return '복구됨'; if (attempt.status !== 'TERMINAL') return '진행 중'; if (!attempt.valid_run) return '유효 기록 없음'; return attempt.official_score === null ? '종료' : `${Number(attempt.official_score).toLocaleString('ko-KR')}점`; }
function periodStatusLabel(status: ArcadePeriodRow['status']) { return status === 'FINALIZED' ? '확정' : status === 'VERIFICATION' ? '인증 중' : status === 'READY_TO_FINALIZE' ? '확정 대기' : '진행 중'; }

function Bonus({ rank, points }: { rank: string; points: string }) { return <div className="rounded-card-md border border-line bg-bg-card px-3 py-2"><span className="text-xs text-text-secondary">{rank}</span><b className="float-right text-gold">{points}</b></div>; }
function LoadError({ detail, retry }: { detail: string; retry: () => void }) { return <div className="glass-card border-danger/40 p-5"><div className="font-black text-danger">Arcade 정보를 불러오지 못했습니다.</div><p className="mt-2 break-all text-xs text-text-secondary">{detail}</p><button className="btn-secondary mt-3" onClick={retry}>다시 시도</button></div>; }
function formatElapsed(ms: number) { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초`; }
function formatKstDateTime(value: string) { return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
