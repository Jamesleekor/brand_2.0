import { cn } from '@/lib/utils/cn';
import type { AchievementGrade } from '@/lib/rpc/achievement_a1_rpc';

const GRADE_CLASS: Record<AchievementGrade, string> = {
  희귀: 'border-slate-400/45 bg-slate-400/12 text-slate-50',
  유니크: 'border-blue-400/55 bg-blue-400/15 text-blue-100 shadow-[0_0_10px_rgba(96,165,250,0.14)]',
  에픽: 'border-violet-400/60 bg-violet-400/15 text-violet-100 shadow-[0_0_12px_rgba(167,139,250,0.18)]',
  히든: 'border-amber-300/60 bg-amber-300/15 text-amber-50 shadow-[0_0_12px_rgba(252,211,77,0.20)]',
  유일: 'border-red-300/85 bg-[linear-gradient(135deg,rgba(69,10,10,0.96),rgba(185,28,28,0.78)_48%,rgba(69,10,10,0.96))] text-red-50 shadow-[0_0_16px_rgba(239,68,68,0.42),inset_0_0_12px_rgba(254,202,202,0.08)]',
  초월: 'border-amber-300/90 bg-[linear-gradient(135deg,rgba(3,3,3,0.98),rgba(120,83,10,0.62)_50%,rgba(3,3,3,0.98))] text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.46),inset_0_0_14px_rgba(253,230,138,0.08)]',
};

export function AchievementTitleBadge({
  title,
  grade,
  compact = false,
  prominent = false,
  className,
}: {
  title?: string | null;
  grade?: AchievementGrade | null;
  compact?: boolean;
  prominent?: boolean;
  className?: string;
}) {
  if (!title) return null;
  const safeGrade = grade ?? '희귀';
  const isPrestige = safeGrade === '유일' || safeGrade === '초월';

  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center rounded-pill border font-black leading-none tracking-tight',
        prominent
          ? 'px-3 py-1.5 text-sm sm:text-base'
          : compact
            ? 'px-2 py-1 text-[11px]'
            : 'px-2.5 py-1.5 text-xs',
        GRADE_CLASS[safeGrade],
        isPrestige && 'ring-1 ring-white/10',
        className,
      )}
      title={`${title} · ${safeGrade}`}
    >
      {isPrestige && (
        <span aria-hidden="true" className="mr-1 text-[0.9em] opacity-95">
          {safeGrade === '유일' ? '◆' : '✦'}
        </span>
      )}
      <span className={cn('truncate', prominent ? 'max-w-[260px]' : 'max-w-[180px]')}>
        {title}
      </span>
      {isPrestige && (
        <span aria-hidden="true" className="ml-1 text-[0.9em] opacity-95">
          {safeGrade === '유일' ? '◆' : '✦'}
        </span>
      )}
    </span>
  );
}
