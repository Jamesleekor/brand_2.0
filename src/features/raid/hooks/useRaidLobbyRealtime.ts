import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase/client';
import type { RaidLobbyMessage } from '@/lib/rpc/raid_student_rpc';

export interface RaidLobbyPresence {
  student_id: number;
  joined_at: string;
}

interface UseRaidLobbyRealtimeArgs {
  raidId: number;
  studentId: number | null;
  onChatMessage?: (message: RaidLobbyMessage) => void;
}

export function useRaidLobbyRealtime({
  raidId,
  studentId,
  onChatMessage,
}: UseRaidLobbyRealtimeArgs) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const onChatRef = useRef(onChatMessage);
  const [players, setPlayers] = useState<RaidLobbyPresence[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    onChatRef.current = onChatMessage;
  }, [onChatMessage]);

  useEffect(() => {
    if (!studentId) return;

    let disposed = false;
    const channel = supabase.channel(`raid:lobby:${raidId}`, {
      config: {
        presence: { key: String(studentId) },
        broadcast: { self: true },
      },
    });
    channelRef.current = channel;

    const syncPresence = () => {
      if (disposed) return;

      const raw = channel.presenceState() as Record<
        string,
        Array<RaidLobbyPresence & { presence_ref?: string }>
      >;

      const byStudent = new Map<number, RaidLobbyPresence>();
      Object.values(raw).flat().forEach((entry) => {
        const id = Number(entry.student_id);
        if (!Number.isFinite(id)) return;
        const current = byStudent.get(id);
        if (!current || String(entry.joined_at) > String(current.joined_at)) {
          byStudent.set(id, {
            student_id: id,
            joined_at: String(entry.joined_at ?? ''),
          });
        }
      });

      setPlayers(
        [...byStudent.values()].sort((a, b) => a.student_id - b.student_id),
      );
    };

    channel
      .on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'join' }, syncPresence)
      .on('presence', { event: 'leave' }, syncPresence)
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        const message = payload as RaidLobbyMessage | undefined;
        if (!message || !Number.isFinite(Number(message.id))) return;
        onChatRef.current?.({
          ...message,
          id: Number(message.id),
          student_id: Number(message.student_id),
        });
      })
      .subscribe(async (status) => {
        if (disposed) return;
        setConnected(status === 'SUBSCRIBED');
        if (status !== 'SUBSCRIBED') return;

        await channel.track({
          student_id: studentId,
          joined_at: new Date().toISOString(),
        });
        syncPresence();
      });

    return () => {
      disposed = true;
      setConnected(false);
      setPlayers([]);
      if (channelRef.current === channel) channelRef.current = null;
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [raidId, studentId]);

  const broadcastChat = useCallback(async (message: RaidLobbyMessage) => {
    const channel = channelRef.current;
    if (!channel) return;
    await channel.send({
      type: 'broadcast',
      event: 'chat',
      payload: message,
    });
  }, []);

  return {
    players,
    connected,
    broadcastChat,
  };
}
