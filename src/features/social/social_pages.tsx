// =====================================================================
// B.R.A.N.D 2.0 — 친구·랭킹·설정 페이지
// Stage 6-D · 생성일 2026-05-20
// =====================================================================
// 학급 학생 디렉토리 + 랭킹 + 개인 설정
// =====================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  PageHeader, LoadingSpinner, EmptyState
} from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useStudentId, useClassroomId, useAuthStore } from '@/stores/auth_store';
import { getTierIconUrl } from '@/lib/assets/asset_urls';
import { formatNumber } from '@/lib/utils/format';
import { getTierIconEmoji } from '@/constants/tier_thresholds';
import { cn } from '@/lib/utils/cn';
import type { Tier } from '@/types/database_types';
import { useClassroomAchievementTitles } from '@/hooks/useAchievementTitles';
import { AchievementTitleBadge } from '@/components/shared/AchievementTitleBadge';
import type { EquippedAchievementTitle } from '@/lib/rpc/achievement_a1_rpc';
import { AchievementRankingShowcase, type AchievementRankingEntry } from '@/features/social/AchievementRankingShowcase';
import { getEquippedCharacterImageUrl, useClassroomEquippedCharacters } from '@/hooks/useEquippedCharacters';
import { useClassroomStudentGuilds } from '@/hooks/useStudentGuilds';
import { GuildNameBadge } from '@/components/shared/GuildNameBadge';
import { RankingV2Showcase, type RankingV2VisualEntry } from '@/features/social/RankingV2Showcase';
import { RankingCollectionDetailModal } from '@/features/social/RankingCollectionDetailModal';
import {
  getClassroomRankingV2,
  type RankingV2AssetDistributionBucket,
  type RankingV2AssetRow,
  type RankingV2AssetStyle,
  type RankingV2BattleGroup,
} from '@/lib/rpc/ranking_v2_rpc';

// =====================================================================
// FriendsPage — 학급 학생 디렉토리
// =====================================================================

export function FriendsPage() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();
  const { byStudentId: achievementTitles } = useClassroomAchievementTitles();
  const { byStudentId: guildsByStudentId } = useClassroomStudentGuilds();
  const [search, setSearch] = useState('');
  
  const { data: classmates, isLoading } = useQuery({
    queryKey: ['classmates', classroomId],
    queryFn: async () => {
      if (!classroomId) return [];
      
      const { data } = await supabase
        .from('students')
        .select('id, name, brand_name, cached_tier')
        .eq('classroom_id', classroomId)
        .eq('role', 'STUDENT')
        .is('transferred_at', null)
        .order('name');
      
      return (data ?? []).map((s: any) => ({
        id: s.id,
        name: s.name,
        brandName: s.brand_name,
        tier: (s.cached_tier ?? '새싹') as Tier,
        isMe: s.id === studentId,
      }));
    },
    enabled: classroomId !== null,
  });
  
  const filtered = (classmates ?? []).filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const guildName = guildsByStudentId.get(c.id)?.guildName ?? '';
    return c.name.toLowerCase().includes(q) 
      || (c.brandName?.toLowerCase().includes(q) ?? false)
      || guildName.toLowerCase().includes(q);
  });
  
  return (
    <>
      <PageHeader title="우리 반 친구들" emoji="👥" />
      
      <div className="px-4 pt-4">
        {/* 검색 */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 친구 이름이나 브랜드명 검색"
          className="login-input mb-3"
        />
        
        {isLoading ? (
          <div className="py-8 flex justify-center"><LoadingSpinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState emoji="🔍" title="해당하는 친구가 없어요" />
        ) : (
          <div>
            <div className="text-sm text-white/75 font-bold mb-2">
              총 {filtered.length}명
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {filtered.map((classmate) => (
                <FriendCard
                  key={classmate.id}
                  friend={classmate}
                  achievementTitle={achievementTitles.get(classmate.id) ?? null}
                  guildName={guildsByStudentId.get(classmate.id)?.guildName ?? null}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function FriendCard({ 
  friend,
  achievementTitle,
  guildName,
}: { 
  friend: { id: number; name: string; brandName: string | null; tier: Tier; isMe: boolean };
  achievementTitle: EquippedAchievementTitle | null;
  guildName: string | null;
}) {
  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      className={cn(
        'flex items-center gap-3 px-3.5 py-3 rounded-card-md transition-all hover-lift',
        friend.isMe
          ? 'bg-gold/8 border border-gold/30'
          : 'bg-bg-card backdrop-blur-card border border-line'
      )}
    >
      {/* 티어 아이콘 */}
      <div className="w-12 h-12 flex-shrink-0">
        <img
          src={getTierIconUrl(friend.tier)}
          alt={friend.tier}
          className="w-full h-full object-contain"
          onError={(e) => {
            // Fallback: 이모지
            const target = e.target as HTMLImageElement;
            target.outerHTML = `<div class="w-full h-full flex items-center justify-center text-2xl">${getTierIconEmoji(friend.tier)}</div>`;
          }}
        />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="font-extrabold text-sm text-white min-w-0 flex flex-wrap items-center gap-1.5">
          <span className="truncate">{friend.brandName || friend.name}</span>
          {friend.isMe && (
            <span className="text-[9px] font-black text-gold bg-gold/20 px-1.5 py-0.5 rounded-pill">
              나
            </span>
          )}
          <GuildNameBadge guildName={guildName} compact />
        </div>
        {achievementTitle?.title && (
          <div className="mt-1.5 flex min-w-0">
            <AchievementTitleBadge
              title={achievementTitle.title}
              grade={achievementTitle.grade}
              prominent
              className="max-w-full !px-2.5 !py-1.5 !text-xs sm:!text-sm"
            />
          </div>
        )}
        {friend.brandName && (
          <div className="text-sm text-white/75 font-bold mt-1">{friend.name}</div>
        )}
      </div>
      
      <div className="text-right flex-shrink-0">
        <div className="text-xs font-bold text-text-secondary">
          {friend.tier}
        </div>
      </div>
    </motion.div>
  );
}

// =====================================================================
// RankingsPage — 학급 랭킹 V2
// =====================================================================

type RankingType = 'BV' | 'GOLD' | 'ACHIEVEMENT' | 'COLLECTION';
type CollectionRankingMode = 'SHARDS' | 'COLLECTIONS';

export function RankingsPage() {
  const [type, setType] = useState<RankingType>('BV');
  const [collectionMode, setCollectionMode] = useState<CollectionRankingMode>('SHARDS');

  return (
    <>
      <PageHeader title="랭킹" emoji="📊" />

      <div className="px-4 pt-4">
        <div className="grid grid-cols-4 gap-1.5 mb-4">
          {[
            { value: 'BV',          label: 'BV',   emoji: '⭐' },
            { value: 'GOLD',        label: '골드', emoji: '🪙' },
            { value: 'ACHIEVEMENT', label: '업적', emoji: '🏆' },
            { value: 'COLLECTION',  label: '수집', emoji: '💎' },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setType(tab.value as RankingType)}
              className={cn(
                'flex min-w-0 items-center justify-center gap-1 py-2.5 rounded-pill text-[11px] sm:text-xs font-extrabold transition-all',
                type === tab.value
                  ? 'bg-gradient-to-r from-brand-primary to-gold text-white shadow-brand-sm'
                  : 'bg-bg-card border border-line text-text-secondary'
              )}
            >
              <span>{tab.emoji}</span>
              <span className="truncate">{tab.label}</span>
            </button>
          ))}
        </div>

        {type === 'COLLECTION' && (
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-card-md border border-line bg-bg-card p-1.5">
            <button
              type="button"
              onClick={() => setCollectionMode('SHARDS')}
              className={cn(
                'rounded-card-sm px-3 py-2 text-xs font-black transition-all',
                collectionMode === 'SHARDS' ? 'bg-crystal/15 text-crystal-100' : 'text-text-secondary hover:text-white',
              )}
            >
              🧩 편린 보유
            </button>
            <button
              type="button"
              onClick={() => setCollectionMode('COLLECTIONS')}
              className={cn(
                'rounded-card-sm px-3 py-2 text-xs font-black transition-all',
                collectionMode === 'COLLECTIONS' ? 'bg-bv/15 text-bv-100' : 'text-text-secondary hover:text-white',
              )}
            >
              📚 콜렉션 완성
            </button>
          </div>
        )}

        <RankingList type={type} collectionMode={collectionMode} />
      </div>
    </>
  );
}

function RankingList({ type, collectionMode }: { type: RankingType; collectionMode: CollectionRankingMode }) {
  const classroomId = useClassroomId();
  const { byStudentId: achievementTitles } = useClassroomAchievementTitles();
  const { byStudentId: equippedCharacters } = useClassroomEquippedCharacters();
  const { byStudentId: guildsByStudentId } = useClassroomStudentGuilds();
  const [detailStudentId, setDetailStudentId] = useState<number | null>(null);
  const [detailMode, setDetailMode] = useState<CollectionRankingMode>('SHARDS');

  const boardQuery = useQuery({
    queryKey: ['ranking-v2-board', classroomId],
    enabled: classroomId !== null,
    staleTime: 15_000,
    queryFn: () => getClassroomRankingV2(supabase),
  });

  if (boardQuery.isLoading) {
    return <div className="py-8 flex justify-center"><LoadingSpinner size="lg" /></div>;
  }

  if (boardQuery.isError) {
    return (
      <div className="rounded-card-md border border-danger/30 bg-danger-bg p-4 text-center">
        <div className="font-black text-danger">랭킹을 불러오지 못했습니다.</div>
        <button type="button" onClick={() => void boardQuery.refetch()} className="btn-secondary mt-3 text-xs">다시 불러오기</button>
      </div>
    );
  }

  const board = boardQuery.data;
  if (!board) return <EmptyState emoji="📊" title="아직 랭킹 데이터가 없어요" />;

  const visualIdentity = (row: { student_id: number; rank: number; name: string; brand_name: string | null; tier: string | null; is_me: boolean }) => {
    const studentId = Number(row.student_id);
    const character = equippedCharacters.get(studentId) ?? null;
    const guild = guildsByStudentId.get(studentId) ?? null;
    return {
      rank: Number(row.rank),
      studentId,
      name: row.name,
      brandName: row.brand_name,
      tier: (row.tier ?? '새싹') as Tier,
      isMe: Boolean(row.is_me),
      guildName: guild?.guildName ?? null,
      guildLogoUrl: guild?.guildLogoUrl ?? null,
      equippedCharacterUrl: getEquippedCharacterImageUrl(character, 'avatar'),
      characterEmoji: character?.emoji ?? null,
    };
  };

  if (type === 'ACHIEVEMENT') {
    const achievementRanks: AchievementRankingEntry[] = board.achievement_ranks.map((row) => {
      const identity = visualIdentity(row);
      return {
        ...identity,
        value: Number(row.achievement_count),
      };
    });

    if (achievementRanks.length === 0) return <EmptyState emoji="🏆" title="아직 업적 랭킹 데이터가 없어요" />;

    return <AchievementRankingShowcase ranks={achievementRanks} achievementTitles={achievementTitles} />;
  }

  if (type === 'BV') {
    const firstBattleByStudentId = new Map<number, RankingV2BattleGroup>();
    for (const group of board.bv_battle_groups) {
      const firstMember = group.members[0];
      if (firstMember) firstBattleByStudentId.set(firstMember.student_id, group);
    }

    const ranks: RankingV2VisualEntry[] = board.bv_ranks.map((row) => {
      const startingGroup = firstBattleByStudentId.get(row.student_id) ?? null;
      return {
        ...visualIdentity(row),
        metric: <span className={row.weekly_delta >= 0 ? 'text-bv-100' : 'text-danger'}>최근 7일 {signedNumber(row.weekly_delta)} BV</span>,
        groupBanner: startingGroup ? battleLabel(startingGroup) : undefined,
        privateDetail: row.exact_bv === null ? undefined : <>내 BV {formatNumber(row.exact_bv)}</>,
      };
    });

    if (ranks.length === 0) return <EmptyState emoji="⭐" title="아직 BV 랭킹 데이터가 없어요" />;

    return (
      <RankingV2Showcase
        ranks={ranks}
        achievementTitles={achievementTitles}
        heading={{
          eyebrow: '현재 BV 랭킹',
          title: 'BV 성장 경쟁',
          description: '총점은 숨기고, 최근 7일 동안 얼마나 성장했는지 공개합니다.',
          top10Description: '우리 반 BV 상위 10인',
        }}
      />
    );
  }

  if (type === 'GOLD') {
    const ranks: RankingV2VisualEntry[] = board.asset_ranks.map((row) => ({
      ...visualIdentity(row),
      metric: <AssetRankDelta value={row.rank_delta} />,
      detail: <span>{assetStyleLabel(row.asset_style)}</span>,
      privateDetail: row.exact_total_asset === null ? undefined : <>내 총자산 {formatNumber(row.exact_total_asset)} GOLD</>,
    }));

    if (ranks.length === 0) return <EmptyState emoji="🪙" title="아직 총자산 랭킹 데이터가 없어요" />;

    const selfAsset = board.asset_ranks.find((row) => row.is_me) ?? null;
    return (
      <RankingV2Showcase
        ranks={ranks}
        achievementTitles={achievementTitles}
        heading={{
          eyebrow: '현금 + 예금 + 적금 원금',
          title: '총자산 랭킹',
          description: '정확한 타인 금액은 숨기고, 자산 운영 스타일과 지난주 대비 순위만 공개합니다.',
          top10Description: '우리 반 총자산 상위 10인',
        }}
        beforeRanks={<AssetDistributionPanel buckets={board.asset_distribution} selfAsset={selfAsset} />}
      />
    );
  }

  const openDetail = (studentId: number, mode: CollectionRankingMode) => {
    setDetailStudentId(studentId);
    setDetailMode(mode);
  };

  const collectionRanks: RankingV2VisualEntry[] = collectionMode === 'SHARDS'
    ? board.shard_ranks.map((row) => ({
      ...visualIdentity(row),
      metric: <>{formatNumber(row.owned_count)}종 보유</>,
      detail: <>한정판 {formatNumber(row.limited_count)} / {formatNumber(board.limited_character_total)} · 수집 가치 {formatNumber(row.collection_value)} 💎</>,
      onClick: () => openDetail(row.student_id, 'SHARDS'),
    }))
    : board.collection_ranks.map((row) => ({
      ...visualIdentity(row),
      metric: <>{formatNumber(row.completed_count)}개 완성</>,
      detail: row.recent_collection_name ? <>최근 완성 · {row.recent_collection_name}</> : <span className="text-text-muted">아직 완성 콜렉션 없음</span>,
      onClick: () => openDetail(row.student_id, 'COLLECTIONS'),
    }));

  return (
    <>
      {collectionRanks.length === 0 ? (
        <EmptyState emoji="💎" title="아직 수집 랭킹 데이터가 없어요" />
      ) : (
        <RankingV2Showcase
          ranks={collectionRanks}
          achievementTitles={achievementTitles}
          heading={collectionMode === 'SHARDS' ? {
            eyebrow: '편린 수집 랭킹',
            title: '편린 수집가',
            description: '보유 편린 수, 이벤트 전용 한정판, 현재 카탈로그 수집 가치를 함께 봅니다.',
            top10Description: '우리 반 편린 수집 상위 10인',
          } : {
            eyebrow: '콜렉션 완성 랭킹',
            title: '콜렉션 마스터',
            description: '완성한 콜렉션 수와 가장 최근의 완성 기록을 보여줍니다.',
            top10Description: '우리 반 콜렉션 완성 상위 10인',
          }}
        />
      )}
      <RankingCollectionDetailModal
        studentId={detailStudentId}
        mode={detailMode}
        onClose={() => setDetailStudentId(null)}
      />
    </>
  );
}

function AssetDistributionPanel({ buckets, selfAsset }: { buckets: RankingV2AssetDistributionBucket[]; selfAsset: RankingV2AssetRow | null }) {
  const maxCount = Math.max(1, ...buckets.map((bucket) => Number(bucket.count)));
  return (
    <section className="space-y-3">
      <div className="rounded-card-lg border border-gold/20 bg-[linear-gradient(135deg,rgba(255,217,61,0.07),rgba(15,11,26,0.94))] p-4">
        <div className="text-[10px] font-black tracking-[0.18em] text-gold-200">CLASS ASSET DISTRIBUTION</div>
        <h2 className="mt-1 font-display text-lg font-black text-white">우리 반 총자산 분포</h2>
        <p className="mt-1 text-xs font-bold text-text-secondary">구간별 인원수만 공개합니다. 누가 어느 구간인지와 정확한 금액은 공개하지 않습니다.</p>
        <div className="mt-4 space-y-2.5">
          {buckets.map((bucket) => {
            const width = `${Math.max(bucket.count > 0 ? 8 : 0, (bucket.count / maxCount) * 100)}%`;
            return (
              <div key={bucket.key} className="grid grid-cols-[104px_1fr_38px] items-center gap-2 sm:grid-cols-[130px_1fr_44px]">
                <div className="text-[11px] font-black text-slate-300 sm:text-xs">{assetBucketLabel(bucket)}</div>
                <div className="h-2.5 overflow-hidden rounded-pill bg-bg-deep"><div className="h-full rounded-pill bg-gradient-to-r from-gold/45 to-gold" style={{ width }} /></div>
                <div className="text-right font-mono text-xs font-black text-gold">{bucket.count}명</div>
              </div>
            );
          })}
        </div>
      </div>

      {selfAsset?.exact_total_asset !== null && selfAsset?.exact_total_asset !== undefined && (
        <div className="rounded-card-md border border-gold/25 bg-gold/[0.06] p-3">
          <div className="text-[10px] font-black tracking-[0.14em] text-gold">MY ASSET</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-display text-lg font-black text-white">내 총자산 {formatNumber(selfAsset.exact_total_asset)} GOLD</span>
            <span className="text-xs font-bold text-text-secondary">현금 {formatNumber(selfAsset.exact_cash_gold ?? 0)} · 예금 {formatNumber(selfAsset.exact_deposit_principal ?? 0)} · 적금 {formatNumber(selfAsset.exact_installment_principal ?? 0)}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function AssetRankDelta({ value }: { value: number | null }) {
  const result = value === null
    ? <span className="text-crystal-100">NEW</span>
    : value > 0
      ? <span className="text-success">▲ {formatNumber(value)}</span>
      : value < 0
        ? <span className="text-danger">▼ {formatNumber(Math.abs(value))}</span>
        : <span className="text-slate-300">-</span>;

  return (
    <span className="inline-flex flex-col items-end gap-0.5 leading-none">
      <span className="font-sans text-[9px] font-black tracking-normal text-text-muted sm:text-[10px]">지난주 대비</span>
      <span>{result}</span>
    </span>
  );
}

function assetStyleLabel(style: RankingV2AssetStyle) {
  if (style === 'CASH') return '💵 현금 중심';
  if (style === 'DEPOSIT') return '🏦 예금 중심';
  if (style === 'INSTALLMENT') return '🐷 적금 중심';
  if (style === 'BALANCED') return '⚖️ 균형 자산가';
  return '자산 스타일 없음';
}

function assetBucketLabel(bucket: RankingV2AssetDistributionBucket) {
  if (bucket.max === null) return `${formatNumber(bucket.min)} 이상`;
  return `${formatNumber(bucket.min)} ~ ${formatNumber(bucket.max)}`;
}

function signedNumber(value: number) {
  if (value > 0) return `+${formatNumber(value)}`;
  return formatNumber(value);
}

function battleLabel(group: RankingV2BattleGroup) {
  const names = group.members.map((member) => member.name);
  if (group.member_count === 2) return `⚔️ ${names[0]} ↔ ${names[1]} · 접전 중`;
  return `⚔️ ${group.start_rank}~${group.end_rank}위 ${group.member_count}파전 · ${names.join(' · ')}`;
}

// =====================================================================
// SettingsPage — 개인 설정
// =====================================================================

export function SettingsPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const [soundOn, setSoundOn] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);
  
  const handleLogout = async () => {
    if (!confirm('로그아웃하시겠어요?')) return;
    await logout();
    navigate('/login', { replace: true });
  };
  
  return (
    <>
      <PageHeader title="설정" emoji="⚙️" />
      
      <div className="px-4 pt-4 space-y-3">
        {/* 알림 설정 */}
        <SettingSection title="알림">
          <SettingToggle
            label="효과음"
            description="버튼 누를 때 소리"
            value={soundOn}
            onChange={setSoundOn}
            emoji="🔊"
          />
          <SettingToggle
            label="실시간 알림"
            description="새 메일·알림 도착 시"
            value={pushNotifications}
            onChange={setPushNotifications}
            emoji="🔔"
          />
        </SettingSection>
        
        {/* 정보 */}
        <SettingSection title="정보">
          <SettingLink
            label="사용 가이드"
            description="B.R.A.N.D 사용법 안내"
            emoji="📖"
            onClick={() => {/* TODO */}}
          />
          <SettingLink
            label="개인정보 처리방침"
            emoji="🔒"
            onClick={() => {/* TODO */}}
          />
          <SettingLink
            label="버전 정보"
            description="v2.0.0"
            emoji="ℹ️"
          />
        </SettingSection>
        
        {/* 계정 */}
        <SettingSection title="계정">
          <SettingLink
            label="로그아웃"
            description="다른 계정으로 변경"
            emoji="🚪"
            onClick={handleLogout}
            danger
          />
        </SettingSection>
      </div>
    </>
  );
}

function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-2xs font-extrabold text-text-secondary uppercase tracking-widest mb-2 px-1">
        {title}
      </div>
      <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-md overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function SettingToggle({
  label, description, value, onChange, emoji
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  emoji: string;
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3 border-b border-line last:border-b-0">
      <span className="text-xl">{emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-extrabold text-white">{label}</div>
        <div className="text-2xs text-text-muted font-bold">{description}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          'w-11 h-6 rounded-full relative transition-all',
          value ? 'bg-gradient-to-r from-brand-primary to-gold' : 'bg-bg-deep'
        )}
      >
        <div
          className={cn(
            'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all',
            value ? 'left-5' : 'left-0.5'
          )}
        />
      </button>
    </div>
  );
}

function SettingLink({
  label, description, emoji, onClick, danger
}: {
  label: string;
  description?: string;
  emoji: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <motion.button
      whileTap={onClick ? { scale: 0.98 } : undefined}
      onClick={onClick}
      disabled={!onClick}
      className="w-full flex items-center gap-3 px-3.5 py-3 border-b border-line last:border-b-0 text-left disabled:cursor-default"
    >
      <span className="text-xl">{emoji}</span>
      <div className="flex-1 min-w-0">
        <div className={cn(
          'text-sm font-extrabold',
          danger ? 'text-danger' : 'text-white'
        )}>
          {label}
        </div>
        {description && (
          <div className="text-2xs text-text-muted font-bold">{description}</div>
        )}
      </div>
      {onClick && <span className="text-text-muted">›</span>}
    </motion.button>
  );
}
