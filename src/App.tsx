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
import AchievementHelperPage from '@/features/achievement/AchievementHelperPage';
import CosmeticPage from '@/features/cosmetic/CosmeticPage';
import CharacterCollectionPage from '@/features/character/CharacterCollectionPage';
import MarketPage from '@/features/market/MarketPage';
import BakeryPage from '@/features/bakery/BakeryPage';
import EconomyGuardPage from '@/features/guard/EconomyGuardPage';
import DailyQuestManagerPage from '@/features/daily-quest/DailyQuestManagerPage';
import SavingsBankPage from '@/features/savings/SavingsBankPage';
import GuildPage from '@/features/guild/GuildPage';
import GuildAdmin from '@/features/guild/GuildAdmin';
import GuildScoreAdmin from '@/features/guild/GuildScoreAdmin';
import GuildMissionsPage from '@/features/guild/GuildMissionsPage';
import GuildMissionAdmin from '@/features/guild/GuildMissionAdmin';
import GuildPeerReviewPage from '@/features/guild/GuildPeerReviewPage';
import GuildPeerReviewAdmin from '@/features/guild/GuildPeerReviewAdmin';
import GuildMonthlyPage from '@/features/guild/GuildMonthlyPage';
import GuildScorePage from '@/features/guild/GuildScorePage';
import GuildConquestPage from '@/features/guild/GuildConquestPage';
import GuildMonthlyAdmin from '@/features/guild/GuildMonthlyAdmin';
import ArcadePage from '@/features/arcade/ArcadePage';
import TeacherArcadePage from '@/features/arcade/TeacherArcadePage';
import { FriendsPage, RankingsPage, SettingsPage } from '@/features/social/social_pages';
import TeacherDashboard from '@/features/teacher/TeacherDashboard';
import ReviewQueue from '@/features/teacher/ReviewQueue';
import AchievementMasterAdmin from '@/features/teacher/AchievementMasterAdmin';
import AchievementStatisticsAdmin from '@/features/teacher/AchievementStatisticsAdmin';
import CharacterAdmin from '@/features/teacher/CharacterAdmin';
import MarketInventoryAdmin from '@/features/teacher/MarketInventoryAdmin';
import SecondaryJobAdmin from '@/features/teacher/SecondaryJobAdmin';
import PrimaryJobAdmin from '@/features/teacher/PrimaryJobAdmin';
import DailyQuestSettlementAdmin from '@/features/teacher/DailyQuestSettlementAdmin';
import SavingsBankAdmin from '@/features/savings/SavingsBankAdmin';
import SecondaryJobPublicRequestAdmin from '@/features/teacher/SecondaryJobPublicRequestAdmin';
import SecondaryJobServiceAdmin from '@/features/teacher/SecondaryJobServiceAdmin';
import SecondaryJobReviewAdmin from '@/features/teacher/SecondaryJobReviewAdmin';
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
import { TeacherShell } from '@/components/teacher/TeacherShell';

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
          path="/characters" 
          element={<AppShell><CharacterCollectionPage /></AppShell>} 
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
          path="/achievement/helper"
          element={<AppShell><AchievementHelperPage /></AppShell>}
        />
        <Route 
          path="/profile" 
          element={<AppShell><ProfilePage /></AppShell>} 
        />
        <Route
          path="/bank"
          element={<AppShell><SavingsBankPage /></AppShell>}
        />
        
        {/* 시장 (탭 컨테이너) */}
        <Route path="/market" element={<Navigate to="/market/store" replace />} />
        <Route path="/market/snack" element={<Navigate to="/market/store" replace />} />
        <Route path="/market/store" element={<AppShell><MarketPage /></AppShell>} />
        <Route path="/market/inventory" element={<AppShell><MarketPage /></AppShell>} />
        <Route path="/market/history" element={<AppShell><MarketPage /></AppShell>} />
        <Route path="/bakery" element={<AppShell hideBottomNav><BakeryPage /></AppShell>} />
        <Route path="/daily-quest" element={<AppShell hideBottomNav><DailyQuestManagerPage /></AppShell>} />
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
        <Route 
          path="/market/services" 
          element={<AppShell><MarketPage /></AppShell>} 
        />
        
        {/* 상단 메뉴 */}
        <Route 
          path="/guild" 
          element={<AppShell><GuildPage /></AppShell>} 
        />
        <Route
          path="/guild/conquest"
          element={<AppShell><GuildConquestPage /></AppShell>}
        />
        <Route
          path="/guild/missions"
          element={<AppShell><GuildMissionsPage /></AppShell>}
        />
        <Route
          path="/guild/scores"
          element={<AppShell><GuildScorePage /></AppShell>}
        />
        <Route
          path="/guild/peer-review"
          element={<AppShell><GuildPeerReviewPage /></AppShell>}
        />
        <Route
          path="/guild/monthly"
          element={<AppShell><GuildMonthlyPage /></AppShell>}
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
        <Route path="/guard" element={<AppShell hideBottomNav><EconomyGuardPage /></AppShell>} />
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
        <Route path="/teacher/achievements" element={<AchievementMasterAdmin />} />
        <Route path="/teacher/achievement-statistics" element={<AchievementStatisticsAdmin />} />
        <Route path="/teacher/characters" element={<CharacterAdmin />} />
        <Route path="/teacher/market" element={<MarketInventoryAdmin />} />
        <Route path="/teacher/bank" element={<SavingsBankAdmin />} />
        <Route path="/teacher/primary-jobs" element={<PrimaryJobAdmin />} />
        <Route path="/teacher/daily-quests" element={<DailyQuestSettlementAdmin />} />
        <Route path="/teacher/secondary-jobs" element={<SecondaryJobAdmin />} />
        <Route path="/teacher/secondary-jobs/public-requests" element={<SecondaryJobPublicRequestAdmin />} />
        <Route path="/teacher/secondary-jobs/services" element={<SecondaryJobServiceAdmin />} />
        <Route path="/teacher/secondary-jobs/reviews" element={<SecondaryJobReviewAdmin />} />
        <Route 
          path="/teacher/control" 
          element={<ClassroomControl />} 
        />
        <Route path="/teacher/control/history" element={<ClassroomControl />} />
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
        <Route path="/teacher/guild/peer-review" element={<GuildPeerReviewAdmin />} />
        <Route path="/teacher/guild/monthly-close" element={<GuildMonthlyAdmin />} />
        <Route path="/teacher/arcade" element={<TeacherArcadePage />} />
        <Route path="/teacher/analytics" element={<AnalyticsPage />} />
        <Route path="/teacher/economy-guard" element={<TeacherShell><EconomyGuardPage embeddedTeacher /></TeacherShell>} />
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
