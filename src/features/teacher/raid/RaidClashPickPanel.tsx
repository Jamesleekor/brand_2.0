// CLASH_V4_20261109 — 선생님이 격돌잡이를 고르는 패널(교사 전용).
// · 선택 방식: 무작위 추첨(기본) / 선생님이 선택 — 학생·중계 화면에는 어떤 방식인지 나타나지 않는다.
// · 선생님이 선택: 지원 마감 뒤 30초 안에 확정, 모자란 자리는 나머지 지원자 중 무작위. 30초가 지나면 전원 무작위.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { RaidStatus } from '@/lib/rpc/raid_admin_rpc';
import { raidV15AdminRpc, type RaidClashPickState, type RaidClashSelectionMode } from '@/lib/rpc/raid_v15_admin_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

function useNow(intervalMs: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}

export default function RaidClashPickPanel({ raidId, raidStatus }: { raidId: number; raidStatus: RaidStatus }) {
  const queryClient = useQueryClient();
  const queryKey = ['teacher-raid-clash-pick', raidId];
  const ended = raidStatus === 'COMPLETED' || raidStatus === 'FAILED' || raidStatus === 'ARCHIVED';

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const fetchedAt = Date.now();
      const result = await raidV15AdminRpc.clashPickState(supabase, raidId);
      if (result.success === false) throw Object.assign(new Error(result.error), { code: result.type === 'SERVER' ? result.code : undefined });
      const serverNow = Date.parse(result.data.server_now);
      return { ...result.data, offsetMs: Number.isFinite(serverNow) ? serverNow - (fetchedAt + Date.now()) / 2 : 0 };
    },
    refetchInterval: (q) => {
      const phase = q.state.data?.session?.phase;
      if (phase === 'VOLUNTEERING' || phase === 'SELECTED') return 1000;
      return raidStatus === 'ACTIVE' ? 4000 : false;
    },
    retry: false,
  });

  const data = query.data;
  const session = data?.session ?? null;
  const volunteering = session?.phase === 'VOLUNTEERING';
  const now = useNow(250, Boolean(volunteering)) + (data?.offsetMs ?? 0);

  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // 새 격돌이 시작되면 선택을 비운다
  useEffect(() => {
    setPicked([]);
    setMessage(null);
  }, [session?.id]);

  const sortedVolunteers = useMemo(() => {
    const list = session?.volunteers ?? [];
    return [...list].sort((a, b) =>
      a.clash_count_total - b.clash_count_total || Date.parse(a.volunteered_at) - Date.parse(b.volunteered_at));
  }, [session?.volunteers]);

  if (query.isError) {
    const code = (query.error as { code?: string } | null)?.code;
    const missing = code === 'PGRST202' || /teacher_get_raid_clash_pick_state/.test(String(query.error));
    return (
      <section className="rounded-card-lg border border-orange-300/30 bg-orange-950/20 p-4 text-sm font-black text-orange-100">
        ⚔ 격돌잡이 선택: {missing ? '서버에 CLASH V4 SQL(APPLY_RAID_CLASH_V4_20261109.sql)을 먼저 적용해 주세요.' : `불러오지 못했습니다 · ${String((query.error as Error).message)}`}
      </section>
    );
  }
  if (!data) return null;

  const mode = data.selection_mode;
  const planned = data.planned_player_count;
  const acceptUntil = session ? Date.parse(session.volunteer_accept_until) : Number.NaN;
  const pickDeadline = session ? Date.parse(session.pick_deadline_at) : Number.NaN;
  const recruiting = volunteering && Number.isFinite(acceptUntil) && now < acceptUntil;
  const drawing = volunteering && !recruiting;
  const secondsToClose = Math.max(0, (acceptUntil - now) / 1000);
  const secondsToDeadline = Math.max(0, (pickDeadline - now) / 1000);
  const nameById = new Map((session?.volunteers ?? []).map((v) => [v.participant_id, v.student_name]));

  const setMode = async (next: RaidClashSelectionMode) => {
    if (busy || next === mode) return;
    setBusy(true);
    setMessage(null);
    const result = await raidV15AdminRpc.setClashSelectionMode(supabase, raidId, next);
    setBusy(false);
    if (result.success === false) {
      setMessage({ tone: 'error', text: result.error });
      return;
    }
    queryClient.setQueryData(queryKey, { ...result.data, offsetMs: data.offsetMs });
  };

  const toggle = (participantId: number) => {
    setPicked((current) => {
      if (current.includes(participantId)) return current.filter((id) => id !== participantId);
      if (current.length >= planned) return current;
      return [...current, participantId];
    });
  };

  const confirm = async () => {
    if (busy || !session) return;
    setBusy(true);
    setMessage(null);
    const result = await raidV15AdminRpc.pickClashPlayers(supabase, raidId, picked);
    setBusy(false);
    if (result.success === false) {
      setMessage({ tone: 'error', text: result.error });
      void query.refetch();
      return;
    }
    queryClient.setQueryData(queryKey, { ...result.data, offsetMs: data.offsetMs });
    setMessage({
      tone: 'ok',
      text: picked.length >= planned
        ? '확정했습니다. 곧 학생 화면과 중계 화면에 발표됩니다.'
        : picked.length === 0
          ? '모두 무작위로 추첨합니다.'
          : `확정했습니다. 남은 ${planned - picked.length}자리는 무작위로 채워집니다.`,
    });
  };

  return (
    <section className="rounded-card-lg border border-sky-300/30 bg-bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-black text-white">⚔ 격돌잡이 선택</div>
          <p className="mt-1 text-xs font-bold leading-5 text-sky-100">
            학생 화면과 중계 화면에는 어떤 방식인지 나타나지 않습니다. 레이드 진행 중에도 바꿀 수 있습니다.
          </p>
        </div>
        <div className="flex gap-2" role="group" aria-label="격돌잡이 선택 방식">
          {([
            ['RANDOM', '🎲 무작위 추첨'],
            ['TEACHER', '🧑‍🏫 선생님이 선택'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={busy || ended || !data.configured}
              onClick={() => void setMode(value)}
              aria-pressed={mode === value}
              className={cn(
                'rounded-card-md border px-3 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50',
                mode === value ? 'border-sky-200 bg-sky-500/30 text-white' : 'border-white/15 bg-black/25 text-sky-100 hover:bg-white/5',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!data.configured ? (
        <div className="mt-3 text-sm font-black text-amber-100">「⚔ 격돌」 탭에서 격돌 설정을 먼저 저장하면 선택 방식을 고를 수 있습니다.</div>
      ) : null}

      {data.configured && !session ? (
        <div className="mt-3 text-sm font-bold text-sky-100">
          {mode === 'TEACHER'
            ? `격돌이 시작되면 여기에 지원자 목록이 나타납니다. 지원 마감 뒤 30초 안에 ${planned}명까지 골라 확정하세요.`
            : '지금은 지원자 중에서 무작위로 추첨합니다.'}
        </div>
      ) : null}

      {session && volunteering ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={cn('rounded-pill border px-3 py-1 text-sm font-black', drawing ? 'border-yellow-200/60 bg-yellow-500/15 text-yellow-50' : 'border-sky-200/50 bg-sky-500/10 text-sky-50')}>
              {recruiting
                ? `지원 받는 중 · ${secondsToClose.toFixed(1)}초`
                : mode === 'TEACHER'
                  ? session.picked
                    ? '확정 완료 · 곧 발표'
                    : `격돌잡이 추첨 중 · 확정까지 ${secondsToDeadline.toFixed(0)}초 (지나면 무작위)`
                  : '격돌잡이 추첨 중 (무작위)'}
            </div>
            <div className="text-sm font-black text-white">
              지원자 {session.volunteers.length}명 · 필요 {planned}명
            </div>
          </div>

          {mode === 'TEACHER' && !session.picked ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {sortedVolunteers.map((v) => {
                  const on = picked.includes(v.participant_id);
                  const order = picked.indexOf(v.participant_id) + 1;
                  const full = !on && picked.length >= planned;
                  return (
                    <button
                      key={v.participant_id}
                      type="button"
                      disabled={v.attack_blocked || full || busy}
                      onClick={() => toggle(v.participant_id)}
                      aria-pressed={on}
                      className={cn(
                        'flex items-center gap-3 rounded-card-md border px-3 py-2 text-left disabled:cursor-not-allowed',
                        on ? 'border-yellow-200 bg-yellow-500/20' : 'border-white/12 bg-black/25 hover:bg-white/5',
                        (v.attack_blocked || full) && 'opacity-45',
                      )}
                    >
                      <span className={cn('grid h-7 w-7 flex-none place-items-center rounded-full border text-sm font-black', on ? 'border-yellow-100 bg-yellow-400 text-black' : 'border-white/30 text-white/60')}>
                        {on ? order : ''}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-black text-white">{v.student_name}</span>
                        <span className="block truncate text-[11px] font-bold text-sky-100">{v.guild_name ?? '길드 없음'}{v.attack_blocked ? ' · 공격 막힘' : ''}</span>
                      </span>
                      <span className={cn(
                        'flex-none rounded-pill border px-2 py-0.5 text-[11px] font-black',
                        v.clash_count_total === 0 ? 'border-emerald-300/60 bg-emerald-500/15 text-emerald-100' : 'border-white/20 bg-white/5 text-white/80',
                      )}>
                        {v.clash_count_total === 0 ? '첫 도전' : `격돌잡이 ${v.clash_count_total}회`}
                      </span>
                    </button>
                  );
                })}
                {sortedVolunteers.length === 0 ? (
                  <div className="text-sm font-bold text-sky-100">아직 지원자가 없습니다.</div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
                <div className="text-xs font-bold text-amber-100">
                  {picked.length}/{planned}명 선택 · 모자란 자리는 나머지 지원자 중 무작위 · 격돌잡이 횟수가 적은 순서로 보여요
                </div>
                <button type="button" disabled={busy} onClick={() => void confirm()} className="btn-primary min-w-40 disabled:opacity-50">
                  {busy ? '확정 중…' : picked.length === 0 ? '모두 무작위로 추첨' : `${picked.length}명 확정하고 발표`}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {session && !volunteering ? (
        <div className="mt-3 text-sm font-bold text-sky-100">
          {session.players.length > 0
            ? <>이번 격돌잡이: <span className="font-black text-white">{session.players.map((id) => nameById.get(id) ?? `#${id}`).join(', ')}</span></>
            : '이번 격돌은 격돌잡이 없이 끝났습니다.'}
          <span className="ml-2 text-xs text-sky-200/80">(이 레이드의 격돌은 한 번만 일어납니다)</span>
        </div>
      ) : null}

      {message ? (
        <div className={cn('mt-2 text-sm font-black', message.tone === 'ok' ? 'text-emerald-200' : 'text-red-200')}>{message.text}</div>
      ) : null}
    </section>
  );
}

export type { RaidClashPickState };
