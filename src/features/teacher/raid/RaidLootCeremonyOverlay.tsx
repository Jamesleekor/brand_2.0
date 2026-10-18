// RAID_LOOT_V1_2_CEREMONY_OVERLAY_20261018
// 레이드 전리품 획득식 — 16:9 중계 연출 (실제 진행 / 리허설 공용)
//
// 중요한 원칙
// - 추첨·지급은 서버에서만 일어납니다. 이 화면은 서버가 정한 결과를 "보여주기"만 합니다.
// - 이름 셔플은 연출입니다. '당첨자 확정'을 누르면 서버 응답이 올 때까지 계속 돌다가
//   서버가 알려준 당첨자 이름에 천천히 멈춥니다.
// - 리허설은 teacher_rehearse_raid_loot(읽기 전용) 대본만 재생하며 실제 진행 RPC를 호출하지 않습니다.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { EXPEDITION_ASSETS } from '@/features/character/expedition/expeditionAssets';
import {
  raidLootRpc,
  newRaidLootRequestId,
  raidLootKindText,
  raidLootCurrencyImage,
  RAID_LOOT_NEXT_LABEL,
  RAID_LOOT_REASON_TEXT,
  RAID_LOOT_STAGE_ORDER,
  type RaidLootAdminReward,
  type RaidLootAdminState,
  type RaidLootRehearsalScript,
  type RaidLootShuffleCandidate,
  type RaidLootStage,
} from '@/lib/rpc/raid_loot_rpc';
import type { RaidStatus } from '@/lib/rpc/raid_admin_rpc';
import './raidLootCeremony.css';

export type RaidLootCue = 'chest' | 'reveal' | 'tick' | 'winner';
type OverlayMode = 'LIVE' | 'REHEARSAL';

// ---------------------------------------------------------------------------
// 공용 도우미
// ---------------------------------------------------------------------------

function stageIndex(stage: RaidLootStage | null | undefined) {
  return stage ? RAID_LOOT_STAGE_ORDER.indexOf(stage) : -1;
}

function slotOfStage(stage: RaidLootStage | null | undefined): 1 | 2 | null {
  if (!stage) return null;
  if (stage.startsWith('SLOT1')) return 1;
  if (stage.startsWith('SLOT2')) return 2;
  return null;
}

function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('ko-KR');
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/** 리허설 대본에서 현재 단계까지 "공개된" 내용만 남깁니다. */
function maskRehearsalRewards(rewards: RaidLootAdminReward[], stage: RaidLootStage): RaidLootAdminReward[] {
  const idx = stageIndex(stage);
  return rewards
    .filter((reward) => (reward.slot_no === 1 ? idx >= 1 : idx >= 4))
    .map((reward) => {
      const winnerIdx = reward.slot_no === 1 ? 3 : 6;
      if (idx >= winnerIdx) return reward;
      return {
        ...reward,
        winner: null,
        delivered_kind: null,
        delivered_amount: null,
        duplicate_character_converted: false,
        settlement_status: 'UNSETTLED' as const,
        void: false,
      };
    });
}

/**
 * '당첨자 확정' 이후 셔플 감속 연출을 관리합니다.
 * - beginConfirm(slot): 버튼을 누른 순간 호출 → 서버 응답 전까지 셔플 계속
 * - 서버(또는 대본)가 WINNER 단계가 되면 당첨자 이름에 멈출 때까지 셔플 화면 유지
 * - 새로고침/다른 화면에서 이미 WINNER라면 감속 없이 바로 발표 화면
 */
function useDrawAnimation(stage: RaidLootStage | null) {
  const [animatingSlot, setAnimatingSlot] = useState<1 | 2 | null>(null);
  const [landedSlots, setLandedSlots] = useState<number[]>([]);

  const beginConfirm = useCallback((slot: 1 | 2) => {
    setAnimatingSlot(slot);
    setLandedSlots((prev) => prev.filter((value) => value !== slot));
  }, []);

  const markLanded = useCallback((slot: 1 | 2) => {
    setLandedSlots((prev) => (prev.includes(slot) ? prev : [...prev, slot]));
    setAnimatingSlot((current) => (current === slot ? null : current));
  }, []);

  const slot = slotOfStage(stage);
  const isWinnerStage = stage === 'SLOT1_WINNER' || stage === 'SLOT2_WINNER';
  const decelerating = Boolean(isWinnerStage && slot && animatingSlot === slot && !landedSlots.includes(slot));
  const waitingServer = Boolean(stage && stage.endsWith('DRAWING') && slot && animatingSlot === slot);

  const reset = useCallback(() => { setAnimatingSlot(null); setLandedSlots([]); }, []);

  return { beginConfirm, markLanded, decelerating, waitingServer, animatingSlot, reset };
}

// ---------------------------------------------------------------------------
// 이름 슬롯 (세로 릴)
// - 서버 응답 전: 일정한 빠른 속도로 이름이 위에서 아래로 계속 흘러내림
// - 당첨자 도착: 지금 속도에서 이어서 점점 느려지다가(감속) 당첨자 이름이 가운데 칸에 정확히 멈춤
// ---------------------------------------------------------------------------

// 이름 한 칸 높이: 화면 높이에 맞춰 64~112px 사이로 자동 조절 (작은 프로젝터 화면에서도 넘치지 않게)
function useReelRowPx() {
  const read = () => (typeof window === 'undefined' ? 112 : Math.max(64, Math.min(112, Math.round(window.innerHeight * 0.095))));
  const [rowPx, setRowPx] = useState(read);
  useEffect(() => {
    const onResize = () => setRowPx(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return rowPx;
}

const REEL_VISIBLE_ROWS = 5;    // 보이는 칸 수 (가운데가 당첨 칸)
const REEL_SPIN_SPEED = 16;     // 초당 지나가는 칸 수
const REEL_STOP_MIN_MS = 1800;  // 감속 최소 시간
const REEL_STOP_MAX_MS = 4200;  // 감속 최대 시간 (후보가 많아도 너무 오래 돌지 않게)

function LootNameShuffle({
  candidates,
  targetId,
  reduced,
  onLanded,
  onTick,
}: {
  candidates: RaidLootShuffleCandidate[];
  targetId: number | null;
  reduced: boolean;
  onLanded: () => void;
  onTick?: () => void;
}) {
  const count = Math.max(1, candidates.length);
  const REEL_ROW_PX = useReelRowPx();
  // 실제 진행 중에는 상태 조회가 반복되면서 후보 배열이 새로 만들어질 수 있어,
  // 감속 연출이 처음부터 다시 시작되지 않도록 최신 후보는 ref로만 읽습니다.
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;
  // 시작 위치를 무작위로 두어 매번 다른 이름부터 흘러가게 합니다.
  const [position, setPosition] = useState(() => Math.floor(Math.random() * count));
  const positionRef = useRef(position);
  const [landed, setLanded] = useState(false);
  const onLandedRef = useRef(onLanded);
  const onTickRef = useRef(onTick);
  onLandedRef.current = onLanded;
  onTickRef.current = onTick;

  // 매 프레임 위치 갱신 + 칸이 바뀔 때마다 '틱' 소리
  const setPos = useCallback((value: number) => {
    if (Math.floor(value) !== Math.floor(positionRef.current)) onTickRef.current?.();
    positionRef.current = value;
    setPosition(value);
  }, []);

  // 1) 서버 응답 전: 등속 회전
  useEffect(() => {
    if (targetId !== null) return;
    setLanded(false);
    if (reduced) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setPos(positionRef.current + REEL_SPIN_SPEED * dt);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [reduced, setPos, targetId]);

  // 2) 당첨자 도착: 현재 속도에서 자연스럽게 감속 → 당첨자 칸에 정지
  useEffect(() => {
    if (targetId === null) return;
    const targetIndex = Math.max(0, candidatesRef.current.findIndex((candidate) => candidate.student_id === targetId));
    let doneTimer = 0;
    const finish = (finalPos: number) => {
      setPos(finalPos);
      setLanded(true);
      doneTimer = window.setTimeout(() => onLandedRef.current(), reduced ? 200 : 650);
    };

    const start = positionRef.current;
    if (reduced) {
      finish(Math.ceil(start / count) * count + targetIndex);
      return () => window.clearTimeout(doneTimer);
    }

    // 감속 곡선: easeOutCubic. 시작 속도 = 3 × 거리 ÷ 시간 이므로
    // 지금 회전 속도와 이어지도록 거리를 먼저 정하고, 당첨자 칸에 맞춰 거리를 반올림한 뒤 시간을 다시 계산합니다.
    const minDistance = (REEL_SPIN_SPEED * (REEL_STOP_MIN_MS / 1000)) / 3;
    let finalPos = Math.ceil(start + minDistance);
    while (((finalPos % count) + count) % count !== targetIndex) finalPos += 1;
    const distance = finalPos - start;
    const durationMs = Math.min(REEL_STOP_MAX_MS, Math.max(REEL_STOP_MIN_MS, ((3 * distance) / REEL_SPIN_SPEED) * 1000));

    let frame = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t >= 1) {
        finish(finalPos);
        return;
      }
      setPos(start + distance * eased);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(doneTimer);
    };
    // 당첨자가 정해진 순간 한 번만 실행합니다.
  }, [count, reduced, setPos, targetId]);

  // 화면에 그릴 칸: 가운데(position) 기준 위아래로 몇 칸씩
  const half = Math.floor(REEL_VISIBLE_ROWS / 2);
  const base = Math.floor(position);
  const frac = position - base;
  const rows: Array<{ key: number; candidate: RaidLootShuffleCandidate | undefined; offset: number }> = [];
  for (let k = -half - 1; k <= half + 1; k += 1) {
    const absolute = base + k;
    const index = ((absolute % count) + count) % count;
    rows.push({ key: absolute, candidate: candidates[index], offset: k - frac });
  }

  const height = REEL_ROW_PX * REEL_VISIBLE_ROWS;
  const avatarPx = Math.round(REEL_ROW_PX * 0.72);
  const namePx = Math.round(REEL_ROW_PX * 0.52);
  return (
    <div className="relative mx-auto w-[46%] min-w-[460px]" style={{ height }}>
      {/* 릴 몸체 */}
      <div className="raid-loot-reel absolute inset-0 overflow-hidden rounded-[28px] border border-cyan-300/40 bg-black/70">
        {rows.map((row) => {
          const distanceFromCenter = Math.abs(row.offset);
          const isCenter = distanceFromCenter < 0.5;
          return (
            <div
              key={row.key}
              className="absolute left-0 right-0 flex items-center justify-center gap-5 px-8"
              style={{
                height: REEL_ROW_PX,
                top: (half - row.offset) * REEL_ROW_PX,
                opacity: Math.max(0.25, 1 - distanceFromCenter * 0.32),
                transform: `scale(${Math.max(0.78, 1 - distanceFromCenter * 0.09)})`,
              }}
            >
              {row.candidate?.avatar_url ? (
                <img src={row.candidate.avatar_url} alt="" className="flex-none rounded-full border-2 border-cyan-200/60 object-cover" style={{ width: avatarPx, height: avatarPx }} />
              ) : (
                <div className="flex flex-none items-center justify-center rounded-full border-2 border-cyan-200/60 bg-cyan-900/50 font-black text-white" style={{ width: avatarPx, height: avatarPx, fontSize: avatarPx * 0.42 }}>
                  {row.candidate?.name?.slice(0, 1) ?? '?'}
                </div>
              )}
              <div className={cn('truncate font-black leading-none', isCenter && landed ? 'text-yellow-100' : 'text-white')} style={{ fontSize: namePx }}>
                {row.candidate?.name ?? '…'}
              </div>
            </div>
          );
        })}
        {/* 위아래 흐림 */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[34%] bg-gradient-to-b from-black via-black/70 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[34%] bg-gradient-to-t from-black via-black/70 to-transparent" />
      </div>
      {/* 가운데 당첨 칸 테두리 */}
      <div
        className={cn('raid-loot-reel-window pointer-events-none absolute inset-x-[-14px] rounded-[22px] border-4', landed ? 'border-yellow-300 raid-loot-reel-window--landed' : 'border-amber-200/80')}
        style={{ top: half * REEL_ROW_PX - 6, height: REEL_ROW_PX + 12 }}
      />
      <div className="pointer-events-none absolute -left-12 text-5xl text-amber-200" style={{ top: half * REEL_ROW_PX + REEL_ROW_PX / 2 - 30 }}>▶</div>
      <div className="pointer-events-none absolute -right-12 text-5xl text-amber-200" style={{ top: half * REEL_ROW_PX + REEL_ROW_PX / 2 - 30 }}>◀</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 화면 조각
// ---------------------------------------------------------------------------

type RewardVisualSize = 'lg' | 'md' | 'sm';

function RewardVisual({ reward, size = 'lg', amount }: { reward: RaidLootAdminReward; size?: RewardVisualSize; amount?: number | null }) {
  const [imageFailed, setImageFailed] = useState(false);
  const box = size === 'lg' ? 'h-56 w-56' : size === 'md' ? 'h-32 w-32' : 'h-20 w-20';
  const emojiSize = size === 'lg' ? 'text-[9rem]' : size === 'md' ? 'text-7xl' : 'text-5xl';
  if (reward.kind === 'CHARACTER') {
    if (reward.character_image_url && !imageFailed) {
      return (
        <img
          src={reward.character_image_url}
          alt={reward.character_name ?? ''}
          onError={() => setImageFailed(true)}
          className={cn(box, 'flex-none rounded-[24px] border-2 border-amber-200/60 object-cover shadow-[0_0_60px_rgba(255,200,87,0.45)]')}
        />
      );
    }
    return <div className={cn(box, emojiSize, 'flex flex-none items-center justify-center rounded-[24px] border-2 border-amber-200/60 bg-amber-900/30')}>{reward.character_emoji || '✨'}</div>;
  }
  if (reward.kind === 'FRAGMENTS' && !imageFailed) {
    return <img src={EXPEDITION_ASSETS.common.universalFragment} alt="" onError={() => setImageFailed(true)} className={cn(box, 'flex-none object-contain drop-shadow-[0_0_40px_rgba(103,232,249,0.6)]')} />;
  }
  const currencyImage = raidLootCurrencyImage(reward.kind, amount ?? reward.amount);
  if (currencyImage && !imageFailed) {
    return (
      <img
        src={currencyImage}
        alt=""
        onError={() => setImageFailed(true)}
        className={cn(box, 'flex-none object-contain', reward.kind === 'GOLD' ? 'drop-shadow-[0_0_40px_rgba(255,200,87,0.55)]' : 'drop-shadow-[0_0_40px_rgba(103,232,249,0.55)]')}
      />
    );
  }
  const icon = reward.kind === 'GOLD' ? '🪙' : reward.kind === 'CRYSTAL' ? '💎' : '🔹';
  return <div className={cn(box, emojiSize, 'flex flex-none items-center justify-center')}>{icon}</div>;
}

function rewardHeadline(reward: RaidLootAdminReward) {
  if (reward.kind === 'CHARACTER') return reward.character_name ?? reward.label;
  if (reward.kind === 'FRAGMENTS') return `편린 조각 ${formatNumber(reward.amount)}개`;
  return `${formatNumber(reward.amount)} ${reward.kind}`;
}

function deliveredLine(reward: RaidLootAdminReward, mode: OverlayMode) {
  if (reward.void) return '추첨할 수 있는 모험가가 없어 이 전리품은 지급되지 않았습니다.';
  const suffix = mode === 'REHEARSAL' ? '지급 예정(리허설)' : '지급 완료';
  if (reward.duplicate_character_converted) {
    return `이미 보유 중 → 기준가 ${formatNumber(reward.original_base_price_crystal)}C의 90% · 💎 ${formatNumber(reward.delivered_amount)} CRYSTAL ${suffix}`;
  }
  if (reward.kind === 'CHARACTER') return `완성 편린 「${reward.character_name ?? ''}」 ${suffix}`;
  return `${rewardHeadline(reward)} ${suffix}`;
}

function WinnerBadge({ reward, compact = false }: { reward: RaidLootAdminReward; compact?: boolean }) {
  const winner = reward.winner;
  if (!winner) return null;
  const size = compact ? 'h-12 w-12 text-xl' : 'h-36 w-36 text-6xl';
  return (
    <div className={cn('flex items-center', compact ? 'gap-3' : 'flex-col gap-4')}>
      {winner.avatar_url ? (
        <img src={winner.avatar_url} alt="" className={cn(size, 'rounded-full border-4 border-amber-200 object-cover shadow-[0_0_50px_rgba(255,200,87,0.6)]')} />
      ) : (
        <div className={cn(size, 'flex items-center justify-center rounded-full border-4 border-amber-200 bg-amber-900/60 font-black text-white')}>{winner.display_name.slice(0, 1)}</div>
      )}
      <div className={compact ? 'min-w-0' : 'text-center'}>
        <div className={cn('font-black text-white', compact ? 'truncate text-xl' : 'text-7xl')}>{winner.display_name}</div>
        {winner.brand_name && !compact ? <div className="mt-2 text-2xl font-black text-amber-100">{winner.brand_name}</div> : null}
      </div>
    </div>
  );
}

function Confetti({ seed }: { seed: string }) {
  const pieces = useMemo(() => {
    const colors = ['#FFD93D', '#FFC857', '#67E8F9', '#F0ABFC', '#86EFAC', '#FFFFFF'];
    return Array.from({ length: 48 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.9,
      duration: 2.6 + Math.random() * 1.6,
      color: colors[i % colors.length],
      rotate: Math.random() * 180,
    }));
  }, [seed]); // seed가 바뀔 때마다 새로 뿌립니다.
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((piece, i) => (
        <span
          key={`${seed}-${i}`}
          className="raid-loot-confetti"
          style={{
            left: `${piece.left}%`,
            background: piece.color,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            transform: `rotate(${piece.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

function SlotKicker({ slot, children }: { slot: 1 | 2; children: ReactNode }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-black tracking-[0.35em] text-amber-200">{slot === 1 ? 'FIRST LOOT' : 'SECOND LOOT'}</div>
      <div className="mt-2 text-4xl font-black text-white">{children}</div>
    </div>
  );
}

// 최종 결과 카드용: 기여도·확률 숫자 표기
function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return Number(value).toFixed(digits).replace(/\.0+$/, '');
}

function winnerDrawProbabilityText(reward: RaidLootAdminReward) {
  const raw = reward.winner_snapshot?.draw_probability;
  const probability = raw === null || raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(probability)) return null;
  const percent = probability * 100;
  // 10% 이상은 정수(예: 17%), 10% 미만은 소수 첫째 자리(예: 4.2%)
  return percent >= 10 ? `${Math.round(percent)}` : formatPercent(percent, 1);
}

function CompleteRewardCard({ slot, reward, mode }: { slot: 1 | 2; reward: RaidLootAdminReward; mode: OverlayMode }) {
  const winner = reward.winner;
  const contribution = formatPercent(winner?.contribution_percent);
  const probability = winnerDrawProbabilityText(reward);
  return (
    <div className="raid-loot-complete-card flex flex-col gap-6 rounded-[32px] border border-amber-200/30 bg-black/60 px-9 py-8">
      {/* 위: 전리품 이미지 + 전리품 정보 */}
      <div className="flex items-center gap-6">
        <div className="raid-loot-complete-visual flex-none">
          <RewardVisual reward={reward} size="md" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="raid-loot-complete-kicker text-2xl font-black text-amber-200">제{slot}전리품 · {raidLootKindText(reward.kind)}</div>
          <div className="raid-loot-complete-headline mt-1 truncate text-5xl font-black text-white">{rewardHeadline(reward)}</div>
          <div className="raid-loot-complete-delivered mt-3 text-xl font-black text-cyan-100">{deliveredLine(reward, mode)}</div>
        </div>
      </div>

      {/* 아래: 획득자 + 기여도 순위 + 당첨 확률 */}
      <div className="border-t border-amber-200/25 pt-6">
        {winner ? (
          <div>
            <div className="flex items-center gap-6">
              {winner.avatar_url ? (
                <img src={winner.avatar_url} alt="" className="raid-loot-complete-avatar h-32 w-32 flex-none rounded-full border-4 border-amber-200 object-cover shadow-[0_0_40px_rgba(255,200,87,0.55)]" />
              ) : (
                <div className="raid-loot-complete-avatar flex h-32 w-32 flex-none items-center justify-center rounded-full border-4 border-amber-200 bg-amber-900/60 text-6xl font-black text-white shadow-[0_0_40px_rgba(255,200,87,0.55)]">
                  {winner.display_name.slice(0, 1)}
                </div>
              )}
              <div className="raid-loot-complete-name min-w-0 truncate text-7xl font-black text-white">{winner.display_name}</div>
            </div>
            <div className="raid-loot-complete-info mt-5 space-y-2 text-3xl font-black text-white">
              <div>
                기여도 순위 :{' '}
                <span className="text-yellow-200">
                  {winner.final_rank ? `${winner.final_rank}위` : '-'}
                  {contribution !== null ? ` (${contribution}%)` : ''}
                </span>
              </div>
              {probability !== null ? (
                <div>
                  순위에 따른 당첨 확률 : <span className="text-yellow-200">{probability}%</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="text-3xl font-black text-amber-100">지급 대상 없음</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 단계별 화면
// ---------------------------------------------------------------------------

function StageView({
  mode,
  stage,
  bossName,
  eligibleCount,
  rewards,
  shuffle,
  decelerating,
  waitingLong,
  reduced,
  onLanded,
  onCue,
}: {
  mode: OverlayMode;
  stage: RaidLootStage;
  bossName: string;
  eligibleCount: number;
  rewards: RaidLootAdminReward[];
  shuffle: { slot1: RaidLootShuffleCandidate[]; slot2: RaidLootShuffleCandidate[] };
  decelerating: boolean;
  waitingLong: boolean;
  reduced: boolean;
  onLanded: (slot: 1 | 2) => void;
  onCue?: (cue: RaidLootCue) => void;
}) {
  const slot = slotOfStage(stage);
  const reward = slot ? rewards.find((item) => item.slot_no === slot) ?? null : null;
  const slot1 = rewards.find((item) => item.slot_no === 1) ?? null;

  if (stage === 'READY') {
    return (
      <div className="raid-loot-fade-in flex h-full flex-col items-center justify-center gap-10">
        <div className="text-center">
          <div className="text-2xl font-black tracking-[0.4em] text-amber-200">BOSS DEFEATED</div>
          <div className="mt-3 text-6xl font-black text-white">보스가 전리품 2개를 남겼다!</div>
          <div className="mt-3 text-2xl font-black text-cyan-100">{bossName}</div>
        </div>
        <div className="flex items-end justify-center gap-24">
          {[1, 2].map((n) => (
            <div key={n} className="flex flex-col items-center gap-4">
              <img
                src={EXPEDITION_ASSETS.rewardChest.RARE}
                alt=""
                className={cn('raid-loot-chest h-52 w-52 object-contain', n === 2 && 'raid-loot-chest--late')}
              />
              <div className="text-center">
                <div className="text-3xl font-black text-amber-100">제{n}전리품</div>
                <div className="mt-1 text-xl font-black text-white">{n === 1 ? '골드 또는 크리스탈' : '편린 조각 또는 완성 편린'}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-full border border-cyan-300/40 bg-black/50 px-8 py-3 text-2xl font-black text-cyan-100">
          추첨 대상 {eligibleCount}명 · 이번 레이드 전체 피해량의 1% 이상 기여한 모험가
        </div>
        {eligibleCount === 1 ? (
          <div className="text-2xl font-black text-yellow-100">단 한 명의 추첨 대상! 두 전리품 모두 그 모험가에게 돌아갑니다.</div>
        ) : null}
      </div>
    );
  }

  if (stage === 'COMPLETE') {
    const same = rewards.length === 2 && rewards[0].winner && rewards[1].winner
      && rewards[0].winner.student_id === rewards[1].winner.student_id;
    return (
      <div className="raid-loot-fade-in raid-loot-complete flex h-full flex-col items-center justify-center gap-10">
        <div className="text-center">
          <div className="text-2xl font-black tracking-[0.4em] text-amber-200">LOOT CEREMONY COMPLETE</div>
          <div className="raid-loot-complete-title mt-3 text-6xl font-black text-white">전리품 획득식 완료</div>
        </div>
        {same ? (
          <div className="raid-loot-glow rounded-full border border-amber-200/60 bg-amber-500/15 px-10 py-3 text-3xl font-black text-yellow-100">
            👑 {rewards[0].winner?.display_name} — 두 전리품 독식!
          </div>
        ) : null}
        <div className="grid w-[86%] grid-cols-2 gap-8">
          {[1, 2].map((n) => {
            const item = rewards.find((r) => r.slot_no === n);
            if (!item) return null;
            return <CompleteRewardCard key={n} slot={n as 1 | 2} reward={item} mode={mode} />;
          })}
        </div>
      </div>
    );
  }

  if (!slot || !reward) {
    return <div className="flex h-full items-center justify-center text-3xl font-black text-cyan-100">전리품 정보를 불러오는 중…</div>;
  }

  const priorWinner = slot === 2 && slot1?.winner ? (
    <div className="absolute left-8 top-24 flex items-center gap-3 rounded-full border border-amber-200/30 bg-black/60 px-5 py-2 text-xl font-black text-amber-100">
      제1전리품 ▸ <span className="text-white">{slot1.winner.display_name}</span>
    </div>
  ) : null;

  if (stage.endsWith('ITEM')) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-8">
        {priorWinner}
        <SlotKicker slot={slot}>제{slot}전리품 공개!</SlotKicker>
        <div key={`item-${slot}`} className="raid-loot-card-in raid-loot-glow flex flex-col items-center gap-6 rounded-[36px] border border-amber-200/50 bg-black/60 px-16 py-10">
          <RewardVisual reward={reward} />
          <div className="text-center">
            <div className="text-2xl font-black text-amber-200">{raidLootKindText(reward.kind)}</div>
            <div className="mt-1 text-7xl font-black text-white">{rewardHeadline(reward)}</div>
            {reward.kind === 'CHARACTER' && reward.original_base_price_crystal ? (
              <div className="mt-3 text-2xl font-black text-cyan-100">기준가 {formatNumber(reward.original_base_price_crystal)} CRYSTAL</div>
            ) : null}
          </div>
        </div>
        {slot === 2 && eligibleCount >= 2 ? (
          <div className="text-2xl font-black text-cyan-100">제1전리품 획득자는 이번 추첨에서 제외됩니다.</div>
        ) : null}
      </div>
    );
  }

  const candidates = slot === 1 ? shuffle.slot1 : shuffle.slot2;
  const showShuffle = stage.endsWith('DRAWING') || decelerating;

  if (showShuffle) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-8">
        {priorWinner}
        <div className="flex items-center gap-5 rounded-full border border-amber-200/40 bg-black/60 px-8 py-3">
          <RewardVisual reward={reward} size="sm" />
          <div className="text-4xl font-black text-white">{rewardHeadline(reward)}</div>
        </div>
        <div className="text-4xl font-black text-amber-100">
          {candidates.length <= 1 ? '단 한 명의 추첨 대상!' : '획득자 추첨 중…'}
        </div>
        <LootNameShuffle
          candidates={candidates}
          targetId={decelerating ? reward.winner?.student_id ?? null : null}
          reduced={reduced}
          onLanded={() => onLanded(slot)}
          onTick={() => onCue?.('tick')}
        />
        <div className="text-2xl font-black text-cyan-100">
          후보 {candidates.length}명{waitingLong ? ' · 최종 결과 확인 중…' : ''}
        </div>
      </div>
    );
  }

  // WINNER
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-6">
      {!reward.void ? <Confetti seed={`win-${slot}-${reward.winner?.student_id ?? 0}`} /> : null}
      {priorWinner}
      <SlotKicker slot={slot}>제{slot}전리품 획득자</SlotKicker>
      {reward.void ? (
        <div className="rounded-[28px] border border-amber-200/40 bg-black/60 px-10 py-8 text-3xl font-black text-amber-100">{deliveredLine(reward, mode)}</div>
      ) : (
        <div key={`winner-${slot}`} className="raid-loot-winner-in flex flex-col items-center gap-6">
          <WinnerBadge reward={reward} />
          <div className="flex items-center gap-4 rounded-full border border-amber-200/40 bg-black/60 px-8 py-3">
            <RewardVisual reward={reward} size="sm" />
            <div className="text-4xl font-black text-white">{rewardHeadline(reward)} 획득!</div>
          </div>
          <div className={cn('rounded-full px-8 py-3 text-2xl font-black', reward.duplicate_character_converted ? 'border border-fuchsia-300/50 bg-fuchsia-500/15 text-fuchsia-100' : 'border border-cyan-300/40 bg-cyan-500/10 text-cyan-100')}>
            {deliveredLine(reward, mode)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 조작 패널 (화면 오른쪽 아래, 학생 화면을 크게 가리지 않게)
// ---------------------------------------------------------------------------

function ControlBar({
  label,
  onNext,
  disabled,
  busy,
  error,
  progress,
  onClose,
  closeLabel,
  extra,
}: {
  label: string | null;
  onNext: () => void;
  disabled: boolean;
  busy: boolean;
  error: string | null;
  progress: string;
  onClose?: () => void;
  closeLabel?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="absolute bottom-5 right-5 z-[5] flex w-[300px] flex-col gap-2 rounded-[20px] border border-white/15 bg-black/80 p-3 backdrop-blur">
      <div className="flex items-center justify-between text-xs font-black text-cyan-100">
        <span>전리품 획득식 조작</span>
        <span>{progress}</span>
      </div>
      {error ? <div className="rounded-xl border border-red-300/40 bg-red-950/70 px-3 py-2 text-sm font-black text-red-100">{error}</div> : null}
      {label ? (
        <button
          type="button"
          onClick={onNext}
          disabled={disabled || busy}
          className="rounded-xl border border-amber-200/60 bg-amber-500/25 px-4 py-3 text-lg font-black text-yellow-50 hover:bg-amber-500/35 disabled:opacity-40"
        >
          {busy ? '처리 중…' : `${label} ▶`}
        </button>
      ) : null}
      {extra}
      {onClose ? (
        <button type="button" onClick={onClose} className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm font-black text-white hover:bg-white/10">
          {closeLabel ?? '닫기'}
        </button>
      ) : null}
      <div className="text-[11px] font-bold text-cyan-100">키보드 → 또는 PageDown(발표용 리모컨)으로도 넘길 수 있어요.</div>
    </div>
  );
}

function useNextKey(enabled: boolean, onNext: () => void) {
  const ref = useRef(onNext);
  ref.current = onNext;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        ref.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

function useStageCues(stage: RaidLootStage | null, decelerating: boolean, onCue?: (cue: RaidLootCue) => void) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!stage || !onCue) return;
    const key = `${stage}-${decelerating ? 'd' : 'n'}`;
    if (last.current === key) return;
    const prev = last.current;
    last.current = key;
    if (prev === null) return; // 처음 열 때(새로고침 포함)는 소리 없이
    if (stage === 'READY') onCue('chest');
    else if (stage.endsWith('ITEM')) onCue('reveal');
    else if (stage.endsWith('WINNER') && !decelerating) onCue('winner');
    else if (stage === 'COMPLETE') onCue('winner');
  }, [decelerating, onCue, stage]);
}

function OverlayFrame({ container, children, rehearsal }: { container: 'absolute' | 'fixed'; children: ReactNode; rehearsal: boolean }) {
  const inner = (
    <div className="raid-loot-root relative h-full w-full overflow-hidden text-white">
      <div className="raid-loot-rays" />
      {rehearsal ? (
        <div className="absolute left-0 top-0 z-[6] flex flex-col">
          <div className="raid-loot-ribbon px-6 py-2 text-xl font-black text-black shadow-lg">
            <span className="rounded bg-yellow-300 px-3 py-1">🎬 리허설 — 실제 지급 없음</span>
          </div>
          <div className="bg-black/75 px-6 py-1 text-sm font-black text-yellow-100">실제 진행은 그때 새로 추첨하므로 결과가 달라질 수 있어요.</div>
        </div>
      ) : null}
      <div className="relative z-[2] h-full w-full">{children}</div>
    </div>
  );
  if (container === 'absolute') {
    return <div className="absolute inset-0 z-[60]">{inner}</div>;
  }
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black">
      <div className="aspect-video w-full max-w-[1920px] max-h-screen">{inner}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 리허설 (대본 재생, DB 쓰기 없음)
// ---------------------------------------------------------------------------

export function RaidLootRehearsalOverlay({
  script,
  container = 'absolute',
  loading = false,
  error = null,
  onClose,
  onAgain,
  onCue,
}: {
  script: RaidLootRehearsalScript | null;
  container?: 'absolute' | 'fixed';
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onAgain: () => void;
  onCue?: (cue: RaidLootCue) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [stage, setStage] = useState<RaidLootStage>('READY');
  const [busy, setBusy] = useState(false);
  const draw = useDrawAnimation(stage);
  const { reset } = draw;

  useEffect(() => {
    setStage('READY');
    setBusy(false);
    reset();
  }, [reset, script?.generated_at]);

  const rewards = useMemo(() => (script ? maskRehearsalRewards(script.rewards ?? [], stage) : []), [script, stage]);
  useStageCues(stage, draw.decelerating, onCue);

  const next = useCallback(() => {
    if (!script || busy || draw.decelerating) return;
    const idx = stageIndex(stage);
    if (idx < 0 || stage === 'COMPLETE') return;
    const nextStage = RAID_LOOT_STAGE_ORDER[idx + 1];
    if (stage.endsWith('DRAWING')) {
      const slot = slotOfStage(stage);
      if (!slot) return;
      draw.beginConfirm(slot);
      setBusy(true);
      // 실제처럼 서버 응답을 기다리는 시간(0.8~1.5초)을 흉내 냅니다.
      window.setTimeout(() => { setStage(nextStage); setBusy(false); }, 800 + Math.random() * 700);
      return;
    }
    setStage(nextStage);
  }, [busy, draw, script, stage]);

  useNextKey(Boolean(script) && stage !== 'COMPLETE', next);

  const label = stage === 'COMPLETE' ? null : RAID_LOOT_NEXT_LABEL[stage];

  return (
    <OverlayFrame container={container} rehearsal>
      {loading || !script ? (
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <div className="text-4xl font-black text-white">{error ? '리허설을 준비하지 못했습니다' : '리허설 대본 준비 중…'}</div>
          {error ? <div className="max-w-[70%] text-center text-2xl font-black text-red-100">{error}</div> : null}
        </div>
      ) : script.unavailable_reason === 'NO_ELIGIBLE' ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
          <div className="text-6xl">🫥</div>
          <div className="text-5xl font-black text-white">전리품 획득식 미진행</div>
          <div className="text-2xl font-black text-amber-100">{RAID_LOOT_REASON_TEXT.NO_ELIGIBLE}</div>
        </div>
      ) : (
        <StageView
          mode="REHEARSAL"
          stage={stage}
          bossName={script.boss_name}
          eligibleCount={script.eligible_count}
          rewards={rewards}
          shuffle={script.shuffle_candidates}
          decelerating={draw.decelerating}
          waitingLong={false}
          reduced={reduced}
          onLanded={draw.markLanded}
          onCue={onCue}
        />
      )}
      <ControlBar
        label={script && script.unavailable_reason !== 'NO_ELIGIBLE' ? label : null}
        onNext={next}
        disabled={draw.decelerating}
        busy={busy}
        error={null}
        progress={`🎬 ${Math.max(0, stageIndex(stage)) + 1} / 8`}
        onClose={onClose}
        closeLabel="리허설 종료"
        extra={script && (stage === 'COMPLETE' || script.unavailable_reason === 'NO_ELIGIBLE') ? (
          <button type="button" onClick={onAgain} className="rounded-xl border border-cyan-300/50 bg-cyan-500/15 px-4 py-2 text-base font-black text-cyan-50 hover:bg-cyan-500/25">
            🎬 다시 리허설 (새 무작위 결과)
          </button>
        ) : null}
      />
    </OverlayFrame>
  );
}

// ---------------------------------------------------------------------------
// 실제 진행 (중계화면용)
// ---------------------------------------------------------------------------

export function RaidLootBroadcastLayer({
  raidId,
  raidStatus,
  onCue,
}: {
  raidId: number;
  raidStatus: RaidStatus;
  onCue?: (cue: RaidLootCue) => void;
}) {
  const queryClient = useQueryClient();
  const reduced = usePrefersReducedMotion();
  const enabled = raidStatus === 'COMPLETED' || raidStatus === 'ARCHIVED';
  const queryKey = useMemo(() => ['teacher-raid-loot-ceremony', raidId] as const, [raidId]);

  const ceremonyQuery = useQuery({
    queryKey,
    enabled,
    queryFn: async () => {
      const result = await raidLootRpc.getCeremony(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    // 전리품 설정이 없는 레이드는 10초마다, 그 외에는 1초마다 확인합니다.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && !data.ceremony && (data.config_version === null || data.config_version === undefined)) return 10_000;
      return 1000;
    },
    staleTime: 250,
  });

  const state: RaidLootAdminState | undefined = ceremonyQuery.data;
  const stage = state?.stage ?? null;
  const draw = useDrawAnimation(stage);
  // 이미 끝난 획득식은 중계화면을 가리지 않도록 처음엔 접어 두고, 진행 중이면 펼칩니다.
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const open = openOverride ?? (stage !== 'COMPLETE');
  const setOpen = setOpenOverride;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingLong, setWaitingLong] = useState(false);
  const pendingRequest = useRef<{ expected: string; id: string } | null>(null);

  // 리허설
  const [rehearsal, setRehearsal] = useState<{ script: RaidLootRehearsalScript | null; loading: boolean; error: string | null } | null>(null);
  const loadRehearsal = useCallback(async () => {
    setRehearsal({ script: null, loading: true, error: null });
    const result = await raidLootRpc.rehearse(supabase, raidId, 'RAID');
    if (result.success === false) setRehearsal({ script: null, loading: false, error: result.error });
    else setRehearsal({ script: result.data, loading: false, error: null });
  }, [raidId]);

  useStageCues(stage, draw.decelerating, rehearsal ? undefined : onCue);

  const run = useCallback(async () => {
    if (!state || busy || draw.decelerating) return;
    const expected = state.stage ?? 'NONE';
    if (expected === 'COMPLETE') return;
    const requestId = pendingRequest.current?.expected === expected ? pendingRequest.current.id : newRaidLootRequestId();
    pendingRequest.current = { expected, id: requestId };
    setBusy(true);
    setError(null);
    const longTimer = window.setTimeout(() => setWaitingLong(true), 3000);
    if (state.stage && state.stage.endsWith('DRAWING')) {
      const slot = slotOfStage(state.stage);
      if (slot) draw.beginConfirm(slot);
    }
    try {
      const result = state.stage
        ? await raidLootRpc.advance(supabase, raidId, state.stage, requestId)
        : await raidLootRpc.prepare(supabase, raidId, requestId);
      if (result.success === false) {
        setError(`${result.error} — 같은 버튼을 다시 누르면 이어서 진행합니다(중복 지급 없음).`);
        return;
      }
      pendingRequest.current = null;
      queryClient.setQueryData(queryKey, result.data);
      setOpen(true);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : '네트워크 오류'} — 같은 버튼을 다시 누르면 이어서 진행합니다(중복 지급 없음).`);
    } finally {
      window.clearTimeout(longTimer);
      setWaitingLong(false);
      setBusy(false);
    }
  }, [busy, draw, queryClient, queryKey, raidId, state]);

  const ceremonyActive = Boolean(state?.ceremony);
  useNextKey(enabled && !rehearsal && open && ceremonyActive && stage !== 'COMPLETE', () => { void run(); });

  if (!enabled || !state) return null;

  if (rehearsal) {
    return (
      <RaidLootRehearsalOverlay
        script={rehearsal.script}
        loading={rehearsal.loading}
        error={rehearsal.error}
        onClose={() => setRehearsal(null)}
        onAgain={() => void loadRehearsal()}
        onCue={onCue}
      />
    );
  }

  // 아직 획득식이 없을 때: 작은 시작 카드
  if (!state.ceremony) {
    const hasConfig = state.config_version !== null && state.config_version !== undefined;
    if (!state.can_prepare && !hasConfig) return null;
    const reason = state.unavailable_reason;
    return (
      <div className="absolute bottom-6 left-1/2 z-[55] w-[560px] -translate-x-1/2 rounded-[24px] border border-amber-200/40 bg-black/85 p-5 text-center backdrop-blur">
        <div className="text-xl font-black text-yellow-100">🎁 레이드 전리품 획득식</div>
        {state.can_prepare ? (
          <div className="mt-1 text-base font-black text-cyan-100">추첨 대상 {state.eligible_count ?? 0}명 · 전체 피해량 1% 이상 기여</div>
        ) : reason ? (
          <div className="mt-1 text-base font-black text-amber-100">{RAID_LOOT_REASON_TEXT[reason]}</div>
        ) : null}
        {reason === 'CONFIG_INCOMPLETE' && (state.config_issues ?? []).length > 0 ? (
          <div className="mt-2 text-sm font-bold text-amber-100">{state.config_issues.join(' / ')}</div>
        ) : null}
        {error ? <div className="mt-2 rounded-xl border border-red-300/40 bg-red-950/70 px-3 py-2 text-sm font-black text-red-100">{error}</div> : null}
        <div className="mt-4 flex justify-center gap-3">
          {state.can_prepare ? (
            <button type="button" onClick={() => void run()} disabled={busy} className="rounded-xl border border-amber-200/60 bg-amber-500/25 px-6 py-3 text-lg font-black text-yellow-50 hover:bg-amber-500/35 disabled:opacity-40">
              {busy ? '준비 중…' : '전리품 획득식 시작 ▶'}
            </button>
          ) : null}
          {hasConfig && raidStatus === 'COMPLETED' ? (
            <button type="button" onClick={() => void loadRehearsal()} className="rounded-xl border border-cyan-300/50 bg-cyan-500/15 px-5 py-3 text-base font-black text-cyan-50 hover:bg-cyan-500/25">
              🎬 리허설
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute bottom-6 left-1/2 z-[55] -translate-x-1/2 rounded-full border border-amber-200/50 bg-black/80 px-6 py-3 text-lg font-black text-yellow-100 backdrop-blur hover:bg-black/90"
      >
        🎁 전리품 획득식 {state.stage === 'COMPLETE' ? '결과 보기' : '이어서 진행'}
      </button>
    );
  }

  const label = state.next_action?.label ?? null;
  return (
    <OverlayFrame container="absolute" rehearsal={false}>
      <StageView
        mode="LIVE"
        stage={state.stage ?? 'READY'}
        bossName={state.raid.boss_name}
        eligibleCount={state.ceremony.eligible_count}
        rewards={state.rewards}
        shuffle={state.shuffle_candidates}
        decelerating={draw.decelerating}
        waitingLong={waitingLong}
        reduced={reduced}
        onLanded={draw.markLanded}
        onCue={onCue}
      />
      <ControlBar
        label={label}
        onNext={() => void run()}
        disabled={draw.decelerating}
        busy={busy}
        error={error}
        progress={`${Math.max(0, stageIndex(state.stage)) + 1} / 8`}
        onClose={() => setOpen(false)}
        closeLabel={state.stage === 'COMPLETE' ? '닫기' : '잠시 숨기기 (진행 상태 유지)'}
      />
    </OverlayFrame>
  );
}
