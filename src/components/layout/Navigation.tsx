// =====================================================================
// B.R.A.N.D 2.0 — UtilityRow + TopMenuRow + BottomNav
// Stage 6-B · 생성일 2026-05-20
// =====================================================================
// UtilityRow: 출석·우편함·알림·설정 (우측 정렬)
// TopMenuRow: 친구·길드·시장·랭킹 (아래줄, 우측 정렬)
// BottomNav: 홈·자산·꾸미기·업적·프로필
// =====================================================================

import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils/cn';

// =====================================================================
// UtilityRow — 출석·우편함·알림·설정
// =====================================================================

interface UtilityRowProps {
  onAttendanceClick: () => void;
  onMailClick: () => void;
  onAlertsClick: () => void;
  attendanceUnclaimed: boolean;  // 오늘 출석 보상 우편함에 있는지
  mailUnreadCount: number;
  alertsUnreadCount: number;
}

export function UtilityRow({
  onAttendanceClick,
  onMailClick,
  onAlertsClick,
  attendanceUnclaimed,
  mailUnreadCount,
  alertsUnreadCount,
}: UtilityRowProps) {
  return (
    <div className="relative z-10 px-4 pt-3 flex justify-end gap-2 items-center">
      <UtilityButton
        icon="📅"
        onClick={onAttendanceClick}
        showDot={attendanceUnclaimed}
        aria-label="출석"
      />
      <UtilityButton
        icon="✉️"
        onClick={onMailClick}
        badge={mailUnreadCount}
        aria-label="우편함"
      />
      <UtilityButton
        icon="🔔"
        onClick={onAlertsClick}
        badge={alertsUnreadCount}
        aria-label="알림"
      />
      <Link to="/settings">
        <UtilityButton
          icon="⚙️"
          aria-label="설정"
        />
      </Link>
    </div>
  );
}

// =====================================================================
// UtilityButton — 단일 버튼
// =====================================================================

interface UtilityButtonProps {
  icon: string;
  onClick?: () => void;
  badge?: number;
  showDot?: boolean;
  'aria-label': string;
}

function UtilityButton({ icon, onClick, badge, showDot, ...ariaProps }: UtilityButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      className="w-10 h-10 rounded-card-md bg-bg-card backdrop-blur-card border border-line flex items-center justify-center text-lg relative hover-lift transition-all"
      {...ariaProps}
    >
      {icon}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1.5 rounded-pill bg-danger text-white text-2xs font-black flex items-center justify-center border-2 border-bg-base">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {showDot && !badge && (
        <span className="absolute top-1.5 right-2 w-2 h-2 bg-danger rounded-full border-2 border-bg-base" />
      )}
    </motion.button>
  );
}

// =====================================================================
// TopMenuRow — 친구·길드·시장·랭킹
// =====================================================================

interface TopMenuRowProps {
  guildAlertCount?: number;
}

export function TopMenuRow({ guildAlertCount = 0 }: TopMenuRowProps) {
  return (
    <div className="relative z-10 px-4 pt-2.5 flex gap-1.5 justify-end flex-wrap">
      <MenuPill to="/friends" icon="👥" label="친구" />
      <MenuPill to="/guild" icon="⚔️" label="길드" badge={guildAlertCount} />
      <MenuPill to="/arcade" icon="🕹️" label="아케이드" />
      <MenuPill to="/market" icon="🏪" label="시장" />
      <MenuPill to="/rankings" icon="📊" label="랭킹" />
      <MenuPill to="/assignments" icon="📝" label="과제" />
      <MenuPill to="/records" icon="🏛️" label="기록실" />
    </div>
  );
}

// =====================================================================
// MenuPill — 단일 메뉴
// =====================================================================

interface MenuPillProps {
  to: string;
  icon: string;
  label: string;
  badge?: number;
}

function MenuPill({ to, icon, label, badge }: MenuPillProps) {
  return (
    <Link to={to}>
      <motion.div
        whileTap={{ scale: 0.95 }}
        className="flex items-center gap-1.5 px-3.5 py-2 bg-bg-card backdrop-blur-card rounded-pill border border-line hover-lift transition-all relative"
      >
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-extrabold text-text-secondary tracking-tight">
          {label}
        </span>
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-pill bg-danger text-white text-[9px] font-black flex items-center justify-center border-2 border-bg-base">
            {badge}
          </span>
        )}
      </motion.div>
    </Link>
  );
}

// =====================================================================
// BottomNav — 홈·자산·꾸미기·업적·프로필
// =====================================================================

const NAV_ITEMS = [
  { to: '/home',       icon: '🏠', label: '홈' },
  { to: '/wallet',     icon: '💼', label: '자산' },
  { to: '/cosmetic',   icon: '🎨', label: '꾸미기' },
  { to: '/achievement', icon: '🏆', label: '업적' },
  { to: '/profile',    icon: '👤', label: '프로필' },
] as const;

export function BottomNav() {
  const location = useLocation();
  
  return (
    <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[448px] z-20 bg-bg-overlay backdrop-blur-card rounded-card-xl p-2 shadow-card border border-line">
      <div className="flex justify-around">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.to ||
            (item.to === '/home' && location.pathname === '/');
          
          return (
            <Link key={item.to} to={item.to} className="flex-1">
              <motion.div
                whileTap={{ scale: 0.92 }}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2 px-3 rounded-card-md transition-all relative',
                  isActive && 'bg-gradient-to-br from-brand-primary/20 to-gold/10'
                )}
              >
                {/* 활성 인디케이터 (상단 빛나는 선) */}
                {isActive && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-gradient-to-r from-gold to-brand-primary rounded-pill"
                  />
                )}
                
                <span className="text-lg">{item.icon}</span>
                <span
                  className={cn(
                    'text-2xs font-black tracking-tight',
                    isActive ? 'text-gold-gradient' : 'text-text-secondary'
                  )}
                >
                  {item.label}
                </span>
              </motion.div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
