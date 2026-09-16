import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useState } from 'react';

import { LoadingSpinner } from '@/components/shared/components';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import {
  dimensionalGateRpc,
  type DimensionalGateGalleryAsset,
  type DimensionalGateRosterRow,
} from '@/lib/rpc/dimensional_gate_rpc';
import { studentRpc } from '@/lib/rpc/student_rpc';
import { supabase } from '@/lib/supabase/client';

interface Props {
  character: DimensionalGateRosterRow;
  onClose: () => void;
}

export default function DimensionalGateGalleryModal({ character, onClose }: Props) {
  const queryClient = useQueryClient();
  const [lightbox, setLightbox] = useState<DimensionalGateGalleryAsset | null>(null);
  const [settingBackground, setSettingBackground] = useState(false);
  const [backgroundNotice, setBackgroundNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['dimensional-gate-gallery', character.character_id],
    queryFn: async () => {
      const result = await dimensionalGateRpc.gallery(supabase, character.character_id);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 15_000,
    retry: 1,
  });

  const setAsHomeBackground = async (asset: DimensionalGateGalleryAsset) => {
    if (!asset.unlocked || !asset.home_background_allowed || asset.ownership_id == null || settingBackground) return;
    setSettingBackground(true);
    setBackgroundNotice(null);
    try {
      const result = await studentRpc.equipCosmeticItem(supabase, {
        p_category: 'background',
        p_ownership_id: asset.ownership_id,
      });
      if (result.success === false) throw new Error(result.error);

      setBackgroundNotice('홈 배경으로 설정했어요.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['home-customization'] }),
        queryClient.invalidateQueries({ queryKey: ['cosmetics'] }),
        queryClient.invalidateQueries({ queryKey: ['character-collection'] }),
      ]);
    } catch (error) {
      setBackgroundNotice(error instanceof Error ? error.message : '홈 배경 설정에 실패했어요.');
    } finally {
      setSettingBackground(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[70] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="w-full max-w-3xl overflow-hidden rounded-card-xl border border-line bg-bg-overlay shadow-card"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200/70">Gallery</div>
              <h3 className="mt-0.5 text-lg font-black text-white">{character.name}의 화첩</h3>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-line bg-bg-card px-2.5 py-1 text-sm font-black text-white">×</button>
          </div>

          <div className="max-h-[72vh] overflow-y-auto p-4">
            {query.isLoading ? (
              <div className="grid min-h-48 place-items-center"><LoadingSpinner size="md" /></div>
            ) : query.isError ? (
              <div className="rounded-card-md border border-danger/30 bg-danger-bg p-4 text-center text-xs font-bold text-danger">화첩을 불러오지 못했어요.</div>
            ) : (query.data?.assets.length ?? 0) === 0 ? (
              <div className="rounded-card-md border border-dashed border-line bg-bg-deep/40 p-8 text-center">
                <div className="text-3xl">🖼️</div>
                <p className="mt-2 text-xs font-black text-text-secondary">아직 등록된 장면이 없습니다.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {query.data?.assets.map((asset) => {
                  const image = asset.unlocked && asset.image_url ? resolveAssetUrl(asset.image_url, 'background') : null;
                  return (
                    <button
                      type="button"
                      key={asset.gallery_asset_id}
                      disabled={!image}
                      onClick={() => image && setLightbox(asset)}
                      className="group overflow-hidden rounded-card-md border border-line bg-bg-card text-left"
                    >
                      <div className="relative aspect-[16/10] overflow-hidden bg-bg-deep">
                        {image ? (
                          <img src={image} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                        ) : (
                          <div className="grid h-full place-items-center text-xl text-text-muted">🔒</div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-7">
                          <div className="truncate text-[10px] font-black text-white">{asset.unlocked ? (asset.title || '기록된 장면') : '???'}</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-[9px] font-bold text-text-muted">
                        <span>{asset.asset_type === 'SPECIAL_CG' ? '특별 일러스트' : '스토리 CG'}</span>
                        {!asset.unlocked && asset.unlock_affinity != null && <span>호감도 {asset.unlock_affinity}</span>}
                        {asset.unlocked && asset.home_background_allowed && <span className="text-brand-glow">홈 배경 가능</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-3 rounded-card-md border border-line bg-bg-deep/55 px-3 py-2 text-[10px] font-bold text-text-muted">
              홈 배경 사용이 허용된 장면은 크게 열어 바로 홈 배경으로 설정할 수 있습니다.
            </div>
          </div>
        </motion.div>
      </div>

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.title || '화첩 이미지'}
          onClick={() => { setLightbox(null); setBackgroundNotice(null); }}
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-black/90 p-4"
        >
          <div className="relative flex max-h-[82vh] max-w-[94vw] items-center justify-center" onClick={(event) => event.stopPropagation()}>
            <img
              src={resolveAssetUrl(lightbox.image_url || '', 'background')}
              alt={lightbox.title || ''}
              className="max-h-[82vh] max-w-[94vw] rounded-card-md object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => { setLightbox(null); setBackgroundNotice(null); }}
              className="absolute right-2 top-2 rounded-full border border-white/20 bg-black/65 px-2.5 py-1 text-sm font-black text-white backdrop-blur-sm"
              aria-label="닫기"
            >
              ×
            </button>
          </div>

          <div className="flex min-h-9 flex-wrap items-center justify-center gap-2" onClick={(event) => event.stopPropagation()}>
            {lightbox.unlocked && lightbox.home_background_allowed && lightbox.ownership_id != null && (
              <button
                type="button"
                disabled={settingBackground}
                onClick={() => void setAsHomeBackground(lightbox)}
                className="rounded-card-md border border-brand-main/50 bg-brand-main/20 px-4 py-2 text-xs font-black text-brand-glow transition hover:bg-brand-main/30 disabled:cursor-wait disabled:opacity-60"
              >
                {settingBackground ? '설정 중…' : '홈 배경으로 설정'}
              </button>
            )}
            {lightbox.unlocked && lightbox.home_background_allowed && lightbox.ownership_id == null && (
              <span className="rounded-card-md border border-line bg-bg-card/90 px-3 py-2 text-[10px] font-bold text-text-muted">
                홈 배경 권한을 동기화하는 중입니다.
              </span>
            )}
            {backgroundNotice && (
              <span className="rounded-card-md border border-line bg-bg-card/90 px-3 py-2 text-[10px] font-bold text-white">
                {backgroundNotice}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
