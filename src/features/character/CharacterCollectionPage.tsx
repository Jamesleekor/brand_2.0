import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';

import { PageHeader, LoadingSpinner, EmptyState, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  characterC2Rpc,
  type StudentCharacterCollectionRow,
} from '@/lib/rpc/character_c2_rpc';
import { StudentCharacterCollectionsPanel } from './StudentCharacterCollectionsPanel';
import { characterS1Rpc, type StudentCharacterRecruitmentRow } from '@/lib/rpc/character_s1_rpc';
import { useWallet } from '@/hooks/useWallet';
import { cn } from '@/lib/utils/cn';

// =====================================================================
// B.R.A.N.D 2.0 — Character Collection C2 + C4-C + S1 + E1-A
// 학생 편린 도감 / 직접 영입 / 콜렉션 진행도 / 활성 버프 / 장착 / 편린 속성
// Primary viewport: 1366x768 Chromebook
// =====================================================================

type FilterKey = 'ALL' | 'OWNED' | 'UNOWNED' | 'ELIGIBLE';

type ElementCode = 'WATER' | 'FIRE' | 'WIND' | 'EARTH' | 'LIGHT' | 'DARK';
type ElementFilterKey = 'ALL' | ElementCode;
type TendencyKey = 'PURE' | 'EXTREME' | 'SPECIALIZED' | 'BALANCED';
type TendencyFilterKey = 'ALL' | TendencyKey;
type TierFilterKey = 'ALL' | '8' | '9' | '10';

type CharacterElementProfile = {
  character_id: number;
  element_budget: number;
  primary_element: ElementCode;
  primary_points: number;
  secondary_element: ElementCode | null;
  secondary_points: number;
};

const FILTERS: Array<{ key: FilterKey; label: string; icon: string }> = [
  { key: 'ALL', label: '전체', icon: '✦' },
  { key: 'OWNED', label: '보유', icon: '✓' },
  { key: 'UNOWNED', label: '미보유', icon: '◇' },
  { key: 'ELIGIBLE', label: '영입 가능', icon: '★' },
];

const ELEMENT_META: Record<ElementCode, { label: string; icon: string }> = {
  FIRE: { label: '화', icon: '🔥' },
  WATER: { label: '수', icon: '💧' },
  WIND: { label: '풍', icon: '🍃' },
  EARTH: { label: '토', icon: '🪨' },
  LIGHT: { label: '빛', icon: '✦' },
  DARK: { label: '암', icon: '☾' },
};

const ELEMENT_FILTERS: Array<{ key: ElementFilterKey; label: string }> = [
  { key: 'ALL', label: '속성 전체' },
  { key: 'FIRE', label: '🔥 화' },
  { key: 'WATER', label: '💧 수' },
  { key: 'WIND', label: '🍃 풍' },
  { key: 'EARTH', label: '🪨 토' },
  { key: 'LIGHT', label: '✦ 빛' },
  { key: 'DARK', label: '☾ 암' },
];

const TENDENCY_FILTERS: Array<{ key: TendencyFilterKey; label: string }> = [
  { key: 'ALL', label: '성향 전체' },
  { key: 'PURE', label: '순수' },
  { key: 'EXTREME', label: '극특화' },
  { key: 'SPECIALIZED', label: '특화' },
  { key: 'BALANCED', label: '균형' },
];

const TIER_FILTERS: Array<{ key: TierFilterKey; label: string }> = [
  { key: 'ALL', label: '전체 체급' },
  { key: '8', label: '일반형' },
  { key: '9', label: '상급형' },
  { key: '10', label: '최고급형' },
];

type CharacterPageTab = 'LIBRARY' | 'COLLECTIONS';

const PAGE_TABS: Array<{ key: CharacterPageTab; label: string; icon: string; description: string }> = [
  { key: 'LIBRARY', label: '편린 도감', icon: '✦', description: '편린 보유·직접 영입·장착' },
  { key: 'COLLECTIONS', label: '콜렉션', icon: '🧩', description: '조합 진행도·완성 효과·활성 버프' },
];

export default function CharacterCollectionPage() {
  const [tab, setTab] = useState<CharacterPageTab>('LIBRARY');
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [elementFilter, setElementFilter] = useState<ElementFilterKey>('ALL');
  const [tendencyFilter, setTendencyFilter] = useState<TendencyFilterKey>('ALL');
  const [tierFilter, setTierFilter] = useState<TierFilterKey>('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<StudentCharacterCollectionRow | null>(null);

  const collectionQuery = useCharacterCollection();
  const recruitmentQuery = useCharacterRecruitmentStore();
  const elementQuery = useCharacterElementProfiles();
  const characters = collectionQuery.data ?? [];
  const recruitmentById = useMemo(
    () => new Map((recruitmentQuery.data ?? []).map((row) => [row.character_id, row])),
    [recruitmentQuery.data],
  );
  const elementById = useMemo(
    () => new Map((elementQuery.data ?? []).map((row) => [row.character_id, row])),
    [elementQuery.data],
  );

  const ownedCount = useMemo(
    () => characters.filter((character) => character.is_owned).length,
    [characters],
  );
  const eligibleCount = useMemo(
    () => characters.filter((character) => recruitmentById.get(character.character_id)?.can_self_recruit).length,
    [characters, recruitmentById],
  );
  const equipped = useMemo(
    () => characters.find((character) => character.is_equipped) ?? null,
    [characters],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');

    return characters.filter((character) => {
      if (filter === 'OWNED' && !character.is_owned) return false;
      if (filter === 'UNOWNED' && character.is_owned) return false;
      if (
        filter === 'ELIGIBLE' &&
        !recruitmentById.get(character.character_id)?.can_self_recruit
      ) return false;

      const profile = elementById.get(character.character_id) ?? null;
      if (elementFilter !== 'ALL') {
        if (!profile || !profileHasElement(profile, elementFilter)) return false;
      }
      if (tendencyFilter !== 'ALL') {
        if (!profile || getElementTendency(profile) !== tendencyFilter) return false;
      }
      if (tierFilter !== 'ALL') {
        if (!profile || String(profile.element_budget) !== tierFilter) return false;
      }

      if (!needle) return true;
      return [character.name, character.epithet, character.character_uid]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [
    characters,
    elementById,
    elementFilter,
    filter,
    recruitmentById,
    search,
    tendencyFilter,
    tierFilter,
  ]);

  const characterById = useMemo(
    () => new Map(characters.map((character) => [character.character_id, character])),
    [characters],
  );

  return (
    <>
      <PageHeader title="편린" emoji="✦" />

      <main className="px-4 pt-4 lg:px-5 lg:pt-5">
        <CharacterPageTabs tab={tab} onChange={setTab} />

        {tab === 'LIBRARY' ? (
          <>
            <CharacterLibrarySummary
              ownedCount={ownedCount}
              totalCount={characters.length}
              eligibleCount={eligibleCount}
              equipped={equipped}
              onEquippedClick={() => equipped && setSelected(equipped)}
            />

            {recruitmentQuery.isError && (
              <div className="mt-3 rounded-card-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-bold text-warning">
                영입 가격/경로 정보를 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.
              </div>
            )}

            {elementQuery.isError && (
              <div className="mt-3 rounded-card-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-bold text-warning">
                편린 속성 정보를 불러오지 못했습니다. 속성 필터와 표시는 잠시 사용할 수 없습니다.
              </div>
            )}

            <div className="mt-4 rounded-card-lg border border-line bg-bg-card/90 p-3 backdrop-blur-card lg:p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
                  {FILTERS.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => setFilter(item.key)}
                      className={cn(
                        'flex flex-shrink-0 items-center gap-1.5 rounded-pill border px-3 py-2 text-xs font-black transition-all',
                        filter === item.key
                          ? 'border-brand-primary/50 bg-brand-primary/20 text-white shadow-brand-sm'
                          : 'border-line bg-bg-deep/70 text-text-secondary hover:border-brand-primary/40 hover:text-text-primary',
                      )}
                    >
                      <span className="text-[11px]">{item.icon}</span>
                      {item.label}
                    </button>
                  ))}
                </div>

                <label className="relative block w-full lg:w-[240px]">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">⌕</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="편린 이름 검색"
                    className="w-full rounded-pill border border-line bg-bg-deep/80 py-2 pl-9 pr-3 text-sm font-bold text-text-primary outline-none transition focus:border-brand-primary/60"
                  />
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                <ElementFilterGroup
                  items={ELEMENT_FILTERS}
                  value={elementFilter}
                  onChange={setElementFilter}
                />
                <ElementFilterGroup
                  items={TENDENCY_FILTERS}
                  value={tendencyFilter}
                  onChange={setTendencyFilter}
                />
                <ElementFilterGroup
                  items={TIER_FILTERS}
                  value={tierFilter}
                  onChange={setTierFilter}
                />
              </div>
            </div>

            {collectionQuery.isLoading ? (
              <div className="flex min-h-[320px] items-center justify-center">
                <LoadingSpinner size="lg" />
              </div>
            ) : collectionQuery.isError ? (
              <div className="mt-4 rounded-card-lg border border-danger/40 bg-danger-bg p-5 text-center">
                <div className="mb-2 text-3xl">⚠️</div>
                <p className="text-sm font-black text-text-primary">편린 정보를 불러오지 못했어요.</p>
                <p className="mt-1 text-xs text-text-secondary">잠시 뒤 다시 시도해주세요.</p>
                <button
                  onClick={() => void collectionQuery.refetch()}
                  className="mt-4 rounded-pill border border-danger/40 bg-bg-deep px-4 py-2 text-xs font-black text-text-primary"
                >
                  다시 불러오기
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                emoji="✦"
                title="조건에 맞는 편린이 없어요"
                description={search ? '검색어나 필터를 바꿔보세요.' : '다른 필터를 선택해보세요.'}
              />
            ) : (
              <section className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5">
                {filtered.map((character) => (
                  <CharacterCard
                    key={character.character_id}
                    character={character}
                    recruitment={recruitmentById.get(character.character_id) ?? null}
                    elementProfile={elementById.get(character.character_id) ?? null}
                    onClick={() => setSelected(character)}
                  />
                ))}
              </section>
            )}
          </>
        ) : (
          <StudentCharacterCollectionsPanel
            characterById={characterById}
            onCharacterClick={(characterId) => {
              const character = characterById.get(characterId);
              if (character) setSelected(character);
            }}
          />
        )}
      </main>

      <CharacterDetailModal
        character={selected}
        recruitment={selected ? recruitmentById.get(selected.character_id) ?? null : null}
        elementProfile={selected ? elementById.get(selected.character_id) ?? null : null}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function ElementFilterGroup<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ key: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex max-w-full gap-1 overflow-x-auto rounded-pill border border-line bg-bg-deep/50 p-1 scrollbar-hide">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          className={cn(
            'flex-shrink-0 rounded-pill px-2.5 py-1.5 text-[10px] font-black transition-all',
            value === item.key
              ? 'bg-brand-primary/20 text-white shadow-brand-sm'
              : 'text-text-secondary hover:bg-bg-card hover:text-text-primary',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function CharacterPageTabs({
  tab,
  onChange,
}: {
  tab: CharacterPageTab;
  onChange: (tab: CharacterPageTab) => void;
}) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 rounded-card-lg border border-line bg-bg-card/90 p-1.5 shadow-card">
      {PAGE_TABS.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          className={cn(
            'rounded-card-md border px-3 py-2.5 text-left transition-all sm:px-4',
            tab === item.key
              ? 'border-brand-primary/45 bg-brand-primary/15 shadow-brand-sm'
              : 'border-transparent bg-bg-deep/45 hover:border-line-strong hover:bg-bg-deep/70',
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-base">{item.icon}</span>
            <span className={cn('text-sm font-black', tab === item.key ? 'text-white' : 'text-text-secondary')}>
              {item.label}
            </span>
          </div>
          <div className="mt-0.5 hidden truncate pl-7 text-[10px] font-bold text-text-muted sm:block">
            {item.description}
          </div>
        </button>
      ))}
    </div>
  );
}

function CharacterLibrarySummary({
  ownedCount,
  totalCount,
  eligibleCount,
  equipped,
  onEquippedClick,
}: {
  ownedCount: number;
  totalCount: number;
  eligibleCount: number;
  equipped: StudentCharacterCollectionRow | null;
  onEquippedClick: () => void;
}) {
  const completion = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0;

  return (
    <section className="overflow-hidden rounded-card-xl border border-brand-primary/25 bg-gradient-to-br from-bg-card via-bg-card to-brand-primary/10 shadow-card">
      <div className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center lg:p-5">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-display text-xl text-text-primary lg:text-2xl">나의 편린 도감</h2>
            <span className="text-xs font-black text-brand-primary">수집률 {completion}%</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-text-secondary">
            아직 영입하지 않은 편린도 이름은 공개됩니다. 새로운 동료를 찾아 콜렉션을 채워보세요.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <SummaryPill label="보유" value={`${ownedCount} / ${totalCount}`} emphasis />
            <SummaryPill label="지금 영입 가능" value={`${eligibleCount}종`} />
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-pill bg-bg-deep">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${completion}%` }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
              className="h-full rounded-pill bg-gradient-to-r from-brand-primary to-gold"
            />
          </div>
        </div>

        <button
          onClick={onEquippedClick}
          disabled={!equipped}
          className={cn(
            'flex min-w-[220px] items-center gap-3 rounded-card-lg border p-3 text-left transition-all',
            equipped
              ? 'border-gold/35 bg-bg-deep/75 hover:border-gold/60 hover:shadow-brand-sm'
              : 'cursor-default border-line bg-bg-deep/40',
          )}
        >
          <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-card-md border border-line bg-bg-base">
            {equipped ? (
              <CharacterArtwork character={equipped} compact />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl opacity-40">✦</div>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-gold">현재 장착</div>
            <div className="mt-0.5 truncate text-sm font-black text-text-primary">
              {equipped?.name ?? '장착한 편린 없음'}
            </div>
            <div className="mt-0.5 truncate text-[11px] font-semibold text-text-secondary">
              {equipped?.epithet ?? '보유 편린을 선택해 장착할 수 있어요.'}
            </div>
          </div>
        </button>
      </div>
    </section>
  );
}

function SummaryPill({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-pill border border-line bg-bg-deep/65 px-3 py-1.5">
      <span className="mr-1.5 text-[10px] font-black text-text-muted">{label}</span>
      <span className={cn('text-xs font-black', emphasis ? 'text-gold' : 'text-text-primary')}>{value}</span>
    </div>
  );
}

function CharacterCard({
  character,
  recruitment,
  elementProfile,
  onClick,
}: {
  character: StudentCharacterCollectionRow;
  recruitment: StudentCharacterRecruitmentRow | null;
  elementProfile: CharacterElementProfile | null;
  onClick: () => void;
}) {
  const state = getCharacterState(character, recruitment);

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'group overflow-hidden rounded-card-lg border bg-bg-card text-left shadow-card transition-all hover:-translate-y-0.5',
        character.is_equipped
          ? 'border-gold/60 shadow-brand-sm'
          : character.is_owned
            ? 'border-success/35 hover:border-success/60'
            : character.is_eligible && character.is_recruitable
              ? 'border-brand-primary/35 hover:border-brand-primary/65'
              : 'border-line hover:border-line-strong',
      )}
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-bg-deep">
        <div className={cn(
          'h-full w-full transition duration-300 group-hover:scale-[1.015]',
          !character.is_owned && 'grayscale brightness-[0.48] saturate-[0.55]',
        )}>
          <CharacterArtwork character={character} />
        </div>

        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg-base/95 to-transparent" />

        <div className="absolute left-2 top-2">
          <StateBadge state={state} />
        </div>

        <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
          {elementProfile && <TierBadge budget={elementProfile.element_budget} />}
          {character.is_equipped && (
            <div className="rounded-pill border border-gold/50 bg-bg-base/90 px-2 py-1 text-[9px] font-black text-gold shadow-brand-sm">
              ✦ 장착중
            </div>
          )}
        </div>

        {!character.is_owned && (
          <div className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/55 text-sm text-white/75 backdrop-blur-sm">
            ◇
          </div>
        )}
      </div>

      <div className="min-h-[108px] p-2.5 lg:p-3">
        <p className="truncate text-[10px] font-bold text-text-secondary">
          {character.epithet || 'B.R.A.N.D 편린'}
        </p>
        <h3 className="mt-0.5 truncate text-sm font-black text-text-primary lg:text-[15px]">
          {character.name}
        </h3>
        <p className={cn('mt-2 truncate text-[10px] font-bold', state.textClass)}>
          {state.detail}
        </p>
        {elementProfile && <CharacterElementLine profile={elementProfile} />}
      </div>
    </motion.button>
  );
}

function TierBadge({ budget }: { budget: number }) {
  return (
    <span className="rounded-pill border border-white/15 bg-bg-base/90 px-2 py-1 text-[9px] font-black text-text-primary backdrop-blur-sm">
      {getTierLabel(budget)}
    </span>
  );
}

function CharacterElementLine({ profile }: { profile: CharacterElementProfile }) {
  const primary = ELEMENT_META[profile.primary_element];
  const secondary = profile.secondary_element ? ELEMENT_META[profile.secondary_element] : null;
  return (
    <div className="mt-2 flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] font-black text-text-primary">
      <span className="flex-shrink-0">{primary.icon} {profile.primary_points}</span>
      {secondary && profile.secondary_points > 0 && (
        <span className="flex-shrink-0">{secondary.icon} {profile.secondary_points}</span>
      )}
      <span className="truncate rounded-pill border border-line bg-bg-deep/70 px-1.5 py-0.5 text-[9px] text-text-secondary">
        {getTendencyShortLabel(getElementTendency(profile))}
      </span>
    </div>
  );
}

type CharacterState = {
  label: string;
  detail: string;
  badgeClass: string;
  textClass: string;
};

function getCharacterState(
  character: StudentCharacterCollectionRow,
  recruitment: StudentCharacterRecruitmentRow | null,
): CharacterState {
  if (character.is_equipped) {
    return {
      label: '장착',
      detail: '현재 함께하는 편린',
      badgeClass: 'border-gold/50 bg-gold/20 text-gold',
      textClass: 'text-gold',
    };
  }
  if (character.is_owned) {
    return {
      label: '보유',
      detail: '영입 완료',
      badgeClass: 'border-success/50 bg-success/20 text-success',
      textClass: 'text-success',
    };
  }

  if (recruitment?.can_self_recruit) {
    const basePrice = Number(recruitment.base_price_crystal ?? 0);
    const effectivePrice = Number(recruitment.effective_price_crystal ?? basePrice);
    const hasCollectionDiscount = recruitment.acquisition_mode === 'CRYSTAL' && basePrice > effectivePrice;
    const detail = recruitment.acquisition_mode === 'FREE'
      ? '무료로 지금 영입 가능'
      : hasCollectionDiscount
        ? `${formatGold(effectivePrice)} 크리스탈 · 콜렉션 할인 적용`
        : `${formatGold(effectivePrice)} 크리스탈로 영입 가능`;
    return {
      label: '영입 가능',
      detail,
      badgeClass: 'border-brand-primary/50 bg-brand-primary/20 text-brand-primary',
      textClass: 'text-brand-primary',
    };
  }

  if (recruitment?.availability_code === 'TEACHER_ONLY') {
    return {
      label: '특별 영입',
      detail: '교사 지급 전용',
      badgeClass: 'border-crystal/45 bg-crystal/15 text-crystal',
      textClass: 'text-crystal',
    };
  }
  if (recruitment?.availability_code === 'EVENT_ONLY') {
    return {
      label: '이벤트',
      detail: '이벤트 전용 영입',
      badgeClass: 'border-gold/45 bg-gold/15 text-gold',
      textClass: 'text-gold',
    };
  }

  if (
    !recruitment
    || ['OFFER_NOT_CONFIGURED','OFFER_INACTIVE','UNAVAILABLE','POLICY_UNAVAILABLE','INVALID_PRICE'].includes(recruitment.availability_code)
    || character.policy_status === 'DRAFT'
    || !character.is_recruitable
  ) {
    return {
      label: '준비 중',
      detail: '영입 경로 준비 중',
      badgeClass: 'border-line-strong bg-bg-base/85 text-text-secondary',
      textClass: 'text-text-secondary',
    };
  }

  return {
    label: '미보유',
    detail: character.source_condition_text || '영입 조건을 더 달성해보세요',
    badgeClass: 'border-white/10 bg-bg-base/80 text-text-secondary',
    textClass: 'text-text-secondary',
  };
}

function StateBadge({ state }: { state: CharacterState }) {
  return (
    <span className={cn(
      'inline-flex rounded-pill border px-2 py-1 text-[9px] font-black backdrop-blur-sm',
      state.badgeClass,
    )}>
      {state.label}
    </span>
  );
}

function CharacterArtwork({
  character,
  compact = false,
}: {
  character: StudentCharacterCollectionRow;
  compact?: boolean;
}) {
  if (character.resource_kind === 'EMOJI') {
    return (
      <div className={cn(
        'flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-primary/10 to-gold/10',
        compact ? 'text-3xl' : 'text-6xl lg:text-7xl',
      )}>
        {character.emoji || '✦'}
      </div>
    );
  }

  const src = compact
    ? character.avatar_image_url || character.card_image_url || character.resource_url
    : character.card_image_url || character.full_image_url || character.resource_url;

  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center text-4xl text-text-muted">✦</div>
    );
  }

  return (
    <img
      src={src}
      alt={character.name}
      className="h-full w-full object-contain object-center"
      loading={compact ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}

function CharacterDetailModal({
  character,
  recruitment,
  elementProfile,
  onClose,
}: {
  character: StudentCharacterCollectionRow | null;
  recruitment: StudentCharacterRecruitmentRow | null;
  elementProfile: CharacterElementProfile | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const { wallet } = useWallet();

  if (typeof document === 'undefined') return null;

  const handleEquip = async (nextCharacterId: number | null) => {
    await call(
      () => characterC2Rpc.equip(supabase, nextCharacterId),
      {
        successTitle: nextCharacterId === null ? '편린 장착을 해제했어요' : `${character?.name ?? '편린'} 장착 완료`,
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ['character-collection'] });
          void queryClient.invalidateQueries({ queryKey: ['equipped-characters'] });
          onClose();
        },
      },
    );
  };

  return createPortal(
    <AnimatePresence>
      {character && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-5"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="flex h-[calc(100dvh-24px)] w-full max-w-[860px] flex-col overflow-hidden rounded-card-xl border border-line-strong bg-bg-base shadow-2xl sm:h-[calc(100dvh-40px)] md:grid md:max-h-[760px] md:grid-cols-[minmax(300px,0.92fr)_minmax(320px,1.08fr)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-[320px] min-h-[320px] flex-none flex-col bg-bg-deep sm:h-[360px] sm:min-h-[360px] md:h-auto md:min-h-0">
              <div className="relative min-h-0 flex-1">
                <div className="absolute inset-0">
                  <CharacterDetailArtwork character={character} />
                </div>
                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-bg-deep to-transparent md:hidden" />
                <div className="absolute left-3 top-3">
                  <StateBadge state={getCharacterState(character, recruitment)} />
                </div>
              </div>
              {elementProfile && <CharacterElementPanel profile={elementProfile} />}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex items-start justify-between border-b border-line p-4 lg:p-5">
                <div className="min-w-0 pr-3">
                  <p className="text-xs font-black text-brand-primary">
                    {character.epithet || 'B.R.A.N.D 편린'}
                  </p>
                  <h2 className="mt-1 font-display text-2xl text-text-primary lg:text-3xl">
                    {character.name}
                  </h2>
                </div>
                <button
                  onClick={onClose}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-line bg-bg-deep text-text-secondary transition hover:text-text-primary"
                  aria-label="닫기"
                >
                  ✕
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
                <DetailStatusPanel character={character} recruitment={recruitment} />

                <div className="mt-4 rounded-card-lg border border-line bg-bg-card p-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.13em] text-text-muted">영입 조건</div>
                  <p className="mt-1.5 text-sm font-black leading-relaxed text-text-primary">
                    {character.policy_status === 'DRAFT'
                      ? '영입 조건 준비 중'
                      : character.source_condition_text || '조건 없음'}
                  </p>
                  {!character.is_owned && character.policy_status === 'ACTIVE' && (
                    <p className={cn(
                      'mt-2 text-xs font-bold',
                      character.is_eligible ? 'text-success' : 'text-text-secondary',
                    )}>
                      {character.is_eligible
                        ? '✓ 현재 영입 조건을 달성했습니다.'
                        : '아직 영입 조건을 달성하지 못했습니다.'}
                    </p>
                  )}
                </div>

                <div className="mt-3 rounded-card-lg border border-line bg-bg-card p-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.13em] text-text-muted">편린 소개</div>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-text-primary">
                    {character.description?.trim() || '아직 등록된 소개가 없습니다.'}
                  </p>
                </div>

                {!character.is_owned && (
                  <RecruitmentOfferPanel
                    character={character}
                    recruitment={recruitment}
                    walletCrystal={wallet?.crystal ?? null}
                    isLoading={isLoading}
                    onRecruit={async () => {
                      if (!recruitment?.can_self_recruit) return;
                      const price = recruitment.effective_price_crystal ?? recruitment.base_price_crystal ?? 0;
                      const label = recruitment.acquisition_mode === 'FREE' ? '무료' : `${formatGold(price)} 크리스탈`;
                      if (!window.confirm(`${character.name} 편린을 ${label}로 영입할까요?`)) return;
                      await call(
                        () => characterS1Rpc.recruit(supabase, character.character_id),
                        {
                          successTitle: `${character.name} 영입 완료`,
                          onSuccess: () => {
                            void queryClient.invalidateQueries({ queryKey: ['character-collection'] });
                            void queryClient.invalidateQueries({ queryKey: ['character-s1-store'] });
                            void queryClient.invalidateQueries({ queryKey: ['wallet'] });
                            void queryClient.invalidateQueries({ queryKey: ['transactions'] });
                            void queryClient.invalidateQueries({ queryKey: ['character-collection-progress'] });
                            void queryClient.invalidateQueries({ queryKey: ['character-active-buffs'] });
                            onClose();
                          },
                        },
                      );
                    }}
                  />
                )}
              </div>

              {character.is_owned && (
                <div className="flex-none border-t border-line bg-bg-card/95 p-4 backdrop-blur-sm lg:p-5">
                  {character.is_equipped ? (
                    <button
                      onClick={() => void handleEquip(null)}
                      disabled={isLoading}
                      className="w-full rounded-card-md border border-line-strong bg-bg-deep py-3 text-sm font-black text-text-primary transition hover:border-brand-primary/50 disabled:opacity-50"
                    >
                      {isLoading ? '처리 중...' : '장착 해제'}
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleEquip(character.character_id)}
                      disabled={isLoading}
                      className="btn-primary w-full py-3 text-sm"
                    >
                      {isLoading ? '장착 중...' : '✦ 이 편린 장착하기'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function CharacterElementPanel({ profile }: { profile: CharacterElementProfile }) {
  const primary = ELEMENT_META[profile.primary_element];
  const secondary = profile.secondary_element ? ELEMENT_META[profile.secondary_element] : null;
  const primaryPercent = profile.element_budget > 0
    ? Math.max(0, Math.min(100, (profile.primary_points / profile.element_budget) * 100))
    : 0;
  const secondaryPercent = Math.max(0, 100 - primaryPercent);

  return (
    <div className="flex-none border-t border-line bg-bg-card/95 p-3.5 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.13em] text-text-muted">편린 속성</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-black">
            <span className="text-text-primary">{getTierLabel(profile.element_budget)} · {profile.element_budget}</span>
            <span className="text-text-muted">·</span>
            <span className="text-brand-primary">{getTendencyFullLabel(getElementTendency(profile))}</span>
          </div>
        </div>
        <div className="text-right text-xs font-black text-text-primary">
          <span>{primary.icon} {primary.label} {profile.primary_points}</span>
          {secondary && profile.secondary_points > 0 && (
            <span className="ml-2">{secondary.icon} {secondary.label} {profile.secondary_points}</span>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex h-2.5 overflow-hidden rounded-pill bg-bg-deep">
        <div
          className="h-full bg-brand-primary"
          style={{ width: `${primaryPercent}%` }}
          title={`${primary.label} ${profile.primary_points}`}
        />
        {secondary && profile.secondary_points > 0 && (
          <div
            className="h-full bg-gold"
            style={{ width: `${secondaryPercent}%` }}
            title={`${secondary.label} ${profile.secondary_points}`}
          />
        )}
      </div>
    </div>
  );
}

function CharacterDetailArtwork({ character }: { character: StudentCharacterCollectionRow }) {
  if (character.resource_kind === 'EMOJI') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-primary/10 via-bg-deep to-gold/10 text-8xl">
        {character.emoji || '✦'}
      </div>
    );
  }

  const src = character.full_image_url || character.card_image_url || character.resource_url;
  if (!src) return <div className="flex h-full items-center justify-center text-7xl text-text-muted">✦</div>;

  return (
    <img
      src={src}
      alt={character.name}
      className="h-full w-full object-contain object-center"
      decoding="async"
    />
  );
}

function DetailStatusPanel({
  character,
  recruitment,
}: {
  character: StudentCharacterCollectionRow;
  recruitment: StudentCharacterRecruitmentRow | null;
}) {
  if (character.is_equipped) {
    return (
      <div className="rounded-card-lg border border-gold/35 bg-gold/10 p-4">
        <p className="text-sm font-black text-gold">✦ 현재 장착 중</p>
        <p className="mt-1 text-xs font-semibold text-text-secondary">현재 당신을 대표하는 편린입니다.</p>
      </div>
    );
  }
  if (character.is_owned) {
    return (
      <div className="rounded-card-lg border border-success/35 bg-success-bg p-4">
        <p className="text-sm font-black text-success">✓ 영입 완료</p>
        <p className="mt-1 text-xs font-semibold text-text-secondary">보유 중인 편린입니다. 원하는 편린 하나를 장착할 수 있어요.</p>
      </div>
    );
  }
  if (recruitment?.can_self_recruit) {
    return (
      <div className="rounded-card-lg border border-brand-primary/35 bg-brand-primary/10 p-4">
        <p className="text-sm font-black text-brand-primary">★ 지금 영입할 수 있어요</p>
        <p className="mt-1 text-xs font-semibold text-text-secondary">
          영입 조건과 판매 설정이 모두 열려 있습니다.
        </p>
      </div>
    );
  }
  if (recruitment?.availability_code === 'TEACHER_ONLY') {
    return (
      <div className="rounded-card-lg border border-crystal/35 bg-crystal/10 p-4">
        <p className="text-sm font-black text-crystal">✦ 교사 지급 전용 편린</p>
        <p className="mt-1 text-xs font-semibold text-text-secondary">학생이 직접 구매하지 않고 운영국을 통해 획득하는 편린입니다.</p>
      </div>
    );
  }
  if (recruitment?.availability_code === 'EVENT_ONLY') {
    return (
      <div className="rounded-card-lg border border-gold/35 bg-gold/10 p-4">
        <p className="text-sm font-black text-gold">🎟 이벤트 전용 편린</p>
        <p className="mt-1 text-xs font-semibold text-text-secondary">특별 이벤트에서 획득 기회가 열립니다.</p>
      </div>
    );
  }
  if (recruitment?.availability_code === 'REVOKED_TEACHER_RESTORE_REQUIRED') {
    return (
      <div className="rounded-card-lg border border-warning/35 bg-warning/10 p-4">
        <p className="text-sm font-black text-warning">복원 확인 필요</p>
        <p className="mt-1 text-xs font-semibold text-text-secondary">회수 이력이 있어 운영국에서 복원해야 다시 보유할 수 있습니다.</p>
      </div>
    );
  }
  if (recruitment?.availability_code === 'REQUIREMENT_NOT_MET') {
    return (
      <div className="rounded-card-lg border border-line bg-bg-card p-4">
        <p className="text-sm font-black text-text-primary">◇ 아직 만나지 못한 편린</p>
        <p className="mt-1 text-xs font-semibold text-text-secondary">영입 조건을 달성하면 직접 영입 버튼이 열립니다.</p>
      </div>
    );
  }
  return (
    <div className="rounded-card-lg border border-line bg-bg-card p-4">
      <p className="text-sm font-black text-text-primary">◇ 영입 경로 준비 중</p>
      <p className="mt-1 text-xs font-semibold text-text-secondary">편린의 이름은 공개되지만 아직 Season 2 영입 경로가 열리지 않았습니다.</p>
    </div>
  );
}

function RecruitmentOfferPanel({
  character,
  recruitment,
  walletCrystal,
  isLoading,
  onRecruit,
}: {
  character: StudentCharacterCollectionRow;
  recruitment: StudentCharacterRecruitmentRow | null;
  walletCrystal: number | null;
  isLoading: boolean;
  onRecruit: () => Promise<void>;
}) {
  if (!recruitment || !recruitment.can_self_recruit) {
    const routeText =
      recruitment?.availability_code === 'TEACHER_ONLY' ? '교사 지급 전용'
      : recruitment?.availability_code === 'EVENT_ONLY' ? '이벤트 전용'
      : recruitment?.availability_code === 'REQUIREMENT_NOT_MET' ? '영입 조건 미달성'
      : recruitment?.availability_code === 'REVOKED_TEACHER_RESTORE_REQUIRED' ? '운영국 복원 필요'
      : '영입 경로 준비 중';

    return (
      <div className="mt-3 rounded-card-lg border border-line bg-bg-card p-4">
        <div className="text-[10px] font-black uppercase tracking-[0.13em] text-text-muted">영입 경로</div>
        <p className="mt-1.5 text-sm font-black text-text-primary">{routeText}</p>
      </div>
    );
  }

  const free = recruitment.acquisition_mode === 'FREE';
  const basePrice = Number(recruitment.base_price_crystal ?? 0);
  const price = Number(recruitment.effective_price_crystal ?? basePrice);
  const hasCollectionDiscount = !free && basePrice > price;
  const enoughCrystal = free || (walletCrystal !== null && walletCrystal >= price);

  return (
    <div className="mt-3 overflow-hidden rounded-card-lg border border-brand-primary/30 bg-brand-primary/5">
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.13em] text-text-muted">영입 비용</div>
          <div className={cn('mt-1 text-xl font-black', free ? 'text-success' : 'text-crystal')}>
            {free ? '무료' : `💎 ${formatGold(price)} 크리스탈`}
          </div>
          {hasCollectionDiscount && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
              <span className="text-text-muted line-through">기본 {formatGold(basePrice)} 크리스탈</span>
              <span className="rounded-pill border border-success/30 bg-success/10 px-1.5 py-0.5 text-success">콜렉션 할인 적용</span>
            </div>
          )}
          {!free && (
            <div className="mt-1 text-[11px] font-bold text-text-secondary">
              내 크리스탈 {walletCrystal === null ? '—' : formatGold(walletCrystal)}
            </div>
          )}
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => void onRecruit()}
            disabled={isLoading || !enoughCrystal}
            className="btn-primary w-full py-3 text-sm disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isLoading
              ? '영입 처리 중...'
              : !enoughCrystal
                ? '크리스탈이 부족해요'
                : free
                  ? `✦ ${character.name} 무료 영입`
                  : `✦ ${formatGold(price)} 크리스탈로 영입`}
          </button>
        </div>
      </div>
      <div className="border-t border-brand-primary/15 bg-bg-deep/45 px-4 py-2 text-[10px] font-bold text-text-muted">
        {hasCollectionDiscount
          ? '표시된 할인가는 서버가 현재 콜렉션 버프를 적용해 계산한 최종 영입가입니다. 영입 직전 다시 검증합니다.'
          : '영입 직전 서버에서 조건·보유 여부·가격·크리스탈 잔액을 다시 확인합니다.'}
      </div>
    </div>
  );
}

function useCharacterCollection() {
  return useQuery<StudentCharacterCollectionRow[]>({
    queryKey: ['character-collection'],
    queryFn: async () => {
      const result = await characterC2Rpc.myCollection(supabase);
      if (result.success === false) {
        throw new Error(result.error);
      }
      const rows = result.data ?? [];
      const characterIds = rows
        .map((row) => Number(row.character_id))
        .filter((id) => Number.isFinite(id) && id > 0);
      const descriptionById = new Map<number, string | null>();

      if (characterIds.length > 0) {
        const { data: masters, error } = await supabase
          .from('characters')
          .select('id,description')
          .in('id', characterIds);

        if (!error) {
          (masters ?? []).forEach((master) => {
            descriptionById.set(Number(master.id), master.description ?? null);
          });
        }
      }

      return rows
        .map((row) => ({
          ...row,
          description: descriptionById.get(Number(row.character_id)) ?? row.description ?? null,
        }))
        .sort((a, b) => a.sort_order - b.sort_order || a.character_uid.localeCompare(b.character_uid));
    },
    staleTime: 20_000,
  });
}

function useCharacterElementProfiles() {
  return useQuery<CharacterElementProfile[]>({
    queryKey: ['character-element-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('character_element_profiles')
        .select('character_id,element_budget,primary_element,primary_points,secondary_element,secondary_points');

      if (error) throw error;

      return (data ?? []).map((row) => ({
        character_id: Number(row.character_id),
        element_budget: Number(row.element_budget),
        primary_element: row.primary_element as ElementCode,
        primary_points: Number(row.primary_points),
        secondary_element: row.secondary_element ? row.secondary_element as ElementCode : null,
        secondary_points: Number(row.secondary_points ?? 0),
      }));
    },
    staleTime: 5 * 60_000,
  });
}

function useCharacterRecruitmentStore() {
  return useQuery<StudentCharacterRecruitmentRow[]>({
    queryKey: ['character-s1-store'],
    queryFn: async () => {
      const result = await characterS1Rpc.myStore(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data ?? [];
    },
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

function profileHasElement(profile: CharacterElementProfile, element: ElementCode) {
  return profile.primary_element === element
    || (profile.secondary_element === element && profile.secondary_points > 0);
}

function getElementTendency(profile: CharacterElementProfile): TendencyKey {
  if (!profile.secondary_element || profile.secondary_points <= 0) return 'PURE';
  const ratio = profile.element_budget > 0 ? profile.primary_points / profile.element_budget : 0;
  if (ratio >= 0.8) return 'EXTREME';
  if (ratio >= 0.6) return 'SPECIALIZED';
  return 'BALANCED';
}

function getTendencyShortLabel(tendency: TendencyKey) {
  switch (tendency) {
    case 'PURE': return '순수';
    case 'EXTREME': return '극특화';
    case 'SPECIALIZED': return '특화';
    case 'BALANCED': return '균형';
  }
}

function getTendencyFullLabel(tendency: TendencyKey) {
  switch (tendency) {
    case 'PURE': return '순수형';
    case 'EXTREME': return '극특화';
    case 'SPECIALIZED': return '특화';
    case 'BALANCED': return '균형형';
  }
}

function getTierLabel(budget: number) {
  if (budget >= 10) return '최고급형';
  if (budget === 9) return '상급형';
  return '일반형';
}

function formatGold(value: number) {
  return Number(value).toLocaleString('ko-KR');
}
