// =====================================================================
// B.R.A.N.D 2.0 — 교사 분석 페이지
// Stage 6-E · 생성일 2026-05-20
// =====================================================================
// 학급 경제 분석 — 지니계수 추세, 티어 분포, 거래 통계
// =====================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { LoadingSpinner } from '@/components/shared/components';
import { TeacherShell, StatCard } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { formatNumber, getKstDateString } from '@/lib/utils/format';
import { feature4QueryError } from '@/lib/feature4_debug';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { TIER_THRESHOLDS } from '@/constants/tier_thresholds';
import { cn } from '@/lib/utils/cn';

// =====================================================================
// AnalyticsPage 메인
// =====================================================================

export default function AnalyticsPage() {
  const classroomId = useClassroomId();
  const [range, setRange] = useState<'WEEK' | 'MONTH' | 'TERM'>('MONTH');
  
  return (
    <TeacherShell>
      <div className="space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-2xl text-brand-gradient tracking-tight mb-1">
              📊 학급 분석
            </h1>
            <p className="text-sm text-text-secondary font-bold">
              경제 지표 + 학생 분포
            </p>
          </div>
          
          <RangeSelector range={range} onChange={setRange} />
        </div>
        
        {/* 지니계수 추세 */}
        <GiniTrendPanel classroomId={classroomId} range={range} />
        
        {/* 티어 분포 */}
        <TierDistributionPanel classroomId={classroomId} />
        
        {/* 거래 통계 */}
        <TransactionStatsPanel classroomId={classroomId} range={range} />
      </div>
    </TeacherShell>
  );
}

function RangeSelector({ range, onChange }: { range: any; onChange: any }) {
  const options = [
    { value: 'WEEK',  label: '최근 7일' },
    { value: 'MONTH', label: '최근 30일' },
    { value: 'TERM',  label: '학기 전체' },
  ];
  
  return (
    <div className="flex gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-3 py-1.5 rounded-pill text-xs font-extrabold transition-all',
            range === opt.value
              ? 'bg-gradient-to-r from-brand-primary to-gold text-white'
              : 'bg-bg-card border border-line text-text-secondary'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// =====================================================================
// 지니계수 추세
// =====================================================================

function GiniTrendPanel({ classroomId, range }: { classroomId: number | null; range: string }) {
  const { data: trend, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['gini-trend', classroomId, range],
    queryFn: async () => {
      if (!classroomId) return [];
      
      const daysBack = range === 'WEEK' ? 7 : range === 'MONTH' ? 30 : 90;
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      
      const sinceDate = getKstDateString(since);
      const { data, error } = await supabase
        .from('daily_statistics')
        .select('stat_date, gini_gold, total_gold, active_students')
        .eq('classroom_id', classroomId)
        .gte('stat_date', sinceDate)
        .order('stat_date', { ascending: true });
      
      if (error) throw feature4QueryError('F4D', 'analytics-gini', error);
      
      return (data ?? []).map((d: any) => ({
        date: d.stat_date,
        giniIndex: Number(d.gini_gold),
        meanGold: Number(d.active_students) > 0
          ? Number(d.total_gold) / Number(d.active_students)
          : 0,
      }));
    },
    enabled: classroomId !== null,
  });
  
  const currentGini = trend?.[trend.length - 1]?.giniIndex ?? 0;
  const previousGini = trend?.[Math.max(0, trend.length - 8)]?.giniIndex ?? currentGini;
  const change = currentGini - previousGini;
  
  return (
    <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display text-base text-white tracking-tight flex items-center gap-2 mb-1">
            <span>📈</span>
            <span>자산 불평등 (지니계수)</span>
          </h3>
          <p className="text-2xs text-text-muted font-bold break-keep">
            0에 가까울수록 평등 · 1에 가까울수록 불평등
          </p>
        </div>
        
        <div className="text-right">
          <div className={cn(
            'font-display text-2xl tracking-tighter leading-none',
            currentGini < 0.3 ? 'text-success' 
            : currentGini < 0.5 ? 'text-warning' 
            : 'text-danger'
          )}>
            {currentGini.toFixed(3)}
          </div>
          <div className={cn(
            'text-2xs font-black mt-1',
            change >= 0 ? 'text-danger' : 'text-success'
          )}>
            {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(3)}
          </div>
        </div>
      </div>
      
      {isError && <Feature4ErrorPanel domain="F4D" error={error} onRetry={() => void refetch()} />}

      {/* 간단한 SVG 차트 */}
      {isLoading ? (
        <LoadingSpinner />
      ) : trend && trend.length > 0 ? (
        <GiniChart data={trend} />
      ) : (
        <p className="text-sm text-text-muted text-center py-6">데이터가 없어요</p>
      )}
    </div>
  );
}

function GiniChart({ data }: { data: any[] }) {
  const max = Math.max(...data.map((d) => d.giniIndex), 0.5);
  const min = Math.min(...data.map((d) => d.giniIndex), 0);
  const range = max - min || 0.1;
  
  const width = 600;
  const height = 120;
  const padding = 20;
  
  const points = data.map((d, i) => ({
    x: padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2),
    y: padding + (1 - (d.giniIndex - min) / range) * (height - padding * 2),
    value: d.giniIndex,
  }));
  
  const pathD = points.map((p, i) => 
    `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
  ).join(' ');
  
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32">
      {/* Y축 */}
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#2A2438" strokeWidth="1" />
      {/* X축 */}
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#2A2438" strokeWidth="1" />
      
      {/* 기준선 (0.3 = 평등 경계) */}
      <line
        x1={padding}
        y1={padding + (1 - (0.3 - min) / range) * (height - padding * 2)}
        x2={width - padding}
        y2={padding + (1 - (0.3 - min) / range) * (height - padding * 2)}
        stroke="#6BCB77"
        strokeWidth="1"
        strokeDasharray="4 4"
        opacity={0.4}
      />
      
      {/* 추세선 */}
      <motion.path
        d={pathD}
        fill="none"
        stroke="url(#giniGradient)"
        strokeWidth="2"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.5 }}
      />
      
      <defs>
        <linearGradient id="giniGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFD93D" />
          <stop offset="100%" stopColor="#FF8C42" />
        </linearGradient>
      </defs>
      
      {/* 데이터 포인트 */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="#FFD93D" />
      ))}
    </svg>
  );
}

// =====================================================================
// 티어 분포
// =====================================================================

function TierDistributionPanel({ classroomId }: { classroomId: number | null }) {
  const { data: distribution, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['tier-distribution', classroomId],
    queryFn: async () => {
      if (!classroomId) return null;
      
      const { data, error } = await supabase
        .from('students')
        .select('cached_tier')
        .eq('classroom_id', classroomId)
        .eq('role', 'STUDENT')
        .is('transferred_at', null);
      if (error) throw feature4QueryError('F4D', 'analytics-tier-distribution', error);
      
      // 티어별 카운트
      const counts: Record<string, number> = {};
      (data ?? []).forEach((s: any) => {
        const tier = s.cached_tier ?? '새싹';
        counts[tier] = (counts[tier] ?? 0) + 1;
      });
      
      return counts;
    },
    enabled: classroomId !== null,
  });
  
  return (
    <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4">
      <h3 className="font-display text-base text-white tracking-tight flex items-center gap-2 mb-4">
        <span>🏆</span>
        <span>티어 분포</span>
      </h3>
      
      {isError && <Feature4ErrorPanel domain="F4D" error={error} onRetry={() => void refetch()} />}

      {isLoading || !distribution ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-1.5">
          {TIER_THRESHOLDS.map((tier) => {
            const count = distribution[tier.tier] ?? 0;
            if (count === 0) return null;
            
            const total = Object.values(distribution).reduce((s, c) => s + c, 0);
            const percent = total > 0 ? (count / total) * 100 : 0;
            
            return (
              <div key={tier.tier} className="flex items-center gap-3">
                <div className="text-base flex-shrink-0">{tier.icon}</div>
                <div className="text-xs font-bold text-text-secondary w-24 flex-shrink-0 truncate">
                  {tier.tier}
                </div>
                <div className="flex-1 h-5 bg-bg-deep rounded-pill overflow-hidden relative">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${percent}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-gradient-to-r from-brand-primary to-gold rounded-pill"
                  />
                  <span className="absolute inset-0 flex items-center justify-end pr-2 text-2xs font-black text-white">
                    {count}명 · {percent.toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
          
          {Object.keys(distribution).length === 0 && (
            <p className="text-sm text-text-muted text-center py-4">데이터가 없어요</p>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 거래 통계
// =====================================================================

function TransactionStatsPanel({ classroomId, range }: { classroomId: number | null; range: string }) {
  const { data: stats, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['transaction-stats', classroomId, range],
    queryFn: async () => {
      if (!classroomId) return null;
      
      const daysBack = range === 'WEEK' ? 7 : range === 'MONTH' ? 30 : 90;
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      
      const { data, error } = await supabase
        .from('transactions')
        .select('source_type, value_token, amount, tax_amount')
        .eq('classroom_id', classroomId)
        .eq('is_reversed', false)
        .gte('created_at', since.toISOString());
      if (error) throw feature4QueryError('F4D', 'analytics-transactions', error);
      
      const txs = data ?? [];
      
      // 집계
      const totalTransactions = txs.length;
      const totalTax = txs.reduce((s: number, tx: any) => s + Number(tx.tax_amount), 0);
      const sourceCounts: Record<string, number> = {};
      txs.forEach((tx: any) => {
        sourceCounts[tx.source_type] = (sourceCounts[tx.source_type] ?? 0) + 1;
      });
      
      // 가장 활발한 거래 유형
      const topSources = Object.entries(sourceCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);
      
      return { totalTransactions, totalTax, topSources };
    },
    enabled: classroomId !== null,
  });
  
  if (isLoading || (!stats && !isError)) {
    return (
      <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4">
        <LoadingSpinner />
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4">
        <Feature4ErrorPanel domain="F4D" error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  
  return (
    <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4">
      <h3 className="font-display text-base text-white tracking-tight flex items-center gap-2 mb-4">
        <span>🔄</span>
        <span>거래 통계</span>
      </h3>
      
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard
          emoji="📊"
          label="총 거래"
          value={formatNumber(stats.totalTransactions)}
          color="gold"
        />
        <StatCard
          emoji="🏛️"
          label="세금 수입"
          value={formatNumber(stats.totalTax)}
          color="success"
        />
      </div>
      
      <div>
        <div className="text-2xs font-extrabold text-text-secondary uppercase tracking-widest mb-2">
          가장 활발한 거래 유형
        </div>
        <div className="space-y-1.5">
          {stats.topSources.map(([source, count]) => {
            const percent = (count / stats.totalTransactions) * 100;
            return (
              <div key={source} className="flex items-center gap-3">
                <div className="text-xs font-extrabold text-text-secondary w-28 flex-shrink-0 truncate">
                  {source}
                </div>
                <div className="flex-1 h-4 bg-bg-deep rounded-pill overflow-hidden relative">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${percent}%` }}
                    className="h-full bg-gradient-to-r from-bv to-bv-500"
                  />
                  <span className="absolute inset-0 flex items-center justify-end pr-2 text-2xs font-black text-white">
                    {count} · {percent.toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
