// RAID_INSCRIPTION_V1_20261118 — 교사용 「주문 각인」 진행 패널
// · 선발 방식: 무작위 추첨(기본) / 선생님이 선택 — 학생·중계 화면에는 어떤 방식인지 나타나지 않는다.
// · 선생님이 선택: 지원 마감 뒤 30초 안에 확정. 모자란 자리는 나머지 지원자 중 무작위, 30초가 지나면 전원 무작위.
// · 지금 발동(횟수 제한 없음) / 진행 중인 각인 취소 / 각인자 진행 막대 / 타락 회복량(교사만 봄)
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { RaidStatus } from '@/lib/rpc/raid_admin_rpc';
import {
  raidInscriptionAdminRpc,
  type RaidInscriptionHistorySession,
  type RaidInscriptionPickState,
  type RaidInscriptionSelectionMode,
} from '@/lib/rpc/raid_inscription_admin_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { formatSeconds, inscriptionDifficultyLabel } from '@/features/raid/inscription/inscriptionCore';

const PHASE_LABEL: Record<string, string> = {
  PENDING: '격돌이 끝나면 시작',
  VOLUNTEERING: '지원자 모집 중',
  SELECTED: '각인자 공개·카운트다운',
  PLAYING: '각인자 입력 중',
  RESOLVED: '끝남',
  CANCELLED: '취소됨',
};

const OUTCOME_REASON_LABEL: Record<string, string> = {
  ALL_COMPLETED: '전원 완성',
  TIME_UP: '시간 초과',
  NO_VOLUNTEERS: '지원자 없음',
  TEACHER_CANCELLED: '선생님이 취소',
  RAID_ENDED: '레이드 종료',
};

function useNow(intervalMs: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}

type PickStateWithOffset = RaidInscriptionPickState & { offsetMs: number };

export default function RaidInscriptionLivePanel({ raidId, raidStatus }: { raidId: number; raidStatus: RaidStatus }) {
  const queryClient = useQueryClient();
  const queryKey = ['teacher-raid-inscription-pick', raidId];
  const historyKey = ['teacher-raid-inscription-history', raidId];
  const ended = raidStatus === 'COMPLETED' || raidStatus === 'FAILED' || raidStatus === 'ARCHIVED';

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<PickStateWithOffset> => {
      const fetchedAt = Date.now();
      const result = await raidInscriptionAdminRpc.pickState(supabase, raidId);
      if (result.success === false) throw Object.assign(new Error(result.error), { code: result.type === 'SERVER' ? result.code : undefined });
      const serverNow = Date.parse(result.data.server_now);
      return { ...result.data, offsetMs: Number.isFinite(serverNow) ? serverNow - (fetchedAt + Date.now()) / 2 : 0 };
    },
    refetchInterval: (q) => {
      // 진행 중에는 1초마다(이 조회가 서버 단계도 함께 넘긴다), 전투 중에는 4초마다
      if (q.state.data?.session?.open) return 1000;
      return raidStatus === 'ACTIVE' ? 4000 : false;
    },
    retry: false,
  });

  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: async () => {
      const result = await raidInscriptionAdminRpc.history(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data.sessions;
    },
    // 타락 회복량이 쌓이는 동안 보이도록 전투 중에는 4초마다
    refetchInterval: raidStatus === 'ACTIVE' ? 4000 : false,
    retry: false,
  });

  const data = query.data;
  const session = data?.session ?? null;
  const ticking = Boolean(session?.open);
  const now = useNow(250, ticking) + (data?.offsetMs ?? 0);

  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // 새 각인이 시작되면 고른 학생을 비운다
  useEffect(() => {
    setPicked([]);
  }, [session?.id]);

  const sortedVolunteers = useMemo(() => {
    const list = session?.volunteers ?? [];
    return [...list].sort((a, b) =>
      a.inscription_count_total - b.inscription_count_total || Date.parse(a.volunteered_at) - Date.parse(b.volunteered_at));
  }, [session?.volunteers]);

  if (query.isError) {
    const code = (query.error as { code?: string } | null)?.code;
    const missing = code === 'PGRST202' || /teacher_get_raid_inscription_pick_state/.test(String(query.error));
    return (
      <section className="rounded-card-lg border border-violet-300/30 bg-violet-950/20 p-4 text-sm font-black text-violet-100">
        ✒ 주문 각인: {missing ? '서버에 주문 각인 SQL(APPLY_RAID_INSCRIPTION_V1_20261118.sql)을 먼저 적용해 주세요.' : `불러오지 못했습니다 · ${String((query.error as Error).message)}`}
      </section>
    );
  }
  if (!data) return null;

  const mode = data.selection_mode;
  const planned = data.planned_player_count;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: historyKey });
  };

  const setMode = async (next: RaidInscriptionSelectionMode) => {
    if (busy || next === mode) return;
    setBusy(true);
    setMessage(null);
    const result = await raidInscriptionAdminRpc.setSelectionMode(supabase, raidId, next);
    setBusy(false);
    if (result.success === false) {
      setMessage({ tone: 'error', text: result.error });
      return;
    }
    queryClient.setQueryData<PickStateWithOffset>(queryKey, (current) => (current ? { ...current, selection_mode: result.data.selection_mode } : current));
    void queryClient.invalidateQueries({ queryKey: ['teacher-raid-inscription-config', raidId] });
  };

  const trigger = async () => {
    const ok = window.confirm(
      '지금 주문 각인을 발동할까요?\n\n'
      + '· 실제 상황입니다. 학생 화면과 중계 화면에 주문 각인이 뜨고 전투가 멈춥니다.\n'
      + '· 성공하면 보스 피해와 공명방벽 회복이, 실패하면 무작위 학생에게 타락이 실제로 걸립니다.\n'
      + '· 선생님 발동은 횟수 제한이 없고, 자동 발동 횟수(최대 3번)와는 따로 셉니다.',
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const result = await raidInscriptionAdminRpc.trigger(supabase, raidId);
    setBusy(false);
    if (result.success === false) {
      setMessage({ tone: 'error', text: result.error });
      return;
    }
    setMessage(result.data.triggered
      ? { tone: 'ok', text: '주문 각인을 발동했습니다. 학생 화면과 중계 화면을 확인하세요.' }
      : { tone: 'error', text: '주문 각인이 발동되지 않았습니다. 잠시 후 다시 확인해 주세요.' });
    refresh();
  };

  const cancel = async () => {
    const ok = window.confirm('진행 중인 주문 각인을 취소할까요?\n\n성공·실패 없이 끝나고, 멈췄던 시간만큼 전투 시간이 돌아옵니다.');
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const result = await raidInscriptionAdminRpc.cancel(supabase, raidId);
    setBusy(false);
    if (result.success === false) {
      setMessage({ tone: 'error', text: result.error });
      return;
    }
    queryClient.setQueryData<PickStateWithOffset>(queryKey, { ...result.data, offsetMs: data.offsetMs });
    setMessage({ tone: 'ok', text: '주문 각인을 취소했습니다.' });
    refresh();
  };

  const toggle = (participantId: number) => {
    setPicked((current) => {
      if (current.includes(participantId)) return current.filter((id) => id !== participantId);
      if (current.length >= planned) return current;
      return [...current, participantId];
    });
  };

  const confirmPick = async () => {
    if (busy || !session) return;
    setBusy(true);
    setMessage(null);
    const result = await raidInscriptionAdminRpc.pickPlayers(supabase, raidId, picked);
    setBusy(false);
    if (result.success === false) {
      setMessage({ tone: 'error', text: result.error });
      void query.refetch();
      return;
    }
    queryClient.setQueryData<PickStateWithOffset>(queryKey, { ...result.data, offsetMs: data.offsetMs });
    setMessage({
      tone: 'ok',
      text: picked.length >= planned
        ? '확정했습니다. 곧 학생 화면과 중계 화면에 발표됩니다.'
        : picked.length === 0
          ? '모두 무작위로 추첨합니다.'
          : `확정했습니다. 남은 ${planned - picked.length}자리는 무작위로 채워집니다.`,
    });
  };

  // 진행 중인 각인의 시간 표시
  const acceptUntil = session?.volunteer_accept_until ? Date.parse(session.volunteer_accept_until) : Number.NaN;
  const closesAt = session?.volunteer_closes_at ? Date.parse(session.volunteer_closes_at) : Number.NaN;
  const pickDeadline = session?.pick_deadline_at ? Date.parse(session.pick_deadline_at) : Number.NaN;
  const deadline = session?.play_deadline_at ? Date.parse(session.play_deadline_at) : Number.NaN;
  const volunteering = session?.phase === 'VOLUNTEERING';
  const recruiting = volunteering && Number.isFinite(acceptUntil) && now < acceptUntil;
  const autoPoints = data.config.auto_trigger_percents ?? [];

  let hint: string | null = null;
  if (!data.configured) hint = '「✒ 주문 각인」 탭에서 설정을 먼저 저장해 주세요.';
  else if (!data.enabled) hint = '이 레이드는 주문 각인이 꺼져 있습니다. 전투 시작 전에 「✒ 주문 각인」 탭에서 켤 수 있어요.';
  else if (raidStatus !== 'ACTIVE') hint = '전투가 진행 중(ACTIVE)일 때 발동할 수 있습니다.';
  else if (data.clash_busy) hint = '격돌이 진행 중입니다. 격돌이 끝난 뒤에 발동할 수 있어요.';

  const latest: RaidInscriptionHistorySession | null = historyQuery.data?.[0] ?? null;
  const healTotal = (latest?.corruptions ?? []).reduce((sum, item) => sum + Number(item.healed_amount ?? 0), 0);

  return (
    <section className="rounded-card-lg border border-violet-300/35 bg-bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-black text-white">✒ 주문 각인 진행</div>
          <p className="mt-1 text-xs font-bold leading-5 text-violet-100">
            {inscriptionDifficultyLabel(data.config.difficulty)} · {data.config.letter_count}글자 · {formatSeconds(data.config.time_limit_ms, 0)}초 · 각인자 {planned}명
            {autoPoints.length > 0 ? ` · 자동 발동 HP ${autoPoints.map((p) => `${p}%`).join(' / ')}` : ' · 자동 발동 없음'}
            {' '}· 선발 방식은 학생·중계 화면에 나타나지 않습니다.
          </p>
        </div>
        <div className="flex gap-2" role="group" aria-label="각인자 선발 방식">
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
                mode === value ? 'border-violet-200 bg-violet-500/30 text-white' : 'border-white/15 bg-black/25 text-violet-100 hover:bg-white/5',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 발동 · 취소 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void trigger()}
          disabled={busy || !data.can_trigger}
          className="rounded-card-md border border-violet-200/60 bg-violet-500/30 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          ✒ 지금 주문 각인 발동
        </button>
        {session?.open && (
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={busy}
            className="rounded-card-md border border-red-300/50 bg-red-500/20 px-4 py-2 text-sm font-black text-red-50 disabled:opacity-50"
          >
            진행 중인 각인 취소
          </button>
        )}
        {hint && <span className="text-sm font-black text-amber-100">{hint}</span>}
      </div>

      {/* 진행 중인 각인 */}
      {session?.open && (
        <div className="mt-3 space-y-3 rounded-card-md border border-violet-300/25 bg-violet-950/25 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="rounded-pill border border-violet-200/50 bg-violet-500/15 px-3 py-1 text-sm font-black text-violet-50">
              {session.seq_no}번째 각인 · {session.trigger_source === 'AUTO' ? `자동(HP ${session.trigger_percent ?? '?'}%)` : '선생님 발동'} · {PHASE_LABEL[session.phase] ?? session.phase}
              {volunteering && recruiting && Number.isFinite(closesAt) ? ` · ${Math.max(0, (closesAt - now) / 1000).toFixed(1)}초` : ''}
              {session.phase === 'PLAYING' && Number.isFinite(deadline) ? ` · 남은 ${formatSeconds(deadline - now)}초` : ''}
            </div>
            {volunteering && <div className="text-sm font-black text-white">지원자 {session.volunteers.length}명 · 필요 {planned}명</div>}
          </div>

          {volunteering && !recruiting && (
            <div className="text-sm font-black text-yellow-50">
              {mode === 'TEACHER'
                ? session.picked
                  ? '확정 완료 · 곧 발표'
                  : `각인자 추첨 중 · 확정까지 ${Math.max(0, (pickDeadline - now) / 1000).toFixed(0)}초 (지나면 무작위)`
                : '각인자 추첨 중 (무작위)'}
            </div>
          )}

          {volunteering && mode === 'TEACHER' && !session.picked && (
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
                        <span className="block truncate text-[11px] font-bold text-violet-100">
                          {v.guild_name ?? '길드 없음'}{v.attack_blocked ? ' · 공격 막힘' : ''}
                          {v.avg_completed_ms ? ` · 평균 ${formatSeconds(v.avg_completed_ms)}초` : ''}
                        </span>
                      </span>
                      <span className={cn(
                        'flex-none rounded-pill border px-2 py-0.5 text-[11px] font-black',
                        v.inscription_count_total === 0 ? 'border-emerald-300/60 bg-emerald-500/15 text-emerald-100' : 'border-white/20 bg-white/5 text-white/80',
                      )}>
                        {v.inscription_count_total === 0 ? '첫 도전' : `각인 ${v.inscription_count_total}회`}
                      </span>
                    </button>
                  );
                })}
                {sortedVolunteers.length === 0 && <div className="text-sm font-bold text-violet-100">아직 지원자가 없습니다.</div>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
                <div className="text-xs font-bold text-amber-100">
                  {picked.length}/{planned}명 선택 · 모자란 자리는 나머지 지원자 중 무작위 · 각인 횟수가 적은 순서로 보여요
                </div>
                <button type="button" disabled={busy} onClick={() => void confirmPick()} className="btn-primary min-w-40 disabled:opacity-50">
                  {busy ? '확정 중…' : picked.length === 0 ? '모두 무작위로 추첨' : `${picked.length}명 확정하고 발표`}
                </button>
              </div>
            </>
          )}

          {(session.phase === 'SELECTED' || session.phase === 'PLAYING') && session.players.length > 0 && (
            <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {session.players.map((player) => {
                const ratio = session.letter_count > 0 ? Math.min(1, player.typed_count / session.letter_count) : 0;
                return (
                  <div key={player.participant_id} className="flex items-center gap-2 rounded-card-md border border-white/12 bg-black/30 px-2.5 py-1.5">
                    <span className="w-20 truncate text-xs font-black text-white">{player.student_name}</span>
                    <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-black/60">
                      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${ratio * 100}%`, background: player.completed ? '#ffe08a' : '#a78bfa' }} />
                    </div>
                    <span className="w-24 text-right text-[11px] font-black text-violet-100">
                      {player.completed ? `✓ ${formatSeconds(player.completed_ms ?? 0)}초` : `${player.typed_count}/${session.letter_count}`}
                      {player.mistakes > 0 ? ` · 오타 ${player.mistakes}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {session.phase === 'PENDING' && <div className="text-sm font-black text-violet-100">격돌이 진행 중이라 기다리는 중입니다. 격돌이 끝나면 바로 시작돼요.</div>}
        </div>
      )}

      {/* 마지막 각인 결과 + 타락 회복량(교사만) */}
      {latest && !session?.open && (
        <div className="mt-3 rounded-card-md border border-white/12 bg-black/25 p-3 text-sm font-bold text-violet-50">
          <div className="font-black text-white">
            마지막 각인({latest.seq_no}번째) ·{' '}
            {latest.phase === 'CANCELLED'
              ? '취소됨'
              : latest.outcome === 'SUCCESS'
                ? <span className="text-yellow-100">성공</span>
                : <span className="text-violet-200">실패</span>}
            {latest.outcome_reason ? ` (${OUTCOME_REASON_LABEL[latest.outcome_reason] ?? latest.outcome_reason})` : ''}
          </div>
          {latest.outcome === 'SUCCESS' && (
            <div className="mt-1 text-xs">
              보스 피해 {Number(latest.boss_damage ?? 0).toLocaleString('ko-KR')}{latest.boss_damage_capped ? ' (격돌 50% 선을 넘지 않게 줄임)' : ''} · 공명방벽 회복 {Number(latest.barrier_heal ?? 0).toLocaleString('ko-KR')}
            </div>
          )}
          {latest.corruptions.length > 0 && (
            <div className="mt-1 text-xs">
              😈 타락 {latest.corruptions.length}명 · 보스 회복 합계 <b className="text-white">{healTotal.toLocaleString('ko-KR')}</b>
              <span className="ml-1 text-violet-200">
                ({latest.corruptions.map((item) => `${item.student_name} +${Number(item.healed_amount ?? 0).toLocaleString('ko-KR')}`).join(', ')})
              </span>
              <div className="mt-0.5 text-[11px] text-white/60">회복량은 선생님 화면에서만 보입니다.</div>
            </div>
          )}
        </div>
      )}

      {message && (
        <div className={cn('mt-2 text-sm font-black', message.tone === 'ok' ? 'text-emerald-200' : 'text-red-200')}>{message.text}</div>
      )}
    </section>
  );
}
