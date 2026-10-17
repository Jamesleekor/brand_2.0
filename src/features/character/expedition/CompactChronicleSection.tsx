import { useState } from 'react';

import { LoadingSpinner } from '@/components/shared/components';
import type { ExpeditionChronicleSite, ExpeditionRunResult } from '@/lib/rpc/expedition_rpc';
import {
  EXPEDITION_ASSETS,
  getExpeditionFitGradeAsset,
  getExpeditionRewardChestAsset,
  getExpeditionRewardTierAsset,
  getExpeditionSiteAsset,
} from './expeditionAssets';

type Props = {
  sites: ExpeditionChronicleSite[];
  recentRuns: ExpeditionRunResult[];
  loading: boolean;
  onStory: (siteCode: string) => Promise<void>;
  onClaim: (run: ExpeditionRunResult) => Promise<void>;
  busyAction: string | null;
};

export function CompactChronicleSection({
  sites,
  recentRuns,
  loading,
  onStory,
  onClaim,
  busyAction,
}: Props) {
  const [recordsExpanded, setRecordsExpanded] = useState(false);
  const discoveredCount = sites.filter((site) => site.discovery_unlocked).length;
  const visitedCount = sites.filter((site) => site.field_record_unlocked || site.discovery_unlocked).length;

  return (
    <section className="overflow-hidden rounded-card-xl border border-line bg-bg-card/90 shadow-card">
      <button
        type="button"
        onClick={() => setRecordsExpanded((value) => !value)}
        aria-expanded={recordsExpanded}
        className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-white/[0.03] lg:px-5"
      >
        <img src={EXPEDITION_ASSETS.weeklySummary} alt="" className="h-10 w-10 flex-none object-contain" loading="lazy" decoding="async" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-[#FFD58A]">원정 연대기</div>
          <h2 className="mt-0.5 font-display text-lg text-[#FFF7ED]">15개 탐사지 기록</h2>
          <p className="mt-0.5 text-[12px] font-semibold text-[#DCCFBE]">
            방문 {visitedCount}/{sites.length || 15} · 발굴 {discoveredCount}곳
          </p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[12px] font-black text-[#F6EFE7]">
          {recordsExpanded ? '접기 ▲' : '기록 펼치기 ▼'}
        </span>
      </button>

      {recordsExpanded && (
        <div className="border-t border-line px-4 pb-4 pt-3 lg:px-5">
          {loading ? (
            <div className="flex min-h-[120px] items-center justify-center"><LoadingSpinner size="sm" /></div>
          ) : sites.length === 0 ? (
            <p className="rounded-card-md border border-white/10 bg-white/[0.03] p-4 text-sm font-semibold text-[#DCCFBE]">아직 누적된 탐사지 기록이 없습니다.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sites.map((site) => (
                <CompactSiteRecord key={site.site_code} site={site} onStory={() => void onStory(site.site_code)} />
              ))}
            </div>
          )}
        </div>
      )}

      {recentRuns.length > 0 && (
        <div className="border-t border-line px-4 pb-4 pt-3 lg:px-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-[#FFF7ED]">최근 내 원정</div>
              <div className="mt-0.5 text-[11px] font-semibold text-[#DCCFBE]">최근 3건을 간단히 표시합니다.</div>
            </div>
            <span className="text-[11px] font-black text-[#FFD58A]">최신순</span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {recentRuns.slice(0, 3).map((run) => (
              <CompactRunCard
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

function CompactSiteRecord({ site, onStory }: { site: ExpeditionChronicleSite; onStory: () => void }) {
  const siteAsset = getExpeditionSiteAsset(site.site_code);
  return (
    <button
      type="button"
      onClick={onStory}
      className="flex min-w-0 items-center gap-3 rounded-card-md border border-line bg-bg-deep/55 p-2.5 text-left transition hover:border-brand-primary/45 hover:bg-white/[0.04]"
    >
      <div className="h-12 w-14 flex-none overflow-hidden rounded-md border border-white/10 bg-black/20">
        {siteAsset ? <img src={siteAsset} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-black text-[#FFF7ED]">{site.site_name}</div>
        <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] font-bold text-[#DCCFBE]">
          <span>흔적 {site.cumulative_trace}</span>
          <span>{site.mastery_label}</span>
        </div>
      </div>
      <span className={`h-2.5 w-2.5 flex-none rounded-full ${site.discovery_unlocked ? 'bg-[#FFD58A] shadow-[0_0_8px_rgba(255,213,138,.8)]' : site.field_record_unlocked ? 'bg-[#73E6F2]' : 'bg-white/20'}`} />
    </button>
  );
}

function CompactRunCard({
  run,
  busyAction,
  onClaim,
}: {
  run: ExpeditionRunResult;
  busyAction: string | null;
  onClaim: () => void;
}) {
  const reward = run.reward;
  const waitingForReward = reward?.can_claim_now === false &&
    (!reward.claim_available_at || Date.now() < Date.parse(reward.claim_available_at));
  const rewardAvailableLabel = reward?.claim_available_at
    ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(new Date(reward.claim_available_at))
    : '다음 날';

  const siteAsset = getExpeditionSiteAsset(run.site.site_code);
  const fitAsset = getExpeditionFitGradeAsset(run.fit_grade);
  const rewardAsset = reward?.reward_kind === 'EXPEDITION_BOX'
    ? getExpeditionRewardChestAsset(reward.reward_tier)
    : reward ? getExpeditionRewardTierAsset(reward.reward_tier) : null;

  return (
    <article className="min-w-0 rounded-card-lg border border-brand-primary/25 bg-gradient-to-br from-brand-primary/[0.08] via-bg-card to-bg-deep p-3">
      <div className="flex items-center gap-2.5">
        <div className="relative h-12 w-14 flex-none overflow-hidden rounded-md border border-white/10 bg-black/20">
          {siteAsset && <img src={siteAsset} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />}
          {fitAsset && <img src={fitAsset} alt="" className="absolute bottom-0.5 right-0.5 h-5 w-5 object-contain drop-shadow" loading="lazy" decoding="async" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-[#FFF7ED]">{run.site.site_name}</div>
          <div className="mt-0.5 text-[11px] font-bold text-[#73E6F2]">적합도 {run.fit_percent}% · 흔적 +{run.trace_contribution}</div>
        </div>
      </div>

      <div className="mt-2 flex min-h-9 items-center gap-2 rounded-md border border-white/10 bg-black/15 px-2.5 py-2">
        {rewardAsset && <img src={rewardAsset} alt="" className="h-7 w-7 flex-none object-contain" loading="lazy" decoding="async" />}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#FFD58A]">개인 보상</div>
          <div className="truncate text-[12px] font-black text-[#FFF7ED]">{reward?.reward_label ?? '보상 확인 중'}</div>
        </div>
      </div>

      {reward?.claim_status === 'UNCLAIMED' ? (
        <button
          type="button"
          onClick={onClaim}
          disabled={waitingForReward || busyAction === `claim-${run.run_id}`}
          className="mt-2 w-full rounded-full border border-brand-primary/45 bg-brand-primary/20 px-3 py-2 text-[12px] font-black text-white disabled:opacity-45"
        >
          {waitingForReward ? `${rewardAvailableLabel}부터 수령 가능` : busyAction === `claim-${run.run_id}` ? '처리 중…' : '보상 받기'}
        </button>
      ) : (
        <div className="mt-2 text-center text-[11px] font-black text-[#9DDDBD]">
          {reward?.claim_status === 'GRANTED' ? '지급 완료' : '확인 완료'}
        </div>
      )}
    </article>
  );
}
