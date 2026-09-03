import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';

export interface FinancialLifetimeSummary {
  student_id: number;
  classroom_id: number;
  tax_paid_total: number;
  donation_total: number;
  baseline_tax_paid: number;
  baseline_donation_total: number;
  season2_tax_paid: number;
  season2_donation_total: number;
  cutover_transaction_id: number;
}

function asNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function useFinancialLifetimeSummary() {
  const studentId = useStudentId();

  const query = useQuery<FinancialLifetimeSummary>({
    queryKey: ['financial-lifetime-summary', studentId],
    enabled: studentId !== null,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!studentId) throw new Error('학생 정보를 확인할 수 없습니다.');
      const { data, error } = await supabase.rpc('student_get_financial_lifetime_summary');
      if (error) throw error;
      const row = (data ?? {}) as Record<string, unknown>;
      return {
        student_id: asNumber(row.student_id),
        classroom_id: asNumber(row.classroom_id),
        tax_paid_total: asNumber(row.tax_paid_total),
        donation_total: asNumber(row.donation_total),
        baseline_tax_paid: asNumber(row.baseline_tax_paid),
        baseline_donation_total: asNumber(row.baseline_donation_total),
        season2_tax_paid: asNumber(row.season2_tax_paid),
        season2_donation_total: asNumber(row.season2_donation_total),
        cutover_transaction_id: asNumber(row.cutover_transaction_id),
      };
    },
  });

  return { studentId, ...query };
}
