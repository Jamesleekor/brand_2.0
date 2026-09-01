// =====================================================================
// B.R.A.N.D 2.0 — 학급 운영 패널
// Stage 6-E · 생성일 2026-05-20
// =====================================================================
// 교사가 학급 경제를 조정하는 컨트롤 패널.
// - 비상사태 발동/해제 (하이퍼인플레이션·자산동결·취업동결)
// - 복지기금 분배
// - 돌발 퀘스트 발동
// =====================================================================

import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Modal,
  LoadingSpinner,
  useRpcCall,
} from "@/components/shared/components";
import { TeacherShell } from "@/components/teacher/TeacherShell";
import { AssetAdjustmentPanel } from "@/features/teacher/AssetAdjustmentPanel";
import { TransactionReversalPanel } from "@/features/teacher/TransactionReversalPanel";
import EconomyHistoryPanel from "@/features/teacher/EconomyHistoryPanel";
import { supabase } from "@/lib/supabase/client";
import { teacherRpc } from "@/lib/rpc/teacher_rpc";
import { useClassroomId, useCurrentStudent } from "@/stores/auth_store";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/utils/format";
import { useToastStore } from "@/stores/ui_store";
import { cn } from "@/lib/utils/cn";

// =====================================================================
// 타입
// =====================================================================

interface EmergencyState {
  id: number;
  emergencyType: "HYPERINFLATION" | "ASSET_FREEZE" | "EMPLOYMENT_FREEZE";
  status: "ACTIVE" | "TERMINATED";
  reason: string;
  activatedAt: string;
  scheduledEndAt: string | null;
}

interface WelfareFundInfo {
  totalAmount: number;
  studentCount: number;
}

// =====================================================================
// ClassroomControl 메인
// =====================================================================

export default function ClassroomControl() {
  const classroomId = useClassroomId();
  const location = useLocation();
  const historyMode = location.pathname.endsWith('/history');

  return (
    <TeacherShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl text-brand-gradient tracking-tight mb-1">
            ⚙️ 학급 운영
          </h1>
          <p className="text-sm text-text-secondary font-bold">
            학생 자산·거래 정정·비상사태·복지·돌발 퀘스트 관리
          </p>
        </div>

        <div className="flex gap-2 rounded-card-lg border border-line bg-bg-card p-2">
          <Link
            to="/teacher/control"
            className={cn(
              'rounded-pill px-4 py-2 text-xs font-black transition-all',
              !historyMode ? 'bg-gradient-to-r from-brand-primary to-gold text-white shadow-brand-sm' : 'text-text-secondary hover:bg-bg-deep hover:text-white',
            )}
          >
            ⚙️ 운영
          </Link>
          <Link
            to="/teacher/control/history"
            className={cn(
              'rounded-pill px-4 py-2 text-xs font-black transition-all',
              historyMode ? 'bg-gradient-to-r from-brand-primary to-gold text-white shadow-brand-sm' : 'text-text-secondary hover:bg-bg-deep hover:text-white',
            )}
          >
            📚 히스토리
          </Link>
        </div>

        {historyMode ? (
          <EconomyHistoryPanel classroomId={classroomId} />
        ) : (
          <>
            {/* 학생 BV/GOLD/CRYSTAL 지급·차감 */}
            <AssetAdjustmentPanel classroomId={classroomId} />

            {/* 최근 기본 경제 거래 취소·정정 */}
            <TransactionReversalPanel classroomId={classroomId} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 비상사태 패널 */}
              <EmergencyPanel classroomId={classroomId} />

              {/* 복지기금 패널 */}
              <WelfarePanel classroomId={classroomId} />
            </div>

            {/* 돌발 퀘스트 패널 */}
            <EmergencyQuestPanel classroomId={classroomId} />
          </>
        )}
      </div>
    </TeacherShell>
  );
}

// =====================================================================
// 비상사태 패널
// =====================================================================

function EmergencyPanel({ classroomId }: { classroomId: number | null }) {
  const [activateOpen, setActivateOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!classroomId) return;
    const channel = supabase.channel(`teacher-classroom-emergencies-${classroomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emergencies', filter: `classroom_id=eq.${classroomId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['emergency-state', classroomId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [classroomId, queryClient]);

  const { data: activeState, isLoading } = useQuery<EmergencyState | null>({
    queryKey: ["emergency-state", classroomId],
    queryFn: async () => {
      if (!classroomId) return null;
      const { data } = await supabase
        .from("emergencies")
        .select("*")
        .eq("classroom_id", classroomId)
        .eq("status", "ACTIVE")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) return null;
      return {
        id: data.id,
        emergencyType: data.emergency_type,
        status: data.status,
        reason: data.reason ?? "",
        activatedAt: data.started_at,
        scheduledEndAt: data.scheduled_end_at,
      };
    },
    enabled: classroomId !== null,
    refetchOnMount: 'always',
  });

  return (
    <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-base text-white tracking-tight flex items-center gap-2">
          <span>🚨</span>
          <span>비상사태</span>
        </h3>
        {!activeState && (
          <button
            onClick={() => setActivateOpen(true)}
            className="px-3 py-1.5 bg-danger/20 border border-danger/40 text-danger rounded-pill text-2xs font-black"
          >
            발동
          </button>
        )}
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : activeState ? (
        <ActiveEmergencyCard state={activeState} />
      ) : (
        <div className="text-center py-6 text-text-muted">
          <span className="text-3xl">🌤️</span>
          <p className="text-sm font-bold mt-2">평온한 상태</p>
        </div>
      )}

      {activateOpen && (
        <ActivateEmergencyModal
          classroomId={classroomId!}
          onClose={() => setActivateOpen(false)}
        />
      )}
    </div>
  );
}

function ActiveEmergencyCard({ state }: { state: EmergencyState }) {
  const teacher = useCurrentStudent();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();

  const config = {
    HYPERINFLATION: {
      label: "하이퍼인플레이션",
      emoji: "📈",
      desc: "간식·경매 가격 1.5배",
    },
    ASSET_FREEZE: {
      label: "자산동결",
      emoji: "🧊",
      desc: "P2P 송금·환전 차단",
    },
    EMPLOYMENT_FREEZE: {
      label: "취업동결",
      emoji: "🚫",
      desc: "2차직업 신청 차단",
    },
  }[state.emergencyType];

  const handleTerminate = async () => {
    if (!teacher?.userId) return;
    if (!confirm(`${config.label}을 종료하시겠어요?`)) return;

    await call(
      () =>
        teacherRpc.terminateEmergency(supabase, {
          p_emergency_id: state.id,
          p_is_auto: false,
          p_teacher_user_id: teacher.userId,
        }),
      {
        successTitle: "비상사태 종료",
        successDescription: `${config.label} 해제 완료`,
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["emergency-state"] });
        },
      },
    );
  };

  return (
    <div className="bg-danger-bg border border-danger/40 rounded-card-md p-4">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-3xl">{config.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="text-2xs font-black uppercase tracking-widest text-danger mb-1">
            발동 중
          </div>
          <h4 className="font-display text-base text-white">{config.label}</h4>
          <p className="text-2xs text-text-secondary font-bold mt-0.5">
            {config.desc}
          </p>
        </div>
      </div>

      {state.reason && (
        <div className="bg-bg-deep border border-line rounded-card-sm p-2.5 mb-3">
          <div className="text-2xs font-black uppercase tracking-widest text-text-muted mb-1">
            발동 사유
          </div>
          <p className="text-xs text-text-primary leading-relaxed break-keep">
            {state.reason}
          </p>
        </div>
      )}

      <div className="space-y-1.5 text-xs font-bold mb-3">
        <div className="text-text-secondary">{formatRelativeTime(state.activatedAt)} 발동</div>
        {state.scheduledEndAt && <div className="text-warning">자동 종료 · {formatDateTime(state.scheduledEndAt)}</div>}
      </div>

      <button
        onClick={handleTerminate}
        disabled={isLoading}
        className="w-full py-2 bg-bg-deep border border-success/40 text-success rounded-card-md text-sm font-extrabold hover:bg-success-bg transition-all"
      >
        {isLoading ? "종료 중..." : "🌤️ 비상사태 종료"}
      </button>
    </div>
  );
}

function ActivateEmergencyModal({
  classroomId,
  onClose,
}: {
  classroomId: number;
  onClose: () => void;
}) {
  const teacher = useCurrentStudent();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [type, setType] = useState<
    "HYPERINFLATION" | "ASSET_FREEZE" | "EMPLOYMENT_FREEZE"
  >("HYPERINFLATION");
  const [reason, setReason] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState(() => { const d=new Date(Date.now()+24*3600000); const local=new Date(d.getTime()-d.getTimezoneOffset()*60000); return local.toISOString().slice(0,16); });

  const types = [
    {
      value: "HYPERINFLATION",
      label: "하이퍼인플레이션",
      emoji: "📈",
      desc: "간식·경매 가격 1.5배 적용",
    },
    {
      value: "ASSET_FREEZE",
      label: "자산동결",
      emoji: "🧊",
      desc: "P2P 송금·환전 일시 차단",
    },
    {
      value: "EMPLOYMENT_FREEZE",
      label: "취업동결",
      emoji: "🚫",
      desc: "2차직업 신규 신청 차단",
    },
  ] as const;

  const handleActivate = async () => {
    if (!teacher?.userId || !reason.trim()) return;

    await call(
      () =>
        teacherRpc.activateEmergency(supabase, {
          p_classroom_id: classroomId,
          p_emergency_type: type,
          p_reason: reason.trim(),
          p_scheduled_end_at: new Date(scheduledEnd).toISOString(),
          p_teacher_user_id: teacher.userId,
        }),
      {
        successTitle: "비상사태 발동",
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["emergency-state"] });
          onClose();
        },
      },
    );
  };

  return (
    <Modal isOpen onClose={onClose} title="비상사태 발동" emoji="🚨" size="md">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-bold text-text-secondary mb-2">
            유형
          </label>
          <div className="space-y-2">
            {types.map((t) => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                className={cn(
                  "w-full p-3 rounded-card-md border text-left transition-all",
                  type === t.value
                    ? "bg-danger/15 border-danger/50"
                    : "bg-bg-deep border-line hover:border-line-strong",
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="text-xl">{t.emoji}</span>
                  <div>
                    <div className="text-sm font-extrabold text-text-primary">
                      {t.label}
                    </div>
                    <div className="text-2xs text-text-muted font-bold mt-0.5">
                      {t.desc}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-text-secondary mb-1.5">
            발동 사유
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 학급 자산 격차 확대로 자산동결 발동"
            className="w-full px-3 py-2.5 bg-bg-deep border border-line-strong rounded-card-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary resize-none"
            rows={2}
            maxLength={300}
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-text-secondary mb-1.5">
            종료 시각
          </label>
          <input type="datetime-local" value={scheduledEnd} onChange={(e)=>setScheduledEnd(e.target.value)} className="input-field w-full" />
        </div>

        <div className="bg-warning-bg border border-warning/30 rounded-card-sm p-2.5 mt-2">
          <p className="text-2xs text-text-secondary font-bold break-keep">
            ⚠️ 발동 시 전체 학생에게 알림이 발송되고 즉시 적용됩니다.
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1">
            취소
          </button>
          <button
            onClick={handleActivate}
            disabled={!reason.trim() || !scheduledEnd || new Date(scheduledEnd).getTime() <= Date.now() || isLoading}
            className="btn-danger flex-1"
          >
            {isLoading ? "발동 중..." : "🚨 발동"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================
// 복지기금 패널
// =====================================================================

function WelfarePanel({ classroomId }: { classroomId: number | null }) {
  const [distributeOpen, setDistributeOpen] = useState(false);

  const { data: fund, isLoading } = useQuery<WelfareFundInfo>({
    queryKey: ["welfare-fund", classroomId],
    queryFn: async () => {
      if (!classroomId) return { totalAmount: 0, studentCount: 0 };

      // 복지기금 잔액 (welfare_fund 테이블)
      const { data: fundData } = await supabase
        .from("welfare_funds")
        .select("current_balance")
        .eq("classroom_id", classroomId)
        .maybeSingle();

      const { count } = await supabase
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("classroom_id", classroomId)
        .eq("role", "STUDENT")
        .is("transferred_at", null);

      return {
        totalAmount: Number(fundData?.current_balance ?? 0),
        studentCount: count ?? 0,
      };
    },
    enabled: classroomId !== null,
  });

  return (
    <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-base text-white tracking-tight flex items-center gap-2">
          <span>🤝</span>
          <span>복지기금</span>
        </h3>
      </div>

      {isLoading || !fund ? (
        <LoadingSpinner />
      ) : (
        <>
          <div className="text-center py-4">
            <div className="font-display text-3xl text-success tracking-tighter mb-1">
              {formatNumber(fund.totalAmount)}
            </div>
            <div className="text-2xs font-black uppercase tracking-widest text-text-muted">
              누적 골드
            </div>
            <p className="text-2xs text-text-muted font-bold mt-2">
              {fund.studentCount}명에게 분배 시 1인{" "}
              {formatNumber(
                Math.floor(fund.totalAmount / Math.max(fund.studentCount, 1)),
              )}{" "}
              골드
            </p>
          </div>

          <button
            onClick={() => setDistributeOpen(true)}
            disabled={fund.totalAmount === 0}
            className="w-full btn-primary"
          >
            🎁 복지기금 분배
          </button>
        </>
      )}

      {distributeOpen && fund && (
        <DistributeWelfareModal
          classroomId={classroomId!}
          fundAmount={fund.totalAmount}
          studentCount={fund.studentCount}
          onClose={() => setDistributeOpen(false)}
        />
      )}
    </div>
  );
}

function DistributeWelfareModal({
  classroomId,
  fundAmount,
  studentCount,
  onClose,
}: {
  classroomId: number;
  fundAmount: number;
  studentCount: number;
  onClose: () => void;
}) {
  const teacher = useCurrentStudent();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();

  // 하위 N% 학생에게 집중 분배 (선택)
  const [strategy, setStrategy] = useState<"EQUAL" | "BOTTOM_30" | "BOTTOM_50">(
    "EQUAL",
  );

  const handleDistribute = async () => {
    alert(
      "복지기금 분배 방식과 DB 함수 규칙이 일치하지 않아 현재 비활성화되었습니다.",
    );
  };

  return (
    <Modal isOpen onClose={onClose} title="복지기금 분배" emoji="🤝" size="md">
      <div className="space-y-3">
        <div className="bg-success-bg border border-success/30 rounded-card-md p-3 text-center">
          <div className="text-2xs font-black uppercase text-success mb-1">
            분배 가능
          </div>
          <div className="font-display text-2xl text-success">
            {formatNumber(fundAmount)} 골드
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-text-secondary mb-2">
            분배 방식
          </label>
          <div className="space-y-2">
            {[
              {
                value: "EQUAL",
                label: "균등 분배",
                desc: `전체 ${studentCount}명에게 1인당 ${formatNumber(Math.floor(fundAmount / studentCount))} 골드`,
              },
              {
                value: "BOTTOM_30",
                label: "하위 30% 집중",
                desc: `자산 하위 30% 학생에게 집중 분배 (불평등 완화)`,
              },
              {
                value: "BOTTOM_50",
                label: "하위 50% 집중",
                desc: `자산 하위 50% 학생에게 분배`,
              },
            ].map((s) => (
              <button
                key={s.value}
                onClick={() => setStrategy(s.value as any)}
                className={cn(
                  "w-full p-3 rounded-card-md border text-left transition-all",
                  strategy === s.value
                    ? "bg-success/15 border-success/50"
                    : "bg-bg-deep border-line",
                )}
              >
                <div className="text-sm font-extrabold text-text-primary">
                  {s.label}
                </div>
                <div className="text-2xs text-text-muted font-bold mt-0.5 break-keep">
                  {s.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1">
            취소
          </button>
          <button
            onClick={handleDistribute}
            disabled
            className="btn-primary flex-1 opacity-50 cursor-not-allowed"
          >
            {isLoading ? "분배 중..." : "🎁 분배"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================
// 돌발 퀘스트 패널
// =====================================================================

function EmergencyQuestPanel({ classroomId }: { classroomId: number | null }) {
  return (
    <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-base text-white tracking-tight flex items-center gap-2">
            <span>⚡</span><span>돌발 퀘스트</span>
          </h3>
          <p className="text-xs text-text-muted mt-1">
            Feature4 이벤트 운영 화면에서 생성·종료·보상 상태를 통합 관리합니다.
          </p>
        </div>
        <Link to="/teacher/operations" className="btn-primary text-xs whitespace-nowrap">
          이벤트 운영 열기
        </Link>
      </div>
      {!classroomId && <p className="text-2xs text-danger mt-2">학급 정보를 불러오지 못했습니다.</p>}
    </div>
  );
}
