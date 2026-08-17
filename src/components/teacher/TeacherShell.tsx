// =====================================================================
// B.R.A.N.D 2.0 — 교사 셸 + 공통 레이아웃
// Stage 6-D · 생성일 2026-05-20
// =====================================================================
// 교사 페이지의 공통 컴포넌트 — 사이드바·헤더·네비.
// 학생 셸과 다르게 PC·태블릿 우선 (더 넓은 화면).
// =====================================================================

import { useState, type ReactNode } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuthStore, useCurrentStudent } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';

// =====================================================================
// TeacherShell — 교사 페이지 공통 레이아웃
// =====================================================================

interface TeacherShellProps {
  children: ReactNode;
}

export function TeacherShell({ children }: TeacherShellProps) {
  return (
    <div className="teacher-shell min-h-screen bg-bg-base">
      {/* 상단 헤더 */}
      <TeacherTopBar />
      
      {/* 메인 컨텐츠 */}
      <div className="flex">
        {/* 사이드바 (큰 화면) */}
        <TeacherSidebar />
        
        {/* 메인 영역 */}
        <main className="flex-1 min-w-0 p-6 max-w-7xl mx-auto">
          {children}
        </main>
      </div>
      
      {/* 모바일 네비 (작은 화면) */}
      <TeacherMobileNav />
    </div>
  );
}

// =====================================================================
// TeacherTopBar — 상단 헤더
// =====================================================================

function TeacherTopBar() {
  const teacher = useCurrentStudent();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  
  return (
    <header className="sticky top-0 z-30 bg-bg-base/95 backdrop-blur-card border-b border-line">
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <Link to="/teacher" className="flex items-center gap-2">
            <span className="text-2xl">🎓</span>
            <div>
              <div className="font-display text-lg text-brand-gradient tracking-tight">
                B.R.A.N.D
              </div>
              <div className="text-2xs text-text-muted font-bold">
                교사 운영 패널
              </div>
            </div>
          </Link>
        </div>
        
        {/* 우측 — 학급 정보 + 로그아웃 */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:block text-right">
            <div className="text-xs font-extrabold text-text-primary">
              {teacher?.studentName ?? '선생님'}
            </div>
            <div className="text-2xs text-text-muted font-bold">
              {teacher?.classroomName ?? ''}
            </div>
          </div>
          <button
            onClick={async () => {
              if (confirm('로그아웃하시겠어요?')) {
                await logout();
                navigate('/login', { replace: true });
              }
            }}
            className="w-9 h-9 rounded-card-md bg-bg-card border border-line flex items-center justify-center hover-lift"
            aria-label="로그아웃"
          >
            🚪
          </button>
        </div>
      </div>
    </header>
  );
}

// =====================================================================
// TeacherSidebar — 사이드바 메뉴
// =====================================================================

const SIDEBAR_ITEMS = [
  { to: '/teacher',                icon: '🏠', label: '대시보드' },
  { to: '/teacher/review',         icon: '📋', label: '검토 큐' },
  { to: '/teacher/auction',        icon: '🔨', label: '경매 진행' },
  { to: '/teacher/guild',          icon: '⚔️', label: '길드 운영' },
  { to: '/teacher/arcade',         icon: '🕹️', label: 'Arcade 운영' },
  { to: '/teacher/test-fixture',   icon: '🧪', label: 'TEST 운영' },
  { to: '/teacher/control',        icon: '⚙️', label: '경제 운영' },
  { to: '/teacher/communications', icon: '📬', label: '소통' },
  { to: '/teacher/operations',     icon: '🚨', label: '이벤트' },
  { to: '/teacher/learning',       icon: '📚', label: '출석·과제' },
  { to: '/teacher/records',        icon: '🏛️', label: '기록실' },
  { to: '/teacher/analytics',      icon: '📊', label: '분석' },
] as const;

function TeacherSidebar() {
  const location = useLocation();
  
  return (
    <aside className="hidden md:block w-56 border-r border-line py-6 px-3 sticky top-[60px] h-[calc(100vh-60px)]">
      <nav className="space-y-1">
        {SIDEBAR_ITEMS.map((item) => {
          const isActive = item.to === '/teacher'
            ? location.pathname === '/teacher'
            : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
          
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-card-md transition-all',
                isActive
                  ? 'bg-gradient-to-r from-brand-primary/20 to-gold/10 border border-line-brand'
                  : 'hover:bg-bg-card'
              )}
            >
              <span className="text-lg">{item.icon}</span>
              <span className={cn(
                'text-sm font-extrabold',
                isActive ? 'text-gold-gradient' : 'text-text-secondary'
              )}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

// =====================================================================
// TeacherMobileNav — 모바일용 하단 네비
// =====================================================================

function TeacherMobileNav() {
  const location = useLocation();
  
  return (
    <nav className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-md z-20 bg-bg-overlay backdrop-blur-card rounded-card-xl p-2 shadow-card border border-line">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {SIDEBAR_ITEMS.map((item) => {
          const isActive = item.to === '/teacher'
            ? location.pathname === '/teacher'
            : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
          
          return (
            <Link key={item.to} to={item.to} className="flex-none min-w-[68px]">
              <motion.div
                whileTap={{ scale: 0.92 }}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2 rounded-card-md transition-all',
                  isActive && 'bg-gradient-to-br from-brand-primary/20 to-gold/10'
                )}
              >
                <span className="text-lg">{item.icon}</span>
                <span className={cn(
                  'text-2xs font-black',
                  isActive ? 'text-gold-gradient' : 'text-text-secondary'
                )}>
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

// =====================================================================
// 통계 카드 — 교사 대시보드 공통
// =====================================================================

export function StatCard({
  emoji, label, value, change, color = 'gold'
}: {
  emoji: string;
  label: string;
  value: string | number;
  change?: { value: number; label: string };
  color?: 'gold' | 'bv' | 'crystal' | 'success' | 'danger';
}) {
  const colorClass = {
    gold:    'text-gold border-gold/30',
    bv:      'text-bv border-bv/30',
    crystal: 'text-crystal border-crystal/30',
    success: 'text-success border-success/30',
    danger:  'text-danger border-danger/30',
  }[color];
  
  return (
    <div className={cn(
      'bg-bg-card backdrop-blur-card border rounded-card-lg p-4',
      colorClass
    )}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xl">{emoji}</span>
        {change && (
          <div className={cn(
            'text-2xs font-black px-2 py-0.5 rounded-pill',
            change.value >= 0 ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
          )}>
            {change.value >= 0 ? '↑' : '↓'} {Math.abs(change.value)}
          </div>
        )}
      </div>
      <div className={cn('font-display text-2xl tracking-tighter leading-none mb-1', colorClass)}>
        {value}
      </div>
      <div className="text-2xs font-extrabold text-text-secondary uppercase tracking-wide">
        {label}
      </div>
    </div>
  );
}
