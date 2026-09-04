import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { arcadeErrorMessage, arcadeStudentRpc } from '@/lib/rpc/arcade_rpc';
import { recordsRpc, type ArcadeHistoryRow } from '@/lib/rpc/records_rpc';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { formatDateTime, formatNumber } from '@/lib/utils/format';

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
  status: 'ACTIVE' | 'FINALIZED';
}

const PAGE_SIZE = 20;

export function RecordsArcadePanel() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [selectedGameCode, setSelectedGameCode] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const catalogQ = useQuery({
    queryKey: ['records-arcade-catalog', classroomId],
    enabled: !!classroomId && !!studentId,
    queryFn: async () => {
      const [gamesResult, periodsResult] = await Promise.all([
        supabase
          .from('arcade_games')
          .select('id,code,internal_name,is_active,available_from,available_until')
          .eq('is_active', true)
          .order('id'),
        supabase
          .from('arcade_ranking_periods')
          .select('id,period_kind,display_name,contribution_year_month,starts_at,ends_at_exclusive,status')
          .eq('classroom_id', classroomId!)
          .in('status', ['ACTIVE', 'FINALIZED'])
          .order('starts_at', { ascending: false }),
      ]);
      if (gamesResult.error) throw gamesResult.error;
      if (periodsResult.error) throw periodsResult.error;
      return {
        games: (gamesResult.data ?? []) as ArcadeGameRow[],
        periods: (periodsResult.data ?? []) as ArcadePeriodRow[],
      };
    },
    staleTime: 60_000,
  });

  const periods = catalogQ.data?.periods ?? [];
  const games = catalogQ.data?.games ?? [];
  const defaultPeriod = useMemo(
    () => periods.find((row) => row.status === 'ACTIVE') ?? periods[0] ?? null,
    [periods],
  );
  const selectedPeriod = periods.find((row) => row.id === selectedPeriodId) ?? defaultPeriod;
  const selectedGame = games.find((row) => row.code === selectedGameCode) ?? games[0] ?? null;

  useEffect(() => {
    setPage(0);
  }, [selectedPeriod?.id, selectedGame?.code]);

  const leaderboardQ = useQuery({
    queryKey: ['records-arcade-leaderboard', studentId, selectedPeriod?.id, selectedGame?.code],
    enabled: !!studentId && !!selectedPeriod && !!selectedGame,
    queryFn: async () => {
      const result = await arcadeStudentRpc.getLeaderboard(supabase, {
        p_game_code: selectedGame!.code,
        p_period_id: selectedPeriod!.id,
      });
      if (result.success === false) throw new Error(arcadeErrorMessage(result));
      return result.data;
    },
    staleTime: 30_000,
  });

  const historyQ = useQuery({
    queryKey: ['records-arcade-history', studentId, selectedPeriod?.id, selectedGame?.code, page],
    enabled: !!studentId && !!selectedPeriod && !!selectedGame,
    queryFn: () => recordsRpc.myArcadeHistory(supabase, {
      p_period_id: selectedPeriod!.id,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
      p_game_code: selectedGame!.code,
    }),
    staleTime: 30_000,
  });

  if (catalogQ.isLoading) {
    return (
      <div className="py-14 flex flex-col items-center gap-3 text-text-muted">
        <LoadingSpinner size="lg" />
        <div className="text-sm font-bold">Arcade 기록을 불러오고 있어요.</div>
      </div>
    );
  }

  if (catalogQ.isError) {
    return <Feature4ErrorPanel domain="F4D" error={catalogQ.error} onRetry={() => void catalogQ.refetch()} />;
  }

  if (!periods.length) {
    return (
      <EmptyState
        emoji="🕹️"
        title="아직 기록을 볼 수 있는 Arcade 기간이 없어요"
        description="선생님이 Arcade 랭킹 기간을 활성화하거나 확정하면 이곳에서 개인 기록을 확인할 수 있습니다."
      />
    );
  }

  if (!games.length) {
    return <EmptyState emoji="🎮" title="현재 활성화된 Arcade 게임이 없어요" description="게임이 공개되면 기록을 확인할 수 있습니다." />;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-card-md border border-line bg-bg-deep/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge period={selectedPeriod} />
          <span className="text-xs text-text-muted font-bold">B.R.A.N.D 2.0 Arcade</span>
        </div>
        <div className="text-sm font-extrabold text-text-primary mt-2">Arcade에서 남긴 나의 기록</div>
        <p className="text-xs text-text-secondary mt-1">
          서버가 검증한 공식 시도와 인정 실패 기록을 기간별로 확인합니다. 교사가 무효 처리한 기록도 삭제하지 않고 상태를 남깁니다.
        </p>
      </section>

      <section className="bg-bg-card border border-line rounded-card-md p-4 space-y-4">
        <div>
          <div className="text-2xs font-black text-text-muted mb-2">랭킹 기간</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {periods.map((period) => (
              <button
                key={period.id}
                type="button"
                onClick={() => setSelectedPeriodId(period.id)}
                className={`shrink-0 rounded-pill border px-3 py-2 text-xs font-black transition ${selectedPeriod?.id === period.id ? 'border-gold bg-gold/10 text-gold' : 'border-line bg-bg-deep text-text-secondary hover:border-gold/25'}`}
              >
                {period.display_name}
                <span className="ml-1 opacity-70">{period.status === 'FINALIZED' ? '확정' : '진행 중'}</span>
              </button>
            ))}
          </div>
        </div>

        {games.length > 1 && (
          <div>
            <div className="text-2xs font-black text-text-muted mb-2">게임</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {games.map((game) => (
                <button
                  key={game.code}
                  type="button"
                  onClick={() => setSelectedGameCode(game.code)}
                  className={`shrink-0 rounded-pill border px-3 py-2 text-xs font-black transition ${selectedGame?.code === game.code ? 'border-bv bg-bv/10 text-bv' : 'border-line bg-bg-deep text-text-secondary hover:border-bv/25'}`}
                >
                  {gameLabel(game)}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {(leaderboardQ.isError || historyQ.isError) ? (
        <Feature4ErrorPanel
          domain="F4D"
          error={leaderboardQ.error ?? historyQ.error}
          onRetry={() => {
            void leaderboardQ.refetch();
            void historyQ.refetch();
          }}
        />
      ) : (leaderboardQ.isLoading || historyQ.isLoading) ? (
        <div className="py-12 flex justify-center"><LoadingSpinner size="lg" /></div>
      ) : (
        <>
          <SummaryCards
            myRank={leaderboardQ.data?.my_rank ?? null}
            myScore={leaderboardQ.data?.my_score ?? null}
            totalAttempts={historyQ.data?.total_count ?? 0}
            period={selectedPeriod!}
          />
          <HistoryList rows={historyQ.data?.rows ?? []} total={historyQ.data?.total_count ?? 0} page={page} setPage={setPage} />
        </>
      )}
    </div>
  );
}

function SummaryCards({
  myRank,
  myScore,
  totalAttempts,
  period,
}: {
  myRank: number | null;
  myScore: number | null;
  totalAttempts: number;
  period: ArcadePeriodRow;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <Metric label="내 최고 점수" value={myScore == null ? '-' : formatNumber(myScore)} />
      <Metric label="내 현재 순위" value={myRank == null ? '-' : `${formatNumber(myRank)}위`} />
      <Metric label="완료 시도" value={`${formatNumber(totalAttempts)}회`} />
      <Metric label="기간 종류" value={period.period_kind === 'MONTHLY' ? '월간' : '시즌'} />
    </div>
  );
}

function HistoryList({ rows, total, page, setPage }: { rows: ArcadeHistoryRow[]; total: number; page: number; setPage: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <section className="bg-bg-card border border-line rounded-card-md p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-display text-lg text-text-primary">🎮 내 Arcade 시도 기록</h3>
          <p className="text-xs text-text-secondary mt-1">준비 중에 종료된 세션은 제외하고, 서버에 제출되어 검증 또는 거절된 시도만 표시합니다.</p>
        </div>
        <span className="text-2xs text-text-muted font-black">총 {formatNumber(total)}건</span>
      </div>

      {!rows.length ? (
        <CompactEmpty text="이 기간에 완료된 Arcade 시도가 없습니다." />
      ) : (
        <div className="divide-y divide-line/60">
          {rows.map((row) => <RunRow key={row.run_id} row={row} />)}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
          <button type="button" className="btn-secondary text-xs" disabled={page <= 0} onClick={() => setPage(Math.max(0, page - 1))}>← 이전</button>
          <div className="text-2xs text-text-muted font-black">{page + 1} / {pageCount}</div>
          <button type="button" className="btn-secondary text-xs" disabled={page + 1 >= pageCount} onClick={() => setPage(Math.min(pageCount - 1, page + 1))}>다음 →</button>
        </div>
      )}
    </section>
  );
}

function RunRow({ row }: { row: ArcadeHistoryRow }) {
  const state = runState(row);
  return (
    <div className="py-3 flex gap-3 items-start">
      <div className="w-9 h-9 rounded-full bg-bg-deep border border-line flex items-center justify-center shrink-0">{state.emoji}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-extrabold text-text-primary">{friendlyGameName(row)}</div>
            <div className="text-2xs text-text-muted font-bold mt-1">{formatDateTime(row.occurred_at)}</div>
          </div>
          <span className={`rounded-pill border px-2.5 py-1 text-2xs font-black ${state.className}`}>{state.label}</span>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs font-bold">
          {row.official_score != null && <span className="text-gold">점수 {formatNumber(row.official_score)}</span>}
          {row.official_duration_ms != null && <span className="text-text-secondary">플레이 {durationLabel(row.official_duration_ms)}</span>}
        </div>

        {row.status === 'REJECTED' && (
          <div className="text-xs text-danger mt-2 break-words">{row.rejection_reason || row.rejection_code || '공식 기록으로 인정되지 않았습니다.'}</div>
        )}
        {row.is_invalidated && (
          <div className="text-xs text-warning mt-2 break-words">{row.invalidation_reason || '교사 확인에 따라 이 기록은 공식 순위에서 제외되었습니다.'}</div>
        )}
      </div>
    </div>
  );
}

function SourceBadge({ period }: { period: ArcadePeriodRow | null }) {
  if (!period) return null;
  if (period.status === 'FINALIZED' && period.period_kind === 'MONTHLY') {
    return <span className="rounded-pill border border-gold/35 bg-gold/10 px-2.5 py-1 text-2xs font-black text-gold">공식 확정 기록</span>;
  }
  if (period.status === 'FINALIZED') {
    return <span className="rounded-pill border border-bv/35 bg-bv/10 px-2.5 py-1 text-2xs font-black text-bv">종료된 시즌 기록</span>;
  }
  return <span className="rounded-pill border border-brand-primary/35 bg-brand-primary/10 px-2.5 py-1 text-2xs font-black text-brand-primary">실시간 기록 · 변동 가능</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-card p-3">
      <div className="text-2xs text-text-muted font-black">{label}</div>
      <div className="font-display text-lg text-gold mt-1">{value}</div>
    </div>
  );
}

function runState(row: ArcadeHistoryRow) {
  if (row.is_invalidated) return { emoji: '🚫', label: '무효 처리', className: 'border-warning/35 bg-warning/10 text-warning' };
  if (row.status === 'REJECTED') return { emoji: '⚠️', label: '인정 실패', className: 'border-danger/35 bg-danger/10 text-danger' };
  return { emoji: '✅', label: '공식 인정', className: 'border-success/35 bg-success/10 text-success' };
}

function gameLabel(game: ArcadeGameRow) {
  if (game.code === 'focus_reaction_01') return '집중 반응 #01';
  return game.internal_name || game.code;
}

function friendlyGameName(row: ArcadeHistoryRow) {
  if (row.game_code === 'focus_reaction_01') return '집중 반응 #01';
  return row.game_name || row.game_code;
}

function durationLabel(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}분 ${rest}초` : `${rest}초`;
}

function CompactEmpty({ text }: { text: string }) {
  return <div className="rounded-card-md border border-dashed border-line bg-bg-deep/60 px-4 py-7 text-center text-xs font-bold text-text-muted">{text}</div>;
}
