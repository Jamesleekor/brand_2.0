import { cn } from '@/lib/utils/cn';

export function GuildNameBadge({
  guildName,
  compact = false,
  className,
}: {
  guildName?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const label = guildName?.trim() || '무소속';
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center rounded-pill border border-bv/30 bg-bv/10 font-black text-bv-100',
        compact ? 'px-2 py-0.5 text-[9px]' : 'px-2.5 py-1 text-[10px] sm:text-xs',
        !guildName && 'border-line bg-bg-deep text-text-muted',
        className,
      )}
      title={`소속 길드 · ${label}`}
    >
      <span aria-hidden="true" className="mr-1">🛡️</span>
      <span className="truncate">{label}</span>
    </span>
  );
}
