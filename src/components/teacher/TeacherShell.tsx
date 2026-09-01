// =====================================================================
// B.R.A.N.D 2.0 — 교사 셸 + 공통 레이아웃
// Stage 6-D · 생성일 2026-05-20
// S4.2 IA refresh · 2026-08-30
// =====================================================================

import { useState, type ReactNode } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore, useCurrentStudent } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';

interface TeacherShellProps {
  children: ReactNode;
}

type TeacherNavItem = { to: string; icon: string; label: string };
type TeacherNavGroup = { id: string; icon: string; label: string; items: readonly TeacherNavItem[] };

const DASHBOARD_ITEM: TeacherNavItem = { to: '/teacher', icon: '🏠', label: '대시보드' };

const NAV_GROUPS: readonly TeacherNavGroup[] = [
  {
    id: 'students', icon: '👥', label: '학생 관리',
    items: [
      { to: '/teacher/review', icon: '📋', label: '검토 큐' },
      { to: '/teacher/learning', icon: '📚', label: '출석·과제' },
      { to: '/teacher/primary-jobs', icon: '🧑‍💼', label: '1인1역' },
      { to: '/teacher/secondary-jobs', icon: '💼', label: '2차직업' },
    ],
  },
  {
    id: 'growth', icon: '✨', label: '성장 시스템',
    items: [
      { to: '/teacher/achievements', icon: '🏆', label: '업적 관리' },
      { to: '/teacher/achievement-statistics', icon: '📈', label: '업적 통계' },
      { to: '/teacher/characters', icon: '✦', label: '편린 운영' },
      { to: '/teacher/daily-quests', icon: '✅', label: '일일퀘스트' },
    ],
  },
  {
    id: 'economy', icon: '💰', label: '경제',
    items: [
      { to: '/teacher/control', icon: '⚙️', label: '경제 현황' },
      { to: '/teacher/market', icon: '🏪', label: '시장' },
      { to: '/teacher/bank', icon: '🏦', label: '은행' },
      { to: '/teacher/auction', icon: '🔨', label: '경매' },
    ],
  },
  {
    id: 'content', icon: '⚔️', label: '길드 & 콘텐츠',
    items: [
      { to: '/teacher/guild', icon: '⚔️', label: '길드' },
      { to: '/teacher/arcade', icon: '🕹️', label: 'Arcade' },
      { to: '/teacher/operations', icon: '🚨', label: '이벤트' },
    ],
  },
  {
    id: 'communication', icon: '💬', label: '소통 & 기록',
    items: [
      { to: '/teacher/communications', icon: '📬', label: '소통' },
      { to: '/teacher/records', icon: '🏛️', label: '기록실' },
    ],
  },
  {
    id: 'analysis', icon: '📊', label: '분석 & 관리',
    items: [
      { to: '/teacher/analytics', icon: '📊', label: '분석' },
      { to: '/teacher/test-fixture', icon: '🧪', label: 'TEST 운영' },
    ],
  },
] as const;

function pathIsActive(pathname: string, to: string) {
  return to === '/teacher'
    ? pathname === '/teacher'
    : pathname === to || pathname.startsWith(`${to}/`);
}

function activeGroupId(pathname: string) {
  return NAV_GROUPS.find((group) => group.items.some((item) => pathIsActive(pathname, item.to)))?.id ?? null;
}

export function TeacherShell({ children }: TeacherShellProps) {
  return (
    <div className="teacher-shell min-h-screen bg-bg-base">
      <TeacherTopBar />
      <div className="flex">
        <TeacherSidebar />
        <main className="mx-auto min-w-0 max-w-7xl flex-1 p-6">
          {children}
        </main>
      </div>
      <TeacherMobileNav />
    </div>
  );
}

function TeacherTopBar() {
  const teacher = useCurrentStudent();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg-base/95 backdrop-blur-card">
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <Link to="/teacher" className="flex items-center gap-2">
            <span className="text-2xl">🎓</span>
            <div>
              <div className="font-display text-lg tracking-tight text-brand-gradient">B.R.A.N.D</div>
              <div className="text-2xs font-bold text-text-muted">교사 운영 패널</div>
            </div>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-xs font-extrabold text-text-primary">{teacher?.studentName ?? '선생님'}</div>
            <div className="text-2xs font-bold text-text-muted">{teacher?.classroomName ?? ''}</div>
          </div>
          <button
            onClick={async () => {
              if (confirm('로그아웃하시겠어요?')) {
                await logout();
                navigate('/login', { replace: true });
              }
            }}
            className="flex h-9 w-9 items-center justify-center rounded-card-md border border-line bg-bg-card hover-lift"
            aria-label="로그아웃"
          >
            🚪
          </button>
        </div>
      </div>
    </header>
  );
}

function TeacherSidebar() {
  const location = useLocation();
  const initialActive = activeGroupId(location.pathname);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(initialActive ? [initialActive] : []));

  const toggle = (id: string) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="sticky top-[60px] hidden h-[calc(100vh-60px)] w-64 shrink-0 overflow-y-auto border-r border-line px-3 py-5 md:block">
      <nav className="space-y-2">
        <Link
          to={DASHBOARD_ITEM.to}
          className={cn(
            'flex items-center gap-3 rounded-card-md px-3 py-2.5 transition-all',
            pathIsActive(location.pathname, DASHBOARD_ITEM.to)
              ? 'border border-line-brand bg-gradient-to-r from-brand-primary/20 to-gold/10'
              : 'hover:bg-bg-card'
          )}
        >
          <span className="text-lg">{DASHBOARD_ITEM.icon}</span>
          <span className={cn('text-sm font-extrabold', pathIsActive(location.pathname, DASHBOARD_ITEM.to) ? 'text-gold-gradient' : 'text-text-secondary')}>{DASHBOARD_ITEM.label}</span>
        </Link>

        <div className="my-2 border-t border-line/70" />

        {NAV_GROUPS.map((group) => {
          const groupActive = group.items.some((item) => pathIsActive(location.pathname, item.to));
          const open = openGroups.has(group.id);
          return (
            <div key={group.id} className={cn('rounded-card-md border transition-colors', groupActive ? 'border-line-brand/70 bg-bg-card' : 'border-transparent')}>
              <button
                type="button"
                onClick={() => toggle(group.id)}
                aria-expanded={open}
                className={cn('flex w-full items-center gap-3 rounded-card-md px-3 py-2.5 text-left transition-all', !groupActive && 'hover:bg-bg-card')}
              >
                <span className="text-lg">{group.icon}</span>
                <span className={cn('flex-1 text-sm font-extrabold', groupActive ? 'text-gold' : 'text-text-secondary')}>{group.label}</span>
                <span className={cn('text-xs font-black text-text-muted transition-transform', open && 'rotate-180')}>⌄</span>
              </button>
              {open && (
                <div className="space-y-1 px-2 pb-2">
                  {group.items.map((item) => {
                    const active = pathIsActive(location.pathname, item.to);
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={cn(
                          'flex items-center gap-2 rounded-card-md px-3 py-2 text-xs font-extrabold transition-all',
                          active ? 'bg-gradient-to-r from-brand-primary/20 to-gold/10 text-gold' : 'text-text-secondary hover:bg-bg-deep hover:text-white',
                          item.to === '/teacher/test-fixture' && !active && 'text-text-muted'
                        )}
                      >
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                        {item.to === '/teacher/test-fixture' && <span className="ml-auto rounded-pill border border-line px-1.5 py-0.5 text-[8px] text-text-muted">DEV</span>}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function TeacherMobileNav() {
  const location = useLocation();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const currentGroup = NAV_GROUPS.find((group) => group.id === openGroup) ?? null;

  return (
    <>
      <AnimatePresence>
        {currentGroup && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-[88px] left-4 right-4 z-30 rounded-card-xl border border-line bg-bg-overlay p-3 shadow-card backdrop-blur-card md:hidden"
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-black text-white">{currentGroup.icon} {currentGroup.label}</div>
              <button type="button" className="px-2 py-1 text-xs font-black text-text-muted" onClick={() => setOpenGroup(null)}>닫기 ✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {currentGroup.items.map((item) => {
                const active = pathIsActive(location.pathname, item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpenGroup(null)}
                    className={cn('rounded-card-md border px-3 py-2.5 text-xs font-black', active ? 'border-line-brand bg-brand-primary/15 text-gold' : 'border-line bg-bg-card text-text-secondary')}
                  >
                    {item.icon} {item.label}
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav className="fixed bottom-4 left-1/2 z-20 w-[calc(100%-32px)] max-w-xl -translate-x-1/2 rounded-card-xl border border-line bg-bg-overlay p-2 shadow-card backdrop-blur-card md:hidden">
        <div className="flex gap-1 overflow-x-auto pb-1">
          <Link to="/teacher" className="flex-none min-w-[64px]" onClick={() => setOpenGroup(null)}>
            <motion.div whileTap={{ scale: 0.92 }} className={cn('flex flex-col items-center gap-0.5 rounded-card-md py-2 transition-all', location.pathname === '/teacher' && 'bg-gradient-to-br from-brand-primary/20 to-gold/10')}>
              <span className="text-lg">🏠</span><span className={cn('text-2xs font-black', location.pathname === '/teacher' ? 'text-gold-gradient' : 'text-text-secondary')}>홈</span>
            </motion.div>
          </Link>
          {NAV_GROUPS.map((group) => {
            const active = group.items.some((item) => pathIsActive(location.pathname, item.to));
            return (
              <button key={group.id} type="button" className="flex-none min-w-[64px]" onClick={() => setOpenGroup((current) => current === group.id ? null : group.id)}>
                <motion.div whileTap={{ scale: 0.92 }} className={cn('flex flex-col items-center gap-0.5 rounded-card-md py-2 transition-all', active && 'bg-gradient-to-br from-brand-primary/20 to-gold/10')}>
                  <span className="text-lg">{group.icon}</span><span className={cn('text-2xs font-black', active ? 'text-gold-gradient' : 'text-text-secondary')}>{group.label.replace(' 시스템', '').replace(' & 콘텐츠', '').replace(' & 기록', '').replace(' & 관리', '')}</span>
                </motion.div>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}

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
    gold: 'text-gold border-gold/30',
    bv: 'text-bv border-bv/30',
    crystal: 'text-crystal border-crystal/30',
    success: 'text-success border-success/30',
    danger: 'text-danger border-danger/30',
  }[color];

  return (
    <div className={cn('rounded-card-lg border bg-bg-card p-4 backdrop-blur-card', colorClass)}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xl">{emoji}</span>
        {change && (
          <div className={cn('rounded-pill px-2 py-0.5 text-2xs font-black', change.value >= 0 ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger')}>
            {change.value >= 0 ? '↑' : '↓'} {Math.abs(change.value)}
          </div>
        )}
      </div>
      <div className={cn('mb-1 font-display text-2xl leading-none tracking-tighter', colorClass)}>{value}</div>
      <div className="text-2xs font-extrabold uppercase tracking-wide text-text-secondary">{label}</div>
    </div>
  );
}
