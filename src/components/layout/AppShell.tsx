// =====================================================================
// B.R.A.N.D 2.0 — Protected Route + App Shell
// Stage 6-B · 생성일 2026-05-20
// =====================================================================
// 1. ProtectedRoute — 미인증 시 로그인으로 리다이렉트
// 2. AppShell — 학생 페이지 공통 레이아웃 (배경 + 안전영역)
// 3. TeacherShell — 교사 페이지 공통 레이아웃
// =====================================================================

import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth_store';

// =====================================================================
// ProtectedRoute — 학생 전용
// =====================================================================

interface ProtectedRouteProps {
  children: ReactNode;
  requireTeacher?: boolean;
}

export function ProtectedRoute({ children, requireTeacher = false }: ProtectedRouteProps) {
  const location = useLocation();
  const { session, context, isInitialized, initialize } = useAuthStore();
  
  useEffect(() => {
    initialize();
  }, [initialize]);
  
  // 초기화 중
  if (!isInitialized) {
    return <FullPageLoader />;
  }
  
  // 미인증 → 로그인으로
  if (!session || !context) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  // 교사 전용 페이지에 학생 접근
  if (requireTeacher && !context.isTeacher) {
    return <Navigate to="/home" replace />;
  }

  // 저장된 교사 세션으로 기본 /home에 들어오면 학생 홈을 거치지 않고 운영 패널로 복귀
  if (!requireTeacher && context.isTeacher && location.pathname === '/home') {
    return <Navigate to="/teacher" replace />;
  }
  
  // 학생인데 교사 라우트 접근 → /home으로
  if (!requireTeacher && context.isTeacher && location.pathname.startsWith('/teacher')) {
    // 의도적인 케이스 — 그대로 진행
  }
  
  return <>{children}</>;
}

// =====================================================================
// AppShell — 학생 페이지 공통 레이아웃
// =====================================================================
// v4 디자인의 배경 그라데이션 + 안전 영역 + 하단 네비 공간 확보

interface AppShellProps {
  children: ReactNode;
  hideBottomNav?: boolean;  // 일부 페이지에서는 네비 숨김
}

export function AppShell({ children, hideBottomNav = false }: AppShellProps) {
  return (
    <div className="app-container">
      {/* 메인 컨텐츠 — 하단 네비 영역만큼 padding */}
      <div className={hideBottomNav ? '' : 'pb-24'}>
        {children}
      </div>
    </div>
  );
}

// =====================================================================
// Loader
// =====================================================================

export function FullPageLoader() {
  return (
    <div className="app-container flex items-center justify-center">
      <div className="text-center">
        <div className="text-5xl mb-3 animate-pulse">⭐</div>
        <div className="text-text-secondary text-sm font-bold">불러오는 중...</div>
      </div>
    </div>
  );
}

// =====================================================================
// 사용 예시 (App.tsx에서)
// =====================================================================
//
// <Routes>
//   <Route path="/login" element={<LoginPage />} />
//   
//   <Route element={<ProtectedRoute><Outlet /></ProtectedRoute>}>
//     <Route path="/home" element={<AppShell><DashboardPage /></AppShell>} />
//     <Route path="/wallet" element={<AppShell><WalletPage /></AppShell>} />
//     ...
//   </Route>
//   
//   <Route element={<ProtectedRoute requireTeacher><Outlet /></ProtectedRoute>}>
//     <Route path="/teacher" element={<TeacherShell><TeacherDashboard /></TeacherShell>} />
//     ...
//   </Route>
// </Routes>
