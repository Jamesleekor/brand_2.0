// 학생 홈 상단 메뉴의 '모험가 도구함' 배지
// - 홈은 로그인 경로이므로 무겁게 만들지 않는다.
// - 학생용 신호 행 하나(작은 표)만 구독하고, 열린 활동이 있을 때만 내 참여 목록을 한 번 읽는다.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';
import { LIFECYCLE_EVENTS, useToolboxPulse } from './useToolboxPulse';
import { toolboxRpc } from './toolbox_rpc';

export function useToolboxBadgeCount(): number {
  const classroomId = useAuthStore((s) => s.context?.classroomId ?? null);
  const isStudent = useAuthStore((s) => !!s.context?.studentId && !s.context?.isTeacher);
  const pulse = useToolboxPulse(supabase, isStudent ? classroomId : null, 'S');
  const openCount = Number(pulse.payload.open_count ?? 0);
  const [count, setCount] = useState(0);
  // 점수 클릭처럼 목록과 무관한 신호에는 다시 읽지 않는다.
  const lifecycleTick = useRef(0);
  const lastRev = useRef(0);
  if (pulse.rev !== lastRev.current) {
    lastRev.current = pulse.rev;
    if (pulse.initial || !pulse.payload.event || LIFECYCLE_EVENTS.has(String(pulse.payload.event))) lifecycleTick.current += 1;
  }
  const tick = lifecycleTick.current;
  useEffect(() => {
    if (!isStudent || openCount <= 0) { setCount(0); return; }
    // 24명이 같은 순간에 읽지 않도록 0~1.5초 사이로 퍼뜨린다.
    const t = window.setTimeout(() => {
      void toolboxRpc.feed(supabase).then((r) => setCount(r.activities.length)).catch(() => setCount(0));
    }, 200 + Math.floor(Math.random() * 1300));
    return () => window.clearTimeout(t);
  }, [isStudent, openCount, tick]);
  return count;
}
