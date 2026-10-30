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
import { raidLootRpc, raidLootKindText, raidLootCurrencyImage, type RaidLootPublicReward } from '@/lib/rpc/raid_loot_rpc';

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
          ) : (
            <>
              <RaidFinisherCard result={result} />
              {/* RAID_LOOT_V1_2_RESULT_SECTION_20261018: 공개된 전리품만 표시 */}
              {result.raid.status === 'COMPLETED' || result.raid.status === 'ARCHIVED' ? <RaidLootResultSection raidId={raidId} /> : null}
              {tab === 'ranking' ? <RankingTable result={result} /> : <MyBattleRecord result={result} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RaidFinisherCard({ result }: { result: RaidResult }) {
  const finisher = result.finisher;
  if (!finisher) {
    if (result.raid.status !== 'COMPLETED' && result.raid.status !== 'ARCHIVED') return null;
    return (
      <div className="mb-4 rounded-card-lg border border-white/15 bg-white/5 p-4">
        <div className="text-xs font-black tracking-[0.14em] text-yellow-100">⚔ 최후의 일격</div>
        <div className="mt-1 text-sm font-bold text-cyan-100">기록을 확인할 수 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-card-lg border border-yellow-300/35 bg-yellow-400/10 p-4">
      <div className="flex flex-wrap items-center gap-3">
        {finisher.equipped_character_image_url ? (
          <img
            src={finisher.equipped_character_image_url}
            alt=""
            className="h-12 w-12 rounded-full border border-yellow-200/40 bg-black/25 object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-yellow-200/30 bg-black/25 text-2xl">⚔</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black tracking-[0.14em] text-yellow-100">최후의 일격</div>
          <div className="mt-0.5 truncate text-base font-black text-white">
            {finisher.brand_name || finisher.name}
          </div>
          <div className="mt-0.5 text-xs font-bold text-cyan-100">
            {finisher.guild_name || '무소속'}
            {finisher.equipped_character_name ? ` · ${finisher.equipped_character_name}` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black text-yellow-100">마지막 피해</div>
          <div className="mt-0.5 font-mono text-lg font-black text-white">
            {formatNumber(finisher.damage)}
            {finisher.crit ? <span className="ml-1 text-yellow-200">CRIT</span> : null}
          </div>
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

// RAID_LOOT_V1_2_RESULT_SECTION_20261018
// 학생 결과 화면: 중계화면에서 이미 발표된 전리품만 보여줍니다(발표 전 내용은 서버가 보내지 않음).
function RaidLootResultSection({ raidId }: { raidId: number }) {
  const lootQuery = useQuery({
    queryKey: ['raid-loot-public', raidId],
    enabled: raidId > 0,
    retry: false,
    queryFn: async () => {
      const result = await raidLootRpc.studentPublicState(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    refetchInterval: (query) => {
      const stage = query.state.data?.stage;
      return stage && stage !== 'COMPLETE' ? 3000 : false;
    },
    staleTime: 2000,
  });

  const loot = lootQuery.data;
  if (lootQuery.isError || !loot || !loot.stage || loot.rewards.length === 0) return null;
  const finished = loot.stage === 'COMPLETE';

  return (
    <section className="mb-4 rounded-card-lg border border-amber-300/40 bg-amber-400/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-base font-black text-yellow-100">🎁 전리품 획득자</div>
        <div className="text-xs font-black text-cyan-100">
          {finished ? '획득식 완료' : '획득식 진행 중 · 발표된 전리품만 보여요'}
        </div>
      </div>
      {loot.my_win_count > 0 ? (
        <div className="mt-2 rounded-card-md border border-yellow-300/60 bg-yellow-400/20 px-3 py-2 text-sm font-black text-yellow-50">
          ✨ 축하해요! 전리품 {loot.my_win_count}개를 획득했어요.
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {loot.rewards.map((reward) => <LootRewardCard key={reward.slot_no} reward={reward} />)}
      </div>
      {loot.eligible_count === 1 && finished ? (
        <div className="mt-2 text-xs font-black text-yellow-100">추첨 대상이 한 명이라 두 전리품을 모두 획득했어요.</div>
      ) : null}
    </section>
  );
}

function LootRewardCard({ reward }: { reward: RaidLootPublicReward }) {
  const icon = reward.kind === 'GOLD' ? '🪙' : reward.kind === 'CRYSTAL' ? '💎' : reward.kind === 'FRAGMENTS' ? '🔹' : (reward.character_emoji || '✨');
  const headline = reward.kind === 'CHARACTER'
    ? (reward.character_name ?? reward.label)
    : reward.kind === 'FRAGMENTS'
      ? `편린 조각 ${formatNumber(reward.amount ?? 0)}개`
      : `${formatNumber(reward.amount ?? 0)} ${reward.kind}`;
  const winner = reward.winner;
  const currencyImage = raidLootCurrencyImage(reward.kind, reward.amount);
  const [currencyImageFailed, setCurrencyImageFailed] = useState(false);

  return (
    <div className={cn('flex items-center gap-3 rounded-card-md border p-3', winner?.is_me ? 'border-yellow-300/70 bg-yellow-400/15' : 'border-white/15 bg-black/25')}>
      {reward.kind === 'CHARACTER' && reward.character_image_url ? (
        <img src={reward.character_image_url} alt="" className="h-14 w-14 flex-none rounded-lg border border-amber-200/40 object-cover" />
      ) : currencyImage && !currencyImageFailed ? (
        <img src={currencyImage} alt="" onError={() => setCurrencyImageFailed(true)} className="h-14 w-14 flex-none object-contain" />
      ) : (
        <div className="flex h-14 w-14 flex-none items-center justify-center text-3xl">{icon}</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-black text-yellow-100">제{reward.slot_no}전리품 · {raidLootKindText(reward.kind)}</div>
        <div className="truncate text-base font-black text-white">{headline}</div>
        {reward.void ? (
          <div className="mt-1 text-xs font-black text-amber-100">추첨 대상이 없어 지급되지 않았어요.</div>
        ) : winner ? (
          <div className="mt-1 text-sm font-black text-cyan-100">
            획득: <span className="text-white">{winner.brand_name || winner.display_name}</span>
            {winner.is_me ? <span className="ml-1 text-yellow-100">(나!)</span> : null}
          </div>
        ) : (
          <div className="mt-1 text-sm font-black text-cyan-100">획득자 발표 전</div>
        )}
        {reward.duplicate_character_converted ? (
          <div className="mt-1 text-xs font-black text-fuchsia-100">
            이미 가진 편린이라 기준가의 90%인 💎 {formatNumber(reward.delivered_amount ?? 0)} 크리스탈로 받았어요.
          </div>
        ) : null}
      </div>
    </div>
  );
}
