// =====================================================================
// B.R.A.N.D 2.0 — App 라우팅 (Sub-step 6-B 갱신)
// =====================================================================
// Sub-step 6-A의 placeholder 라우팅을 실제 페이지로 교체.
// 보호된 라우트 + 학생/교사 분기 적용.
// =====================================================================

import { Routes, Route, Navigate, Outlet } from 'react-router-dom';

import LoginPage from '@/features/auth/LoginPage';
import DashboardPage from '@/features/dashboard/DashboardPage';
import WalletPage from '@/features/wallet/WalletPage';
import ProfilePage from '@/features/profile/ProfilePage';
import AchievementPage from '@/features/achievement/AchievementPage';
import CosmeticPage from '@/features/cosmetic/CosmeticPage';
import MarketPage from '@/features/market/MarketPage';
import GuildPage from '@/features/guild/GuildPage';
import GuildAdmin from '@/features/guild/GuildAdmin';
import GuildScoreAdmin from '@/features/guild/GuildScoreAdmin';
import GuildMissionsPage from '@/features/guild/GuildMissionsPage';
import GuildMissionAdmin from '@/features/guild/GuildMissionAdmin';
import ArcadePage from '@/features/arcade/ArcadePage';
import TeacherArcadePage from '@/features/arcade/TeacherArcadePage';
import { FriendsPage, RankingsPage, SettingsPage } from '@/features/social/social_pages';
import TeacherDashboard from '@/features/teacher/TeacherDashboard';
import ReviewQueue from '@/features/teacher/ReviewQueue';
import ClassroomControl from '@/features/teacher/ClassroomControl';
import AuctionAdmin from '@/features/teacher/AuctionAdmin';
import AuctionBroadcastPage from '@/features/auction/AuctionBroadcastPage';
import AnalyticsPage from '@/features/teacher/AnalyticsPage';
import CommunicationPage from '@/features/feature4/CommunicationPage';
import AssignmentsPage from '@/features/feature4/AssignmentsPage';
import RecordsPage from '@/features/feature4/RecordsPage';
import CommunicationAdmin from '@/features/feature4/CommunicationAdmin';
import OperationsAdmin from '@/features/feature4/OperationsAdmin';
import LearningAdmin from '@/features/feature4/LearningAdmin';
import RecordsAdmin from '@/features/feature4/RecordsAdmin';
import TestClassroomFixturePage from '@/features/teacher/TestClassroomFixturePage';
import { ProtectedRoute, AppShell } from '@/components/layout/AppShell';

// =====================================================================
// 임시 placeholder (Sub-step 6-C 이후 실제 구현)
// =====================================================================

const PlaceholderPage = ({ name }: { name: string }) => (
  <div className="app-container flex items-center justify-center min-h-screen">
    <div className="text-center p-8">
      <div className="text-6xl mb-4">🚧</div>
      <h1 className="font-display text-2xl mb-2 text-brand-gradient">
        {name}
      </h1>
      <p className="text-text-secondary text-sm">
        이 페이지는 다음 Sub-step에서 구현됩니다
      </p>
    </div>
  </div>
);

// =====================================================================
// App
// =====================================================================

export default function App() {
  return (
    <Routes>
      {/* 공개 라우트 */}
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/login" element={<LoginPage />} />
      
      {/* 학생/공통 보호된 라우트 */}
      <Route element={<ProtectedRoute><Outlet /></ProtectedRoute>}>
        {/* 메인 화면 */}
        <Route 
          path="/home" 
          element={<AppShell><DashboardPage /></AppShell>} 
        />
        
        {/* 학생 페이지 (placeholder) */}
        <Route 
          path="/wallet" 
          element={<AppShell><WalletPage /></AppShell>} 
        />
        <Route 
          path="/cosmetic" 
          element={<AppShell><CosmeticPage /></AppShell>} 
        />
        <Route 
          path="/achievement" 
          element={<AppShell><AchievementPage /></AppShell>} 
        />
        <Route 
          path="/profile" 
          element={<AppShell><ProfilePage /></AppShell>} 
        />
        
        {/* 시장 (탭 컨테이너) */}
        <Route path="/market" element={<Navigate to="/market/snack" replace />} />
        <Route 
          path="/market/snack" 
          element={<AppShell><MarketPage /></AppShell>} 
        />
        <Route 
          path="/market/auction" 
          element={<AppShell><MarketPage /></AppShell>} 
        />
        <Route 
          path="/market/jobs" 
          element={<AppShell><MarketPage /></AppShell>} 
        />
        <Route 
          path="/market/requests" 
          element={<AppShell><MarketPage /></AppShell>} 
        />
        
        {/* 상단 메뉴 */}
        <Route 
          path="/guild" 
          element={<AppShell><GuildPage /></AppShell>} 
        />
        <Route
          path="/guild/missions"
          element={<AppShell><GuildMissionsPage /></AppShell>}
        />
        <Route
          path="/arcade"
          element={<AppShell><ArcadePage /></AppShell>}
        />
        <Route 
          path="/friends" 
          element={<AppShell><FriendsPage /></AppShell>} 
        />
        <Route 
          path="/rankings" 
          element={<AppShell><RankingsPage /></AppShell>} 
        />
        
        {/* 유틸리티 */}
        <Route path="/mail" element={<AppShell><CommunicationPage /></AppShell>} />
        <Route path="/assignments" element={<AppShell><AssignmentsPage /></AppShell>} />
        <Route path="/records" element={<AppShell><RecordsPage /></AppShell>} />
        <Route 
          path="/settings" 
          element={<AppShell><SettingsPage /></AppShell>} 
        />
      </Route>
      
      {/* 교사 전용 라우트 */}
      <Route element={<ProtectedRoute requireTeacher><Outlet /></ProtectedRoute>}>
        <Route 
          path="/teacher" 
          element={<TeacherDashboard />} 
        />
        <Route 
          path="/teacher/review" 
          element={<ReviewQueue />} 
        />
        <Route 
          path="/teacher/control" 
          element={<ClassroomControl />} 
        />
        <Route 
          path="/teacher/auction" 
          element={<AuctionAdmin />} 
        />
        <Route
          path="/teacher/auction/screen"
          element={<AuctionBroadcastPage />}
        />
        <Route path="/teacher/guild" element={<GuildAdmin />} />
        <Route path="/teacher/guild/scores" element={<GuildScoreAdmin />} />
        <Route path="/teacher/guild/missions" element={<GuildMissionAdmin />} />
        <Route path="/teacher/arcade" element={<TeacherArcadePage />} />
        <Route path="/teacher/analytics" element={<AnalyticsPage />} />
        <Route path="/teacher/communications" element={<CommunicationAdmin />} />
        <Route path="/teacher/operations" element={<OperationsAdmin />} />
        <Route path="/teacher/learning" element={<LearningAdmin />} />
        <Route path="/teacher/records" element={<RecordsAdmin />} />
        <Route path="/teacher/test-fixture" element={<TestClassroomFixturePage />} />
      </Route>
      
      {/* 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function NotFoundPage() {
  return (
    <div className="app-container flex items-center justify-center min-h-screen">
      <div className="text-center p-8">
        <div className="text-6xl mb-4">🔍</div>
        <h1 className="font-display text-2xl mb-2 text-text-primary">
          찾을 수 없어요
        </h1>
        <p className="text-text-secondary text-sm">
          요청하신 페이지가 존재하지 않습니다
        </p>
      </div>
    </div>
  );
}
