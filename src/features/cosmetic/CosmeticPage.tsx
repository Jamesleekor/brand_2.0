// =====================================================================
// B.R.A.N.D 2.0 — 꾸미기 페이지
// Stage 6-C · 생성일 2026-05-20
// =====================================================================
// 학생 꾸미기 시스템 — 구매 + 장착
// 카테고리: background / character / title / frame / effect
// =====================================================================

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

interface CosmeticPricingOption {
  id: number;
  valueToken: string;
  price: number;
  conditionDescription: string | null;
}

interface CosmeticItem {
  id: number;
  name: string;
  description: string;
  category: CosmeticCategory;
  imageUrl: string | null;
  pricingOptions: CosmeticPricingOption[];
  
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
          <PricingSummary options={item.pricingOptions} />
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
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [selectedPricingId, setSelectedPricingId] = useState<number | null>(item.pricingOptions[0]?.id ?? null);
  const selectedPricing = item.pricingOptions.find((option) => option.id === selectedPricingId) ?? null;
  const canBuy = !item.isOwned && !!selectedPricing && canAffordPricing(selectedPricing, wallet);
  
  const handleBuy = async () => {
    if (!studentId || !selectedPricing) return;
    
    await call(
      () => studentRpc.purchaseCosmeticItem(supabase, {
        p_student_id: studentId,
        p_item_id: item.id,
        p_pricing_id: selectedPricing.id,
      }),
      {
        successTitle: `${item.name} 구매 완료! 🎨`,
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ['cosmetics', studentId] });
          void queryClient.invalidateQueries({ queryKey: ['home-customization'] });
          onClose();
        },
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
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ['cosmetics', studentId] });
          void queryClient.invalidateQueries({ queryKey: ['home-customization'] });
          onClose();
        },
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
              <div className="text-2xs font-extrabold text-text-secondary uppercase mb-2">구매 옵션</div>
              {item.pricingOptions.length === 0 ? (
                <div className="text-xs font-bold text-text-muted">현재 구매 가능한 가격 옵션이 없습니다.</div>
              ) : (
                <div className="space-y-2">
                  {item.pricingOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSelectedPricingId(option.id)}
                      className={cn(
                        'w-full rounded-card-md border px-3 py-2 text-left transition',
                        selectedPricingId === option.id
                          ? 'border-brand-primary bg-brand-primary/10'
                          : 'border-line bg-bg-card',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-black">{formatPricingOption(option)}</span>
                        {selectedPricingId === option.id && <span className="text-2xs font-black text-brand-glow">선택</span>}
                      </div>
                      {option.conditionDescription && (
                        <div className="mt-1 text-2xs font-bold text-text-secondary">조건: {option.conditionDescription}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <button
              onClick={handleBuy}
              disabled={!canBuy || isLoading}
              className="btn-primary w-full"
            >
              {isLoading
                ? '구매 중...'
                : item.pricingOptions.length === 0
                  ? '구매 옵션 없음'
                  : !selectedPricing
                    ? '가격 옵션을 선택하세요'
                    : canBuy
                      ? '🛒 구매하기'
                      : '재화 부족'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PricingSummary({ options }: { options: CosmeticPricingOption[] }) {
  if (options.length === 0) {
    return <div className="text-2xs font-bold text-text-muted">현재 구매 옵션 없음</div>;
  }

  return (
    <div className="flex flex-wrap gap-1.5 text-2xs font-bold">
      {options.slice(0, 2).map((option) => (
        <span key={option.id} className={pricingTokenClass(option.valueToken)}>
          {formatPricingOption(option)}
        </span>
      ))}
      {options.length > 2 && <span className="text-text-muted">+{options.length - 2}</span>}
    </div>
  );
}

function formatPricingOption(option: CosmeticPricingOption): string {
  const icon = option.valueToken === 'GOLD' ? '🪙'
    : option.valueToken === 'BV' ? '⭐'
      : option.valueToken === 'CRYSTAL' ? '💎'
        : '◈';
  return `${icon} ${formatNumber(option.price)} ${option.valueToken}`;
}

function pricingTokenClass(valueToken: string): string {
  if (valueToken === 'GOLD') return 'text-gold';
  if (valueToken === 'BV') return 'text-bv';
  if (valueToken === 'CRYSTAL') return 'text-crystal';
  return 'text-text-secondary';
}

function canAffordPricing(option: CosmeticPricingOption, wallet: { gold?: number; bv?: number; crystal?: number } | null | undefined): boolean {
  if (option.valueToken === 'GOLD') return (wallet?.gold ?? 0) >= option.price;
  if (option.valueToken === 'BV') return (wallet?.bv ?? 0) >= option.price;
  if (option.valueToken === 'CRYSTAL') return (wallet?.crystal ?? 0) >= option.price;
  return false;
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
          id, name, description, category, resource_url,
          pricing:cosmetic_item_pricings(id, value_token, price, condition_description, is_active)
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
        const pricingOptions: CosmeticPricingOption[] = (i.pricing ?? [])
          .filter((price: any) => price.is_active !== false)
          .map((price: any) => ({
            id: Number(price.id),
            valueToken: String(price.value_token ?? ''),
            price: Number(price.price ?? 0),
            conditionDescription: price.condition_description ? String(price.condition_description) : null,
          }));
        
        return {
          id: i.id,
          name: i.name,
          description: i.description ?? '',
          category: i.category,
          imageUrl: i.resource_url ?? null,
          pricingOptions,
          isOwned: !!own,
          isEquipped: own?.isEquipped ?? false,
          ownershipId: own?.id ?? null,
        };
      });
    },
    enabled: studentId !== null,
  });
}
