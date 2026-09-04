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
// RankingsPage — 학급 랭킹
// =====================================================================

type RankingType = 'BV' | 'GOLD' | 'ACHIEVEMENT';

export function RankingsPage() {
  const [type, setType] = useState<RankingType>('BV');
  
  return (
    <>
      <PageHeader title="랭킹" emoji="📊" />
      
      <div className="px-4 pt-4">
        {/* 랭킹 타입 탭 */}
        <div className="flex gap-1.5 mb-4">
          {[
            { value: 'BV',          label: 'BV',     emoji: '⭐' },
            { value: 'GOLD',        label: '골드',    emoji: '🪙' },
            { value: 'ACHIEVEMENT', label: '업적',    emoji: '🏆' },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setType(tab.value as RankingType)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-pill text-xs font-extrabold transition-all',
                type === tab.value
                  ? 'bg-gradient-to-r from-brand-primary to-gold text-white shadow-brand-sm'
                  : 'bg-bg-card border border-line text-text-secondary'
              )}
            >
              <span>{tab.emoji}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        
        <RankingList type={type} />
      </div>
    </>
  );
}

function RankingList({ type }: { type: RankingType }) {
  const classroomId = useClassroomId();
  const studentId = useStudentId();
  const { byStudentId: achievementTitles } = useClassroomAchievementTitles();
  const { byStudentId: equippedCharacters } = useClassroomEquippedCharacters();
  const { byStudentId: guildsByStudentId } = useClassroomStudentGuilds();
  
  const { data: ranks, isLoading } = useQuery({
    queryKey: ['rankings', classroomId, type],
    queryFn: async () => {
      if (!classroomId) return [];
      
      if (type === 'BV' || type === 'GOLD') {
        // wallets에서 직접 정렬
        const { data } = await supabase
          .from('wallets')
          .select(`
            student_id, bv, gold,
            student:students!student_id(id, name, brand_name, cached_tier, classroom_id)
          `)
          .order(type === 'BV' ? 'bv' : 'gold', { ascending: false })
          .limit(30);
        
        return (data ?? [])
          .filter((r: any) => r.student?.classroom_id === classroomId)
          .map((r: any) => ({
            studentId: r.student_id,
            name: r.student?.name ?? '',
            brandName: r.student?.brand_name,
            tier: (r.student?.cached_tier ?? '새싹') as Tier,
            value: Number(type === 'BV' ? r.bv : r.gold),
            isMe: r.student_id === studentId,
          }));
      } else {
        // 업적 카운트로 정렬
        const { data } = await supabase
          .from('student_achievements')
          .select(`
            student_id,
            student:students!student_id(id, name, brand_name, cached_tier, classroom_id)
          `)
          .eq('is_revoked', false);
        
        // 학급별 + 학생별 카운트
        const countMap = new Map<number, { count: number; student: any }>();
        (data ?? []).forEach((sa: any) => {
          if (sa.student?.classroom_id !== classroomId) return;
          const existing = countMap.get(sa.student_id);
          if (existing) {
            existing.count++;
          } else {
            countMap.set(sa.student_id, { count: 1, student: sa.student });
          }
        });
        
        return Array.from(countMap.entries())
          .sort(([, a], [, b]) => b.count - a.count)
          .slice(0, 30)
          .map(([rankStudentId, { count, student }]) => ({
            studentId: rankStudentId,
            name: student?.name ?? '',
            brandName: student?.brand_name,
            tier: (student?.cached_tier ?? '새싹') as Tier,
            value: count,
            isMe: rankStudentId === studentId,
          }));
      }
    },
    enabled: classroomId !== null,
  });
  
  if (isLoading) {
    return <div className="py-8 flex justify-center"><LoadingSpinner size="lg" /></div>;
  }
  
  if (!ranks || ranks.length === 0) {
    return <EmptyState emoji="📊" title="아직 랭킹 데이터가 없어요" />;
  }
  
  if (type === 'ACHIEVEMENT') {
    const achievementRanks: AchievementRankingEntry[] = ranks.map((rank) => {
      const character = equippedCharacters.get(Number(rank.studentId)) ?? null;
      return {
        ...(rank as AchievementRankingEntry),
        guildName: guildsByStudentId.get(Number(rank.studentId))?.guildName ?? null,
        equippedCharacterUrl: getEquippedCharacterImageUrl(character, 'avatar'),
        characterEmoji: character?.emoji ?? null,
      };
    });

    return (
      <AchievementRankingShowcase
        ranks={achievementRanks}
        achievementTitles={achievementTitles}
      />
    );
  }

  return (
    <div className="space-y-1.5">
      {ranks.map((rank, idx) => (
        <RankItem
          key={rank.studentId}
          rank={idx + 1}
          item={rank}
          type={type}
          achievementTitle={achievementTitles.get(rank.studentId) ?? null}
          guildName={guildsByStudentId.get(rank.studentId)?.guildName ?? null}
        />
      ))}
    </div>
  );
}

function RankItem({ 
  rank, item, type, achievementTitle, guildName,
}: { 
  rank: number;
  item: { studentId: number; name: string; brandName: string | null; tier: Tier; value: number; isMe: boolean };
  type: RankingType;
  achievementTitle: EquippedAchievementTitle | null;
  guildName: string | null;
}) {
  const isTop3 = rank <= 3;
  const rankBg = rank === 1 ? 'bg-gold' 
    : rank === 2 ? 'bg-text-secondary'
    : rank === 3 ? 'bg-warning'
    : 'bg-bg-deep';
  
  const valueColor = type === 'BV' ? 'text-bv' 
    : type === 'GOLD' ? 'text-gold'
    : 'text-success';
  
  const valueSuffix = type === 'ACHIEVEMENT' ? '개' : '';
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        'flex items-center gap-3 px-3.5 py-2.5 rounded-card-md transition-all',
        item.isMe
          ? 'bg-gold/8 border border-gold/30'
          : 'bg-bg-card backdrop-blur-card border border-line',
        isTop3 && !item.isMe && 'border-line-brand'
      )}
    >
      <div className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center font-display text-sm flex-shrink-0',
        isTop3 ? `${rankBg} text-bg-base` : 'text-text-muted'
      )}>
        {rank <= 3 ? rank : `${rank}`}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="text-sm font-extrabold text-white min-w-0 flex flex-wrap items-center gap-1.5">
          <span className="truncate">{item.brandName || item.name}</span>
          {item.isMe && (
            <span className="text-[9px] font-black text-gold bg-gold/20 px-1.5 py-0.5 rounded-pill">나</span>
          )}
        </div>
        <div className="mt-1 flex min-w-0">
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
        <div className="mt-1 text-xs text-slate-200 font-bold truncate">
          {item.tier}
        </div>
      </div>
      
      <div className="text-right flex-shrink-0">
        <div className={cn('font-mono text-base font-bold leading-none', valueColor)}>
          {formatNumber(item.value)}{valueSuffix}
        </div>
      </div>
    </motion.div>
  );
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
