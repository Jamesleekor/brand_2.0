import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import { raidStudentRpc, type ActiveRaidSummary } from '@/lib/rpc/raid_student_rpc';
import { cn } from '@/lib/utils/cn';

export function RaidHomeBanner() {
  const studentId = useStudentId();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['raid-active-home', studentId],
    enabled: Boolean(studentId),
    queryFn: async () => {
      const result = await raidStudentRpc.active(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data ?? null;
    },
    staleTime: 3000,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });

  const raid = query.data;
  if (!raid) return null;

  const meta = bannerMeta(raid);

  return (
    <button
      type="button"
      onClick={() => navigate(`/raid/${raid.id}/lobby`)}
      className={cn(
        'mx-4 mt-3 flex w-[calc(100%-32px)] items-center justify-between gap-4 overflow-hidden rounded-card-lg border px-4 py-3 text-left transition hover:-translate-y-0.5',
        meta.className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-12 w-12 flex-none items-center justify-center rounded-card-md border border-white/20 bg-black/20 text-2xl shadow-[0_0_22px_rgba(250,204,21,0.15)]">
          {meta.icon}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-black uppercase tracking-[0.16em] text-yellow-100">
              {meta.eyebrow}
            </span>
            <span className="rounded-pill border border-white/20 bg-black/15 px-2 py-0.5 text-[10px] font-black text-white">
              {elementLabel(raid.boss_element)}
            </span>
          </div>
          <div className="mt-1 truncate text-sm font-black text-white">
            {raid.title}
          </div>
          <div className="mt-0.5 truncate text-xs font-bold text-cyan-100">
            {raid.boss_name} · {meta.description}
          </div>
        </div>
      </div>

      <div className="flex flex-none items-center gap-2">
        <span className="hidden text-xs font-black text-yellow-100 sm:inline">
          레이드 관문
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-yellow-300/40 bg-yellow-400/10 text-yellow-100">
          →
        </span>
      </div>
    </button>
  );
}

function bannerMeta(raid: ActiveRaidSummary) {
  switch (raid.status) {
    case 'ACTIVE':
      return {
        icon: '⚔️',
        eyebrow: '레이드 진행 중',
        description: '전투가 시작되었습니다.',
        className:
          'border-yellow-300/50 bg-gradient-to-r from-amber-950/80 via-yellow-900/45 to-cyan-950/70 shadow-[0_0_28px_rgba(250,204,21,0.12)]',
      };
    case 'PAUSED':
      return {
        icon: '⏸️',
        eyebrow: '레이드 일시정지',
        description: '관문에서 동료들과 기다릴 수 있습니다.',
        className:
          'border-cyan-300/45 bg-gradient-to-r from-cyan-950/75 via-sky-950/55 to-violet-950/65',
      };
    default:
      return {
        icon: '🌀',
        eyebrow: '레이드 관문 개방',
        description: '동료들이 모이고 있습니다.',
        className:
          'border-cyan-300/50 bg-gradient-to-r from-cyan-950/80 via-blue-950/55 to-violet-950/70 shadow-[0_0_26px_rgba(34,211,238,0.10)]',
      };
  }
}

function elementLabel(element: ActiveRaidSummary['boss_element']) {
  const labels: Record<ActiveRaidSummary['boss_element'], string> = {
    FIRE: '🔥 화',
    WATER: '💧 수',
    WIND: '💫 풍',
    EARTH: '🪨 토',
    LIGHT: '✦ 빛',
    DARK: '☾ 암',
  };
  return labels[element];
}
