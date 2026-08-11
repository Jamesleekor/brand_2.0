import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';

export type ActiveEmergency = {
  id: number;
  emergency_type: 'HYPERINFLATION' | 'EMPLOYMENT_FREEZE' | 'ASSET_FREEZE';
  reason: string | null;
  started_at: string;
  scheduled_end_at: string | null;
  status: string;
};

export function useActiveEmergencies() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();

  const query = useQuery<ActiveEmergency[]>({
    queryKey: ['active-emergencies', classroomId],
    enabled: classroomId !== null,
    staleTime: 15_000,
    queryFn: async () => {
      if (!classroomId) return [];
      const { data, error } = await supabase
        .from('emergencies')
        .select('id,emergency_type,reason,started_at,scheduled_end_at,status')
        .eq('classroom_id', classroomId)
        .eq('status', 'ACTIVE')
        .order('started_at', { ascending: false });
      if (error) throw error;
      const now = Date.now();
      return ((data ?? []) as ActiveEmergency[]).filter(
        (row) => !row.scheduled_end_at || new Date(row.scheduled_end_at).getTime() > now,
      );
    },
  });

  useEffect(() => {
    if (!classroomId) return;
    const channel = supabase
      .channel(`active-emergencies:${classroomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emergencies', filter: `classroom_id=eq.${classroomId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['active-emergencies', classroomId] });
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [classroomId, queryClient]);

  const emergencies = query.data ?? [];
  return {
    ...query,
    emergencies,
    assetFreeze: emergencies.find((x) => x.emergency_type === 'ASSET_FREEZE') ?? null,
    hyperinflation: emergencies.find((x) => x.emergency_type === 'HYPERINFLATION') ?? null,
    employmentFreeze: emergencies.find((x) => x.emergency_type === 'EMPLOYMENT_FREEZE') ?? null,
  };
}
