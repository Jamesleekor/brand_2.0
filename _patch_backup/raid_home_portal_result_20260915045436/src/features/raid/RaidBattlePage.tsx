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

interface DamageNumber {
  id: string;
  x: number;
  y: number;
  damage: number;
  crit: boolean;
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
  const damageTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
    if (!state) return;
    setDisplayHp(Number(state.raid.current_hp));
    setDisplayHpRatio(Number(state.raid.hp_ratio));
    setMyDamage(Number(state.me.total_damage));
    if (
      state.raid.status === 'COMPLETED' ||
      state.raid.status === 'FAILED' ||
      state.raid.status === 'ARCHIVED'
    ) {
      setResultOpen(true);
    }
  }, [
    state?.raid.current_hp,
    state?.raid.hp_ratio,
    state?.raid.status,
    state?.me.total_damage,
  ]);

  useEffect(
    () => () => {
      Object.values(damageTimers.current).forEach((timer) => clearTimeout(timer));
    },
    [],
  );

  const showDamageNumbers = useCallback((batch: RaidTapBatchResult) => {
    const next: DamageNumber[] = [];
    batch.results.forEach((item, index) => {
      if (!item.accepted || !item.damage || item.x == null || item.y == null) return;
      const id = `${batch.batch_id}-${index}`;
      next.push({
        id,
        x: Number(item.x),
        y: Number(item.y),
        damage: Number(item.damage),
        crit: Boolean(item.crit),
      });

      damageTimers.current[id] = setTimeout(() => {
        setDamageNumbers((current) => current.filter((entry) => entry.id !== id));
        delete damageTimers.current[id];
      }, 700);
    });

    if (next.length > 0) {
      setDamageNumbers((current) => [...current.slice(-18), ...next].slice(-24));
    }
  }, []);

  const onBatchResult = useCallback(
    (batch: RaidTapBatchResult) => {
      setBattleError(null);
      setDisplayHp(Number(batch.raid_hp));
      setDisplayHpRatio(Number(batch.raid_hp_ratio));
      setMyDamage(Number(batch.my_total_damage));
      showDamageNumbers(batch);

      if (batch.raid_status === 'COMPLETED' || Number(batch.raid_hp) <= 0) {
        void queryClient.invalidateQueries({ queryKey: ['raid-battle-state', raidId] });
        void queryClient.invalidateQueries({ queryKey: ['raid-portal'] });
        void queryClient.invalidateQueries({ queryKey: ['raid-portal-home'] });
        window.setTimeout(() => setResultOpen(true), 450);
      }
    },
    [queryClient, raidId, showDamageNumbers],
  );

  const battleEnabled =
    state?.raid.status === 'ACTIVE' && !state.me.attack_blocked;

  const { queueTap } = useRaidTapBatcher({
    raidId,
    enabled: battleEnabled,
    onResult: onBatchResult,
    onError: (message) => setBattleError(message),
  });

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

        {state.raid.status === 'PAUSED' && (
          <CenterStatus
            icon="⏸"
            title="레이드 일시정지"
            description="선생님이 전투를 재개할 때까지 공격이 처리되지 않습니다."
          />
        )}

        {(state.raid.status === 'COMPLETED' ||
          state.raid.status === 'FAILED' ||
          state.raid.status === 'ARCHIVED') && (
          <CenterStatus
            icon={state.raid.status === 'COMPLETED' ? '🏆' : '🏁'}
            title={
              state.raid.status === 'COMPLETED'
                ? '보스 토벌 완료'
                : '레이드 종료'
            }
            description="전투 결과가 확정되었습니다."
            buttonLabel="결과 확인"
            onButton={() => setResultOpen(true)}
          />
        )}

        {state.me.attack_blocked && state.raid.status === 'ACTIVE' && (
          <CenterStatus
            icon="🚫"
            title="공격이 제한되었습니다"
            description="선생님에게 확인해주세요."
          />
        )}

        {battleError && (
          <div className="pointer-events-none absolute bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-card-md border border-red-300/45 bg-red-950/85 px-4 py-2 text-xs font-black text-red-100 shadow-lg">
            {battleError}
          </div>
        )}

        {battleEnabled && (
          <div className="pointer-events-none absolute bottom-5 left-5 z-30 rounded-card-md border border-white/15 bg-black/45 px-3 py-2 text-[11px] font-black text-white backdrop-blur">
            보스를 직접 터치하여 공격
          </div>
        )}
      </div>

      <RaidResultModal
        raidId={raidId}
        open={resultOpen}
        onClose={() => setResultOpen(false)}
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
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            'absolute -translate-x-1/2 -translate-y-1/2 font-mono font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] animate-pulse',
            item.crit
              ? 'text-3xl text-yellow-300 md:text-4xl'
              : 'text-2xl text-white md:text-3xl',
          )}
          style={{
            left: `${item.x * 100}%`,
            top: `${item.y * 100}%`,
          }}
        >
          {item.crit ? '✦ ' : ''}
          {formatNumber(item.damage)}
        </div>
      ))}
    </div>
  );
}

function CenterStatus({
  icon,
  title,
  description,
  buttonLabel,
  onButton,
}: {
  icon: string;
  title: string;
  description: string;
  buttonLabel?: string;
  onButton?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/52 p-5 backdrop-blur-[2px]">
      <div className="max-w-lg rounded-card-lg border border-white/20 bg-[#07111f]/94 p-7 text-center shadow-2xl">
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
