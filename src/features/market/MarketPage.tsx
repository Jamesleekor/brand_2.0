// =====================================================================
// B.R.A.N.D 2.0 — 시장 페이지 (탭 컨테이너)
// Stage 6-C · 생성일 2026-05-20
// =====================================================================
// 옵션 A 적용: 시장에 4개 탭 — 간식·경매·2차직업·시장의뢰
// =====================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  PageHeader, LoadingSpinner, EmptyState, useRpcCall
} from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { studentRpc } from '@/lib/rpc/student_rpc';
import { useStudentId, useClassroomId } from '@/stores/auth_store';
import { useWallet } from '@/hooks/useWallet';
import { formatNumber } from '@/lib/utils/format';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { cn } from '@/lib/utils/cn';
import StudentAuctionView from '@/features/auction/StudentAuctionView';
import { useActiveEmergencies } from '@/hooks/useActiveEmergencies';

// =====================================================================
// 메인 컴포넌트 — 탭 컨테이너
// =====================================================================

type MarketTab = 'snack' | 'auction' | 'jobs' | 'requests';

const TABS: { value: MarketTab; label: string; emoji: string; path: string }[] = [
  { value: 'snack',    label: '간식',      emoji: '🍪', path: '/market/snack' },
  { value: 'auction',  label: '경매',      emoji: '🔨', path: '/market/auction' },
  { value: 'jobs',     label: '2차직업',   emoji: '💼', path: '/market/jobs' },
  { value: 'requests', label: '의뢰',      emoji: '📋', path: '/market/requests' },
];

export default function MarketPage() {
  const location = useLocation();
  const { hyperinflation, employmentFreeze } = useActiveEmergencies();
  const navigate = useNavigate();
  
  // URL로부터 현재 탭 추출
  const currentTab: MarketTab = (() => {
    if (location.pathname.endsWith('/auction'))  return 'auction';
    if (location.pathname.endsWith('/jobs'))     return 'jobs';
    if (location.pathname.endsWith('/requests')) return 'requests';
    return 'snack';
  })();
  
  return (
    <>
      <PageHeader title="시장" emoji="🏪" />
      
      {/* 탭 헤더 */}
      <div className="sticky top-[57px] z-20 bg-bg-base/95 backdrop-blur-card border-b border-line px-4 py-2">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => navigate(tab.path, { replace: true })}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2 rounded-pill text-xs font-extrabold transition-all flex-shrink-0',
                currentTab === tab.value
                  ? 'bg-gradient-to-r from-brand-primary to-gold text-white shadow-brand-sm'
                  : 'bg-bg-card border border-line text-text-secondary'
              )}
            >
              <span>{tab.emoji}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
      
      {/* 비상사태 적용 상태를 가격/고용 변화와 함께 명시 */}
      {(hyperinflation || employmentFreeze) && <div className="px-4 pt-3 space-y-2">
        {hyperinflation && <div className="bg-danger-bg border border-danger/40 rounded-card-md p-3"><div className="text-sm font-black text-danger">📈 초인플레이션 발생</div><div className="text-xs text-text-secondary mt-1">시장 가격에는 서버에서 계산된 비상사태 적용가가 표시됩니다.</div></div>}
        {employmentFreeze && <div className="bg-warning-bg border border-warning/40 rounded-card-md p-3"><div className="text-sm font-black text-warning">🚫 고용 동결 발생</div><div className="text-xs text-text-secondary mt-1">고용·직업 관련 신규 처리 기능이 제한될 수 있습니다.</div></div>}
      </div>}

      {/* 탭별 컨텐츠 */}
      <div className="px-4 pt-4">
        {currentTab === 'snack'    && <SnackMarket hyperinflation={!!hyperinflation} />}
        {currentTab === 'auction'  && <AuctionView />}
        {currentTab === 'jobs'     && <JobsDirectory />}
        {currentTab === 'requests' && <MarketRequests />}
      </div>
    </>
  );
}

// =====================================================================
// 탭 1: 간식 시장
// =====================================================================

interface Snack {
  id: number;
  name: string;
  imageUrl: string | null;
  stockTotal: number;
  stockRemaining: number;
  basePrice: number;
  currentPrice: number;  // 서버가 계산한 현재 가격
}

function SnackMarket({ hyperinflation }: { hyperinflation: boolean }) {
  const classroomId = useClassroomId();
  
  const { data: snacks, isLoading } = useQuery<Snack[]>({
    queryKey: ['snacks', classroomId],
    queryFn: async () => {
      if (!classroomId) return [];
      
      const { data, error } = await supabase
        .from('snack_items')
        .select('id, name, image_url, base_stock, current_stock, base_price, current_price')
        .eq('classroom_id', classroomId)
        .eq('is_active', true)
        .order('id', { ascending: true });
      
      if (error) throw error;
      
      // 가격은 purchase_snack RPC와 동일한 서버 계산값을 표시한다.
      return (data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        imageUrl: s.image_url,
        stockTotal: s.base_stock,
        stockRemaining: s.current_stock,
        basePrice: Number(s.base_price),
        currentPrice: Number(s.current_price),
      }));
    },
    enabled: classroomId !== null,
  });
  
  if (isLoading) {
    return <div className="py-8 flex justify-center"><LoadingSpinner size="lg" /></div>;
  }
  
  if (!snacks || snacks.length === 0) {
    return <EmptyState emoji="🍪" title="간식이 없어요" description="선생님께 문의해주세요" />;
  }
  
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {snacks.map((snack) => (
        <SnackCard key={snack.id} snack={snack} hyperinflation={hyperinflation} />
      ))}
    </div>
  );
}

function SnackCard({ snack, hyperinflation }: { snack: Snack; hyperinflation: boolean }) {
  const studentId = useStudentId();
  const { wallet } = useWallet();
  const { call, isLoading } = useRpcCall();
  
  const ratio = snack.stockTotal > 0 ? snack.stockRemaining / snack.stockTotal : 0;
  const stockColor = ratio > 0.5 ? 'text-success' : ratio > 0.2 ? 'text-warning' : 'text-danger';
  const canBuy = (wallet?.gold ?? 0) >= snack.currentPrice && snack.stockRemaining > 0;
  
  const handleBuy = async () => {
    if (!studentId || !canBuy) return;
    if (!confirm(`${snack.name}을 ${formatNumber(snack.currentPrice)}골드에 구매하시겠어요?`)) return;
    
    await call(
      () => studentRpc.purchaseSnack(supabase, {
        p_student_id: studentId,
        p_snack_id: snack.id,
        p_quantity: 1,
      }),
      {
        successTitle: `${snack.name} 구매 완료! 🍪`,
        successDescription: `-${formatNumber(snack.currentPrice)} 골드`,
      }
    );
  };
  
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      className="bg-bg-card backdrop-blur-card border border-line rounded-card-md overflow-hidden"
    >
      {/* 이미지 */}
      <div className="aspect-square bg-bg-deep relative overflow-hidden">
        {snack.imageUrl ? (
          <img
            src={resolveAssetUrl(snack.imageUrl, 'icon')}
            alt={snack.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl">🍪</div>
        )}
        
        {/* 재고 배지 */}
        <div className={cn(
          'absolute top-2 right-2 px-2 py-0.5 bg-bg-deep/90 backdrop-blur-card rounded-pill text-2xs font-black',
          stockColor
        )}>
          {snack.stockRemaining}/{snack.stockTotal}
        </div>
      </div>
      
      <div className="p-2.5">
        <h4 className="text-sm font-extrabold text-text-primary mb-1 truncate">
          {snack.name}
        </h4>
        
        {hyperinflation && <div className="text-[10px] font-black text-danger mb-1">📈 비상사태 적용가</div>}
        <div className="flex items-baseline gap-1 mb-2">
          <span className="font-display text-base text-gold">
            🪙 {formatNumber(snack.currentPrice)}
          </span>
          {snack.currentPrice > snack.basePrice && (
            <span className="text-2xs text-danger font-bold">
              ↑{Math.round((snack.currentPrice / snack.basePrice - 1) * 100)}%
            </span>
          )}
        </div>
        
        <button
          onClick={handleBuy}
          disabled={!canBuy || isLoading}
          className="w-full py-1.5 bg-gradient-to-r from-brand-primary to-gold text-white rounded-pill text-2xs font-black disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {snack.stockRemaining === 0 ? '품절' : !canBuy ? '골드 부족' : '구매'}
        </button>
      </div>
    </motion.div>
  );
}

// =====================================================================
// 탭 2: 경매 (간략 — Sub-step 6-D에서 본격 구현)
// =====================================================================

function AuctionView() {
  return <StudentAuctionView />;
}

// =====================================================================
// 탭 3: 2차직업 디렉토리
// =====================================================================

interface SecondaryJob {
  studentId: number;
  studentName: string;
  brandName: string | null;
  jobName: string;
  description: string;
  approvedAt: string;
}

function JobsDirectory() {
  const classroomId = useClassroomId();
  
  const { data: jobs, isLoading } = useQuery<SecondaryJob[]>({
    queryKey: ['secondary-jobs', classroomId],
    queryFn: async () => {
      if (!classroomId) return [];
      
      const { data } = await supabase
        .from('secondary_jobs')
        .select(`
          student_id, job_name, description, approved_at,
          student:students!student_id(name, brand_name)
        `)
        .eq('classroom_id', classroomId)
        .eq('status', 'ACTIVE')
        .order('approved_at', { ascending: false });
      
      return (data ?? []).map((j: any) => ({
        studentId: j.student_id,
        studentName: j.student?.name ?? '',
        brandName: j.student?.brand_name ?? null,
        jobName: j.job_name,
        description: j.description ?? '',
        approvedAt: j.approved_at,
      }));
    },
    enabled: classroomId !== null,
  });
  
  if (isLoading) {
    return <div className="py-8 flex justify-center"><LoadingSpinner size="lg" /></div>;
  }
  
  if (!jobs || jobs.length === 0) {
    return (
      <EmptyState
        emoji="💼"
        title="2차직업이 아직 없어요"
        description="프로필에서 새 직업을 신청할 수 있어요"
      />
    );
  }
  
  return (
    <div className="space-y-2.5">
      {jobs.map((job) => (
        <motion.div
          key={job.studentId}
          whileTap={{ scale: 0.98 }}
          className="bg-bg-card backdrop-blur-card border border-line rounded-card-md p-3.5"
        >
          <div className="flex items-start justify-between mb-2">
            <div>
              <h4 className="font-display text-base text-brand-gradient tracking-tight">
                {job.jobName}
              </h4>
              <p className="text-2xs text-text-muted font-bold mt-0.5">
                {job.brandName || job.studentName}
              </p>
            </div>
            <button className="px-3 py-1.5 bg-brand-primary/20 text-brand-glow rounded-pill text-2xs font-extrabold border border-line-brand hover:bg-brand-primary/30 transition-all">
              의뢰하기
            </button>
          </div>
          {job.description && (
            <p className="text-xs text-text-secondary leading-relaxed break-keep mt-2">
              {job.description}
            </p>
          )}
        </motion.div>
      ))}
    </div>
  );
}

// =====================================================================
// 탭 4: 시장 의뢰
// =====================================================================

function MarketRequests() {
  return (
    <EmptyState
      emoji="📋"
      title="시장 의뢰 목록"
      description="이 기능은 Sub-step 6-D에서 본격 구현됩니다"
    />
  );
}
