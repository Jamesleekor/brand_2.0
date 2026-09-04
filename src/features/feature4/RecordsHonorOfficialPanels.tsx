import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { arcadeErrorMessage, arcadeStudentRpc, type ArcadeLeaderboardResult } from '@/lib/rpc/arcade_rpc';
import { recordsRpc, type GuildMonthlyHistoryRow } from '@/lib/rpc/records_rpc';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { formatDateTime, formatNumber } from '@/lib/utils/format';

interface ArcadeGameRow {
  id: number;
  code: string;
  internal_name: string;
  available_from: string;
  available_until: string | null;
}

interface FinalizedArcadePeriodRow {
  id: number;
  display_name: string;
  contribution_year_month: string | null;
  starts_at: string;
  ends_at_exclusive: string;
}

interface ArcadeOfficialBoard {
  period: FinalizedArcadePeriodRow;
  game: ArcadeGameRow;
  leaderboard: ArcadeLeaderboardResult;
}

export function RecordsHonorOfficialPanels() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();

  const query = useQuery({
    queryKey: ['records-honor-official-domain-history', classroomId, studentId],
    enabled: !!classroomId && !!studentId,
    queryFn: async () => {
      const [guildHistory, gamesResult, periodsResult] = await Promise.all([
        recordsRpc.myGuildMonthlyHistory(supabase),
        supabase
          .from('arcade_games')
          .select('id,code,internal_name,available_from,available_until')
          .order('id'),
        supabase
          .from('arcade_ranking_periods')
          .select('id,display_name,contribution_year_month,starts_at,ends_at_exclusive')
          .eq('classroom_id', classroomId!)
          .eq('period_kind', 'MONTHLY')
          .eq('status', 'FINALIZED')
          .order('starts_at', { ascending: false })
          .limit(12),
      ]);
      if (gamesResult.error) throw gamesResult.error;
      if (periodsResult.error) throw periodsResult.error;

      const games = (gamesResult.data ?? []) as ArcadeGameRow[];
      const periods = (periodsResult.data ?? []) as FinalizedArcadePeriodRow[];
      const requests: Array<Promise<ArcadeOfficialBoard>> = [];
      for (const period of periods) {
        for (const game of games) {
          if (!gameBelongsToPeriod(game, period)) continue;
          requests.push((async () => {
            const result = await arcadeStudentRpc.getLeaderboard(supabase, {
              p_game_code: game.code,
              p_period_id: period.id,
            });
            if (result.success === false) throw new Error(arcadeErrorMessage(result));
            return { period, game, leaderboard: result.data };
          })());
        }
      }

      return {
        guildHistory,
        arcadeBoards: await Promise.all(requests),
      };
    },
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <div className="py-12 flex flex-col items-center gap-3 text-text-muted">
        <LoadingSpinner size="lg" />
        <div className="text-xs font-bold">길드·Arcade 공식 기록을 확인하고 있어요.</div>
      </div>
    );
  }

  if (query.isError) {
    return <Feature4ErrorPanel domain="F4D" error={query.error} onRetry={() => void query.refetch()} />;
  }

  return (
    <div className="space-y-5">
      <OfficialGuildSection rows={query.data?.guildHistory ?? []} />
      <OfficialArcadeSection boards={query.data?.arcadeBoards ?? []} />
    </div>
  );
}

function OfficialGuildSection({ rows }: { rows: GuildMonthlyHistoryRow[] }) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const selected = rows.find((row) => row.year_month === selectedMonth) ?? rows[0] ?? null;

  return (
    <section>
      <SectionTitle emoji="🛡️" title="길드 공식 기록" description="월말 FINAL 결산에 고정된 길드 GS·순위·정복 결과" />
      {!selected ? (
        <EmptyState emoji="🏰" title="아직 확정된 길드 월간 기록이 없어요" description="첫 월간 길드 결산이 FINAL 처리되면 5개 길드의 최종 기록이 이곳에 전시됩니다." />
      ) : (
        <div className="bg-bg-card border border-gold/25 rounded-card-md p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <OfficialBadge />
              <span className="text-2xs text-text-muted font-black">Guild FINAL snapshot</span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto max-w-full">
              {rows.map((row) => (
                <button
                  key={row.year_month}
                  type="button"
                  onClick={() => setSelectedMonth(row.year_month)}
                  className={`shrink-0 rounded-pill border px-2.5 py-1.5 text-2xs font-black ${selected.year_month === row.year_month ? 'border-gold bg-gold/10 text-gold' : 'border-line bg-bg-deep text-text-secondary'}`}
                >
                  {monthLabel(row.year_month)}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 text-xs text-text-muted font-bold">확정 {formatDateTime(selected.finalized_at)}</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 mt-3">
            {(selected.rankings ?? []).map((rank) => (
              <div key={rank.guild_id} className={`rounded-card-md border p-3 ${rank.rank_position <= 3 ? 'border-gold/30 bg-gold/5' : 'border-line bg-bg-deep'}`}>
                <div className="text-2xs font-black text-text-muted">{rank.rank_position}위</div>
                <div className="text-sm font-black text-text-primary truncate mt-1">{rank.guild_name_at_close}</div>
                <div className="font-display text-xl text-gold mt-1">{formatNumber(rank.total_gs)} GS</div>
                {rank.territory && <div className="text-2xs text-bv font-bold mt-1 truncate">🏴 {rank.territory}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function OfficialArcadeSection({ boards }: { boards: ArcadeOfficialBoard[] }) {
  const periods = useMemo(() => {
    const map = new Map<number, FinalizedArcadePeriodRow>();
    boards.forEach((board) => map.set(board.period.id, board.period));
    return Array.from(map.values()).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  }, [boards]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const selectedPeriod = periods.find((row) => row.id === selectedPeriodId) ?? periods[0] ?? null;
  const selectedBoards = selectedPeriod ? boards.filter((board) => board.period.id === selectedPeriod.id) : [];

  return (
    <section>
      <SectionTitle emoji="🕹️" title="Arcade 공식 기록" description="월간 순위가 FINALIZED 된 뒤 보존되는 게임별 공식 Top 10" />
      {!selectedPeriod ? (
        <EmptyState emoji="🎮" title="아직 확정된 Arcade 월간 기록이 없어요" description="현재 월간 랭킹 기간이 종료되고 순위가 확정되면 게임별 Top 10이 이곳에 고정 전시됩니다." />
      ) : (
        <div className="space-y-3">
          <div className="bg-bg-card border border-gold/25 rounded-card-md p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><OfficialBadge /><span className="text-xs font-black text-text-primary">월간 Arcade FINAL</span></div>
            <div className="flex gap-1.5 overflow-x-auto max-w-full">
              {periods.map((period) => (
                <button
                  key={period.id}
                  type="button"
                  onClick={() => setSelectedPeriodId(period.id)}
                  className={`shrink-0 rounded-pill border px-2.5 py-1.5 text-2xs font-black ${selectedPeriod.id === period.id ? 'border-gold bg-gold/10 text-gold' : 'border-line bg-bg-deep text-text-secondary'}`}
                >
                  {period.display_name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {selectedBoards.map((board) => (
              <div key={`${board.period.id}-${board.game.code}`} className="bg-bg-card border border-line rounded-card-md p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-extrabold text-text-primary">{gameLabel(board.game)}</div>
                    <div className="text-2xs text-text-muted font-bold mt-1">{board.period.display_name}</div>
                  </div>
                  <span className="text-2xs text-gold font-black">TOP 10</span>
                </div>
                {!board.leaderboard.top10.length ? (
                  <div className="text-xs text-text-muted font-bold py-5 text-center">확정 기록 없음</div>
                ) : (
                  <div className="mt-3 divide-y divide-line/60">
                    {board.leaderboard.top10.map((rank) => (
                      <div key={rank.student_id} className="py-2 flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0 flex items-center gap-2">
                          <span className={`font-display w-5 text-center ${rank.rank <= 3 ? 'text-gold' : 'text-text-muted'}`}>{rank.rank}</span>
                          <span className="font-black text-text-primary truncate">{rank.student_name}</span>
                        </div>
                        <span className="font-mono font-black text-bv shrink-0">{formatNumber(rank.official_score)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function gameBelongsToPeriod(game: ArcadeGameRow, period: FinalizedArcadePeriodRow) {
  const availableFrom = `${game.available_from}T00:00:00Z`;
  if (availableFrom >= period.ends_at_exclusive) return false;
  if (!game.available_until) return true;
  const availableUntilExclusive = `${game.available_until}T23:59:59Z`;
  return availableUntilExclusive >= period.starts_at;
}

function gameLabel(game: ArcadeGameRow) {
  if (game.code === 'focus_reaction_01') return '집중 반응 #01';
  return game.internal_name || game.code;
}

function monthLabel(value: string) {
  const [year, month] = value.split('-');
  if (!year || !month) return value;
  return `${year}.${String(Number(month)).padStart(2, '0')}`;
}

function OfficialBadge() {
  return <span className="rounded-pill border border-gold/35 bg-gold/10 px-2.5 py-1 text-2xs font-black text-gold">공식 확정 기록</span>;
}

function SectionTitle({ emoji, title, description }: { emoji: string; title: string; description: string }) {
  return (
    <div className="mb-2">
      <h2 className="font-display text-lg text-brand-gradient">{emoji} {title}</h2>
      <div className="text-xs text-text-muted font-bold mt-1">{description}</div>
    </div>
  );
}
