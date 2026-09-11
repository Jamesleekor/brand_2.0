import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LoadingSpinner } from '@/components/shared/components';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import { formatNumber } from '@/lib/utils/format';
import { useClassroomId } from '@/stores/auth_store';

type PlanStatus = 'ACTIVE' | 'COMPLETED';

interface EqualizationPlan {
  id: number;
  label: string;
  status: PlanStatus;
  total_rounds: number;
  created_at: string;
  completed_at: string | null;
  can_edit_amounts: boolean;
  required_count: number;
  weekly_total: number;
  assessed_total: number;
  total_paid: number;
  outstanding_total: number;
}

interface EqualizationRound {
  round_no: number;
  levied_count: number;
  paid_count: number;
  delinquent_count: number;
  required_count: number;
  assessed_total: number;
  paid_total: number;
  outstanding_total: number;
  charged_total: number;
  charged_at: string | null;
}

interface EqualizationStudent {
  student_id: number;
  student_name: string;
  brand_name: string | null;
  current_gold: number;
  weekly_amount: number;
  assessed_total: number;
  total_paid: number;
  outstanding_total: number;
  paid_rounds: number[];
  delinquent_rounds: number[];
}

interface EqualizationArrearDetail {
  payment_id: number;
  plan_id: number;
  plan_label: string;
  round_no: number;
  assessed: number;
  paid: number;
  outstanding: number;
  status: string;
  assessed_at: string | null;
}

interface EqualizationArrearStudent {
  student_id: number;
  student_name: string;
  brand_name: string | null;
  current_gold: number;
  outstanding_total: number;
  delinquent_items: number;
  details: EqualizationArrearDetail[];
}

interface EqualizationState {
  classroom_id: number;
  plan: EqualizationPlan | null;
  rounds: EqualizationRound[];
  students: EqualizationStudent[];
  arrears_total: number;
  arrears_students: EqualizationArrearStudent[];
}

const MAX_AMOUNT = 10_000_000;
const ROUND_NUMBERS = [1, 2, 3, 4] as const;

function toNumber(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function normalizeState(raw: any): EqualizationState {
  return {
    classroom_id: toNumber(raw?.classroom_id),
    plan: raw?.plan
      ? {
          ...raw.plan,
          id: toNumber(raw.plan.id),
          total_rounds: toNumber(raw.plan.total_rounds),
          required_count: toNumber(raw.plan.required_count),
          weekly_total: toNumber(raw.plan.weekly_total),
          assessed_total: toNumber(raw.plan.assessed_total),
          total_paid: toNumber(raw.plan.total_paid),
          outstanding_total: toNumber(raw.plan.outstanding_total),
          can_edit_amounts: Boolean(raw.plan.can_edit_amounts),
        }
      : null,
    rounds: Array.isArray(raw?.rounds)
      ? raw.rounds.map((round: any) => ({
          ...round,
          round_no: toNumber(round.round_no),
          levied_count: toNumber(round.levied_count),
          paid_count: toNumber(round.paid_count),
          delinquent_count: toNumber(round.delinquent_count),
          required_count: toNumber(round.required_count),
          assessed_total: toNumber(round.assessed_total),
          paid_total: toNumber(round.paid_total),
          outstanding_total: toNumber(round.outstanding_total),
          charged_total: toNumber(round.charged_total),
          charged_at: round.charged_at ?? null,
        }))
      : [],
    students: Array.isArray(raw?.students)
      ? raw.students.map((student: any) => ({
          ...student,
          student_id: toNumber(student.student_id),
          current_gold: toNumber(student.current_gold),
          weekly_amount: toNumber(student.weekly_amount),
          assessed_total: toNumber(student.assessed_total),
          total_paid: toNumber(student.total_paid),
          outstanding_total: toNumber(student.outstanding_total),
          paid_rounds: Array.isArray(student.paid_rounds)
            ? student.paid_rounds.map((round: unknown) => toNumber(round))
            : [],
          delinquent_rounds: Array.isArray(student.delinquent_rounds)
            ? student.delinquent_rounds.map((round: unknown) => toNumber(round))
            : [],
        }))
      : [],
    arrears_total: toNumber(raw?.arrears_total),
    arrears_students: Array.isArray(raw?.arrears_students)
      ? raw.arrears_students.map((student: any) => ({
          ...student,
          student_id: toNumber(student.student_id),
          current_gold: toNumber(student.current_gold),
          outstanding_total: toNumber(student.outstanding_total),
          delinquent_items: toNumber(student.delinquent_items),
          details: Array.isArray(student.details)
            ? student.details.map((detail: any) => ({
                ...detail,
                payment_id: toNumber(detail.payment_id),
                plan_id: toNumber(detail.plan_id),
                round_no: toNumber(detail.round_no),
                assessed: toNumber(detail.assessed),
                paid: toNumber(detail.paid),
                outstanding: toNumber(detail.outstanding),
                assessed_at: detail.assessed_at ?? null,
              }))
            : [],
        }))
      : [],
  };
}

function formatDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function EqualizationContributionAdmin() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const [amountDrafts, setAmountDrafts] = useState<Record<number, string>>({});
  const [newPlanMode, setNewPlanMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [levyingRound, setLevyingRound] = useState<number | null>(null);
  const [collectingStudentId, setCollectingStudentId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const stateQuery = useQuery<EqualizationState>({
    queryKey: ['teacher-equalization-contribution', classroomId],
    queryFn: async () => {
      if (!classroomId) throw new Error('학급 정보를 확인할 수 없습니다.');
      const { data, error } = await supabase.rpc('teacher_get_equalization_contribution_state', {
        p_classroom_id: classroomId,
      });
      if (error) throw new Error(error.message);
      return normalizeState(data);
    },
    enabled: Boolean(classroomId),
    staleTime: 10_000,
  });

  const state = stateQuery.data;
  const plan = state?.plan ?? null;
  const students = state?.students ?? [];

  const serverSignature = useMemo(
    () =>
      state
        ? `${state.plan?.id ?? 'none'}:${state.plan?.status ?? 'none'}:${state.students
            .map((student) => `${student.student_id}:${student.weekly_amount}`)
            .join('|')}`
        : '',
    [state],
  );

  useEffect(() => {
    if (!state) return;
    setAmountDrafts(
      Object.fromEntries(
        state.students.map((student) => [student.student_id, String(student.weekly_amount ?? 0)]),
      ),
    );
    setNewPlanMode(false);
  }, [serverSignature]);

  const parsedAmounts = useMemo(
    () =>
      students.map((student) => {
        const raw = amountDrafts[student.student_id] ?? '0';
        const amount = Number(raw);
        return {
          studentId: student.student_id,
          amount,
          valid: Number.isInteger(amount) && amount >= 0 && amount <= MAX_AMOUNT,
        };
      }),
    [amountDrafts, students],
  );

  const amountByStudentId = useMemo(
    () => new Map(parsedAmounts.map((entry) => [entry.studentId, entry.amount])),
    [parsedAmounts],
  );

  const allAmountsValid = parsedAmounts.length > 0 && parsedAmounts.every((entry) => entry.valid);
  const positiveCount = parsedAmounts.filter((entry) => entry.valid && entry.amount > 0).length;
  const weeklyTotal = parsedAmounts.reduce(
    (sum, entry) => sum + (entry.valid && entry.amount > 0 ? entry.amount : 0),
    0,
  );

  const editingAllowed =
    newPlanMode ||
    !plan ||
    (plan.status === 'ACTIVE' && plan.can_edit_amounts);
  const activePlanReady = Boolean(plan && plan.status === 'ACTIVE' && !newPlanMode);
  const busy = saving || levyingRound !== null || collectingStudentId !== null;

  const rounds = useMemo(() => {
    const byRound = new Map((state?.rounds ?? []).map((round) => [round.round_no, round]));
    return ROUND_NUMBERS.map(
      (roundNo) =>
        byRound.get(roundNo) ?? {
          round_no: roundNo,
          levied_count: 0,
          paid_count: 0,
          delinquent_count: 0,
          required_count: plan?.required_count ?? 0,
          assessed_total: 0,
          paid_total: 0,
          outstanding_total: 0,
          charged_total: 0,
          charged_at: null,
        },
    );
  }, [plan?.required_count, state?.rounds]);

  const refreshEconomy = async () => {
    await Promise.all([
      stateQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['teacher-dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['teacher-asset-students'] }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['profile-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['rankings'] }),
      queryClient.invalidateQueries({ queryKey: ['teacher-analytics'] }),
    ]);
  };

  const handleSavePlan = async () => {
    if (!classroomId || !state || !editingAllowed || busy) return;
    setMessage(null);

    if (!allAmountsValid) {
      setMessage({ type: 'error', text: '모든 분담금은 0 이상 10,000,000 이하의 정수로 입력해주세요.' });
      return;
    }
    if (positiveCount === 0) {
      setMessage({ type: 'error', text: '분담금이 1 이상인 학생이 한 명 이상 필요합니다.' });
      return;
    }

    const modeText = newPlanMode || !plan ? '새 4주 분담금 계획을 저장' : '분담금 설정을 저장';
    if (
      !window.confirm(
        `${modeText}할까요?\n\n납부 대상 ${positiveCount}명\n회차당 총 ${formatNumber(weeklyTotal)} 골드\n총 4회차 예정`,
      )
    ) {
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('teacher_save_equalization_contribution_plan', {
        p_classroom_id: classroomId,
        p_student_ids: students.map((student) => student.student_id),
        p_weekly_amounts: students.map((student) => amountByStudentId.get(student.student_id) ?? 0),
        p_label: '균형발전 분담금',
      });
      if (error) throw new Error(error.message);

      setMessage({
        type: 'success',
        text: `설정 저장 완료 · ${positiveCount}명 · 회차당 ${formatNumber(weeklyTotal)} 골드`,
      });
      await refreshEconomy();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '분담금 설정 저장에 실패했습니다.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleLevyRound = async (roundNo: number) => {
    if (!classroomId || !plan || plan.status !== 'ACTIVE' || newPlanMode || busy) return;
    const round = rounds.find((item) => item.round_no === roundNo);
    const alreadyCharged = Boolean(round && round.levied_count > 0);
    if (alreadyCharged) return;

    const targetCount = plan.required_count;
    const total = plan.weekly_total;
    const warning =
      `${roundNo}회차 균형발전 분담금을 지금 즉시 부과할까요?\n\n` +
      `대상 ${targetCount}명 · 총 ${formatNumber(total)} 골드\n` +
      `각 학생에게 해당 회차 납부 의무가 생성되며, 현재 사용 가능한 골드만큼 즉시 징수합니다.\n` +
      `부족한 금액은 학생별 미납으로 남아 이후 다시 징수할 수 있습니다.\n\n` +
      `※ 귀속 회차는 ${roundNo}회차로 저장되며, 이미 부과한 회차는 다시 부과할 수 없습니다.`;

    if (!window.confirm(warning)) return;

    setMessage(null);
    setLevyingRound(roundNo);
    try {
      const { data, error } = await supabase.rpc('teacher_levy_equalization_contribution_round', {
        p_classroom_id: classroomId,
        p_plan_id: plan.id,
        p_round_no: roundNo,
      });
      if (error) throw new Error(error.message);

      const result = data as any;
      setMessage({
        type: 'success',
        text: `${roundNo}회차 부과 완료 · 부과 ${formatNumber(toNumber(result?.assessed_count))}명 · 즉시 납부 ${formatNumber(toNumber(result?.fully_paid_count))}명 · 미납 ${formatNumber(toNumber(result?.delinquent_count))}명 · 징수 ${formatNumber(toNumber(result?.collected_total))} 골드`,
      });
      await refreshEconomy();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : `${roundNo}회차 부과에 실패했습니다.`,
      });
    } finally {
      setLevyingRound(null);
    }
  };

  const handleCollectArrears = async (student: EqualizationArrearStudent) => {
    if (!classroomId || busy || student.outstanding_total <= 0) return;

    const warning =
      `${student.student_name} 학생의 균형발전 분담금 미납을 지금 징수할까요?\n\n` +
      `현재 미납 ${formatNumber(student.outstanding_total)} 골드 · 보유 골드 ${formatNumber(student.current_gold)} 골드\n` +
      `현재 사용 가능한 골드 범위에서 오래된 미납부터 순서대로 징수됩니다.\n` +
      `잔액이 부족하면 일부만 징수되고 나머지는 계속 미납으로 남습니다.`;

    if (!window.confirm(warning)) return;

    setMessage(null);
    setCollectingStudentId(student.student_id);
    try {
      const { data, error } = await supabase.rpc('teacher_collect_equalization_student_arrears', {
        p_classroom_id: classroomId,
        p_student_id: student.student_id,
      });
      if (error) throw new Error(error.message);

      const result = data as any;
      const collected = toNumber(result?.collected_total);
      const remaining = toNumber(result?.remaining_outstanding);
      setMessage({
        type: 'success',
        text: `${student.student_name} 미납 징수 완료 · ${formatNumber(collected)} 골드 징수 · 남은 미납 ${formatNumber(remaining)} 골드`,
      });
      await refreshEconomy();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : `${student.student_name} 학생의 미납 징수에 실패했습니다.`,
      });
    } finally {
      setCollectingStudentId(null);
    }
  };

  const startNewPlan = () => {
    if (!state || busy) return;
    setNewPlanMode(true);
    setMessage(null);
    setAmountDrafts(Object.fromEntries(state.students.map((student) => [student.student_id, '0'])));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!classroomId) {
    return (
      <TeacherShell>
        <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-5 text-sm font-bold text-danger">
          담당 학급 정보를 확인할 수 없습니다.
        </div>
      </TeacherShell>
    );
  }

  return (
    <TeacherShell>
      <div className="space-y-5 pb-24 md:pb-6">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-1 text-xs font-black uppercase tracking-[0.18em] text-gold">Economy · 4 rounds</div>
            <h1 className="font-display text-2xl tracking-tight text-brand-gradient">⚖️ 균형발전 분담금</h1>
            <p className="mt-1 max-w-3xl break-keep text-sm font-bold text-text-secondary">
              학생별 주당 분담금을 한 번 정한 뒤 4회차 동안 같은 금액을 부과합니다. 원하는 회차를 즉시 부과할 수 있어 지난 회차 누락도 복구할 수 있습니다.
            </p>
          </div>
          {plan && !newPlanMode && (
            <div className="self-start rounded-pill border border-line-brand bg-bg-card px-4 py-2 text-xs font-black text-text-secondary lg:self-auto">
              {plan.status === 'ACTIVE' ? '🟢 진행 중' : '✅ 4회차 부과 완료'} · 납부 {formatNumber(plan.total_paid)}G{plan.outstanding_total > 0 ? ` · 미납 ${formatNumber(plan.outstanding_total)}G` : ''}
            </div>
          )}
        </header>

        {message && (
          <div
            className={
              message.type === 'success'
                ? 'rounded-card-md border border-success/40 bg-success-bg p-3 text-sm font-extrabold text-success'
                : 'rounded-card-md border border-danger/40 bg-danger-bg p-3 text-sm font-extrabold text-danger'
            }
          >
            {message.type === 'success' ? '✅ ' : '⚠️ '}{message.text}
          </div>
        )}

        {stateQuery.isLoading ? (
          <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
        ) : stateQuery.isError ? (
          <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-5 text-sm font-bold text-danger">
            분담금 정보를 불러오지 못했습니다: {stateQuery.error instanceof Error ? stateQuery.error.message : '알 수 없는 오류'}
          </div>
        ) : !state ? null : (
          <>
            <section className="overflow-hidden rounded-card-lg border border-line-brand bg-bg-card backdrop-blur-card">
              <div className="border-b border-line bg-gradient-to-r from-brand-primary/10 via-transparent to-gold/10 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-display text-lg tracking-tight text-white">① 학생별 주당 분담금 설정</h2>
                    <p className="mt-1 text-xs font-bold text-text-secondary">
                      0골드는 비대상입니다. 한 번이라도 부과를 시작하면 해당 4주 계획의 금액은 고정됩니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-black">
                    <span className="rounded-pill border border-line bg-bg-deep px-3 py-1.5 text-text-secondary">대상 {positiveCount}명</span>
                    <span className="rounded-pill border border-gold/30 bg-gold/10 px-3 py-1.5 text-gold">회차당 {formatNumber(weeklyTotal)}G</span>
                    <span className="rounded-pill border border-line bg-bg-deep px-3 py-1.5 text-text-secondary">4회 총 {formatNumber(weeklyTotal * 4)}G</span>
                  </div>
                </div>
              </div>

              {newPlanMode && (
                <div className="border-b border-warning/30 bg-warning-bg px-4 py-3 text-xs font-extrabold text-warning">
                  🆕 새 4주 계획 작성 중입니다. 이전 완료 기록은 그대로 보존됩니다.
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead className="border-b border-line bg-bg-deep text-2xs font-black uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="px-4 py-3">학생</th>
                      <th className="px-4 py-3 text-right">현재 골드</th>
                      <th className="px-4 py-3 text-right">주당 분담금</th>
                      <th className="px-4 py-3 text-right">누적 부과</th>
                      <th className="px-4 py-3 text-right">누적 납부</th>
                      <th className="px-4 py-3 text-right">미납</th>
                      <th className="px-4 py-3">회차 상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {students.map((student) => {
                      const amount = amountByStudentId.get(student.student_id) ?? 0;
                      const insufficient = amount > 0 && student.current_gold < amount;
                      return (
                        <tr key={student.student_id} className="hover:bg-bg-deep/40">
                          <td className="px-4 py-3">
                            <div className="text-sm font-black text-text-primary">{student.student_name}</div>
                            {student.brand_name && <div className="mt-0.5 text-2xs font-bold text-text-muted">{student.brand_name}</div>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className={insufficient ? 'font-mono text-sm font-black text-danger' : 'font-mono text-sm font-black text-gold'}>
                              {formatNumber(student.current_gold)}G
                            </div>
                            {insufficient && editingAllowed && <div className="mt-0.5 text-2xs font-bold text-danger">1회분보다 부족</div>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {editingAllowed ? (
                              <div className="ml-auto flex w-[150px] items-center gap-2">
                                <input
                                  type="number"
                                  min={0}
                                  max={MAX_AMOUNT}
                                  step={100}
                                  inputMode="numeric"
                                  value={amountDrafts[student.student_id] ?? '0'}
                                  onChange={(event) =>
                                    setAmountDrafts((current) => ({ ...current, [student.student_id]: event.target.value }))
                                  }
                                  disabled={busy}
                                  className="login-input w-full text-right font-mono"
                                />
                                <span className="text-xs font-black text-text-muted">G</span>
                              </div>
                            ) : (
                              <span className={student.weekly_amount > 0 ? 'font-mono text-sm font-black text-gold' : 'font-mono text-sm font-bold text-text-muted'}>
                                {formatNumber(student.weekly_amount)}G
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-black text-text-secondary">
                            {formatNumber(student.assessed_total)}G
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-black text-success">
                            {formatNumber(student.total_paid)}G
                          </td>
                          <td className={student.outstanding_total > 0 ? 'px-4 py-3 text-right font-mono text-sm font-black text-danger' : 'px-4 py-3 text-right font-mono text-sm font-bold text-text-muted'}>
                            {formatNumber(student.outstanding_total)}G
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              {ROUND_NUMBERS.map((roundNo) => (
                                <span
                                  key={roundNo}
                                  className={
                                    student.paid_rounds.includes(roundNo)
                                      ? 'flex h-7 w-7 items-center justify-center rounded-full border border-success/40 bg-success-bg text-2xs font-black text-success'
                                      : student.delinquent_rounds.includes(roundNo)
                                        ? 'flex h-7 w-7 items-center justify-center rounded-full border border-danger/40 bg-danger-bg text-2xs font-black text-danger'
                                        : 'flex h-7 w-7 items-center justify-center rounded-full border border-line bg-bg-deep text-2xs font-black text-text-muted'
                                  }
                                  title={`${roundNo}회차 ${student.paid_rounds.includes(roundNo) ? '납부 완료' : student.delinquent_rounds.includes(roundNo) ? '미납 있음' : '미부과'}`}
                                >
                                  {student.delinquent_rounds.includes(roundNo) ? '!' : roundNo}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-2 border-t border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-bold text-text-muted">
                  {editingAllowed
                    ? '분담금을 저장한 뒤 회차별 즉시 부과 버튼이 활성화됩니다.'
                    : '부과가 시작되어 이번 4주 계획의 학생별 금액은 고정되었습니다.'}
                </p>
                <div className="flex gap-2">
                  {newPlanMode && (
                    <button
                      type="button"
                      onClick={() => {
                        setNewPlanMode(false);
                        setAmountDrafts(Object.fromEntries(students.map((student) => [student.student_id, String(student.weekly_amount)])));
                      }}
                      disabled={busy}
                      className="btn-secondary"
                    >
                      취소
                    </button>
                  )}
                  {editingAllowed && (
                    <button
                      type="button"
                      onClick={handleSavePlan}
                      disabled={!allAmountsValid || positiveCount === 0 || busy}
                      className="btn-primary min-w-[150px] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {saving ? '저장 중…' : newPlanMode || !plan ? '4주 계획 저장' : '설정 저장'}
                    </button>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-card-lg border border-line bg-bg-card p-4 backdrop-blur-card">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-display text-lg tracking-tight text-white">② 회차별 즉시 부과</h2>
                  <p className="mt-1 text-xs font-bold text-text-secondary">
                    실제 날짜와 관계없이 1~4회차 중 미부과 회차를 골라 즉시 처리할 수 있습니다.
                  </p>
                </div>
                {plan?.status === 'COMPLETED' && !newPlanMode && (
                  <button type="button" onClick={startNewPlan} disabled={busy} className="btn-primary whitespace-nowrap">
                    + 새 4주 계획
                  </button>
                )}
              </div>

              {!plan ? (
                <div className="rounded-card-md border border-line bg-bg-deep p-5 text-center text-sm font-bold text-text-muted">
                  먼저 학생별 분담금을 입력하고 4주 계획을 저장해주세요.
                </div>
              ) : newPlanMode ? (
                <div className="rounded-card-md border border-warning/30 bg-warning-bg p-5 text-center text-sm font-bold text-warning">
                  새 계획의 분담금 설정을 저장하면 1~4회차 즉시 부과가 활성화됩니다.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {rounds.map((round) => {
                    const charged = round.levied_count > 0;
                    const isCurrentBusy = levyingRound === round.round_no;
                    return (
                      <article
                        key={round.round_no}
                        className={
                          charged
                            ? 'rounded-card-lg border border-success/30 bg-success-bg p-4'
                            : 'rounded-card-lg border border-line bg-bg-deep p-4'
                        }
                      >
                        <div className="mb-4 flex items-start justify-between gap-2">
                          <div>
                            <div className="text-2xs font-black uppercase tracking-widest text-text-muted">ROUND</div>
                            <div className="mt-1 font-display text-2xl text-white">{round.round_no}회차</div>
                          </div>
                          <span className={charged ? 'rounded-pill bg-success-bg px-2.5 py-1 text-2xs font-black text-success' : 'rounded-pill border border-line px-2.5 py-1 text-2xs font-black text-text-muted'}>
                            {charged ? (round.delinquent_count > 0 ? `미납 ${round.delinquent_count}명` : '전원 납부') : plan.status === 'ACTIVE' ? '미부과' : '종료'}
                          </span>
                        </div>

                        {charged ? (
                          <div className="mb-4 space-y-1 text-xs font-bold text-text-secondary">
                            <div className="flex justify-between gap-2"><span>부과 인원</span><strong className="text-text-primary">{round.levied_count}명</strong></div>
                            <div className="flex justify-between gap-2"><span>완납 / 미납</span><strong className={round.delinquent_count > 0 ? 'text-danger' : 'text-success'}>{round.paid_count} / {round.delinquent_count}명</strong></div>
                            <div className="flex justify-between gap-2"><span>부과 총액</span><strong className="text-gold">{formatNumber(round.assessed_total)}G</strong></div>
                            <div className="flex justify-between gap-2"><span>실제 납부</span><strong className="text-success">{formatNumber(round.paid_total)}G</strong></div>
                            <div className="flex justify-between gap-2"><span>남은 미납</span><strong className={round.outstanding_total > 0 ? 'text-danger' : 'text-text-muted'}>{formatNumber(round.outstanding_total)}G</strong></div>
                            <div className="flex justify-between gap-2"><span>부과일</span><strong className="text-text-primary">{formatDateTime(round.charged_at)}</strong></div>
                          </div>
                        ) : (
                          <div className="mb-4 space-y-1 text-xs font-bold text-text-secondary">
                            <div className="flex justify-between gap-2"><span>예정 인원</span><strong className="text-text-primary">{plan.required_count}명</strong></div>
                            <div className="flex justify-between gap-2"><span>예정 총액</span><strong className="text-gold">{formatNumber(plan.weekly_total)}G</strong></div>
                            <div className="text-2xs text-text-muted">지난 회차라도 지금 바로 부과할 수 있습니다.</div>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => handleLevyRound(round.round_no)}
                          disabled={!activePlanReady || charged || busy}
                          className={
                            charged
                              ? 'w-full rounded-card-md border border-success/30 bg-success-bg px-3 py-2.5 text-xs font-black text-success disabled:opacity-80'
                              : 'btn-primary w-full disabled:cursor-not-allowed disabled:opacity-40'
                          }
                        >
                          {charged ? (round.outstanding_total > 0 ? `부과 완료 · 미납 ${formatNumber(round.outstanding_total)}G` : '✓ 부과·납부 완료') : isCurrentBusy ? '부과 처리 중…' : `${round.round_no}회차 즉시 부과`}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-card-lg border border-line bg-bg-card p-4 backdrop-blur-card">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-display text-lg tracking-tight text-white">③ 개별 미납 관리</h2>
                  <p className="mt-1 text-xs font-bold text-text-secondary">
                    회차 부과 당시 골드가 부족했던 학생의 미납을 확인하고, 현재 사용 가능한 골드 범위에서 다시 징수합니다.
                  </p>
                </div>
                <span className={state.arrears_total > 0 ? 'rounded-pill border border-danger/30 bg-danger-bg px-3 py-1.5 text-xs font-black text-danger' : 'rounded-pill border border-success/30 bg-success-bg px-3 py-1.5 text-xs font-black text-success'}>
                  {state.arrears_total > 0 ? `총 미납 ${formatNumber(state.arrears_total)}G` : '미납 없음'}
                </span>
              </div>

              {state.arrears_students.length === 0 ? (
                <div className="rounded-card-md border border-success/30 bg-success-bg p-5 text-center text-sm font-extrabold text-success">
                  ✅ 현재 남아 있는 균형발전 분담금 미납이 없습니다.
                </div>
              ) : (
                <div className="space-y-3">
                  {state.arrears_students.map((student) => (
                    <article key={student.student_id} className="rounded-card-md border border-danger/25 bg-bg-deep p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-sm font-black text-text-primary">{student.student_name}</strong>
                            {student.brand_name && <span className="text-2xs font-bold text-text-muted">{student.brand_name}</span>}
                            <span className="rounded-pill border border-danger/30 bg-danger-bg px-2 py-0.5 text-2xs font-black text-danger">
                              {student.delinquent_items}건 · {formatNumber(student.outstanding_total)}G
                            </span>
                            <span className="rounded-pill border border-line px-2 py-0.5 text-2xs font-black text-text-secondary">
                              현재 골드 {formatNumber(student.current_gold)}G
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {student.details.map((detail) => (
                              <div key={detail.payment_id} className="rounded-card-md border border-line bg-bg-card px-3 py-2 text-2xs font-bold text-text-secondary">
                                <div className="font-black text-text-primary">{detail.plan_label} · {detail.round_no}회차</div>
                                <div className="mt-1">부과 {formatNumber(detail.assessed)}G · 납부 {formatNumber(detail.paid)}G · <span className="font-black text-danger">미납 {formatNumber(detail.outstanding)}G</span></div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCollectArrears(student)}
                          disabled={busy}
                          className="btn-primary min-w-[140px] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {collectingStudentId === student.student_id ? '징수 중…' : '미납 다시 징수'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-card-md border border-line bg-bg-deep p-4">
              <h3 className="mb-2 text-sm font-black text-text-primary">🛡️ 부과 안전장치</h3>
              <div className="grid grid-cols-1 gap-2 text-xs font-bold text-text-secondary md:grid-cols-3">
                <div>• 같은 계획·학생·회차는 DB에서 중복 부과가 차단됩니다.</div>
                <div>• 골드가 부족한 학생은 가능한 금액만 먼저 징수하고 나머지는 개별 미납으로 남습니다.</div>
                <div>• 미납 재징수는 오래된 납부 의무부터 처리되며, 잔액 부족 시 일부만 징수될 수 있습니다.</div>
              </div>
            </section>
          </>
        )}
      </div>
    </TeacherShell>
  );
}
