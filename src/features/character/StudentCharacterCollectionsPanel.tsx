import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';

import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import type { StudentCharacterCollectionRow } from '@/lib/rpc/character_c2_rpc';
import {
  characterC4CRpc,
  type StudentActiveBuffRow,
  type StudentCharacterSetProgressRow,
  type StudentCollectionMemberRow,
  type StudentCollectionRewardRow,
} from '@/lib/rpc/character_c4c_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

// =====================================================================
// B.R.A.N.D 2.0 — Character Core C4-C
// 학생 콜렉션 진행도 / 구성 편린 / 완성 효과 / 활성 버프
// =====================================================================

type CollectionFilterKey = 'ALL' | 'IN_PROGRESS' | 'COMPLETE';


const S2_INTEGRATED_EFFECT_CODES = new Set([
  'ATTENDANCE_GOLD_BONUS',
  'SHOP_DISCOUNT_PP',
  'TAX_RATE_REDUCTION_PP',
  'AUCTION_REFUND_PP',
  'DAILY_QUEST_COMPLETION_GOLD_BONUS',
  'MARKET_FEE_REDUCTION_PP',
  'P2P_TRANSFER_FEE_REDUCTION_PP',
  'SAVINGS_INTEREST_BONUS_PP',
]);

const DEFERRED_EFFECT_LABELS: Record<string, string> = {};

function isIntegratedEffect(effectCode: string) {
  return S2_INTEGRATED_EFFECT_CODES.has(effectCode);
}

function effectIntegrationLabel(effectCode: string) {
  return isIntegratedEffect(effectCode) ? '실제 적용 중' : (DEFERRED_EFFECT_LABELS[effectCode] ?? '연동 예정');
}

function effectConsumerDescription(buff: StudentActiveBuffRow) {
  const numeric = Math.abs(Number(buff.applied_value));
  switch (buff.effect_code) {
    case 'ATTENDANCE_GOLD_BONUS':
      return `출석·지각 기본 보상 계산 후 +${formatNumber(numeric)} GOLD 추가`;
    case 'SHOP_DISCOUNT_PP':
      return `편린 CRYSTAL 영입 가격을 ${formatNumber(numeric)}% 할인`;
    case 'TAX_RATE_REDUCTION_PP':
      return `학생에게 적용되는 소득세율을 ${formatNumber(numeric)}%p 감소`;
    case 'AUCTION_REFUND_PP':
      return `경매 낙찰 결제 후 낙찰가의 ${formatNumber(numeric)}%를 GOLD로 환급`;
    case 'DAILY_QUEST_COMPLETION_GOLD_BONUS':
      return `일일퀘스트 완료 보상에 +${formatNumber(numeric)} GOLD로 적용됩니다.`;
    case 'MARKET_FEE_REDUCTION_PP':
      return `가방 아이템 판매 수수료를 ${formatNumber(numeric)}%p 감소시킵니다.`;
    case 'P2P_TRANSFER_FEE_REDUCTION_PP':
      return `학생 간 송금 수수료를 ${formatNumber(numeric)}%p 감소시킵니다.`;
    case 'SAVINGS_INTEREST_BONUS_PP':
      return `예금 가입 시 기본금리에 +${formatNumber(numeric)}%p가 더해져 계약 금리로 고정됩니다.`;
    default:
      return isIntegratedEffect(buff.effect_code) ? '서버 경제 계산에 적용됩니다.' : '아직 실제 소비자 로직과 연결되지 않았습니다.';
  }
}

const COLLECTION_FILTERS: Array<{ key: CollectionFilterKey; label: string }> = [
  { key: 'ALL', label: '전체' },
  { key: 'IN_PROGRESS', label: '진행 중' },
  { key: 'COMPLETE', label: '완성' },
];

export function StudentCharacterCollectionsPanel({
  characterById,
  onCharacterClick,
}: {
  characterById: Map<number, StudentCharacterCollectionRow>;
  onCharacterClick: (characterId: number) => void;
}) {
  const [filter, setFilter] = useState<CollectionFilterKey>('ALL');
  const [search, setSearch] = useState('');
  const progressQuery = useMyCollectionProgress();
  const buffQuery = useMyActiveBuffs();

  const collections = progressQuery.data ?? [];
  const buffs = buffQuery.data ?? [];
  const completedCount = useMemo(() => collections.filter((row) => row.is_complete).length, [collections]);
  const nonZeroBuffs = useMemo(() => buffs.filter((buff) => Number(buff.applied_value) > 0), [buffs]);
  const integratedBuffCount = useMemo(() => nonZeroBuffs.filter((buff) => isIntegratedEffect(buff.effect_code)).length, [nonZeroBuffs]);
  const pendingBuffCount = nonZeroBuffs.length - integratedBuffCount;

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    return collections.filter((row) => {
      if (filter === 'COMPLETE' && !row.is_complete) return false;
      if (filter === 'IN_PROGRESS' && row.is_complete) return false;
      if (!needle) return true;
      return [
        row.collection_name,
        row.description,
        row.collection_uid,
        ...row.member_status.flatMap((member) => [member.name, member.epithet, member.character_uid]),
        ...row.reward_preview.map((reward) => reward.display_name),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [collections, filter, search]);

  const loading = progressQuery.isLoading || buffQuery.isLoading;
  const error = progressQuery.error ?? buffQuery.error;

  const refresh = () => {
    void progressQuery.refetch();
    void buffQuery.refetch();
  };

  return (
    <div>
      <CollectionProgressSummary
        completedCount={completedCount}
        totalCount={collections.length}
        activeBuffCount={integratedBuffCount}
        pendingBuffCount={pendingBuffCount}
      />

      <ActiveBuffPanel buffs={nonZeroBuffs} isLoading={buffQuery.isLoading} />

      <div className="mt-4 rounded-card-lg border border-line bg-bg-card/90 p-3 backdrop-blur-card lg:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
            {COLLECTION_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={cn(
                  'flex-shrink-0 rounded-pill border px-3 py-2 text-xs font-black transition-all',
                  filter === item.key
                    ? 'border-brand-primary/50 bg-brand-primary/20 text-white shadow-brand-sm'
                    : 'border-line bg-bg-deep/70 text-text-secondary hover:border-brand-primary/40 hover:text-text-primary',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <label className="relative block min-w-0 flex-1 lg:w-[250px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">⌕</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="콜렉션 · 편린 · 효과 검색"
                className="w-full rounded-pill border border-line bg-bg-deep/80 py-2 pl-9 pr-3 text-sm font-bold text-text-primary outline-none transition focus:border-brand-primary/60"
              />
            </label>
            <button
              type="button"
              onClick={refresh}
              disabled={progressQuery.isFetching || buffQuery.isFetching}
              className="flex-shrink-0 rounded-pill border border-line bg-bg-deep/70 px-3 py-2 text-xs font-black text-text-secondary transition hover:border-brand-primary/40 hover:text-white disabled:opacity-50"
              title="최신 상태 다시 불러오기"
            >
              ↻
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[320px] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      ) : error ? (
        <div className="mt-4 rounded-card-lg border border-danger/40 bg-danger-bg p-5 text-center">
          <div className="mb-2 text-3xl">⚠️</div>
          <p className="text-sm font-black text-text-primary">콜렉션 정보를 불러오지 못했어요.</p>
          <p className="mt-1 text-xs font-semibold text-text-secondary">잠시 뒤 다시 시도하거나 새로고침해주세요.</p>
          <button
            type="button"
            onClick={refresh}
            className="mt-4 rounded-pill border border-danger/40 bg-bg-deep px-4 py-2 text-xs font-black text-text-primary"
          >
            다시 불러오기
          </button>
        </div>
      ) : collections.length === 0 ? (
        <div className="mt-4 rounded-card-lg border border-line bg-bg-card">
          <EmptyState
            emoji="🧩"
            title="아직 공개된 편린 콜렉션이 없어요"
            description="운영국이 새로운 콜렉션을 공개하면 이곳에서 구성 편린과 효과를 확인할 수 있어요."
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-4 rounded-card-lg border border-line bg-bg-card">
          <EmptyState
            emoji="🧩"
            title="조건에 맞는 콜렉션이 없어요"
            description={search ? '검색어나 필터를 바꿔보세요.' : '다른 필터를 선택해보세요.'}
          />
        </div>
      ) : (
        <section className="mt-3 grid gap-3 lg:grid-cols-2 min-[1600px]:grid-cols-3">
          {filtered.map((row) => (
            <StudentCollectionCard
              key={row.collection_id}
              row={row}
              characterById={characterById}
              onCharacterClick={onCharacterClick}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function CollectionProgressSummary({
  completedCount,
  totalCount,
  activeBuffCount,
  pendingBuffCount,
}: {
  completedCount: number;
  totalCount: number;
  activeBuffCount: number;
  pendingBuffCount: number;
}) {
  const completion = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <section className="overflow-hidden rounded-card-xl border border-bv/25 bg-gradient-to-br from-bg-card via-bg-card to-bv/10 shadow-card">
      <div className="p-4 lg:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-display text-xl text-white lg:text-2xl">편린 콜렉션</h2>
              <span className="text-xs font-black text-bv">완성률 {completion}%</span>
            </div>
            <p className="mt-1 max-w-3xl text-sm font-semibold text-text-secondary">
              필요한 편린을 모두 영입하면 콜렉션이 자동으로 완성됩니다. 실제 경제 시스템에 연결된 효과는 즉시 적용되며, 향후 연동 효과는 상태를 따로 표시합니다. 장착 여부는 콜렉션에 영향을 주지 않아요.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CollectionSummaryPill label="완성" value={`${completedCount} / ${totalCount}`} emphasis />
            <CollectionSummaryPill label="실제 적용" value={`${activeBuffCount}종`} />
            {pendingBuffCount > 0 && <CollectionSummaryPill label="연동 예정" value={`${pendingBuffCount}종`} />}
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-pill bg-bg-deep">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${completion}%` }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="h-full rounded-pill bg-gradient-to-r from-bv to-brand-primary"
          />
        </div>
      </div>
    </section>
  );
}

function ActiveBuffPanel({ buffs, isLoading }: { buffs: StudentActiveBuffRow[]; isLoading: boolean }) {
  return (
    <section className="mt-3 rounded-card-lg border border-gold/20 bg-bg-card/90 p-3 lg:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">⚡</span>
            <h3 className="text-sm font-black text-white">콜렉션 효과 상태</h3>
          </div>
          <p className="mt-0.5 text-[11px] font-semibold text-text-muted">
            완성 효과는 자동 합산됩니다. 실제 경제 계산에 연결된 효과와 향후 단계에서 연동될 효과를 구분해 표시합니다.
          </p>
        </div>
        {isLoading && <div className="text-[10px] font-black text-text-muted">갱신 중…</div>}
      </div>

      {isLoading ? (
        <div className="mt-3 flex min-h-[68px] items-center justify-center rounded-card-md border border-line bg-bg-deep/65">
          <LoadingSpinner size="sm" />
        </div>
      ) : buffs.length === 0 ? (
        <div className="mt-3 rounded-card-md border border-line bg-bg-deep/65 px-4 py-3 text-xs font-bold text-text-secondary">
          아직 활성화된 콜렉션 버프가 없습니다. 첫 콜렉션을 완성해보세요.
        </div>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {buffs.map((buff) => (
            <ActiveBuffCard key={buff.effect_code} buff={buff} />
          ))}
        </div>
      )}
    </section>
  );
}

function ActiveBuffCard({ buff }: { buff: StudentActiveBuffRow }) {
  const capped = Number(buff.raw_value) > Number(buff.cap_value);
  const integrated = isIntegratedEffect(buff.effect_code);
  const sourceNames = buff.source_collections.map((source) => source.collection_name).join(', ');
  return (
    <div className={cn(
      'rounded-card-md border p-3',
      integrated
        ? 'border-gold/25 bg-gradient-to-br from-gold/10 to-bg-deep'
        : 'border-line bg-bg-deep/75',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-[11px] font-black leading-tight text-text-primary">{buff.display_name}</div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {capped && <span className="rounded-pill border border-warning/30 bg-warning-bg px-1.5 py-0.5 text-[8px] font-black text-warning">CAP</span>}
          <span className={cn(
            'rounded-pill border px-1.5 py-0.5 text-[8px] font-black',
            integrated ? 'border-success/30 bg-success/10 text-success' : 'border-line bg-bg-card text-text-muted',
          )}>
            {effectIntegrationLabel(buff.effect_code)}
          </span>
        </div>
      </div>
      <div className={cn('mt-1 text-lg font-black', integrated ? 'text-gold' : 'text-text-secondary')}>
        {effectValueText(buff.applied_value, buff.value_unit, buff.direction)}
      </div>
      <div className="mt-1 text-[9px] font-bold leading-relaxed text-text-secondary">
        {effectConsumerDescription(buff)}
      </div>
      <div className="mt-1 text-[9px] font-bold text-text-muted">
        {capped
          ? `합계 ${effectValueText(buff.raw_value, buff.value_unit, buff.direction)} · 상한 ${capText(buff.cap_value, buff.value_unit)}`
          : `${buff.source_count}개 콜렉션에서 활성`}
      </div>
      {sourceNames && (
        <div className="mt-1 truncate text-[9px] font-semibold text-text-faded" title={sourceNames}>
          {sourceNames}
        </div>
      )}
    </div>
  );
}

function StudentCollectionCard({
  row,
  characterById,
  onCharacterClick,
}: {
  row: StudentCharacterSetProgressRow;
  characterById: Map<number, StudentCharacterCollectionRow>;
  onCharacterClick: (characterId: number) => void;
}) {
  const progress = Number(row.required_count) > 0
    ? Math.round((Number(row.owned_count) / Number(row.required_count)) * 100)
    : 0;

  return (
    <motion.article
      layout
      className={cn(
        'overflow-hidden rounded-card-lg border bg-bg-card shadow-card',
        row.is_complete ? 'border-gold/45 shadow-brand-sm' : 'border-line',
      )}
    >
      <div className={cn(
        'border-b p-4',
        row.is_complete ? 'border-gold/20 bg-gradient-to-r from-gold/10 to-transparent' : 'border-line',
      )}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <CollectionClassBadge collectionClass={row.collection_class} />
              <span className={cn(
                'rounded-pill border px-2 py-1 text-[9px] font-black',
                row.is_complete
                  ? 'border-gold/40 bg-gold/15 text-gold'
                  : 'border-line bg-bg-deep text-text-secondary',
              )}>
                {row.is_complete ? '★ COMPLETE' : `${row.owned_count} / ${row.required_count}`}
              </span>
            </div>
            <div className="mt-2 truncate font-mono text-[9px] font-black text-text-muted">{row.collection_uid}</div>
            <h3 className="mt-0.5 font-display text-lg text-white">{row.collection_name}</h3>
            {row.description && (
              <p className="mt-1 text-xs font-semibold leading-relaxed text-text-secondary">{row.description}</p>
            )}
          </div>
          <div className={cn(
            'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border text-lg font-black',
            row.is_complete
              ? 'border-gold/45 bg-gold/15 text-gold'
              : 'border-line bg-bg-deep text-text-muted',
          )}>
            {row.is_complete ? '✓' : `${progress}%`}
          </div>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-pill bg-bg-deep">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className={cn('h-full rounded-pill', row.is_complete ? 'bg-gold' : 'bg-brand-primary')}
          />
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-black text-text-primary">필요한 편린</h4>
          <span className="text-[10px] font-bold text-text-muted">이름과 모습은 모두 공개</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {row.member_status.map((member) => (
            <CollectionMemberTile
              key={member.member_id}
              member={member}
              character={characterById.get(member.character_id)}
              onClick={() => onCharacterClick(member.character_id)}
            />
          ))}
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[11px] font-black text-text-primary">완성 효과</h4>
            {row.is_complete && <span className="text-[9px] font-black text-success">완성됨</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {row.reward_preview.map((reward) => (
              <CollectionRewardBadge
                key={reward.reward_id}
                reward={reward}
                active={row.is_complete}
                integrated={isIntegratedEffect(reward.effect_code)}
              />
            ))}
            {row.reward_preview.length === 0 && (
              <span className="text-xs font-bold text-text-muted">설정된 효과가 없습니다.</span>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function CollectionMemberTile({
  member,
  character,
  onClick,
}: {
  member: StudentCollectionMemberRow;
  character?: StudentCharacterCollectionRow;
  onClick: () => void;
}) {
  const clickable = Boolean(character);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={cn(
        'min-w-0 overflow-hidden rounded-card-md border bg-bg-deep text-left transition-all',
        member.is_owned
          ? 'border-success/35 hover:border-success/60'
          : 'border-line hover:border-brand-primary/40',
        !clickable && 'cursor-default',
      )}
      title={clickable ? `${member.name} 편린 상세 보기` : member.name}
    >
      <div className="relative aspect-square overflow-hidden bg-bg-base">
        <div className={cn('h-full w-full', !member.is_owned && 'grayscale brightness-[0.52] saturate-[0.55]')}>
          <CollectionMemberArtwork member={member} character={character} />
        </div>
        <div className={cn(
          'absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[8px] font-black backdrop-blur-sm',
          member.is_owned
            ? 'border-success/45 bg-success/20 text-success'
            : 'border-white/10 bg-black/55 text-white/70',
        )}>
          {member.is_owned ? '✓' : '◇'}
        </div>
      </div>
      <div className="p-2">
        <div className={cn('truncate text-[10px] font-black', member.is_owned ? 'text-white' : 'text-text-secondary')}>
          {member.name}
        </div>
        <div className={cn('mt-0.5 text-[8px] font-bold', member.is_owned ? 'text-success' : 'text-text-muted')}>
          {member.is_owned ? '보유' : '미보유'}
        </div>
      </div>
    </button>
  );
}

function CollectionMemberArtwork({
  member,
  character,
}: {
  member: StudentCollectionMemberRow;
  character?: StudentCharacterCollectionRow;
}) {
  const resourceKind = character?.resource_kind ?? member.resource_kind;
  const emoji = character?.emoji ?? member.emoji;
  if (resourceKind === 'EMOJI') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-primary/10 to-bv/10 text-3xl">
        {emoji || '✦'}
      </div>
    );
  }

  const src = character?.avatar_image_url
    || member.avatar_image_url
    || character?.card_image_url
    || member.card_image_url
    || character?.resource_url
    || member.resource_url;

  if (!src) return <div className="flex h-full w-full items-center justify-center text-3xl text-text-muted">✦</div>;
  return <img src={src} alt={member.name} className="h-full w-full object-contain object-center" loading="lazy" decoding="async" />;
}

function CollectionRewardBadge({
  reward,
  active,
  integrated,
}: {
  reward: StudentCollectionRewardRow;
  active: boolean;
  integrated: boolean;
}) {
  return (
    <div className={cn(
      'rounded-pill border px-2.5 py-1.5 text-[10px] font-black',
      active && integrated
        ? 'border-gold/30 bg-gold/10 text-gold'
        : active
          ? 'border-line bg-bg-deep text-text-secondary'
          : 'border-line bg-bg-deep text-text-secondary',
    )}>
      {reward.display_name} <span className="whitespace-nowrap">{effectValueText(reward.effect_value, reward.value_unit, reward.direction)}</span>
      {active && (
        <span className={cn('ml-1 whitespace-nowrap text-[8px]', integrated ? 'text-success' : 'text-text-muted')}>
          · {integrated ? '적용 중' : effectIntegrationLabel(reward.effect_code)}
        </span>
      )}
    </div>
  );
}

function CollectionClassBadge({ collectionClass }: { collectionClass: StudentCharacterSetProgressRow['collection_class'] }) {
  const labels = {
    SMALL: '소형',
    STANDARD: '일반',
    LARGE: '대형',
  } as const;
  return (
    <span className="rounded-pill border border-bv/30 bg-bv/10 px-2 py-1 text-[9px] font-black text-bv">
      {labels[collectionClass]}
    </span>
  );
}

function effectValueText(
  value: number,
  unit: StudentCollectionRewardRow['value_unit'],
  direction: StudentCollectionRewardRow['direction'],
) {
  const numeric = Number(value);
  if (unit === 'GOLD') return `+${formatNumber(numeric)} GOLD`;
  return `${direction === 'REDUCTION' ? '-' : '+'}${formatNumber(numeric)}%p`;
}

function capText(value: number, unit: StudentActiveBuffRow['value_unit']) {
  return unit === 'GOLD' ? `+${formatNumber(value)} GOLD` : `${formatNumber(value)}%p`;
}

function formatNumber(value: number) {
  return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function useMyCollectionProgress() {
  return useQuery<StudentCharacterSetProgressRow[]>({
    queryKey: ['character-collection-progress'],
    queryFn: async () => {
      const result = await characterC4CRpc.myCollectionProgress(supabase);
      if (result.success === false) throw new Error(result.error);
      return [...(result.data ?? [])].sort(
        (a, b) => Number(a.sort_order) - Number(b.sort_order) || a.collection_uid.localeCompare(b.collection_uid),
      );
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

function useMyActiveBuffs() {
  return useQuery<StudentActiveBuffRow[]>({
    queryKey: ['character-active-buffs'],
    queryFn: async () => {
      const result = await characterC4CRpc.myActiveBuffs(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data ?? [];
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

function CollectionSummaryPill({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-pill border border-line bg-bg-deep/65 px-3 py-1.5">
      <span className="mr-1.5 text-[10px] font-black text-text-muted">{label}</span>
      <span className={cn('text-xs font-black', emphasis ? 'text-gold' : 'text-text-primary')}>{value}</span>
    </div>
  );
}

