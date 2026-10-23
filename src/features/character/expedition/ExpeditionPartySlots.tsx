import { useState } from 'react';
import type { ExpeditionCharacterRow } from '@/lib/rpc/expedition_rpc';
import { cn } from '@/lib/utils/cn';
import { EXPEDITION_ROLES } from './expeditionParty';

function PartyPortrait({ character }: { character: ExpeditionCharacterRow }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const source = character.card_image_url || character.avatar_image_url || character.resource_url;
  return source && source !== failedUrl && character.resource_kind !== 'EMOJI' ? (
    <img src={source} alt={character.name} className="h-full w-full object-contain object-bottom"
      decoding="async" onError={() => setFailedUrl(source)} />
  ) : <span className="text-4xl sm:text-5xl" aria-label={character.name}>{character.emoji || '✦'}</span>;
}

export function ExpeditionPartySlots({
  characters, activeSlot, disabled, rolesEnabled, onSelect, onRemove, onSwap,
}: {
  characters: (ExpeditionCharacterRow | null)[];
  activeSlot: number;
  disabled: boolean;
  rolesEnabled: boolean;
  onSelect: (slot: number) => void;
  onRemove: (slot: number) => void;
  onSwap: (first: number, second: number) => void;
}) {
  return (
    <div className="mt-4" aria-label="원정대 역할별 편성">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {EXPEDITION_ROLES.map((role, index) => {
          const character = characters[index];
          const active = activeSlot === index;
          return (
            <div key={role.label} className={cn(
              'min-w-0 overflow-hidden rounded-2xl border bg-[#171121] transition-colors',
              active ? 'border-[#FFD58A] ring-1 ring-[#FFD58A]/40' : 'border-white/20',
            )}>
              <button type="button" disabled={disabled} onClick={() => onSelect(index)}
                aria-pressed={active} aria-label={`${role.label} 자리 선택${character ? `: ${character.name}` : ': 비어 있음'}`}
                className="block w-full px-2 pb-2 pt-2.5 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFD58A] disabled:cursor-wait sm:px-3">
                <div className={cn('text-xs font-black sm:text-sm', index === 0 ? 'text-[#FFD58A]' : index === 1 ? 'text-[#73E6F2]' : 'text-[#FFF7ED]')}>
                  <span aria-hidden="true">{role.symbol} </span>{role.label}
                </div>
                <div className="mt-2 flex h-20 items-center justify-center overflow-hidden rounded-xl bg-black/25 sm:h-28">
                  {character ? <PartyPortrait key={character.character_id} character={character} /> : (
                    <span className="text-3xl font-light text-[#F6E1BC]" aria-hidden="true">+</span>
                  )}
                </div>
                <div className="mt-2 truncate text-xs font-black text-[#FFF7ED] sm:text-sm" title={character?.name}>
                  {character?.name ?? '편린 선택'}
                </div>
                <div className="mt-1 min-h-[28px] text-[10px] font-bold leading-tight text-[#F6E1BC] sm:min-h-0 sm:text-xs">
                  {rolesEnabled ? role.effect : index === 2 ? '기본 능력으로 참여' : '보너스는 다음 주부터'}
                </div>
              </button>
              <div className="flex items-center justify-center gap-0.5 border-t border-white/10 bg-black/20 p-1 sm:gap-2">
                <button type="button" disabled={disabled || index === 0} onClick={() => onSwap(index, index - 1)}
                  aria-label={`${role.label} 편린을 왼쪽 자리와 교환`}
                  className="min-h-9 min-w-8 rounded-lg text-lg font-black text-[#FFF7ED] hover:bg-white/10 disabled:opacity-25">←</button>
                <button type="button" disabled={disabled || !character} onClick={() => onRemove(index)}
                  aria-label={`${role.label} ${character?.name ?? ''} 선택 해제`}
                  className="min-h-9 min-w-8 rounded-lg text-xs font-black text-[#FFF7ED] hover:bg-white/10 disabled:opacity-25">해제</button>
                <button type="button" disabled={disabled || index === 2} onClick={() => onSwap(index, index + 1)}
                  aria-label={`${role.label} 편린을 오른쪽 자리와 교환`}
                  className="min-h-9 min-w-8 rounded-lg text-lg font-black text-[#FFF7ED] hover:bg-white/10 disabled:opacity-25">→</button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs font-bold leading-relaxed text-[#F6EFE7]" aria-live="polite">
        {EXPEDITION_ROLES[activeSlot].label} 자리를 선택 중입니다. 아래 편린을 누르면 이 자리에 배치됩니다. 화살표로 자리를 바꿀 수 있습니다.
      </p>
      {!rolesEnabled && <p className="mt-1 text-xs font-bold text-[#FFD58A]">이번 주는 기존 적합도로 진행하며, 역할 보너스는 다음 주 원정부터 적용됩니다.</p>}
    </div>
  );
}
