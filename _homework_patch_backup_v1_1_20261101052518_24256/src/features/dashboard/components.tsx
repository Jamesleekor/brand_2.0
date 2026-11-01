// =====================================================================
// B.R.A.N.D 2.0 — 대시보드 컴포넌트 모음
// Stage 6-B · 생성일 2026-05-20
// =====================================================================
// EmergencyQuestBanner, BackgroundSkin, TierCard, 
// AchievementCard, CreditCard, BvBar
// 
// 각 컴포넌트는 v4 디자인 그대로 React로 변환.
// =====================================================================

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useStudentId, useCurrentStudent } from '@/stores/auth_store';
import { useWallet } from '@/hooks/useWallet';
import { formatNumber, formatDelta, formatPercent, calculateProgress } from '@/lib/utils/format';
import { getTierIconUrl } from '@/lib/assets/asset_urls';
import { getTierIconEmoji } from '@/constants/tier_thresholds';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import type { Tier } from '@/types/database_types';

// =====================================================================
// EmergencyQuestBanner — 돌발 퀘스트 알림
// =====================================================================

interface EmergencyQuestBannerProps {
  quest: {
    id: number;
    title: string;
    expiresAt: string;
    requestStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  } | null;
  onClick?: () => void;
}

export function EmergencyQuestBanner({ quest, onClick }: EmergencyQuestBannerProps) {
  if (!quest) return null;
  const pending = quest.requestStatus === 'PENDING';
  
  // 남은 시간 계산
  const remainingMinutes = Math.max(
    0,
    Math.floor((new Date(quest.expiresAt).getTime() - Date.now()) / 60000)
  );
  
  const remainingText = remainingMinutes > 60
    ? `${Math.floor(remainingMinutes / 60)}시간 남음`
    : `${remainingMinutes}분 남음`;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="relative z-10 mx-4 mt-3 px-3.5 py-2.5 bg-gradient-to-r from-danger/25 to-brand-primary/20 backdrop-blur-card border border-line-brand rounded-card-md flex items-center gap-2.5 cursor-pointer animate-pulse-border"
    >
      <span className="text-xl drop-shadow-[0_2px_4px_rgba(255,140,66,0.6)]">⚡</span>
      
      <div className="flex-1 min-w-0">
        <div className="text-2xs tracking-widest text-brand-glow font-black uppercase mb-0.5">
          {pending ? '완료 승인 대기' : '돌발 퀘스트'} · {remainingText}
        </div>
        <div className="text-sm font-extrabold text-white truncate">
          {quest.title}
        </div>
      </div>
      
      <span className="text-brand-primary text-base">{pending ? '⏳' : '›'}</span>
    </motion.div>
  );
}


interface AssignmentNoticeBannerProps {
  count: number;
  onClick?: () => void;
}

export function AssignmentNoticeBanner({ count, onClick }: AssignmentNoticeBannerProps) {
  if (!count) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="relative z-10 mx-4 mt-3 px-3.5 py-2.5 bg-gradient-to-r from-bv/25 to-brand-primary/20 backdrop-blur-card border border-bv/40 rounded-card-md flex items-center gap-2.5 cursor-pointer"
    >
      <span className="text-xl">📝</span>
      <div className="flex-1 min-w-0">
        <div className="text-2xs tracking-widest text-brand-glow font-black uppercase mb-0.5">새 과제 알림</div>
        <div className="text-sm font-extrabold text-white truncate">제출이 필요한 공개 과제 {count}개</div>
      </div>
      <span className="text-brand-primary text-base">›</span>
    </motion.div>
  );
}

// =====================================================================
// BackgroundSkin — 학생이 장착한 배경 일러스트
// =====================================================================

interface BackgroundSkinProps {
  imageUrl: string | null;
}

export function BackgroundSkin({ imageUrl }: BackgroundSkinProps) {
  if (!imageUrl) {
    // Fallback — 별 + 그라데이션
    return (
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <StarParticles />
      </div>
    );
  }
  
  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
      <img
        src={resolveAssetUrl(imageUrl, 'background')}
        alt="배경"
        className="w-full h-full object-cover"
        loading="eager"
      />
      <div className="absolute inset-0 bg-black/50" />
      <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/45 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/55 to-transparent" />
    </div>
  );
}

// 별 파티클
function StarParticles() {
  const positions = [
    { top: '8%',  left: '15%' },
    { top: '20%', right: '20%' },
    { top: '45%', left: '8%' },
    { top: '30%', right: '8%' },
    { top: '55%', right: '15%' },
    { top: '60%', left: '25%' },
  ];
  
  return (
    <div className="absolute inset-0 opacity-70">
      {positions.map((pos, i) => (
        <div
          key={i}
          className="absolute w-0.5 h-0.5 bg-white rounded-full animate-twinkle"
          style={{
            ...pos,
            animationDelay: `${(i * 0.5) % 4}s`,
            boxShadow: '0 0 4px rgba(255,255,255,0.8)',
          }}
        />
      ))}
    </div>
  );
}

// =====================================================================
// TierCard — 우측 가장 큰 카드 (티어 이미지 + 이름 + 진행률)
// =====================================================================

interface TierCardProps {
  tier: Tier;
  currentBv: number;
  nextBv: number;          // 다음 티어 시작 BV
  className?: string;
}

export function TierCard({ tier, currentBv, nextBv, className }: TierCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  useEffect(() => {
    setImageFailed(false);
    setImageLoaded(false);
  }, [tier]);
  // 진행률 계산 — 이전 티어 시작점부터 이번 티어 시작점까지
  // 단순화: 전체 nextBv 중 currentBv 비율 (실제로는 prev~next 구간)
  // TODO: 정확한 진행률은 prev tier 시작점도 알아야 함 (Sub-step 6-D에서 보강)
  const progress = calculateProgress(currentBv, nextBv);
  const progressPercent = Math.round(progress * 100);
  const remaining = Math.max(0, nextBv - currentBv);
  
  return (
    <Link to="/profile" className={className}>
      <motion.div
        whileTap={{ scale: 0.97 }}
        className="bg-bg-card backdrop-blur-card border border-warning/40 rounded-card-lg p-3.5 cursor-pointer relative overflow-hidden shadow-brand-md"
      >
        {/* 빛 효과 */}
        <div className="absolute top-[-40px] left-1/2 -translate-x-1/2 w-24 h-24 rounded-full bg-gold/40 blur-2xl pointer-events-none" />
        

        <div className="text-sm tracking-wide uppercase text-white/90 font-black text-center mb-2 relative">
          현재 티어
        </div>
        
        {/* 티어 이미지 */}
        <div className="w-20 h-20 mx-auto mb-2 relative flex items-center justify-center">
          {/* 네트워크 이미지가 늦게 와도 빈칸을 보여주지 않는다. 정확한 티어 이모지를 즉시 fallback으로 표시하고 이미지 로드 완료 후 교체한다. */}
          {(!imageLoaded || imageFailed) && (
            <div className="absolute inset-0 rounded-full border border-warning/40 bg-warning/10 flex items-center justify-center text-4xl shadow-[0_0_20px_rgba(255,217,61,0.35)]">
              {getTierIconEmoji(tier)}
            </div>
          )}
          {!imageFailed && (
            <img
              key={tier}
              src={getTierIconUrl(tier)}
              alt={tier}
              className={`absolute inset-0 w-20 h-20 object-contain transition-opacity duration-150 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              style={{ filter: 'drop-shadow(0 0 20px rgba(255, 217, 61, 0.6))' }}
              fetchPriority="high"
              decoding="async"
              onLoad={() => setImageLoaded(true)}
              onError={() => { setImageFailed(true); setImageLoaded(false); }}
            />
          )}
        </div>
        
        {/* 티어 이름 */}

        <div className="font-display text-base text-white text-center leading-tight mb-2.5 relative tracking-tight">
          {tier}
        </div>
        
        {/* 진행률 바 */}
        <div className="h-1.5 bg-white/15 rounded-pill overflow-hidden relative mb-1.5">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="h-full bg-gradient-to-r from-gold to-brand-primary rounded-pill shadow-[0_0_8px_rgba(255,217,61,0.6)]"
          />
        </div>
        
        {/* 진행률 텍스트 */}

        <div className="text-xs text-white/80 font-extrabold flex justify-between relative">
          <span>{progressPercent}%</span>
          <span className="text-gold">+{formatNumber(remaining)} BV</span>
        </div>
      </motion.div>
    </Link>
  );
}

// =====================================================================
// AchievementCard — 업적도감 진행
// =====================================================================

interface AchievementCardProps {
  earned: number;
  total: number;
  epicCount: number;
  hiddenCount: number;
  className?: string;
}

export function AchievementCard({ 
  earned, total, epicCount, hiddenCount, className 
}: AchievementCardProps) {
  return (
    <Link to="/achievement" className={className}>
      <motion.div
        whileTap={{ scale: 0.97 }}
        className="bg-bg-card backdrop-blur-card border border-line rounded-card-md p-2.5 px-3 cursor-pointer hover-lift relative overflow-hidden"
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-sm">🏆</span>

          <span className="text-sm text-white/90 font-extrabold tracking-tight">
            업적도감
          </span>
        </div>
        

        <div className="font-display text-2xl text-bv tracking-tighter leading-none">
          {earned}
          <span className="text-sm text-white/70 ml-1">/{total}</span>
        </div>
      </motion.div>
    </Link>
  );
}

// =====================================================================
// CreditCard — 신용등급
// =====================================================================

interface CreditCardProps {
  grade: 'S' | 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';
  score: number;
  className?: string;
}

export function CreditCard({ grade, score, className }: CreditCardProps) {
  const gradeLabel = {
    'S': '최우수',
    'A+': '우수+',
    'A': '우수',
    'B+': '양호+',
    'B': '양호',
    'C': '보통',
    'D': '대출불가',
  }[grade];
  
  return (
    <Link to="/profile" className={className}>
      <motion.div
        whileTap={{ scale: 0.97 }}
        className="bg-bg-card backdrop-blur-card border border-line rounded-card-md p-2.5 px-3 cursor-pointer hover-lift relative overflow-hidden"
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-sm">💳</span>

          <span className="text-sm text-white/90 font-extrabold tracking-tight">
            신용등급
          </span>
        </div>
        

        <div className="font-display text-3xl text-gold tracking-tighter leading-none">
          {grade}
        </div>
        
        <div className="text-sm text-gold font-bold mt-1">
          {formatNumber(score)} 점 · {gradeLabel}
        </div>
      </motion.div>
    </Link>
  );
}

// =====================================================================
// BvBar — 하단 BV 강조 바 (이번 달 증가량)
// =====================================================================

interface BvBarProps {
  currentBv: number;
  monthlyDelta: number;   // 이번 달 증가량
}

export function BvBar({ currentBv, monthlyDelta }: BvBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="absolute bottom-[92px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[448px] z-10 bg-gradient-to-br from-bv/20 to-bv-500/15 backdrop-blur-card border border-bv/40 rounded-card-xl px-4 py-3.5 flex items-center gap-3"
    >
      <div className="w-10 h-10 rounded-card-sm bg-gradient-to-br from-bv-300 to-bv-500 flex items-center justify-center text-xl shadow-bv-sm">
        ⭐
      </div>
      
      <div className="flex-1">
        <div className="text-2xs text-bv-100 tracking-widest font-black uppercase mb-0.5">
          Brand Value · 명예 점수
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-2xl text-white tracking-tighter leading-none">
            {formatNumber(currentBv)}
          </span>
          <span className="text-xs text-text-secondary font-extrabold">BV</span>
        </div>
      </div>
      
      <div className="flex flex-col items-end gap-0.5">
        <div className="px-2.5 py-1 bg-success-bg rounded-pill text-xs font-black text-success">
          {formatDelta(monthlyDelta)}
        </div>
        <div className="text-[9px] text-text-muted tracking-wide uppercase font-extrabold">
          이번 달
        </div>
      </div>
    </motion.div>
  );
}


export interface EmergencyStatusItem {
  id: number;
  emergency_type: 'HYPERINFLATION' | 'EMPLOYMENT_FREEZE' | 'ASSET_FREEZE';
  reason: string | null;
  scheduled_end_at: string | null;
}

export function EmergencyStatusBanner({ emergencies }: { emergencies: EmergencyStatusItem[] }) {
  if (!emergencies.length) return null;
  const config = {
    HYPERINFLATION: { emoji: '📈', title: '초인플레이션', desc: '시장 가격에 비상사태 효과가 적용되고 있습니다.' },
    EMPLOYMENT_FREEZE: { emoji: '🚫', title: '고용 동결', desc: '고용·직업 관련 기능이 제한되고 있습니다.' },
    ASSET_FREEZE: { emoji: '🧊', title: '자산 동결', desc: '송금·교환·기부 등 자산 사용과 이동이 제한됩니다.' },
  } as const;
  return <div className="relative z-10 mx-4 mt-3 space-y-2">{emergencies.map((e) => {
    const c = config[e.emergency_type];
    const until = e.scheduled_end_at ? new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(e.scheduled_end_at)) : null;

    return <div key={e.id} className="px-3.5 py-3 bg-bg-overlay/95 border border-danger/60 rounded-card-md flex items-start gap-2.5 shadow-card">
      <span className="text-xl">{c.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-black text-white">{c.title}{until?<span className="text-warning">{` · ${until} 종료 예정`}</span>:null}</div>
        <div className="text-xs text-white/80 mt-1 break-keep">{e.reason||c.desc}</div>
      </div>
    </div>;
  })}</div>;
}

// =====================================================================
// PrimaryJobCard — 나의 1인1역 + 일급
// =====================================================================

interface PrimaryJobCardProps {
  jobName?: string | null;
  dailyWage?: number | null;
  className?: string;
}

export function PrimaryJobCard({ jobName, dailyWage, className }: PrimaryJobCardProps) {
  const hasAssignment = Boolean(jobName?.trim());

  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      className={cnDashboardCard(className)}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-sm">🧑‍💼</span>
        <span className="text-sm text-white/90 font-extrabold tracking-tight">나의 1인1역</span>
      </div>
      <div className="truncate text-sm font-black text-white" title={jobName ?? undefined}>
        {hasAssignment ? jobName : '배정 없음'}
      </div>
      <div className="mt-1 text-sm font-black text-gold">
        {hasAssignment && dailyWage != null ? `일급 ${formatNumber(dailyWage)} GOLD` : '일급 -'}
      </div>
    </motion.div>
  );
}

function cnDashboardCard(className?: string) {
  return [
    'bg-bg-card backdrop-blur-card border border-line rounded-card-md p-2.5 px-3 relative overflow-hidden',
    className,
  ].filter(Boolean).join(' ');
}
