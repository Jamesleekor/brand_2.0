import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchOwnedFonts } from './fontCosmeticRpc';
import { applyThemeFont, resetThemeFont } from './fontThemeController';
export function FontThemeProvider({ supabase, studentId, children }: { supabase: SupabaseClient; studentId: number | null | undefined; children: ReactNode }) {
  const query = useQuery({ queryKey:['active-font',studentId], enabled:Boolean(studentId), staleTime:30_000, queryFn:async()=>{ const rows=await fetchOwnedFonts(supabase); return rows.find((row)=>row.isEquipped) ?? null; } });
  useEffect(() => { if (!studentId) { resetThemeFont(); return; } if (query.isSuccess) void applyThemeFont(query.data?.itemUid ?? null); }, [studentId, query.isSuccess, query.data?.itemUid]);
  useEffect(() => () => resetThemeFont(), []); return <>{children}</>;
}
