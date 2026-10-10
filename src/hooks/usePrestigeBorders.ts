import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';

// All name-card borders use one cosmetic category, independently of the sale window.
export const PRESTIGE_BORDER_CATEGORY = 'prestige_border';

export type OwnedPrestigeBorder = {
  ownershipId: number;
  studentId: number;
  itemId: number;
  itemUid: string;
  name: string;
  resourceUrl: string;
  isEquipped: boolean;
};

async function fetchBorders(studentIds: number[], equippedOnly: boolean): Promise<OwnedPrestigeBorder[]> {
  if (studentIds.length === 0) return [];

  let request = supabase
    .from('student_cosmetic_ownerships')
    .select('id,student_id,item_id,is_equipped,item:cosmetic_items!inner(item_uid,name,category,resource_url,is_active)')
    .in('student_id', studentIds)
    .eq('item.category', PRESTIGE_BORDER_CATEGORY)
    .eq('item.is_active', true);

  if (equippedOnly) request = request.eq('is_equipped', true);

  const { data, error } = await request;
  if (error) throw new Error(`[Prestige borders] ${error.message}`);

  return (data ?? []).flatMap((row: any) => {
    const item = Array.isArray(row.item) ? row.item[0] : row.item;
    if (!item?.resource_url) return [];
    return [{
      ownershipId: Number(row.id),
      studentId: Number(row.student_id),
      itemId: Number(row.item_id),
      itemUid: String(item.item_uid),
      name: String(item.name),
      resourceUrl: String(item.resource_url),
      isEquipped: Boolean(row.is_equipped),
    }];
  });
}

/** One query per view, independent of the number of student cards rendered. */
export function useEquippedPrestigeBorders(studentIds: number[]) {
  const ids = [...new Set(studentIds.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
  const key = ids.join(',');
  const query = useQuery({
    queryKey: ['equipped-prestige-borders', key],
    enabled: ids.length > 0,
    staleTime: 30_000,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
    queryFn: () => fetchBorders(ids, true),
  });
  const byStudentId = useMemo(
    () => new Map<number, OwnedPrestigeBorder>(
      (query.data ?? []).map((border) => [border.studentId, border]),
    ),
    [query.data],
  );
  return { ...query, byStudentId };
}

/** Ownership remains available for equipping after the limited sale closes. */
export function useMyPrestigeBorders() {
  const studentId = useStudentId();
  return useQuery({
    queryKey: ['my-prestige-borders', studentId],
    enabled: studentId !== null,
    staleTime: 15_000,
    queryFn: () => fetchBorders(studentId === null ? [] : [studentId], false),
  });
}
