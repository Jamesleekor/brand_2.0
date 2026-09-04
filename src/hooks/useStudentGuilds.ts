import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useStudentId } from '@/stores/auth_store';

export type StudentGuildIdentity = {
  studentId: number;
  guildId: number;
  guildName: string;
};

export function useClassroomStudentGuilds() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();
  const queryClient = useQueryClient();

  const query = useQuery<StudentGuildIdentity[]>({
    queryKey: ['student-guild-identities', classroomId],
    enabled: classroomId !== null,
    staleTime: 30_000,
    queryFn: async () => {
      if (!classroomId) return [];

      const guildsRes = await supabase
        .from('guilds')
        .select('id,name')
        .eq('classroom_id', classroomId)
        .eq('is_active', true);
      if (guildsRes.error) throw new Error(`[Guild identity:guilds] ${guildsRes.error.message}`);

      const guilds = guildsRes.data ?? [];
      const guildIds = guilds.map((guild: any) => Number(guild.id)).filter(Number.isFinite);
      if (guildIds.length === 0) return [];

      const membersRes = await supabase
        .from('guild_members')
        .select('student_id,guild_id')
        .in('guild_id', guildIds)
        .is('left_at', null);
      if (membersRes.error) throw new Error(`[Guild identity:members] ${membersRes.error.message}`);

      const guildNameById = new Map<number, string>(
        guilds.map((guild: any) => [Number(guild.id), String(guild.name ?? '')]),
      );

      return (membersRes.data ?? []).flatMap((member: any) => {
        const guildId = Number(member.guild_id);
        const guildName = guildNameById.get(guildId)?.trim();
        if (!guildName) return [];
        return [{
          studentId: Number(member.student_id),
          guildId,
          guildName,
        }];
      });
    },
  });

  const byStudentId = useMemo(
    () => new Map((query.data ?? []).map((row) => [row.studentId, row] as const)),
    [query.data],
  );

  useEffect(() => {
    if (!classroomId) return;
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['student-guild-identities', classroomId] });
    };

    const channels = [
      supabase
        .channel(`student-guild-identities:guilds:${classroomId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'guilds', filter: `classroom_id=eq.${classroomId}` }, invalidate)
        .subscribe(),
      supabase
        .channel(`student-guild-identities:members:${classroomId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'guild_members' }, invalidate)
        .subscribe(),
    ];

    return () => {
      channels.forEach((channel) => { void supabase.removeChannel(channel); });
    };
  }, [classroomId, queryClient]);

  return {
    ...query,
    byStudentId,
    myGuild: studentId ? (byStudentId.get(studentId) ?? null) : null,
  };
}
