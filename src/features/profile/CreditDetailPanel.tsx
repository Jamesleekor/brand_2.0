import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Modal, LoadingSpinner } from "@/components/shared/components";
import { supabase } from "@/lib/supabase/client";
import { useStudentId } from "@/stores/auth_store";
import { formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

type CreditGrade = "S" | "A+" | "A" | "B+" | "B" | "C" | "D";
type ComponentKey = "income" | "asset" | "quest" | "trade" | "long";

interface CreditHistoryPoint {
  as_of_date: string;
  total_score: number;
  grade: CreditGrade;
  income_creation_score: number;
  asset_capacity_score: number;
  daily_quest_reliability_score: number;
  trade_contract_trust_score: number;
  long_term_trust_score: number;
}

interface CreditDetailPayload {
  version: string;
  as_of_date: string;
  window_start: string;
  total_score: number;
  grade: CreditGrade;
  income_creation_score: number;
  asset_capacity_score: number;
  daily_quest_reliability_score: number;
  trade_contract_trust_score: number;
  long_term_trust_score: number;
  debt_burden_penalty: number;
  long_term: {
    diligence: number;
    trade_contract: number;
    donation_social: number;
    financial: number;
  };
  raw: {
    bv_gain_28d: number;
    cash_gold: number;
    active_deposit_principal: number;
    active_installment_principal: number;
    recognized_assets: number;
    raw_asset_score: number;
    active_debt: number;
    debt_to_bv_28d_ratio: number | null;
    recent_quest_eligible: number;
    recent_quest_earned_equivalent: number;
    recent_quest_ratio: number;
    recent_service_completed: number;
    recent_seller_cancelled: number;
    recent_valid_reviews: number;
    recent_avg_rating: number | null;
    recent_abnormal_findings: number;
    loan_overdue_penalty: number;
    long_quest_eligible: number;
    long_quest_earned_equivalent: number;
    lifetime_donation: number;
    legacy_finance_units: number;
    season2_finance_units: number;
  };
  quest_breakdown: {
    full_pass_count: number;
    service_half_count: number;
    missed_count: number;
  };
  history: CreditHistoryPoint[];
}

interface CreditSummaryCardProps {
  grade: string | null;
  score: number;
  onOpen: () => void;
}

interface CreditDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const COMPONENTS: Array<{
  key: ComponentKey;
  emoji: string;
  title: string;
  max: number;
  description: string;
  barClass: string;
}> = [
  {
    key: "income",
    emoji: "💼",
    title: "소득창출력",
    max: 300,
    description: "최근 28일 동안 얼마나 꾸준히 BV를 만들어냈는지 봐요.",
    barClass: "from-bv to-brand-primary",
  },
  {
    key: "asset",
    emoji: "🏦",
    title: "자산·상환여력",
    max: 250,
    description: "현재 GOLD와 예·적금, 부채 부담을 함께 봐요.",
    barClass: "from-gold to-warning",
  },
  {
    key: "quest",
    emoji: "✅",
    title: "일일퀘스트 성실도",
    max: 200,
    description: "최근 28일 동안 맡은 일일퀘스트를 얼마나 수행했는지 봐요.",
    barClass: "from-success to-bv",
  },
  {
    key: "trade",
    emoji: "🤝",
    title: "거래·계약 신뢰",
    max: 150,
    description: "100점에서 시작해 서비스 이행과 평판, 사고 기록으로 달라져요.",
    barClass: "from-brand-primary to-bv",
  },
  {
    key: "long",
    emoji: "🏅",
    title: "장기신뢰",
    max: 100,
    description: "최근 28일 이전부터 쌓아온 성실·거래·기부·금융 기록이에요.",
    barClass: "from-warning to-gold",
  },
];

function useMyCreditDetail(enabled = true) {
  const studentId = useStudentId();
  return useQuery<CreditDetailPayload>({
    queryKey: ["my-credit-detail-v2", studentId],
    enabled: enabled && studentId !== null,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("student_get_my_credit_detail");
      if (error) throw error;
      if (!data) throw new Error("신용점수 상세 정보를 찾을 수 없습니다.");
      return data as CreditDetailPayload;
    },
  });
}

function findPrevious(detail: CreditDetailPayload | undefined) {
  if (!detail) return null;
  return [...(detail.history ?? [])]
    .reverse()
    .find((point) => point.as_of_date < detail.as_of_date) ?? null;
}

function scoreStatus(score: number) {
  if (score >= 900) return "최우수 신용 상태";
  if (score >= 800) return "매우 안정적인 신용 상태";
  if (score >= 700) return "안정적인 신용 상태";
  if (score >= 600) return "양호한 신용 상태";
  if (score >= 500) return "신용을 더 키울 수 있어요";
  return "신용 관리가 필요해요";
}

export function CreditSummaryCard({ grade, score, onOpen }: CreditSummaryCardProps) {
  const detailQuery = useMyCreditDetail(true);
  const current = detailQuery.data;
  const previous = findPrevious(current);
  const liveScore = current?.total_score ?? score;
  const liveGrade = current?.grade ?? (grade as CreditGrade | null) ?? "B";
  const delta = previous ? liveScore - previous.total_score : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-3 w-full border-t border-line pt-3 text-left"
      aria-label="신용 상세 보기"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">💳</span>
            <div>
              <div className="text-xs font-extrabold text-text-secondary">신용등급</div>
              <div className="mt-0.5 text-2xs font-bold text-text-muted">{scoreStatus(liveScore)}</div>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-baseline justify-end gap-2">
            <span className="font-display text-2xl leading-none text-gold">{liveGrade}</span>
            <span className="text-xs font-black text-text-primary">{formatNumber(liveScore)} / 1,000</span>
          </div>
          <div className="mt-1 flex items-center justify-end gap-2 text-2xs font-bold">
            {delta !== null && (
              <span className={delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-text-muted"}>
                {delta > 0 ? "▲" : delta < 0 ? "▼" : "─"} {delta > 0 ? "+" : ""}{delta}
              </span>
            )}
            <span className="text-gold">신용 상세 보기 →</span>
          </div>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-pill bg-bg-deep">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(0, Math.min(100, liveScore / 10))}%` }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="h-full rounded-pill bg-gradient-to-r from-brand-primary via-bv to-gold"
        />
      </div>
    </button>
  );
}

export function CreditDetailModal({ isOpen, onClose }: CreditDetailModalProps) {
  const detailQuery = useMyCreditDetail(isOpen);
  const [expanded, setExpanded] = useState<ComponentKey | null>(null);
  const detail = detailQuery.data;
  const previous = findPrevious(detail);

  const componentDeltas = useMemo(() => {
    if (!detail || !previous) return [];
    const rows = [
      { label: "소득창출력", emoji: "💼", delta: detail.income_creation_score - previous.income_creation_score },
      { label: "자산·상환여력", emoji: "🏦", delta: detail.asset_capacity_score - previous.asset_capacity_score },
      { label: "일일퀘스트 성실도", emoji: "✅", delta: detail.daily_quest_reliability_score - previous.daily_quest_reliability_score },
      { label: "거래·계약 신뢰", emoji: "🤝", delta: detail.trade_contract_trust_score - previous.trade_contract_trust_score },
      { label: "장기신뢰", emoji: "🏅", delta: detail.long_term_trust_score - previous.long_term_trust_score },
    ];
    return rows.filter((row) => row.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [detail, previous]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="나의 신용" emoji="💳" size="lg">
      {detailQuery.isLoading && (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm font-bold text-text-secondary">신용점수를 분석하고 있어요.</p>
        </div>
      )}

      {detailQuery.isError && (
        <div className="rounded-card-md border border-danger/30 bg-danger-bg p-4 text-center">
          <div className="text-3xl">⚠️</div>
          <div className="mt-2 text-sm font-extrabold text-danger">신용 상세 정보를 불러오지 못했어요.</div>
          <div className="mt-1 text-2xs font-bold text-text-secondary">잠시 후 다시 열어주세요.</div>
        </div>
      )}

      {detail && (
        <div className="space-y-4">
          <CreditHero detail={detail} previous={previous} />

          <section>
            <div className="mb-2 flex items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-black text-text-primary">신용을 만드는 5가지 요소</h3>
                <p className="mt-0.5 text-2xs font-bold text-text-muted">각 항목을 눌러 실제 계산 근거를 확인할 수 있어요.</p>
              </div>
              <span className="text-2xs font-black text-gold">합계 {formatNumber(detail.total_score)}점</span>
            </div>

            <div className="space-y-2">
              {COMPONENTS.map((component) => {
                const value = componentValue(detail, component.key);
                const isExpanded = expanded === component.key;
                return (
                  <div key={component.key} className="overflow-hidden rounded-card-md border border-line bg-bg-deep/50">
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? null : component.key)}
                      className="w-full p-3 text-left"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="text-xl">{component.emoji}</span>
                          <div className="min-w-0">
                            <div className="text-sm font-black text-text-primary">{component.title}</div>
                            <div className="mt-0.5 text-2xs font-bold text-text-muted line-clamp-2">{component.description}</div>
                          </div>
                        </div>
                        <div className="flex-none text-right">
                          <div className="text-sm font-black text-white">{value} <span className="text-2xs text-text-muted">/ {component.max}</span></div>
                          <div className="mt-0.5 text-2xs font-black text-gold">왜 이 점수인가요? {isExpanded ? "⌃" : "⌄"}</div>
                        </div>
                      </div>
                      <div className="mt-2.5 h-2 overflow-hidden rounded-pill bg-black/25">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(0, Math.min(100, (value / component.max) * 100))}%` }}
                          transition={{ duration: 0.55, ease: "easeOut" }}
                          className={cn("h-full rounded-pill bg-gradient-to-r", component.barClass)}
                        />
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-line px-3 pb-3 pt-3">
                        <WhyThisScore type={component.key} detail={detail} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-card-md border border-line bg-bg-card p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black text-text-primary">📈 최근 신용점수 변화</h3>
                <p className="mt-0.5 text-2xs font-bold text-text-muted">매일 자동 저장되는 신용 스냅샷이에요.</p>
              </div>
              {previous && (
                <span className={cn(
                  "rounded-pill px-2 py-1 text-2xs font-black",
                  detail.total_score > previous.total_score ? "bg-success-bg text-success" :
                  detail.total_score < previous.total_score ? "bg-danger-bg text-danger" : "bg-bg-deep text-text-muted",
                )}>
                  {detail.total_score > previous.total_score ? "+" : ""}{detail.total_score - previous.total_score}
                </span>
              )}
            </div>
            <div className="mt-3">
              <CreditTrend history={detail.history} current={detail} />
            </div>
          </section>

          <section className="rounded-card-md border border-line bg-bg-card p-3.5">
            <h3 className="text-sm font-black text-text-primary">🔎 최근 변화의 이유</h3>
            {!previous ? (
              <p className="mt-2 text-xs font-bold leading-relaxed text-text-muted">비교 가능한 이전 스냅샷이 아직 없어요. 매일 기록이 쌓이면 어떤 요소가 점수를 움직였는지 보여줄게요.</p>
            ) : componentDeltas.length === 0 ? (
              <p className="mt-2 text-xs font-bold text-text-muted">이전 스냅샷과 비교해 구성점수 변화가 없어요.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {componentDeltas.slice(0, 5).map((row) => (
                  <div key={row.label} className="flex items-center justify-between rounded-card-sm bg-bg-deep px-3 py-2">
                    <span className="text-xs font-extrabold text-text-secondary">{row.emoji} {row.label}</span>
                    <span className={cn("text-xs font-black", row.delta > 0 ? "text-success" : "text-danger")}>
                      {row.delta > 0 ? "▲ +" : "▼ "}{row.delta}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-card-md border border-gold/25 bg-gradient-to-br from-gold/10 to-brand-primary/10 p-3.5">
            <h3 className="text-sm font-black text-white">💡 신용점수를 올리는 방법</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Tip emoji="💼" title="꾸준히 활동하기" text="최근 28일 동안 정상적인 활동으로 BV를 꾸준히 만들어보세요." />
              <Tip emoji="🏦" title="자산 관리하기" text="GOLD와 예·적금을 적절히 관리하고, 대출이 있다면 부담을 낮춰보세요." />
              <Tip emoji="✅" title="일일퀘스트 챙기기" text="결석한 날도 분모에 포함돼요. 필요하면 1인1역·청소 서비스를 활용할 수 있어요." />
              <Tip emoji="🤝" title="약속 지키기" text="판매한 서비스는 끝까지 정상 완료하고 좋은 거래 경험을 쌓아보세요." />
              <Tip emoji="🏅" title="오래 신뢰 쌓기" text="성실·거래·기부·금융 기록은 장기신뢰로 천천히 쌓여요." />
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}

function CreditHero({ detail, previous }: { detail: CreditDetailPayload; previous: CreditHistoryPoint | null }) {
  const delta = previous ? detail.total_score - previous.total_score : null;
  return (
    <div className="rounded-card-lg border border-gold/30 bg-gradient-to-br from-brand-primary/15 via-bg-deep to-gold/10 p-4 text-center">
      <div className="text-2xs font-black uppercase tracking-[0.2em] text-text-muted">Credit Score</div>
      <div className="mt-1 font-display text-5xl leading-none text-gold">{formatNumber(detail.total_score)}</div>
      <div className="mt-1 text-base font-black text-white">{detail.grade} 등급</div>
      <div className="mt-2 flex items-center justify-center gap-2 text-2xs font-bold">
        <span className="rounded-pill bg-bg-deep px-2 py-1 text-text-secondary">{scoreStatus(detail.total_score)}</span>
        {delta !== null && (
          <span className={cn(
            "rounded-pill px-2 py-1",
            delta > 0 ? "bg-success-bg text-success" : delta < 0 ? "bg-danger-bg text-danger" : "bg-bg-deep text-text-muted",
          )}>
            지난 기록보다 {delta > 0 ? "+" : ""}{delta}
          </span>
        )}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-pill bg-black/25">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${detail.total_score / 10}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full rounded-pill bg-gradient-to-r from-brand-primary via-bv to-gold"
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] font-bold text-text-muted">
        <span>0</span><span>S 등급 900</span><span>1,000</span>
      </div>
    </div>
  );
}

function componentValue(detail: CreditDetailPayload, key: ComponentKey) {
  if (key === "income") return detail.income_creation_score;
  if (key === "asset") return detail.asset_capacity_score;
  if (key === "quest") return detail.daily_quest_reliability_score;
  if (key === "trade") return detail.trade_contract_trust_score;
  return detail.long_term_trust_score;
}

function WhyThisScore({ type, detail }: { type: ComponentKey; detail: CreditDetailPayload }) {
  const raw = detail.raw;
  if (type === "income") {
    return (
      <DetailBlock
        title="최근 28일의 소득창출 기록"
        rows={[
          ["평가기간", `${shortDate(detail.window_start)} ~ ${shortDate(detail.as_of_date)}`],
          ["BV 증가량", `+${formatNumber(raw.bv_gain_28d)} BV`],
          ["현재 점수", `${detail.income_creation_score} / 300`],
        ]}
        note="최근 28일의 정상적인 BV 획득량을 평가해요. 많이 벌수록 점수는 올라가지만 높은 구간에서는 추가 상승폭이 점점 줄어들어요."
        improve="퀘스트·과제·길드 활동 등 정상적인 활동으로 꾸준히 BV를 얻어보세요."
      />
    );
  }

  if (type === "asset") {
    const ratio = raw.debt_to_bv_28d_ratio;
    return (
      <DetailBlock
        title="현재 인정되는 자산과 부채"
        rows={[
          ["보유 GOLD", `${formatNumber(raw.cash_gold)} GOLD`],
          ["예금 원금", `${formatNumber(raw.active_deposit_principal)} GOLD`],
          ["적금 납입 원금", `${formatNumber(raw.active_installment_principal)} GOLD`],
          ["인정 자산 합계", `${formatNumber(raw.recognized_assets)} GOLD`],
          ["자산 원점수", `${raw.raw_asset_score} / 250`],
          ["현재 대출잔액", `${formatNumber(raw.active_debt)} GOLD`],
          ["부채부담 감점", raw.active_debt > 0 ? `-${detail.debt_burden_penalty}점` : "없음"],
          ["부채 / 최근 BV", ratio === null ? "최근 BV 없음" : `${Math.round(ratio * 100)}%`],
        ]}
        note="자산은 50,000 GOLD 이상에서 만점이고, 낮은 구간에서 빠르게 올라간 뒤 점점 효용이 줄어요. 대출이 있으면 최근 BV 창출량과 비교한 부채부담을 함께 봐요."
        improve="현금만 쌓기보다 필요에 맞게 예·적금도 활용하고, 대출이 있다면 상환 부담을 낮춰보세요."
      />
    );
  }

  if (type === "quest") {
    const q = detail.quest_breakdown;
    const eligible = raw.recent_quest_eligible;
    const ratio = eligible > 0 ? raw.recent_quest_earned_equivalent / eligible : 0;
    return (
      <DetailBlock
        title="최근 28일 일일퀘스트 이행"
        rows={[
          ["수행 가능 퀘스트", `${formatNumber(eligible)}회`],
          ["완전 수행", `${formatNumber(q.full_pass_count)}회`],
          ["서비스 이용 50% 인정", `${formatNumber(q.service_half_count)}회 × 0.5`],
          ["미수행", `${formatNumber(q.missed_count)}회`],
          ["환산 완료", `${formatDecimal(raw.recent_quest_earned_equivalent)}회`],
          ["최종 인정률", `${Math.round(ratio * 1000) / 10}%`],
        ]}
        note="공휴일과 전입 전 기간은 계산에서 빠져요. 학교 운영일에 결석한 경우는 포함되며, 1인1역·청소는 해당 서비스를 정상 구매·완료하면 50% 인정받을 수 있어요."
        improve="빠뜨린 퀘스트를 줄이는 것이 가장 중요해요. 직접 수행이 어려운 날에는 가능한 서비스 제도를 활용해보세요."
      />
    );
  }

  if (type === "trade") {
    return (
      <DetailBlock
        title="최근 28일 거래·계약 기록"
        rows={[
          ["기본 신뢰점수", "100점"],
          ["정상 완료 서비스", `${formatNumber(raw.recent_service_completed)}건`],
          ["판매자 취소", `${formatNumber(raw.recent_seller_cancelled)}건`],
          ["유효 구매자 평가", `${formatNumber(raw.recent_valid_reviews)}건`],
          ["평균 평점", raw.recent_avg_rating === null ? "평가 없음" : `★ ${Number(raw.recent_avg_rating).toFixed(1)}`],
          ["이상거래 최종적발", `${formatNumber(raw.recent_abnormal_findings)}건${raw.recent_abnormal_findings > 0 ? ` · -${raw.recent_abnormal_findings * 50}점` : ""}`],
          ["대출 연체 감점", raw.loan_overdue_penalty > 0 ? `-${formatNumber(raw.loan_overdue_penalty)}점` : "없음"],
        ]}
        note="거래 경험이 없어도 100점에서 시작해요. 정상 완료율과 구매자 평점으로 최대 150점까지 올라가며, 이상거래 최종적발은 1건당 50점이 절대 감점돼요."
        improve="서비스를 판매했다면 취소하지 않고 정상 완료하고, 구매자가 만족할 수 있도록 약속한 내용을 정확히 지켜보세요."
      />
    );
  }

  return (
    <div>
      <div className="mb-2 text-xs font-black text-text-primary">오래 쌓아온 신뢰 기록</div>
      <div className="grid grid-cols-2 gap-2">
        <LongTrustTile emoji="✅" label="장기 성실" value={detail.long_term.diligence} max={30} />
        <LongTrustTile emoji="🤝" label="장기 거래" value={detail.long_term.trade_contract} max={25} />
        <LongTrustTile emoji="❤️" label="기부·사회기여" value={detail.long_term.donation_social} max={25} />
        <LongTrustTile emoji="🏦" label="장기 금융" value={detail.long_term.financial} max={20} />
      </div>
      <div className="mt-3 space-y-1.5 text-2xs font-bold text-text-secondary">
        <div className="flex justify-between"><span>누적 인정 기부</span><span className="font-black text-text-primary">{formatNumber(raw.lifetime_donation)} GOLD</span></div>
        <div className="flex justify-between"><span>1.0 금융 신뢰단위</span><span className="font-black text-text-primary">{formatNumber(raw.legacy_finance_units)}</span></div>
        <div className="flex justify-between"><span>2.0 금융 신뢰단위</span><span className="font-black text-text-primary">{formatNumber(raw.season2_finance_units)}</span></div>
      </div>
      <p className="mt-3 rounded-card-sm bg-bg-deep p-2.5 text-2xs font-bold leading-relaxed text-text-muted">
        장기신뢰가 낮다고 해서 잘못한 것은 아니에요. 아직 기록이 충분히 쌓이지 않은 경우도 있어요. 최근 28일 이전의 성실·거래·기부·금융 기록이 시간이 지나며 천천히 신뢰 자산이 됩니다.
      </p>
    </div>
  );
}

function DetailBlock({
  title,
  rows,
  note,
  improve,
}: {
  title: string;
  rows: Array<[string, string]>;
  note: string;
  improve: string;
}) {
  return (
    <div>
      <div className="text-xs font-black text-text-primary">{title}</div>
      <div className="mt-2 divide-y divide-line rounded-card-sm bg-bg-card px-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-2 text-2xs">
            <span className="font-bold text-text-secondary">{label}</span>
            <span className="text-right font-black text-text-primary">{value}</span>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-2xs font-bold leading-relaxed text-text-muted">{note}</p>
      <div className="mt-2 rounded-card-sm border border-success/20 bg-success-bg px-3 py-2 text-2xs font-bold leading-relaxed text-success">
        <span className="font-black">점수를 높이려면 · </span>{improve}
      </div>
    </div>
  );
}

function LongTrustTile({ emoji, label, value, max }: { emoji: string; label: string; value: number; max: number }) {
  return (
    <div className="rounded-card-sm bg-bg-card p-2.5">
      <div className="text-2xs font-extrabold text-text-secondary">{emoji} {label}</div>
      <div className="mt-1 text-sm font-black text-white">{value} <span className="text-2xs text-text-muted">/ {max}</span></div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-pill bg-bg-deep">
        <div className="h-full rounded-pill bg-gold" style={{ width: `${Math.max(0, Math.min(100, value / max * 100))}%` }} />
      </div>
    </div>
  );
}

function CreditTrend({ history, current }: { history: CreditHistoryPoint[]; current: CreditDetailPayload }) {
  const points = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const item of history ?? []) byDate.set(item.as_of_date, item.total_score);
    byDate.set(current.as_of_date, current.total_score);
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, score]) => ({ date, score }));
  }, [history, current.as_of_date, current.total_score]);

  if (points.length < 2) {
    return (
      <div className="flex h-28 items-center justify-center rounded-card-sm bg-bg-deep px-4 text-center text-xs font-bold leading-relaxed text-text-muted">
        오늘부터 매일 기록이 쌓여요. 비교할 수 있는 날짜가 생기면 점수 변화 그래프를 보여줄게요.
      </div>
    );
  }

  const width = 340;
  const height = 120;
  const padX = 16;
  const padY = 18;
  const scores = points.map((point) => point.score);
  const minScore = Math.max(0, Math.min(...scores) - 25);
  const maxScore = Math.min(1000, Math.max(...scores) + 25);
  const span = Math.max(1, maxScore - minScore);
  const coords = points.map((point, index) => {
    const x = padX + (index / Math.max(1, points.length - 1)) * (width - padX * 2);
    const y = padY + (1 - (point.score - minScore) / span) * (height - padY * 2);
    return { ...point, x, y };
  });
  const path = coords.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div>
      <div className="overflow-hidden rounded-card-sm bg-bg-deep p-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full" role="img" aria-label="최근 신용점수 변화 그래프">
          <line x1={padX} x2={width - padX} y1={height - padY} y2={height - padY} stroke="currentColor" className="text-line" strokeWidth="1" />
          <line x1={padX} x2={width - padX} y1={padY} y2={padY} stroke="currentColor" className="text-line" strokeWidth="1" strokeDasharray="3 4" />
          <polyline fill="none" stroke="currentColor" className="text-gold" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={path} />
          {coords.map((point, index) => (
            <g key={point.date}>
              <circle cx={point.x} cy={point.y} r={index === coords.length - 1 ? 4 : 2.5} fill="currentColor" className={index === coords.length - 1 ? "text-gold" : "text-brand-primary"} />
              {index === coords.length - 1 && (
                <text x={point.x - 4} y={Math.max(12, point.y - 9)} textAnchor="end" fontSize="10" fill="currentColor" className="text-gold font-bold">{point.score}</text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] font-bold text-text-muted">
        <span>{shortDate(points[0].date)}</span>
        <span>{points.length}일 기록</span>
        <span>{shortDate(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}

function Tip({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <div className="rounded-card-sm bg-bg-deep/70 p-2.5">
      <div className="text-xs font-black text-text-primary">{emoji} {title}</div>
      <div className="mt-1 text-2xs font-bold leading-relaxed text-text-muted">{text}</div>
    </div>
  );
}

function shortDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDecimal(value: number) {
  return Number.isInteger(value) ? formatNumber(value) : value.toFixed(1);
}
