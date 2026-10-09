import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import {
  EXPEDITION_ASSETS,
  getExpeditionFitGradeAsset,
  getExpeditionMasteryAsset,
  getExpeditionRewardChestAsset,
  getExpeditionRewardTierAsset,
  getExpeditionSiteAsset,
  getExpeditionStoryStageAsset,
  getExpeditionWorldEffectAsset,
} from './expedition/expeditionAssets';
import {
  expeditionRpc,
  type ExpeditionBoard,
  type ExpeditionBoxCatalog,
  type ExpeditionBoxOpenResult,
  type ExpeditionCharacterRow,
  type ExpeditionChronicle,
  type ExpeditionChronicleSite,
  type ExpeditionElementCode,
  type ExpeditionLuxuryItem,
  type ExpeditionRunResult,
  type ExpeditionSiteRow,
  type ExpeditionSiteStory,
  type ExpeditionSpecialtyCode,
} from '@/lib/rpc/expedition_rpc';

const SPECIALTY_META: Record<ExpeditionSpecialtyCode, { label: string; icon: string }> = {
  RUINS: { label: '유적', icon: '🏛' },
  NATURE: { label: '자연', icon: '🌿' },
  SANCTUARY: { label: '성소', icon: '✦' },
};

const ELEMENT_META: Record<ExpeditionElementCode, { label: string; icon: string }> = {
  WATER: { label: '수', icon: '💧' },
  FIRE: { label: '화', icon: '🔥' },
  WIND: { label: '풍', icon: '💫' },
  EARTH: { label: '토', icon: '🪨' },
  LIGHT: { label: '빛', icon: '✦' },
  DARK: { label: '암', icon: '☾' },
};

const WORLD_EFFECT_LABEL: Record<string, string> = {
  RESTORE: '편린 복구 지원',
  SHOP: '상점 할인',
  SUPPLY: '골드 보급',
  RECORD: '고고학자의 발굴 지원',
  COSMETIC: '상점(명품관) 개방',
};

function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const value = Math.floor(Math.random() * 16);
    const hex = token === 'x' ? value : (value & 0x3) | 0x8;
    return hex.toString(16);
  });
}

export default function ExpeditionChroniclePanel() {
  const queryClient = useQueryClient();
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<number[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [story, setStory] = useState<ExpeditionSiteStory | null>(null);
  const [storyLoading, setStoryLoading] = useState(false);
  const [dismissedPopup, setDismissedPopup] = useState(false);
  const [boxResults, setBoxResults] = useState<Record<number, ExpeditionBoxOpenResult>>({});
  const [boxOpeningPopup, setBoxOpeningPopup] = useState<ExpeditionBoxOpenResult | null>(null);

  const boardQuery = useQuery<ExpeditionBoard>({
    queryKey: ['expedition-board'],
    queryFn: async () => {
      const result = await expeditionRpc.board(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 4_000,
    refetchOnWindowFocus: true,
  });

  const enabled = boardQuery.data?.enabled === true;

  const chronicleQuery = useQuery({
    queryKey: ['expedition-chronicle'],
    queryFn: async () => {
      const result = await expeditionRpc.chronicle(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled,
    staleTime: 8_000,
    refetchOnWindowFocus: true,
  });

  const fragmentQuery = useQuery({
    queryKey: ['expedition-fragment-wallet'],
    queryFn: async () => {
      const result = await expeditionRpc.fragmentWallet(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled,
    staleTime: 5_000,
  });

  const luxuryQuery = useQuery({
    queryKey: ['expedition-luxury-shop'],
    queryFn: async () => {
      const result = await expeditionRpc.luxuryShop(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled,
    staleTime: 8_000,
  });

  const boxInventoryQuery = useQuery({
    queryKey: ['expedition-box-inventory'],
    queryFn: async () => {
      const result = await expeditionRpc.boxInventory(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled,
    staleTime: 4_000,
  });

  const boxCatalogQuery = useQuery({
    queryKey: ['expedition-box-catalog'],
    queryFn: async () => {
      const result = await expeditionRpc.boxCatalog(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled,
    staleTime: 60_000,
  });

  const board = boardQuery.data;
  const sites = board?.sites ?? [];
  const characters = board?.characters ?? [];
  const activeSiteId = selectedSiteId ?? sites[0]?.week_site_id ?? null;
  const activeSite = sites.find((site) => site.week_site_id === activeSiteId) ?? null;
  const phase = board?.week?.phase ?? 'CLOSED';
  const canSubmit = phase === 'SAT'
    ? board?.can_submit_sat === true
    : phase === 'SUN'
      ? board?.can_submit_sun === true
      : false;

  const currentRun = phase === 'SUN'
    ? board?.my_sun_run ?? null
    : phase === 'SAT'
      ? board?.my_sat_run ?? null
      : board?.my_sun_run ?? board?.my_sat_run ?? null;

  const previewQuery = useQuery({
    queryKey: ['expedition-preview', activeSiteId, [...selectedCharacterIds].sort((a, b) => a - b).join(',')],
    queryFn: async () => {
      const result = await expeditionRpc.preview(
        supabase,
        activeSiteId as number,
        selectedCharacterIds,
      );
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: enabled && canSubmit && activeSiteId !== null && selectedCharacterIds.length === 3,
    staleTime: 2_000,
  });

  const selectedCharacters = useMemo(
    () => selectedCharacterIds
      .map((id) => characters.find((character) => character.character_id === id))
      .filter((character): character is ExpeditionCharacterRow => Boolean(character)),
    [characters, selectedCharacterIds],
  );

  const refreshExpedition = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['expedition-board'] }),
      queryClient.invalidateQueries({ queryKey: ['expedition-chronicle'] }),
      queryClient.invalidateQueries({ queryKey: ['expedition-fragment-wallet'] }),
      queryClient.invalidateQueries({ queryKey: ['expedition-luxury-shop'] }),
      queryClient.invalidateQueries({ queryKey: ['expedition-box-inventory'] }),
      queryClient.invalidateQueries({ queryKey: ['character-collection'] }),
    ]);
  };

  const toggleCharacter = (character: ExpeditionCharacterRow) => {
    if (!canSubmit || character.recovery_required) return;
    setNotice(null);
    setSelectedCharacterIds((current) => {
      if (current.includes(character.character_id)) {
        return current.filter((id) => id !== character.character_id);
      }
      if (current.length >= 3) {
        return [current[0], current[1], character.character_id];
      }
      return [...current, character.character_id];
    });
  };

  const submitExpedition = async () => {
    if (!activeSiteId || selectedCharacterIds.length !== 3 || !canSubmit) return;
    setBusyAction('submit');
    setNotice(null);
    const result = await expeditionRpc.submit(
      supabase,
      activeSiteId,
      selectedCharacterIds,
      newRequestId(),
    );
    setBusyAction(null);
    if (result.success === false) {
      setNotice(toStudentError(result.error));
      return;
    }
    setSelectedCharacterIds([]);
    setNotice(result.data.already_submitted ? '이번 원정 결과를 다시 불러왔습니다.' : '원정 결과가 확정되었습니다.');
    await refreshExpedition();
  };

  const claimReward = async (run: ExpeditionRunResult) => {
    setBusyAction(`claim-${run.run_id}`);
    setNotice(null);
    const result = await expeditionRpc.claim(supabase, run.run_id, newRequestId());
    setBusyAction(null);
    if (result.success === false) {
      setNotice(toStudentError(result.error));
      return;
    }
    setNotice(
      result.data.claim_status === 'SIMULATED'
        ? '체험 운영 결과를 확인했습니다. 실제 자산은 지급되지 않습니다.'
        : '원정 보상을 받았습니다.',
    );
    await refreshExpedition();
  };

  const openBoxItem = async (itemId: number) => {
    setBusyAction(`box-item-${itemId}`);
    setNotice(null);
    const result = await expeditionRpc.openBox(supabase, itemId, newRequestId());
    setBusyAction(null);
    if (result.success === false) {
      setNotice(toStudentError(result.error));
      return;
    }
    setBoxResults((current) => ({ ...current, [itemId]: result.data }));
    setBoxOpeningPopup(result.data);
    setNotice(`상자를 열었습니다: ${result.data.final_reward_label}`);
    await refreshExpedition();
  };

  const restoreCharacter = async (characterId: number) => {
    setBusyAction(`restore-${characterId}`);
    setNotice(null);
    const result = await expeditionRpc.restore(supabase, characterId, newRequestId());
    setBusyAction(null);
    if (result.success === false) {
      setNotice(toStudentError(result.error));
      return;
    }
    setNotice(`${result.data.character_name} 복원이 완료되었습니다. 편린 조각 ${result.data.final_cost}개를 사용했습니다.`);
    await refreshExpedition();
  };

  const loadStory = async (siteCode: string) => {
    setStoryLoading(true);
    setNotice(null);
    const result = await expeditionRpc.siteStory(supabase, siteCode);
    setStoryLoading(false);
    if (result.success === false) {
      setNotice(toStudentError(result.error));
      return;
    }
    setStory(result.data);
  };

  const acknowledgeSundayPopup = async () => {
    const popup = board?.sunday_popup;
    if (!popup) return;
    setBusyAction('sunday-popup');
    const result = await expeditionRpc.acknowledgeSundayPopup(supabase, popup.week_id);
    setBusyAction(null);
    if (result.success === false) {
      setNotice(toStudentError(result.error));
      return;
    }
    setDismissedPopup(true);
    await queryClient.invalidateQueries({ queryKey: ['expedition-board'] });
  };

  const purchaseLuxury = async (item: ExpeditionLuxuryItem, pricingId: number) => {
    setBusyAction(`luxury-${item.item_id}`);
    setNotice(null);
    const result = await expeditionRpc.purchaseLuxury(supabase, item.item_id, pricingId);
    setBusyAction(null);
    if (result.success === false) {
      setNotice(toStudentError(result.error));
      return;
    }
    setNotice(`${item.name} 구매가 완료되었습니다.`);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['expedition-luxury-shop'] }),
      queryClient.invalidateQueries({ queryKey: ['wallet'] }),
    ]);
  };

  if (boardQuery.isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (boardQuery.isError) {
    return (
      <PanelNotice
        tone="danger"
        title="원정 정보를 불러오지 못했습니다."
        body="잠시 뒤 다시 시도해주세요."
        actionLabel="다시 불러오기"
        onAction={() => void boardQuery.refetch()}
      />
    );
  }

  if (!board?.enabled) {
    return (
      <PanelNotice
        tone="neutral"
        title="편린 원정은 아직 개방되지 않았습니다."
        body="운영국에서 이번 주 원정을 준비하고 있습니다. 개방되면 이곳에서 탐사지와 원정대를 확인할 수 있습니다."
      />
    );
  }

  return (
    <div className="space-y-4 pb-10">
      {notice && (
        <div className="rounded-card-md border border-brand-primary/35 bg-brand-primary/10 px-4 py-3 text-sm font-black text-[#FFF7ED]">
          {notice}
        </div>
      )}

      <ExpeditionStatusHeader board={board} chronicle={chronicleQuery.data ?? null} />

      {!board.week ? (
        <PanelNotice
          tone="neutral"
          title="이번 주 공개된 원정이 없습니다."
          body="다음 원정이 공개되면 세 탐사지와 환경 정보가 이곳에 나타납니다."
        />
      ) : (
        <>
          <section className="rounded-card-xl border border-line bg-bg-card/90 p-4 shadow-card lg:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-center gap-3">
                <img src={EXPEDITION_ASSETS.common.trace} alt="" className="h-10 w-10 flex-none object-contain" decoding="async" />
                <div>
                  <div className="text-[13px] font-black uppercase tracking-[0.14em] text-[#FFD58A]">이번 주 원정</div>
                  <h2 className="mt-1 font-display text-xl text-[#FFF7ED]">탐사지 선택</h2>
                  <p className="mt-1 text-sm font-semibold text-[#F6EFE7]">
                    {phaseMessage(phase)}
                  </p>
                </div>
              </div>
              <div className="rounded-pill border border-line bg-bg-deep/70 px-3 py-1.5 text-sm font-black text-[#FFF7ED]">
                {phaseLabel(phase)}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {sites.map((site) => (
                <SiteCard
                  key={site.week_site_id}
                  site={site}
                  selected={site.week_site_id === activeSiteId}
                  onClick={() => {
                    setSelectedSiteId(site.week_site_id);
                    setSelectedCharacterIds([]);
                    setNotice(null);
                  }}
                  onStory={() => void loadStory(site.site_code)}
                />
              ))}
            </div>
          </section>

          <ExpeditionRewardGuideSection
            catalog={boxCatalogQuery.data ?? null}
            loading={boxCatalogQuery.isLoading}
          />

          {activeSite && (
            <section className="rounded-card-xl border border-line bg-bg-card/90 p-4 shadow-card lg:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-black uppercase tracking-[0.14em] text-[#FFD58A]">원정대 편성</div>
                  <h2 className="mt-1 font-display text-xl text-[#FFF7ED]">{activeSite.site_name}</h2>
                  <p className="mt-1 text-sm font-semibold text-[#F6EFE7]">
                    편린 3명을 선택하면 원정 적합도와 예상 흔적을 미리 확인할 수 있습니다.
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black text-[#FFF7ED]">선택 {selectedCharacterIds.length}/3</div>
                  {phase === 'SUN' && (
                    <div className="mt-1 text-[13px] font-bold text-[#FFCC80]">토요일 원정 편린은 회복 필요</div>
                  )}
                </div>
              </div>

              {!canSubmit && currentRun ? (
                <div className="mt-4">
                  <RunResultCard
                    run={currentRun}
                    busyAction={busyAction}
                    onClaim={() => void claimReward(currentRun)}
                  />
                </div>
              ) : !canSubmit ? (
                <div className="mt-4 rounded-card-lg border border-line bg-bg-deep/55 p-4 text-sm font-bold text-[#F2EADB]">
                  지금은 원정대를 보낼 수 있는 시간이 아닙니다. 탐사지 정보와 연대기는 계속 확인할 수 있습니다.
                </div>
              ) : (
                <>
                  <div className="sticky top-2 z-30 mt-4 rounded-card-xl border border-brand-primary/45 bg-[#110D1B]/95 p-2.5 shadow-2xl backdrop-blur-md sm:top-3">
                    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-stretch">
                      <PreviewCard
                        site={activeSite}
                        selectedCharacters={selectedCharacters}
                        isLoading={previewQuery.isFetching}
                        error={previewQuery.isError ? '원정 적합도를 계산하지 못했습니다.' : null}
                        preview={previewQuery.data ?? null}
                      />
                      <button
                        type="button"
                        disabled={selectedCharacterIds.length !== 3 || previewQuery.isFetching || busyAction === 'submit'}
                        onClick={() => void submitExpedition()}
                        className="min-h-[64px] rounded-card-lg border border-brand-primary/55 bg-brand-primary/25 px-5 py-3 text-sm font-black text-white shadow-brand-sm transition hover:bg-brand-primary/35 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyAction === 'submit' ? '원정 기록 중...' : '원정 보내기'}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-sm font-bold text-[#FFF7ED]">
                      <span>
                        선택 {selectedCharacterIds.length}/3
                        {selectedCharacters.length > 0 && ` · ${selectedCharacters.map((item) => item.name).join(' / ')}`}
                      </span>
                      {selectedCharacterIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedCharacterIds([])}
                          className="rounded-pill border border-white/20 bg-white/5 px-2.5 py-1 text-[13px] font-black text-[#FFF7ED]"
                        >
                          선택 초기화
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 rounded-card-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-bold leading-relaxed text-[#F6EFE7]">
                    3명을 선택한 뒤 다른 편린을 누르면 <span className="font-black text-[#FFD58A]">3번 슬롯이 즉시 교체</span>됩니다. 두 명을 고정해 두고 후보를 빠르게 바꾸며 적합도를 비교할 수 있습니다.
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    {characters.map((character) => (
                      <PartyCharacterCard
                        key={character.character_id}
                        character={character}
                        selected={selectedCharacterIds.includes(character.character_id)}
                        disabled={character.recovery_required}
                        onClick={() => toggleCharacter(character)}
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}

      <FragmentRestoreSection
        wallet={fragmentQuery.data ?? null}
        loading={fragmentQuery.isLoading}
        busyAction={busyAction}
        onRestore={restoreCharacter}
      />

      <ExpeditionBoxInventorySection
        inventory={boxInventoryQuery.data ?? null}
        loading={boxInventoryQuery.isLoading}
        busyAction={busyAction}
        results={boxResults}
        onOpen={openBoxItem}
      />

      <ChronicleSection
        sites={chronicleQuery.data?.sites ?? []}
        recentRuns={chronicleQuery.data?.recent_runs ?? []}
        loading={chronicleQuery.isLoading}
        onStory={loadStory}
        onClaim={claimReward}
        busyAction={busyAction}
      />

      <LuxuryShopSection
        shop={luxuryQuery.data ?? null}
        loading={luxuryQuery.isLoading}
        busyAction={busyAction}
        onBuy={purchaseLuxury}
      />

      {boxOpeningPopup && (
        <BoxOpeningResultModal
          result={boxOpeningPopup}
          onClose={() => setBoxOpeningPopup(null)}
        />
      )}

      {board.sunday_popup && !dismissedPopup && (
        <SundayEventModal
          popup={board.sunday_popup}
          isClosing={busyAction === 'sunday-popup'}
          onClose={() => void acknowledgeSundayPopup()}
        />
      )}

      {story && (
        <StoryModal story={story} onClose={() => setStory(null)} />
      )}

      {storyLoading && (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/45">
          <LoadingSpinner size="lg" />
        </div>
      )}
    </div>
  );
}

function ExpeditionStatusHeader({
  board,
  chronicle,
}: {
  board: ExpeditionBoard;
  chronicle: ExpeditionChronicle | null;
}) {
  const effect = chronicle?.active_world_effect ?? null;
  return (
    <section className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
      <div className="rounded-card-xl border border-brand-primary/30 bg-gradient-to-br from-brand-primary/15 via-bg-card to-bg-deep p-4 shadow-card lg:p-5">
        <div className="flex items-center gap-3">
          <img
            src={EXPEDITION_ASSETS.common.emblem}
            alt=""
            className="h-14 w-14 flex-none object-contain drop-shadow-[0_6px_18px_rgba(113,75,255,0.28)]"
            decoding="async"
          />
          <div className="min-w-0">
            <div className="text-[13px] font-black uppercase tracking-[0.15em] text-[#FFD58A]">Fragment Expedition</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="font-display text-2xl text-[#FFF7ED]">편린 원정</h2>
              {board.week?.reward_mode === 'DRY_RUN' && (
                <span className="rounded-pill border border-warning/40 bg-warning/10 px-2 py-1 text-sm font-black text-warning">
                  체험 운영
                </span>
              )}
            </div>
          </div>
        </div>
        <p className="mt-2 max-w-2xl text-sm font-semibold leading-relaxed text-[#F2EADB]">
          세 탐사지 중 한 곳을 고르고 편린 3명을 보내 흔적을 남깁니다. 토요일에 보낸 편린은 일요일에는 회복이 필요합니다.
        </p>
      </div>

      <div className="relative overflow-hidden rounded-card-xl border border-line bg-bg-card/90 p-4 shadow-card lg:p-5">
        <img
          src={EXPEDITION_ASSETS.worldEffectActivation}
          alt=""
          className="pointer-events-none absolute -bottom-8 -right-5 h-28 w-28 object-contain opacity-[0.12]"
          loading="lazy"
          decoding="async"
        />
        <div className="relative">
          <div className="text-[13px] font-black uppercase tracking-[0.14em] text-[#FFD58A]">현재 월드효과</div>
          {effect ? (
            <div className="mt-2 flex items-center gap-3">
              {getExpeditionWorldEffectAsset(effect.effect_code) && (
                <img
                  src={getExpeditionWorldEffectAsset(effect.effect_code) ?? undefined}
                  alt=""
                  className="h-12 w-12 flex-none object-contain"
                  loading="lazy"
                  decoding="async"
                />
              )}
              <div>
                <div className="text-lg font-black text-[#FFF7ED]">
                  {WORLD_EFFECT_LABEL[effect.effect_code] ?? '원정 효과'} Lv.{effect.effect_level}
                </div>
                <div className="mt-1 text-sm font-semibold text-[#F6EFE7]">
                  {formatDateTime(effect.ends_at)}까지
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-sm font-bold text-[#F2EADB]">현재 활성화된 원정 월드효과가 없습니다.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function SiteCard({
  site,
  selected,
  onClick,
  onStory,
}: {
  site: ExpeditionSiteRow;
  selected: boolean;
  onClick: () => void;
  onStory: () => void;
}) {
  const specialty = SPECIALTY_META[site.specialty_code];
  const siteAsset = getExpeditionSiteAsset(site.site_code);
  const specialtyAsset = EXPEDITION_ASSETS.specialty[site.specialty_code];
  return (
    <div
      className={cn(
        'rounded-card-lg border p-3 transition-all',
        selected
          ? 'border-brand-primary/55 bg-brand-primary/10 shadow-brand-sm'
          : 'border-line bg-bg-deep/55 hover:border-line-strong',
      )}
    >
      {siteAsset && (
        <div className="relative mb-3 h-24 overflow-hidden rounded-card-md border border-white/10 bg-black/25">
          <img
            src={siteAsset}
            alt=""
            className="h-full w-full object-cover"
            decoding="async"
          />
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-pill border border-white/15 bg-black/55 px-2 py-1 backdrop-blur-sm">
            <img src={specialtyAsset} alt="" className="h-4 w-4 object-contain" decoding="async" />
            <span className="text-xs font-black text-[#FFF7ED]">{specialty.label}</span>
          </div>
        </div>
      )}
      <button type="button" onClick={onClick} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-black text-[#FFD58A]">{specialty.label}</div>
            <div className="mt-1 text-sm font-black text-[#FFF7ED]">{site.site_name}</div>
          </div>
          {site.sunday_environment_changed && (
            <span className="rounded-pill border border-crystal/35 bg-crystal/10 px-2 py-1 text-xs font-black text-[#73E6F2]">환경 변화</span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5 text-sm font-bold">
          <MiniStat label="이번 주 흔적" value={`${site.weekly_trace}`} />
          <MiniStat label="원정 인원" value={`${site.weekly_participants}명`} />
          <MiniStat label="누적 흔적" value={`${site.cumulative_trace}`} />
          <MiniStat label="탐사 단계" value={site.story_stage_label} />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <ElementChip code={site.major_element} strong />
          <ElementChip code={site.minor_element} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-card-md border border-white/10 bg-white/[0.04] px-3 py-2.5">
          <div>
            <div className="text-xs font-black text-[#FFF7ED]">핵심 보상</div>
            <div className="mt-0.5 text-sm font-black text-[#FFD58A]">{site.core_reward_label}</div>
          </div>
          <div className="flex min-w-0 items-center gap-2.5 text-right">
            <img
              src={getExpeditionWorldEffectAsset(site.world_effect_code)}
              alt=""
              className="h-9 w-9 flex-none object-contain"
              loading="lazy"
              decoding="async"
            />
            <div className="min-w-0">
              <div className="text-xs font-black text-[#FFF7ED]">최종 주도지역 효과</div>
              <div className="mt-0.5 break-keep text-sm font-black text-[#D9C3FF]">{site.world_effect_label}</div>
              <div className="mt-0.5 text-[11px] font-bold text-[#F6EFE7]">흔적 12+부터 발동</div>
            </div>
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={onStory}
        className="mt-3 w-full rounded-pill border border-line bg-bg-card/80 px-2.5 py-1.5 text-sm font-black text-[#FFF7ED] hover:border-brand-primary/40"
      >
        탐사 기록 보기
      </button>
    </div>
  );
}

function PartyCharacterCard({
  character,
  selected,
  disabled,
  onClick,
}: {
  character: ExpeditionCharacterRow;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const specialty = SPECIALTY_META[character.specialty_code];
  const src = character.card_image_url || character.avatar_image_url || character.resource_url;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative min-h-[190px] overflow-hidden rounded-card-lg border text-left transition-all',
        selected
          ? 'border-brand-primary/80 bg-brand-primary/15 shadow-brand-sm'
          : 'border-line bg-bg-deep/60 hover:border-brand-primary/45',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <div className="flex h-[108px] items-center justify-center bg-black/20">
        {character.resource_kind === 'EMOJI' || !src ? (
          <span className="text-6xl">{character.emoji || '✦'}</span>
        ) : (
          <img src={src} alt={character.name} className="h-full w-full object-contain" decoding="async" />
        )}
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-black text-[#FFF7ED]">{character.name}</div>
        <div className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-black text-[#FFF7ED]">
          <img src={EXPEDITION_ASSETS.specialty[character.specialty_code]} alt="" className="h-[18px] w-[18px] object-contain" decoding="async" />
          {specialty.label}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-pill border border-white/15 bg-white/[0.05] px-2 py-1 text-[13px] font-black text-[#FFF7ED]">
            <img src={EXPEDITION_ASSETS.element[character.primary_element]} alt="" className="h-[18px] w-[18px] object-contain" decoding="async" />
            주 {character.primary_points}
          </span>
          {character.secondary_element && character.secondary_points > 0 && (
            <span className="inline-flex items-center gap-1 rounded-pill border border-white/15 bg-white/[0.05] px-2 py-1 text-[13px] font-black text-[#FFF7ED]">
              <img src={EXPEDITION_ASSETS.element[character.secondary_element]} alt="" className="h-[18px] w-[18px] object-contain" decoding="async" />
              보 {character.secondary_points}
            </span>
          )}
        </div>
      </div>
      {selected && (
        <div className="absolute right-2 top-2 rounded-full border border-brand-primary/70 bg-brand-primary px-2.5 py-1 text-[13px] font-black text-white">선택</div>
      )}
      {disabled && (
        <div className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1.5 rounded-card-md border border-warning/45 bg-[#2C2012]/95 px-2 py-1.5 text-center text-[13px] font-black text-warning">
          <img src={EXPEDITION_ASSETS.recoveryRequired} alt="" className="h-5 w-5 object-contain" decoding="async" />
          회복 필요
        </div>
      )}
    </button>
  );
}

function PreviewCard({
  site,
  selectedCharacters,
  isLoading,
  error,
  preview,
}: {
  site: ExpeditionSiteRow;
  selectedCharacters: ExpeditionCharacterRow[];
  isLoading: boolean;
  error: string | null;
  preview: any;
}) {
  if (selectedCharacters.length !== 3) {
    return (
      <div className="flex min-h-[64px] items-center rounded-card-lg border border-line bg-bg-deep/70 px-4 py-3 text-sm font-bold text-[#FFF7ED]">
        편린 {selectedCharacters.length}/3 선택 · 세 명을 채우면 원정 적합도와 예상 흔적을 바로 계산합니다.
      </div>
    );
  }
  if (isLoading) {
    return <div className="flex min-h-[64px] items-center justify-center rounded-card-lg border border-line bg-bg-deep/70"><LoadingSpinner size="sm" /></div>;
  }
  if (error || !preview) {
    return <div className="rounded-card-lg border border-danger/35 bg-danger-bg p-3 text-sm font-black text-[#FFF7ED]">{error ?? '적합도를 확인할 수 없습니다.'}</div>;
  }

  const fitAsset = getExpeditionFitGradeAsset(preview.fit_grade);
  return (
    <div className="rounded-card-lg border border-line bg-bg-deep/75 p-3">
      <div className="flex items-center gap-3">
        {fitAsset && (
          <img src={fitAsset} alt="" className="h-11 w-11 flex-none object-contain" decoding="async" />
        )}
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <PreviewStat label="원정 적합도" value={`${preview.fit_percent}%`} strong />
          <PreviewStat label="등급" value={preview.fit_grade_ko} />
          <PreviewStat label="예상 흔적" value={`+${preview.trace_contribution}`} />
          <PreviewStat label="특기 일치" value={`${preview.specialty_match_count}/3`} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-bold text-[#FFF7ED]">
        <span className="font-black text-[#FFD58A]">{selectedCharacters.map((item) => item.name).join(' · ')}</span>
        <span>·</span>
        <span>{site.site_name}</span>
        <span>·</span>
        <span>주요 {ELEMENT_META[preview.major_element as ExpeditionElementCode]?.label}</span>
        <span>·</span>
        <span>보조 {ELEMENT_META[preview.minor_element as ExpeditionElementCode]?.label}</span>
      </div>
    </div>
  );
}

function RunResultCard({
  run,
  busyAction,
  onClaim,
}: {
  run: ExpeditionRunResult;
  busyAction: string | null;
  onClaim: () => void;
}) {
  const reward = run.reward;
  const siteAsset = getExpeditionSiteAsset(run.site.site_code);
  const fitAsset = getExpeditionFitGradeAsset(run.fit_grade);
  const rewardTierAsset = reward ? getExpeditionRewardTierAsset(reward.reward_tier) : null;
  const rewardChestAsset = reward?.reward_kind === 'EXPEDITION_BOX'
    ? getExpeditionRewardChestAsset(reward.reward_tier)
    : null;

  return (
    <div className="overflow-hidden rounded-card-xl border border-brand-primary/35 bg-gradient-to-br from-brand-primary/10 via-bg-card to-bg-deep shadow-card">
      <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_1fr] lg:p-5">
        <div>
          <div className="flex items-start gap-3">
            <div className="relative h-16 w-20 flex-none overflow-hidden rounded-card-md border border-white/10 bg-black/20">
              {siteAsset ? (
                <img src={siteAsset} alt="" className="h-full w-full object-cover" decoding="async" />
              ) : (
                <img src={EXPEDITION_ASSETS.common.completed} alt="" className="h-full w-full object-contain p-2" decoding="async" />
              )}
              {fitAsset && <img src={fitAsset} alt="" className="absolute bottom-1 right-1 h-6 w-6 object-contain drop-shadow" decoding="async" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[13px] font-black uppercase tracking-[0.14em] text-[#FFD58A]">
                <img src={EXPEDITION_ASSETS.common.completed} alt="" className="h-5 w-5 object-contain" decoding="async" />
                원정 결과
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-3">
                <div className="font-display text-2xl text-[#FFF7ED]">{run.site.site_name}</div>
                <div className="text-sm font-black text-[#73E6F2]">적합도 {run.fit_percent}% · {run.fit_grade_ko}</div>
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MiniStat label="내가 남긴 흔적" value={`+${run.trace_contribution}`} />
            <MiniStat label="원정 인원" value="3명" />
            <MiniStat label="탐사 기록" value={run.record?.discovery?.new_permanent_unlock ? '새 발굴!' : '확인 완료'} />
          </div>

          {run.record?.discovery?.new_permanent_unlock && (
            <div className="mt-3 flex items-center gap-2 rounded-card-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm font-black text-gold">
              <img src={EXPEDITION_ASSETS.common.discoverySuccess} alt="" className="h-7 w-7 flex-none object-contain" decoding="async" />
              <span>새 발굴 기록이 해금되었습니다 · {run.record.discovery.title}</span>
            </div>
          )}
        </div>

        <div className="rounded-card-lg border border-line bg-bg-deep/55 p-4">
          <div className="flex items-center gap-3">
            {(rewardChestAsset || rewardTierAsset) && (
              <img
                src={rewardChestAsset ?? rewardTierAsset ?? undefined}
                alt=""
                className="h-12 w-12 flex-none object-contain"
                decoding="async"
              />
            )}
            <div className="min-w-0">
              <div className="text-sm font-black uppercase tracking-[0.13em] text-[#FFD58A]">개인 보상</div>
              <div className="mt-1 text-lg font-black text-[#FFF7ED]">{reward?.reward_label ?? '보상 확인 중'}</div>
              <div className="mt-1 text-sm font-bold text-[#F6EFE7]">{reward ? `${reward.reward_tier_ko} 등급` : ''}</div>
            </div>
          </div>

          {reward?.claim_status === 'UNCLAIMED' && (
            <button
              type="button"
              onClick={onClaim}
              disabled={busyAction === `claim-${run.run_id}`}
              className="mt-3 w-full rounded-pill border border-brand-primary/45 bg-brand-primary/20 px-3 py-2.5 text-sm font-black text-white disabled:opacity-45"
            >
              {busyAction === `claim-${run.run_id}` ? '보상 처리 중...' : '보상 받기'}
            </button>
          )}

          {reward?.claim_status === 'SIMULATED' && (
            <div className="mt-3 rounded-card-md border border-warning/35 bg-warning/10 px-3 py-2 text-sm font-black text-warning">체험 운영 결과 확인 완료</div>
          )}

          {reward?.claim_status === 'GRANTED' && (
            <div className="mt-3 rounded-card-md border border-success/35 bg-success-bg px-3 py-2 text-sm font-black text-success">
              {reward.reward_kind === 'EXPEDITION_BOX' ? '원정 상자함에 추가됨' : '보상 지급 완료'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FragmentRestoreSection({
  wallet,
  loading,
  busyAction,
  onRestore,
}: {
  wallet: any;
  loading: boolean;
  busyAction: string | null;
  onRestore: (characterId: number) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'RESTORABLE' | 'OWNED' | 'EXCLUDED'>('ALL');
  const catalog = wallet?.restorable_characters ?? [];
  const ownedCount = catalog.filter((character: any) => character.is_owned).length;
  const restorableCount = catalog.filter((character: any) => !character.is_owned && character.restore_eligible).length;
  const excludedCount = catalog.filter((character: any) => !character.restore_eligible).length;
  const filtered = catalog.filter((character: any) => {
    if (filter === 'RESTORABLE') return !character.is_owned && character.restore_eligible;
    if (filter === 'OWNED') return character.is_owned;
    if (filter === 'EXCLUDED') return !character.restore_eligible;
    return true;
  });
  const visible = expanded ? filtered : filtered.slice(0, 9);

  return (
    <section className="rounded-card-xl border border-line bg-bg-card/90 p-4 shadow-card lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <img src={EXPEDITION_ASSETS.common.universalFragment} alt="" className="h-14 w-14 flex-none object-contain" loading="lazy" decoding="async" />
          <div>
            <div className="text-[13px] font-black uppercase tracking-[0.14em] text-[#FFD58A]">편린 복원</div>
            <h2 className="mt-1 font-display text-2xl text-[#FFF7ED]">범용 편린 조각</h2>
            <p className="mt-1 text-sm font-semibold text-[#F6EFE7]">전체 편린을 확인하고, 조각으로 복원 가능한 미보유 편린을 선택할 수 있습니다.</p>
          </div>
        </div>
        <div className="rounded-card-lg border border-crystal/35 bg-crystal/10 px-4 py-2.5 text-right">
          <div className="text-sm font-black text-[#FFF7ED]">보유 조각</div>
          <div className="text-xl font-black text-[#73E6F2]">{loading ? '—' : `${wallet?.balance ?? 0}개`}</div>
          {(wallet?.restore_discount_percent ?? 0) > 0 && (
            <div className="text-sm font-black text-success">복원비 {wallet.restore_discount_percent}% 할인 중</div>
          )}
        </div>
      </div>

      {!loading && (
        <>
          <div className="mt-4 flex flex-col gap-2 rounded-card-lg border border-line bg-bg-deep/55 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-black text-[#FFF7ED]">
              전체 {catalog.length}종
              <span className="ml-2 font-bold text-[#F6EFE7]">복원 가능 {restorableCount} · 보유 {ownedCount} · 복원 제외 {excludedCount}</span>
            </div>
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value as 'ALL' | 'RESTORABLE' | 'OWNED' | 'EXCLUDED');
                setExpanded(true);
              }}
              className="rounded-pill border border-line bg-bg-card px-3 py-2 text-sm font-black text-[#FFF7ED] outline-none focus:border-brand-primary/60"
            >
              <option value="ALL">전체 편린</option>
              <option value="RESTORABLE">복원 가능한 미보유 편린</option>
              <option value="OWNED">보유 중</option>
              <option value="EXCLUDED">복원 대상 아님</option>
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="mt-3 rounded-card-lg border border-line bg-bg-deep/55 p-4 text-sm font-bold text-[#FFF7ED]">조건에 맞는 편린이 없습니다.</div>
          ) : (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((character: any) => {
                  const cost = Number(character.effective_cost ?? 0);
                  const eligible = character.restore_eligible === true;
                  const enough = eligible && !character.is_owned && Number(wallet?.balance ?? 0) >= cost;
                  return (
                    <div key={character.character_id} className="rounded-card-lg border border-line bg-bg-deep/55 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate text-sm font-black text-[#FFF7ED]">{character.name}</div>
                        <div className="flex-none whitespace-nowrap text-sm font-black text-[#FFD58A]">
                          {character.is_owned
                            ? '보유 중'
                            : !eligible
                              ? '복원 제외'
                              : <>필요 {cost}개</>}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="min-w-0 text-sm font-bold text-[#F6EFE7]">
                          {eligible && character.base_cost !== character.effective_cost ? (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="whitespace-nowrap">
                                기본 <span className="line-through">{character.base_cost}개</span>
                              </span>
                              <span className="whitespace-nowrap rounded-pill border border-success/25 bg-success/10 px-2 py-0.5 text-xs font-black text-success">
                                할인 적용
                              </span>
                            </div>
                          ) : eligible ? '범용 편린 조각으로 복원' : '이 편린은 조각 복원 대상이 아닙니다.'}
                        </div>
                        <button
                          type="button"
                          disabled={!enough || busyAction === `restore-${character.character_id}`}
                          onClick={() => void onRestore(character.character_id)}
                          className="flex-none rounded-pill border border-crystal/40 bg-crystal/10 px-3 py-2 text-sm font-black text-[#73E6F2] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-[#C8C0B7] disabled:opacity-70"
                        >
                          {busyAction === `restore-${character.character_id}`
                            ? '복원 중'
                            : character.is_owned
                              ? '보유'
                              : !eligible
                                ? '대상 아님'
                                : enough
                                  ? '복원'
                                  : '조각 부족'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {filtered.length > 9 && (
                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  className="mt-3 w-full rounded-card-lg border border-line bg-bg-deep/65 px-4 py-3 text-sm font-black text-[#FFF7ED] transition hover:border-brand-primary/45"
                >
                  {expanded ? '목록 접기' : `전체 ${filtered.length}종 펼쳐보기`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function ExpeditionRewardGuideSection({
  catalog,
  loading,
}: {
  catalog: ExpeditionBoxCatalog | null;
  loading: boolean;
}) {
  return (
    <section className="rounded-card-xl border border-line bg-bg-card/90 p-4 shadow-card lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-black uppercase tracking-[0.14em] text-[#FFD58A]">원정 보상 안내</div>
          <h2 className="mt-1 font-display text-xl text-[#FFF7ED]">탐사지별 핵심 보상</h2>
          <p className="mt-1 text-sm font-semibold text-[#F6EFE7]">유적은 원정 상자, 자연은 GOLD, 성소는 범용 편린 조각을 획득합니다.</p>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-center text-xs font-black">
          <span className="rounded-pill border border-line bg-bg-deep/70 px-2.5 py-1.5 text-[#FFF7ED]">유적 · 상자</span>
          <span className="rounded-pill border border-line bg-bg-deep/70 px-2.5 py-1.5 text-[#FFD58A]">자연 · GOLD</span>
          <span className="rounded-pill border border-line bg-bg-deep/70 px-2.5 py-1.5 text-[#73E6F2]">성소 · 조각</span>
        </div>
      </div>

      <details className="group mt-4 overflow-hidden rounded-card-lg border border-gold/25 bg-gold/5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <img src={EXPEDITION_ASSETS.rewards.chestCommon} alt="" className="h-10 w-10 object-contain" loading="lazy" decoding="async" />
            <div>
              <div className="text-sm font-black text-[#FFF7ED]">원정 상자에서는 무엇이 나오나요?</div>
              <div className="mt-0.5 text-xs font-bold text-[#F6EFE7]">일반 · 중급 · 희귀 상자의 실제 보상 확률 확인</div>
            </div>
          </div>
          <span className="flex-none text-sm font-black text-[#FFD58A] group-open:hidden">펼쳐보기 ▾</span>
          <span className="hidden flex-none text-sm font-black text-[#FFD58A] group-open:inline">접기 ▴</span>
        </summary>

        <div className="border-t border-gold/20 p-3 sm:p-4">
          {loading ? (
            <div className="flex min-h-[100px] items-center justify-center"><LoadingSpinner size="sm" /></div>
          ) : !catalog || catalog.tiers.length === 0 ? (
            <div className="rounded-card-md border border-line bg-bg-deep/55 p-4 text-sm font-bold text-[#F6EFE7]">
              상자 보상 정보를 불러오지 못했습니다.
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-3">
              {catalog.tiers.map((tier) => (
                <div key={tier.tier} className="rounded-card-lg border border-line bg-bg-deep/70 p-3">
                  <div className="flex items-center gap-3 border-b border-white/10 pb-3">
                    <img
                      src={getExpeditionRewardChestAsset(tier.tier) ?? undefined}
                      alt=""
                      className="h-12 w-12 flex-none object-contain"
                      loading="lazy"
                      decoding="async"
                    />
                    <div>
                      <div className="text-base font-black text-[#FFF7ED]">{tier.tier_label} 원정 상자</div>
                      <div className="mt-0.5 text-xs font-bold text-[#F6EFE7]">상자를 열 때 아래 중 하나가 확정됩니다.</div>
                    </div>
                  </div>
                  <div className="mt-2 divide-y divide-white/[0.07]">
                    {tier.rewards.map((reward) => (
                      <div key={reward.reward_code} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0 break-keep font-bold text-[#FFF7ED]">{reward.label}</span>
                        <span className="flex-none font-black text-[#FFD58A]">{formatProbability(reward.probability_percent)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs font-bold leading-relaxed text-[#F6EFE7]">
            미보유 랜덤 폰트·배경/CG는 아직 보유하지 않은 상품에서 추첨됩니다. 해당 종류를 모두 보유한 경우에는 시스템의 대체 보상 규칙이 적용됩니다.
          </p>
        </div>
      </details>
    </section>
  );
}

function ExpeditionBoxInventorySection({
  inventory,
  loading,
  busyAction,
  results,
  onOpen,
}: {
  inventory: { boxes: Array<{ item_id: number; name: string; tier: string; available_quantity: number }> } | null;
  loading: boolean;
  busyAction: string | null;
  results: Record<number, ExpeditionBoxOpenResult>;
  onOpen: (itemId: number) => Promise<void>;
}) {
  const boxes = inventory?.boxes ?? [];
  if (loading || boxes.length === 0) return null;

  return (
    <section className="rounded-card-xl border border-gold/30 bg-gold/5 p-4 shadow-card lg:p-5">
      <div>
        <div className="text-[13px] font-black uppercase tracking-[0.14em] text-[#FFD58A]">원정 상자함</div>
        <h2 className="mt-1 font-display text-xl text-[#FFF7ED]">획득한 원정 상자</h2>
        <p className="mt-1 text-sm font-semibold text-[#F6EFE7]">상자를 열 때 최종 내용물이 한 번 확정됩니다.</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {boxes.map((box) => {
          const result = results[box.item_id] ?? null;
          const tierLabel = box.tier === 'RARE' ? '희귀' : box.tier === 'INTERMEDIATE' ? '중급' : '일반';
          return (
            <div key={box.item_id} className="rounded-card-lg border border-gold/25 bg-bg-deep/65 p-4">
              <div className="flex items-center gap-3">
                <img src={getExpeditionRewardChestAsset(box.tier) ?? undefined} alt="" className="h-14 w-14 flex-none object-contain" loading="lazy" decoding="async" />
                <div>
                  <div className="text-sm font-black text-[#FFD58A]">{tierLabel} 원정 상자</div>
                  <div className="mt-1 text-sm font-black text-[#FFF7ED]">보유 {box.available_quantity}개</div>
                </div>
              </div>
              <button
                type="button"
                disabled={busyAction === `box-item-${box.item_id}`}
                onClick={() => void onOpen(box.item_id)}
                className="mt-3 w-full rounded-pill border border-gold/40 bg-gold/10 px-3 py-2.5 text-sm font-black text-gold disabled:opacity-45"
              >
                {busyAction === `box-item-${box.item_id}` ? '상자 여는 중...' : '상자 열기'}
              </button>
              {result && (
                <div className="mt-3 rounded-card-md border border-success/30 bg-success-bg px-3 py-2">
                  <div className="text-xs font-black text-success">방금 획득</div>
                  <div className="mt-0.5 text-sm font-black text-[#FFF7ED]">{result.final_reward_label}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ChronicleSection({
  sites,
  recentRuns,
  loading,
  onStory,
  onClaim,
  busyAction,
}: {
  sites: ExpeditionChronicleSite[];
  recentRuns: ExpeditionRunResult[];
  loading: boolean;
  onStory: (siteCode: string) => Promise<void>;
  onClaim: (run: ExpeditionRunResult) => Promise<void>;
  busyAction: string | null;
}) {
  return (
    <section className="rounded-card-xl border border-line bg-bg-card/90 p-4 shadow-card lg:p-5">
      <div className="flex items-center gap-3">
        <img src={EXPEDITION_ASSETS.weeklySummary} alt="" className="h-12 w-12 flex-none object-contain" loading="lazy" decoding="async" />
        <div>
          <div className="text-[13px] font-black uppercase tracking-[0.14em] text-[#FFD58A]">원정 연대기</div>
          <h2 className="mt-1 font-display text-xl text-[#FFF7ED]">15개 탐사지 기록</h2>
          <p className="mt-1 text-sm font-semibold text-[#F6EFE7]">학급이 쌓은 누적 흔적과 내가 발견한 기록은 시즌 동안 계속 보존됩니다.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[160px] items-center justify-center"><LoadingSpinner size="sm" /></div>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <ChronicleSiteCard key={site.site_code} site={site} onStory={() => void onStory(site.site_code)} />
          ))}
        </div>
      )}

      {recentRuns.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="text-sm font-black text-[#FFF7ED]">최근 내 원정</div>
          <div className="mt-3 space-y-3">
            {recentRuns.slice(0, 4).map((run) => (
              <RunResultCard
                key={run.run_id}
                run={run}
                busyAction={busyAction}
                onClaim={() => void onClaim(run)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ChronicleSiteCard({ site, onStory }: { site: ExpeditionChronicleSite; onStory: () => void }) {
  const specialty = SPECIALTY_META[site.specialty_code];
  const siteAsset = getExpeditionSiteAsset(site.site_code);
  return (
    <button
      type="button"
      onClick={onStory}
      className="overflow-hidden rounded-card-lg border border-line bg-bg-deep/55 text-left transition hover:border-brand-primary/40"
    >
      {siteAsset && (
        <div className="relative h-20 overflow-hidden bg-black/20">
          <img src={siteAsset} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
          <img
            src={getExpeditionMasteryAsset(site.mastery_level)}
            alt=""
            className="absolute bottom-1.5 right-1.5 h-7 w-7 object-contain drop-shadow"
            loading="lazy"
            decoding="async"
          />
        </div>
      )}
      <div className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="inline-flex items-center gap-1 text-xs font-black text-[#FFD58A]"><img src={EXPEDITION_ASSETS.specialty[site.specialty_code]} alt="" className="h-3.5 w-3.5 object-contain" loading="lazy" decoding="async" />{specialty.label}</div>
          <div className="mt-1 text-sm font-black text-[#FFF7ED]">{site.site_name}</div>
        </div>
        {site.discovery_unlocked && <img src={EXPEDITION_ASSETS.common.discoverySuccess} alt="발굴 기록 발견" className="h-6 w-6 object-contain" loading="lazy" decoding="async" />}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <MiniStat label="누적 흔적" value={`${site.cumulative_trace}`} />
        <MiniStat label="탐사" value={site.story_stage_label} />
        <MiniStat label="숙련" value={site.mastery_label} />
        <MiniStat label="내 기록" value={site.discovery_unlocked ? '발굴 완료' : site.field_record_unlocked ? '현장 기록' : '미방문'} />
      </div>

      <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-bold text-[#F6EFE7]">핵심 보상</span>
          <span className="font-black text-[#FFD58A]">{site.core_reward_label}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-[#F6EFE7]">주도지역 효과</span>
          <span className="flex min-w-0 items-center justify-end gap-2">
            <img
              src={getExpeditionWorldEffectAsset(site.world_effect_code)}
              alt=""
              className="h-7 w-7 flex-none object-contain"
              loading="lazy"
              decoding="async"
            />
            <span className="break-keep text-right text-sm font-black text-[#D9C3FF]">{site.world_effect_label}</span>
          </span>
        </div>
      </div>
      </div>
    </button>
  );
}

function LuxuryShopSection({
  shop,
  loading,
  busyAction,
  onBuy,
}: {
  shop: any;
  loading: boolean;
  busyAction: string | null;
  onBuy: (item: ExpeditionLuxuryItem, pricingId: number) => Promise<void>;
}) {
  if (loading) return null;
  if (!shop?.open) {
    return (
      <section className="rounded-card-xl border border-line bg-bg-card/90 p-4 shadow-card lg:p-5">
        <div className="text-[13px] font-black uppercase tracking-[0.14em] text-[#FFD58A]">명품관</div>
        <div className="mt-1 text-lg font-black text-[#FFF7ED]">현재는 문이 닫혀 있습니다.</div>
        <p className="mt-1 text-sm font-semibold text-[#F6EFE7]">상점(명품관) 개방 월드효과가 활성화되면 기간 한정 상품을 구매할 수 있습니다.</p>
      </section>
    );
  }

  if (shop.assets_pending || (shop.items ?? []).length === 0) {
    return (
      <section className="rounded-card-xl border border-gold/30 bg-gold/5 p-4 shadow-card lg:p-5">
        <div className="text-[13px] font-black uppercase tracking-[0.14em] text-[#FFD58A]">명품관 · Lv.{shop.access_level}</div>
        <div className="mt-1 text-lg font-black text-[#FFF7ED]">명품관이 열렸습니다.</div>
        <p className="mt-1 text-sm font-semibold text-[#F6EFE7]">이번 개방에 연결된 한정 상품은 아직 준비 중입니다.</p>
      </section>
    );
  }

  return (
    <section className="rounded-card-xl border border-gold/30 bg-gold/5 p-4 shadow-card lg:p-5">
      <div className="text-[13px] font-black uppercase tracking-[0.14em] text-[#FFD58A]">명품관 · Lv.{shop.access_level}</div>
      <h2 className="mt-1 font-display text-xl text-[#FFF7ED]">기간 한정 꾸미기</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(shop.items as ExpeditionLuxuryItem[]).map((item) => (
          <div key={item.item_id} className="overflow-hidden rounded-card-lg border border-gold/25 bg-bg-deep/65">
            <div className="flex h-28 items-center justify-center bg-black/20">
              <img src={item.resource_url} alt={item.name} className="h-full w-full object-contain" />
            </div>
            <div className="p-3">
              <div className="text-xs font-black text-[#FFD58A]">GROUP {item.luxury_group}</div>
              <div className="mt-1 text-sm font-black text-[#FFF7ED]">{item.name}</div>
              {item.description && <div className="mt-1 text-sm font-semibold text-[#F6EFE7]">{item.description}</div>}
              {item.owned ? (
                <div className="mt-3 rounded-pill border border-success/35 bg-success-bg px-3 py-2 text-center text-sm font-black text-success">보유 중</div>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {item.pricing.map((pricing) => (
                    <button
                      key={pricing.pricing_id}
                      type="button"
                      disabled={busyAction === `luxury-${item.item_id}`}
                      onClick={() => void onBuy(item, pricing.pricing_id)}
                      className="w-full rounded-pill border border-gold/35 bg-gold/10 px-3 py-2 text-sm font-black text-gold disabled:opacity-45"
                    >
                      {pricing.value_token === 'CRYSTAL' ? '💎' : '🪙'} {pricing.price.toLocaleString('ko-KR')} 구매
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BoxOpeningResultModal({
  result,
  onClose,
}: {
  result: ExpeditionBoxOpenResult;
  onClose: () => void;
}) {
  const chestAsset = getExpeditionRewardChestAsset(result.box_tier);
  const tierAsset = getExpeditionRewardTierAsset(result.box_tier);
  const tierLabel = result.box_tier === 'RARE'
    ? '희귀'
    : result.box_tier === 'INTERMEDIATE'
      ? '중급'
      : '일반';

  return (
    <div
      className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-card-xl border border-gold/45 bg-[#100C18] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-white/10 bg-gradient-to-r from-gold/15 via-brand-primary/10 to-transparent px-5 py-4 text-center">
          <div className="text-[13px] font-black uppercase tracking-[0.16em] text-[#FFD58A]">
            {tierLabel} 원정 상자 개봉
          </div>
          <div className="mt-3 flex items-center justify-center gap-3">
            {chestAsset && (
              <img
                src={chestAsset}
                alt=""
                className="h-20 w-20 object-contain drop-shadow-[0_8px_24px_rgba(255,198,77,0.25)]"
                decoding="async"
              />
            )}
            {tierAsset && (
              <img
                src={tierAsset}
                alt=""
                className="h-12 w-12 object-contain"
                decoding="async"
              />
            )}
          </div>
        </div>

        <div className="px-5 py-6 text-center">
          <div className="text-sm font-black text-[#FFF7ED]">획득 보상</div>
          <div className="mt-2 break-keep font-display text-2xl font-black text-white">
            {result.final_reward_label}
          </div>
          {result.cosmetic_fallback_crystal && (
            <div className="mx-auto mt-4 max-w-sm rounded-card-md border border-crystal/30 bg-crystal/10 px-3 py-2 text-sm font-bold text-[#E8FBFF]">
              획득 가능한 꾸미기 아이템을 모두 보유해 CRYSTAL 보상으로 전환되었습니다.
            </div>
          )}
        </div>

        <div className="border-t border-white/10 bg-black/15 p-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-card-lg border border-gold/45 bg-gold/15 px-4 py-3 text-base font-black text-[#FFF7ED] transition hover:bg-gold/25"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

function SundayEventModal({
  popup,
  isClosing,
  onClose,
}: {
  popup: NonNullable<ExpeditionBoard['sunday_popup']>;
  isClosing: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[1450] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-card-xl border border-crystal/40 bg-bg-base shadow-2xl">
        <div className="border-b border-line bg-gradient-to-r from-crystal/15 to-brand-primary/10 px-5 py-4">
          <div className="text-[13px] font-black uppercase tracking-[0.15em] text-[#73E6F2]">일요일 환경 변화</div>
          <h3 className="mt-1 font-display text-2xl text-[#FFF7ED]">{popup.site_name}</h3>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex items-center justify-center">
            <img src={EXPEDITION_ASSETS.sundayEnvironmentShift} alt="" className="h-24 w-40 object-contain" decoding="async" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="토요일 원정" value={`${popup.saturday_participants}명`} />
            <MiniStat label="토요일 흔적" value={`${popup.saturday_trace}`} />
            <MiniStat label="누적 흔적" value={`${popup.cumulative_trace}`} />
          </div>
          <div className="rounded-card-lg border border-line bg-bg-card p-4">
            <div className="text-sm font-black text-[#FFD58A]">{popup.site_message_title}</div>
            <p className="mt-1 text-sm font-semibold leading-relaxed text-[#F2EADB]">{popup.site_message_text}</p>
          </div>
          <div className="rounded-card-lg border border-crystal/30 bg-crystal/10 p-4">
            <div className="text-sm font-black text-[#73E6F2]">{popup.event_title}</div>
            <p className="mt-1 text-sm font-semibold text-[#F2EADB]">{popup.event_text}</p>
            <div className="mt-3 flex items-center justify-center gap-3 text-sm font-black text-[#FFF7ED]">
              <ElementChip code={popup.old_major_element} strong />
              <span>→</span>
              <ElementChip code={popup.new_major_element} strong />
            </div>
          </div>
          <div className="text-center text-sm font-bold text-[#F6EFE7]">현재 탐사 단계 · {popup.highest_story_stage_label}</div>
        </div>
        <div className="border-t border-line bg-bg-deep/60 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isClosing}
            className="btn-primary w-full py-3 disabled:opacity-45"
          >
            {isClosing ? '확인 중...' : '확인하고 원정 준비하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StoryModal({ story, onClose }: { story: ExpeditionSiteStory; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-card-xl border border-line bg-bg-base shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-bg-base/95 px-5 py-4 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            {getExpeditionSiteAsset(story.site_code) && (
              <img src={getExpeditionSiteAsset(story.site_code) ?? undefined} alt="" className="h-14 w-16 flex-none rounded-card-md object-cover" loading="lazy" decoding="async" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-black uppercase tracking-[0.14em] text-[#FFD58A]">탐사 기록</div>
              <h3 className="mt-1 truncate font-display text-2xl text-[#FFF7ED]">{story.site_name}</h3>
              <div className="mt-1 text-sm font-bold text-[#F6EFE7]">누적 흔적 {story.cumulative_trace} · {story.highest_story_stage_label} · {story.mastery_label}</div>
            </div>
            <img src={getExpeditionMasteryAsset(story.mastery_level)} alt="" className="h-9 w-9 flex-none object-contain" loading="lazy" decoding="async" />
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-line bg-bg-deep px-3 py-2 text-sm font-black text-[#FFF7ED]">닫기</button>
        </div>
        <div className="space-y-4 p-5">
          <p className="whitespace-pre-line text-sm font-semibold leading-relaxed text-[#F2EADB]">{story.intro_text}</p>
          {story.stages.map((stage) => (
            <div key={stage.stage} className={cn('rounded-card-lg border p-4', stage.unlocked ? 'border-brand-primary/25 bg-brand-primary/5' : 'border-line bg-bg-deep/45')}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <img
                    src={getExpeditionStoryStageAsset(stage.stage)}
                    alt=""
                    className={cn('h-8 w-8 object-contain', !stage.unlocked && 'opacity-45 grayscale')}
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="text-sm font-black text-[#FFD58A]">누적 {stage.threshold} · {stage.label}</div>
                </div>
                <div className="text-sm font-black text-[#F6EFE7]">{stage.unlocked ? '해금' : '잠김'}</div>
              </div>
              {stage.unlocked && (
                <>
                  <div className="mt-2 text-sm font-black text-[#FFF7ED]">「{stage.title}」</div>
                  <p className="mt-1 whitespace-pre-line text-sm font-semibold leading-relaxed text-[#F2EADB]">{stage.text}</p>
                  {stage.short_result && <div className="mt-2 text-sm font-black text-[#73E6F2]">{stage.short_result}</div>}
                </>
              )}
            </div>
          ))}

          <div className="grid gap-3 md:grid-cols-2">
            <RecordBlock
              title="현장 기록"
              unlocked={story.field_record.unlocked}
              recordTitle={story.field_record.title}
              text={story.field_record.text}
            />
            <RecordBlock
              title="발굴 기록"
              unlocked={story.discovery_record.unlocked}
              recordTitle={story.discovery_record.title}
              text={story.discovery_record.text}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function RecordBlock({
  title,
  unlocked,
  recordTitle,
  text,
}: {
  title: string;
  unlocked: boolean;
  recordTitle: string | null;
  text: string | null;
}) {
  return (
    <div className={cn('rounded-card-lg border p-4', unlocked ? 'border-gold/30 bg-gold/5' : 'border-line bg-bg-deep/45')}>
      <div className="text-sm font-black uppercase tracking-[0.13em] text-[#FFD58A]">{title}</div>
      {unlocked ? (
        <>
          <div className="mt-2 text-sm font-black text-[#FFF7ED]">{recordTitle}</div>
          <p className="mt-1 whitespace-pre-line text-sm font-semibold leading-relaxed text-[#F2EADB]">{text}</p>
        </>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <img src={EXPEDITION_ASSETS.chronicleRecordLocked} alt="" className="h-9 w-9 flex-none object-contain opacity-70" loading="lazy" decoding="async" />
          <p className="text-sm font-semibold text-[#F6EFE7]">
            {title === '현장 기록' ? '이 지역에 직접 원정을 보내면 확인할 수 있습니다.' : '원정 중 발견하면 영구적으로 기록됩니다.'}
          </p>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-card/75 px-2.5 py-2">
      <div className="text-xs font-black text-[#FFF7ED]">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-black text-[#FFF7ED]">{value}</div>
    </div>
  );
}

function PreviewStat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs font-black uppercase tracking-[0.1em] text-[#FFF7ED]">{label}</div>
      <div className={cn('mt-1 font-black text-[#FFF7ED]', strong ? 'text-xl text-[#73E6F2]' : 'text-base')}>{value}</div>
    </div>
  );
}

function ElementChip({ code, strong = false }: { code: ExpeditionElementCode; strong?: boolean }) {
  const meta = ELEMENT_META[code];
  return (
    <span className={cn(
      'rounded-pill border border-line bg-bg-card/80 px-2 py-1 text-sm font-black text-[#FFF7ED]',
      strong && 'border-brand-primary/40 bg-brand-primary/10',
    )}>
      <img src={EXPEDITION_ASSETS.element[code]} alt="" className="mr-1 inline-block h-[18px] w-[18px] object-contain align-[-4px]" decoding="async" />
      {meta.label}{strong ? ' 주요' : ' 보조'}
    </span>
  );
}

function PanelNotice({
  tone,
  title,
  body,
  actionLabel,
  onAction,
}: {
  tone: 'neutral' | 'danger';
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={cn(
      'rounded-card-xl border p-6 text-center shadow-card',
      tone === 'danger' ? 'border-danger/40 bg-danger-bg' : 'border-line bg-bg-card/90',
    )}>
      <div className="text-3xl">{tone === 'danger' ? '⚠️' : '🧭'}</div>
      <div className="mt-3 text-base font-black text-[#FFF7ED]">{title}</div>
      <p className="mx-auto mt-2 max-w-xl text-sm font-semibold leading-relaxed text-[#F2EADB]">{body}</p>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="mt-4 rounded-pill border border-line bg-bg-deep px-4 py-2 text-sm font-black text-[#FFF7ED]">{actionLabel}</button>
      )}
    </div>
  );
}

function phaseLabel(phase: string) {
  if (phase === 'FRI') return '금요일 · 탐사지 공개';
  if (phase === 'SAT') return '토요일 원정';
  if (phase === 'SUN') return '일요일 원정';
  return '원정 종료';
}

function phaseMessage(phase: string) {
  if (phase === 'FRI') return '세 탐사지의 환경을 먼저 살펴보세요. 원정은 토요일부터 시작됩니다.';
  if (phase === 'SAT') return '오늘 한 번, 원하는 탐사지에 편린 3명을 보낼 수 있습니다.';
  if (phase === 'SUN') return '오늘도 한 번 원정할 수 있습니다. 토요일에 보낸 편린 3명은 회복이 필요합니다.';
  return '이번 주 원정 결과를 확인하고 다음 원정을 준비하세요.';
}

function formatProbability(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function toStudentError(message: string) {
  if (message.includes('EXPEDITION_SATURDAY_MEMBER_REUSE_ON_SUNDAY')) return '토요일 원정에 보낸 편린은 일요일에 다시 보낼 수 없습니다. 회복이 필요합니다.';
  if (message.includes('EXPEDITION_SUBMISSION_WINDOW_CLOSED')) return '지금은 원정을 보낼 수 있는 시간이 아닙니다.';
  if (message.includes('EXPEDITION_FEATURE_DISABLED')) return '편린 원정은 현재 준비 중입니다.';
  if (message.includes('EXPEDITION_INSUFFICIENT_FRAGMENTS')) return '편린 조각이 부족합니다.';
  if (message.includes('EXPEDITION_CHARACTER_ALREADY_OWNED')) return '이미 보유한 편린입니다.';
  if (message.includes('EXPEDITION_LIVE_REWARD_GRANT_DISABLED')) return '현재 보상 지급이 잠겨 있습니다. 운영국에 알려주세요.';
  if (message.includes('Seasonal item not currently available') || message.includes('명품관 판매 기간')) return '현재 구매할 수 있는 기간이 아닙니다.';
  return message || '처리 중 문제가 발생했습니다. 잠시 뒤 다시 시도해주세요.';
}
