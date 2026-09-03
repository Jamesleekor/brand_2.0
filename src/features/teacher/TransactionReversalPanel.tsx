import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  EmptyState,
  LoadingSpinner,
  Modal,
  useRpcCall,
} from "@/components/shared/components";
import { supabase } from "@/lib/supabase/client";
import { teacherRpc } from "@/lib/rpc/teacher_rpc";
import { formatNumber, formatRelativeTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

const REVERSIBLE_SOURCE_TYPES = [
  "TEACHER_GRANT",
  "TEACHER_DEDUCT",
  "BV_REVOKE",
  "CORRECTION",
  "P2P_SEND",
  "EXCHANGE_PAY",
  "DONATION",
] as const;

type ReversibleSourceType = (typeof REVERSIBLE_SOURCE_TYPES)[number];

interface ReversibleTransaction {
  id: number;
  studentId: number;
  studentName: string;
  brandName: string | null;
  valueToken: "GOLD" | "BV" | "CRYSTAL";
  amount: number;
  sourceType: ReversibleSourceType;
  sourceId: number | null;
  memo: string | null;
  createdAt: string;
}

const EVENT_LABELS: Record<
  ReversibleSourceType,
  { label: string; emoji: string; description: string }
> = {
  TEACHER_GRANT: {
    label: "교사 지급",
    emoji: "➕",
    description: "지급한 자산을 다시 회수합니다.",
  },
  TEACHER_DEDUCT: {
    label: "교사 GOLD 차감",
    emoji: "➖",
    description: "차감한 GOLD를 학생에게 돌려줍니다.",
  },
  BV_REVOKE: {
    label: "교사 BV 차감",
    emoji: "⭐",
    description: "회수한 BV를 학생에게 돌려줍니다.",
  },
  CORRECTION: {
    label: "정정 거래",
    emoji: "🔧",
    description: "기존 정정 거래를 반대 방향으로 되돌립니다.",
  },
  P2P_SEND: {
    label: "학생 간 송금",
    emoji: "↗️",
    description: "보낸 거래와 받은 거래를 함께 취소합니다.",
  },
  EXCHANGE_PAY: {
    label: "화폐 교환",
    emoji: "🔄",
    description: "지출·수령 거래를 함께 취소합니다.",
  },
  DONATION: {
    label: "복지기금 기부",
    emoji: "💚",
    description: "학생에게 환급하고 복지기금 원장도 되돌립니다.",
  },
};

export function TransactionReversalPanel({
  classroomId,
}: {
  classroomId: number | null;
}) {
  const queryClient = useQueryClient();
  const { call, isLoading: isReversing } = useRpcCall();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReversibleTransaction | null>(null);
  const [reason, setReason] = useState("");

  const {
    data: transactions = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery<ReversibleTransaction[]>({
    queryKey: ["reversible-economic-transactions", classroomId],
    queryFn: async () => {
      if (!classroomId) return [];

      const { data, error } = await supabase
        .from("transactions")
        .select(
          `
          id,
          student_id,
          value_token,
          amount,
          source_type,
          source_id,
          memo,
          created_at,
          student:students!transactions_student_id_fkey(name, brand_name)
        `,
        )
        .eq("classroom_id", classroomId)
        .eq("is_reversed", false)
        .in("source_type", [...REVERSIBLE_SOURCE_TYPES])
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      return (data ?? [])
        .filter((row: any) => {
          const pairedOrFundEvent = [
            "P2P_SEND",
            "EXCHANGE_PAY",
            "DONATION",
          ].includes(row.source_type);
          return !pairedOrFundEvent || row.source_id != null;
        })
        .map((row: any) => {
          const student = Array.isArray(row.student)
            ? row.student[0]
            : row.student;
          return {
            id: Number(row.id),
            studentId: Number(row.student_id),
            studentName: student?.name ?? `학생 #${row.student_id}`,
            brandName: student?.brand_name ?? null,
            valueToken: row.value_token,
            amount: Number(row.amount),
            sourceType: row.source_type,
            sourceId: row.source_id == null ? null : Number(row.source_id),
            memo: row.memo,
            createdAt: row.created_at,
          } as ReversibleTransaction;
        });
    },
    enabled: classroomId !== null,
  });

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return transactions;

    return transactions.filter((transaction) => {
      const event = EVENT_LABELS[transaction.sourceType];
      return (
        transaction.studentName.toLowerCase().includes(keyword) ||
        (transaction.brandName ?? "").toLowerCase().includes(keyword) ||
        (transaction.memo ?? "").toLowerCase().includes(keyword) ||
        event.label.toLowerCase().includes(keyword) ||
        transaction.id.toString().includes(keyword)
      );
    });
  }, [search, transactions]);

  const openReversal = (transaction: ReversibleTransaction) => {
    setSelected(transaction);
    setReason("");
  };

  const closeReversal = () => {
    if (isReversing) return;
    setSelected(null);
    setReason("");
  };

  const reverse = async () => {
    if (!selected || reason.trim().length < 2 || reason.trim().length > 200)
      return;

    const result = await call(
      () =>
        teacherRpc.reverseEconomicEvent(supabase, {
          p_transaction_id: selected.id,
          p_reason: reason.trim(),
        }),
      {
        successTitle: "거래 취소가 완료됐어요",
        successDescription: EVENT_LABELS[selected.sourceType].description,
      },
    );

    if (result === null) return;

    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["reversible-economic-transactions", classroomId],
      }),
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard"] }),
      queryClient.invalidateQueries({
        queryKey: ["teacher-asset-students", classroomId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["welfare-fund", classroomId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["student-welfare-fund", classroomId],
      }),
      queryClient.invalidateQueries({ queryKey: ["wallet"] }),
      queryClient.invalidateQueries({ queryKey: ["transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["profile-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["financial-lifetime-summary"] }),
    ]);

    closeReversal();
  };

  return (
    <section className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg overflow-hidden">
      <div className="p-4 border-b border-line flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">↩️</span>
            <h2 className="font-display text-lg text-text-primary">
              거래 취소·정정
            </h2>
          </div>
          <p className="text-xs text-text-muted font-bold mt-1 break-keep">
            최근 경제 거래를 안전하게 원복합니다. 금액을 고쳐야 한다면 취소 후
            위 지급·차감 패널에서 정확한 금액을 다시 처리하세요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn-secondary flex-shrink-0"
        >
          {isFetching ? "새로고침 중..." : "새로고침"}
        </button>
      </div>

      <div className="p-4">
        <div className="bg-warning-bg border border-warning/30 rounded-card-md p-3 mb-4 text-xs font-bold text-warning break-keep">
          ⚠️ 송금은 양쪽 거래가 함께 취소되고, 화폐 교환도 지출·수령이 함께
          취소됩니다. 상대 학생이 받은 자산을 이미 사용했다면 안전을 위해 전체
          취소가 거부됩니다.
        </div>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="login-input mb-3"
          placeholder="학생·브랜드명·사유·거래 번호 검색"
        />

        {isLoading ? (
          <div className="py-12 flex justify-center">
            <LoadingSpinner size="lg" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            emoji="🧾"
            title="취소 가능한 최근 거래가 없어요"
            description="교사 지급·차감, 송금, 교환, 기부 거래가 여기에 표시됩니다"
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 max-h-[34rem] overflow-y-auto pr-1">
            {filtered.map((transaction) => {
              const event = EVENT_LABELS[transaction.sourceType];
              const displayName =
                transaction.brandName || transaction.studentName;
              return (
                <motion.button
                  key={transaction.id}
                  whileTap={{ scale: 0.99 }}
                  type="button"
                  onClick={() => openReversal(transaction)}
                  className="w-full bg-bg-deep border border-line rounded-card-md p-3 text-left hover:border-danger/40 transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-card-md bg-bg-card border border-line flex items-center justify-center text-lg flex-shrink-0">
                      {event.emoji}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-black text-text-primary truncate">
                            {event.label} · {displayName}
                          </div>
                          <div className="text-2xs text-text-muted font-bold truncate">
                            {transaction.studentName}
                            {transaction.brandName
                              ? ` · ${transaction.brandName}`
                              : ""}
                          </div>
                        </div>
                        <div
                          className={cn(
                            "font-display text-sm flex-shrink-0",
                            transaction.amount >= 0
                              ? "text-success"
                              : "text-danger",
                          )}
                        >
                          {transaction.amount >= 0 ? "+" : ""}
                          {formatNumber(transaction.amount)}{" "}
                          {transaction.valueToken}
                        </div>
                      </div>
                      <div className="text-xs text-text-secondary mt-2 line-clamp-2 break-words">
                        {transaction.memo || "사유 없음"}
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-2 text-[10px] text-text-muted font-bold">
                        <span>거래 #{transaction.id}</span>
                        <span>{formatRelativeTime(transaction.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <Modal
          isOpen
          onClose={closeReversal}
          title="거래 취소 확인"
          emoji="↩️"
          size="md"
        >
          <div className="space-y-4">
            <div className="bg-bg-deep border border-line rounded-card-md divide-y divide-line">
              <SummaryRow
                label="유형"
                value={EVENT_LABELS[selected.sourceType].label}
              />
              <SummaryRow
                label="학생"
                value={`${selected.studentName}${selected.brandName ? ` · ${selected.brandName}` : ""}`}
              />
              <SummaryRow
                label="원본 금액"
                value={`${selected.amount >= 0 ? "+" : ""}${formatNumber(selected.amount)} ${selected.valueToken}`}
              />
              <SummaryRow label="거래 번호" value={`#${selected.id}`} />
              <SummaryRow
                label="원본 사유"
                value={selected.memo || "사유 없음"}
              />
            </div>

            <div className="bg-danger-bg border border-danger/30 rounded-card-md p-3 text-xs font-bold text-danger break-keep">
              {EVENT_LABELS[selected.sourceType].description} 취소 거래는 원본과
              연결되어 감사 기록에 남습니다.
            </div>

            <div>
              <label className="block text-xs font-bold text-text-secondary mb-1.5">
                취소·정정 사유 <span className="text-danger">필수</span>
              </label>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={200}
                rows={3}
                className="w-full px-3 py-2.5 bg-bg-deep border border-line-strong rounded-card-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-danger resize-none"
                placeholder="예: 지급 대상 학생을 잘못 선택함"
              />
              <div className="flex justify-between mt-1 text-2xs font-bold">
                <span
                  className={
                    reason.trim().length > 0 && reason.trim().length < 2
                      ? "text-danger"
                      : "text-text-muted"
                  }
                >
                  2자 이상 입력
                </span>
                <span className="text-text-muted">
                  {reason.trim().length}/200자
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={closeReversal}
                disabled={isReversing}
                className="btn-secondary flex-1"
              >
                돌아가기
              </button>
              <button
                onClick={reverse}
                disabled={
                  isReversing ||
                  reason.trim().length < 2 ||
                  reason.trim().length > 200
                }
                className="flex-1 py-2.5 px-4 rounded-card-md bg-danger text-white font-black disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isReversing ? "취소 처리 중..." : "거래 취소 확정"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5">
      <span className="text-xs font-bold text-text-muted flex-shrink-0">
        {label}
      </span>
      <span className="text-xs font-extrabold text-text-primary text-right break-words">
        {value}
      </span>
    </div>
  );
}
