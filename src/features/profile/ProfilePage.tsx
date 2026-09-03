// =====================================================================
// B.R.A.N.D 2.0 — 프로필 페이지
// Stage 6-C · 생성일 2026-05-20
// =====================================================================
// 학생 프로필 — 기본 정보 + 브랜드명 편집 + 비밀번호 변경 + 로그아웃
// =====================================================================

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  PageHeader,
  Modal,
  LoadingSpinner,
  useRpcCall,
} from "@/components/shared/components";
import { supabase } from "@/lib/supabase/client";
import {
  useAuthStore,
  useCurrentStudent,
  useStudentId,
} from "@/stores/auth_store";
import { useWallet } from "@/hooks/useWallet";
import { formatNumber, formatGradeClass, formatDate } from "@/lib/utils/format";
import { getTierIconUrl } from "@/lib/assets/asset_urls";
import {
  calculateTierFromBv,
  getBvUntilNextTier,
  getTierProgress,
  getNextTier,
} from "@/constants/tier_thresholds";
import { cn } from "@/lib/utils/cn";
import { useMyAchievementTitle } from "@/hooks/useAchievementTitles";
import { AchievementTitleBadge } from "@/components/shared/AchievementTitleBadge";

// =====================================================================
// ProfilePage
// =====================================================================

export default function ProfilePage() {
  const student = useCurrentStudent();
  const studentId = useStudentId();
  const { wallet } = useWallet();
  const { title: equippedTitle } = useMyAchievementTitle();
  const [editBrandOpen, setEditBrandOpen] = useState(false);
  const [editPasswordOpen, setEditPasswordOpen] = useState(false);
  const logout = useAuthStore((s) => s.logout);

  const { data: detail } = useProfileDetail(studentId);

  if (!student) return null;

  const tier = calculateTierFromBv(wallet?.bv ?? 0);
  const tierProgress = getTierProgress(tier, wallet?.bv ?? 0);
  const nextTier = getNextTier(tier);
  const bvUntilNext = getBvUntilNextTier(tier, wallet?.bv ?? 0);

  return (
    <>
      <PageHeader title="프로필" emoji="👤" />

      <div className="px-4 pt-4 space-y-4">
        {/* 아이덴티티 카드 */}
        <div className="bg-bg-card backdrop-blur-card border border-line-brand rounded-card-lg p-4 text-center">
          {/* 티어 이미지 */}
          <div className="w-24 h-24 mx-auto mb-3 relative">
            <img
              src={getTierIconUrl(tier)}
              alt={tier}
              className="w-full h-full object-contain"
              style={{
                filter: "drop-shadow(0 0 24px rgba(255, 217, 61, 0.6))",
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>

          {/* 브랜드명 */}
          <div className="mb-1 flex flex-wrap items-center justify-center gap-2">
            <AchievementTitleBadge title={equippedTitle?.title} grade={equippedTitle?.grade} />
            <h2 className="font-display text-2xl text-brand-gradient tracking-tighter">
              {student.brandName || student.studentName}
            </h2>
          </div>

          {/* 본명 + 학년반 */}
          <p className="text-sm text-text-secondary font-bold mb-2">
            {student.studentName} · {student.classroomName}
          </p>

          {/* 티어 정보 */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-bg-deep border border-line rounded-pill text-2xs font-extrabold">
            <span className="text-gold">⭐</span>
            <span className="text-text-primary">{tier}</span>
          </div>
        </div>

        {/* 티어 진행 */}
        <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-extrabold text-text-secondary uppercase tracking-wider">
              티어 진행
            </span>
            {nextTier && (
              <span className="text-2xs font-bold text-gold">
                다음: {nextTier.tier}
              </span>
            )}
          </div>

          <div className="h-2 bg-bg-deep rounded-pill overflow-hidden mb-2">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${tierProgress * 100}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="h-full bg-gradient-to-r from-gold to-brand-primary rounded-pill"
            />
          </div>

          <div className="flex justify-between text-2xs font-bold">
            <span className="text-bv">
              현재 ⭐ {formatNumber(wallet?.bv ?? 0)} BV
            </span>
            {nextTier && (
              <span className="text-gold">
                다음까지 +{formatNumber(bvUntilNext)} BV
              </span>
            )}
          </div>
        </div>

        {/* 통계 */}
        {detail && <StatsGrid detail={detail} />}

        {/* 액션 버튼들 */}
        <div className="space-y-2">
          <ProfileAction
            emoji="✏️"
            label="브랜드명 변경"
            description={student.brandName || "브랜드명을 설정해보세요"}
            onClick={() => setEditBrandOpen(true)}
          />
          <ProfileAction
            emoji="🔑"
            label="비밀번호 변경"
            description="안전한 비밀번호로 바꾸세요"
            onClick={() => setEditPasswordOpen(true)}
          />
          <ProfileAction
            emoji="🚪"
            label="로그아웃"
            description="다른 계정으로 변경"
            onClick={() => {
              if (confirm("로그아웃하시겠어요?")) logout();
            }}
            danger
          />
        </div>
      </div>

      {editBrandOpen && (
        <BrandNameModal
          currentName={student.brandName ?? ""}
          onClose={() => setEditBrandOpen(false)}
        />
      )}
      {editPasswordOpen && (
        <PasswordModal onClose={() => setEditPasswordOpen(false)} />
      )}
    </>
  );
}

// =====================================================================
// 통계 그리드
// =====================================================================

interface ProfileDetail {
  enrolledAt: string;
  achievementsEarned: number;
  totalTransactions: number;
  totalDonation: number;
  totalTaxPaid: number;
  creditGrade: string | null;
  creditScore: number;
}

function StatsGrid({ detail }: { detail: ProfileDetail }) {
  return (
    <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4">
      <div className="text-xs font-extrabold text-text-secondary uppercase tracking-wider mb-3">
        나의 활동
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatItem
          label="가입일"
          value={formatDate(detail.enrolledAt)}
          emoji="🌱"
        />
        <StatItem
          label="달성 업적"
          value={`${detail.achievementsEarned}개`}
          emoji="🏆"
        />
        <StatItem
          label="총 거래"
          value={`${formatNumber(detail.totalTransactions)}회`}
          emoji="🔄"
        />
        <StatItem
          label="복지 기여"
          value={`${formatNumber(detail.totalDonation)} 골드`}
          emoji="🤝"
        />
        <StatItem
          label="누적 납세"
          value={`${formatNumber(detail.totalTaxPaid)} 골드`}
          emoji="🏛️"
        />
      </div>

      {/* 신용점수 */}
      {detail.creditGrade && (
        <div className="mt-3 pt-3 border-t border-line flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">💳</span>
            <span className="text-xs font-extrabold text-text-secondary">
              신용등급
            </span>
          </div>
          <div className="text-right">
            <div className="font-display text-base text-gold leading-none">
              {detail.creditGrade}
            </div>
            <div className="text-2xs text-text-muted font-bold mt-0.5">
              {formatNumber(detail.creditScore)}점
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatItem({
  label,
  value,
  emoji,
}: {
  label: string;
  value: string;
  emoji: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm">{emoji}</span>
        <span className="text-2xs font-extrabold text-text-secondary uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="text-sm font-extrabold text-text-primary truncate">
        {value}
      </div>
    </div>
  );
}

// =====================================================================
// 액션 버튼
// =====================================================================

function ProfileAction({
  emoji,
  label,
  description,
  onClick,
  danger,
}: {
  emoji: string;
  label: string;
  description: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        "w-full bg-bg-card backdrop-blur-card border rounded-card-md p-3.5 flex items-center gap-3 text-left hover-lift",
        danger ? "border-danger/30" : "border-line",
      )}
    >
      <span className="text-2xl">{emoji}</span>
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "text-sm font-extrabold",
            danger ? "text-danger" : "text-text-primary",
          )}
        >
          {label}
        </div>
        <div className="text-2xs text-text-muted font-bold truncate mt-0.5">
          {description}
        </div>
      </div>
      <span className="text-text-muted">›</span>
    </motion.button>
  );
}

// =====================================================================
// 브랜드명 변경 모달
// =====================================================================

function BrandNameModal({
  currentName,
  onClose,
}: {
  currentName: string;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState(currentName);
  const studentId = useStudentId();
  const { call, isLoading } = useRpcCall();
  const refreshContext = useAuthStore((s) => s.refreshContext);

  const handleSave = async () => {
    if (!studentId || !newName.trim()) return;

    // TODO: studentRpc에 updateBrandName 추가 필요 (Stage 5에 누락 가능)
    // 임시: 직접 UPDATE
    const { error } = await supabase
      .from("students")
      .update({ brand_name: newName.trim() })
      .eq("id", studentId);

    if (error) {
      alert("변경 실패: " + error.message);
      return;
    }

    await refreshContext();
    onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title="브랜드명 변경" emoji="✏️" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary break-keep leading-relaxed">
          브랜드명은 다른 학생에게도 보이는 이름이에요. 본명 대신 보여줄 별명을
          정해보세요.
        </p>

        <div>
          <label className="block text-xs font-bold text-text-secondary mb-2">
            새 브랜드명
          </label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="login-input"
            placeholder="예: Seven, 별빛이"
            maxLength={20}
          />
          <p className="text-2xs text-text-muted mt-1">
            {newName.length} / 20자
          </p>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading || !newName.trim() || newName === currentName}
            className="btn-primary flex-1"
          >
            {isLoading ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================
// 비밀번호 변경 모달
// =====================================================================

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = async () => {
    if (newPw !== confirmPw) {
      alert("새 비밀번호가 일치하지 않습니다");
      return;
    }
    if (newPw.length < 6) {
      alert("비밀번호는 6자 이상이어야 합니다");
      return;
    }

    setIsLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setIsLoading(false);

    if (error) {
      alert("변경 실패: " + error.message);
    } else {
      alert("비밀번호가 변경되었습니다");
      onClose();
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="비밀번호 변경" emoji="🔑" size="sm">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-bold text-text-secondary mb-2">
            새 비밀번호
          </label>
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            className="login-input"
            placeholder="6자 이상"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-text-secondary mb-2">
            새 비밀번호 확인
          </label>
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="login-input"
            placeholder="다시 입력"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1">
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading || !newPw || !confirmPw}
            className="btn-primary flex-1"
          >
            {isLoading ? "변경 중..." : "변경"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================
// 프로필 상세 조회
// =====================================================================

function useProfileDetail(studentId: number | null) {
  return useQuery<ProfileDetail>({
    queryKey: ["profile-detail", studentId],
    queryFn: async () => {
      if (!studentId) throw new Error("학생 정보 없음");

      const [
        studentRes,
        achievementsRes,
        transactionsRes,
        financialRes,
        creditRes,
      ] = await Promise.all([
        supabase
          .from("students")
          .select("enrolled_at")
          .eq("id", studentId)
          .single(),

        supabase
          .from("student_achievements")
          .select("id", { count: "exact", head: true })
          .eq("student_id", studentId)
          .eq("is_revoked", false),

        supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("student_id", studentId)
          .eq("is_reversed", false),

        supabase.rpc("student_get_financial_lifetime_summary"),

        supabase
          .from("credit_scores")
          .select("grade, total_score")
          .eq("student_id", studentId)
          .order("calculated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (financialRes.error) throw financialRes.error;
      const financial = (financialRes.data ?? {}) as Record<string, unknown>;
      const totalDonation = Number(financial.donation_total ?? 0);
      const totalTax = Number(financial.tax_paid_total ?? 0);

      return {
        enrolledAt: studentRes.data?.enrolled_at ?? new Date().toISOString(),
        achievementsEarned: achievementsRes.count ?? 0,
        totalTransactions: transactionsRes.count ?? 0,
        totalDonation,
        totalTaxPaid: totalTax,
        creditGrade: creditRes.data?.grade ?? null,
        creditScore: creditRes.data?.total_score ?? 0,
      };
    },
    enabled: studentId !== null,
  });
}
