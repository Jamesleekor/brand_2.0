import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';

export const NAMEPLATE_EFFECT_CATEGORY = 'nameplate_effect';

export type NameplateEffectKind = 'CORONATION' | 'CONSTELLATION' | 'SHARD_ASSEMBLY' | 'ROYAL_OPENING';

export type OwnedNameplateEffect = {
  ownershipId: number;
  studentId: number;
  itemId: number;
  itemUid: string;
  name: string;
  resourceUrl: string;
  effectKind: NameplateEffectKind;
  isEquipped: boolean;
};

export function nameplateEffectKind(itemUid: string): NameplateEffectKind | null {
  if (itemUid === 'NAMEFX_CORONATION_2026') return 'CORONATION';
  if (itemUid === 'NAMEFX_CONSTELLATION_2026') return 'CONSTELLATION';
  if (itemUid === 'NAMEFX_SHARD_ASSEMBLY_2026') return 'SHARD_ASSEMBLY';
  if (itemUid === 'NAMEFX_ROYAL_OPENING_2026') return 'ROYAL_OPENING';
  return null;
}

async function fetchNameplateEffects(studentIds: number[], equippedOnly: boolean): Promise<OwnedNameplateEffect[]> {
  if (studentIds.length === 0) return [];

  let request = supabase
    .from('student_cosmetic_ownerships')
    .select('id,student_id,item_id,is_equipped,item:cosmetic_items!inner(item_uid,name,category,resource_url,is_active)')
    .in('student_id', studentIds)
    .eq('item.category', NAMEPLATE_EFFECT_CATEGORY)
    .eq('item.is_active', true);

  if (equippedOnly) request = request.eq('is_equipped', true);

  const { data, error } = await request;
  if (error) throw new Error(`[Nameplate effects] ${error.message}`);

  return (data ?? []).flatMap((row: any) => {
    const item = Array.isArray(row.item) ? row.item[0] : row.item;
    const effectKind = nameplateEffectKind(String(item?.item_uid ?? ''));
    if (!item || !effectKind) return [];
    return [{
      ownershipId: Number(row.id),
      studentId: Number(row.student_id),
      itemId: Number(row.item_id),
      itemUid: String(item.item_uid),
      name: String(item.name),
      resourceUrl: String(item.resource_url ?? ''),
      effectKind,
      isEquipped: Boolean(row.is_equipped),
    }];
  });
}

/** One batched query for every visible student card in the current view. */
export function useEquippedNameplateEffects(studentIds: number[]) {
  const ids = [...new Set(studentIds.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
  const key = ids.join(',');
  const query = useQuery({
    queryKey: ['equipped-nameplate-effects', key],
    enabled: ids.length > 0,
    staleTime: 30_000,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
    queryFn: () => fetchNameplateEffects(ids, true),
  });
  const byStudentId = useMemo(
    () => new Map<number, OwnedNameplateEffect>(
      (query.data ?? []).map((effect) => [effect.studentId, effect]),
    ),
    [query.data],
  );
  return { ...query, byStudentId };
}

/** Ownership remains equippable after the limited sale period ends. */
export function useMyNameplateEffects() {
  const studentId = useStudentId();
  return useQuery({
    queryKey: ['my-nameplate-effects', studentId],
    enabled: studentId !== null,
    staleTime: 15_000,
    queryFn: () => fetchNameplateEffects(studentId === null ? [] : [studentId], false),
  });
}
