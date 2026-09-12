import { cn } from '@/lib/utils/cn';
import {
  CHARACTER_ELEMENT_META,
  CHARACTER_ELEMENT_TIER_LABELS,
  CHARACTER_ELEMENT_TRAIT_LABELS,
  CHARACTER_ELEMENTS,
  type CharacterElementBudget,
  type CharacterElementFilter,
  type CharacterElementProfile,
  type CharacterElementTierFilter,
  type CharacterElementTrait,
  type CharacterElementTraitFilter,
  getCharacterElementTrait,
} from '@/lib/character_elements';

const ELEMENT_FILTER_ORDER = ['FIRE', 'WATER', 'WIND', 'EARTH', 'LIGHT', 'DARK'] as const;
const TRAIT_FILTER_ORDER: CharacterElementTrait[] = ['PURE', 'EXTREME', 'SPECIALIZED', 'BALANCED'];

export function CharacterElementFilters({
  elementFilter,
  onElementFilterChange,
  traitFilter,
  onTraitFilterChange,
  tierFilter,
  onTierFilterChange,
  disabled = false,
}: {
  elementFilter: CharacterElementFilter;
  onElementFilterChange: (value: CharacterElementFilter) => void;
  traitFilter: CharacterElementTraitFilter;
  onTraitFilterChange: (value: CharacterElementTraitFilter) => void;
  tierFilter: CharacterElementTierFilter;
  onTierFilterChange: (value: CharacterElementTierFilter) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/80 pt-3">
      <div className="flex max-w-full gap-1.5 overflow-x-auto scrollbar-hide">
        <FilterChip
          active={elementFilter === 'ALL'}
          disabled={disabled}
          onClick={() => onElementFilterChange('ALL')}
          label="속성 전체"
        />
        {ELEMENT_FILTER_ORDER.map((element) => {
          const meta = CHARACTER_ELEMENT_META[element];
          return (
            <FilterChip
              key={element}
              active={elementFilter === element}
              disabled={disabled}
              onClick={() => onElementFilterChange(element)}
              label={`${meta.icon} ${meta.label}`}
            />
          );
        })}
      </div>

      <div className="hidden h-6 w-px bg-line lg:block" />

      <div className="flex max-w-full gap-1.5 overflow-x-auto scrollbar-hide">
        <FilterChip
          active={traitFilter === 'ALL'}
          disabled={disabled}
          onClick={() => onTraitFilterChange('ALL')}
          label="성향 전체"
        />
        {TRAIT_FILTER_ORDER.map((trait) => (
          <FilterChip
            key={trait}
            active={traitFilter === trait}
            disabled={disabled}
            onClick={() => onTraitFilterChange(trait)}
            label={CHARACTER_ELEMENT_TRAIT_LABELS[trait]}
          />
        ))}
      </div>

      <label className="ml-auto flex items-center gap-2 text-[10px] font-black text-text-muted">
        <span className="hidden sm:inline">체급</span>
        <select
          value={String(tierFilter)}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            onTierFilterChange(value === 'ALL' ? 'ALL' : Number(value) as CharacterElementBudget);
          }}
          className="rounded-pill border border-line bg-bg-deep/80 px-3 py-2 text-xs font-black text-text-primary outline-none transition focus:border-brand-primary/60 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <option value="ALL">전체 체급</option>
          <option value="8">일반형 · 8</option>
          <option value="9">상급형 · 9</option>
          <option value="10">최고급형 · 10</option>
        </select>
      </label>
    </div>
  );
}

function FilterChip({
  active,
  disabled,
  onClick,
  label,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex flex-shrink-0 items-center rounded-pill border px-2.5 py-1.5 text-[10px] font-black transition-all',
        active
          ? 'border-brand-primary/45 bg-brand-primary/15 text-white'
          : 'border-line bg-bg-deep/60 text-text-secondary hover:border-brand-primary/35 hover:text-text-primary',
        disabled && 'cursor-not-allowed opacity-45',
      )}
    >
      {label}
    </button>
  );
}

export function CharacterElementTierBadge({ profile }: { profile: CharacterElementProfile }) {
  const className = profile.element_budget === 10
    ? 'border-gold/50 bg-bg-base/90 text-gold'
    : profile.element_budget === 9
      ? 'border-crystal/45 bg-bg-base/90 text-crystal'
      : 'border-white/15 bg-bg-base/90 text-text-secondary';

  return (
    <span className={cn('rounded-pill border px-2 py-1 text-[9px] font-black shadow-brand-sm backdrop-blur-sm', className)}>
      {CHARACTER_ELEMENT_TIER_LABELS[profile.element_budget]}
    </span>
  );
}

export function CharacterElementInlineSummary({ profile }: { profile: CharacterElementProfile }) {
  const trait = getCharacterElementTrait(profile);

  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-1 overflow-hidden">
      <ElementPointChip element={profile.primary_element} points={profile.primary_points} compact />
      {profile.secondary_element && profile.secondary_points > 0 && (
        <ElementPointChip element={profile.secondary_element} points={profile.secondary_points} compact />
      )}
      <span className="ml-auto flex-shrink-0 rounded-pill border border-line bg-bg-deep/60 px-1.5 py-0.5 text-[8px] font-black text-text-muted">
        {CHARACTER_ELEMENT_TRAIT_LABELS[trait]}
      </span>
    </div>
  );
}

export function CharacterElementDetailPanel({ profile }: { profile: CharacterElementProfile }) {
  const trait = getCharacterElementTrait(profile);
  const primaryMeta = CHARACTER_ELEMENT_META[profile.primary_element];
  const secondaryMeta = profile.secondary_element ? CHARACTER_ELEMENT_META[profile.secondary_element] : null;
  const primaryPercent = (profile.primary_points / profile.element_budget) * 100;

  return (
    <section className="flex-none border-t border-line bg-bg-card/95 px-4 py-3 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-black uppercase tracking-[0.13em] text-text-muted">편린 속성</div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-pill border border-line bg-bg-deep/70 px-2 py-1 text-[9px] font-black text-text-secondary">
            {CHARACTER_ELEMENT_TIER_LABELS[profile.element_budget]} · {profile.element_budget}
          </span>
          <span className="rounded-pill border border-line bg-bg-deep/70 px-2 py-1 text-[9px] font-black text-text-secondary">
            {CHARACTER_ELEMENT_TRAIT_LABELS[trait]}
          </span>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <ElementPointChip element={profile.primary_element} points={profile.primary_points} />
        {profile.secondary_element && profile.secondary_points > 0 && (
          <ElementPointChip element={profile.secondary_element} points={profile.secondary_points} />
        )}
      </div>

      <div className="mt-2.5 flex h-2 overflow-hidden rounded-pill bg-bg-deep">
        <div
          className="h-full"
          style={{ width: `${primaryPercent}%`, backgroundColor: primaryMeta.color }}
        />
        {secondaryMeta && profile.secondary_points > 0 && (
          <div
            className="h-full flex-1"
            style={{ backgroundColor: secondaryMeta.color }}
          />
        )}
      </div>
    </section>
  );
}

function ElementPointChip({
  element,
  points,
  compact = false,
}: {
  element: (typeof CHARACTER_ELEMENTS)[number];
  points: number;
  compact?: boolean;
}) {
  const meta = CHARACTER_ELEMENT_META[element];
  const alpha = compact ? '16' : '1F';
  const borderAlpha = compact ? '55' : '66';

  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 items-center rounded-pill border font-black',
        compact ? 'gap-0.5 px-1.5 py-0.5 text-[8px]' : 'gap-1 px-2.5 py-1.5 text-xs',
      )}
      style={{
        color: meta.color,
        borderColor: `${meta.color}${borderAlpha}`,
        backgroundColor: `${meta.color}${alpha}`,
      }}
    >
      <span>{meta.icon}</span>
      {!compact && <span>{meta.label}</span>}
      <span>{points}</span>
    </span>
  );
}
