// =====================================================================
// B.R.A.N.D 2.0 — 자산 페이지 (거래 히스토리)
// Stage 6-C · 생성일 2026-05-20
// =====================================================================
// 학생의 거래 히스토리 + 화폐별 필터 + 무한 스크롤.
// =====================================================================

import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  PageHeader,
  LoadingSpinner,
  EmptyState,
} from "@/components/shared/components";
import { supabase } from "@/lib/supabase/client";
import { useStudentId } from "@/stores/auth_store";
import { useWallet, type Wallet } from "@/hooks/useWallet";
import { useFinancialLifetimeSummary } from "@/hooks/useFinancialLifetimeSummary";
import { EconomicActionsPanel } from "@/features/wallet/EconomicActionsPanel";
import {
  formatNumber,
  formatDelta,
  formatRelativeTime,
} from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { calculateTierFromBv } from "@/constants/tier_thresholds";

// =====================================================================
// 타입
// =====================================================================

interface Transaction {
  id: number;
  valueToken: "GOLD" | "BV" | "CRYSTAL";
  amount: number; // 양수 = 수입, 음수 = 지출
  balanceAfter: number;
  sourceType: string;
  taxAmount: number;
  memo: string | null;
  createdAt: string;
  isReversed: boolean;
}

interface AssetArrearEntry {
  id: number;
  value_token: "BV" | "GOLD" | "CRYSTAL";
  assessed_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  reason: string;
  status: "UNPAID" | "PARTIAL";
  created_at: string;
}

interface AssetArrearsSummary {
  total_items: number;
  totals: { BV: number; GOLD: number; CRYSTAL: number };
  entries: AssetArrearEntry[];
}

type Filter = "ALL" | "GOLD" | "BV" | "CRYSTAL";

const SOURCE_LABELS: Record<string, { label: string; emoji: string }> = {
  // ── 소득 (보상) ──
  DAILY_QUEST: { label: "일일퀘스트", emoji: "⚔️" },
  ATTENDANCE_BONUS: { label: "출석 보상", emoji: "📅" },
  ATTENDANCE_STREAK: { label: "연속 출석", emoji: "🔥" },
  CLASS_PARTICIPATION: { label: "수업 참여", emoji: "🙋" },
  ASSIGNMENT_SUBMIT: { label: "과제 제출", emoji: "📝" },
  ASSIGNMENT_EXCELLENCE: { label: "과제 우수", emoji: "🌟" },
  ACHIEVEMENT_RECOGNITION: { label: "업적 보상", emoji: "🏆" },
  ACHIEVEMENT_REWARD: { label: "업적 달성 보상", emoji: "🏆" },
  PRIMARY_JOB_WAGE: { label: "1인1역 급여", emoji: "💼" },
  GUILD_MISSION_REWARD: { label: "길드 보상", emoji: "🛡️" },
  INITIAL_BALANCE: { label: "초기 지급", emoji: "🎁" },
  TEACHER_GRANT: { label: "교사 지급", emoji: "👩‍🏫" },
  NEWBIE_SETTLEMENT: { label: "정착 지원", emoji: "🌱" },
  TEACHER_HONOR: { label: "교사 명예 부여", emoji: "🎖️" },
  COSMETIC_SET_HONOR: { label: "세트 완성 명예", emoji: "✨" },
  DONATION_HONOR: { label: "기부 명예", emoji: "💝" },
  WELFARE_DISTRIBUTION: { label: "복지 지원금", emoji: "🤝" },

  // ── 소비 (지출) ──
  SNACK_PURCHASE: { label: "간식 구매", emoji: "🍪" },
  COSMETIC_PURCHASE: { label: "꾸미기 구매", emoji: "🎨" },
  AUCTION_PAYMENT: { label: "경매 낙찰", emoji: "🔨" },
  AUCTION_REFUND: { label: "경매 환불", emoji: "↩️" },

  // ── 금융 ──
  DEPOSIT_PRINCIPAL: { label: "예금 가입", emoji: "🏦" },
  DEPOSIT_MATURITY: { label: "예금 만기", emoji: "💰" },
  EARLY_WITHDRAWAL_PENALTY: { label: "중도해지 수수료", emoji: "⚠️" },
  LOAN_DISBURSEMENT: { label: "대출 실행", emoji: "💳" },
  LOAN_REPAYMENT: { label: "대출 상환", emoji: "💵" },
  INCOME_TAX: { label: "소득세", emoji: "🏛️" },

  // ── 사회 ──
  DONATION: { label: "기부", emoji: "💝" },
  SOCIAL_CONTRIBUTION: { label: "사회 기여", emoji: "🌍" },
  EXCHANGE_PAY: { label: "화폐 교환 (지출)", emoji: "🔄" },
  EXCHANGE_RECEIVE: { label: "화폐 교환 (수령)", emoji: "🔄" },
  P2P_SEND: { label: "송금 (보냄)", emoji: "↗️" },
  P2P_RECEIVE: { label: "송금 (받음)", emoji: "↘️" },

  // ── 제재·정정 ──
  NORM_VIOLATION_PENALTY: { label: "규칙 위반 벌금", emoji: "🚫" },
  TEACHER_DEDUCT: { label: "교사 차감", emoji: "➖" },
  BV_REVOKE: { label: "명예 회수", emoji: "⛔" },
  CORRECTION: { label: "정정", emoji: "🔧" },
  REVERSAL: { label: "거래 취소", emoji: "↩️" },

  // ── 기타 ──
  OTHER: { label: "기타", emoji: "📌" },
};

// =====================================================================
// WalletPage
// =====================================================================

export default function WalletPage() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const { wallet, isLoading } = useWallet();
  const financial = useFinancialLifetimeSummary();

  return (
    <>
      <PageHeader title="내 자산" emoji="💼" />

      <div className="px-4 pt-4">
        {/* 자산 요약 */}
        <WalletSummary
          wallet={wallet}
          isLoading={isLoading}
          taxPaid={financial.data?.tax_paid_total ?? null}
          taxStatus={financial.isLoading ? "집계 중" : financial.isError ? "집계 오류" : undefined}
        />

        {/* 학생 경제 행동 */}
        <EconomicActionsPanel wallet={wallet} isLoading={isLoading} />

        {/* 미납 벌금 */}
        <AssetArrearsPanel />

        {/* 필터 탭 */}
        <FilterTabs current={filter} onChange={setFilter} />

        {/* 거래 히스토리 */}
        <TransactionList filter={filter} />
      </div>
    </>
  );
}

// =====================================================================
// 자산 요약
// =====================================================================

function WalletSummary({
  wallet,
  isLoading,
  taxPaid,
  taxStatus,
}: {
  wallet: Wallet | null | undefined;
  isLoading: boolean;
  taxPaid: number | null;
  taxStatus?: string;
}) {
  if (isLoading || !wallet) {
    return (
      <div className="py-6 flex justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 mb-4 sm:grid-cols-4">
      <AssetCard
        label="골드"
        emoji="🪙"
        amount={wallet.gold}
        colorClass="text-gold"
        borderClass="border-gold/40"
      />
      <AssetCard
        label="브랜드가치(BV)"
        emoji="⭐"
        amount={wallet.bv}
        colorClass="text-bv"
        borderClass="border-bv/40"
        subtext={calculateTierFromBv(wallet.bv)}
      />
      <AssetCard
        label="크리스탈"
        emoji="💎"
        amount={wallet.crystal}
        colorClass="text-crystal"
        borderClass="border-crystal/40"
      />
      <AssetCard
        label="납부한 세금"
        emoji="🏛️"
        amount={taxPaid}
        colorClass="text-warning"
        borderClass="border-warning/40"
        subtext={taxStatus}
      />
    </div>
  );
}

function AssetCard({
  label,
  emoji,
  amount,
  colorClass,
  borderClass,
  subtext,
}: {
  label: string;
  emoji: string;
  amount: number | null;
  colorClass: string;
  borderClass: string;
  subtext?: string;
}) {
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      className={cn(
        "bg-bg-card backdrop-blur-card border rounded-card-md p-3",
        borderClass,
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{emoji}</span>
        <span className={cn("text-base font-black tracking-tight", colorClass)}>
          {label}
        </span>
      </div>
      <div className={cn("font-display text-2xl leading-none", colorClass)}>
        {amount === null ? '—' : formatNumber(amount)}
      </div>
      {subtext && (
        <div className="text-sm text-bv-100 font-extrabold mt-1.5 truncate">
          {subtext}
        </div>
      )}
    </motion.div>
  );
}

// =====================================================================
// 미납 벌금
// =====================================================================

function AssetArrearsPanel() {
  const { data, isLoading, isError } = useQuery<AssetArrearsSummary>({
    queryKey: ["student-asset-arrears"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("student_get_my_asset_arrears");
      if (error) throw new Error(error.message);
      return data as AssetArrearsSummary;
    },
    staleTime: 15_000,
  });

  if (isLoading || isError || !data || data.total_items <= 0) return null;

  const tokenMeta = {
    BV: { emoji: "⭐", label: "BV", className: "text-bv" },
    GOLD: { emoji: "🪙", label: "골드", className: "text-gold" },
    CRYSTAL: { emoji: "💎", label: "크리스탈", className: "text-crystal" },
  } as const;

  return (
    <section className="mb-4 overflow-hidden rounded-card-md border border-danger/40 bg-danger-bg/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/20 px-3 py-2.5">
        <div>
          <p className="text-sm font-black text-danger">⚠️ 납부하지 못한 벌금이 있어요</p>
          <p className="mt-0.5 text-xs font-bold text-text-secondary">현재 자산으로 납부하지 못한 금액입니다. 자산은 0 아래로 내려가지 않습니다.</p>
        </div>
        <span className="rounded-pill border border-danger/30 bg-bg-deep px-2.5 py-1 text-xs font-black text-danger">{data.total_items}건 미납</span>
      </div>

      <div className="grid grid-cols-3 gap-1.5 p-3">
        {(["BV", "GOLD", "CRYSTAL"] as const).map((token) => {
          const meta = tokenMeta[token];
          return (
            <div key={token} className="rounded-card-sm border border-line bg-bg-deep px-2.5 py-2 text-center">
              <div className="text-[11px] font-extrabold text-text-secondary">{meta.emoji} {meta.label}</div>
              <div className={cn("mt-1 font-display text-base", data.totals[token] > 0 ? meta.className : "text-text-muted")}>
                {formatNumber(data.totals[token])}
              </div>
            </div>
          );
        })}
      </div>

      <details className="border-t border-danger/20">
        <summary className="cursor-pointer px-3 py-2 text-xs font-black text-text-secondary hover:text-text-primary">미납 내역 보기</summary>
        <div className="divide-y divide-line/70 border-t border-line/70">
          {data.entries.map((entry) => {
            const meta = tokenMeta[entry.value_token];
            return (
              <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-extrabold text-text-primary">{entry.reason}</p>
                  <p className="mt-0.5 text-[11px] font-bold text-text-secondary">부과 {formatNumber(entry.assessed_amount)} · 납부 {formatNumber(entry.paid_amount)}</p>
                </div>
                <div className={cn("whitespace-nowrap text-right font-display text-sm", meta.className)}>
                  {meta.emoji} {formatNumber(entry.outstanding_amount)} 미납
                </div>
              </div>
            );
          })}
        </div>
      </details>
    </section>
  );
}

// =====================================================================
// 필터 탭
// =====================================================================

const FILTER_OPTIONS: { value: Filter; label: string; emoji?: string }[] = [
  { value: "ALL", label: "전체" },
  { value: "GOLD", label: "골드", emoji: "🪙" },
  { value: "BV", label: "BV", emoji: "⭐" },
  { value: "CRYSTAL", label: "크리스탈", emoji: "💎" },
];

function FilterTabs({
  current,
  onChange,
}: {
  current: Filter;
  onChange: (f: Filter) => void;
}) {
  return (
    <div className="flex gap-1.5 mb-3 overflow-x-auto scrollbar-hide">
      {FILTER_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex items-center gap-1.5 px-3.5 py-2 rounded-pill text-xs font-extrabold transition-all flex-shrink-0",
            current === opt.value
              ? "bg-gradient-to-r from-brand-primary to-gold text-white shadow-brand-sm"
              : "bg-bg-card border border-line text-text-secondary hover:text-text-primary",
          )}
        >
          {opt.emoji && <span>{opt.emoji}</span>}
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

// =====================================================================
// 거래 히스토리 (무한 스크롤)
// =====================================================================

function TransactionList({ filter }: { filter: Filter }) {
  const studentId = useStudentId();
  const PAGE_SIZE = 20;

  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["transactions", studentId, filter],
      queryFn: async ({ pageParam = 0 }) => {
        if (!studentId) return [];

        let query = supabase
          .from("transactions")
          .select(
            "id, value_token, amount, balance_after, source_type, tax_amount, memo, created_at, is_reversed",
          )
          .eq("student_id", studentId)
          .eq("is_reversed", false)
          .order("created_at", { ascending: false })
          .range(pageParam * PAGE_SIZE, pageParam * PAGE_SIZE + PAGE_SIZE - 1);

        if (filter !== "ALL") {
          query = query.eq("value_token", filter);
        }

        const { data } = await query;

        return (data ?? []).map((tx) => ({
          id: tx.id,
          valueToken: tx.value_token,
          amount: Number(tx.amount),
          balanceAfter: Number(tx.balance_after),
          sourceType: tx.source_type,
          taxAmount: Number(tx.tax_amount),
          memo: tx.memo,
          createdAt: tx.created_at,
          isReversed: tx.is_reversed,
        })) as Transaction[];
      },
      enabled: studentId !== null,
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) => {
        if (lastPage.length < PAGE_SIZE) return undefined;
        return allPages.length;
      },
    });

  const allTransactions = data?.pages.flat() ?? [];

  if (isLoading) {
    return (
      <div className="py-8 flex justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (allTransactions.length === 0) {
    return (
      <EmptyState
        emoji="📊"
        title="거래 내역이 없어요"
        description="활동을 시작하면 여기에 표시됩니다"
      />
    );
  }

  return (
    <div className="space-y-2">
      {allTransactions.map((tx) => (
        <TransactionItem key={tx.id} transaction={tx} />
      ))}

      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="w-full py-3 text-xs font-bold text-text-secondary hover:text-text-primary"
        >
          {isFetchingNextPage ? "불러오는 중..." : "더 보기"}
        </button>
      )}
    </div>
  );
}

// =====================================================================
// 단일 거래 항목
// =====================================================================

function TransactionItem({ transaction: tx }: { transaction: Transaction }) {
  const source = tx.sourceType === "OTHER" && tx.memo?.startsWith("[업적 마일스톤]")
    ? { label: "업적 마일스톤", emoji: "🎁" }
    : SOURCE_LABELS[tx.sourceType] || {
        label: tx.sourceType,
        emoji: "·",
      };
  const isIncome = tx.amount > 0;

  const tokenColor = {
    GOLD: "text-gold",
    BV: "text-bv",
    CRYSTAL: "text-crystal",
  }[tx.valueToken];

  const tokenLabel = {
    GOLD: "골드",
    BV: "BV",
    CRYSTAL: "크리스탈",
  }[tx.valueToken];

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="bg-bg-card backdrop-blur-card border border-line rounded-card-md p-3 flex items-center gap-3"
    >
      <div className="text-xl flex-shrink-0">{source.emoji}</div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-sm font-extrabold text-text-primary truncate">
            {source.label}
          </span>
          {tx.taxAmount > 0 && (
            <span className="text-2xs text-danger font-bold">
              (세금 -{formatNumber(tx.taxAmount)})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm text-white/75 font-semibold">
          <span>{formatRelativeTime(tx.createdAt)}</span>
          {tx.memo && (
            <>
              <span>·</span>
              <span className="truncate">{tx.memo}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 text-right">
        <div
          className={cn(
            "font-display text-base leading-none",
            isIncome ? "text-success" : "text-danger",
          )}
        >
          {formatDelta(tx.amount)}
        </div>
        <div className={cn("text-2xs font-bold mt-0.5", tokenColor)}>
          {tokenLabel}
        </div>
      </div>
    </motion.div>
  );
}
