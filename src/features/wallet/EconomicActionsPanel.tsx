import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Modal,
  LoadingSpinner,
  useRpcCall,
} from "@/components/shared/components";
import type { Wallet } from "@/hooks/useWallet";
import { supabase } from "@/lib/supabase/client";
import { studentRpc } from "@/lib/rpc/student_rpc";
import { savingsRpc, type P2PTransferQuote } from "@/lib/rpc/savings_rpc";
import {
  useClassroomId,
  useCurrentStudent,
  useStudentId,
} from "@/stores/auth_store";
import { formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { useActiveEmergencies } from "@/hooks/useActiveEmergencies";
import { useToastStore } from "@/stores/ui_store";

interface EconomicActionsPanelProps {
  wallet: Wallet | null | undefined;
  isLoading: boolean;
}

interface Classmate {
  id: number;
  name: string;
  brandName: string | null;
  tier: string | null;
}

type ActionModal = "TRANSFER" | "EXCHANGE" | "DONATION" | null;

export function EconomicActionsPanel({
  wallet,
  isLoading,
}: EconomicActionsPanelProps) {
  const [activeModal, setActiveModal] = useState<ActionModal>(null);
  const navigate = useNavigate();
  const { assetFreeze } = useActiveEmergencies();
  const showToast = useToastStore((state) => state.show);

  useEffect(() => {
    if (!assetFreeze || !activeModal) return;
    setActiveModal(null);
    showToast({ variant: "warning", title: "자산 동결 비상사태", description: "자산 사용 및 이동이 제한되어 열려 있던 경제 활동 창을 닫았습니다." });
  }, [assetFreeze?.id, activeModal, showToast]);

  return (
    <div className="mb-5">
      <div className="flex items-end justify-between mb-2.5">
        <div>
          <h2 className="font-display text-base text-text-primary tracking-tight">
            경제 활동
          </h2>
          <p className="text-sm text-white/75 font-bold mt-1">
            송금·화폐 교환·복지기금 기부·예금
          </p>
        </div>
      </div>

      {assetFreeze && (
        <div className="mb-3 bg-danger-bg border border-danger/40 rounded-card-md p-3">
          <div className="text-sm font-black text-danger">🧊 자산 동결 발령 중</div>
          <div className="text-xs text-text-secondary mt-1">송금 · 교환 · 기부 등 자산 사용과 이동이 비상사태 종료까지 제한됩니다.</div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ActionCard
          emoji="↗️"
          label="송금"
          description="친구에게 GOLD"
          disabled={isLoading || !wallet || !!assetFreeze}
          onClick={() => setActiveModal("TRANSFER")}
        />
        <ActionCard
          emoji="🔄"
          label="교환"
          description="GOLD ↔ CRYSTAL"
          disabled={isLoading || !wallet || !!assetFreeze}
          onClick={() => setActiveModal("EXCHANGE")}
        />
        <ActionCard
          emoji="💚"
          label="기부"
          description="복지기금에 GOLD"
          disabled={isLoading || !wallet || !!assetFreeze}
          onClick={() => setActiveModal("DONATION")}
        />
        <ActionCard
          emoji="🏦"
          label="예금"
          description="기간별 정기예금"
          disabled={isLoading || !wallet}
          onClick={() => navigate("/bank")}
        />
      </div>

      {activeModal === "TRANSFER" && wallet && (
        <TransferModal wallet={wallet} onClose={() => setActiveModal(null)} />
      )}
      {activeModal === "EXCHANGE" && wallet && (
        <ExchangeModal wallet={wallet} onClose={() => setActiveModal(null)} />
      )}
      {activeModal === "DONATION" && wallet && (
        <DonationModal wallet={wallet} onClose={() => setActiveModal(null)} />
      )}
    </div>
  );
}

function ActionCard({
  emoji,
  label,
  description,
  disabled,
  onClick,
}: {
  emoji: string;
  label: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.96 }}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "bg-bg-card backdrop-blur-card border border-line rounded-card-md px-2 py-3 text-center transition-all",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:border-brand-primary/50 hover-lift",
      )}
    >
      <div className="text-xl mb-1">{emoji}</div>
      <div className="text-base font-black text-white">{label}</div>
      <div className="text-sm leading-tight text-white/75 font-bold mt-1 break-keep">
        {description}
      </div>
    </motion.button>
  );
}

function TransferModal({
  wallet,
  onClose,
}: {
  wallet: Wallet;
  onClose: () => void;
}) {
  const studentId = useStudentId();
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [search, setSearch] = useState("");
  const [receiverId, setReceiverId] = useState<number | null>(null);
  const [amount, setAmount] = useState(100);
  const [memo, setMemo] = useState("");
  const [confirming, setConfirming] = useState(false);

  const transferQuote = useQuery<P2PTransferQuote>({
    queryKey: ["s4-p2p-transfer-quote", studentId, amount],
    enabled: Boolean(studentId && Number.isInteger(amount) && amount > 0 && amount <= 1_000_000),
    queryFn: async () => {
      const result = await savingsRpc.getP2PQuote(supabase, { p_amount: amount });
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 5_000,
  });

  const { data: classmates = [], isLoading: classmatesLoading } = useQuery<
    Classmate[]
  >({
    queryKey: ["economic-classmates", classroomId, studentId],
    queryFn: async () => {
      if (!classroomId || !studentId) return [];
      const { data, error } = await supabase
        .from("students")
        .select("id, name, brand_name, cached_tier")
        .eq("classroom_id", classroomId)
        .in("role", ["STUDENT", "STUDENT_LEADER", "GUARD"])
        .is("transferred_at", null)
        .neq("id", studentId)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((student) => ({
        id: student.id,
        name: student.name,
        brandName: student.brand_name,
        tier: student.cached_tier,
      }));
    },
    enabled: classroomId !== null && studentId !== null,
  });

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return classmates;
    return classmates.filter(
      (student) =>
        student.name.toLowerCase().includes(keyword) ||
        (student.brandName ?? "").toLowerCase().includes(keyword) ||
        (student.tier ?? "").toLowerCase().includes(keyword),
    );
  }, [classmates, search]);

  const receiver =
    classmates.find((student) => student.id === receiverId) ?? null;
  const isValid = Boolean(
    studentId &&
    receiver &&
    Number.isInteger(amount) &&
    amount > 0 &&
    amount <= 1_000_000 &&
    transferQuote.data?.can_afford &&
    memo.trim().length >= 2 &&
    memo.trim().length <= 200,
  );

  const submit = async () => {
    if (!studentId || !receiver || !isValid) return;
    const result = await call(
      () =>
        studentRpc.transferP2P(supabase, {
          p_sender_id: studentId,
          p_receiver_id: receiver.id,
          p_amount: amount,
          p_tag: "일반송금",
          p_description: memo.trim(),
          p_quantity: 1,
        }),
      {
        successTitle: "송금이 완료됐어요",
        successDescription: `${receiver.brandName || receiver.name}에게 ${formatNumber(amount)} GOLD를 보냈습니다. 수수료 ${formatNumber(transferQuote.data?.fee_gold ?? 0)} GOLD가 추가 차감되었습니다.`,
      },
    );
    if (result === null) return;

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["wallet", studentId] }),
      queryClient.invalidateQueries({ queryKey: ["transactions", studentId] }),
      queryClient.invalidateQueries({
        queryKey: ["profile-detail", studentId],
      }),
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard"] }),
    ]);
    onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title="친구에게 송금" emoji="↗️" size="md">
      {confirming && receiver ? (
        <ConfirmationView
          title={`${receiver.brandName || receiver.name}에게 송금`}
          rows={[
            [
              "받는 학생",
              `${receiver.name}${receiver.brandName ? ` · ${receiver.brandName}` : ""}`,
            ],
            ["받는 금액", `${formatNumber(amount)} GOLD`],
            ["송금 수수료", `${formatNumber(transferQuote.data?.fee_gold ?? 0)} GOLD (${((transferQuote.data?.effective_fee_rate ?? 0) * 100).toFixed(1)}%)`],
            ["총 차감", `${formatNumber(transferQuote.data?.sender_total_debit ?? amount)} GOLD`],
            ["송금 후 잔액", `${formatNumber(wallet.gold - (transferQuote.data?.sender_total_debit ?? amount))} GOLD`],
            ["컬렉션 감면", `-${Number(transferQuote.data?.buff_reduction_pp ?? 0).toFixed(1)}%p`],
            ["메모", memo.trim()],
          ]}
          warning="송금 후에는 학생이 직접 취소할 수 없습니다. 잘못 보냈다면 선생님께 알려야 합니다."
          isLoading={isLoading}
          onBack={() => setConfirming(false)}
          onConfirm={submit}
          confirmLabel="송금 확정"
        />
      ) : (
        <div className="space-y-4">
          <BalanceNotice label="현재 GOLD" value={wallet.gold} />

          <div>
            <label className="block text-xs font-bold text-text-secondary mb-1.5">
              받는 학생
            </label>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="login-input mb-2"
              placeholder="실명·브랜드명·티어 검색"
            />
            <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
              {classmatesLoading ? (
                <div className="py-8 flex justify-center">
                  <LoadingSpinner />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-6 text-xs text-text-muted">
                  검색 결과가 없어요
                </div>
              ) : (
                filtered.map((student) => (
                  <button
                    key={student.id}
                    onClick={() => setReceiverId(student.id)}
                    className={cn(
                      "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-card-md border text-left transition-all",
                      receiverId === student.id
                        ? "border-brand-primary bg-brand-primary/15"
                        : "border-line bg-bg-deep hover:border-line-strong",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold text-text-primary truncate">
                        {student.brandName || student.name}
                      </div>
                      <div className="text-2xs text-text-muted font-bold truncate">
                        {student.name}
                        {student.tier ? ` · ${student.tier}` : ""}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "w-5 h-5 rounded-full border flex items-center justify-center text-[10px]",
                        receiverId === student.id
                          ? "border-brand-primary bg-brand-primary text-white"
                          : "border-line-strong",
                      )}
                    >
                      {receiverId === student.id ? "✓" : ""}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <AmountInput
            label="송금 금액"
            amount={amount}
            max={Math.min(wallet.gold, 1_000_000)}
            onChange={setAmount}
            quickAmounts={[100, 500, 1000]}
          />

          <div>
            <label className="block text-xs font-bold text-text-secondary mb-1.5">
              송금 메모 <span className="text-danger">필수</span>
            </label>
            <textarea
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              className="w-full px-3 py-2.5 bg-bg-deep border border-line-strong rounded-card-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary resize-none"
              rows={2}
              maxLength={200}
              placeholder="예: 준비물 대신 구매해준 금액"
            />
            <div className="text-right text-2xs text-text-muted mt-1">
              {memo.trim().length}/200자
            </div>
          </div>

          {transferQuote.isLoading ? (
            <div className="rounded-card-md border border-line bg-bg-deep p-3 text-xs font-bold text-text-secondary">수수료를 계산하는 중...</div>
          ) : transferQuote.data ? (
            <div className="rounded-card-md border border-gold/25 bg-gold/5 p-3 text-xs font-bold text-text-secondary">
              <div className="flex items-center justify-between"><span>받는 학생 수령</span><b className="text-white">{formatNumber(transferQuote.data.receiver_credit)} GOLD</b></div>
              <div className="mt-1 flex items-center justify-between"><span>수수료 · 복지기금 귀속</span><b className="text-warning">+{formatNumber(transferQuote.data.fee_gold)} GOLD</b></div>
              <div className="mt-1 flex items-center justify-between border-t border-line pt-1"><span>내 총 차감</span><b className="text-gold">{formatNumber(transferQuote.data.sender_total_debit)} GOLD</b></div>
              {transferQuote.data.buff_reduction_pp > 0 && <div className="mt-1 text-[10px] font-black text-success">컬렉션 효과로 수수료 -{Number(transferQuote.data.buff_reduction_pp).toFixed(1)}%p 적용</div>}
              {!transferQuote.data.can_afford && <div className="mt-2 text-xs font-black text-danger">수수료까지 포함하면 GOLD가 부족합니다.</div>}
            </div>
          ) : transferQuote.isError ? (
            <InlineWarning>송금 수수료 견적을 불러오지 못했습니다.</InlineWarning>
          ) : null}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="btn-secondary flex-1">
              취소
            </button>
            <button
              onClick={() => setConfirming(true)}
              disabled={!isValid}
              className="btn-primary flex-1"
            >
              내용 확인
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ExchangeModal({
  wallet,
  onClose,
}: {
  wallet: Wallet;
  onClose: () => void;
}) {
  const studentId = useStudentId();
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [fromToken, setFromToken] = useState<"GOLD" | "CRYSTAL">("GOLD");
  const [amount, setAmount] = useState(2);
  const [confirming, setConfirming] = useState(false);

  const { data: ratio = 2, isLoading: ratioLoading } = useQuery<number>({
    queryKey: ["currency-exchange-ratio", classroomId],
    queryFn: async () => {
      if (!classroomId) return 2;
      const { data, error } = await supabase
        .from("classroom_settings")
        .select("setting_value")
        .eq("classroom_id", classroomId)
        .eq("setting_key", "currency_exchange_ratio")
        .maybeSingle();
      if (error) throw error;
      const raw = data?.setting_value;
      const parsed = Number(
        typeof raw === "string" ? raw.replace(/"/g, "") : raw,
      );
      return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
    },
    enabled: classroomId !== null,
  });

  const available = fromToken === "GOLD" ? wallet.gold : wallet.crystal;
  const toToken = fromToken === "GOLD" ? "CRYSTAL" : "GOLD";
  const received = ratio > 0 && amount > 0 ? Math.floor(amount / ratio) : 0;
  const isValid = Boolean(
    studentId &&
    Number.isInteger(amount) &&
    amount > 0 &&
    amount <= available &&
    amount <= 1_000_000 &&
    ratio > 0 &&
    amount % ratio === 0,
  );

  const changeDirection = (token: "GOLD" | "CRYSTAL") => {
    setFromToken(token);
    setAmount(ratio);
    setConfirming(false);
  };

  const submit = async () => {
    if (!studentId || !isValid) return;
    const result = await call(
      () =>
        studentRpc.exchangeToken(supabase, {
          p_student_id: studentId,
          p_from_token: fromToken,
          p_from_amount: amount,
        }),
      {
        successTitle: "화폐 교환이 완료됐어요",
        successDescription: `${formatNumber(amount)} ${fromToken} → ${formatNumber(received)} ${toToken}`,
      },
    );
    if (result === null) return;

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["wallet", studentId] }),
      queryClient.invalidateQueries({ queryKey: ["transactions", studentId] }),
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard"] }),
    ]);
    onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title="화폐 교환" emoji="🔄" size="md">
      {confirming ? (
        <ConfirmationView
          title="화폐 교환 확인"
          rows={[
            ["사용", `${formatNumber(amount)} ${fromToken}`],
            ["수령", `${formatNumber(received)} ${toToken}`],
            ["교환 비율", `${ratio}개 사용 → 1개 수령`],
            [
              "교환 후 보유",
              `${formatNumber(available - amount)} ${fromToken}`,
            ],
          ]}
          warning="교환은 양방향 모두 같은 비율이 적용됩니다. 다시 반대로 교환하면 원래 수량보다 줄어들 수 있습니다."
          isLoading={isLoading}
          onBack={() => setConfirming(false)}
          onConfirm={submit}
          confirmLabel="교환 확정"
        />
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-text-secondary mb-2">
              사용할 화폐
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["GOLD", "CRYSTAL"] as const).map((token) => (
                <button
                  key={token}
                  onClick={() => changeDirection(token)}
                  className={cn(
                    "p-3 rounded-card-md border text-left transition-all",
                    fromToken === token
                      ? "bg-brand-primary/15 border-brand-primary/60"
                      : "bg-bg-deep border-line",
                  )}
                >
                  <div className="text-sm font-black text-text-primary">
                    {token === "GOLD" ? "🪙 GOLD" : "💎 CRYSTAL"}
                  </div>
                  <div className="text-2xs text-text-muted font-bold mt-1">
                    보유{" "}
                    {formatNumber(
                      token === "GOLD" ? wallet.gold : wallet.crystal,
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-bv/10 border border-bv/30 rounded-card-md p-3">
            {ratioLoading ? (
              <LoadingSpinner size="sm" />
            ) : (
              <div className="text-xs font-bold text-text-secondary">
                현재 비율:{" "}
                <span className="text-bv">
                  {ratio} {fromToken}
                </span>{" "}
                사용 → <span className="text-success">1 {toToken}</span> 수령
              </div>
            )}
          </div>

          <AmountInput
            label={`사용할 ${fromToken}`}
            amount={amount}
            max={available}
            onChange={setAmount}
            quickAmounts={[ratio, ratio * 5, ratio * 10]}
            step={ratio}
          />

          <div className="bg-bg-deep border border-line rounded-card-md p-3 flex items-center justify-between">
            <span className="text-xs font-bold text-text-secondary">
              받게 되는 화폐
            </span>
            <span className="font-display text-lg text-success">
              {formatNumber(received)} {toToken}
            </span>
          </div>

          {amount % ratio !== 0 && (
            <InlineWarning>
              교환 금액은 {ratio}의 배수여야 합니다.
            </InlineWarning>
          )}
          {amount > available && (
            <InlineWarning>
              보유한 {fromToken}보다 큰 금액은 교환할 수 없습니다.
            </InlineWarning>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="btn-secondary flex-1">
              취소
            </button>
            <button
              onClick={() => setConfirming(true)}
              disabled={!isValid || ratioLoading}
              className="btn-primary flex-1"
            >
              내용 확인
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DonationModal({
  wallet,
  onClose,
}: {
  wallet: Wallet;
  onClose: () => void;
}) {
  const studentId = useStudentId();
  const classroomId = useClassroomId();
  const student = useCurrentStudent();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [amount, setAmount] = useState(100);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);

  const { data: currentFund = 0 } = useQuery<number>({
    queryKey: ["student-welfare-fund", classroomId],
    queryFn: async () => {
      if (!classroomId) return 0;
      const { data, error } = await supabase
        .from("welfare_funds")
        .select("current_balance")
        .eq("classroom_id", classroomId)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.current_balance ?? 0);
    },
    enabled: classroomId !== null,
  });

  const isValid = Boolean(
    studentId &&
    Number.isInteger(amount) &&
    amount > 0 &&
    amount <= wallet.gold &&
    amount <= 1_000_000 &&
    message.trim().length <= 200,
  );

  const submit = async () => {
    if (!studentId || !isValid) return;
    const result = await call(
      () =>
        studentRpc.donateToWelfare(supabase, {
          p_student_id: studentId,
          p_amount: amount,
          p_message: message.trim() || undefined,
        }),
      {
        successTitle: "복지기금 기부가 완료됐어요",
        successDescription: `${formatNumber(amount)} GOLD를 기부했습니다.`,
      },
    );
    if (result === null) return;

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["wallet", studentId] }),
      queryClient.invalidateQueries({ queryKey: ["transactions", studentId] }),
      queryClient.invalidateQueries({
        queryKey: ["student-welfare-fund", classroomId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["welfare-fund", classroomId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["profile-detail", studentId],
      }),
      queryClient.invalidateQueries({ queryKey: ["teacher-dashboard"] }),
    ]);
    onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title="복지기금 기부" emoji="💚" size="md">
      {confirming ? (
        <ConfirmationView
          title="기부 내용 확인"
          rows={[
            ["기부자", student?.brandName || student?.studentName || "나"],
            ["기부 금액", `${formatNumber(amount)} GOLD`],
            ["기부 후 잔액", `${formatNumber(wallet.gold - amount)} GOLD`],
            ["기부 후 예상 기금", `${formatNumber(currentFund + amount)} GOLD`],
            ["메시지", message.trim() || "메시지 없음"],
          ]}
          warning="기부금은 학급 복지기금으로 이동합니다. 학생이 직접 취소할 수 없습니다."
          isLoading={isLoading}
          onBack={() => setConfirming(false)}
          onConfirm={submit}
          confirmLabel="기부 확정"
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <BalanceNotice label="현재 GOLD" value={wallet.gold} />
            <BalanceNotice
              label="현재 복지기금"
              value={currentFund}
              accent="success"
            />
          </div>

          <AmountInput
            label="기부 금액"
            amount={amount}
            max={wallet.gold}
            onChange={setAmount}
            quickAmounts={[100, 500, 1000]}
          />

          <div>
            <label className="block text-xs font-bold text-text-secondary mb-1.5">
              기부 메시지 <span className="text-text-muted">선택</span>
            </label>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="w-full px-3 py-2.5 bg-bg-deep border border-line-strong rounded-card-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary resize-none"
              rows={2}
              maxLength={200}
              placeholder="예: 필요한 친구들에게 도움이 되길 바랍니다"
            />
            <div className="text-right text-2xs text-text-muted mt-1">
              {message.trim().length}/200자
            </div>
          </div>

          {amount > wallet.gold && (
            <InlineWarning>
              현재 GOLD보다 큰 금액은 기부할 수 없습니다.
            </InlineWarning>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="btn-secondary flex-1">
              취소
            </button>
            <button
              onClick={() => setConfirming(true)}
              disabled={!isValid}
              className="btn-primary flex-1"
            >
              내용 확인
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function BalanceNotice({
  label,
  value,
  accent = "gold",
}: {
  label: string;
  value: number;
  accent?: "gold" | "success";
}) {
  return (
    <div
      className={cn(
        "border rounded-card-md p-3",
        accent === "success"
          ? "bg-success-bg border-success/30"
          : "bg-gold/10 border-gold/30",
      )}
    >
      <div className="text-2xs font-black uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <div
        className={cn(
          "font-display text-xl mt-1",
          accent === "success" ? "text-success" : "text-gold",
        )}
      >
        {formatNumber(value)}
      </div>
    </div>
  );
}

function AmountInput({
  label,
  amount,
  max,
  onChange,
  quickAmounts,
  step = 1,
}: {
  label: string;
  amount: number;
  max: number;
  onChange: (amount: number) => void;
  quickAmounts: number[];
  step?: number;
}) {
  return (
    <div>
      <label className="block text-xs font-bold text-text-secondary mb-1.5">
        {label}
      </label>
      <input
        type="number"
        value={amount}
        min={step}
        max={Math.max(max, step)}
        step={step}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="login-input"
      />
      <div className="flex flex-wrap gap-1.5 mt-2">
        {quickAmounts.map((quick) => (
          <button
            key={quick}
            type="button"
            onClick={() => onChange(quick)}
            className="px-2.5 py-1.5 rounded-pill bg-bg-deep border border-line text-2xs font-black text-text-secondary hover:text-text-primary"
          >
            {formatNumber(quick)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(max)}
          className="px-2.5 py-1.5 rounded-pill bg-bg-deep border border-line text-2xs font-black text-text-secondary hover:text-text-primary"
        >
          전액
        </button>
      </div>
    </div>
  );
}

function ConfirmationView({
  title,
  rows,
  warning,
  isLoading,
  onBack,
  onConfirm,
  confirmLabel,
}: {
  title: string;
  rows: Array<[string, string]>;
  warning: string;
  isLoading: boolean;
  onBack: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-3xl mb-2">🔎</div>
        <h3 className="font-display text-base text-text-primary">{title}</h3>
      </div>

      <div className="bg-bg-deep border border-line rounded-card-md divide-y divide-line">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-start justify-between gap-4 px-3 py-2.5"
          >
            <span className="text-xs font-bold text-text-muted flex-shrink-0">
              {label}
            </span>
            <span className="text-xs font-extrabold text-text-primary text-right break-words">
              {value}
            </span>
          </div>
        ))}
      </div>

      <InlineWarning>{warning}</InlineWarning>

      <div className="flex gap-2">
        <button
          onClick={onBack}
          disabled={isLoading}
          className="btn-secondary flex-1"
        >
          수정
        </button>
        <button
          onClick={onConfirm}
          disabled={isLoading}
          className="btn-primary flex-1"
        >
          {isLoading ? "처리 중..." : confirmLabel}
        </button>
      </div>
    </div>
  );
}

function InlineWarning({ children }: { children: ReactNode }) {
  return (
    <div className="bg-warning-bg border border-warning/30 rounded-card-md px-3 py-2.5 text-xs font-bold text-warning break-keep">
      ⚠️ {children}
    </div>
  );
}
