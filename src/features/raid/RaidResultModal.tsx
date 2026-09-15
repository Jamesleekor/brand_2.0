import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LoadingSpinner } from '@/components/shared/components';
import {
  raidStudentRpc,
  type RaidResult,
  type RaidRankingRow,
} from '@/lib/rpc/raid_student_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

type Tab = 'ranking' | 'mine';

export function RaidResultModal({
  raidId,
  open,
  onClose,
}: {
  raidId: number;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('ranking');

  const resultQuery = useQuery({
    queryKey: ['raid-result', raidId],
    enabled: open && raidId > 0,
    queryFn: async () => {
      const result = await raidStudentRpc.result(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (open) setTab('ranking');
  }, [open]);

  if (!open) return null;

  const result = resultQuery.data;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-card-lg border border-yellow-300/35 bg-[#07111f] shadow-[0_0_65px_rgba(250,204,21,0.12)]">
        <header className="flex items-start justify-between gap-4 border-b border-white/15 px-5 py-4">
          <div>
            <div className="text-xs font-black tracking-[0.18em] text-yellow-100">
              레이드 결과
            </div>
            <h2 className="mt-1 font-display text-2xl text-white">
              {result?.raid.title ?? '전투 결과 집계'}
            </h2>
            {result && (
              <div className="mt-1 text-xs font-bold text-cyan-100">
                {result.raid.boss_name} ·{' '}
                {result.raid.status === 'COMPLETED' ? '토벌 성공' : '전투 종료'}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-card-md border border-white/20 bg-white/5 px-3 py-2 text-xs font-black text-white hover:bg-white/10"
          >
            닫기 ✕
          </button>
        </header>

        <div className="flex border-b border-white/15 bg-black/15 px-4 pt-3">
          <TabButton active={tab === 'ranking'} onClick={() => setTab('ranking')}>
            전체 순위
          </TabButton>
          <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>
            나의 전투 기록
          </TabButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
          {resultQuery.isLoading || !result ? (
            resultQuery.isError ? (
              <div className="rounded-card-md border border-red-300/35 bg-red-950/35 p-6 text-center">
                <div className="text-3xl">⚠️</div>
                <div className="mt-2 text-sm font-black text-white">
                  결과를 불러오지 못했습니다.
                </div>
                <div className="mt-2 break-all text-xs font-bold text-red-100">
                  {resultQuery.error instanceof Error
                    ? resultQuery.error.message
                    : '알 수 없는 오류'}
                </div>
              </div>
            ) : (
              <div className="flex min-h-72 items-center justify-center">
                <LoadingSpinner size="lg" />
              </div>
            )
          ) : tab === 'ranking' ? (
            <RankingTable result={result} />
          ) : (
            <MyBattleRecord result={result} />
          )}
        </div>
      </div>
    </div>
  );
}

function RankingTable({ result }: { result: RaidResult }) {
  return (
    <div className="overflow-x-auto rounded-card-md border border-white/15">
      <table className="w-full min-w-[1080px] table-fixed text-left">
        <colgroup>
          <col className="w-[66px]" />
          <col className="w-[124px]" />
          <col className="w-[174px]" />
          <col className="w-[126px]" />
          <col className="w-[96px]" />
          <col className="w-[86px]" />
          <col className="w-[96px]" />
          <col className="w-[112px]" />
          <col className="w-[90px]" />
        </colgroup>
        <thead className="bg-black/25">
          <tr className="text-sm font-black text-cyan-100">
            <th className="px-2 py-3.5 text-center">순위</th>
            <th className="px-2 py-3.5">길드</th>
            <th className="px-2 py-3.5">이름</th>
            <th className="px-2 py-3.5 text-right">피해량</th>
            <th className="px-2 py-3.5 text-right">치명타율</th>
            <th className="px-2 py-3.5 text-right">기여도</th>
            <th className="px-2 py-3.5 text-right">보유 편린</th>
            <th className="px-2 py-3.5 text-right">공명력</th>
            <th className="px-2 py-3.5 text-center">보상</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {result.ranking.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-10 text-center text-base font-black text-yellow-100">
                유효 공격 기록이 없습니다.
              </td>
            </tr>
          ) : (
            result.ranking.map((row) => <RankingRow key={row.student_id} row={row} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

function RankingRow({ row }: { row: RaidRankingRow }) {
  const top = row.final_rank <= 3;

  return (
    <tr
      className={cn(
        'text-[15px] font-bold text-white',
        top && 'bg-yellow-400/5',
      )}
    >
      <td className="px-2 py-3.5 text-center">
        <span
          className={cn(
            'inline-flex min-w-9 items-center justify-center rounded-full px-2.5 py-1.5 text-base font-black',
            row.final_rank === 1
              ? 'bg-yellow-300 text-[#241300]'
              : row.final_rank === 2
                ? 'bg-white/85 text-[#111827]'
                : row.final_rank === 3
                  ? 'bg-amber-500 text-[#2b1600]'
                  : 'border border-cyan-300/20 bg-cyan-500/5 text-cyan-100',
          )}
        >
          {row.final_rank}
        </span>
      </td>

      <td className="px-2 py-3.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {row.guild_logo_url ? (
            <img
              src={row.guild_logo_url}
              alt=""
              className="h-6 w-6 flex-none rounded-full border border-cyan-300/20 object-cover"
            />
          ) : (
            <span className="flex-none text-cyan-100">◆</span>
          )}
          <span className="truncate text-[13px] font-black text-cyan-100">
            {row.guild_name || '무소속'}
          </span>
        </div>
      </td>

      <td className="px-2 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          {row.equipped_character_image_url ? (
            <img
              src={row.equipped_character_image_url}
              alt=""
              className="h-10 w-10 flex-none rounded-full border border-white/15 bg-black/25 object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-white/15 bg-black/25">
              ✦
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate font-black text-white">
              {row.brand_name || row.name}
            </div>
            {row.brand_name && (
              <div className="mt-0.5 truncate text-[11px] font-bold text-yellow-100">
                {row.name}
              </div>
            )}
          </div>
        </div>
      </td>

      <td className="px-2 py-3.5 text-right font-mono text-[15px] font-black text-white">
        {formatNumber(row.total_damage)}
      </td>
      <td className="px-2 py-3.5 text-right font-mono text-[15px] font-black text-yellow-100">
        {formatDecimal(row.crit_rate)}%
      </td>
      <td className="px-2 py-3.5 text-right font-mono text-[15px] font-black text-emerald-100">
        {formatDecimal(row.damage_share_percent)}%
      </td>
      <td className="px-2 py-3.5 text-right font-mono text-[15px] text-cyan-100">
        {formatNumber(row.owned_shard_count)}종
      </td>
      <td className="px-2 py-3.5 text-right font-mono text-[15px] font-black text-yellow-100">
        {formatNumber(row.raid_power)}
      </td>
      <td className="px-2 py-3.5 text-center text-[13px] font-black text-cyan-100">
        {formatReward(row.reward_snapshot)}
      </td>
    </tr>
  );
}

function MyBattleRecord({ result }: { result: RaidResult }) {
  const me = result.me;

  if (!me) {
    return (
      <div className="rounded-card-md border border-dashed border-cyan-300/25 bg-cyan-500/5 p-8 text-center">
        <div className="text-3xl">📭</div>
        <div className="mt-2 text-sm font-black text-white">
          이 레이드의 개인 기록을 찾을 수 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <RecordCard label="총 피해량" value={formatNumber(me.total_damage)} accent="white" />
        <RecordCard label="평균 피해량" value={formatDecimal(me.average_damage)} accent="cyan" />
        <RecordCard label="치명타 횟수" value={`${formatNumber(me.crit_count)}회`} accent="gold" />
        <RecordCard label="실제 치명타율" value={`${formatDecimal(me.actual_crit_rate)}%`} accent="gold" />
        <RecordCard label="전체 피해 기여도" value={`${formatDecimal(me.damage_share_percent)}%`} accent="cyan" />
      </div>

      <div className="mt-4 rounded-card-lg border border-yellow-300/35 bg-yellow-400/10 p-6 text-center">
        <div className="text-xs font-black tracking-[0.15em] text-yellow-100">최종 순위</div>
        <div className="mt-2 font-display text-5xl text-white">
          {me.final_rank ? `${me.final_rank}위` : '—'}
        </div>
      </div>
    </div>
  );
}

function RecordCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'white' | 'cyan' | 'gold';
}) {
  const tone = {
    white: 'border-white/20 bg-white/5 text-white',
    cyan: 'border-cyan-300/30 bg-cyan-500/10 text-cyan-100',
    gold: 'border-yellow-300/35 bg-yellow-400/10 text-yellow-100',
  }[accent];

  return (
    <div className={cn('rounded-card-lg border p-5', tone)}>
      <div className="text-xs font-black">{label}</div>
      <div className="mt-2 font-mono text-2xl font-black">{value}</div>
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-b-2 px-4 py-3 text-sm font-black transition',
        active
          ? 'border-yellow-300 text-yellow-100'
          : 'border-transparent text-cyan-100 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}

function formatNumber(value: number) {
  return Number(value ?? 0).toLocaleString('ko-KR');
}

function formatDecimal(value: number) {
  return Number(value ?? 0).toLocaleString('ko-KR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatReward(reward: Record<string, unknown> | null | undefined) {
  if (!reward || Object.keys(reward).length === 0) return '—';
  const label = reward.label ?? reward.summary ?? reward.name;
  if (typeof label === 'string' && label.trim()) return label;
  return '보상 확정';
}
