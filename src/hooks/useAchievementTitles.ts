import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { achievementA1Rpc, type EquippedAchievementTitle } from '@/lib/rpc/achievement_a1_rpc';
import { useClassroomId, useStudentId } from '@/stores/auth_store';

export function useClassroomAchievementTitles() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();
  const queryClient = useQueryClient();
  const query = useQuery<EquippedAchievementTitle[]>({
    queryKey: ['achievement-titles', classroomId],
    queryFn: async () => {
      if (!classroomId) return [];
      const result = await achievementA1Rpc.classroomTitles(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data ?? [];
    },
    enabled: classroomId !== null,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!classroomId) return;
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['achievement-titles', classroomId] });
      if (studentId) {
        void queryClient.invalidateQueries({ queryKey: ['achievements-safe-catalog', studentId] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard', studentId, classroomId] });
        void queryClient.invalidateQueries({ queryKey: ['profile-detail', studentId] });
      }
    };
    const channel = supabase
      .channel(`achievement-titles:${classroomId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'student_achievements', filter: `classroom_id=eq.${classroomId}`,
      }, invalidate)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [classroomId, studentId, queryClient]);

  const byStudentId = useMemo(() => new Map(
    (query.data ?? []).map((row) => [Number(row.student_id), row] as const),
  ), [query.data]);

  return { ...query, byStudentId };
}

export function useMyAchievementTitle() {
  const studentId = useStudentId();
  const { byStudentId, ...query } = useClassroomAchievementTitles();
  return { ...query, title: studentId ? byStudentId.get(studentId) ?? null : null };
}
