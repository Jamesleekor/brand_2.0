// =====================================================================
// B.R.A.N.D 2.0 — 꾸미기 페이지
// Stage 6-C · 생성일 2026-05-20
// =====================================================================
// 학생 꾸미기 시스템 — 구매 + 장착
// 카테고리: background / character / title / frame / effect
// =====================================================================

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  PageHeader, Modal, LoadingSpinner, EmptyState, useRpcCall
} from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { studentRpc } from '@/lib/rpc/student_rpc';
import { useStudentId } from '@/stores/auth_store';
import { useWallet } from '@/hooks/useWallet';
import { formatNumber } from '@/lib/utils/format';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { cn } from '@/lib/utils/cn';

// =====================================================================
// 타입
// =====================================================================

type CosmeticCategory = 'background' | 'character' | 'title' | 'frame' | 'effect';

interface CosmeticItem {
  id: number;
  name: string;
  description: string;
  category: CosmeticCategory;
  imageUrl: string | null;
  
  // 가격 (pricing 테이블의 첫 옵션)
  pricingId: number | null;
  priceGold: number;
  priceBv: number;
  priceCrystal: number;
  
  // 학생 보유 상태
  isOwned: boolean;
  isEquipped: boolean;
  ownershipId: number | null;
}

const CATEGORIES: { value: CosmeticCategory | 'ALL'; label: string; emoji: string }[] = [
  { value: 'ALL',         label: '전체',     emoji: '🎨' },
  { value: 'background',  label: '배경',     emoji: '🌄' },
  { value: 'character',   label: '캐릭터',   emoji: '👤' },
  { value: 'title',       label: '칭호',     emoji: '👑' },
  { value: 'frame',       label: '프레임',   emoji: '🖼️' },
  { value: 'effect',      label: '효과',     emoji: '✨' },
];

// =====================================================================
// CosmeticPage
// =====================================================================

export default function CosmeticPage() {
  const [category, setCategory] = useState<CosmeticCategory | 'ALL'>('ALL');
  const [selected, setSelected] = useState<CosmeticItem | null>(null);
  
  const { data: items, isLoading } = useCosmeticItems();
  
  const filtered = useMemo(() => {
    if (!items) return [];
    if (category === 'ALL') return items;
    return items.filter((i) => i.category === category);
  }, [items, category]);
  
  return (
    <>
      <PageHeader title="꾸미기" emoji="🎨" />
      
      <div className="px-4 pt-4">
        {/* 카테고리 탭 */}
        <div className="flex gap-1.5 mb-3 overflow-x-auto scrollbar-hide">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setCategory(cat.value)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2 rounded-pill text-xs font-extrabold transition-all flex-shrink-0',
                category === cat.value
                  ? 'bg-gradient-to-r from-brand-primary to-gold text-white'
                  : 'bg-bg-card border border-line text-text-secondary'
              )}
            >
              <span>{cat.emoji}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
        
        {isLoading ? (
          <div className="py-8 flex justify-center"><LoadingSpinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState emoji="🎨" title="이 카테고리에 아이템이 없어요" />
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {filtered.map((item) => (
              <CosmeticCard
                key={item.id}
                item={item}
                onClick={() => setSelected(item)}
              />
            ))}
          </div>
        )}
      </div>
      
      {selected && (
        <CosmeticDetailModal
          item={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

// =====================================================================
// 꾸미기 카드
// =====================================================================

function CosmeticCard({ item, onClick }: { item: CosmeticItem; onClick: () => void }) {
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={cn(
        'bg-bg-card backdrop-blur-card border rounded-card-md overflow-hidden cursor-pointer hover-lift',
        item.isEquipped ? 'border-brand-primary shadow-brand-sm' : 'border-line'
      )}
    >
      {/* 이미지 */}
      <div className="aspect-square bg-bg-deep relative overflow-hidden">
        {item.imageUrl ? (
          <img
            src={resolveAssetUrl(item.imageUrl, item.category as any)}
            alt={item.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl">
            {CATEGORIES.find((c) => c.value === item.category)?.emoji}
          </div>
        )}
        
        {/* 장착 배지 */}
        {item.isEquipped && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-brand-primary text-white rounded-pill text-2xs font-black">
            장착중
          </div>
        )}
        
        {/* 보유 배지 */}
        {item.isOwned && !item.isEquipped && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-success rounded-pill text-2xs font-black text-white">
            보유
          </div>
        )}
      </div>
      
      <div className="p-2.5">
        <h4 className="text-sm font-extrabold text-text-primary mb-1 truncate">
          {item.name}
        </h4>
        
        {item.isOwned ? (
          <button className={cn(
            'w-full py-1.5 rounded-pill text-2xs font-black',
            item.isEquipped 
              ? 'bg-bg-deep text-text-muted'
              : 'bg-gradient-to-r from-brand-primary to-gold text-white'
          )}>
            {item.isEquipped ? '✓ 장착중' : '장착하기'}
          </button>
        ) : (
          <div className="text-2xs font-bold">
            {item.priceGold > 0 && (
              <span className="text-gold">🪙 {formatNumber(item.priceGold)}</span>
            )}
            {item.priceBv > 0 && (
              <span className="text-bv ml-1.5">⭐ {formatNumber(item.priceBv)}</span>
            )}
            {item.priceCrystal > 0 && (
              <span className="text-crystal ml-1.5">💎 {formatNumber(item.priceCrystal)}</span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// =====================================================================
// 상세 모달 (구매/장착)
// =====================================================================

function CosmeticDetailModal({ item, onClose }: { item: CosmeticItem; onClose: () => void }) {
  const studentId = useStudentId();
  const { wallet } = useWallet();
  const { call, isLoading } = useRpcCall();
  
  const canBuy = !item.isOwned && item.pricingId !== null && (
    (item.priceGold === 0 || (wallet?.gold ?? 0) >= item.priceGold) &&
    (item.priceBv === 0 || (wallet?.bv ?? 0) >= item.priceBv) &&
    (item.priceCrystal === 0 || (wallet?.crystal ?? 0) >= item.priceCrystal)
  );
  
  const handleBuy = async () => {
    if (!studentId || !item.pricingId) return;
    
    await call(
      () => studentRpc.purchaseCosmeticItem(supabase, {
        p_student_id: studentId,
        p_item_id: item.id,
        p_pricing_id: item.pricingId!,
      }),
      {
        successTitle: `${item.name} 구매 완료! 🎨`,
        onSuccess: () => onClose(),
      }
    );
  };
  
  const handleEquip = async () => {
    if (!studentId || !item.ownershipId) return;
    
    await call(
      () => studentRpc.equipCosmeticItem(supabase, {
        p_student_id: studentId,
        p_ownership_id: item.ownershipId!,
      }),
      {
        successTitle: `${item.name} 장착! ✨`,
        onSuccess: () => onClose(),
      }
    );
  };
  
  return (
    <Modal isOpen onClose={onClose} title={item.name} emoji="🎨" size="md">
      <div>
        {/* 이미지 미리보기 */}
        <div className="aspect-square bg-bg-deep rounded-card-lg overflow-hidden mb-4 max-w-xs mx-auto">
          {item.imageUrl ? (
            <img
              src={resolveAssetUrl(item.imageUrl, item.category as any)}
              alt={item.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl">
              {CATEGORIES.find((c) => c.value === item.category)?.emoji}
            </div>
          )}
        </div>
        
        {item.description && (
          <p className="text-sm text-text-secondary mb-4 break-keep leading-relaxed">
            {item.description}
          </p>
        )}
        
        {/* 액션 */}
        {item.isOwned ? (
          item.isEquipped ? (
            <div className="bg-success-bg border border-success/40 rounded-card-md p-3 text-center">
              <span className="text-sm font-extrabold text-success">✅ 현재 장착 중</span>
            </div>
          ) : (
            <button onClick={handleEquip} disabled={isLoading} className="btn-primary w-full">
              {isLoading ? '장착 중...' : '✨ 장착하기'}
            </button>
          )
        ) : (
          <div className="space-y-3">
            <div className="bg-bg-deep border border-line rounded-card-md p-3">
              <div className="text-2xs font-extrabold text-text-secondary uppercase mb-2">가격</div>
              <div className="flex items-center gap-3 text-sm font-extrabold">
                {item.priceGold > 0 && <span className="text-gold">🪙 {formatNumber(item.priceGold)}</span>}
                {item.priceBv > 0 && <span className="text-bv">⭐ {formatNumber(item.priceBv)}</span>}
                {item.priceCrystal > 0 && <span className="text-crystal">💎 {formatNumber(item.priceCrystal)}</span>}
              </div>
            </div>
            
            <button
              onClick={handleBuy}
              disabled={!canBuy || isLoading}
              className="btn-primary w-full"
            >
              {isLoading ? '구매 중...' : canBuy ? '🛒 구매하기' : '재화 부족'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// =====================================================================
// 데이터 조회
// =====================================================================

function useCosmeticItems() {
  const studentId = useStudentId();
  
  return useQuery<CosmeticItem[]>({
    queryKey: ['cosmetics', studentId],
    queryFn: async () => {
      if (!studentId) return [];
      
      // 1. 모든 활성 꾸미기 아이템 + 첫 번째 가격 옵션
      const { data: items } = await supabase
        .from('cosmetic_items')
        .select(`
          id, name, description, category, image_url,
          pricing:cosmetic_pricing(id, price_gold, price_bv, price_crystal)
        `)
        .eq('is_active', true);
      
      // 2. 본인이 보유한 꾸미기
      const { data: ownership } = await supabase
        .from('student_cosmetic_ownerships')
        .select('id, item_id, is_equipped')
        .eq('student_id', studentId);
      
      const ownMap = new Map(
        (ownership ?? []).map((o) => [o.item_id, { id: o.id, isEquipped: o.is_equipped }])
      );
      
      return (items ?? []).map((i: any) => {
        const own = ownMap.get(i.id);
        const firstPrice = i.pricing?.[0];
        
        return {
          id: i.id,
          name: i.name,
          description: i.description ?? '',
          category: i.category,
          imageUrl: i.image_url,
          pricingId: firstPrice?.id ?? null,
          priceGold: Number(firstPrice?.price_gold ?? 0),
          priceBv: Number(firstPrice?.price_bv ?? 0),
          priceCrystal: Number(firstPrice?.price_crystal ?? 0),
          isOwned: !!own,
          isEquipped: own?.isEquipped ?? false,
          ownershipId: own?.id ?? null,
        };
      });
    },
    enabled: studentId !== null,
  });
}
