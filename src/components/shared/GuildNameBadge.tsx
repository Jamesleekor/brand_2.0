import { cn } from '@/lib/utils/cn';

export function GuildNameBadge({
  guildName,
  guildLogoUrl,
  compact = false,
  variant = 'default',
  className,
}: {
  guildName?: string | null;
  guildLogoUrl?: string | null;
  compact?: boolean;
  variant?: 'default' | 'ranking';
  className?: string;
}) {
  const label = guildName?.trim() || '무소속';
  const ranking = variant === 'ranking';

  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center rounded-pill border border-bv/30 bg-bv/10 font-black text-bv-100',
        ranking
          ? 'gap-1.5 px-2.5 py-1 text-[12px] leading-none'
          : compact
            ? 'px-2 py-0.5 text-[9px]'
            : 'px-2.5 py-1 text-[10px] sm:text-xs',
        !guildName && 'border-line bg-bg-deep text-text-muted',
        className,
      )}
      title={`소속 길드 · ${label}`}
    >
      {guildLogoUrl ? (
        <img
          src={guildLogoUrl}
          alt=""
          className={cn('shrink-0 rounded-md object-contain', ranking ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5')}
          loading="lazy"
        />
      ) : (
        <span aria-hidden="true" className={cn(ranking ? 'text-[13px]' : 'mr-1')}>
          🛡️
        </span>
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}
