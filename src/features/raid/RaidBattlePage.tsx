import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { LoadingSpinner } from '@/components/shared/components';
import {
  raidStudentRpc,
  type RaidBattleState,
  type RaidTapBatchResult,
} from '@/lib/rpc/raid_student_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { RaidResultModal } from '@/features/raid/RaidResultModal';
import { useRaidTapBatcher } from '@/features/raid/hooks/useRaidTapBatcher';

// RAID_V15_E15_BOSS_ATTACK_RUNTIME
// RAID_V15_E2_WEAK_BREAK_GROGGY_ENRAGE
// RAID_V15_E3C_SPECIAL_PATTERN_UI

type ImpactTier = 'normal' | 'crit' | 'powerful' | 'devastating';

interface DamageNumber {
  id: string;
  x: number;
  y: number;
  damage: number;
  crit: boolean;
  impactTier: ImpactTier;
  zoneKey?: string;
  patternMultiplier?: number;
}

interface PatternFeedback {
  id: string;
  x: number;
  y: number;
  text: string;
  tone: 'danger' | 'warning' | 'cyan' | 'violet' | 'green';
}

interface RuntimeTarget {
  index?: number;
  key: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  max_hp: number;
  current_hp: number;
  damage_dealt?: number;
}

interface BossImpact {
  seq: number;
  name: string;
  damage: number;
}

export default function RaidBattlePage() {
  const params = useParams<{ raidId: string }>();
  const raidId = Number(params.raidId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
  const [displayHp, setDisplayHp] = useState<number | null>(null);
  const [displayHpRatio, setDisplayHpRatio] = useState<number | null>(null);
  const [myDamage, setMyDamage] = useState<number | null>(null);
  const [battleError, setBattleError] = useState<string | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [bossImpact, setBossImpact] = useState<BossImpact | null>(null);
  const [patternFeedback, setPatternFeedback] = useState<PatternFeedback[]>([]);
  const damageTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastBossAttackSeqRef = useRef<number | null>(null);
  const bossImpactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patternFeedbackTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const serverClockOffsetRef = useRef(0);

  const battleQuery = useQuery({
    queryKey: ['raid-battle-state', raidId],
    enabled: Number.isFinite(raidId) && raidId > 0,
    queryFn: async () => {
      const result = await raidStudentRpc.battleState(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 300,
    refetchInterval: 1000,
    refetchOnWindowFocus: true,
  });

  const state = battleQuery.data;

  useEffect(() => {
    const serverNow = state?.combat?.server_now;
    if (!serverNow) return;
    const parsed = new Date(serverNow).getTime();
    if (Number.isFinite(parsed)) {
      serverClockOffsetRef.current = parsed - Date.now();
    }
  }, [state?.combat?.server_now]);

  useEffect(() => {
    if (!Number.isFinite(raidId) || raidId <= 0 || state?.raid.status !== 'ACTIVE') {
      return;
    }

    let cancelled = false;
    let running = false;

    const runTick = async () => {
      if (cancelled || running) return;
      running = true;
      try {
        const result = await raidStudentRpc.combatTick(supabase, raidId);
        if (cancelled) return;
        if (result.success === false) {
          setBattleError((current) => current ?? result.error);
          return;
        }
        const patternChanged = Boolean(
          result.data.pattern?.changed || result.data.pattern_event,
        );
        if (result.data.attack_applied || patternChanged) {
          void queryClient.invalidateQueries({ queryKey: ['raid-battle-state', raidId] });
        }
        if (result.data.collapsed) {
          void queryClient.invalidateQueries({ queryKey: ['raid-battle-state', raidId] });
          void queryClient.invalidateQueries({ queryKey: ['raid-portal'] });
          void queryClient.invalidateQueries({ queryKey: ['raid-portal-home'] });
        }
      } finally {
        running = false;
      }
    };

    void runTick();
    const timer = window.setInterval(() => {
      void runTick();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [queryClient, raidId, state?.raid.status]);

  useEffect(() => {
    if (state?.raid.status !== 'ACTIVE') return;
    setClockNowMs(Date.now());
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [state?.raid.status]);

  useEffect(() => {
    const attack = state?.combat?.boss_attack;
    if (!attack) return;

    const seq = Number(attack.seq ?? 0);
    const previous = lastBossAttackSeqRef.current;
    lastBossAttackSeqRef.current = seq;

    if (previous == null || seq <= previous) return;

    if (bossImpactTimerRef.current) {
      clearTimeout(bossImpactTimerRef.current);
    }

    setBossImpact({
      seq,
      name: attack.name,
      damage: Number(attack.last_damage ?? 0),
    });

    bossImpactTimerRef.current = setTimeout(() => {
      setBossImpact(null);
      bossImpactTimerRef.current = null;
    }, 1150);
  }, [
    state?.combat?.boss_attack?.seq,
    state?.combat?.boss_attack?.last_damage,
    state?.combat?.boss_attack?.name,
  ]);

  useEffect(
    () => () => {
      if (bossImpactTimerRef.current) {
        clearTimeout(bossImpactTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!state) return;
    setDisplayHp(Number(state.raid.current_hp));
    setDisplayHpRatio(Number(state.raid.hp_ratio));
    setMyDamage(Number(state.me.total_damage));
    if (
      (state.raid.status === 'COMPLETED' ||
        state.raid.status === 'FAILED' ||
        state.raid.status === 'ARCHIVED') &&
      state.raid.end_reason !== 'BARRIER_COLLAPSE'
    ) {
      setResultOpen(true);
    }
  }, [
    state?.raid.current_hp,
    state?.raid.hp_ratio,
    state?.raid.status,
    state?.raid.end_reason,
    state?.me.total_damage,
  ]);

  useEffect(
    () => () => {
      Object.values(damageTimers.current).forEach((timer) => clearTimeout(timer));
      Object.values(patternFeedbackTimers.current).forEach((timer) => clearTimeout(timer));
    },
    [],
  );

  const showDamageNumbers = useCallback(
    (batch: RaidTapBatchResult) => {
      const next: DamageNumber[] = [];

      const expectedNormalDamage = Math.max(
        1,
        Number(state?.me.raid_power ?? 0) *
          Number(state?.raid.damage_coefficient ?? 0.02),
      );
      const critReference =
        expectedNormalDamage * Number(state?.raid.crit_multiplier ?? 2);

      batch.results.forEach((item, index) => {
        if (!item.accepted || !item.damage || item.x == null || item.y == null) return;

        const damage = Number(item.damage);
        const crit = Boolean(item.crit);
        let impactTier: ImpactTier = crit ? 'crit' : 'normal';

        if (damage >= critReference * 1.08) {
          impactTier = 'devastating';
        } else if (damage >= critReference * 1.02) {
          impactTier = 'powerful';
        }

        const id = `${batch.batch_id}-${index}`;
        next.push({
          id,
          x: Number(item.x),
          y: Number(item.y),
          damage,
          crit,
          impactTier,
          zoneKey: item.zone_key,
          patternMultiplier: Number(item.pattern_multiplier ?? 1),
        });

        damageTimers.current[id] = setTimeout(
          () => {
            setDamageNumbers((current) =>
              current.filter((entry) => entry.id !== id),
            );
            delete damageTimers.current[id];
          },
          crit || impactTier === 'powerful' || impactTier === 'devastating'
            ? 950
            : 700,
        );
      });

      if (next.length > 0) {
        setDamageNumbers((current) =>
          [...current.slice(-16), ...next].slice(-22),
        );
      }
    },
    [
      state?.me.raid_power,
      state?.raid.damage_coefficient,
      state?.raid.crit_multiplier,
    ],
  );

  const showPatternFeedback = useCallback((batch: RaidTapBatchResult) => {
    const next: PatternFeedback[] = [];
    batch.results.forEach((item, index) => {
      if (!item.accepted || item.x == null || item.y == null) return;

      let text: string | null = null;
      let tone: PatternFeedback['tone'] = 'cyan';
      const objectiveDamage = Number(item.objective_damage ?? 0);
      const reflected = Number(item.reflected_damage ?? 0);
      const bossHeal = Number(item.boss_heal ?? 0);
      const label = item.target_label || item.target_key || '';

      if (bossHeal > 0) {
        text = `흡수! Boss +${formatNumber(bossHeal)}`;
        tone = 'violet';
      } else if (reflected > 0) {
        text = `↩ 방벽 -${formatNumber(reflected)}`;
        tone = 'danger';
      } else if (item.pattern_effect === 'WRONG_CORE') {
        text = '순서 오류!';
        tone = 'danger';
      } else if (objectiveDamage > 0) {
        text = `${label || objectiveLabel(item.pattern_type)} -${formatNumber(objectiveDamage)}`;
        tone = item.target_destroyed ? 'green' : 'warning';
      } else if (item.pattern_effect === 'SEALED_BOSS') {
        text = '봉인 감쇠';
        tone = 'violet';
      }

      if (!text) return;
      const id = `pattern-${batch.batch_id}-${index}`;
      next.push({ id, x: Number(item.x), y: Number(item.y), text, tone });
      patternFeedbackTimers.current[id] = setTimeout(() => {
        setPatternFeedback((current) => current.filter((entry) => entry.id !== id));
        delete patternFeedbackTimers.current[id];
      }, 1050);
    });

    if (next.length > 0) {
      setPatternFeedback((current) => [...current.slice(-10), ...next].slice(-16));
    }
  }, []);

  const onBatchResult = useCallback(
    (batch: RaidTapBatchResult) => {
      setBattleError(null);
      setDisplayHp(Number(batch.raid_hp));
      setDisplayHpRatio(Number(batch.raid_hp_ratio));
      setMyDamage(Number(batch.my_total_damage));
      showDamageNumbers(batch);
      showPatternFeedback(batch);

      if (batch.pattern) {
        void queryClient.invalidateQueries({ queryKey: ['raid-battle-state', raidId] });
      }

      if (
        batch.pattern?.pattern_type === 'BREAK' &&
        batch.pattern.break_current_hp != null &&
        !batch.pattern.break_success
      ) {
        queryClient.setQueryData<RaidBattleState>(
          ['raid-battle-state', raidId],
          (current) => {
            if (!current?.combat.active_pattern) return current;
            if (current.combat.active_pattern.run_id !== batch.pattern?.pattern_run_id) {
              return current;
            }
            return {
              ...current,
              combat: {
                ...current.combat,
                active_pattern: {
                  ...current.combat.active_pattern,
                  state: {
                    ...current.combat.active_pattern.state,
                    objective_current_hp: batch.pattern.break_current_hp,
                  },
                },
              },
            };
          },
        );
      }

      if (batch.pattern?.break_success) {
        void queryClient.invalidateQueries({ queryKey: ['raid-battle-state', raidId] });
      }

      if (
        batch.raid_status === 'COMPLETED' ||
        batch.raid_status === 'FAILED' ||
        batch.barrier_collapsed ||
        Number(batch.raid_hp) <= 0
      ) {
        void queryClient.invalidateQueries({ queryKey: ['raid-battle-state', raidId] });
        void queryClient.invalidateQueries({ queryKey: ['raid-portal'] });
        void queryClient.invalidateQueries({ queryKey: ['raid-portal-home'] });
        if (batch.raid_status === 'COMPLETED' || Number(batch.raid_hp) <= 0) {
          window.setTimeout(() => setResultOpen(true), 450);
        }
      }
    },
    [queryClient, raidId, showDamageNumbers, showPatternFeedback],
  );

  const battleEnabled =
    state?.raid.status === 'ACTIVE' && !state.me.attack_blocked;

  const { queueTap } = useRaidTapBatcher({
    raidId,
    enabled: battleEnabled,
    onResult: onBatchResult,
    onError: (message) => setBattleError(message),
  });

  const handleResultClose = () => {
    setResultOpen(false);
    if (
      state?.raid.status === 'COMPLETED' ||
      state?.raid.status === 'FAILED' ||
      state?.raid.status === 'ARCHIVED'
    ) {
      navigate('/raid', { replace: true });
    }
  };

  const handleBossPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!battleEnabled) return;

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

    const accepted = queueTap({
      x: Number(x.toFixed(6)),
      y: Number(y.toFixed(6)),
      client_t: performance.now(),
    });

    if (!accepted) {
      setBattleError('입력 속도가 너무 빠릅니다. 잠시 후 다시 공격해주세요.');
    }
  };

  if (!Number.isFinite(raidId) || raidId <= 0) {
    return (
      <BattleError
        title="잘못된 레이드 주소입니다."
        onBack={() => navigate('/raid')}
      />
    );
  }

  if (battleQuery.isLoading || !state) {
    if (battleQuery.isError) {
      return (
        <BattleError
          title="전투 화면을 열 수 없습니다."
          detail={
            battleQuery.error instanceof Error
              ? battleQuery.error.message
              : '알 수 없는 오류'
          }
          onBack={() => navigate('/raid')}
        />
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#04070d]">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <div className="mt-3 text-sm font-black text-cyan-100">
            전투 공간을 불러오는 중...
          </div>
        </div>
      </div>
    );
  }

  const hp = displayHp ?? Number(state.raid.current_hp);
  const hpRatio = displayHpRatio ?? Number(state.raid.hp_ratio);
  const totalDamage = myDamage ?? Number(state.me.total_damage);

  const combat = state.combat;
  const bossAttack = combat?.boss_attack ?? null;
  const nextAttackMs = bossAttack?.next_attack_at
    ? new Date(bossAttack.next_attack_at).getTime()
    : Number.NaN;
  const serverClockOffsetMs = serverClockOffsetRef.current;
  const secondsToBossAttack = Number.isFinite(nextAttackMs)
    ? Math.max(0, (nextAttackMs - (clockNowMs + serverClockOffsetMs)) / 1000)
    : null;
  const bossAttackTelegraph =
    state.raid.status === 'ACTIVE' &&
    bossAttack != null &&
    secondsToBossAttack != null &&
    secondsToBossAttack <= Number(bossAttack.telegraph_seconds ?? 0);
  const activePattern = combat?.active_pattern ?? null;
  const patternEndMs = activePattern?.ends_at
    ? new Date(activePattern.ends_at).getTime()
    : Number.NaN;
  const secondsToPatternEnd = Number.isFinite(patternEndMs)
    ? Math.max(0, (patternEndMs - (clockNowMs + serverClockOffsetMs)) / 1000)
    : null;
  const groggyEndMs = combat?.groggy_until
    ? new Date(combat.groggy_until).getTime()
    : Number.NaN;
  const secondsToGroggyEnd = Number.isFinite(groggyEndMs)
    ? Math.max(0, (groggyEndMs - (clockNowMs + serverClockOffsetMs)) / 1000)
    : 0;
  const groggyActive =
    state.raid.status === 'ACTIVE' && secondsToGroggyEnd > 0;

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="relative mx-auto aspect-video min-h-screen w-full max-w-[1920px] overflow-hidden bg-[#02050a]">
        <BossViewport
          state={state}
          enabled={battleEnabled}
          onPointerDown={handleBossPointerDown}
        />

        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.34),transparent_23%,transparent_70%,rgba(0,0,0,0.52))]" />

        <BossHud state={state} hp={hp} hpRatio={hpRatio} />

        <BossBarrierHud
          combat={combat}
          secondsToBossAttack={secondsToBossAttack}
        />

        {activePattern?.pattern_type === 'WEAK_POINT' && (
          <WeakPointOverlay
            pattern={activePattern}
            secondsRemaining={secondsToPatternEnd ?? 0}
          />
        )}

        {activePattern?.pattern_type === 'BREAK' && (
          <BreakMissionHud
            pattern={activePattern}
            secondsRemaining={secondsToPatternEnd ?? 0}
          />
        )}

        {groggyActive && (
          <GroggyBanner
            multiplier={Number(combat.groggy_damage_multiplier ?? 1)}
            secondsRemaining={secondsToGroggyEnd}
          />
        )}

        {combat?.enrage_active && (
          <EnrageBadge
            bossMultiplier={Number(combat.enrage_boss_damage_multiplier ?? 1)}
          />
        )}

        {activePattern && !['WEAK_POINT', 'BREAK', 'ENRAGE'].includes(activePattern.pattern_type) && (
          <SpecialPatternOverlay
            pattern={activePattern}
            secondsRemaining={secondsToPatternEnd ?? 0}
          />
        )}

        {bossAttackTelegraph && bossAttack && (
          <BossAttackTelegraph
            name={bossAttack.name}
            seconds={secondsToBossAttack ?? 0}
          />
        )}

        {bossImpact && (
          <BossAttackImpact
            name={bossImpact.name}
            damage={bossImpact.damage}
          />
        )}

        {combat?.barrier_enabled &&
          Number(combat.barrier_ratio) <= 0.25 &&
          state.raid.status === 'ACTIVE' && <CriticalBarrierPulse />}

        <PlayerHud
          resonance={Number(state.me.raid_power)}
          critBp={Number(state.me.final_crit_bp)}
          totalDamage={totalDamage}
        />

        <div className="absolute left-4 top-4 z-40 flex gap-2 md:left-5 md:top-5">
          <button
            type="button"
            onClick={() => navigate(`/raid/${raidId}/lobby`)}
            className="pointer-events-auto rounded-card-md border border-white/20 bg-black/55 px-3 py-2 text-xs font-black text-white backdrop-blur hover:bg-black/70"
          >
            ← 관문
          </button>
          <button
            type="button"
            onClick={() => navigate('/raid')}
            className="pointer-events-auto rounded-card-md border border-cyan-300/30 bg-cyan-950/55 px-3 py-2 text-xs font-black text-cyan-100 backdrop-blur"
          >
            레이드 허브
          </button>
        </div>

        <DamageLayer items={damageNumbers} />
        <PatternFeedbackLayer items={patternFeedback} />

        {state.raid.status === 'PAUSED' && (
          <CenterStatus
            icon="⏸"
            title="레이드 일시정지"
            description="운영국에서 전투를 재개할 때까지 공격이 처리되지 않습니다."
          />
        )}

        {(state.raid.status === 'COMPLETED' ||
          state.raid.status === 'FAILED' ||
          state.raid.status === 'ARCHIVED') && (
          <CenterStatus
            icon={
              state.raid.status === 'COMPLETED'
                ? '🏆'
                : state.raid.end_reason === 'BARRIER_COLLAPSE'
                  ? '💥'
                  : '🏁'
            }
            title={
              state.raid.status === 'COMPLETED'
                ? '보스 토벌 완료'
                : state.raid.end_reason === 'BARRIER_COLLAPSE'
                  ? '공명방벽 붕괴'
                  : '레이드 종료'
            }
            description={
              state.raid.end_reason === 'BARRIER_COLLAPSE'
                ? '보스의 공격을 버티지 못해 공명방벽이 완전히 붕괴했습니다.'
                : '전투 결과가 확정되었습니다.'
            }
            buttonLabel="결과 확인"
            onButton={() => setResultOpen(true)}
            strongBackdrop={state.raid.end_reason === 'BARRIER_COLLAPSE'}
          />
        )}

        {state.me.attack_blocked && state.raid.status === 'ACTIVE' && (
          <CenterStatus
            icon="🚫"
            title="공격이 제한되었습니다"
            description="운영국에 확인해주세요."
          />
        )}

        {battleError && (
          <div className="pointer-events-none absolute bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-card-md border border-red-300/45 bg-red-950/85 px-4 py-2 text-xs font-black text-red-100 shadow-lg">
            {battleError}
          </div>
        )}

        {battleEnabled && (
          <div className="pointer-events-none absolute bottom-5 left-5 z-30 rounded-card-md border border-white/15 bg-black/55 px-3 py-2 text-[11px] font-black text-white backdrop-blur">
            {activePattern?.pattern_type === 'ABSORB'
              ? '⚠ 마력 흡수 중 — 공격을 멈추세요!'
              : activePattern?.pattern_type === 'MULTI_CORE'
                ? '표시된 핵의 순서를 확인하고 공격'
                : activePattern?.pattern_type === 'SPLIT_TARGET'
                  ? '양쪽 목표를 균형 있게 공격'
                  : '보스를 직접 터치하여 공격'}
          </div>
        )}
      </div>

      <RaidResultModal
        raidId={raidId}
        open={resultOpen}
        onClose={handleResultClose}
      />
    </div>
  );
}

function BossViewport({
  state,
  enabled,
  onPointerDown,
}: {
  state: RaidBattleState;
  enabled: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const phase = state.raid.phase;
  const image = phase?.image_url ?? '';
  const video = phase?.loop_video_url ?? '';
  const animatedImage = /\.(?:webp|gif|apng)(?:$|[?#])/i.test(video);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    setVideoFailed(false);
  }, [video]);

  return (
    <div
      role={enabled ? 'button' : undefined}
      tabIndex={enabled ? 0 : -1}
      aria-label={enabled ? `${state.raid.boss_name} 공격` : undefined}
      onPointerDown={onPointerDown}
      className={cn(
        'absolute inset-0 z-10 select-none touch-manipulation overflow-hidden',
        enabled ? 'cursor-crosshair' : 'cursor-default',
      )}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {video && animatedImage ? (
        <img
          src={video}
          alt={state.raid.boss_name}
          className="pointer-events-none h-full w-full object-cover"
          draggable={false}
        />
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
          className="pointer-events-none h-full w-full object-cover"
        />
      ) : image ? (
        <img
          src={image}
          alt={state.raid.boss_name}
          className="pointer-events-none h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(88,28,135,0.35),rgba(2,6,23,1)_60%)] text-8xl">
          👾
        </div>
      )}
    </div>
  );
}

function BossHud({
  state,
  hp,
  hpRatio,
}: {
  state: RaidBattleState;
  hp: number;
  hpRatio: number;
}) {
  const percent = Math.max(0, Math.min(100, hpRatio * 100));
  return (
    <div className="pointer-events-none absolute left-4 top-20 z-30 w-[min(430px,44vw)] rounded-card-lg border border-white/20 bg-black/58 p-4 backdrop-blur md:left-5 md:top-20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black tracking-[0.18em] text-cyan-100">
            RAID BOSS
          </div>
          <div className="mt-1 truncate font-display text-xl text-white">
            {state.raid.boss_name}
          </div>
        </div>
        <div className="flex-none rounded-pill border border-yellow-300/35 bg-yellow-400/10 px-3 py-1 text-xs font-black text-yellow-100">
          {elementLabel(state.raid.boss_element)}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs font-black">
        <span className="text-white">HP</span>
        <span className="font-mono text-yellow-100">{percent.toFixed(1)}%</span>
      </div>
      <div className="mt-1.5 h-4 overflow-hidden rounded-full border border-white/15 bg-black/55">
        <div
          className="h-full rounded-full bg-gradient-to-r from-red-600 via-orange-400 to-yellow-300 transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 text-right font-mono text-[10px] font-black text-cyan-100">
        {formatNumber(hp)} / {formatNumber(state.raid.max_hp)}
      </div>
    </div>
  );
}

function BossBarrierHud({
  combat,
  secondsToBossAttack,
}: {
  combat: RaidBattleState['combat'];
  secondsToBossAttack: number | null;
}) {
  if (!combat?.barrier_enabled) return null;

  const ratio = Math.max(0, Math.min(1, Number(combat.barrier_ratio ?? 0)));
  const percent = ratio * 100;
  const stateLabel: Record<RaidBattleState['combat']['barrier_state'], string> = {
    DISABLED: '비활성',
    STABLE: '안정',
    CRACKED: '균열',
    DANGER: '위험',
    CRITICAL: '붕괴 직전',
    COLLAPSED: '붕괴',
  };

  const barClass =
    ratio <= 0.25
      ? 'from-red-600 via-red-400 to-orange-300'
      : ratio <= 0.5
        ? 'from-orange-600 via-amber-400 to-yellow-200'
        : ratio <= 0.75
          ? 'from-cyan-700 via-cyan-400 to-sky-200'
          : 'from-blue-700 via-cyan-400 to-white';

  return (
    <div className="pointer-events-none absolute right-4 top-20 z-30 w-[min(420px,43vw)] rounded-card-lg border border-cyan-200/30 bg-[#04111d]/82 p-4 backdrop-blur md:right-5 md:top-20">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black tracking-[0.18em] text-cyan-100">
            RESONANCE BARRIER
          </div>
          <div className="mt-1 font-display text-lg text-white">공명방벽</div>
        </div>
        <div
          className={cn(
            'rounded-pill border px-3 py-1 text-xs font-black',
            ratio <= 0.25
              ? 'border-red-300/50 bg-red-500/15 text-red-100'
              : ratio <= 0.5
                ? 'border-orange-300/45 bg-orange-500/10 text-orange-100'
                : 'border-cyan-300/40 bg-cyan-500/10 text-cyan-100',
          )}
        >
          {stateLabel[combat.barrier_state]}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs font-black">
        <span className="text-white">BARRIER</span>
        <span className="font-mono text-cyan-100">{percent.toFixed(1)}%</span>
      </div>
      <div className="mt-1.5 h-4 overflow-hidden rounded-full border border-white/15 bg-black/55">
        <div
          className={cn(
            'h-full rounded-full bg-gradient-to-r transition-[width] duration-300',
            barClass,
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[10px] font-black text-cyan-100">
        <span>
          {formatNumber(Number(combat.barrier_current_hp))} /{' '}
          {formatNumber(Number(combat.barrier_max_hp))}
        </span>
        <span>출전 {formatNumber(Number(combat.barrier_contributor_count))}명</span>
      </div>

      {combat.boss_attack && secondsToBossAttack != null && (
        <div className="mt-3 flex items-center justify-between rounded-card-md border border-red-300/20 bg-red-950/25 px-3 py-2 text-xs font-black">
          <span className="text-red-100">다음 {combat.boss_attack.name}</span>
          <span className="font-mono text-yellow-100">
            {secondsToBossAttack.toFixed(1)}초
          </span>
        </div>
      )}
    </div>
  );
}

function BossAttackTelegraph({
  name,
  seconds,
}: {
  name: string;
  seconds: number;
}) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[42%] z-40 -translate-x-1/2 -translate-y-1/2 text-center">
      <div className="rounded-card-lg border-2 border-red-300/70 bg-red-950/75 px-7 py-5 shadow-[0_0_45px_rgba(239,68,68,0.32)] backdrop-blur-sm animate-pulse">
        <div className="text-xs font-black tracking-[0.22em] text-red-200">
          BOSS ATTACK
        </div>
        <div className="mt-1 font-display text-2xl text-white">{name}</div>
        <div className="mt-2 font-mono text-4xl font-black text-yellow-200">
          {Math.max(0, seconds).toFixed(1)}
        </div>
      </div>
    </div>
  );
}

function BossAttackImpact({
  name,
  damage,
}: {
  name: string;
  damage: number;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[45] flex items-center justify-center border-[10px] border-red-400/70 bg-red-950/20">
      <div className="rounded-card-lg border border-white/25 bg-black/75 px-8 py-5 text-center shadow-2xl backdrop-blur">
        <div className="text-sm font-black tracking-[0.18em] text-red-200">
          {name} 적중
        </div>
        <div className="mt-2 font-display text-3xl text-white">공명방벽 피해</div>
        <div className="mt-2 font-mono text-5xl font-black text-red-300">
          -{formatNumber(damage)}
        </div>
      </div>
    </div>
  );
}

function numberFromPattern(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
) {
  const value = Number(source[key]);
  return Number.isFinite(value) ? value : fallback;
}

function WeakPointOverlay({
  pattern,
  secondsRemaining,
}: {
  pattern: NonNullable<RaidBattleState['combat']['active_pattern']>;
  secondsRemaining: number;
}) {
  const x = numberFromPattern(pattern.state, 'x', 0.42);
  const y = numberFromPattern(pattern.state, 'y', 0.3);
  const width = numberFromPattern(pattern.state, 'width', 0.16);
  const height = numberFromPattern(pattern.state, 'height', 0.22);
  const multiplier = numberFromPattern(pattern.state, 'multiplier', 2);

  return (
    <div
      className="pointer-events-none absolute z-[34] flex items-center justify-center rounded-[28px] border-4 border-yellow-200/90 bg-yellow-300/10 shadow-[0_0_34px_rgba(253,224,71,0.55),inset_0_0_30px_rgba(253,224,71,0.16)] animate-pulse"
      style={{
        left: `${Math.max(0, Math.min(1, x)) * 100}%`,
        top: `${Math.max(0, Math.min(1, y)) * 100}%`,
        width: `${Math.max(0.05, Math.min(1 - x, width)) * 100}%`,
        height: `${Math.max(0.05, Math.min(1 - y, height)) * 100}%`,
        animationDuration: '2s',
      }}
    >
      <div className="rounded-pill border border-yellow-100/70 bg-black/75 px-3 py-1.5 text-center shadow-lg backdrop-blur-sm">
        <div className="text-[10px] font-black tracking-[0.16em] text-yellow-100">
          WEAK POINT ×{multiplier.toFixed(1)}
        </div>
        <div className="font-mono text-sm font-black text-white">
          {secondsRemaining.toFixed(1)}초
        </div>
      </div>
    </div>
  );
}

function BreakMissionHud({
  pattern,
  secondsRemaining,
}: {
  pattern: NonNullable<RaidBattleState['combat']['active_pattern']>;
  secondsRemaining: number;
}) {
  const maxHp = Math.max(1, numberFromPattern(pattern.state, 'objective_max_hp', 1));
  const currentHp = Math.max(
    0,
    Math.min(maxHp, numberFromPattern(pattern.state, 'objective_current_hp', maxHp)),
  );
  const ratio = currentHp / maxHp;

  return (
    <div className="pointer-events-none absolute left-1/2 top-20 z-[39] w-[min(560px,54vw)] -translate-x-1/2 rounded-card-lg border-2 border-fuchsia-300/65 bg-[#170820]/[0.92] p-4 shadow-[0_0_38px_rgba(217,70,239,0.28)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] font-black tracking-[0.2em] text-fuchsia-200">
            BREAK MISSION
          </div>
          <div className="mt-1 font-display text-xl text-white">{pattern.name}</div>
        </div>
        <div className="rounded-pill border border-red-300/55 bg-red-500/15 px-3 py-1 font-mono text-lg font-black text-red-100">
          {secondsRemaining.toFixed(1)}초
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs font-black">
        <span className="text-white">집중 공격으로 차원 공격을 끊어내세요</span>
        <span className="font-mono text-fuchsia-100">
          {formatNumber(currentHp)} / {formatNumber(maxHp)}
        </span>
      </div>
      <div className="mt-2 h-5 overflow-hidden rounded-full border border-fuchsia-100/25 bg-black/60">
        <div
          className="h-full rounded-full bg-gradient-to-r from-fuchsia-600 via-pink-400 to-yellow-200 transition-[width] duration-150"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

function GroggyBanner({
  multiplier,
  secondsRemaining,
}: {
  multiplier: number;
  secondsRemaining: number;
}) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[31%] z-[38] -translate-x-1/2 rounded-card-lg border border-cyan-200/60 bg-cyan-950/80 px-6 py-3 text-center shadow-[0_0_34px_rgba(34,211,238,0.28)] backdrop-blur-sm">
      <div className="text-[10px] font-black tracking-[0.2em] text-cyan-100">GROGGY</div>
      <div className="mt-1 font-display text-2xl text-white">
        받는 피해 ×{multiplier.toFixed(1)}
      </div>
      <div className="mt-1 font-mono text-sm font-black text-yellow-100">
        {secondsRemaining.toFixed(1)}초
      </div>
    </div>
  );
}

function EnrageBadge({ bossMultiplier }: { bossMultiplier: number }) {
  return (
    <div className="pointer-events-none absolute right-5 top-5 z-[39] rounded-pill border border-red-300/65 bg-red-950/[0.88] px-4 py-2 shadow-[0_0_28px_rgba(239,68,68,0.30)] backdrop-blur-sm">
      <span className="mr-2 text-sm">🔥</span>
      <span className="text-xs font-black tracking-[0.12em] text-red-100">광폭화</span>
      <span className="ml-2 font-mono text-xs font-black text-yellow-100">
        공격 ×{bossMultiplier.toFixed(2)}
      </span>
    </div>
  );
}

function CriticalBarrierPulse() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 animate-pulse"
      style={{
        animationDuration: '2.8s',
        background: 'rgba(220, 38, 38, 0.14)',
        boxShadow: 'inset 0 0 150px rgba(220, 38, 38, 0.38)',
      }}
    />
  );
}

function objectiveLabel(patternType: string | null | undefined) {
  switch (patternType) {
    case 'SHIELD': return '보호막';
    case 'BREAK': return 'BREAK';
    case 'ULTIMATE':
    case 'BOSS_STRIKE': return '필살기 차단';
    case 'DOT': return '독샘';
    case 'REGEN': return '재생핵';
    case 'SEAL': return '봉인석';
    case 'MULTI_CORE': return '마력핵';
    case 'SPLIT_TARGET': return '목표';
    default: return '기믹';
  }
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
  return {
    index: Number.isFinite(Number(source.index)) ? Number(source.index) : undefined,
    key: String(source.key ?? 'TARGET'),
    label: String(source.label ?? source.key ?? '목표'),
    x: Number(source.x ?? 0.4),
    y: Number(source.y ?? 0.4),
    width: Number(source.width ?? 0.16),
    height: Number(source.height ?? 0.2),
    max_hp: maxHp,
    current_hp: currentHp,
    damage_dealt: Number(source.damage_dealt ?? 0),
  };
}

function runtimeTargets(value: unknown): RuntimeTarget[] {
  if (!Array.isArray(value)) return [];
  return value.map(runtimeTarget).filter((item): item is RuntimeTarget => item !== null);
}

function SpecialPatternOverlay({
  pattern,
  secondsRemaining,
}: {
  pattern: NonNullable<RaidBattleState['combat']['active_pattern']>;
  secondsRemaining: number;
}) {
  const type = pattern.pattern_type;
  const state = pattern.state;

  if (type === 'ABSORB') {
    const healRatio = patternNumber(state, 'heal_ratio', 1);
    return (
      <PatternWarningBanner
        eyebrow="ABSORB"
        title="⚠ 마력 흡수 — 공격 중지!"
        description={`지금 공격하면 Boss가 피해의 ${(healRatio * 100).toFixed(0)}%를 회복합니다.`}
        secondsRemaining={secondsRemaining}
        tone="violet"
      />
    );
  }

  if (type === 'REFLECT') {
    const reflectRatio = patternNumber(state, 'reflect_ratio', 0.3);
    return (
      <PatternWarningBanner
        eyebrow="REFLECT"
        title="↩ 반격 태세"
        description={`공격 피해의 ${(reflectRatio * 100).toFixed(0)}%가 공명방벽에 반사됩니다.`}
        secondsRemaining={secondsRemaining}
        tone="danger"
      />
    );
  }

  if (type === 'BOSS_STRIKE' || type === 'ULTIMATE') {
    return (
      <ObjectiveMissionHud
        eyebrow="ULTIMATE"
        title={pattern.name}
        description="필살기가 완성되기 전에 화력을 집중해 시전을 끊어내세요."
        current={patternNumber(state, 'objective_current_hp', 1)}
        max={patternNumber(state, 'objective_max_hp', 1)}
        secondsRemaining={secondsRemaining}
        tone="danger"
      />
    );
  }

  if (type === 'DOT') {
    const target = runtimeTarget(state.interrupt_target);
    const tickPercent = patternNumber(state, 'tick_barrier_percent', 0);
    return (
      <>
        <PatternWarningBanner
          eyebrow="DOT"
          title="☠ 지속 피해 발생"
          description={target ? `${target.label}을 파괴해 공명방벽 피해를 중단하세요.` : `공명방벽이 계속 감소합니다.${tickPercent > 0 ? ` · Tick ${(tickPercent * 100).toFixed(1)}%` : ''}`}
          secondsRemaining={secondsRemaining}
          tone="danger"
          compact
        />
        {target && target.current_hp > 0 && <PatternTargetMarker target={target} tone="danger" />}
      </>
    );
  }

  if (type === 'SHIELD') {
    return (
      <ObjectiveMissionHud
        eyebrow="SHIELD"
        title="🛡 Boss 보호막"
        description="보호막이 남아 있는 동안 Boss 본체 피해가 차단됩니다."
        current={patternNumber(state, 'shield_current_hp', 1)}
        max={patternNumber(state, 'shield_max_hp', 1)}
        secondsRemaining={secondsRemaining}
        tone="cyan"
      />
    );
  }

  if (type === 'MULTI_CORE') {
    const targets = runtimeTargets(state.cores);
    const mode = String(state.mode ?? 'FIXED_ORDER');
    const expected = Math.max(0, Math.floor(patternNumber(state, 'expected_index', 0)));
    return (
      <>
        <PatternWarningBanner
          eyebrow="MULTI CORE"
          title="✦ 다중 마력핵"
          description={mode === 'FIXED_ORDER' || mode === 'RANDOM_ORDER' ? '빛나는 순서대로 핵을 파괴하세요. 잘못된 핵은 방벽에 반동을 줍니다.' : '모든 마력핵을 파괴하세요.'}
          secondsRemaining={secondsRemaining}
          tone="warning"
          compact
        />
        {targets.map((target, index) => (
          <PatternTargetMarker
            key={target.key}
            target={target}
            tone={target.current_hp <= 0 ? 'done' : index === expected || mode === 'ANY_ORDER' ? 'warning' : 'muted'}
            badge={target.current_hp > 0 && (mode === 'FIXED_ORDER' || mode === 'RANDOM_ORDER') ? `${index + 1}` : undefined}
          />
        ))}
      </>
    );
  }

  if (type === 'SPLIT_TARGET') {
    const targets = runtimeTargets(state.targets);
    const ratios = targets.map((target) => target.max_hp > 0 ? 1 - target.current_hp / target.max_hp : 0);
    const spread = ratios.length > 1 ? (Math.max(...ratios) - Math.min(...ratios)) * 100 : 0;
    const maxDiff = patternNumber(state, 'max_difference_percent', 25);
    return (
      <>
        <PatternWarningBanner
          eyebrow="SPLIT TARGET"
          title="⚖ 분산 공격"
          description={`양쪽을 균형 있게 공격하세요. 현재 격차 ${spread.toFixed(0)}% / 허용 ${maxDiff.toFixed(0)}%`}
          secondsRemaining={secondsRemaining}
          tone={spread > maxDiff ? 'danger' : 'cyan'}
          compact
        />
        {targets.map((target) => <PatternTargetMarker key={target.key} target={target} tone={target.current_hp <= 0 ? 'done' : 'cyan'} />)}
      </>
    );
  }

  if (type === 'REGEN') {
    const target = runtimeTarget(state.core);
    const healPercent = patternNumber(state, 'heal_per_tick_percent', 0);
    return (
      <>
        <PatternWarningBanner
          eyebrow="REGEN"
          title="✚ Boss 재생 중"
          description={target ? `${target.label}을 파괴해 재생을 멈추세요.${healPercent > 0 ? ` · Tick ${(healPercent * 100).toFixed(1)}%` : ''}` : 'Boss가 지속적으로 HP를 회복합니다.'}
          secondsRemaining={secondsRemaining}
          tone="green"
          compact
        />
        {target && target.current_hp > 0 && <PatternTargetMarker target={target} tone="green" />}
      </>
    );
  }

  if (type === 'SEAL') {
    const targets = runtimeTargets(state.seals);
    const reduction = patternNumber(state, 'damage_reduction', 0.7);
    return (
      <>
        <PatternWarningBanner
          eyebrow="SEAL"
          title="🔒 암흑 봉인"
          description={`봉인석을 모두 파괴하세요. 봉인 중 Boss 피해 ${(reduction * 100).toFixed(0)}% 감소.`}
          secondsRemaining={secondsRemaining}
          tone="violet"
          compact
        />
        {targets.map((target) => <PatternTargetMarker key={target.key} target={target} tone={target.current_hp <= 0 ? 'done' : 'violet'} />)}
      </>
    );
  }

  if (type === 'DAMAGE_CHECK') {
    const targetDamage = Math.max(1, patternNumber(state, 'target_damage', 1));
    const damageDealt = Math.max(0, patternNumber(state, 'damage_dealt', 0));
    return (
      <ObjectiveMissionHud
        eyebrow="DAMAGE CHECK"
        title="🔥 화력 검증"
        description="제한 시간 안에 실제 Boss 피해 목표를 달성하세요."
        current={Math.max(0, targetDamage - damageDealt)}
        max={targetDamage}
        secondsRemaining={secondsRemaining}
        tone="warning"
        remainingMode
      />
    );
  }

  return null;
}

function PatternWarningBanner({
  eyebrow,
  title,
  description,
  secondsRemaining,
  tone,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  secondsRemaining: number;
  tone: 'danger' | 'warning' | 'cyan' | 'violet' | 'green';
  compact?: boolean;
}) {
  const toneClass = {
    danger: 'border-red-300/70 bg-red-950/[0.90] shadow-[0_0_38px_rgba(239,68,68,0.30)]',
    warning: 'border-yellow-200/65 bg-amber-950/[0.90] shadow-[0_0_38px_rgba(245,158,11,0.25)]',
    cyan: 'border-cyan-200/65 bg-cyan-950/[0.90] shadow-[0_0_38px_rgba(34,211,238,0.23)]',
    violet: 'border-fuchsia-300/65 bg-[#21072d]/[0.92] shadow-[0_0_38px_rgba(217,70,239,0.27)]',
    green: 'border-emerald-300/65 bg-emerald-950/[0.90] shadow-[0_0_38px_rgba(16,185,129,0.24)]',
  }[tone];
  return (
    <div className={cn('pointer-events-none absolute left-1/2 z-[39] -translate-x-1/2 rounded-card-lg border-2 px-5 py-3 text-center backdrop-blur-md', compact ? 'top-[18%] w-[min(590px,58vw)]' : 'top-[28%] w-[min(620px,60vw)]', toneClass)}>
      <div className="text-[10px] font-black tracking-[0.22em] text-white/80">{eyebrow}</div>
      <div className={cn('mt-1 font-display text-white', compact ? 'text-xl' : 'text-2xl')}>{title}</div>
      <div className="mt-1 text-xs font-black text-yellow-100">{description}</div>
      <div className="mt-2 font-mono text-lg font-black text-white">{secondsRemaining.toFixed(1)}초</div>
    </div>
  );
}

function ObjectiveMissionHud({
  eyebrow,
  title,
  description,
  current,
  max,
  secondsRemaining,
  tone,
  remainingMode = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  current: number;
  max: number;
  secondsRemaining: number;
  tone: 'danger' | 'warning' | 'cyan';
  remainingMode?: boolean;
}) {
  const safeMax = Math.max(1, max);
  const safeCurrent = Math.max(0, Math.min(safeMax, current));
  const remainingRatio = safeCurrent / safeMax;
  const completedRatio = 1 - remainingRatio;
  const width = remainingMode ? completedRatio * 100 : remainingRatio * 100;
  const toneClass = {
    danger: 'border-red-300/65 bg-red-950/[0.90]',
    warning: 'border-yellow-200/65 bg-amber-950/[0.90]',
    cyan: 'border-cyan-200/65 bg-cyan-950/[0.90]',
  }[tone];
  return (
    <div className={cn('pointer-events-none absolute left-1/2 top-20 z-[39] w-[min(600px,58vw)] -translate-x-1/2 rounded-card-lg border-2 p-4 shadow-[0_0_38px_rgba(0,0,0,0.34)] backdrop-blur-md', toneClass)}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] font-black tracking-[0.2em] text-white/75">{eyebrow}</div>
          <div className="mt-1 font-display text-xl text-white">{title}</div>
        </div>
        <div className="rounded-pill border border-white/30 bg-black/35 px-3 py-1 font-mono text-lg font-black text-white">{secondsRemaining.toFixed(1)}초</div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs font-black">
        <span className="text-yellow-100">{description}</span>
        <span className="flex-none font-mono text-white">{remainingMode ? `${formatNumber(safeMax - safeCurrent)} / ${formatNumber(safeMax)}` : `${formatNumber(safeCurrent)} / ${formatNumber(safeMax)}`}</span>
      </div>
      <div className="mt-2 h-5 overflow-hidden rounded-full border border-white/20 bg-black/55">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-yellow-300 to-red-400 transition-[width] duration-150" style={{ width: `${Math.max(0, Math.min(100, width))}%` }} />
      </div>
    </div>
  );
}

function PatternTargetMarker({
  target,
  tone,
  badge,
}: {
  target: RuntimeTarget;
  tone: 'danger' | 'warning' | 'cyan' | 'violet' | 'green' | 'done' | 'muted';
  badge?: string;
}) {
  const hpRatio = target.max_hp > 0 ? target.current_hp / target.max_hp : 0;
  const toneClass = {
    danger: 'border-red-200/90 bg-red-500/15 shadow-[0_0_28px_rgba(239,68,68,0.48)]',
    warning: 'border-yellow-100/95 bg-yellow-300/15 shadow-[0_0_30px_rgba(250,204,21,0.52)]',
    cyan: 'border-cyan-100/90 bg-cyan-300/12 shadow-[0_0_28px_rgba(34,211,238,0.45)]',
    violet: 'border-fuchsia-200/90 bg-fuchsia-400/12 shadow-[0_0_28px_rgba(217,70,239,0.45)]',
    green: 'border-emerald-200/90 bg-emerald-400/12 shadow-[0_0_28px_rgba(16,185,129,0.45)]',
    done: 'border-emerald-300/25 bg-emerald-950/20 opacity-35',
    muted: 'border-white/25 bg-black/15 opacity-55',
  }[tone];
  return (
    <div
      className={cn('pointer-events-none absolute z-[35] flex items-center justify-center rounded-[24px] border-4 transition-all duration-150', toneClass)}
      style={{
        left: `${Math.max(0, Math.min(1, target.x)) * 100}%`,
        top: `${Math.max(0, Math.min(1, target.y)) * 100}%`,
        width: `${Math.max(0.04, Math.min(1 - target.x, target.width)) * 100}%`,
        height: `${Math.max(0.04, Math.min(1 - target.y, target.height)) * 100}%`,
      }}
    >
      <div className="relative min-w-[90px] rounded-card-md border border-white/25 bg-black/75 px-2.5 py-1.5 text-center backdrop-blur-sm">
        {badge && <div className="absolute -left-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full border-2 border-yellow-100 bg-black text-sm font-black text-yellow-100">{badge}</div>}
        <div className="text-[10px] font-black text-white">{target.current_hp <= 0 ? '✓ ' : ''}{target.label}</div>
        <div className="mt-0.5 font-mono text-[10px] font-black text-cyan-100">{formatNumber(target.current_hp)} / {formatNumber(target.max_hp)}</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/60"><div className="h-full bg-yellow-300 transition-[width] duration-150" style={{ width: `${Math.max(0, Math.min(100, hpRatio * 100))}%` }} /></div>
      </div>
    </div>
  );
}

function PatternFeedbackLayer({ items }: { items: PatternFeedback[] }) {
  const toneClass = {
    danger: 'border-red-200/65 bg-red-950/85 text-red-100',
    warning: 'border-yellow-200/65 bg-amber-950/85 text-yellow-100',
    cyan: 'border-cyan-200/65 bg-cyan-950/85 text-cyan-100',
    violet: 'border-fuchsia-200/65 bg-[#21072d]/90 text-fuchsia-100',
    green: 'border-emerald-200/65 bg-emerald-950/85 text-emerald-100',
  } as const;
  return (
    <div className="pointer-events-none absolute inset-0 z-[47]">
      {items.map((item) => (
        <div key={item.id} className={cn('absolute -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-pill border px-2.5 py-1 text-xs font-black shadow-lg', toneClass[item.tone])} style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, animationDuration: '0.9s' }}>{item.text}</div>
      ))}
    </div>
  );
}

function PlayerHud({
  resonance,
  critBp,
  totalDamage,
}: {
  resonance: number;
  critBp: number;
  totalDamage: number;
}) {
  return (
    <div className="pointer-events-none absolute bottom-5 right-5 z-30 min-w-[250px] rounded-card-lg border border-cyan-300/30 bg-[#07111f]/82 p-4 backdrop-blur">
      <div className="text-[10px] font-black tracking-[0.16em] text-cyan-100">
        나의 전투 정보
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-xs font-black">
        <span className="text-white">공명력</span>
        <span className="font-mono text-cyan-100">{formatNumber(resonance)}</span>
        <span className="text-white">치명타율</span>
        <span className="font-mono text-yellow-100">
          {(critBp / 100).toFixed(2)}%
        </span>
        <span className="text-white">누적 피해</span>
        <span className="font-mono text-white">{formatNumber(totalDamage)}</span>
      </div>
    </div>
  );
}

function DamageLayer({ items }: { items: DamageNumber[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      {items.map((item) => {
        const isCrit = item.crit;
        const isPowerful =
          item.impactTier === 'powerful' || item.impactTier === 'devastating';

        return (
          <div
            key={item.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${item.x * 100}%`,
              top: `${item.y * 100}%`,
            }}
          >
            <div
              className={cn(
                'absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border',
                isCrit
                  ? 'h-24 w-24 border-yellow-200/70 bg-yellow-300/10 animate-ping md:h-32 md:w-32'
                  : 'h-12 w-12 border-white/55 bg-white/5 animate-ping md:h-16 md:w-16',
              )}
            />

            {item.zoneKey === 'WEAK_POINT' && (
              <div className="absolute left-1/2 top-full mt-1 w-max -translate-x-1/2 rounded-pill border border-yellow-200/50 bg-black/70 px-2 py-0.5 text-[10px] font-black text-yellow-100 backdrop-blur-sm">
                약점 적중 ×{Number(item.patternMultiplier ?? 2).toFixed(1)}
              </div>
            )}

            {isCrit && (
              <div
                className={cn(
                  'absolute bottom-full left-1/2 mb-1 w-max -translate-x-1/2 font-black tracking-[0.08em] drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]',
                  isPowerful
                    ? 'text-base text-yellow-100 md:text-xl'
                    : 'text-sm text-yellow-200 md:text-base',
                )}
              >
                {item.impactTier === 'devastating'
                  ? '압도적 일격!'
                  : item.impactTier === 'powerful'
                    ? '강력한 일격!'
                    : '치명타!'}
              </div>
            )}

            {!isCrit && isPowerful && (
              <div className="absolute bottom-full left-1/2 mb-1 w-max -translate-x-1/2 text-sm font-black text-cyan-100 drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] md:text-base">
                강력한 일격!
              </div>
            )}

            <div
              className={cn(
                'font-mono font-black drop-shadow-[0_3px_6px_rgba(0,0,0,0.95)]',
                isCrit
                  ? 'text-5xl text-yellow-300 md:text-6xl'
                  : isPowerful
                    ? 'text-3xl text-cyan-100 md:text-4xl'
                    : 'text-2xl text-white md:text-3xl',
              )}
            >
              {isCrit ? '✦ ' : ''}
              {formatNumber(item.damage)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function CenterStatus({
  icon,
  title,
  description,
  buttonLabel,
  onButton,
  strongBackdrop = false,
}: {
  icon: string;
  title: string;
  description: string;
  buttonLabel?: string;
  onButton?: () => void;
  strongBackdrop?: boolean;
}) {
  return (
    <div
      className={cn(
        'absolute inset-0 z-50 flex items-center justify-center p-5',
        strongBackdrop
          ? 'bg-black/[0.82] backdrop-blur-[6px]'
          : 'bg-black/52 backdrop-blur-[2px]',
      )}
    >
      <div
        className={cn(
          'max-w-lg rounded-card-lg border border-white/20 p-7 text-center shadow-2xl',
          strongBackdrop ? 'bg-[#07111f]/[0.98]' : 'bg-[#07111f]/94',
        )}
      >
        <div className="text-5xl">{icon}</div>
        <div className="mt-3 font-display text-2xl text-white">{title}</div>
        <div className="mt-2 text-sm font-bold text-cyan-100">{description}</div>
        {buttonLabel && onButton && (
          <button
            type="button"
            onClick={onButton}
            className="mt-5 rounded-card-md border border-yellow-300/50 bg-yellow-400/15 px-5 py-3 text-sm font-black text-yellow-100"
          >
            {buttonLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function BattleError({
  title,
  detail,
  onBack,
}: {
  title: string;
  detail?: string;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#04070d] p-5">
      <div className="max-w-lg rounded-card-lg border border-red-300/40 bg-red-950/35 p-6 text-center">
        <div className="text-4xl">⚠️</div>
        <div className="mt-3 font-display text-lg text-white">{title}</div>
        {detail && (
          <div className="mt-2 break-all text-xs font-bold text-red-100">{detail}</div>
        )}
        <button
          type="button"
          onClick={onBack}
          className="mt-5 rounded-card-md border border-cyan-300/40 bg-cyan-500/10 px-4 py-2 text-xs font-black text-cyan-100"
        >
          레이드 관문으로
        </button>
      </div>
    </div>
  );
}

function elementLabel(element: RaidBattleState['raid']['boss_element']) {
  const labels: Record<RaidBattleState['raid']['boss_element'], string> = {
    FIRE: '🔥 화',
    WATER: '💧 수',
    WIND: '💫 풍',
    EARTH: '🪨 토',
    LIGHT: '✦ 빛',
    DARK: '☾ 암',
  };
  return labels[element];
}

function formatNumber(value: number) {
  return Number(value ?? 0).toLocaleString('ko-KR');
}
