// RAID_V15_E4A_BROADCAST_PAGE
// RAID_V15_E4B_PARTICIPANT_MECHANICS
// RAID_V15_E4C_REALTIME_FEEDBACK
// RAID_V15_E4D_AUDIO_MIXER
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { LoadingSpinner } from '@/components/shared/components';
import {
  raidAdminRpc,
  type RaidElement,
  type RaidStatus,
  type TeacherRaidBroadcastState,
} from '@/lib/rpc/raid_admin_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { RaidBroadcastAudioEngine } from './RaidBroadcastAudio';


type FeedbackTier = 'NORMAL' | 'CRIT' | 'POWERFUL' | 'DEVASTATING';
type RealtimeStatus = 'CONNECTING' | 'SUBSCRIBED' | 'FALLBACK';

type BroadcastFeedbackRow = {
  id: number;
  raid_id: number;
  event_kind: 'ATTACK' | 'COMBAT';
  event_type: string;
  participant_id: number | null;
  student_id: number | null;
  amount: number;
  impact_tier: FeedbackTier | null;
  payload: Record<string, unknown>;
  created_at: string;
};

type ParticipantReaction = {
  tier: FeedbackTier;
  damage: number;
  until: number;
};

type ImpactBurst = {
  id: number;
  studentId: number | null;
  damage: number;
  tier: FeedbackTier;
  until: number;
  lane: number;
};

type CombatAnnouncement = {
  id: string;
  title: string;
  detail: string;
  tone: 'danger' | 'success' | 'warning' | 'cyan' | 'violet';
  until: number;
};

type RuntimeTarget = {
  index?: number;
  key: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  max_hp: number;
  current_hp: number;
};

export default function RaidBroadcastPage() {
  const { raidId: rawRaidId } = useParams<{ raidId: string }>();
  const raidId = Number(rawRaidId);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const previousBarrierHp = useRef<number | null>(null);
  const [barrierImpactUntil, setBarrierImpactUntil] = useState(0);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('CONNECTING');
  const [participantReactions, setParticipantReactions] = useState<Record<number, ParticipantReaction>>({});
  const [impactBursts, setImpactBursts] = useState<ImpactBurst[]>([]);
  const [combatAnnouncements, setCombatAnnouncements] = useState<CombatAnnouncement[]>([]);
  const [teamPulseUntil, setTeamPulseUntil] = useState(0);
  const [bossImpactUntil, setBossImpactUntil] = useState(0);
  const [bossImpactTier, setBossImpactTier] = useState<FeedbackTier>('NORMAL');
  const lastNormalBurstAt = useRef(0);
  const audioEngineRef = useRef<RaidBroadcastAudioEngine | null>(null);
  const previousAudioRaidStatus = useRef<RaidStatus | null>(null);
  const previousAudioBarrierState = useRef<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const broadcastQuery = useQuery({
    queryKey: ['teacher-raid-broadcast', raidId],
    enabled: Number.isFinite(raidId) && raidId > 0,
    queryFn: async () => {
      const result = await raidAdminRpc.broadcastState(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 250,
    refetchInterval: 1000,
    refetchOnWindowFocus: true,
  });

  const audioProfileQuery = useQuery({
    queryKey: ['teacher-raid-audio-profile', raidId],
    enabled: Number.isFinite(raidId) && raidId > 0,
    queryFn: async () => {
      const result = await raidAdminRpc.audioProfile(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const state = broadcastQuery.data;
  const audioProfile = audioProfileQuery.data;

  const handleRealtimeFeedback = useCallback((row: BroadcastFeedbackRow) => {
    audioEngineRef.current?.handleFeedback(row);
    const now = Date.now();
    if (row.event_kind === 'ATTACK') {
      const tier: FeedbackTier = row.impact_tier ?? 'NORMAL';
      const damage = Math.max(0, Number(row.amount ?? row.payload?.damage ?? 0));
      const studentId = row.student_id == null ? null : Number(row.student_id);
      const reactionMs = tier === 'DEVASTATING' ? 1800 : tier === 'POWERFUL' ? 1450 : tier === 'CRIT' ? 1250 : 850;

      if (studentId != null && Number.isFinite(studentId)) {
        setParticipantReactions((current) => ({
          ...current,
          [studentId]: { tier, damage, until: now + reactionMs },
        }));
      }

      const allowBurst = tier !== 'NORMAL' || now - lastNormalBurstAt.current >= 180;
      if (allowBurst) {
        if (tier === 'NORMAL') lastNormalBurstAt.current = now;
        setImpactBursts((current) => [
          ...current.slice(-7),
          {
            id: Number(row.id),
            studentId,
            damage,
            tier,
            until: now + (tier === 'DEVASTATING' ? 1350 : tier === 'POWERFUL' ? 1150 : 900),
            lane: Number(row.id) % 5,
          },
        ]);
      }

      if (tier !== 'NORMAL') {
        setBossImpactTier(tier);
        setBossImpactUntil(now + (tier === 'DEVASTATING' ? 720 : tier === 'POWERFUL' ? 560 : 420));
      }
      return;
    }

    const event = String(row.event_type || '');
    if (event === 'BARRIER_DAMAGED' || event === 'BOSS_ATTACK_RESOLVED') {
      setBarrierImpactUntil(now + 760);
    }
    if (event === 'BREAK_SUCCESS' || event.endsWith('_SUCCESS') || event === 'GROGGY_STARTED') {
      setTeamPulseUntil(now + 1500);
    }

    const announcement = combatAnnouncementFor(row, now);
    if (announcement) {
      setCombatAnnouncements((current) => [...current.slice(-3), announcement]);
    }
  }, []);

  useEffect(() => {
    if (!Number.isFinite(raidId) || raidId <= 0) return;
    setRealtimeStatus('CONNECTING');
    const channel = supabase
      .channel(`raid-broadcast-feedback-${raidId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'raid_broadcast_feedback',
          filter: `raid_id=eq.${raidId}`,
        },
        (payload) => handleRealtimeFeedback(payload.new as BroadcastFeedbackRow),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('SUBSCRIBED');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeStatus('FALLBACK');
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [raidId, handleRealtimeFeedback]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!state?.server_now) return;
    const serverNow = Date.parse(state.server_now);
    if (Number.isFinite(serverNow)) setServerOffsetMs(serverNow - Date.now());
  }, [state?.server_now]);

  useEffect(() => {
    const current = Number(state?.combat.barrier_current_hp ?? 0);
    if (state?.combat.barrier_enabled && previousBarrierHp.current !== null && current < previousBarrierHp.current) {
      setBarrierImpactUntil(Date.now() + 720);
    }
    previousBarrierHp.current = state?.combat.barrier_enabled ? current : null;
  }, [state?.combat.barrier_current_hp, state?.combat.barrier_enabled]);

  useEffect(() => {
    audioEngineRef.current?.setProfile(audioProfile);
  }, [audioProfile]);

  useEffect(() => () => {
    audioEngineRef.current?.dispose();
    audioEngineRef.current = null;
  }, []);

  useEffect(() => {
    if (!audioEnabled || !state || !audioEngineRef.current) return;
    const previousStatus = previousAudioRaidStatus.current;
    const playRaidStart = previousStatus === 'LOBBY_OPEN' && state.raid.status === 'ACTIVE';
    void audioEngineRef.current.syncRaidState(state.raid.status, state.combat.enrage_active, { playRaidStart });
    previousAudioRaidStatus.current = state.raid.status;
  }, [audioEnabled, state?.raid.status, state?.combat.enrage_active]);

  useEffect(() => {
    if (!audioEnabled || !state || !audioEngineRef.current) return;
    const currentState = state.combat.barrier_state;
    if (currentState === 'CRITICAL' && previousAudioBarrierState.current !== 'CRITICAL') {
      audioEngineRef.current.playBarrierCritical();
    }
    previousAudioBarrierState.current = currentState;
  }, [audioEnabled, state?.combat.barrier_state]);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  const correctedNow = state?.raid.status === 'PAUSED' && state.server_now
    ? Date.parse(state.server_now)
    : clockNow + serverOffsetMs;
  const timer = useMemo(
    () => getTimerDisplay(state, correctedNow),
    [state, correctedNow],
  );

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await screenRef.current?.requestFullscreen();
      }
    } catch {
      // Browser fullscreen permission failures should not block broadcast rendering.
    }
  };

  const enableAudio = async () => {
    setAudioError(null);
    const engine = audioEngineRef.current ?? new RaidBroadcastAudioEngine();
    audioEngineRef.current = engine;
    engine.setProfile(audioProfile);
    try {
      const unlocked = await engine.unlock();
      if (!unlocked) {
        setAudioError('이 브라우저에서 AudioContext를 사용할 수 없습니다.');
        return;
      }
      engine.setMuted(false);
      setAudioEnabled(true);
      setAudioMuted(false);
      previousAudioRaidStatus.current = state?.raid.status ?? null;
      previousAudioBarrierState.current = state?.combat.barrier_state ?? null;
      if (state) {
        await engine.syncRaidState(state.raid.status, state.combat.enrage_active, { playRaidStart: false });
        if (state.combat.barrier_state === 'CRITICAL') engine.playBarrierCritical();
      }
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : '사운드 활성화에 실패했습니다.');
    }
  };

  const toggleAudioMute = () => {
    if (!audioEngineRef.current || !audioEnabled) return;
    const next = !audioMuted;
    audioEngineRef.current.setMuted(next);
    setAudioMuted(next);
  };

  if (!Number.isFinite(raidId) || raidId <= 0) {
    return <BroadcastError title="잘못된 레이드 중계 주소입니다." />;
  }

  if (broadcastQuery.isLoading || !state) {
    if (broadcastQuery.isError) {
      return (
        <BroadcastError
          title="레이드 중계 정보를 불러오지 못했습니다."
          detail={broadcastQuery.error instanceof Error ? broadcastQuery.error.message : '알 수 없는 오류'}
        />
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#02040a] text-white">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <div className="mt-4 text-sm font-black tracking-[0.12em] text-cyan-100">RAID BROADCAST LOADING</div>
        </div>
      </div>
    );
  }

  const raid = state.raid;
  const combat = state.combat;
  const hpPercent = clamp01(Number(raid.hp_ratio)) * 100;
  const barrierPercent = clamp01(Number(combat.barrier_ratio)) * 100;
  const activePattern = combat.active_pattern;
  const visibleParticipants = state.participants.slice(0, 24);
  const leftParticipants = visibleParticipants.slice(0, 12);
  const rightParticipants = visibleParticipants.slice(12, 24);
  const hiddenParticipantCount = Math.max(0, state.participants.length - 24);
  const barrierImpact = clockNow < barrierImpactUntil;
  const activeParticipantReactions = participantReactions;
  const activeBursts = impactBursts.filter((item) => item.until > clockNow);
  const activeAnnouncements = combatAnnouncements.filter((item) => item.until > clockNow);
  const teamPulse = clockNow < teamPulseUntil;
  const bossImpact = clockNow < bossImpactUntil;
  const participantNames = new Map(state.participants.map((participant) => [participant.student_id, participant.brand_name || participant.name]));
  const bossAttackSeconds = Number(combat.boss_attack?.seconds_until_next_attack ?? 999);
  const bossTelegraphSeconds = Number(combat.boss_attack?.telegraph_seconds ?? 3);
  const bossTelegraph = raid.status === 'ACTIVE' && bossAttackSeconds > 0 && bossAttackSeconds <= bossTelegraphSeconds;

  return (
    <div ref={screenRef} className="min-h-screen bg-black text-white">
      <main className="relative mx-auto aspect-video min-h-screen w-full max-w-[1920px] overflow-hidden bg-[#02040a]">
        <style>{`
          @keyframes raidBroadcastImpactFloat { 0% { opacity: 0; transform: translate(-50%, 18px) scale(.78); } 16% { opacity: 1; transform: translate(-50%, 0) scale(1.08); } 72% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -62px) scale(.94); } }
          @keyframes raidBroadcastShock { 0% { opacity: 0; transform: scale(.86); } 22% { opacity: 1; transform: scale(1.03); } 100% { opacity: 0; transform: scale(1.18); } }
          @keyframes raidBroadcastTeamPulse { 0%,100% { filter: brightness(1); } 45% { filter: brightness(1.65) saturate(1.25); } }
        `}</style>
        <BroadcastBossMedia state={state} />

        {bossImpact && (
          <div className={cn(
            'pointer-events-none absolute inset-[14%] z-[13] rounded-[50%] border-4',
            bossImpactTier === 'DEVASTATING'
              ? 'border-yellow-100/90 bg-yellow-200/12 shadow-[0_0_120px_rgba(250,204,21,0.68)]'
              : bossImpactTier === 'POWERFUL'
                ? 'border-cyan-100/80 bg-cyan-200/10 shadow-[0_0_100px_rgba(34,211,238,0.58)]'
                : 'border-yellow-200/70 bg-yellow-300/8 shadow-[0_0_80px_rgba(250,204,21,0.42)]',
          )} style={{ animation: 'raidBroadcastShock 720ms ease-out both' }} />
        )}
        <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(180deg,rgba(0,0,0,0.72)_0%,rgba(0,0,0,0.18)_22%,rgba(0,0,0,0.10)_62%,rgba(0,0,0,0.84)_100%)]" />
        <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(0,0,0,0.36)_100%)]" />

        {combat.barrier_state === 'CRITICAL' && raid.status === 'ACTIVE' && (
          <div className="pointer-events-none absolute inset-0 z-[14] border-[10px] border-red-500/30 shadow-[inset_0_0_90px_rgba(239,68,68,0.20)] animate-pulse" style={{ animationDuration: '2.8s' }} />
        )}
        {barrierImpact && (
          <div className="pointer-events-none absolute inset-0 z-[15] bg-red-600/20 shadow-[inset_0_0_120px_rgba(239,68,68,0.42)]" />
        )}

        <ParticipantRail participants={leftParticipants} side="left" correctedNow={correctedNow} reactions={activeParticipantReactions} teamPulse={teamPulse} />
        <ParticipantRail participants={rightParticipants} side="right" correctedNow={correctedNow} reactions={activeParticipantReactions} teamPulse={teamPulse} />
        {hiddenParticipantCount > 0 && (
          <div className="pointer-events-none absolute bottom-[18%] right-5 z-[35] rounded-full border border-white/25 bg-black/70 px-3 py-1 text-[10px] font-black text-white">+{hiddenParticipantCount}명</div>
        )}
        <RealtimeImpactLayer items={activeBursts} names={participantNames} />
        <CombatAnnouncementLayer items={activeAnnouncements} />
        {bossTelegraph && combat.boss_attack && <BossAttackTelegraph attack={combat.boss_attack} />}
        {activePattern && <BroadcastMechanicOverlay pattern={activePattern} />}

        <header className="pointer-events-none absolute inset-x-0 top-0 z-30 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-5 p-5 lg:p-7">
          <div className="min-w-0 rounded-card-lg border border-white/15 bg-black/58 px-5 py-4 backdrop-blur-md">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
              <span>RAID BROADCAST</span>
              <StatusPill status={raid.status} />
            </div>
            <div className="mt-1 truncate font-display text-xl text-white lg:text-2xl">{raid.title}</div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-sm font-black text-yellow-100">
              <span className="truncate">{raid.boss_name}</span>
              <span className="flex-none rounded-full border border-yellow-300/30 bg-yellow-400/10 px-2 py-0.5 text-xs">
                {elementLabel(raid.boss_element)}
              </span>
            </div>
          </div>

          <div className="min-w-[160px] rounded-card-lg border border-cyan-300/25 bg-[#06111e]/82 px-5 py-4 text-center shadow-[0_0_30px_rgba(34,211,238,0.08)] backdrop-blur-md">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100">{timer.label}</div>
            <div className="mt-1 font-mono text-3xl font-black tabular-nums text-white lg:text-4xl">{timer.value}</div>
            {combat.boss_attack?.seconds_until_next_attack != null && raid.status === 'ACTIVE' && (
              <div className="mt-1 text-[10px] font-black text-amber-100">
                {combat.boss_attack.name || '보스 공격'} {formatSeconds(Number(combat.boss_attack.seconds_until_next_attack))}
              </div>
            )}
          </div>

          <BarrierBroadcastHud state={state} percent={barrierPercent} />
        </header>

        <div className="pointer-events-none absolute left-1/2 top-[24%] z-30 flex -translate-x-1/2 flex-col items-center gap-2">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="rounded-full border border-white/20 bg-black/55 px-3 py-1 text-xs font-black text-white backdrop-blur">
              PHASE {raid.phase?.phase_no ?? 1}
            </div>
            {combat.enrage_active && (
              <div className="rounded-full border border-red-300/45 bg-red-600/25 px-3 py-1 text-xs font-black text-red-100 shadow-[0_0_22px_rgba(239,68,68,0.25)]">
                🔥 광폭화
              </div>
            )}
            {combat.groggy_active && (
              <div className="rounded-full border border-yellow-200/50 bg-yellow-400/20 px-3 py-1 text-xs font-black text-yellow-100">
                ✦ GROGGY ×{Number(combat.groggy_damage_multiplier || 1).toFixed(1)}
              </div>
            )}
          </div>
        </div>

        <section className="pointer-events-none absolute inset-x-[15%] bottom-7 z-30">
          <div className="rounded-card-lg border border-white/18 bg-black/70 p-4 shadow-2xl backdrop-blur-md lg:p-5">
            <div className="flex items-end justify-between gap-5">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-red-100">BOSS HP</div>
                <div className="mt-0.5 font-display text-xl text-white lg:text-2xl">{raid.boss_name}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-2xl font-black text-white lg:text-3xl">{hpPercent.toFixed(1)}%</div>
                <div className="font-mono text-[11px] font-black text-amber-100">
                  {formatNumber(raid.current_hp)} / {formatNumber(raid.max_hp)}
                </div>
              </div>
            </div>
            <div className="mt-3 h-5 overflow-hidden rounded-full border border-white/15 bg-black/70">
              <div
                className="h-full rounded-full bg-gradient-to-r from-red-700 via-orange-500 to-yellow-300 transition-[width] duration-300"
                style={{ width: `${hpPercent}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] font-black">
              <span className="text-cyan-100">출전 {combat.barrier_contributor_count || state.summary.participant_count}명</span>
              <span className="text-white">누적 피해 {formatNumber(state.summary.total_damage)}</span>
            </div>
          </div>
        </section>

        <div className="absolute bottom-4 left-4 z-50 flex flex-col gap-2 lg:left-5">
          <div className={cn(
            'rounded-card-md border px-3 py-1.5 text-[10px] font-black tracking-[0.12em] backdrop-blur',
            realtimeStatus === 'SUBSCRIBED'
              ? 'border-emerald-300/40 bg-emerald-950/70 text-emerald-100'
              : realtimeStatus === 'CONNECTING'
                ? 'border-cyan-300/35 bg-cyan-950/70 text-cyan-100'
                : 'border-amber-300/40 bg-amber-950/75 text-amber-100',
          )}>
            {realtimeStatus === 'SUBSCRIBED' ? '● LIVE REALTIME' : realtimeStatus === 'CONNECTING' ? '◌ REALTIME 연결 중' : '● POLLING FALLBACK'}
          </div>
          {!audioEnabled ? (
            <button
              type="button"
              onClick={() => void enableAudio()}
              className="rounded-card-md border border-fuchsia-300/45 bg-fuchsia-950/70 px-3 py-2 text-xs font-black text-fuchsia-100 backdrop-blur hover:bg-fuchsia-900/75"
            >
              🔊 사운드 활성화
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleAudioMute}
              className={cn(
                'rounded-card-md border px-3 py-2 text-left text-[10px] font-black backdrop-blur',
                audioMuted
                  ? 'border-amber-300/40 bg-amber-950/75 text-amber-100'
                  : 'border-fuchsia-300/45 bg-fuchsia-950/70 text-fuchsia-100',
              )}
            >
              <div>{audioMuted ? '🔇 SOUND MUTED' : '🔊 SOUND ON'}</div>
              <div className="mt-0.5 text-[8px] tracking-[0.1em] text-white">
                {audioProfile?.configured ? 'AUDIO PROFILE' : 'SYNTH FALLBACK'} · MASTER {Math.round(Number(audioProfile?.master_volume ?? 0.85) * 100)}%
              </div>
            </button>
          )}
          {audioError && (
            <div className="max-w-[220px] rounded-card-md border border-red-300/40 bg-red-950/80 px-3 py-2 text-[9px] font-black text-red-100">
              {audioError}
            </div>
          )}
          <Link
            to="/teacher/raid"
            className="rounded-card-md border border-white/20 bg-black/65 px-3 py-2 text-xs font-black text-white backdrop-blur hover:bg-black/80"
          >
            ← 통제실
          </Link>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="rounded-card-md border border-cyan-300/30 bg-cyan-950/65 px-3 py-2 text-xs font-black text-cyan-100 backdrop-blur hover:bg-cyan-900/70"
          >
            {fullscreen ? '▣ 전체화면 종료' : '⛶ 전체화면'}
          </button>
        </div>

        {raid.status !== 'ACTIVE' && <BroadcastStatusOverlay status={raid.status} endReason={raid.end_reason} />}
      </main>
    </div>
  );
}

function BroadcastBossMedia({ state }: { state: TeacherRaidBroadcastState }) {
  const image = state.raid.phase?.image_url ?? '';
  const video = state.raid.phase?.loop_video_url ?? '';
  const animatedImage = /\.(?:webp|gif|apng)(?:$|[?#])/i.test(video);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => setVideoFailed(false), [video]);

  return (
    <div className="absolute inset-0 z-0">
      {video && animatedImage ? (
        <img src={video} alt={state.raid.boss_name} className="h-full w-full object-cover" />
      ) : video && !videoFailed ? (
        <video
          src={video}
          poster={image || undefined}
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          onError={() => setVideoFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : image ? (
        <img src={image} alt={state.raid.boss_name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(30,64,175,0.28),rgba(2,4,10,1)_68%)] text-[120px]">👾</div>
      )}
    </div>
  );
}

function BarrierBroadcastHud({ state, percent }: { state: TeacherRaidBroadcastState; percent: number }) {
  const combat = state.combat;
  const tone = barrierTone(combat.barrier_state);
  return (
    <div className={cn('justify-self-end rounded-card-lg border px-5 py-4 backdrop-blur-md', tone.card)}>
      <div className="flex items-center justify-between gap-5">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.17em] text-cyan-100">RESONANCE BARRIER</div>
          <div className={cn('mt-1 text-sm font-black', tone.text)}>🛡 {barrierLabel(combat.barrier_state)}</div>
        </div>
        <div className={cn('font-mono text-2xl font-black', tone.text)}>{combat.barrier_enabled ? `${percent.toFixed(0)}%` : '—'}</div>
      </div>
      <div className="mt-3 h-3 min-w-[250px] overflow-hidden rounded-full border border-white/15 bg-black/55">
        <div className={cn('h-full rounded-full transition-[width] duration-300', tone.bar)} style={{ width: `${combat.barrier_enabled ? percent : 0}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-5 font-mono text-[10px] font-black text-white">
        <span>{combat.barrier_enabled ? `${formatNumber(combat.barrier_current_hp)} / ${formatNumber(combat.barrier_max_hp)}` : '전투 시작 시 생성'}</span>
        <span>{combat.barrier_contributor_count}명</span>
      </div>
    </div>
  );
}


function ParticipantRail({
  participants,
  side,
  correctedNow,
  reactions,
  teamPulse,
}: {
  participants: TeacherRaidBroadcastState['participants'];
  side: 'left' | 'right';
  correctedNow: number;
  reactions: Record<number, ParticipantReaction>;
  teamPulse: boolean;
}) {
  return (
    <aside
      className={cn(
        'pointer-events-none absolute top-[22%] bottom-[18%] z-30 flex w-[13.5%] min-w-[178px] flex-col justify-center gap-1.5',
        side === 'left' ? 'left-3 lg:left-5' : 'right-3 lg:right-5',
      )}
      style={teamPulse ? { animation: 'raidBroadcastTeamPulse 740ms ease-in-out 2' } : undefined}
    >
      {participants.map((participant) => (
        <ParticipantCard
          key={participant.participant_id}
          participant={participant}
          correctedNow={correctedNow}
          side={side}
          reaction={reactions[participant.student_id]}
        />
      ))}
    </aside>
  );
}

function ParticipantCard({
  participant,
  correctedNow,
  side,
  reaction,
}: {
  participant: TeacherRaidBroadcastState['participants'][number];
  correctedNow: number;
  side: 'left' | 'right';
  reaction?: ParticipantReaction;
}) {
  const latestAt = participant.latest_batch?.created_at ? Date.parse(participant.latest_batch.created_at) : NaN;
  const recent = Number.isFinite(latestAt) && correctedNow - latestAt <= 2200 && correctedNow >= latestAt - 1200;
  const recentCrit = recent && Number(participant.latest_batch?.crit_count ?? 0) > 0;
  const realtimeActive = Boolean(reaction && reaction.until > Date.now());
  const realtimeCrit = realtimeActive && reaction?.tier === 'CRIT';
  const realtimePowerful = realtimeActive && reaction?.tier === 'POWERFUL';
  const realtimeDevastating = realtimeActive && reaction?.tier === 'DEVASTATING';
  const name = participant.brand_name || participant.name;
  return (
    <div className={cn(
      'relative flex h-[46px] items-center gap-2 overflow-hidden rounded-card-md border bg-black/68 px-2 py-1.5 backdrop-blur-sm transition-all duration-200',
      side === 'right' && 'flex-row-reverse text-right',
      participant.attack_blocked
        ? 'border-red-400/45 opacity-55'
        : realtimeDevastating
          ? 'border-yellow-100 bg-yellow-900/85 shadow-[0_0_38px_rgba(250,204,21,0.90)] scale-[1.045]'
          : realtimePowerful
            ? 'border-cyan-100 bg-cyan-900/80 shadow-[0_0_32px_rgba(34,211,238,0.72)] scale-[1.025]'
            : realtimeCrit || recentCrit
              ? 'border-yellow-200/90 bg-yellow-950/70 shadow-[0_0_28px_rgba(250,204,21,0.58)]'
              : realtimeActive || recent
                ? 'border-cyan-200/80 bg-cyan-950/65 shadow-[0_0_22px_rgba(34,211,238,0.42)]'
                : participant.barrier_contributor
                  ? 'border-cyan-300/24'
                  : 'border-white/12 opacity-72',
    )}>
      <div className="h-9 w-9 flex-none overflow-hidden rounded-lg border border-white/15 bg-[#07111f]">
        {participant.character_image_url ? (
          <img src={participant.character_image_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg">⚔️</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="truncate text-[10px] font-black text-white">{name}</div>
          {realtimeDevastating ? <span className="flex-none text-[9px] font-black text-yellow-100">압도!</span> : realtimePowerful ? <span className="flex-none text-[9px] font-black text-cyan-100">강타!</span> : (realtimeCrit || recentCrit) ? <span className="flex-none text-[10px] font-black text-yellow-200">CRIT!</span> : null}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[8px] font-black text-cyan-100">
          <span className="truncate">{participant.guild_name || '무소속'}</span>
          <span className="flex-none font-mono text-yellow-100">{formatNumber(participant.total_damage)}</span>
        </div>
      </div>
    </div>
  );
}


function RealtimeImpactLayer({ items, names }: { items: ImpactBurst[]; names: Map<number, string> }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[44] overflow-hidden">
      {items.map((item) => {
        const left = [42, 48, 54, 59, 46][item.lane] ?? 50;
        const top = [44, 39, 47, 42, 51][item.lane] ?? 45;
        const label = item.studentId == null ? '' : names.get(item.studentId) || '';
        const tierClass = item.tier === 'DEVASTATING'
          ? 'text-5xl text-yellow-200 drop-shadow-[0_0_18px_rgba(250,204,21,0.85)]'
          : item.tier === 'POWERFUL'
            ? 'text-4xl text-cyan-100 drop-shadow-[0_0_16px_rgba(34,211,238,0.80)]'
            : item.tier === 'CRIT'
              ? 'text-4xl text-yellow-300 drop-shadow-[0_0_14px_rgba(250,204,21,0.72)]'
              : 'text-2xl text-white drop-shadow-[0_3px_7px_rgba(0,0,0,0.95)]';
        return (
          <div
            key={item.id}
            className="absolute text-center"
            style={{ left: `${left}%`, top: `${top}%`, animation: 'raidBroadcastImpactFloat 900ms ease-out both' }}
          >
            {item.tier !== 'NORMAL' && (
              <div className="mb-0.5 text-[10px] font-black tracking-[0.14em] text-white">
                {item.tier === 'DEVASTATING' ? '압도적 일격!' : item.tier === 'POWERFUL' ? '강력한 일격!' : 'CRITICAL!'}
              </div>
            )}
            <div className={cn('font-mono font-black', tierClass)}>{formatNumber(item.damage)}</div>
            {label && <div className="mt-0.5 text-[9px] font-black text-cyan-100">{label}</div>}
          </div>
        );
      })}
    </div>
  );
}

function CombatAnnouncementLayer({ items }: { items: CombatAnnouncement[] }) {
  const item = items.at(-1);
  if (!item) return null;
  const toneClass = {
    danger: 'border-red-200/80 bg-red-950/92 text-red-50 shadow-[0_0_60px_rgba(239,68,68,0.42)]',
    success: 'border-emerald-200/80 bg-emerald-950/92 text-emerald-50 shadow-[0_0_60px_rgba(16,185,129,0.38)]',
    warning: 'border-yellow-100/80 bg-amber-950/92 text-yellow-50 shadow-[0_0_60px_rgba(245,158,11,0.40)]',
    cyan: 'border-cyan-100/80 bg-cyan-950/92 text-cyan-50 shadow-[0_0_60px_rgba(34,211,238,0.36)]',
    violet: 'border-fuchsia-200/80 bg-[#24072f]/94 text-fuchsia-50 shadow-[0_0_60px_rgba(217,70,239,0.38)]',
  }[item.tone];
  return (
    <div className="pointer-events-none absolute left-1/2 top-[38%] z-[48] -translate-x-1/2">
      <div className={cn('min-w-[360px] rounded-card-lg border-2 px-7 py-4 text-center backdrop-blur-md', toneClass)}>
        <div className="font-display text-3xl text-white">{item.title}</div>
        <div className="mt-1 text-xs font-black text-yellow-100">{item.detail}</div>
      </div>
    </div>
  );
}

function combatAnnouncementFor(row: BroadcastFeedbackRow, now: number): CombatAnnouncement | null {
  const event = String(row.event_type || '');
  const payload = row.payload ?? {};
  const patternName = String(payload.pattern_name ?? payload.attack_name ?? '');
  const amount = Math.max(0, Number(row.amount ?? 0));
  const make = (title: string, detail: string, tone: CombatAnnouncement['tone'], ms = 1700): CombatAnnouncement => ({
    id: `${row.id}-${event}`,
    title,
    detail,
    tone,
    until: now + ms,
  });

  if (event === 'BARRIER_COLLAPSED') return make('💥 공명방벽 붕괴', '공명방벽이 완전히 파괴되었습니다.', 'danger', 2600);
  if (event === 'BOSS_ATTACK_RESOLVED') return make(`⚡ ${patternName || '보스 공격'}`, amount > 0 ? `공명방벽 -${formatNumber(amount)}` : '보스 공격이 적중했습니다.', 'danger', 1150);
  if (event === 'BREAK_SUCCESS') return make('✦ BREAK SUCCESS', '보스의 자세가 무너졌습니다. 극딜 시간!', 'success', 2100);
  if (event === 'BREAK_FAILED') return make('⚠ BREAK FAILED', '브레이크 저지 실패 — 공명방벽 피해!', 'danger', 2100);
  if (event === 'GROGGY_STARTED') return make('✦ GROGGY', '보스가 무방비 상태에 빠졌습니다.', 'warning', 1600);
  if (event === 'ENRAGE_STARTED') return make('🔥 ENRAGE', '보스가 광폭화했습니다!', 'danger', 2200);
  if (event === 'PATTERN_STARTED') return make(`⚠ ${patternName || '특수 패턴'}`, '특수 기믹이 시작됩니다.', 'violet', 1100);
  if (event === 'PATTERN_ENDED') return null;
  if (event.endsWith('_SUCCESS')) return make('✓ 기믹 성공', `${patternEventLabel(event)} 돌파`, 'success', 1650);
  if (event.endsWith('_FAILED')) return make('✕ 기믹 실패', `${patternEventLabel(event)} 실패`, 'danger', 1850);
  if (event === 'BARRIER_INITIALIZED') return make('🛡 공명방벽 전개', '출전 모험가의 공명이 하나로 연결됩니다.', 'cyan', 1800);
  return null;
}

function patternEventLabel(event: string) {
  const key = event.replace(/_(SUCCESS|FAILED)$/, '');
  const labels: Record<string, string> = {
    ULTIMATE: '필살기 차단',
    DOT: '지속 피해 차단',
    SHIELD: '보호막',
    MULTI_CORE: '다중 핵',
    SPLIT_TARGET: '분산 공격',
    REGEN: '재생',
    SEAL: '봉인',
    DAMAGE_CHECK: '화력 검증',
    BREAK: 'BREAK',
  };
  return labels[key] ?? key;
}

function BossAttackTelegraph({ attack }: { attack: NonNullable<TeacherRaidBroadcastState['combat']['boss_attack']> }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[18%] z-40 w-[min(560px,52vw)] -translate-x-1/2 rounded-card-lg border-2 border-red-300/70 bg-red-950/90 px-6 py-3 text-center shadow-[0_0_55px_rgba(239,68,68,0.35)] backdrop-blur-md animate-pulse" style={{ animationDuration: '1.4s' }}>
      <div className="text-[10px] font-black tracking-[0.22em] text-red-100">BOSS ATTACK</div>
      <div className="mt-1 font-display text-2xl text-white">⚠ {attack.name || '보스 공격'} 준비</div>
      <div className="mt-1 font-mono text-xl font-black text-yellow-100">{Number(attack.seconds_until_next_attack ?? 0).toFixed(1)}초</div>
    </div>
  );
}

function BroadcastMechanicOverlay({ pattern }: { pattern: NonNullable<TeacherRaidBroadcastState['combat']['active_pattern']> }) {
  const type = pattern.pattern_type;
  const state = pattern.state ?? {};
  const seconds = Number(pattern.seconds_remaining ?? 0);

  if (type === 'WEAK_POINT') {
    const target = runtimeTarget({ key: 'WEAK', label: '약점', ...state, max_hp: 1, current_hp: 1 });
    return (
      <>
        <MechanicBanner eyebrow="WEAK POINT" title="🎯 약점 노출" description={`약점 공격 ×${patternNumber(state, 'multiplier', 2).toFixed(1)}`} seconds={seconds} tone="cyan" />
        {target && <BroadcastTargetMarker target={target} tone="cyan" hideHp />}
      </>
    );
  }
  if (type === 'BREAK' || type === 'ULTIMATE') {
    return <BroadcastObjectiveHud eyebrow={type} title={pattern.name} current={patternNumber(state, 'objective_current_hp', 1)} max={patternNumber(state, 'objective_max_hp', 1)} seconds={seconds} tone="danger" />;
  }
  if (type === 'ABSORB') {
    return <MechanicBanner eyebrow="ABSORB" title="⚠ 공격 중지 — 마력 흡수" description={`공격 피해의 ${(patternNumber(state, 'heal_ratio', 1) * 100).toFixed(0)}%만큼 Boss가 회복`} seconds={seconds} tone="violet" />;
  }
  if (type === 'REFLECT') {
    return <MechanicBanner eyebrow="REFLECT" title="↩ 반격 태세" description={`공격 피해의 ${(patternNumber(state, 'reflect_ratio', 0.3) * 100).toFixed(0)}%가 공명방벽에 반사`} seconds={seconds} tone="danger" />;
  }
  if (type === 'DOT') {
    const target = runtimeTarget(state.interrupt_target);
    return <><MechanicBanner eyebrow="DOT" title="☠ 공명방벽 지속 피해" description={target ? `${target.label}을 파괴해 피해를 중단` : '공명방벽이 계속 감소합니다.'} seconds={seconds} tone="danger" />{target && target.current_hp > 0 && <BroadcastTargetMarker target={target} tone="danger" />}</>;
  }
  if (type === 'SHIELD') {
    return <BroadcastObjectiveHud eyebrow="SHIELD" title="🛡 Boss 보호막" current={patternNumber(state, 'shield_current_hp', 1)} max={patternNumber(state, 'shield_max_hp', 1)} seconds={seconds} tone="cyan" />;
  }
  if (type === 'MULTI_CORE') {
    const targets = runtimeTargets(state.cores);
    const mode = String(state.mode ?? 'FIXED_ORDER');
    const expected = Math.max(0, Math.floor(patternNumber(state, 'expected_index', 0)));
    return <><MechanicBanner eyebrow="MULTI CORE" title="✦ 다중 마력핵" description={mode === 'ANY_ORDER' ? '모든 핵을 파괴' : '표시된 순서대로 핵을 파괴'} seconds={seconds} tone="warning" />{targets.map((target, index) => <BroadcastTargetMarker key={target.key} target={target} tone={target.current_hp <= 0 ? 'done' : index === expected || mode === 'ANY_ORDER' ? 'warning' : 'muted'} badge={mode === 'ANY_ORDER' ? undefined : `${index + 1}`} />)}</>;
  }
  if (type === 'SPLIT_TARGET') {
    const targets = runtimeTargets(state.targets);
    const ratios = targets.map((t) => t.max_hp > 0 ? 1 - t.current_hp / t.max_hp : 0);
    const spread = ratios.length > 1 ? (Math.max(...ratios) - Math.min(...ratios)) * 100 : 0;
    const maxDiff = patternNumber(state, 'max_difference_percent', 25);
    return <><MechanicBanner eyebrow="SPLIT TARGET" title="⚖ 분산 공격" description={`좌우 균형 유지 · 격차 ${spread.toFixed(0)}% / 허용 ${maxDiff.toFixed(0)}%`} seconds={seconds} tone={spread > maxDiff ? 'danger' : 'cyan'} />{targets.map((target) => <BroadcastTargetMarker key={target.key} target={target} tone={target.current_hp <= 0 ? 'done' : 'cyan'} />)}</>;
  }
  if (type === 'REGEN') {
    const target = runtimeTarget(state.core);
    return <><MechanicBanner eyebrow="REGEN" title="✚ Boss 재생" description={target ? `${target.label}을 파괴해 재생 중단` : 'Boss HP가 지속 회복 중'} seconds={seconds} tone="green" />{target && target.current_hp > 0 && <BroadcastTargetMarker target={target} tone="green" />}</>;
  }
  if (type === 'SEAL') {
    const targets = runtimeTargets(state.seals);
    return <><MechanicBanner eyebrow="SEAL" title="🔒 Boss 봉인" description={`봉인 중 Boss 피해 ${(patternNumber(state, 'damage_reduction', 0.7) * 100).toFixed(0)}% 감소`} seconds={seconds} tone="violet" />{targets.map((target) => <BroadcastTargetMarker key={target.key} target={target} tone={target.current_hp <= 0 ? 'done' : 'violet'} />)}</>;
  }
  if (type === 'DAMAGE_CHECK') {
    const target = Math.max(1, patternNumber(state, 'target_damage', 1));
    const dealt = Math.max(0, patternNumber(state, 'damage_dealt', 0));
    return <BroadcastObjectiveHud eyebrow="DAMAGE CHECK" title="🔥 화력 검증" current={Math.max(0, target - dealt)} max={target} seconds={seconds} tone="warning" remainingMode />;
  }
  return <MechanicBanner eyebrow={type} title={`${patternIcon(type)} ${pattern.name}`} description="특수 패턴 진행 중" seconds={seconds} tone="violet" />;
}

function MechanicBanner({ eyebrow, title, description, seconds, tone }: { eyebrow: string; title: string; description: string; seconds: number; tone: 'danger' | 'warning' | 'cyan' | 'violet' | 'green' }) {
  const toneClass = {
    danger: 'border-red-300/70 bg-red-950/90 shadow-[0_0_48px_rgba(239,68,68,0.30)]',
    warning: 'border-yellow-200/65 bg-amber-950/90 shadow-[0_0_48px_rgba(245,158,11,0.25)]',
    cyan: 'border-cyan-200/65 bg-cyan-950/90 shadow-[0_0_48px_rgba(34,211,238,0.24)]',
    violet: 'border-fuchsia-300/65 bg-[#21072d]/92 shadow-[0_0_48px_rgba(217,70,239,0.27)]',
    green: 'border-emerald-300/65 bg-emerald-950/90 shadow-[0_0_48px_rgba(16,185,129,0.24)]',
  }[tone];
  return <div className={cn('pointer-events-none absolute left-1/2 top-[28%] z-[39] w-[min(620px,52vw)] -translate-x-1/2 rounded-card-lg border-2 px-6 py-3 text-center backdrop-blur-md', toneClass)}><div className="text-[10px] font-black tracking-[0.22em] text-white/80">{eyebrow}</div><div className="mt-1 font-display text-2xl text-white">{title}</div><div className="mt-1 text-xs font-black text-yellow-100">{description}</div><div className="mt-2 font-mono text-lg font-black text-white">{seconds.toFixed(1)}초</div></div>;
}

function BroadcastObjectiveHud({ eyebrow, title, current, max, seconds, tone, remainingMode = false }: { eyebrow: string; title: string; current: number; max: number; seconds: number; tone: 'danger' | 'warning' | 'cyan'; remainingMode?: boolean }) {
  const safeMax = Math.max(1, max);
  const safeCurrent = Math.max(0, Math.min(safeMax, current));
  const width = (remainingMode ? 1 - safeCurrent / safeMax : safeCurrent / safeMax) * 100;
  const toneClass = tone === 'danger' ? 'border-red-300/70 bg-red-950/90' : tone === 'warning' ? 'border-yellow-200/65 bg-amber-950/90' : 'border-cyan-200/65 bg-cyan-950/90';
  return <div className={cn('pointer-events-none absolute left-1/2 top-[26%] z-[39] w-[min(620px,52vw)] -translate-x-1/2 rounded-card-lg border-2 p-4 shadow-2xl backdrop-blur-md', toneClass)}><div className="flex items-center justify-between"><div><div className="text-[10px] font-black tracking-[0.2em] text-white/75">{eyebrow}</div><div className="mt-1 font-display text-xl text-white">{title}</div></div><div className="font-mono text-xl font-black text-white">{seconds.toFixed(1)}초</div></div><div className="mt-3 h-5 overflow-hidden rounded-full border border-white/20 bg-black/55"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-yellow-300 to-red-400 transition-[width] duration-200" style={{ width: `${Math.max(0, Math.min(100, width))}%` }} /></div><div className="mt-1 text-right font-mono text-[11px] font-black text-white">{remainingMode ? `${formatNumber(safeMax - safeCurrent)} / ${formatNumber(safeMax)}` : `${formatNumber(safeCurrent)} / ${formatNumber(safeMax)}`}</div></div>;
}

function BroadcastTargetMarker({ target, tone, badge, hideHp = false }: { target: RuntimeTarget; tone: 'danger' | 'warning' | 'cyan' | 'violet' | 'green' | 'done' | 'muted'; badge?: string; hideHp?: boolean }) {
  const hpRatio = target.max_hp > 0 ? target.current_hp / target.max_hp : 0;
  const toneClass = {
    danger: 'border-red-200/90 bg-red-500/15 shadow-[0_0_34px_rgba(239,68,68,0.48)]',
    warning: 'border-yellow-100/95 bg-yellow-300/15 shadow-[0_0_36px_rgba(250,204,21,0.52)]',
    cyan: 'border-cyan-100/90 bg-cyan-300/12 shadow-[0_0_34px_rgba(34,211,238,0.45)]',
    violet: 'border-fuchsia-200/90 bg-fuchsia-400/12 shadow-[0_0_34px_rgba(217,70,239,0.45)]',
    green: 'border-emerald-200/90 bg-emerald-400/12 shadow-[0_0_34px_rgba(16,185,129,0.45)]',
    done: 'border-emerald-300/25 bg-emerald-950/20 opacity-35',
    muted: 'border-white/25 bg-black/15 opacity-55',
  }[tone];
  return <div className={cn('pointer-events-none absolute z-[35] flex items-center justify-center rounded-[28px] border-4 transition-all duration-200', toneClass)} style={{ left: `${Math.max(0, Math.min(1, target.x)) * 100}%`, top: `${Math.max(0, Math.min(1, target.y)) * 100}%`, width: `${Math.max(0.04, Math.min(1 - target.x, target.width)) * 100}%`, height: `${Math.max(0.04, Math.min(1 - target.y, target.height)) * 100}%` }}><div className="relative min-w-[100px] rounded-card-md border border-white/25 bg-black/78 px-3 py-2 text-center backdrop-blur-sm">{badge && <div className="absolute -left-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full border-2 border-yellow-100 bg-black text-sm font-black text-yellow-100">{badge}</div>}<div className="text-[11px] font-black text-white">{target.current_hp <= 0 ? '✓ ' : ''}{target.label}</div>{!hideHp && <><div className="mt-0.5 font-mono text-[10px] font-black text-cyan-100">{formatNumber(target.current_hp)} / {formatNumber(target.max_hp)}</div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/60"><div className="h-full bg-yellow-300 transition-[width] duration-200" style={{ width: `${Math.max(0, Math.min(100, hpRatio * 100))}%` }} /></div></>}</div></div>;
}

function patternNumber(source: Record<string, unknown>, key: string, fallback = 0) {
  const value = Number(source[key]);
  return Number.isFinite(value) ? value : fallback;
}

function runtimeTarget(value: unknown): RuntimeTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const maxHp = Math.max(1, Number(source.max_hp ?? 1));
  const currentHp = Math.max(0, Math.min(maxHp, Number(source.current_hp ?? maxHp)));
  return { index: Number.isFinite(Number(source.index)) ? Number(source.index) : undefined, key: String(source.key ?? 'TARGET'), label: String(source.label ?? source.key ?? '목표'), x: Number(source.x ?? 0.4), y: Number(source.y ?? 0.4), width: Number(source.width ?? 0.16), height: Number(source.height ?? 0.2), max_hp: maxHp, current_hp: currentHp };
}

function runtimeTargets(value: unknown): RuntimeTarget[] {
  if (!Array.isArray(value)) return [];
  return value.map(runtimeTarget).filter((item): item is RuntimeTarget => item !== null);
}

function BroadcastStatusOverlay({ status, endReason }: { status: RaidStatus; endReason: string | null }) {
  if (status === 'ACTIVE') return null;
  const view = {
    DRAFT: ['🛠', '중계 준비 중', 'Raid 초안 상태입니다.'],
    LOBBY_OPEN: ['🚪', '모험가 집결 중', '로비가 열려 있습니다.'],
    PAUSED: ['⏸', '레이드 일시정지', '운영국에서 전투를 잠시 정지했습니다.'],
    COMPLETED: ['🏆', '보스 토벌 완료', 'Raid가 성공적으로 종료되었습니다.'],
    FAILED: ['💥', '레이드 실패', failureDescription(endReason)],
    ARCHIVED: ['📜', '종료된 레이드', '기록된 Raid 중계 화면입니다.'],
  }[status] ?? ['📺', 'Raid Broadcast', '중계 상태를 확인하고 있습니다.'];

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/34">
      <div className="mt-8 rounded-card-lg border border-white/20 bg-black/74 px-8 py-5 text-center shadow-2xl backdrop-blur-md">
        <div className="text-4xl">{view[0]}</div>
        <div className="mt-2 font-display text-2xl text-white">{view[1]}</div>
        <div className="mt-1 text-sm font-black text-cyan-100">{view[2]}</div>
      </div>
    </div>
  );
}

function BroadcastError({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#02040a] p-6 text-white">
      <div className="max-w-xl rounded-card-lg border border-red-300/35 bg-red-950/35 p-7 text-center">
        <div className="text-5xl">⚠️</div>
        <div className="mt-3 font-display text-xl">{title}</div>
        {detail && <div className="mt-2 break-all text-xs font-bold text-red-100">{detail}</div>}
        <Link to="/teacher/raid" className="mt-5 inline-block rounded-card-md border border-cyan-300/35 bg-cyan-500/10 px-4 py-2 text-xs font-black text-cyan-100">레이드 통제실</Link>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: RaidStatus }) {
  const labels: Record<RaidStatus, string> = {
    DRAFT: 'DRAFT',
    LOBBY_OPEN: 'LOBBY',
    ACTIVE: 'LIVE',
    PAUSED: 'PAUSED',
    COMPLETED: 'CLEAR',
    FAILED: 'FAILED',
    ARCHIVED: 'ARCHIVED',
  };
  return (
    <span className={cn(
      'rounded-full border px-2 py-0.5 text-[9px] tracking-[0.12em]',
      status === 'ACTIVE' ? 'border-emerald-300/45 bg-emerald-500/15 text-emerald-100' : 'border-white/20 bg-white/5 text-white',
    )}>{labels[status]}</span>
  );
}

function getTimerDisplay(state: TeacherRaidBroadcastState | undefined, nowMs: number) {
  if (!state) return { label: 'TIME', value: '--:--' };
  const { raid } = state;
  if (raid.status === 'ACTIVE' || raid.status === 'PAUSED') {
    if (raid.ends_at) {
      const remaining = Math.max(0, Date.parse(raid.ends_at) - nowMs);
      return { label: '남은 시간', value: formatDuration(remaining) };
    }
    if (raid.starts_at) {
      const elapsed = Math.max(0, nowMs - Date.parse(raid.starts_at));
      return { label: raid.status === 'PAUSED' ? '경과 시간 · PAUSED' : '경과 시간', value: formatDuration(elapsed) };
    }
  }
  if (raid.completed_at && raid.starts_at) {
    return { label: '전투 시간', value: formatDuration(Math.max(0, Date.parse(raid.completed_at) - Date.parse(raid.starts_at))) };
  }
  return { label: 'RAID TIME', value: '--:--' };
}

function barrierTone(state: TeacherRaidBroadcastState['combat']['barrier_state']) {
  if (state === 'COLLAPSED' || state === 'CRITICAL') return { card: 'border-red-300/45 bg-red-950/72', text: 'text-red-100', bar: 'bg-red-500' };
  if (state === 'DANGER') return { card: 'border-orange-300/40 bg-orange-950/68', text: 'text-orange-100', bar: 'bg-orange-400' };
  if (state === 'CRACKED') return { card: 'border-amber-300/35 bg-amber-950/62', text: 'text-amber-100', bar: 'bg-amber-300' };
  return { card: 'border-cyan-300/30 bg-cyan-950/62', text: 'text-cyan-100', bar: 'bg-cyan-300' };
}

function barrierLabel(state: TeacherRaidBroadcastState['combat']['barrier_state']) {
  return ({ DISABLED: '대기', STABLE: '안정', CRACKED: '균열', DANGER: '위험', CRITICAL: '붕괴 직전', COLLAPSED: '붕괴' } as const)[state];
}

function elementLabel(element: RaidElement) {
  return ({ FIRE: '🔥 화', WATER: '💧 수', WIND: '💫 풍', EARTH: '🪨 토', LIGHT: '✦ 빛', DARK: '☾ 암' } as const)[element];
}

function patternIcon(type: string) {
  return ({ WEAK_POINT: '🎯', BREAK: '💥', ENRAGE: '🔥', ABSORB: '🌀', REFLECT: '↩', ULTIMATE: '☄️', DOT: '☣️', SHIELD: '🛡', MULTI_CORE: '🔷', SPLIT_TARGET: '⚖️', REGEN: '💚', SEAL: '🔒', DAMAGE_CHECK: '⏱' } as Record<string, string>)[type] ?? '⚔️';
}

function failureDescription(reason: string | null) {
  if (reason === 'BARRIER_COLLAPSE') return '공명방벽이 완전히 붕괴했습니다.';
  if (reason === 'TIME_EXPIRED') return '제한시간이 종료되었습니다.';
  return 'Raid가 종료되었습니다.';
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatSeconds(value: number) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.max(0, value).toFixed(value < 10 ? 1 : 0)}s`;
}

function formatNumber(value: number) {
  return Number(value ?? 0).toLocaleString('ko-KR');
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
