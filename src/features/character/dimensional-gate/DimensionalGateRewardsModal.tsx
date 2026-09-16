import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useState } from 'react';

import { LoadingSpinner } from '@/components/shared/components';
import {
  dimensionalGateRpc,
  type DimensionalGateRewardRow,
  type DimensionalGateRosterRow,
} from '@/lib/rpc/dimensional_gate_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

interface Props {
  character: DimensionalGateRosterRow;
  onClose: () => void;
}

export default function DimensionalGateRewardsModal({ character, onClose }: Props) {
  const queryClient = useQueryClient();
  const [claiming, setClaiming] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['dimensional-gate-rewards', character.character_id],
    queryFn: async () => {
      const result = await dimensionalGateRpc.rewards(supabase, character.character_id);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 10_000,
    retry: 1,
  });

  const claim = async (reward: DimensionalGateRewardRow) => {
    if (!reward.reached || reward.claimed || claiming != null) return;
    setClaiming(reward.affinity_threshold);
    setMessage(null);
    const result = await dimensionalGateRpc.claimReward(supabase, character.character_id, reward.affinity_threshold);
    setClaiming(null);
    if (result.success === false) {
      setMessage(result.error);
      return;
    }
    const chunks: string[] = [];
    if (result.data.reward_gold) chunks.push(`골드 +${result.data.reward_gold.toLocaleString()}`);
    if (result.data.reward_crystal) chunks.push(`크리스탈 +${result.data.reward_crystal.toLocaleString()}`);
    if (result.data.reward_bv) chunks.push(`BV +${result.data.reward_bv.toLocaleString()}`);
    if (result.data.trust_visual_variant_no) chunks.push(`특별 전시 이미지 ${result.data.trust_visual_variant_no} 해금`);
    setMessage(chunks.length ? chunks.join(' · ') : '보상을 수령했어요.');
    await Promise.all([
      query.refetch(),
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-roster'] }),
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-character', character.character_id] }),
      queryClient.invalidateQueries({ queryKey: ['dimensional-gate-gallery', character.character_id] }),
      queryClient.invalidateQueries({ queryKey: ['home-customization'] }),
      queryClient.invalidateQueries({ queryKey: ['character-collection'] }),
    ]);
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-lg overflow-hidden rounded-card-xl border border-line bg-bg-overlay shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200/70">Affinity Reward</div>
            <h3 className="mt-0.5 text-lg font-black text-white">{character.name} · 호감도 보상</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-line bg-bg-card px-2.5 py-1 text-sm font-black text-white">×</button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {query.isLoading ? (
            <div className="grid min-h-48 place-items-center"><LoadingSpinner size="md" /></div>
          ) : query.isError ? (
            <div className="rounded-card-md border border-danger/30 bg-danger-bg p-4 text-center text-xs font-bold text-danger">보상 정보를 불러오지 못했어요.</div>
          ) : (query.data?.rewards.length ?? 0) === 0 ? (
            <div className="rounded-card-md border border-dashed border-line bg-bg-deep/40 p-8 text-center text-xs font-black text-text-secondary">아직 설정된 호감도 보상이 없습니다.</div>
          ) : (
            <div className="space-y-2.5">
              {query.data?.rewards.map((reward) => (
                <RewardCard key={reward.affinity_threshold} reward={reward} claiming={claiming === reward.affinity_threshold} onClaim={() => { void claim(reward); }} />
              ))}
            </div>
          )}

          {message && <div className="mt-3 rounded-card-md border border-brand-primary/30 bg-brand-primary/10 px-3 py-2.5 text-center text-[10px] font-black text-brand-glow">{message}</div>}
          <p className="mt-3 text-[10px] font-bold leading-relaxed text-text-muted">기억·CG·신뢰 전시 이미지는 관계 달성 기록으로 영구 해금됩니다. 골드·크리스탈·BV 같은 경제 보상만 이 화면에서 한 번 수령합니다.</p>
        </div>
      </motion.div>
    </div>
  );
}

function RewardCard({ reward, claiming, onClaim }: { reward: DimensionalGateRewardRow; claiming: boolean; onClaim: () => void }) {
  const items: string[] = [];
  if (reward.reward_gold) items.push(`🪙 골드 +${reward.reward_gold.toLocaleString()}`);
  if (reward.reward_crystal) items.push(`💎 크리스탈 +${reward.reward_crystal.toLocaleString()}`);
  if (reward.reward_bv) items.push(`✨ BV +${reward.reward_bv.toLocaleString()}`);
  if (reward.gallery_asset_id) items.push('🖼️ 특별 일러스트');
  if (reward.trust_visual_variant_no) items.push(`👤 특별 전시 이미지 ${reward.trust_visual_variant_no}`);
  if (items.length === 0) items.push('관계 마일스톤 기록');

  return (
    <div className={cn('rounded-card-md border p-3', reward.reached ? 'border-violet-300/25 bg-violet-500/5' : 'border-line bg-bg-deep/45 opacity-65')}>
      <div className="flex items-start gap-3">
        <div className={cn('grid h-11 w-11 flex-none place-items-center rounded-full border text-sm font-black', reward.reached ? 'border-violet-300/25 bg-violet-500/10 text-white' : 'border-line text-text-muted')}>
          {reward.affinity_threshold}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black text-white">호감도 {reward.affinity_threshold} 보상</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {items.map((item) => <span key={item} className="rounded-pill border border-line bg-bg-card px-2 py-1 text-[9px] font-bold text-text-secondary">{item}</span>)}
          </div>
        </div>
        {reward.claimed ? (
          <span className="flex-none text-[9px] font-black text-success">✓ 수령완료</span>
        ) : reward.reached ? (
          <button type="button" disabled={claiming} onClick={onClaim} className="flex-none rounded-pill bg-brand-primary px-3 py-1.5 text-[10px] font-black text-white disabled:opacity-50">{claiming ? '처리 중…' : '받기'}</button>
        ) : (
          <span className="flex-none text-[9px] font-black text-text-muted">🔒 미달성</span>
        )}
      </div>
    </div>
  );
}
