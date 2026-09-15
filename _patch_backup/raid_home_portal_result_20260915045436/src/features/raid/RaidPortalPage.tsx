import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { LoadingSpinner } from '@/components/shared/components';
import { raidStudentRpc, type RaidPortalRaid } from '@/lib/rpc/raid_student_rpc';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';

export default function RaidPortalPage() {
  const studentId = useStudentId();
  const navigate = useNavigate();

  const portalQuery = useQuery({
    queryKey: ['raid-portal', studentId],
    enabled: Boolean(studentId),
    queryFn: async () => {
      const result = await raidStudentRpc.portal(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 2000,
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });

  if (portalQuery.isLoading || !portalQuery.data) {
    if (portalQuery.isError) {
      return (
        <PortalError
          message={
            portalQuery.error instanceof Error
              ? portalQuery.error.message
              : '레이드 관문 정보를 불러오지 못했습니다.'
          }
          onBack={() => navigate('/home')}
        />
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#06101c]">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <div className="mt-3 text-sm font-black text-cyan-100">
            레이드 관문을 불러오는 중...
          </div>
        </div>
      </div>
    );
  }

  const { active, recent } = portalQuery.data;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06101c] px-4 py-5 text-white md:px-6 md:py-7">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 10%, rgba(56,189,248,0.18), transparent 30%), radial-gradient(circle at 50% 72%, rgba(168,85,247,0.14), transparent 36%), linear-gradient(180deg,#081424 0%,#07111f 55%,#050b14 100%)',
        }}
      />

      <div className="relative z-10 mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <button
              type="button"
              onClick={() => navigate('/home')}
              className="mb-4 rounded-card-md border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-xs font-black text-cyan-100"
            >
              ← 홈으로
            </button>
            <div className="text-xs font-black tracking-[0.18em] text-yellow-100">
              레이드 관문
            </div>
            <h1 className="mt-1 font-display text-3xl text-white">
              차원의 경계가 열리는 곳
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-cyan-100">
              이곳은 언제나 존재합니다. 레이드가 열리면 동료들과 집결하고,
              전투가 시작되면 거대한 보스에게 직접 도전할 수 있습니다.
            </p>
          </div>

          <div className="rounded-card-lg border border-cyan-300/25 bg-[#07111f]/80 px-4 py-3 text-right backdrop-blur">
            <div className="text-[10px] font-black tracking-[0.16em] text-cyan-100">
              CURRENT STATUS
            </div>
            <div className="mt-1 text-sm font-black text-white">
              {active ? statusLabel(active.status) : '현재 개방된 레이드 없음'}
            </div>
          </div>
        </header>

        <section className="mt-7">
          {active ? (
            <ActiveRaidCard
              raid={active}
              onLobby={() => navigate(`/raid/${active.id}/lobby`)}
              onBattle={() => navigate(`/raid/${active.id}/battle`)}
            />
          ) : (
            <IdleGateCard />
          )}
        </section>

        <section className="mt-6 rounded-card-lg border border-white/15 bg-[#07111f]/78 p-5 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black tracking-[0.16em] text-cyan-100">
                최근 레이드
              </div>
              <h2 className="mt-1 font-display text-lg text-white">
                지난 전투 기록
              </h2>
            </div>
            {recent && (
              <button
                type="button"
                onClick={() => navigate(`/raid/${recent.id}/battle`)}
                className="rounded-card-md border border-yellow-300/40 bg-yellow-400/10 px-4 py-2 text-xs font-black text-yellow-100 hover:bg-yellow-400/20"
              >
                결과 확인 →
              </button>
            )}
          </div>

          {recent ? (
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
              <div>
                <div className="text-sm font-black text-white">{recent.title}</div>
                <div className="mt-1 text-xs font-bold text-cyan-100">
                  {elementLabel(recent.boss_element)} · {recent.boss_name}
                </div>
              </div>
              <div className="text-xs font-black text-white">
                HP {Number(recent.max_hp).toLocaleString('ko-KR')}
              </div>
              <div className="text-xs font-black text-yellow-100">
                {recent.status === 'COMPLETED' ? '토벌 성공' : '전투 종료'}
              </div>
              <div className="text-xs font-bold text-cyan-100">
                {recent.completed_at ? formatDateTime(recent.completed_at) : '기록 없음'}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-card-md border border-dashed border-cyan-300/25 bg-cyan-500/5 p-6 text-center">
              <div className="text-3xl">📜</div>
              <div className="mt-2 text-sm font-black text-white">
                아직 참가한 레이드 기록이 없습니다.
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ActiveRaidCard({
  raid,
  onLobby,
  onBattle,
}: {
  raid: RaidPortalRaid;
  onLobby: () => void;
  onBattle: () => void;
}) {
  const active = raid.status === 'ACTIVE';
  const paused = raid.status === 'PAUSED';
  const hp = Math.max(0, Math.min(100, Number(raid.hp_ratio) * 100));

  return (
    <div className="overflow-hidden rounded-card-lg border border-cyan-300/35 bg-[#07111f]/86 shadow-[0_0_40px_rgba(34,211,238,0.10)] backdrop-blur">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="p-5 md:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'rounded-pill border px-3 py-1 text-xs font-black',
                active
                  ? 'border-yellow-300/50 bg-yellow-400/10 text-yellow-100'
                  : paused
                    ? 'border-cyan-300/45 bg-cyan-500/10 text-cyan-100'
                    : 'border-emerald-300/45 bg-emerald-500/10 text-emerald-100',
              )}
            >
              {statusLabel(raid.status)}
            </span>
            <span className="rounded-pill border border-white/20 bg-white/5 px-3 py-1 text-xs font-black text-white">
              {elementLabel(raid.boss_element)}
            </span>
          </div>

          <h2 className="mt-4 font-display text-2xl text-white">{raid.title}</h2>
          <div className="mt-2 text-lg font-black text-yellow-100">
            {raid.boss_name}
          </div>
          {raid.boss_description && (
            <p className="mt-3 max-w-2xl text-sm font-bold leading-6 text-cyan-100">
              {raid.boss_description}
            </p>
          )}

          <div className="mt-5 max-w-2xl">
            <div className="mb-1 flex justify-between text-xs font-black">
              <span className="text-white">보스 HP</span>
              <span className="text-yellow-100">{hp.toFixed(1)}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full border border-white/10 bg-black/40">
              <div
                className="h-full rounded-full bg-gradient-to-r from-red-500 via-orange-400 to-yellow-300"
                style={{ width: `${hp}%` }}
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onLobby}
              className="rounded-card-md border border-cyan-300/45 bg-cyan-500/10 px-5 py-3 text-sm font-black text-cyan-100 hover:bg-cyan-500/20"
            >
              🌀 레이드 관문 입장
            </button>

            {active && (
              <button
                type="button"
                onClick={onBattle}
                className="rounded-card-md border border-yellow-300/55 bg-yellow-400/15 px-5 py-3 text-sm font-black text-yellow-100 shadow-[0_0_24px_rgba(250,204,21,0.12)] hover:bg-yellow-400/25"
              >
                ⚔️ 전투 참가
              </button>
            )}
          </div>
        </div>

        <div className="relative min-h-[260px] overflow-hidden border-t border-cyan-300/20 bg-black/35 lg:border-l lg:border-t-0">
          <RaidPreviewMedia raid={raid} />
        </div>
      </div>
    </div>
  );
}

function IdleGateCard() {
  return (
    <div className="rounded-card-lg border border-cyan-300/28 bg-[#07111f]/82 p-8 text-center backdrop-blur">
      <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border-2 border-cyan-300/30 bg-cyan-500/5 text-5xl shadow-[0_0_45px_rgba(34,211,238,0.12)]">
        🌀
      </div>
      <h2 className="mt-5 font-display text-2xl text-white">레이드 관문</h2>
      <div className="mt-2 text-sm font-black text-cyan-100">
        현재 개방된 레이드가 없습니다.
      </div>
      <p className="mx-auto mt-2 max-w-xl text-xs font-bold leading-5 text-yellow-100">
        관문은 닫혀 있어도 사라지지 않습니다. 새로운 차원 침공이 감지되면 이곳에서
        로비 입장과 전투 참가가 활성화됩니다.
      </p>
    </div>
  );
}

function RaidPreviewMedia({ raid }: { raid: RaidPortalRaid }) {
  const image = raid.phase_preview?.image_url ?? '';
  const video = raid.phase_preview?.loop_video_url ?? '';
  const animatedImage = /\.(?:webp|gif|apng)(?:$|[?#])/i.test(video);

  if (video && animatedImage) {
    return (
      <img
        src={video}
        alt={raid.boss_name}
        className="h-full min-h-[260px] w-full object-cover"
      />
    );
  }

  if (video) {
    return (
      <video
        src={video}
        poster={image || undefined}
        muted
        loop
        autoPlay
        playsInline
        className="h-full min-h-[260px] w-full object-cover"
      />
    );
  }

  if (image) {
    return (
      <img
        src={image}
        alt={raid.boss_name}
        className="h-full min-h-[260px] w-full object-cover"
      />
    );
  }

  return (
    <div className="flex min-h-[260px] h-full items-center justify-center text-6xl">
      👾
    </div>
  );
}

function PortalError({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#06101c] p-5">
      <div className="max-w-lg rounded-card-lg border border-red-300/40 bg-red-950/35 p-6 text-center">
        <div className="text-4xl">⚠️</div>
        <div className="mt-3 font-display text-lg text-white">
          레이드 관문을 열 수 없습니다
        </div>
        <div className="mt-2 break-all text-xs font-bold text-red-100">{message}</div>
        <button
          type="button"
          onClick={onBack}
          className="mt-5 rounded-card-md border border-cyan-300/40 bg-cyan-500/10 px-4 py-2 text-xs font-black text-cyan-100"
        >
          홈으로
        </button>
      </div>
    </div>
  );
}

function statusLabel(status: RaidPortalRaid['status']) {
  switch (status) {
    case 'LOBBY_OPEN':
      return '레이드 관문 개방';
    case 'ACTIVE':
      return '레이드 진행 중';
    case 'PAUSED':
      return '레이드 일시정지';
    case 'COMPLETED':
      return '토벌 완료';
    case 'FAILED':
      return '전투 종료';
    case 'ARCHIVED':
      return '보관됨';
    default:
      return '준비 중';
  }
}

function elementLabel(element: RaidPortalRaid['boss_element']) {
  const labels: Record<RaidPortalRaid['boss_element'], string> = {
    FIRE: '🔥 화',
    WATER: '💧 수',
    WIND: '💫 풍',
    EARTH: '🪨 토',
    LIGHT: '✦ 빛',
    DARK: '☾ 암',
  };
  return labels[element];
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '기록 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
