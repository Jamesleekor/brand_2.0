import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { ExpeditionBoxOpenResult } from '@/lib/rpc/expedition_rpc';
import { supabase } from '@/lib/supabase/client';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { FontPreview } from '@/features/font/FontPreview';
import { getExpeditionRewardChestAsset, getExpeditionRewardTierAsset } from './expeditionAssets';
import { getChestOpeningConfig, nextChestOpeningPhase, type ChestOpeningPhase } from './chestOpening';
import './expeditionChestOpening.css';

function rewardSymbol(result: ExpeditionBoxOpenResult) {
  const kind = result.final_reward_kind.toUpperCase();
  if (kind.includes('GOLD') || result.final_reward_label.includes('GOLD')) return '🪙';
  if (kind.includes('CRYSTAL') || result.final_reward_label.includes('CRYSTAL')) return '💎';
  if (kind.includes('FONT') || result.final_reward_label.includes('폰트')) return 'Aa';
  if (result.final_cosmetic_item_id || kind.includes('COSMETIC')) return '🎨';
  return '🎁';
}

export function ExpeditionBoxOpeningModal({
  tier,
  result,
  error,
  onClose,
}: {
  tier: string;
  result: ExpeditionBoxOpenResult | null;
  error: string | null;
  onClose: () => void;
}) {
  const config = getChestOpeningConfig(tier);
  const [phase, setPhase] = useState<ChestOpeningPhase>('CHARGING');
  const [chargeComplete, setChargeComplete] = useState(false);
  const [previewImageFailed, setPreviewImageFailed] = useState(false);
  const [previewImageReady, setPreviewImageReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cosmeticId = result?.final_cosmetic_item_id ?? null;
  const cosmeticQuery = useQuery({
    queryKey: ['expedition-box-cosmetic-preview', cosmeticId],
    enabled: cosmeticId !== null,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from('cosmetic_items')
        .select('category,item_uid,resource_url,name').eq('id', cosmeticId as number).maybeSingle();
      return queryError ? null : data;
    },
  });
  const cosmetic = cosmeticQuery.data;
  const backgroundUrl = cosmetic?.category === 'background' && cosmetic.resource_url
    ? resolveAssetUrl(cosmetic.resource_url, 'background') : null;
  const showBackground = backgroundUrl !== null && previewImageReady && !previewImageFailed;
  const showFont = cosmetic?.category === 'font';
  const revealed = phase === 'REVEALED' && result !== null;
  const status = error ? '개봉 결과를 확인하지 못했습니다'
    : revealed && result ? result.final_reward_label
      : phase === 'BURST' ? '봉인이 풀렸습니다'
        : chargeComplete ? '보상을 확인하고 있습니다' : '상자의 봉인을 해제하는 중';

  useEffect(() => {
    setPreviewImageReady(false);
    setPreviewImageFailed(false);
    if (!backgroundUrl) return;
    let live = true;
    const image = new Image();
    image.onload = () => { if (live) setPreviewImageReady(true); };
    image.onerror = () => { if (live) setPreviewImageFailed(true); };
    image.src = backgroundUrl;
    return () => {
      live = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [backgroundUrl]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setChargeComplete(true), reducedMotion ? 0 : config.chargeMs);
    return () => window.clearTimeout(timer);
  }, [config.chargeMs, reducedMotion]);

  useEffect(() => {
    setPhase((current) => nextChestOpeningPhase(current, chargeComplete, result !== null, reducedMotion));
  }, [chargeComplete, result, reducedMotion]);

  useEffect(() => {
    if (phase !== 'BURST' || error) return;
    const timer = window.setTimeout(() => setPhase('REVEALED'), config.burstMs);
    return () => window.clearTimeout(timer);
  }, [phase, config.burstMs, error]);

  const style = {
    '--chest-accent': config.accent,
    '--chest-glow': config.glow,
  } as CSSProperties;

  return (
    <div className="expedition-chest-overlay" onClick={() => {
      if (revealed || error) onClose();
    }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${config.label} 원정 상자 개봉`}
        tabIndex={-1}
        style={style}
        data-phase={error ? 'ERROR' : phase}
        data-tier={tier}
        className="expedition-chest-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            if (revealed || error) onClose();
            else if (result) setPhase('REVEALED');
          }
          if (event.key === 'Tab') {
            const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
            if (buttons.length === 0) event.preventDefault();
            else if (event.shiftKey && (document.activeElement === buttons[0] || document.activeElement === dialogRef.current)) {
              event.preventDefault();
              buttons[buttons.length - 1].focus();
            } else if (!event.shiftKey && (document.activeElement === buttons[buttons.length - 1] || document.activeElement === dialogRef.current)) {
              event.preventDefault();
              buttons[0].focus();
            }
          }
        }}
      >
        <div className="expedition-chest-heading">
          <span className="expedition-chest-eyebrow">탐사의 결실</span>
          <h2>{config.label} 원정 상자</h2>
        </div>

        <div className="expedition-chest-stage" aria-hidden="true">
          <div className="expedition-chest-aura" />
          <div className="expedition-chest-ring expedition-chest-ring-outer" />
          <div className="expedition-chest-ring expedition-chest-ring-inner" />
          <div className="expedition-chest-rays">
            {Array.from({ length: 12 }, (_, index) => (
              <span key={index} style={{ '--ray': index } as CSSProperties} />
            ))}
          </div>
          {!revealed && (
            <img src={getExpeditionRewardChestAsset(tier) ?? undefined} alt=""
              className="expedition-chest-image" decoding="async" />
          )}
          <div className="expedition-chest-bloom" />
          <div className="expedition-chest-particles">
            {Array.from({ length: 8 }, (_, index) => (
              <span key={index} style={{ '--particle': index } as CSSProperties} />
            ))}
          </div>
          {revealed && result && (
            <div className="expedition-chest-reward-emblem"
              data-preview={showBackground ? 'background' : showFont ? 'font' : undefined}>
              {showBackground && backgroundUrl ? (
                <div className="expedition-chest-cosmetic-preview">
                  <img src={backgroundUrl} alt=""
                    onError={() => setPreviewImageFailed(true)} />
                </div>
              ) : showFont && cosmetic ? (
                <FontPreview itemUid={cosmetic.item_uid} className="expedition-chest-font-preview" />
              ) : <span>{rewardSymbol(result)}</span>}
              <img src={getExpeditionRewardTierAsset(tier) ?? undefined} alt="" />
            </div>
          )}
        </div>

        <div className="expedition-chest-content">
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{status}</div>
          {error ? (
            <div role="alert">
              <h3>개봉 결과를 확인하지 못했습니다</h3>
              <p className="expedition-chest-error">{error}</p>
              <p>상자함의 보유 수량을 확인해 주세요.</p>
            </div>
          ) : revealed && result ? (
            <div className="expedition-chest-reward-copy">
              <span className="expedition-chest-eyebrow">획득 완료</span>
              <h3>{result.final_reward_label}</h3>
              {result.cosmetic_fallback_crystal && (
                <p>획득 가능한 꾸미기 아이템을 모두 보유해 CRYSTAL로 지급되었습니다.</p>
              )}
              <p>남은 상자 {result.remaining_box_quantity}개</p>
            </div>
          ) : (
            <>
              <h3>{status}</h3>
              <p>{phase === 'BURST' ? '탐사가 남긴 선물이 모습을 드러냅니다.' : '편린들이 가져온 빛이 상자 안에서 모여듭니다.'}</p>
            </>
          )}
        </div>

        <div className="expedition-chest-footer">
          {revealed || error ? (
            <button type="button" className="expedition-chest-confirm" onClick={onClose}>
              {error ? '닫기' : '보상 확인'}
            </button>
          ) : (
            <button type="button" className="expedition-chest-skip" disabled={!result}
              onClick={() => setPhase('REVEALED')}>연출 건너뛰기</button>
          )}
        </div>
      </div>
    </div>
  );
}
