// =====================================================================
// B.R.A.N.D 2.0 — TopHeader (정체성 + 재화)
// Stage 6-B · 생성일 2026-05-20
// =====================================================================
// 좌측: 캐릭터 아바타 + 브랜드명 + 본명·학년반
// 우측: 골드·크리스탈 작은 알약 (게임 패턴)
// =====================================================================

import { motion } from 'framer-motion';
import { useCurrentStudent } from '@/stores/auth_store';
import { formatNumber, formatDelta } from '@/lib/utils/format';
import { useWallet } from '@/hooks/useWallet';
import { useMyAchievementTitle } from '@/hooks/useAchievementTitles';
import { AchievementTitleBadge } from '@/components/shared/AchievementTitleBadge';
import { getEquippedCharacterImageUrl, useMyEquippedCharacter } from '@/hooks/useEquippedCharacters';
import { useClassroomStudentGuilds } from '@/hooks/useStudentGuilds';
import { GuildNameBadge } from '@/components/shared/GuildNameBadge';

// =====================================================================
// TopHeader
// =====================================================================

export function TopHeader({ bvMonthlyDelta = 0 }: { bvMonthlyDelta?: number }) {
  const student = useCurrentStudent();
  
  if (!student) return null;
  
  return (
    <div className="relative z-10 px-4 pt-4 flex items-start justify-between gap-3">
      {/* 좌측 — 정체성 블록 */}
      <IdentityBlock bvMonthlyDelta={bvMonthlyDelta} />
      
      {/* 우측 — 재화 알약 */}
      <CurrencyBar />
    </div>
  );
}

// =====================================================================
// 좌측 — 정체성 (캐릭터 아바타 + 브랜드명 + 본명)
// =====================================================================

function IdentityBlock({ bvMonthlyDelta = 0 }: { bvMonthlyDelta?: number }) {
  const student = useCurrentStudent();
  const { wallet } = useWallet();
  const { title: equippedTitle } = useMyAchievementTitle();
  const { myGuild } = useClassroomStudentGuilds();
  
  if (!student) return null;
  
  const displayName = student.brandName || student.studentName || '학생';
  const realName = student.studentName || '';
  const classroomName = student.classroomName || '';
  
  return (
    <div className="flex items-center gap-3 min-w-0 flex-1">
      <CharacterAvatar />
      
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <div className="font-display text-xl text-brand-gradient tracking-tighter leading-tight truncate">{displayName}</div>
          <GuildNameBadge guildName={myGuild?.guildName} compact />
          <AchievementTitleBadge
            title={equippedTitle?.title}
            grade={equippedTitle?.grade}
            prominent
            className="max-w-full"
          />
          <div className="px-2.5 py-1 rounded-pill bg-bv/15 border border-bv/35 flex items-center gap-1.5 flex-shrink-0">
            <span className="text-xs">⭐</span><span className="text-xs font-black text-bv-100">{formatNumber(wallet?.bv ?? 0)} BV</span>
            <span className="text-[9px] font-black text-success">{formatDelta(bvMonthlyDelta)}</span>
          </div>
        </div>
        <div className="text-xs text-text-secondary font-bold truncate">{realName} {classroomName && `· ${classroomName}`}</div>
      </div>
    </div>
  );
}

// =====================================================================
// 캐릭터 아바타 (장착한 캐릭터 이미지)
// =====================================================================

function CharacterAvatar() {
  const student = useCurrentStudent();
  const { character } = useMyEquippedCharacter();
  const equippedCharacterUrl = getEquippedCharacterImageUrl(character, 'avatar');

  if (equippedCharacterUrl) {
    return (
      <div
        className="w-14 h-14 rounded-card-lg overflow-hidden border-2 border-gold/60 bg-bg-deep shadow-brand-md flex-shrink-0"
        title={character?.name ?? '장착 편린'}
      >
        <img
          src={equippedCharacterUrl}
          alt={`${character?.name ?? '장착 편린'} 아바타`}
          className="w-full h-full object-contain object-center"
          loading="eager"
        />
      </div>
    );
  }

  if (character?.emoji) {
    return (
      <div
        className="w-14 h-14 rounded-card-lg flex-shrink-0 bg-bg-deep border-2 border-gold/60 shadow-brand-md flex items-center justify-center text-3xl"
        title={character.name}
        aria-label={`${character.name} 장착`}
      >
        {character.emoji}
      </div>
    );
  }

  // Fallback — 장착 편린이 없을 때만 이름 첫 글자
  const firstChar = student?.studentName?.charAt(0) ?? '?';

  return (
    <div className="w-14 h-14 rounded-card-lg flex-shrink-0 bg-gradient-to-br from-gold to-brand-primary flex items-center justify-center border-2 border-white/30 shadow-brand-md">
      <span className="font-display text-2xl text-white">{firstChar}</span>
    </div>
  );
}

// =====================================================================
// 우측 — 재화 알약 (골드 + 크리스탈)
// =====================================================================

function CurrencyBar() {
  const { wallet, isLoading } = useWallet();
  
  return (
    <div className="flex gap-1.5 items-center flex-shrink-0">
      <CurrencyPill
        token="GOLD"
        amount={isLoading ? null : (wallet?.gold ?? 0)}
        icon="🪙"
      />
      <CurrencyPill
        token="CRYSTAL"
        amount={isLoading ? null : (wallet?.crystal ?? 0)}
        icon="💎"
      />
    </div>
  );
}

// =====================================================================
// 재화 알약 단일
// =====================================================================

interface CurrencyPillProps {
  token: 'GOLD' | 'CRYSTAL';
  amount: number | null;
  icon: string;
}

function CurrencyPill({ token, amount, icon }: CurrencyPillProps) {
  const colorClass = token === 'GOLD' ? 'text-gold' : 'text-crystal';
  
  return (
    <motion.div
      whileTap={{ scale: 0.95 }}
      className="flex items-center gap-1 px-2.5 py-1.5 pl-2 bg-bg-card backdrop-blur-card rounded-pill border border-line cursor-pointer hover-lift"
    >
      <span className="text-sm">{icon}</span>
      <span className={`text-xs font-extrabold ${colorClass} font-feature-numeric tracking-tight`}>
        {amount === null ? '···' : formatNumber(amount)}
      </span>
      <span className="w-3.5 h-3.5 rounded-full bg-gold/20 flex items-center justify-center text-gold text-xs font-black ml-0.5">
        +
      </span>
    </motion.div>
  );
}
