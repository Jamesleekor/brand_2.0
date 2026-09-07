import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { fetchOwnedFonts, selectMyCosmetic } from './fontCosmeticRpc';
import { OwnedFontSelector } from './OwnedFontSelector';

export function HomeFontSection({ studentId, onGoShop }: { studentId: number; onGoShop: () => void }) {
  const qc = useQueryClient(); const { call, isLoading } = useRpcCall();
  const query = useQuery({ queryKey:['home-customization','fonts',studentId], queryFn:()=>fetchOwnedFonts(supabase), staleTime:20_000 });
  const refresh=async()=>{ await Promise.all([qc.invalidateQueries({queryKey:['home-customization','fonts',studentId]}),qc.invalidateQueries({queryKey:['active-font',studentId]}),qc.invalidateQueries({queryKey:['home-customization']})]); };
  const set = async (ownershipId: number | null) => { const result=await call(()=>selectMyCosmetic(supabase,'font',ownershipId),{successTitle:ownershipId==null?'기본 폰트로 돌아왔어요':'폰트를 적용했어요 🔤'}); if(result!==null)await refresh(); };
  if (query.isLoading) return <div className="font-system rounded-card-md border border-line bg-bg-card p-5 text-center text-xs text-text-secondary">보유 폰트를 불러오는 중...</div>;
  if (query.isError) return <div className="font-system rounded-card-md border border-danger/30 bg-danger-bg p-5 text-center text-xs text-white">폰트를 불러오지 못했어요.</div>;
  return <div>
    <div className="mb-3 flex items-start justify-between gap-3"><div><h3 className="text-sm font-black text-white">내 폰트</h3><p className="font-system mt-0.5 text-2xs text-text-secondary">구매한 폰트를 선택하면 학생 화면 대부분에 적용됩니다.</p></div><button type="button" onClick={onGoShop} className="font-system flex-none text-2xs font-black text-brand-glow hover:underline">폰트 상점 →</button></div>
    <OwnedFontSelector fonts={query.data ?? []} disabled={isLoading} onDefault={()=>void set(null)} onSelect={(font)=>void set(font.ownershipId)} />
  </div>;
}
