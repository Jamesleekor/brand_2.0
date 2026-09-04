import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import {
  recordsRpc,
  type GuildMissionHistoryRow,
  type GuildMissionScoreSummaryRow,
  type GuildMonthlyHistoryRow,
} from '@/lib/rpc/records_rpc';
import { formatDateTime, formatNumber } from '@/lib/utils/format';

type GuildRecordTab = 'MISSION' | 'MONTHLY';

const num = (value: unknown) => formatNumber(Number(value ?? 0));
const monthLabel = (value: string) => {
  const [year, month] = value.split('-');
  if (!year || !month) return value;
  return `${year}년 ${Number(month)}월`;
};

const missionResultLabel = (value: string | null | undefined) => {
  if (!value) return '결과 미기록';
  const map: Record<string, string> = {
    CLEARED: '클리어',
    FAILED: '미달성',
    SUCCESS: '성공',
    PARTIAL: '부분 달성',
    VOIDED: '무효',
  };
  return map[value] ?? value;
};

const scoreStatusLabel = (value: string | null | undefined) => {
  if (!value) return '집계 전';
  const map: Record<string, string> = {
    FINAL: '확정',
    FINALIZED: '확정',
    READY: '집계 완료',
    NOT_READY: '집계 전',
  };
  return map[value] ?? value;
};

export function RecordsGuildPanel() {
  const studentId = useStudentId();
  const [tab, setTab] = useState<GuildRecordTab>('MISSION');
  const query = useQuery({
    queryKey: ['records-guild-history', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const [missions, missionScores, monthly] = await Promise.all([
        recordsRpc.myGuildMissionHistory(supabase),
        recordsRpc.myGuildMissionScoreSummary(supabase),
        recordsRpc.myGuildMonthlyHistory(supabase),
      ]);
      return { missions, missionScores, monthly };
    },
    staleTime: 60_000,
  });

  const finalizedMissions = useMemo(
    () => (query.data?.missions ?? []).filter((row) => row.lifecycle_state === 'FINALIZED'),
    [query.data?.missions],
  );

  if (query.isLoading) {
    return (
      <div className="py-14 flex flex-col items-center gap-3 text-text-muted">
        <LoadingSpinner size="lg" />
        <div className="text-sm font-bold">길드 기록을 불러오고 있어요.</div>
      </div>
    );
  }

  if (query.isError) {
    return <Feature4ErrorPanel domain="F4D" error={query.error} onRetry={() => void query.refetch()} />;
  }

  const missionScores = query.data?.missionScores ?? [];
  const monthly = query.data?.monthly ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-card-md border border-line bg-bg-deep/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge label="B.R.A.N.D 2.0" />
          <span className="text-xs text-text-muted font-bold">길드 활동 기록</span>
        </div>
        <div className="text-sm font-extrabold text-text-primary mt-2">길드에서 남긴 나의 기록</div>
        <div className="text-xs text-text-secondary mt-1">
          공식 미션의 확정 결과와 월간 길드 결산을 분리해 보여줍니다. 월간 결산은 선생님이 FINAL 처리한 스냅샷만 전시됩니다.
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <TabButton
          active={tab === 'MISSION'}
          onClick={() => setTab('MISSION')}
          emoji="⚔️"
          title="길드 미션"
          subtitle={`${formatNumber(finalizedMissions.length)}건`}
        />
        <TabButton
          active={tab === 'MONTHLY'}
          onClick={() => setTab('MONTHLY')}
          emoji="🏰"
          title="월간 결산"
          subtitle={`${formatNumber(monthly.length)}건`}
        />
      </div>

      {tab === 'MISSION' ? (
        <MissionRecords missions={finalizedMissions} scores={missionScores} />
      ) : (
        <MonthlyRecords rows={monthly} />
      )}
    </div>
  );
}

function MissionRecords({ missions, scores }: { missions: GuildMissionHistoryRow[]; scores: GuildMissionScoreSummaryRow[] }) {
  return (
    <div className="space-y-4">
      <section className="bg-bg-card border border-line rounded-card-md p-4">
        <SectionHeading emoji="📈" title="월별 길드 미션 기여" description="월별 공식 미션 점수 집계입니다. 월 마감 전 값은 이후 갱신될 수 있습니다." />
        {scores.length === 0 ? (
          <CompactEmpty text="아직 월별 길드 미션 점수 기록이 없습니다." />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
            {scores.map((row) => (
              <div key={row.year_month} className="rounded-card-md border border-line bg-bg-deep p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-black text-text-secondary">{monthLabel(row.year_month)}</div>
                  <span className="text-2xs font-black text-text-muted">{scoreStatusLabel(row.status)}</span>
                </div>
                <div className="font-display text-2xl text-bv mt-1">{num(row.points)}점</div>
                <div className="text-2xs text-text-muted font-bold mt-1">최대 {num(row.max_points)}점</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-bg-card border border-gold/25 rounded-card-md p-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <SourceBadge label="공식 확정 기록" tone="gold" />
          <span className="text-xs text-text-muted font-bold">FINALIZED 미션만 표시</span>
        </div>
        <SectionHeading emoji="🏅" title="확정된 길드 미션" description="공개 후 최종 판정까지 완료된 미션의 결과와 나의 등급입니다." />
        {missions.length === 0 ? (
          <div className="mt-3">
            <EmptyState emoji="🛡️" title="아직 확정된 길드 미션 기록이 없어요" description="길드 미션이 FINALIZED 상태가 되면 결과가 이곳에 남습니다." />
          </div>
        ) : (
          <div className="divide-y divide-line/60 mt-3">
            {missions.map((row) => <MissionRow key={row.mission_id} row={row} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function MissionRow({ row }: { row: GuildMissionHistoryRow }) {
  return (
    <div className="py-3 flex flex-col sm:flex-row sm:items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-extrabold text-text-primary break-words">{row.title}</div>
        {row.description && <div className="text-xs text-text-secondary mt-1 line-clamp-2">{row.description}</div>}
        <div className="flex flex-wrap gap-1.5 mt-2">
          <Pill label="길드 결과" value={missionResultLabel(row.guild_result)} tone={row.guild_result === 'CLEARED' || row.guild_result === 'SUCCESS' ? 'success' : 'default'} />
          <Pill label="내 등급" value={row.my_grade || '미기록'} tone="bv" />
        </div>
      </div>
      <div className="text-2xs text-text-muted font-bold shrink-0">
        {row.due_at ? `마감 ${formatDateTime(row.due_at)}` : 'FINALIZED'}
      </div>
    </div>
  );
}

function MonthlyRecords({ rows }: { rows: GuildMonthlyHistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="bg-bg-card border border-gold/25 rounded-card-md p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <SourceBadge label="공식 확정 기록" tone="gold" />
          <span className="text-xs text-text-muted font-bold">Guild5 FINAL snapshot</span>
        </div>
        <EmptyState
          emoji="🏰"
          title="아직 확정된 월간 길드 결산이 없어요"
          description="월말 길드 결산이 FINAL 처리되면 당시의 내 기여도, 길드 GS, 최종 순위와 정복 결과가 이곳에 고정 기록됩니다."
        />
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => <MonthlyCard key={`${row.year_month}-${row.version_no}`} row={row} />)}
    </div>
  );
}

function MonthlyCard({ row }: { row: GuildMonthlyHistoryRow }) {
  const me = row.my_contribution ?? ({} as GuildMonthlyHistoryRow['my_contribution']);
  const guild = row.my_guild ?? ({} as GuildMonthlyHistoryRow['my_guild']);
  const territoryName = row.territory && typeof row.territory.territory_name_snapshot === 'string'
    ? row.territory.territory_name_snapshot
    : null;

  return (
    <section className="bg-bg-card border border-gold/25 rounded-card-lg overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-line bg-gradient-to-r from-brand-primary/10 to-gold/10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge label="공식 확정 기록" tone="gold" />
              <span className="text-2xs text-text-muted font-black">FINAL v{row.version_no}</span>
            </div>
            <h3 className="font-display text-xl text-text-primary mt-2">{monthLabel(row.year_month)} 길드 결산</h3>
            <div className="text-sm text-text-secondary font-bold mt-1">
              {guild.guild_name_at_close || me.guild_name_at_close || '당시 길드'} · 최종 <span className="text-gold font-black">{guild.rank_position ?? '-'}위</span>
            </div>
            <div className="text-2xs text-text-muted font-bold mt-1">확정 {formatDateTime(row.finalized_at)}</div>
          </div>
          <div className="text-right">
            <div className="text-2xs font-black text-text-muted">최종 Guild GS</div>
            <div className="font-display text-3xl text-gold mt-1">{num(guild.total_gs)}</div>
            <div className="text-2xs text-text-muted font-bold mt-1">누적 FINAL GS {num(guild.cumulative_final_gs)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4">
          <Metric label="내 최종 기여" value={`${num(me.final_contribution)}점`} />
          <Metric label="기본 기여" value={`${num(me.basic_total)} / 900`} />
          <Metric label="Arcade 가점" value={`+${num(me.arcade_applied)} / 90`} />
          <Metric label="정복 결과" value={territoryName || '영토 없음'} />
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <div className="text-xs font-black text-text-secondary mb-2">내 기여도 세부</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <SmallMetric label="동료평가" value={me.peer_points} />
            <SmallMetric label="길드 미션" value={me.mission_points} />
            <SmallMetric label="세션" value={me.session_points} />
            <SmallMetric label="관찰" value={me.observation_points} />
          </div>
        </div>

        <div>
          <div className="text-xs font-black text-text-secondary mb-2">최종 길드 순위</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {(row.rankings ?? []).map((rank) => (
              <div
                key={rank.guild_id}
                className={`rounded-card-md border p-3 ${Number(rank.guild_id) === Number(me.guild_id) ? 'border-bv bg-bv/10' : Number(rank.rank_position) <= 3 ? 'border-gold/30 bg-gold/5' : 'border-line bg-bg-deep'}`}
              >
                <div className="text-2xs font-black text-text-muted">{rank.rank_position}위</div>
                <div className="text-xs font-black text-text-primary truncate mt-1">{rank.guild_name_at_close}</div>
                <div className="font-display text-lg text-gold mt-1">{num(rank.total_gs)} GS</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SourceBadge({ label, tone = 'bv' }: { label: string; tone?: 'bv' | 'gold' }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-2xs font-black ${tone === 'gold' ? 'border-gold/35 bg-gold/10 text-gold' : 'border-bv/35 bg-bv/10 text-bv'}`}>
      {label}
    </span>
  );
}

function TabButton({ active, onClick, emoji, title, subtitle }: { active: boolean; onClick: () => void; emoji: string; title: string; subtitle: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-card-md border p-3 text-left transition ${active ? 'border-gold/50 bg-gold/10 text-gold' : 'border-line bg-bg-card text-text-secondary hover:border-gold/25'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-black text-sm"><span className="mr-1.5">{emoji}</span>{title}</span>
        <span className="text-2xs font-bold text-text-muted">{subtitle}</span>
      </div>
    </button>
  );
}

function SectionHeading({ emoji, title, description }: { emoji: string; title: string; description: string }) {
  return (
    <div>
      <div className="text-sm font-extrabold text-text-primary"><span className="mr-1.5">{emoji}</span>{title}</div>
      <div className="text-xs text-text-secondary mt-1">{description}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep/80 p-3">
      <div className="text-2xs font-black text-text-muted">{label}</div>
      <div className="text-sm font-black text-text-primary mt-1 truncate">{value}</div>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-card-sm border border-line bg-bg-deep px-3 py-2">
      <div className="text-2xs text-text-muted font-bold">{label}</div>
      <div className="text-sm font-black text-text-primary mt-0.5">{num(value)}점</div>
    </div>
  );
}

function Pill({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'success' | 'bv' }) {
  const toneClass = tone === 'success'
    ? 'border-success/30 bg-success/10 text-success'
    : tone === 'bv'
      ? 'border-bv/30 bg-bv/10 text-bv'
      : 'border-line bg-bg-deep text-text-secondary';
  return <span className={`inline-flex rounded-full border px-2 py-1 text-2xs font-black ${toneClass}`}>{label} · {value}</span>;
}

function CompactEmpty({ text }: { text: string }) {
  return <div className="rounded-card-md border border-dashed border-line bg-bg-deep/60 px-4 py-6 text-center text-xs font-bold text-text-muted mt-3">{text}</div>;
}
