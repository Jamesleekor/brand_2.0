import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';

type RosterStudent = {
  student_id: number;
  student_name: string;
  brand_name: string | null;
  role: string;
  last_seen_at: string | null;
  last_device_type: string | null;
  last_browser: string | null;
};

type PresenceMeta = {
  student_id?: number | string;
  path?: string;
  visible?: boolean;
  updated_at?: string;
  presence_ref?: string;
};

type OnlineStudent = {
  studentId: number;
  path: string;
  visible: boolean;
  updatedAt: string | null;
  connections: number;
};

const ROSTER_REFRESH_MS = 60_000;

function toStudentId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function pageLabel(path: string): string {
  if (path === '/home') return '홈';
  if (path.startsWith('/guild/peer-review')) return '동료평가';
  if (path.startsWith('/guild')) return '길드';
  if (path.startsWith('/market')) return '시장';
  if (path.startsWith('/wallet')) return '자산';
  if (path.startsWith('/bank')) return '은행';
  if (path.startsWith('/arcade')) return '아케이드';
  if (path.startsWith('/raid')) return '레이드';
  if (path.startsWith('/mail')) return '우편';
  if (path.startsWith('/records')) return '기록실';
  if (path.startsWith('/characters')) return '편린';
  if (path.startsWith('/achievement')) return '업적';
  if (path.startsWith('/profile')) return '프로필';
  if (path.startsWith('/daily-quest')) return '일일퀘스트';
  if (path.startsWith('/assignments')) return '과제';
  if (path.startsWith('/rankings')) return '랭킹';
  if (path.startsWith('/friends')) return '친구';
  if (path.startsWith('/settings')) return '설정';
  return path || 'B.R.A.N.D';
}

function relativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return '접속 기록 없음';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '접속 기록 없음';
  const seconds = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (seconds < 60) return '방금 전';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

function pickPresence(metas: PresenceMeta[]): PresenceMeta | null {
  if (metas.length === 0) return null;
  return [...metas].sort((a, b) => {
    if (!!a.visible !== !!b.visible) return a.visible ? -1 : 1;
    const at = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bt = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return bt - at;
  })[0] ?? null;
}

export function TeacherPresenceSummary() {
  const classroomId = useClassroomId();
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [online, setOnline] = useState<Map<number, OnlineStudent>>(new Map());
  const [connectionState, setConnectionState] = useState<'CONNECTING' | 'LIVE' | 'ERROR'>('CONNECTING');
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const loadRoster = useCallback(async () => {
    if (!classroomId) return;
    const { data, error } = await supabase.rpc('teacher_get_presence_roster', { p_classroom_id: classroomId });
    if (error) {
      setRosterError(error.message || '학생 접속 명단을 불러오지 못했습니다.');
      return;
    }
    const rows = Array.isArray((data as any)?.students) ? (data as any).students : [];
    setRoster(rows as RosterStudent[]);
    setRosterError(null);
  }, [classroomId]);

  useEffect(() => {
    void loadRoster();
    const id = window.setInterval(() => void loadRoster(), ROSTER_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadRoster]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!classroomId) return;

    const topic = `brand:classroom:${classroomId}:presence`;
    const channel = supabase.channel(topic, { config: { private: true } });
    channelRef.current = channel;
    setConnectionState('CONNECTING');

    const sync = () => {
      const state = channel.presenceState() as Record<string, PresenceMeta[]>;
      const grouped = new Map<number, PresenceMeta[]>();

      Object.values(state).forEach((metas) => {
        metas.forEach((meta) => {
          const studentId = toStudentId(meta.student_id);
          if (!studentId) return;
          const current = grouped.get(studentId) ?? [];
          current.push(meta);
          grouped.set(studentId, current);
        });
      });

      const next = new Map<number, OnlineStudent>();
      grouped.forEach((metas, studentId) => {
        const chosen = pickPresence(metas);
        if (!chosen) return;
        next.set(studentId, {
          studentId,
          path: typeof chosen.path === 'string' ? chosen.path : '/home',
          visible: chosen.visible !== false,
          updatedAt: typeof chosen.updated_at === 'string' ? chosen.updated_at : null,
          connections: metas.length,
        });
      });
      setOnline(next);
    };

    channel
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionState('LIVE');
          sync();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnectionState('ERROR');
        }
      });

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [classroomId]);

  useEffect(() => {
    if (open) void loadRoster();
  }, [loadRoster, open]);

  const rosterIds = useMemo(() => new Set(roster.map((s) => s.student_id)), [roster]);
  const onlineCount = useMemo(
    () => Array.from(online.keys()).filter((id) => rosterIds.has(id)).length,
    [online, rosterIds],
  );

  const sorted = useMemo(() => {
    return [...roster].sort((a, b) => {
      const ao = online.has(a.student_id) ? 1 : 0;
      const bo = online.has(b.student_id) ? 1 : 0;
      if (ao !== bo) return bo - ao;
      return a.student_name.localeCompare(b.student_name, 'ko');
    });
  }, [online, roster]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 rounded-card-md border px-3 py-2 text-xs font-black transition-colors',
          connectionState === 'LIVE'
            ? 'border-success/35 bg-success-bg text-success hover:bg-success/15'
            : connectionState === 'ERROR'
              ? 'border-danger/35 bg-danger-bg text-danger'
              : 'border-line bg-bg-card text-text-secondary',
        )}
        aria-expanded={open}
        aria-label="학생 실시간 접속 현황"
      >
        <span className={cn('h-2 w-2 rounded-full', connectionState === 'LIVE' ? 'bg-success animate-pulse' : connectionState === 'ERROR' ? 'bg-danger' : 'bg-text-muted')} />
        <span>실시간 접속 {onlineCount}명</span>
        <span className="hidden text-text-muted lg:inline">/ {roster.length}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(760px,calc(100vw-32px))] overflow-hidden rounded-card-xl border border-line bg-bg-overlay shadow-card backdrop-blur-card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <div className="font-display text-base text-white">학생 실시간 접속 현황</div>
              <div className="mt-0.5 text-[10px] font-bold text-text-secondary">
                Presence 실시간 연결 · 오프라인은 마지막 B.R.A.N.D 접속 기록 표시
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-pill border border-success/30 bg-success-bg px-2 py-1 text-[10px] font-black text-success">온라인 {onlineCount}</span>
              <span className="rounded-pill border border-line bg-bg-card px-2 py-1 text-[10px] font-black text-text-secondary">전체 {roster.length}</span>
              <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-xs font-black text-text-muted hover:text-white">✕</button>
            </div>
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-3">
            {rosterError && (
              <div className="mb-3 rounded-card-md border border-danger/30 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">{rosterError}</div>
            )}
            {connectionState === 'ERROR' && (
              <div className="mb-3 rounded-card-md border border-warning/30 bg-warning-bg px-3 py-2 text-xs font-bold text-warning">실시간 채널 연결에 문제가 있습니다. 마지막 접속 기록은 계속 확인할 수 있습니다.</div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {sorted.map((student) => {
                const live = online.get(student.student_id);
                const isOnline = !!live;
                return (
                  <div
                    key={student.student_id}
                    className={cn(
                      'min-w-0 rounded-card-md border px-3 py-3',
                      isOnline ? 'border-success/35 bg-success-bg' : 'border-line bg-bg-card',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', isOnline ? 'bg-success' : 'bg-text-muted/50')} />
                      <div className={cn('truncate text-sm font-black', isOnline ? 'text-white' : 'text-text-secondary')}>{student.student_name}</div>
                    </div>

                    {isOnline ? (
                      <>
                        <div className="mt-2 truncate text-[11px] font-black text-success">{pageLabel(live.path)}</div>
                        <div className="mt-1 text-[9px] font-bold text-text-secondary">
                          {live.visible ? '화면 사용 중' : '백그라운드'}{live.connections > 1 ? ` · ${live.connections}개 연결` : ''}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="mt-2 text-[10px] font-bold text-text-muted">마지막 접속</div>
                        <div className="mt-0.5 text-[11px] font-black text-text-secondary">{relativeTime(student.last_seen_at, nowMs)}</div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {sorted.length === 0 && !rosterError && (
              <div className="py-8 text-center text-xs font-bold text-text-muted">학생 명단을 불러오는 중입니다.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
