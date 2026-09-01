import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { supabase } from '@/lib/supabase/client';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { cn } from '@/lib/utils/cn';
import { useRpcCall } from '@/components/shared/components';
import { studentRpc } from '@/lib/rpc/student_rpc';
import { characterC2Rpc, type StudentCharacterCollectionRow } from '@/lib/rpc/character_c2_rpc';
import {
  homePersonalizationRpc,
  type HomePersonalization,
  type HomeShowcaseSlot,
} from '@/lib/rpc/home_personalization_rpc';

interface OwnedBackground {
  ownershipId: number;
  itemId: number;
  name: string;
  resourceUrl: string;
  isEquipped: boolean;
}

interface HomeCustomizationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: number;
  personalization: HomePersonalization | null | undefined;
}

const SLOT_LABELS: Record<1 | 2 | 3, { title: string; short: string }> = {
  1: { title: 'Primary', short: '대표' },
  2: { title: 'Side Left', short: '왼쪽' },
  3: { title: 'Side Right', short: '오른쪽' },
};

export function HomeCustomizationPanel({
  isOpen,
  onClose,
  studentId,
  personalization,
}: HomeCustomizationPanelProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { call, isLoading: isMutating } = useRpcCall();
  const [section, setSection] = useState<'background' | 'showcase'>('background');
  const [activeSlot, setActiveSlot] = useState<1 | 2 | 3>(1);

  const backgroundsQuery = useOwnedBackgrounds(studentId, isOpen);
  const charactersQuery = useOwnedCharacters(isOpen);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  const slotMap = useMemo(() => {
    const map = new Map<number, HomeShowcaseSlot>();
    for (const slot of personalization?.showcase_slots ?? []) map.set(slot.slot_no, slot);
    return map;
  }, [personalization]);

  const usedSlotByCharacter = useMemo(() => {
    const map = new Map<number, number>();
    for (const slot of personalization?.showcase_slots ?? []) {
      if (slot.character_id != null) map.set(slot.character_id, slot.slot_no);
    }
    return map;
  }, [personalization]);

  const invalidateHome = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['home-customization'] }),
      queryClient.invalidateQueries({ queryKey: ['cosmetics', studentId] }),
      queryClient.invalidateQueries({ queryKey: ['character-collection'] }),
    ]);
  };

  const equipBackground = async (background: OwnedBackground) => {
    if (background.isEquipped) return;
    await call(
      () => studentRpc.equipCosmeticItem(supabase, {
        p_student_id: studentId,
        p_ownership_id: background.ownershipId,
      }),
      {
        successTitle: '홈 배경을 바꿨어요 🎨',
        onSuccess: () => { void invalidateHome(); },
      },
    );
  };

  const setCharacter = async (characterId: number | null) => {
    await call(
      () => homePersonalizationRpc.setShowcaseSlot(supabase, {
        p_slot_no: activeSlot,
        p_character_id: characterId,
      }),
      {
        successTitle: characterId == null ? '전시 슬롯을 비웠어요' : '편린 전시를 바꿨어요 ✨',
        onSuccess: () => { void invalidateHome(); },
      },
    );
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/65 backdrop-blur-sm md:items-center md:px-4 md:py-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="홈 꾸미기"
            className="flex h-[86dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[24px] border border-line bg-bg-base shadow-2xl md:h-auto md:max-h-[86dvh] md:rounded-card-lg"
            initial={{ y: 36, opacity: 0, scale: 0.99 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 36, opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.2 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line md:hidden" />
            <header className="flex items-center justify-between border-b border-line px-4 py-3.5 md:px-5">
              <div>
                <div className="text-2xs font-black uppercase tracking-[0.18em] text-brand-glow">Home Personalization</div>
                <h2 className="mt-0.5 font-display text-lg text-brand-gradient">🎨 홈 꾸미기</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-bg-deep text-text-secondary transition hover:text-white"
                aria-label="홈 꾸미기 닫기"
              >
                ✕
              </button>
            </header>

            <div className="grid grid-cols-2 gap-2 border-b border-line px-4 py-3 md:px-5">
              <SectionButton
                active={section === 'background'}
                onClick={() => setSection('background')}
                emoji="🌄"
                label="Background / CG"
              />
              <SectionButton
                active={section === 'showcase'}
                onClick={() => setSection('showcase')}
                emoji="✨"
                label="편린 전시"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 md:px-5">
              {section === 'background' ? (
                <BackgroundSection
                  query={backgroundsQuery}
                  currentOwnershipId={personalization?.background?.ownership_id ?? null}
                  disabled={isMutating}
                  onSelect={(background) => { void equipBackground(background); }}
                  onGoShop={() => {
                    onClose();
                    navigate('/cosmetic');
                  }}
                />
              ) : (
                <ShowcaseSection
                  query={charactersQuery}
                  slotMap={slotMap}
                  usedSlotByCharacter={usedSlotByCharacter}
                  activeSlot={activeSlot}
                  onActiveSlotChange={setActiveSlot}
                  disabled={isMutating}
                  onSelect={(characterId) => { void setCharacter(characterId); }}
                />
              )}
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function SectionButton({
  active,
  onClick,
  emoji,
  label,
}: {
  active: boolean;
  onClick: () => void;
  emoji: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-card-md border px-3 py-2.5 text-sm font-black transition',
        active
          ? 'border-brand-primary/60 bg-brand-primary/15 text-white shadow-brand-sm'
          : 'border-line bg-bg-card text-text-secondary hover:text-white',
      )}
    >
      <span className="mr-1.5">{emoji}</span>{label}
    </button>
  );
}

function BackgroundSection({
  query,
  currentOwnershipId,
  disabled,
  onSelect,
  onGoShop,
}: {
  query: ReturnType<typeof useOwnedBackgrounds>;
  currentOwnershipId: number | null;
  disabled: boolean;
  onSelect: (background: OwnedBackground) => void;
  onGoShop: () => void;
}) {
  if (query.isLoading) {
    return <PanelLoading label="보유 배경을 불러오는 중..." />;
  }

  if (query.isError) {
    return <PanelError label="보유 배경을 불러오지 못했어요." onRetry={() => { void query.refetch(); }} />;
  }

  const backgrounds = query.data ?? [];
  if (backgrounds.length === 0) {
    return (
      <div className="rounded-card-lg border border-dashed border-line bg-bg-card/70 px-5 py-8 text-center">
        <div className="text-4xl">🌌</div>
        <div className="mt-3 text-sm font-black text-white">아직 보유한 Home 배경이 없어요</div>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-text-secondary">
          홈 꾸미기에서는 이미 획득한 배경만 선택할 수 있어요. 구매와 획득은 기존 꾸미기 페이지에서 진행합니다.
        </p>
        <button type="button" onClick={onGoShop} className="btn-primary mt-4 px-5">
          🎨 꾸미기 페이지 열기
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-white">Home 전체 배경</h3>
          <p className="mt-0.5 text-2xs leading-relaxed text-text-secondary">선택한 그림은 Home 전체에 적용됩니다. 구매 기능은 이 창에 포함하지 않습니다.</p>
        </div>
        <button type="button" onClick={onGoShop} className="flex-none text-2xs font-black text-brand-glow hover:underline">
          꾸미기 페이지 →
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {backgrounds.map((background) => {
          const selected = background.ownershipId === currentOwnershipId || background.isEquipped;
          return (
            <button
              key={background.ownershipId}
              type="button"
              disabled={disabled || selected}
              onClick={() => onSelect(background)}
              className={cn(
                'overflow-hidden rounded-card-md border bg-bg-card text-left transition',
                selected ? 'border-brand-primary shadow-brand-sm' : 'border-line hover:border-brand-primary/50',
                disabled && 'opacity-70',
              )}
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-bg-deep">
                <img
                  src={resolveAssetUrl(background.resourceUrl, 'background')}
                  alt={background.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                {selected && (
                  <span className="absolute left-2 top-2 rounded-pill bg-brand-primary px-2 py-0.5 text-2xs font-black text-white">현재 배경</span>
                )}
              </div>
              <div className="truncate px-2.5 py-2 text-xs font-extrabold text-white">{background.name}</div>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-2xs leading-relaxed text-text-muted">
        기본 배경으로 되돌리는 동작은 기존 장착 RPC의 전체 카테고리 해제 동작과 충돌하므로 이번 버전에서는 제공하지 않습니다.
      </p>
    </div>
  );
}

function ShowcaseSection({
  query,
  slotMap,
  usedSlotByCharacter,
  activeSlot,
  onActiveSlotChange,
  disabled,
  onSelect,
}: {
  query: ReturnType<typeof useOwnedCharacters>;
  slotMap: Map<number, HomeShowcaseSlot>;
  usedSlotByCharacter: Map<number, number>;
  activeSlot: 1 | 2 | 3;
  onActiveSlotChange: (slot: 1 | 2 | 3) => void;
  disabled: boolean;
  onSelect: (characterId: number | null) => void;
}) {
  const current = slotMap.get(activeSlot);

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-black text-white">고정 3-slot 편린 전시</h3>
        <p className="mt-0.5 text-2xs leading-relaxed text-text-secondary">대표 편린 장착과는 별개입니다. 같은 편린을 다른 슬롯에 선택하면 그 편린이 새 슬롯으로 이동합니다.</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {([1, 2, 3] as const).map((slotNo) => {
          const slot = slotMap.get(slotNo);
          return (
            <button
              key={slotNo}
              type="button"
              onClick={() => onActiveSlotChange(slotNo)}
              className={cn(
                'rounded-card-md border px-2 py-2.5 text-center transition',
                activeSlot === slotNo
                  ? 'border-brand-primary bg-brand-primary/15 shadow-brand-sm'
                  : 'border-line bg-bg-card hover:border-brand-primary/40',
              )}
            >
              <div className="text-2xs font-black uppercase tracking-wider text-brand-glow">Slot {slotNo}</div>
              <div className="mt-0.5 text-xs font-black text-white">{SLOT_LABELS[slotNo].short}</div>
              <div className="mt-1 truncate text-2xs text-text-secondary">{slot?.name ?? '비어 있음'}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-card-md border border-line bg-bg-deep/70 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-2xs font-black uppercase tracking-wider text-text-muted">{SLOT_LABELS[activeSlot].title}</div>
          <div className="truncate text-sm font-extrabold text-white">{current?.name ?? '현재 비어 있음'}</div>
        </div>
        {current?.character_id != null && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(null)}
            className="flex-none rounded-pill border border-line bg-bg-card px-3 py-1.5 text-2xs font-black text-text-secondary hover:text-white disabled:opacity-50"
          >
            슬롯 비우기
          </button>
        )}
      </div>

      {query.isLoading ? (
        <PanelLoading label="보유 편린을 불러오는 중..." />
      ) : query.isError ? (
        <PanelError label="보유 편린을 불러오지 못했어요." onRetry={() => { void query.refetch(); }} />
      ) : (query.data ?? []).length === 0 ? (
        <div className="mt-4 rounded-card-lg border border-dashed border-line bg-bg-card/70 px-5 py-8 text-center text-sm font-bold text-text-secondary">
          전시할 수 있는 보유 편린이 아직 없어요.
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {(query.data ?? []).map((character) => {
            const usedSlot = usedSlotByCharacter.get(character.character_id);
            const selectedHere = usedSlot === activeSlot;
            return (
              <button
                key={character.character_id}
                type="button"
                disabled={disabled || selectedHere}
                onClick={() => onSelect(character.character_id)}
                className={cn(
                  'group overflow-hidden rounded-card-md border bg-bg-card transition',
                  selectedHere ? 'border-brand-primary shadow-brand-sm' : 'border-line hover:border-brand-primary/50',
                  disabled && 'opacity-70',
                )}
              >
                <div className="relative aspect-[4/5] overflow-hidden bg-bg-deep">
                  <CharacterThumb character={character} />
                  {selectedHere && (
                    <span className="absolute left-1.5 top-1.5 rounded-pill bg-brand-primary px-1.5 py-0.5 text-[9px] font-black text-white">이 슬롯</span>
                  )}
                  {!selectedHere && usedSlot != null && (
                    <span className="absolute left-1.5 top-1.5 rounded-pill bg-black/75 px-1.5 py-0.5 text-[9px] font-black text-white">Slot {usedSlot} → 이동</span>
                  )}
                </div>
                <div className="truncate px-2 py-1.5 text-[10px] font-extrabold text-white">{character.name}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CharacterThumb({ character }: { character: StudentCharacterCollectionRow }) {
  const [failed, setFailed] = useState(false);
  const image = character.full_image_url
    ?? character.card_image_url
    ?? character.avatar_image_url
    ?? character.resource_url;

  if (failed || !image || character.resource_kind === 'EMOJI') {
    return <div className="flex h-full w-full items-center justify-center text-4xl">{character.emoji ?? '✨'}</div>;
  }

  return (
    <img
      src={resolveAssetUrl(image, 'character')}
      alt={character.name}
      className="h-full w-full object-contain p-1.5 transition-transform duration-200 group-hover:scale-[1.03]"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="mt-4 flex items-center justify-center gap-2 rounded-card-lg border border-line bg-bg-card/60 px-4 py-8 text-xs font-bold text-text-secondary">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-primary border-t-transparent" />
      {label}
    </div>
  );
}

function PanelError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="mt-4 rounded-card-lg border border-danger/30 bg-danger-bg px-4 py-5 text-center">
      <div className="text-sm font-black text-white">⚠️ {label}</div>
      <button type="button" onClick={onRetry} className="mt-3 rounded-pill border border-line bg-bg-card px-4 py-1.5 text-xs font-black text-white">
        다시 시도
      </button>
    </div>
  );
}

function useOwnedBackgrounds(studentId: number, enabled: boolean) {
  return useQuery<OwnedBackground[]>({
    queryKey: ['home-customization', 'backgrounds', studentId],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_cosmetic_ownerships')
        .select(`
          id,
          item_id,
          is_equipped,
          item:cosmetic_items!inner(id, name, resource_url, category, is_active)
        `)
        .eq('student_id', studentId)
        .eq('item.category', 'background')
        .eq('item.is_active', true)
        .order('purchased_at', { ascending: false });

      if (error) throw error;

      return (data ?? []).flatMap((row: any) => {
        const item = Array.isArray(row.item) ? row.item[0] : row.item;
        if (!item?.resource_url) return [];
        return [{
          ownershipId: Number(row.id),
          itemId: Number(row.item_id),
          name: String(item.name ?? '배경'),
          resourceUrl: String(item.resource_url),
          isEquipped: Boolean(row.is_equipped),
        } satisfies OwnedBackground];
      });
    },
  });
}

function useOwnedCharacters(enabled: boolean) {
  return useQuery<StudentCharacterCollectionRow[]>({
    queryKey: ['character-collection'],
    enabled,
    staleTime: 20_000,
    queryFn: async () => {
      const result = await characterC2Rpc.myCollection(supabase);
      if (result.success === false) throw new Error(result.error);
      return [...(result.data ?? [])]
        .filter((row) => row.is_owned)
        .sort((a, b) => a.sort_order - b.sort_order || a.character_uid.localeCompare(b.character_uid));
    },
  });
}
