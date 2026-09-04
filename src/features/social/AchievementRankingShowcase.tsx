import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { AchievementTitleBadge } from '@/components/shared/AchievementTitleBadge';
import { GuildNameBadge } from '@/components/shared/GuildNameBadge';
import { cn } from '@/lib/utils/cn';
import { formatNumber } from '@/lib/utils/format';
import type { EquippedAchievementTitle } from '@/lib/rpc/achievement_a1_rpc';
import type { Tier } from '@/types/database_types';

export type AchievementRankingEntry = {
  studentId: number;
  name: string;
  brandName: string | null;
  guildName?: string | null;
  tier: Tier;
  value: number;
  isMe: boolean;
  // C1 equipped-character adapter. Optional because students may have no equipped shard.
  equippedCharacterUrl?: string | null;
  profileImageUrl?: string | null;
  characterEmoji?: string | null;
};

type Props = {
  ranks: AchievementRankingEntry[];
  achievementTitles: Map<number, EquippedAchievementTitle>;
};

type AvatarSize = 'champion' | 'podium' | 'elite' | 'top10' | 'standard';

const PODIUM_ACCENT = {
  1: {
    card: 'border-gold/60 bg-[linear-gradient(160deg,rgba(255,217,61,0.13)_0%,rgba(15,11,26,0.96)_42%,rgba(42,36,56,0.94)_100%)] shadow-[0_0_34px_rgba(255,217,61,0.19),0_18px_44px_rgba(0,0,0,0.35)]',
    badge: 'border-gold/65 bg-gold text-bg-deep shadow-[0_0_18px_rgba(255,217,61,0.42)]',
    ring: 'border-gold/55 shadow-[0_0_24px_rgba(255,217,61,0.18)]',
    value: 'text-gold',
    eyebrow: 'text-gold-200',
  },
  2: {
    card: 'border-slate-300/35 bg-[linear-gradient(160deg,rgba(203,213,225,0.10)_0%,rgba(15,11,26,0.96)_45%,rgba(42,36,56,0.90)_100%)] shadow-[0_0_22px_rgba(203,213,225,0.10),0_14px_34px_rgba(0,0,0,0.30)]',
    badge: 'border-slate-200/45 bg-slate-300 text-slate-950',
    ring: 'border-slate-200/35 shadow-[0_0_18px_rgba(203,213,225,0.10)]',
    value: 'text-slate-100',
    eyebrow: 'text-slate-300',
  },
  3: {
    card: 'border-orange-300/35 bg-[linear-gradient(160deg,rgba(194,117,54,0.12)_0%,rgba(15,11,26,0.96)_45%,rgba(42,36,56,0.90)_100%)] shadow-[0_0_22px_rgba(194,117,54,0.10),0_14px_34px_rgba(0,0,0,0.30)]',
    badge: 'border-orange-200/40 bg-[#C0783C] text-white',
    ring: 'border-orange-300/30 shadow-[0_0_18px_rgba(194,117,54,0.10)]',
    value: 'text-orange-200',
    eyebrow: 'text-orange-200',
  },
} as const;

export function AchievementRankingShowcase({ ranks, achievementTitles }: Props) {
  const podium = ranks.slice(0, 3);
  const elite = ranks.slice(3, 6);
  const top10 = ranks.slice(6, 10);
  const standard = ranks.slice(10, 24);

  const podiumDisplayOrder = useMemo(() => {
    if (podium.length < 3) return podium.map((item, idx) => ({ item, rank: idx + 1 }));
    return [
      { item: podium[1], rank: 2 },
      { item: podium[0], rank: 1 },
      { item: podium[2], rank: 3 },
    ];
  }, [podium]);

  return (
    <div className="mx-auto max-w-6xl space-y-7 pb-8">
      <section aria-labelledby="achievement-hall-heading" className="pt-2">
        <SectionHeading
          id="achievement-hall-heading"
          eyebrow="최상위 업적 랭킹"
          title="업적 명예의 전당"
          description="가장 많은 업적을 달성한 모험가들"
          align="center"
        />

        <div className="mt-14 grid grid-cols-3 items-end gap-1.5 sm:mt-16 sm:gap-3 lg:gap-5">
          {podiumDisplayOrder.map(({ item, rank }) => (
            <div key={item.studentId} className={cn('min-w-0', rank === 1 && 'relative -top-3 sm:-top-5 lg:-top-6')}>
              <PodiumCard
                rank={rank as 1 | 2 | 3}
                item={item}
                achievementTitle={achievementTitles.get(item.studentId) ?? null}
              />
            </div>
          ))}
        </div>
      </section>

      {elite.length > 0 && (
        <section aria-labelledby="elite-rankers-heading">
          <SectionHeading
            id="elite-rankers-heading"
            eyebrow="4~6위"
            title="⚔ 엘리트 랭커"
            description="포디움 바로 아래의 최상위 경쟁자"
          />
          <div className="mt-3 grid gap-2.5 md:grid-cols-3">
            {elite.map((item, idx) => (
              <EliteRankCard
                key={item.studentId}
                rank={idx + 4}
                item={item}
                achievementTitle={achievementTitles.get(item.studentId) ?? null}
              />
            ))}
          </div>
        </section>
      )}

      {top10.length > 0 && (
        <section aria-labelledby="top-ten-heading">
          <SectionHeading
            id="top-ten-heading"
            eyebrow="7~10위"
            title="★ TOP 10"
            description="우리 반 업적 상위 10인"
          />
          <div className="mt-3 space-y-2">
            {top10.map((item, idx) => (
              <TopTenRow
                key={item.studentId}
                rank={idx + 7}
                item={item}
                achievementTitle={achievementTitles.get(item.studentId) ?? null}
              />
            ))}
          </div>
        </section>
      )}

      {standard.length > 0 && (
        <section aria-labelledby="standard-rank-heading">
          <SectionHeading
            id="standard-rank-heading"
            eyebrow="11~24위"
            title="전체 순위"
          />
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {standard.map((item, idx) => (
              <StandardRankRow
                key={item.studentId}
                rank={idx + 11}
                item={item}
                achievementTitle={achievementTitles.get(item.studentId) ?? null}
              />
            ))}
          </div>
        </section>
      )}

    </div>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = 'left',
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
}) {
  return (
    <div className={cn('min-w-0', align === 'center' && 'text-center')}>
      <div className="text-[10px] sm:text-[11px] font-black tracking-[0.16em] sm:tracking-[0.20em] text-bv-100">
        {eyebrow}
      </div>
      <h2 id={id} className="mt-1 font-display text-lg sm:text-xl font-black text-white">
        {title}
      </h2>
      {description && <p className="mt-1 text-xs sm:text-[13px] font-bold text-slate-300">{description}</p>}
    </div>
  );
}

function PodiumCard({
  rank,
  item,
  achievementTitle,
}: {
  rank: 1 | 2 | 3;
  item: AchievementRankingEntry;
  achievementTitle: EquippedAchievementTitle | null;
}) {
  const accent = PODIUM_ACCENT[rank];
  const isChampion = rank === 1;
  const avatarSize: AvatarSize = isChampion ? 'champion' : 'podium';

  return (
    <motion.article
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className={cn(
        'relative flex min-h-[190px] sm:min-h-[225px] lg:min-h-[250px] flex-col items-center overflow-visible rounded-card-xl border px-1.5 pb-3 pt-4 text-center sm:px-3 sm:pb-4 sm:pt-5',
        accent.card,
        isChampion && 'min-h-[210px] sm:min-h-[250px] lg:min-h-[278px]'
      )}
    >
      {isChampion && (
        <div aria-hidden="true" className="absolute -top-7 left-1/2 -translate-x-1/2 text-2xl sm:text-3xl drop-shadow-[0_0_10px_rgba(255,217,61,0.55)]">
          👑
        </div>
      )}

      <div
        className={cn(
          'absolute -right-1.5 -top-2 sm:-right-2 sm:-top-2.5 flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full border-2 font-display text-xs sm:text-sm font-black',
          accent.badge,
        )}
        aria-label={`${rank}위`}
      >
        {rank}
      </div>

      <div className={cn('text-[7px] sm:text-[9px] font-black uppercase tracking-[0.13em] sm:tracking-[0.18em]', accent.eyebrow)}>
        {rank === 1 ? '챔피언' : rank === 2 ? '도전자' : '추격자'}
      </div>

      <div className={cn('mt-2 sm:mt-3 rounded-[18px] border bg-black/15 p-1', accent.ring)}>
        <RankAvatar item={item} size={avatarSize} priority={isChampion} />
      </div>

      <div className="mt-2 sm:mt-3 flex max-w-full justify-center">
        <GuildNameBadge guildName={item.guildName} compact />
      </div>

      <div className="mt-1.5 flex min-h-[22px] max-w-full items-center justify-center overflow-visible">
        {achievementTitle?.title ? (
          <AchievementTitleBadge
            title={achievementTitle.title}
            grade={achievementTitle.grade}
            prominent
            className={cn('max-w-full !px-2.5 !py-1.5', isChampion ? '!text-sm sm:!text-base' : '!text-xs sm:!text-sm')}
          />
        ) : (
          <span className="text-[8px] sm:text-[9px] font-bold italic text-slate-300">칭호 미장착</span>
        )}
      </div>

      <div className={cn('mt-1.5 max-w-full truncate px-0.5 font-display font-black text-white', isChampion ? 'text-lg sm:text-[22px]' : 'text-base sm:text-xl')}>
        {item.name}
      </div>
      {item.isMe && (
        <div className="mt-1 rounded-pill border border-gold/25 bg-gold/10 px-2 py-0.5 text-[8px] font-black text-gold">나</div>
      )}

      <div className={cn('mt-auto pt-2 font-mono font-black leading-none', accent.value, isChampion ? 'text-base sm:text-xl' : 'text-sm sm:text-lg')}>
        {formatNumber(item.value)}<span className="ml-0.5 text-[9px] sm:text-[10px] font-black text-slate-300">개</span>
      </div>
    </motion.article>
  );
}

function EliteRankCard({
  rank,
  item,
  achievementTitle,
}: {
  rank: number;
  item: AchievementRankingEntry;
  achievementTitle: EquippedAchievementTitle | null;
}) {
  return (
    <motion.article
      whileHover={{ y: -2 }}
      className={cn(
        'relative flex items-center gap-3 overflow-hidden rounded-card-lg border px-3 py-3.5',
        'border-bv/30 bg-[linear-gradient(135deg,rgba(177,151,252,0.11),rgba(15,11,26,0.92)_48%,rgba(78,205,196,0.035))]',
        'shadow-[0_10px_30px_rgba(0,0,0,0.24)]',
        item.isMe && 'ring-1 ring-gold/45',
      )}
    >
      <div className="absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b from-bv via-brand-primary/70 to-transparent" />
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-bv/30 bg-bv/10 font-display text-sm font-black text-bv-100">
        {rank}
      </div>
      <RankAvatar item={item} size="elite" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0"><GuildNameBadge guildName={item.guildName} compact /></div>
        <div className="mt-1 flex min-w-0 items-center">
          <AchievementTitleBadge title={achievementTitle?.title} grade={achievementTitle?.grade} prominent className="max-w-full !px-2.5 !py-1.5 !text-xs sm:!text-sm" />
          {!achievementTitle?.title && <span className="text-[11px] font-bold text-slate-300">칭호 미장착</span>}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[17px] sm:text-xl font-black text-white">{item.name}</span>
          {item.isMe && <MeBadge />}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[9px] font-black tracking-[0.10em] text-bv-100">엘리트</div>
        <div className="mt-1 font-mono text-base font-black text-success">{formatNumber(item.value)}개</div>
      </div>
    </motion.article>
  );
}

function TopTenRow({
  rank,
  item,
  achievementTitle,
}: {
  rank: number;
  item: AchievementRankingEntry;
  achievementTitle: EquippedAchievementTitle | null;
}) {
  return (
    <motion.article
      whileHover={{ x: 2 }}
      className={cn(
        'flex items-center gap-3 rounded-card-md border border-gold/15 bg-[linear-gradient(90deg,rgba(255,217,61,0.045),rgba(15,11,26,0.91)_28%,rgba(177,151,252,0.035))] px-3 py-2.5',
        item.isMe && 'border-gold/40 bg-gold/[0.07]',
      )}
    >
      <div className="w-7 shrink-0 text-center font-display text-sm font-black text-gold-200/85">{rank}</div>
      <RankAvatar item={item} size="top10" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0"><GuildNameBadge guildName={item.guildName} compact /></div>
        <div className="mt-1 flex min-w-0 items-center">
          <AchievementTitleBadge title={achievementTitle?.title} grade={achievementTitle?.grade} prominent className="max-w-full !px-2.5 !py-1.5 !text-xs sm:!text-sm" />
          {!achievementTitle?.title && <span className="text-[11px] font-bold text-slate-300">칭호 미장착</span>}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-[17px] sm:text-xl font-black text-white">{item.name}</span>
          {item.isMe && <MeBadge />}
        </div>
      </div>
      <div className="shrink-0 font-mono text-base font-black text-success">{formatNumber(item.value)}개</div>
    </motion.article>
  );
}

function StandardRankRow({
  rank,
  item,
  achievementTitle,
}: {
  rank: number;
  item: AchievementRankingEntry;
  achievementTitle: EquippedAchievementTitle | null;
}) {
  return (
    <div
      className={cn(
        'flex min-h-[76px] items-center gap-2.5 rounded-card-md border border-line bg-bg-card px-3 py-2.5 transition-colors hover:border-line-strong sm:gap-3 sm:px-3.5',
        item.isMe && 'border-gold/30 bg-gold/[0.06]',
      )}
    >
      <div className="w-7 shrink-0 text-center font-mono text-sm font-black text-slate-300">{rank}</div>
      <RankAvatar item={item} size="standard" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0"><GuildNameBadge guildName={item.guildName} compact /></div>
        <div className="mt-1 flex min-w-0 items-center">
          <AchievementTitleBadge
            title={achievementTitle?.title}
            grade={achievementTitle?.grade}
            prominent
            className="max-w-full !px-2.5 !py-1.5 !text-xs sm:!text-sm"
          />
          {!achievementTitle?.title && <span className="text-[11px] font-bold text-slate-300">칭호 미장착</span>}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          <span className="truncate text-base font-black text-white sm:text-lg">{item.name}</span>
          {item.isMe && <MeBadge />}
        </div>
      </div>
      <div className="shrink-0 font-mono text-base font-black text-success">{formatNumber(item.value)}개</div>
    </div>
  );
}

function RankAvatar({
  item,
  size,
  priority = false,
}: {
  item: AchievementRankingEntry;
  size: AvatarSize;
  priority?: boolean;
}) {
  const imageUrl = item.equippedCharacterUrl || item.profileImageUrl || null;
  const fallbackText = (item.name || '?').trim().charAt(0) || '?';
  const paletteIndex = stableHash(`${item.studentId}:${item.name}`) % AVATAR_PALETTES.length;
  const palette = AVATAR_PALETTES[paletteIndex];
  const sizeClass = AVATAR_SIZE_CLASS[size];

  if (imageUrl) {
    return (
      <div className={cn('relative shrink-0 overflow-hidden rounded-[16px] bg-bg-deep', sizeClass)}>
        <img
          src={imageUrl}
          alt={`${item.name} 캐릭터`}
          className="h-full w-full object-contain"
          loading={priority ? 'eager' : 'lazy'}
        />
      </div>
    );
  }

  if (item.characterEmoji) {
    return (
      <div className={cn('flex shrink-0 items-center justify-center rounded-[16px] border border-white/10 bg-bg-deep text-center', sizeClass, AVATAR_EMOJI_CLASS[size])} aria-label={`${item.name} 캐릭터`}>
        {item.characterEmoji}
      </div>
    );
  }

  return (
    <div
      className={cn('flex shrink-0 items-center justify-center rounded-[16px] border font-display font-black shadow-inner', sizeClass, palette.className, AVATAR_TEXT_CLASS[size])}
      aria-label={`${item.name} 기본 아바타`}
    >
      {fallbackText}
    </div>
  );
}

const AVATAR_SIZE_CLASS: Record<AvatarSize, string> = {
  champion: 'h-[78px] w-[78px] sm:h-[112px] sm:w-[112px] lg:h-[138px] lg:w-[138px]',
  podium: 'h-[62px] w-[62px] sm:h-[88px] sm:w-[88px] lg:h-[108px] lg:w-[108px]',
  elite: 'h-11 w-11 sm:h-12 sm:w-12',
  top10: 'h-9 w-9 sm:h-10 sm:w-10',
  standard: 'h-9 w-9 sm:h-10 sm:w-10',
};

const AVATAR_TEXT_CLASS: Record<AvatarSize, string> = {
  champion: 'text-2xl sm:text-4xl lg:text-5xl',
  podium: 'text-xl sm:text-3xl lg:text-4xl',
  elite: 'text-lg',
  top10: 'text-base',
  standard: 'text-base',
};

const AVATAR_EMOJI_CLASS: Record<AvatarSize, string> = {
  champion: 'text-4xl sm:text-6xl lg:text-7xl',
  podium: 'text-3xl sm:text-5xl lg:text-6xl',
  elite: 'text-2xl',
  top10: 'text-xl',
  standard: 'text-xl',
};

const AVATAR_PALETTES = [
  { className: 'border-bv/30 bg-gradient-to-br from-bv/25 via-bg-soft to-bv/5 text-bv-100' },
  { className: 'border-gold/30 bg-gradient-to-br from-gold/22 via-bg-soft to-brand-primary/8 text-gold-100' },
  { className: 'border-crystal/30 bg-gradient-to-br from-crystal/22 via-bg-soft to-crystal/5 text-crystal-100' },
  { className: 'border-success/30 bg-gradient-to-br from-success/20 via-bg-soft to-success/5 text-green-100' },
  { className: 'border-orange-300/25 bg-gradient-to-br from-orange-400/20 via-bg-soft to-orange-400/5 text-orange-100' },
  { className: 'border-fuchsia-300/25 bg-gradient-to-br from-fuchsia-400/20 via-bg-soft to-fuchsia-400/5 text-fuchsia-100' },
];

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function MeBadge() {
  return <span className="rounded-pill bg-gold/15 px-1.5 py-0.5 text-[8px] font-black text-gold">나</span>;
}
