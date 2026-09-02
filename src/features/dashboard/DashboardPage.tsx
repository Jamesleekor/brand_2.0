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
  PrimaryJobCard,
  AssignmentNoticeBanner,
} from '@/features/dashboard/components';

import { calculateTierFromBv, getNextTier } from '@/constants/tier_thresholds';
import { AttendanceModal } from '@/features/attendance/AttendanceModal';
import { feature4Rpc } from '@/lib/rpc/feature4_rpc';
import { useRpcCall } from '@/components/shared/components';
import { useNavigate } from 'react-router-dom';
import { useActiveEmergencies } from '@/hooks/useActiveEmergencies';
import { useToastStore } from '@/stores/ui_store';
import { achievementA1Rpc } from '@/lib/rpc/achievement_a1_rpc';
import { dailyQuestS3Rpc } from '@/lib/rpc/daily_quest_s3_rpc';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { HomeCustomizationPanel } from '@/features/dashboard/HomeCustomizationPanel';
import { homePersonalizationRpc, type HomePersonalization, type HomeShowcaseSlot } from '@/lib/rpc/home_personalization_rpc';
import { getEquippedCharacterImageUrl, useMyEquippedCharacter } from '@/hooks/useEquippedCharacters';
import { BrandWorldPanel, BrandWorldSummaryButton } from '@/features/dashboard/BrandWorldPanel';
import { HomeServiceAdStrip } from '@/features/dashboard/HomeServiceAdStrip';

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
  const showToast = useToastStore(s=>s.show);
  const liveTier = calculateTierFromBv(wallet?.bv ?? 0);
  const liveNextTier = getNextTier(liveTier);
  const equippedCharacterQuery = useMyEquippedCharacter();
  const worldMarkerAvatarUrl = getEquippedCharacterImageUrl(equippedCharacterQuery.character, 'avatar');
  const dailyQuestAccessQuery = useQuery({
    queryKey: ['daily-quest-s3-home-access', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const result = await dailyQuestS3Rpc.getManagerAccess(supabase);
      if (!result.success) return null;
      return result.data;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  
  // 모달 상태
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [homeCustomizeOpen, setHomeCustomizeOpen] = useState(false);
  const [homeCustomizeSlot, setHomeCustomizeSlot] = useState<1 | 2 | 3>(1);
  const [brandWorldOpen, setBrandWorldOpen] = useState(false);

  const openHomeCustomize = (slotNo: 1 | 2 | 3 = 1) => {
    setHomeCustomizeSlot(slotNo);
    setHomeCustomizeOpen(true);
  };

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
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'global_alerts', filter: `classroom_id=eq.${classroomId}` }, (payload) => {
          invalidate();
          const alert = payload.new as { message?: string; emoji?: string | null };
          const message = String(alert.message ?? '').trim();
          if (message.includes('새 길드 미션')) {
            void queryClient.invalidateQueries({ queryKey: ['guild3-student-board'] });
            showToast({ title: '🗺️ 새 길드 미션이 공개됐어요', description: message, variant: 'info', duration: 7000 });
          } else if (message) {
            showToast({ title: `${alert.emoji ?? '🔔'} 새 알림`, description: message, variant: 'info', duration: 5000 });
          }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'global_alerts', filter: `classroom_id=eq.${classroomId}` }, invalidate)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'global_alerts', filter: `classroom_id=eq.${classroomId}` }, invalidate)
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
      supabase.channel(`dashboard:achievement-applications:${studentId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'achievement_applications', filter: `student_id=eq.${studentId}` }, invalidate)
        .subscribe(),
      supabase.channel(`dashboard:student-achievements:${studentId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'student_achievements', filter: `student_id=eq.${studentId}` }, invalidate)
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
  }, [studentId, classroomId, queryClient, showToast]);

  // Home personalization realtime은 dashboard core와 독립 채널로 유지한다.
  // 선택 기능 실패가 우편/알림/퀘스트 realtime에 전파되지 않도록 분리한다.
  useEffect(() => {
    if (!studentId) return;
    const invalidateHome = () => {
      void queryClient.invalidateQueries({ queryKey: ['home-customization'] });
    };

    const channels = [
      supabase.channel(`home-customization:showcase:${studentId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'student_home_showcase_slots', filter: `student_id=eq.${studentId}` }, invalidateHome)
        .subscribe(),
      supabase.channel(`home-customization:cosmetics:${studentId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'student_cosmetic_ownerships', filter: `student_id=eq.${studentId}` }, invalidateHome)
        .subscribe(),
    ];

    return () => {
      channels.forEach((channel) => { void supabase.removeChannel(channel); });
    };
  }, [studentId, queryClient]);
  
  // 부가 데이터 조회 (병렬)
  const { data: dashboardData } = useDashboardData(studentId, classroomId);
  const homeCustomizationQuery = useHomePersonalization(studentId);
  
  if (!student) return null;
  
  return (
    <div className="relative min-h-screen">
      {/* 배경 일러스트 스킨 — dashboard core query와 분리된 Home personalization contract */}
      <BackgroundSkin imageUrl={homeCustomizationQuery.data?.background?.resource_url ?? null} />
      
      {/* 상단 헤더 — 정체성 + 재화 */}
      <TopHeader bvMonthlyDelta={dashboardData?.bvMonthlyDelta ?? 0} />
      
      {/* 유틸리티 row — 출석·우편·알림·설정 (우측 정렬) */}
      <UtilityRow
        onAttendanceClick={() => setAttendanceOpen(true)}
        onMailClick={() => navigate('/mail?tab=mail')}
        onAlertsClick={() => navigate('/mail?tab=alerts')}
        onHomeCustomizeClick={() => openHomeCustomize(1)}
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

          {dailyQuestAccessQuery.data?.is_manager && (
            <button
              type="button"
              onClick={() => navigate('/daily-quest')}
              className="mx-4 mt-2 flex w-[calc(100%-32px)] items-center justify-between gap-3 rounded-card-lg border border-gold/30 bg-gradient-to-r from-gold/10 to-brand-primary/10 px-4 py-3 text-left hover-lift"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-card-md bg-gold/15 text-xl">📋</div>
                <div className="min-w-0">
                  <div className="text-sm font-black text-white">일일퀘스트 관리자 업무</div>
                  <div className="mt-0.5 truncate text-2xs font-bold text-text-secondary">오늘 체크리스트를 기록하고 선생님께 제출하세요.</div>
                </div>
              </div>
              <span className="flex-none text-sm font-black text-gold">열기 →</span>
            </button>
          )}

          {/* H3 학생 P2P 서비스 광고 — 시스템/업무 배너 뒤, 개인화 Stage 앞 */}
          <HomeServiceAdStrip />

          {/* Home Personalization Stage — fixed 3-slot 편린 전시 */}
          <CenterStage
            slots={homeCustomizationQuery.data?.showcase_slots ?? []}
            isLoading={homeCustomizationQuery.isLoading}
            isError={homeCustomizationQuery.isError}
            onRetry={() => { void homeCustomizationQuery.refetch(); }}
            onCustomize={openHomeCustomize}
          />

          <BrandWorldSummaryButton
            tier={liveTier}
            currentBv={wallet?.bv ?? 0}
            nextTier={liveNextTier}
            isOpen={brandWorldOpen}
            onToggle={() => setBrandWorldOpen((open) => !open)}
          />

          <BrandWorldPanel
            isOpen={brandWorldOpen}
            onClose={() => setBrandWorldOpen(false)}
            tier={liveTier}
            currentBv={wallet?.bv ?? 0}
            nextTier={liveNextTier}
            achievementsEarned={dashboardData?.achievementsEarned ?? 0}
            achievementsTotal={dashboardData?.achievementsTotal ?? 0}
            studentName={student.studentName}
            brandName={student.brandName}
            markerAvatarUrl={worldMarkerAvatarUrl}
            markerEmoji={equippedCharacterQuery.character?.resourceKind === 'EMOJI' ? equippedCharacterQuery.character.emoji : null}
          />

          <FutureHomeShortcuts />
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
            total={dashboardData?.achievementsTotal ?? 0}
            epicCount={dashboardData?.epicCount ?? 0}
            hiddenCount={dashboardData?.hiddenCount ?? 0}
          />
          <CreditCard
            grade={dashboardData?.creditGrade ?? 'B'}
            score={dashboardData?.creditScore ?? 500}
          />
          <PrimaryJobCard
            jobName={dailyQuestAccessQuery.data?.job_name ?? null}
            dailyWage={dailyQuestAccessQuery.data?.daily_wage ?? null}
          />
        </aside>
      </div>

      <div className="relative z-10 mx-4 mt-2 grid grid-cols-2 gap-2 lg:hidden">
        <TierCard tier={liveTier} currentBv={wallet?.bv ?? 0} nextBv={liveNextTier?.bvFrom ?? (wallet?.bv ?? 0)} />
        <AchievementCard earned={dashboardData?.achievementsEarned ?? 0} total={dashboardData?.achievementsTotal ?? 0} epicCount={dashboardData?.epicCount ?? 0} hiddenCount={dashboardData?.hiddenCount ?? 0} />
        <CreditCard grade={dashboardData?.creditGrade ?? 'B'} score={dashboardData?.creditScore ?? 500} />
        <PrimaryJobCard jobName={dailyQuestAccessQuery.data?.job_name ?? null} dailyWage={dailyQuestAccessQuery.data?.daily_wage ?? null} />
      </div>
      
      {/* 하단 네비게이션 */}
      <BottomNav />
      
      {/* 출석은 기존 모달 유지, 우편·알림은 Feature4A 통합 페이지로 이동 */}
      <AttendanceModal isOpen={attendanceOpen} onClose={() => setAttendanceOpen(false)} />
      {studentId && (
        <HomeCustomizationPanel
          isOpen={homeCustomizeOpen}
          onClose={() => setHomeCustomizeOpen(false)}
          studentId={studentId}
          personalization={homeCustomizationQuery.data}
          initialSection="showcase"
          initialSlot={homeCustomizeSlot}
        />
      )}
    </div>
  );
}

// =====================================================================
// Future Home Shortcuts — H2.3 locked disabled state
// =====================================================================

function FutureHomeShortcuts() {
  const shortcuts = [
    { emoji: '🔮', label: '차원관문' },
    { emoji: '🌌', label: '성좌맵' },
  ] as const;

  return (
    <div
      aria-label="향후 홈 기능"
      className="relative z-10 mx-4 mb-1 grid grid-cols-2 gap-2 lg:mx-0"
    >
      {shortcuts.map((shortcut) => (
        <button
          key={shortcut.label}
          type="button"
          disabled
          aria-disabled="true"
          className="flex h-9 cursor-not-allowed items-center justify-center gap-1.5 rounded-pill border border-line bg-bg-card/65 px-3 text-2xs font-black text-text-muted backdrop-blur-card"
        >
          <span aria-hidden="true">{shortcut.emoji}</span>
          <span>{shortcut.label}</span>
          <span className="text-[9px] font-extrabold tracking-wide text-text-muted/80">COMING SOON</span>
        </button>
      ))}
    </div>
  );
}

// =====================================================================
// Home Personalization Stage — fixed 3-slot Fragment Showcase Lite
// =====================================================================

function CenterStage({
  slots,
  isLoading,
  isError,
  onRetry,
  onCustomize,
}: {
  slots: HomeShowcaseSlot[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onCustomize: (slotNo: 1 | 2 | 3) => void;
}) {
  const slotMap = new Map(slots.map((slot) => [slot.slot_no, slot]));
  const hasCharacter = slots.some((slot) => slot.character_id != null);

  return (
    <section
      aria-label="홈 편린 전시"
      className="relative z-[5] mt-3 h-[clamp(260px,64vw,330px)] overflow-hidden lg:mt-2 lg:h-[330px]"
    >
      <div className="pointer-events-none absolute left-4 top-3 z-10">
        <div className="text-[9px] font-black tracking-[0.18em] text-white/35">FRAGMENT SHOWCASE</div>
        <div className="mt-0.5 text-xs font-black text-white/70">편린 3슬롯 전시</div>
      </div>

      <div className="pointer-events-none absolute inset-x-[7%] bottom-1 h-20 rounded-[50%] bg-gradient-to-r from-transparent via-brand-primary/10 to-transparent blur-2xl" />
      <div className="pointer-events-none absolute inset-x-[9%] bottom-5 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-pill border border-line bg-bg-card/75 px-4 py-2 text-xs font-bold text-text-secondary backdrop-blur-card">
            편린 전시를 불러오는 중...
          </div>
        </div>
      )}

      {!isLoading && isError && (
        <div className="absolute inset-0 flex items-center justify-center px-4">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-card-md border border-line bg-bg-card/85 px-4 py-3 text-xs font-black text-white backdrop-blur-card"
          >
            ⚠️ 홈 전시를 불러오지 못했어요 · 다시 시도
          </button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <ShowcaseSlot slot={slotMap.get(2)} slotNo={2} position="left" onCustomize={onCustomize} />
          <ShowcaseSlot slot={slotMap.get(3)} slotNo={3} position="right" onCustomize={onCustomize} />
          <ShowcaseSlot slot={slotMap.get(1)} slotNo={1} position="primary" onCustomize={onCustomize} />

          {!hasCharacter && (
            <button
              type="button"
              onClick={() => onCustomize(1)}
              className="absolute bottom-7 left-1/2 z-[6] -translate-x-1/2 rounded-pill border border-white/10 bg-black/30 px-3 py-1.5 text-[10px] font-black text-white/60 backdrop-blur-sm transition hover:border-brand-primary/40 hover:text-white"
            >
              🎨 홈 꾸미기에서 편린을 배치하세요
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ShowcaseSlot({
  slot,
  slotNo,
  position,
  onCustomize,
}: {
  slot: HomeShowcaseSlot | undefined;
  slotNo: 1 | 2 | 3;
  position: 'primary' | 'left' | 'right';
  onCustomize: (slotNo: 1 | 2 | 3) => void;
}) {
  if (!slot?.character_id) {
    return <EmptyShowcaseSlot slotNo={slotNo} position={position} onCustomize={onCustomize} />;
  }
  return <ShowcaseCharacter slot={slot} slotNo={slotNo} position={position} onCustomize={onCustomize} />;
}

function EmptyShowcaseSlot({
  slotNo,
  position,
  onCustomize,
}: {
  slotNo: 1 | 2 | 3;
  position: 'primary' | 'left' | 'right';
  onCustomize: (slotNo: 1 | 2 | 3) => void;
}) {
  const positionClass = {
    primary: 'left-1/2 bottom-[19%] z-[3] -translate-x-1/2',
    left: 'left-[19%] bottom-[15%] z-[2] -translate-x-1/2',
    right: 'right-[19%] bottom-[15%] z-[2] translate-x-1/2',
  }[position];
  const sizeClass = position === 'primary' ? 'h-24 w-24 lg:h-28 lg:w-28' : 'h-[72px] w-[72px] lg:h-20 lg:w-20';

  return (
    <button
      type="button"
      onClick={() => onCustomize(slotNo)}
      className={`absolute flex flex-col items-center gap-2 ${positionClass}`}
      aria-label={`편린 슬롯 ${slotNo} 배치하기`}
    >
      <div className={`flex ${sizeClass} items-center justify-center rounded-full border border-dashed border-white/20 bg-white/[0.035] text-2xl font-light text-white/30 backdrop-blur-sm transition hover:border-brand-primary/55 hover:bg-brand-primary/10 hover:text-white/70`}>
        +
      </div>
      <span className="rounded-pill border border-white/10 bg-black/25 px-2 py-1 text-[9px] font-black tracking-[0.12em] text-white/35 backdrop-blur-sm">
        SLOT {slotNo}
      </span>
    </button>
  );
}

function ShowcaseCharacter({
  slot,
  slotNo,
  position,
  onCustomize,
}: {
  slot: HomeShowcaseSlot;
  slotNo: 1 | 2 | 3;
  position: 'primary' | 'left' | 'right';
  onCustomize: (slotNo: 1 | 2 | 3) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = slot.full_image_url
    ?? slot.card_image_url
    ?? slot.avatar_image_url
    ?? slot.resource_url
    ?? null;

  useEffect(() => {
    setImageFailed(false);
  }, [slot.character_id, imageUrl]);

  const positionClass = {
    primary: 'left-1/2 bottom-0 z-[3] h-[94%] w-[58%] -translate-x-1/2 lg:w-[48%]',
    left: 'left-[2%] bottom-[1%] z-[2] h-[72%] w-[39%] lg:left-[5%] lg:h-[76%] lg:w-[34%]',
    right: 'right-[2%] bottom-[1%] z-[2] h-[72%] w-[39%] lg:right-[5%] lg:h-[76%] lg:w-[34%]',
  }[position];

  return (
    <button
      type="button"
      onClick={() => onCustomize(slotNo)}
      className={`absolute flex items-end justify-center ${positionClass} cursor-pointer rounded-[20px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/70`}
      aria-label={`편린 슬롯 ${slotNo} 변경하기 · ${slot.name ?? '편린'}`}
      title="클릭해서 전시 편린 변경"
    >
      {!imageFailed && imageUrl && slot.resource_kind !== 'EMOJI' ? (
        <img
          src={resolveAssetUrl(imageUrl, 'character')}
          alt={slot.name ?? '편린'}
          className="pointer-events-none h-full w-full object-contain object-bottom drop-shadow-[0_14px_18px_rgba(0,0,0,0.45)] transition-[filter,transform] duration-200 hover:brightness-110"
          loading={position === 'primary' ? 'eager' : 'lazy'}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="pointer-events-none mb-[18%] flex h-24 w-24 items-center justify-center rounded-full border border-white/15 bg-black/25 text-6xl backdrop-blur-sm">
          {slot.emoji ?? '✨'}
        </div>
      )}
    </button>
  );
}

// =====================================================================
// 대시보드 부가 데이터 조회
// =====================================================================

interface DashboardData {
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
        
        // 3. 업적 통계 — 도감과 동일한 SECRET-safe catalog를 사용한다.
        // 미공개 히든도 placeholder 1개로 총 업적 수에는 포함되며, 정확한 업적 점수는 반환되지 않는다.
        achievementA1Rpc.studentCatalog(supabase),
        
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
      
      // 업적 통계 집계: 업적도감과 같은 catalog를 기준으로 하여 홈의 분모/분자가 항상 일치한다.
      if (achievementsRes.success === false) throw new Error(achievementsRes.error);
      const achievementCatalog = achievementsRes.data ?? [];
      const earnedAchievements = achievementCatalog.filter((a) => a.is_earned);
      const epicCount = earnedAchievements.filter((a) => a.grade === '에픽' || a.grade === '초월').length;
      const hiddenCount = earnedAchievements.filter((a) => a.grade === '히든').length;
      
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
        attendanceUnclaimed: false,  // TODO: 우편함에 출석 보상 있는지
        mailUnreadCount: mailRes.count ?? 0,
        alertsUnreadCount,
        guildAlertCount: 0,  // TODO: 길드 알림
        emergencyQuest: activeEmergencyQuest
          ? { id: activeEmergencyQuest.id, title: activeEmergencyQuest.title, expiresAt: activeEmergencyQuest.expires_at, requestStatus: requestByQuest.get(activeEmergencyQuest.id) ?? null }
          : null,
        achievementsEarned: earnedAchievements.length,
        achievementsTotal: achievementCatalog.length,
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

function useHomePersonalization(studentId: number | null) {
  return useQuery<HomePersonalization>({
    queryKey: ['home-customization', studentId],
    enabled: studentId !== null,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      const result = await homePersonalizationRpc.get(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
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
