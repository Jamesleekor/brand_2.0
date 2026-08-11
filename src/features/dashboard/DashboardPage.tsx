// =====================================================================
// B.R.A.N.D 2.0 — 메인 대시보드 페이지
// Stage 6-B · 생성일 2026-05-20
// =====================================================================
// v4 디자인 그대로 React로 구현.
// 모든 컴포넌트 통합 + 데이터 흐름 연결.
// =====================================================================

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useCurrentStudent, useStudentId, useClassroomId } from '@/stores/auth_store';
import { useWallet } from '@/hooks/useWallet';

import { TopHeader } from '@/components/layout/TopHeader';
import { UtilityRow, TopMenuRow, BottomNav } from '@/components/layout/Navigation';
import {
  EmergencyQuestBanner,
  EmergencyStatusBanner,
  BackgroundSkin,
  TierCard,
  AchievementCard,
  CreditCard,
  AssignmentNoticeBanner,
} from '@/features/dashboard/components';

import { calculateTierFromBv, getNextTier } from '@/constants/tier_thresholds';
import { AttendanceModal } from '@/features/attendance/AttendanceModal';
import { feature4Rpc } from '@/lib/rpc/feature4_rpc';
import { useRpcCall } from '@/components/shared/components';
import { useNavigate } from 'react-router-dom';
import { useActiveEmergencies } from '@/hooks/useActiveEmergencies';

// =====================================================================
// 메인 컴포넌트
// =====================================================================

export default function DashboardPage() {
  const student = useCurrentStudent();
  const studentId = useStudentId();
  const classroomId = useClassroomId();
  const { wallet, isLoading: walletLoading } = useWallet();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { call: callFeature4 } = useRpcCall();
  const { emergencies } = useActiveEmergencies();
  const liveTier = calculateTierFromBv(wallet?.bv ?? 0);
  const liveNextTier = getNextTier(liveTier);
  
  // 모달 상태
  const [attendanceOpen, setAttendanceOpen] = useState(false);

  // Feature4B 안전망: pg_cron이 지연/비활성 상태여도 학급 화면 진입 시
  // 이미 종료 시각이 지난 비상사태만 멱등적으로 정리한다.
  useEffect(() => {
    if (!classroomId) return;
    let cancelled = false;
    void feature4Rpc.finalizeExpiredEmergencies(supabase, { p_classroom_id: classroomId }).then((result) => {
      if (!cancelled && result.success && result.data > 0) {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }
    });
    return () => { cancelled = true; };
  }, [classroomId, queryClient]);

  // Feature 4.1.1: 홈 Realtime은 테이블별 채널을 분리한다.
  // 선택 기능의 테이블 하나가 아직 migration/schema-cache에 없어도
  // 우편·돌발퀘스트 등 다른 실시간 갱신이 함께 죽지 않도록 하는 안정화 조치다.
  useEffect(() => {
    if (!studentId || !classroomId) return;
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard', studentId, classroomId] });
    };

    const channels = [
      supabase.channel(`dashboard:mail:${studentId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'mail_messages', filter: `recipient_id=eq.${studentId}` }, invalidate)
        .subscribe(),
      supabase.channel(`dashboard:alerts:${studentId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'global_alerts', filter: `classroom_id=eq.${classroomId}` }, invalidate)
        .subscribe(),
      supabase.channel(`dashboard:alert-reads:${studentId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'global_alert_reads', filter: `student_id=eq.${studentId}` }, invalidate)
        .subscribe(),
      supabase.channel(`dashboard:quests:${studentId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_quests', filter: `classroom_id=eq.${classroomId}` }, invalidate)
        .subscribe(),
      supabase.channel(`dashboard:quest-completions:${studentId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_quest_completions', filter: `student_id=eq.${studentId}` }, invalidate)
        .subscribe(),
      supabase.channel(`dashboard:assignments:${studentId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments', filter: `classroom_id=eq.${classroomId}` }, invalidate)
        .subscribe(),
      // 4.1 migration이 아직 적용되지 않은 DB에서는 이 채널만 실패할 수 있다.
      // 핵심 알림 채널과 분리했기 때문에 우편/퀘스트 실시간 갱신은 계속 동작한다.
      supabase.channel(`dashboard:quest-requests:${studentId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_quest_requests', filter: `student_id=eq.${studentId}` }, invalidate)
        .subscribe(),
    ];

    return () => {
      channels.forEach((channel) => { void supabase.removeChannel(channel); });
    };
  }, [studentId, classroomId, queryClient]);
  
  // 부가 데이터 조회 (병렬)
  const { data: dashboardData } = useDashboardData(studentId, classroomId);
  
  if (!student) return null;
  
  return (
    <div className="app-container relative pb-24">
      {/* 배경 일러스트 스킨 */}
      <BackgroundSkin imageUrl={dashboardData?.equippedBackground ?? null} />
      
      {/* 상단 헤더 — 정체성 + 재화 */}
      <TopHeader bvMonthlyDelta={dashboardData?.bvMonthlyDelta ?? 0} />
      
      {/* 유틸리티 row — 출석·우편·알림·설정 (우측 정렬) */}
      <UtilityRow
        onAttendanceClick={() => setAttendanceOpen(true)}
        onMailClick={() => navigate('/mail?tab=mail')}
        onAlertsClick={() => navigate('/mail?tab=alerts')}
        attendanceUnclaimed={dashboardData?.attendanceUnclaimed ?? false}
        mailUnreadCount={dashboardData?.mailUnreadCount ?? 0}
        alertsUnreadCount={dashboardData?.alertsUnreadCount ?? 0}
      />
      
      {/* 메뉴 row — 친구·길드·시장·랭킹 (아래줄, 우측 정렬) */}
      <TopMenuRow guildAlertCount={dashboardData?.guildAlertCount ?? 0} />
      
      {/* 상단 메뉴와 카드가 해상도에 따라 겹치지 않도록 카드 레일을 absolute가 아닌 레이아웃 흐름에 둔다. */}
      <div className="relative z-10 lg:grid lg:grid-cols-[minmax(0,1fr)_164px] lg:gap-4 lg:items-start">
        <div className="min-w-0">
          {/* 비상사태는 시스템 오류가 아니라 세계 안의 사건으로 명시적으로 표시 */}
          <EmergencyStatusBanner emergencies={emergencies} />

          {/* 돌발 퀘스트 배너 */}
          <EmergencyQuestBanner
            quest={dashboardData?.emergencyQuest ?? null}
            onClick={dashboardData?.emergencyQuest && studentId ? () => {
              if (dashboardData.emergencyQuest?.requestStatus === 'PENDING') {
                alert('완료 요청을 이미 보냈습니다. 선생님의 승인을 기다려주세요.');
                return;
              }
              if (!confirm(`돌발 퀘스트 "${dashboardData.emergencyQuest!.title}"를 수행했나요? 완료 요청을 선생님께 보낼까요?`)) return;
              void callFeature4(
                () => feature4Rpc.requestEmergencyQuestCompletion(supabase, { p_student_id: studentId, p_quest_id: dashboardData.emergencyQuest!.id }),
                { successTitle: '완료 요청을 보냈어요', successDescription: '선생님이 확인·승인하면 보상이 지급됩니다.', onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
                }}
              );
            } : undefined}
          />

          <AssignmentNoticeBanner
            count={dashboardData?.assignmentNoticeCount ?? 0}
            onClick={() => navigate('/assignments')}
          />

          {/* 중앙 무대 — 배경 일러스트만 보이는 공간 + 추후 수집 캐릭터 스티커 영역 */}
          <CenterStage />
        </div>

        {/* 우측 카드 레일은 메뉴 row 아래의 별도 grid column이므로 어떤 해상도에서도 메뉴와 겹치지 않는다. */}
        <aside className="hidden lg:flex pr-4 pt-3 w-[180px] flex-col gap-2.5">
          <TierCard
            tier={liveTier}
            currentBv={wallet?.bv ?? 0}
            nextBv={liveNextTier?.bvFrom ?? (wallet?.bv ?? 0)}
          />
          <AchievementCard
            earned={dashboardData?.achievementsEarned ?? 0}
            total={dashboardData?.achievementsTotal ?? 119}
            epicCount={dashboardData?.epicCount ?? 0}
            hiddenCount={dashboardData?.hiddenCount ?? 0}
          />
          <CreditCard
            grade={dashboardData?.creditGrade ?? 'B'}
            score={dashboardData?.creditScore ?? 500}
          />
        </aside>
      </div>

      <div className="relative z-10 mx-4 mt-2 grid grid-cols-3 gap-2 lg:hidden">
        <TierCard tier={liveTier} currentBv={wallet?.bv ?? 0} nextBv={liveNextTier?.bvFrom ?? (wallet?.bv ?? 0)} />
        <AchievementCard earned={dashboardData?.achievementsEarned ?? 0} total={dashboardData?.achievementsTotal ?? 119} epicCount={dashboardData?.epicCount ?? 0} hiddenCount={dashboardData?.hiddenCount ?? 0} />
        <CreditCard grade={dashboardData?.creditGrade ?? 'B'} score={dashboardData?.creditScore ?? 500} />
      </div>
      
      {/* 하단 네비게이션 */}
      <BottomNav />
      
      {/* 출석은 기존 모달 유지, 우편·알림은 Feature4A 통합 페이지로 이동 */}
      <AttendanceModal isOpen={attendanceOpen} onClose={() => setAttendanceOpen(false)} />
    </div>
  );
}

// =====================================================================
// 중앙 무대 — 배경 일러스트만 보이는 공간
// (추후 수집 캐릭터 스티커가 들어갈 자리)
// =====================================================================

function CenterStage() {
  return (
    <div className="relative z-[5] h-[280px] mt-4">
      {/* 추후 학생이 배치한 수집 캐릭터 스티커가 표시될 영역 */}
    </div>
  );
}

// =====================================================================
// 대시보드 부가 데이터 조회
// =====================================================================

interface DashboardData {
  // 배경
  equippedBackground: string | null;
  
  // 알림 카운트
  attendanceUnclaimed: boolean;
  mailUnreadCount: number;
  alertsUnreadCount: number;
  guildAlertCount: number;
  
  // 돌발 퀘스트
  emergencyQuest: { id: number; title: string; expiresAt: string; requestStatus?: 'PENDING'|'APPROVED'|'REJECTED'|null } | null;
  
  // 우측 카드
  achievementsEarned: number;
  achievementsTotal: number;
  epicCount: number;
  hiddenCount: number;
  creditGrade: 'S' | 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';
  creditScore: number;
  nextTierBv: number;
  
  // BV
  bvMonthlyDelta: number;

  // 과제 알림
  assignmentNoticeCount: number;
}

function useDashboardData(
  studentId: number | null,
  classroomId: number | null
) {
  return useQuery<DashboardData>({
    queryKey: ['dashboard', studentId, classroomId],
    queryFn: async () => {
      if (!studentId || !classroomId) {
        throw new Error('학생 정보 없음');
      }
      
      // 병렬 조회 (성능 최적화)
      const [
        mailRes,
        alertsRes,
        achievementsRes,
        creditRes,
        emergencyQuestRes,
        bvMonthlyRes,
        assignmentNoticeRes,
      ] = await Promise.all([
        // 1. 미읽 메일 카운트
        supabase
          .from('mail_messages')
          .select('id', { count: 'exact', head: true })
          .eq('recipient_id', studentId)
          .eq('is_read', false),
        
        // 2. Feature4A — 활성 알림 + 본인 읽음 기록을 함께 조회해 실제 미읽음 수 계산
        Promise.all([
          supabase
            .from('global_alerts')
            .select('id, expires_at, status')
            .eq('classroom_id', classroomId)
            .eq('status', 'ACTIVE'),
          supabase
            .from('global_alert_reads')
            .select('alert_id')
            .eq('student_id', studentId),
        ]),
        
        // 3. 업적 통계
        supabase
          .from('student_achievements')
          .select('achievement_id, achievements!inner(grade, is_hidden)')
          .eq('student_id', studentId)
          .eq('is_revoked', false),
        
        // 4. 최신 신용점수
        supabase
          .from('credit_scores')
          .select('grade, total_score')
          .eq('student_id', studentId)
          .order('calculated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        
        // 5. Feature4B — 미완료 활성 돌발 퀘스트
        Promise.all([
          supabase
            .from('emergency_quests')
            .select('id, title, expires_at')
            .eq('classroom_id', classroomId)
            .eq('status', 'ACTIVE')
            .lte('starts_at', new Date().toISOString())
            .gt('expires_at', new Date().toISOString())
            .order('expires_at', { ascending: true })
            .limit(20),
          supabase
            .from('emergency_quest_requests')
            .select('quest_id,status')
            .eq('student_id', studentId),
          supabase
            .from('emergency_quest_completions')
            .select('quest_id')
            .eq('student_id', studentId),
        ]),
        
        // 6. BV 이번 달 증가량 — transactions 합계
        supabase
          .from('transactions')
          .select('amount')
          .eq('student_id', studentId)
          .eq('value_token', 'BV')
          .eq('is_reversed', false)
          .gte('created_at', getMonthStartIso()),

        // 7. 공개 과제 중 아직 제출하지 않은 과제 수
        Promise.all([
          supabase
            .from('assignments')
            .select('id')
            .eq('classroom_id', classroomId)
            .eq('status', 'PUBLISHED'),
          supabase
            .from('assignment_submissions')
            .select('assignment_id,status')
            .eq('student_id', studentId),
        ]),
      ]);
      
      // 업적 통계 집계
      const achievements = achievementsRes.data ?? [];
      const epicCount = achievements.filter((a: any) =>
        a.achievements?.grade === '에픽' || a.achievements?.grade === '초월'
      ).length;
      const hiddenCount = achievements.filter((a: any) =>
        a.achievements?.is_hidden === true
      ).length;
      
      // 업적 총 개수 (학급 전용 + 전역)
      const { count: totalAchievements } = await supabase
        .from('achievements')
        .select('*', { count: 'exact', head: true })
        .or(`classroom_id.eq.${classroomId},classroom_id.is.null`)
        .eq('is_active', true);
      
      // Feature4B: 이미 완료한 돌발 퀘스트는 배너에서 제외
      const [questListRes, questRequestRes, questCompletionRes] = emergencyQuestRes as any;
      const completedQuestIds = new Set((questCompletionRes?.data ?? []).map((r: any) => r.quest_id));
      const safeQuestRequestRows = questRequestRes?.error ? [] : (questRequestRes?.data ?? []);
      const requestByQuest = new Map<number, 'PENDING' | 'APPROVED' | 'REJECTED'>(
        safeQuestRequestRows.map((r: any) => [
          Number(r.quest_id),
          r.status as 'PENDING' | 'APPROVED' | 'REJECTED',
        ])
      );
      const activeEmergencyQuest = (questListRes?.data ?? []).find((q: any) => !completedQuestIds.has(q.id)) ?? null;

      // Feature4A 실제 미읽음 알림 수
      const [activeAlertsRes, alertReadsRes] = alertsRes as any;
      const readAlertIds = new Set((alertReadsRes?.data ?? []).map((r: any) => r.alert_id));
      const nowMs = Date.now();
      const alertsUnreadCount = (activeAlertsRes?.data ?? []).filter((a: any) =>
        (!a.expires_at || new Date(a.expires_at).getTime() > nowMs) && !readAlertIds.has(a.id)
      ).length;

      const [assignmentListRes, submissionListRes] = assignmentNoticeRes as any;
      const submittedAssignmentIds = new Set((submissionListRes?.data ?? []).filter((x: any) => x.status !== 'RETURNED').map((x: any) => x.assignment_id));
      const assignmentNoticeCount = (assignmentListRes?.data ?? []).filter((x: any) => !submittedAssignmentIds.has(x.id)).length;

      // BV 이번 달 증가량 (음수도 합산 — net change)
      const bvDelta = (bvMonthlyRes.data ?? []).reduce(
        (sum, tx) => sum + Number(tx.amount),
        0
      );
      
      // 다음 티어 BV 임계값 (Stage 4의 calculate_tier_from_bv 역산)
      // TODO Sub-step 6-D: PostgreSQL 함수로 정확한 계산
      const nextTierBv = 1700;  // 임시
      
      return {
        equippedBackground: null,  // TODO: cosmetic 조회
        attendanceUnclaimed: false,  // TODO: 우편함에 출석 보상 있는지
        mailUnreadCount: mailRes.count ?? 0,
        alertsUnreadCount,
        guildAlertCount: 0,  // TODO: 길드 알림
        emergencyQuest: activeEmergencyQuest
          ? { id: activeEmergencyQuest.id, title: activeEmergencyQuest.title, expiresAt: activeEmergencyQuest.expires_at, requestStatus: requestByQuest.get(activeEmergencyQuest.id) ?? null }
          : null,
        achievementsEarned: achievements.length,
        achievementsTotal: totalAchievements ?? 119,
        epicCount,
        hiddenCount,
        creditGrade: (creditRes.data?.grade ?? 'B') as any,
        creditScore: creditRes.data?.total_score ?? 500,
        nextTierBv,
        bvMonthlyDelta: bvDelta,
        assignmentNoticeCount,
      };
    },
    enabled: studentId !== null && classroomId !== null,
    staleTime: 1000 * 60 * 2,  // 2분 캐시
  });
}

// 이번 달 시작 ISO
function getMonthStartIso(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return start.toISOString();
}

// =====================================================================
// Placeholder 모달 (다음 sub-step에서 실제 구현)
// =====================================================================

function PlaceholderModal({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="glass-card max-w-sm w-full p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-4xl mb-3">🚧</div>
        <h2 className="font-display text-xl text-brand-gradient mb-2">{title}</h2>
        <p className="text-text-secondary text-sm mb-4 break-keep">
          이 모달은 다음 Sub-step에서 구현됩니다
        </p>
        <button
          onClick={onClose}
          className="px-6 py-2.5 bg-gradient-to-r from-brand-primary to-gold text-white rounded-pill font-extrabold text-sm shadow-brand-md"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
