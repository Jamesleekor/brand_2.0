// =====================================================================
// B.R.A.N.D 2.0 — 시장 페이지
// I1-B/C: 범용 시장 + 학생 인벤토리 UI 연결
// =====================================================================

import { useLocation, useNavigate } from 'react-router-dom';

import { PageHeader } from '@/components/shared/components';
import { cn } from '@/lib/utils/cn';
import StudentAuctionView from '@/features/auction/StudentAuctionView';
import { useActiveEmergencies } from '@/hooks/useActiveEmergencies';
import SecondaryJobsPanel from '@/features/market/SecondaryJobsPanel';
import PublicJobRequestsPanel from '@/features/market/PublicJobRequestsPanel';
import SecondaryJobServicesPanel from '@/features/market/SecondaryJobServicesPanel';
import { StudentInventoryPanel, StudentMarketStorePanel } from '@/features/market/StudentInventoryMarketPanel';
import StudentItemHistoryPanel from '@/features/market/StudentItemHistoryPanel';

type MarketTab = 'store' | 'inventory' | 'history' | 'auction' | 'jobs' | 'requests' | 'services';

const TABS: { value: MarketTab; label: string; emoji: string; path: string }[] = [
  { value: 'store',     label: '상점',      emoji: '🏪', path: '/market/store' },
  { value: 'inventory', label: '내 가방',   emoji: '🎒', path: '/market/inventory' },
  { value: 'history',   label: '내역',      emoji: '📜', path: '/market/history' },
  { value: 'auction',   label: '경매',      emoji: '🔨', path: '/market/auction' },
  { value: 'jobs',      label: '2차직업',   emoji: '💼', path: '/market/jobs' },
  { value: 'requests',  label: '공공 의뢰', emoji: '📋', path: '/market/requests' },
  { value: 'services',  label: '서비스',    emoji: '🛍️', path: '/market/services' },
];

export default function MarketPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { hyperinflation, employmentFreeze } = useActiveEmergencies();

  const currentTab: MarketTab = (() => {
    if (location.pathname.endsWith('/inventory')) return 'inventory';
    if (location.pathname.endsWith('/history')) return 'history';
    if (location.pathname.endsWith('/auction')) return 'auction';
    if (location.pathname.endsWith('/jobs')) return 'jobs';
    if (location.pathname.endsWith('/requests')) return 'requests';
    if (location.pathname.endsWith('/services')) return 'services';
    return 'store';
  })();

  return (
    <>
      <PageHeader title="시장" emoji="🏪" />

      <div className="sticky top-[57px] z-20 border-b border-line bg-bg-base/95 px-4 py-2 backdrop-blur-card">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => navigate(tab.path, { replace: true })}
              className={cn(
                'flex flex-shrink-0 items-center gap-1.5 rounded-pill px-3.5 py-2 text-xs font-extrabold transition-all',
                currentTab === tab.value
                  ? 'bg-gradient-to-r from-brand-primary to-gold text-white shadow-brand-sm'
                  : 'border border-line bg-bg-card text-text-secondary',
              )}
            >
              <span>{tab.emoji}</span><span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {(hyperinflation || employmentFreeze) && (
        <div className="space-y-2 px-4 pt-3">
          {hyperinflation && (
            <div className="rounded-card-md border border-danger/40 bg-danger-bg p-3">
              <div className="text-sm font-black text-danger">📈 초인플레이션 발생</div>
              <div className="mt-1 text-xs text-text-secondary">시장 관련 경제 효과는 서버의 현재 비상사태 규칙을 기준으로 처리됩니다.</div>
            </div>
          )}
          {employmentFreeze && (
            <div className="rounded-card-md border border-warning/40 bg-warning-bg p-3">
              <div className="text-sm font-black text-warning">🚫 고용 동결 발생</div>
              <div className="mt-1 text-xs text-text-secondary">고용·직업 관련 신규 처리 기능이 제한될 수 있습니다.</div>
            </div>
          )}
        </div>
      )}

      <div className="px-4 pt-4">
        {currentTab === 'store' && <StudentMarketStorePanel />}
        {currentTab === 'inventory' && <StudentInventoryPanel />}
        {currentTab === 'history' && <StudentItemHistoryPanel />}
        {currentTab === 'auction' && <StudentAuctionView />}
        {currentTab === 'jobs' && <SecondaryJobsPanel />}
        {currentTab === 'requests' && <PublicJobRequestsPanel />}
        {currentTab === 'services' && <SecondaryJobServicesPanel />}
      </div>
    </>
  );
}
