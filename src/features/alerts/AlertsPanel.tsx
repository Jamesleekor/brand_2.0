// =====================================================================
// B.R.A.N.D 2.0 — 알림 패널 (Global Alerts)
// Stage 6-C · 생성일 2026-05-20
// =====================================================================
// 학급 전체에 발송된 알림 표시.
// - 학생 활동 알림 (히든 업적 달성, 마스터 진입 등)
// - 시스템 알림 (비상사태 발동/해제)
// - 돌발 퀘스트 (별도 카테고리)
// - 일반 알림
// =====================================================================

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Modal, LoadingSpinner, EmptyState } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { formatRelativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

// =====================================================================
// 타입
// =====================================================================

interface GlobalAlert {
  id: number;
  category: string;
  message: string;
  emoji: string | null;
  triggeredByStudentName: string | null;
  createdAt: string;
  expiresAt: string | null;
}

// 카테고리별 시각화
const CATEGORY_CONFIG: Record<string, { label: string; color: string; bgClass: string }> = {
  HIDDEN:         { label: '히든',       color: 'text-gold',          bgClass: 'border-gold/40 bg-gold/10' },
  MILESTONE:      { label: '마일스톤',   color: 'text-success',       bgClass: 'border-success/40 bg-success-bg' },
  TIER:           { label: '티어',       color: 'text-bv',            bgClass: 'border-bv/40 bg-bv/10' },
  SET_COMPLETION: { label: '세트 완성',  color: 'text-crystal',       bgClass: 'border-crystal/40 bg-crystal/10' },
  EMERGENCY:      { label: '비상사태',   color: 'text-danger',        bgClass: 'border-danger/40 bg-danger-bg' },
  AUCTION:        { label: '경매',       color: 'text-gold',          bgClass: 'border-gold/40 bg-gold/10' },
  GENERAL:        { label: '알림',       color: 'text-text-secondary', bgClass: 'border-line bg-bg-card' },
};

// =====================================================================
// AlertsPanel 모달
// =====================================================================

interface AlertsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AlertsPanel({ isOpen, onClose }: AlertsPanelProps) {
  const classroomId = useClassroomId();
  
  const { data: alerts, isLoading } = useQuery<GlobalAlert[]>({
    queryKey: ['alerts', classroomId],
    queryFn: async () => {
      if (!classroomId) return [];
      
      const { data } = await supabase
        .from('global_alerts')
        .select(`
          id, category, message, emoji, created_at, expires_at,
          triggered_by:students!triggered_by_student_id(name, brand_name)
        `)
        .eq('classroom_id', classroomId)
        .order('created_at', { ascending: false })
        .limit(50);
      
      const now = new Date();
      
      return (data ?? [])
        .filter((a: any) => !a.expires_at || new Date(a.expires_at) > now)
        .map((a: any) => ({
          id: a.id,
          category: a.category,
          message: a.message,
          emoji: a.emoji,
          triggeredByStudentName: a.triggered_by?.brand_name || a.triggered_by?.name || null,
          createdAt: a.created_at,
          expiresAt: a.expires_at,
        }));
    },
    enabled: classroomId !== null && isOpen,
  });
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="알림" emoji="🔔" size="lg">
      {isLoading ? (
        <div className="py-8 flex justify-center"><LoadingSpinner size="lg" /></div>
      ) : !alerts || alerts.length === 0 ? (
        <EmptyState
          emoji="🔕"
          title="알림이 없어요"
          description="학급 활동이 있으면 여기 표시됩니다"
        />
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => {
            const config = CATEGORY_CONFIG[alert.category] || CATEGORY_CONFIG.GENERAL!;
            
            return (
              <motion.div
                key={alert.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'p-3.5 rounded-card-md border backdrop-blur-card',
                  config.bgClass
                )}
              >
                <div className="flex items-start gap-3">
                  {alert.emoji && (
                    <div className="text-2xl flex-shrink-0">{alert.emoji}</div>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={cn('text-2xs font-black uppercase tracking-widest', config.color)}>
                        {config.label}
                      </span>
                      <span className="text-2xs text-text-muted">·</span>
                      <span className="text-2xs text-text-muted">
                        {formatRelativeTime(alert.createdAt)}
                      </span>
                    </div>
                    
                    <p className="text-sm font-bold text-text-primary break-keep">
                      {alert.message}
                    </p>
                    
                    {alert.triggeredByStudentName && (
                      <p className="text-2xs text-text-muted mt-1">
                        — {alert.triggeredByStudentName}
                      </p>
                    )}
                    
                    {alert.expiresAt && (
                      <p className="text-2xs text-gold mt-1.5 font-bold">
                        ⏱️ {formatRelativeTime(alert.expiresAt)} 만료
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
