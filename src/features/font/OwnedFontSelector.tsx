import { FontPreview } from './FontPreview';
import type { OwnedFont } from './fontTypes';
import { cn } from '@/lib/utils/cn';

export function OwnedFontSelector({
  fonts,
  disabled,
  onSelect,
  onDefault,
}: {
  fonts: OwnedFont[];
  disabled?: boolean;
  onSelect: (font: OwnedFont) => void;
  onDefault: () => void;
}) {
  const defaultSelected = !fonts.some((font) => font.isEquipped);

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <button
        type="button"
        disabled={disabled || defaultSelected}
        onClick={onDefault}
        className={cn(
          'rounded-card-md border bg-bg-card p-3 text-left transition',
          defaultSelected ? 'border-brand-primary shadow-brand-sm' : 'border-line hover:border-brand-primary/50',
        )}
      >
        <div className="font-system text-xs font-black text-text-muted">
          {defaultSelected ? '현재 적용' : '기본'}
        </div>
        <div className="font-system mt-1 text-base font-bold text-white">Pretendard</div>
      </button>

      {fonts.map((font) => (
        <button
          key={font.ownershipId}
          type="button"
          disabled={disabled || font.isEquipped}
          onClick={() => onSelect(font)}
          className={cn(
            'rounded-card-md border bg-bg-card p-3 text-left transition',
            font.isEquipped ? 'border-brand-primary shadow-brand-sm' : 'border-line hover:border-brand-primary/50',
          )}
        >
          <div className="font-system flex items-center justify-between gap-2 text-2xs font-black text-text-muted">
            <span>{font.isEquipped ? '현재 적용' : '보유 폰트'}</span>
            <span className="truncate">{font.name}</span>
          </div>
          {/* Tiny preview subset contains this fixed sample text. */}
          <FontPreview itemUid={font.itemUid} className="mt-2 break-keep text-base leading-relaxed text-white" />
        </button>
      ))}
    </div>
  );
}
