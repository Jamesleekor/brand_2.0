import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';

interface StudentPresenceTrackerProps {
  children: ReactNode;
}

function pagePath(pathname: string): string {
  return pathname.slice(0, 120);
}

export function StudentPresenceTracker({ children }: StudentPresenceTrackerProps) {
  const location = useLocation();
  const context = useAuthStore((s) => s.context);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);
  const pathRef = useRef(pagePath(location.pathname));
  const visibleRef = useRef(typeof document === 'undefined' ? true : document.visibilityState === 'visible');

  const studentId = context?.studentId ?? null;
  const classroomId = context?.classroomId ?? null;

  const publish = useCallback(async () => {
    const channel = channelRef.current;
    if (!channel || !subscribedRef.current || !studentId) return;

    await channel.track({
      student_id: studentId,
      path: pathRef.current,
      visible: visibleRef.current,
      updated_at: new Date().toISOString(),
    });
  }, [studentId]);

  useEffect(() => {
    pathRef.current = pagePath(location.pathname);
    void publish();
  }, [location.pathname, publish]);

  useEffect(() => {
    if (!studentId || !classroomId) return;

    const topic = `brand:classroom:${classroomId}:presence`;
    const channel = supabase.channel(topic, {
      config: {
        private: true,
        presence: { key: `student:${studentId}` },
      },
    });

    channelRef.current = channel;
    subscribedRef.current = false;

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        subscribedRef.current = true;
        void publish();
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        subscribedRef.current = false;
        // AUCTION_EMERGENCY_STOP_PRESENCE_RETRY_V1
        channelRef.current = null;
        void supabase.removeChannel(channel);
      }
    });

    const onVisibility = () => {
      visibleRef.current = document.visibilityState === 'visible';
      void publish();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      subscribedRef.current = false;
      channelRef.current = null;
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [classroomId, publish, studentId]);

  return <>{children}</>;
}
