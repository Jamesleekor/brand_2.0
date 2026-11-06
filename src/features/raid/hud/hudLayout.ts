// RAID_HUD_V3_20261106
// HUD v3 배치 엔진 — 화면 없이 계산만 한다. 학생 전투 화면 · 교사 미리보기 · (2차) 중계 화면이 함께 쓴다.
//
// 프레임을 하나씩 옮기지 않고, 미리 정한 배치 6가지 중 보호영역(C/D 타격 영역 + 보스 얼굴 영역)을
// 가장 덜 가리는 배치를 통째로 고른다.
import type { CSSProperties } from 'react';

import type {
  RaidHudFaceZone,
  RaidHudPreset,
  RaidTargetingPublicConfig,
} from '@/features/raid/targeting/raidTargeting';

export type HudPresetKey = 'A' | 'B_LEFT' | 'B_RIGHT' | 'C' | 'D_LEFT' | 'D_RIGHT';

export interface HudRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HudStage {
  width: number;
  height: number;
  // 브라우저에 실제로 보이는 높이(전체화면이 아니면 전투 화면 아래가 잘릴 수 있음)
  visibleHeight: number;
}

export interface HudBox {
  style: CSSProperties;
  // 화면 대비 0~1 사각형(겹침 계산용)
  rect: HudRect;
  // 보호영역과 겹쳐서 배경을 더 투명하게 할지
  dim: boolean;
}

export interface HudV3Layout {
  preset: HudPresetKey;
  presetLabel: string;
  auto: boolean;
  column: boolean;
  bossAlign: 'left' | 'center' | 'right';
  nav: HudBox;
  boss: HudBox;
  tracker: HudBox;
  player: HudBox;
  barrier: HudBox;
  warning: CSSProperties;
  guide: CSSProperties;
  tapHint: CSSProperties;
  protectedRects: HudRect[];
  overlapScore: number;
}

export interface HudSizeSet {
  margin: number;
  gap: number;
  navTop: number;
  nav: { width: number; height: number };
  boss: { width: number; height: number };
  bossColumn: { width: number; height: number };
  tracker: { width: number; height: number };
  player: { width: number; height: number };
  barrier: { width: number; height: number };
  warning: { width: number; height: number };
  guide: { width: number; height: number };
}

// 학생 화면(크롬북 1366×768 기준) 프레임 크기. 보스 프레임 높이는 공격 예고 시전 바가 있을 때의 최대값.
// 화면에서는 보스 프레임 바로 아래(C는 바로 위)에 트래커가 붙어서 그려지므로, 여기 높이는 겹침 계산용 예약값이다.
export const HUD_SIZES_STUDENT: HudSizeSet = {
  margin: 16,
  gap: 8,
  navTop: 14,
  nav: { width: 88, height: 36 },
  boss: { width: 560, height: 128 },
  bossColumn: { width: 400, height: 180 },
  tracker: { width: 430, height: 46 },
  player: { width: 270, height: 56 },
  barrier: { width: 480, height: 52 },
  warning: { width: 900, height: 56 },
  guide: { width: 360, height: 56 },
};

export const HUD_DEFAULT_STAGE: HudStage = { width: 1366, height: 768, visibleHeight: 768 };

const PRESET_ORDER: HudPresetKey[] = ['A', 'B_LEFT', 'B_RIGHT', 'C', 'D_LEFT', 'D_RIGHT'];

export const HUD_PRESET_LABEL: Record<HudPresetKey, string> = {
  A: 'A 기본',
  B_LEFT: 'B 한쪽 쏠림 (왼쪽)',
  B_RIGHT: 'B 한쪽 쏠림 (오른쪽)',
  C: 'C 아래 모으기',
  D_LEFT: 'D 세로 기둥 (왼쪽)',
  D_RIGHT: 'D 세로 기둥 (오른쪽)',
};

function candidatesForPreset(preset: RaidHudPreset): HudPresetKey[] {
  if (preset === 'A') return ['A'];
  if (preset === 'B') return ['B_LEFT', 'B_RIGHT'];
  if (preset === 'C') return ['C'];
  if (preset === 'D') return ['D_LEFT', 'D_RIGHT'];
  return PRESET_ORDER;
}

export function hudRectOverlapArea(a: HudRect, b: HudRect): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function padRect(rect: HudRect, padding = 0.025): HudRect {
  const x = Math.max(0, rect.x - padding);
  const y = Math.max(0, rect.y - padding);
  const right = Math.min(1, rect.x + rect.width + padding);
  const bottom = Math.min(1, rect.y + rect.height + padding);
  return { x, y, width: right - x, height: bottom - y };
}

// C/D 타격 영역(유효할 때) + 보스 얼굴 영역 → 여유 2.5%씩 넓힌 보호영역 목록
export function hudProtectedRects(
  targeting: Pick<RaidTargetingPublicConfig, 'mode' | 'valid' | 'primary_zone' | 'face_zone'> | null | undefined,
): HudRect[] {
  const rects: HudRect[] = [];
  if (targeting && targeting.mode !== 'BODY' && targeting.valid && targeting.primary_zone) {
    const zone = targeting.primary_zone;
    rects.push(padRect({ x: zone.x, y: zone.y, width: zone.width, height: zone.height }));
  }
  const face: RaidHudFaceZone | null | undefined = targeting?.face_zone;
  if (face) rects.push(padRect({ x: face.x, y: face.y, width: face.width, height: face.height }));
  return rects;
}

interface PxFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  // 아래 기준으로 붙는 프레임은 bottom 값(px, 보이는 영역 아래에서부터)
  bottom: number | null;
}

interface PresetGeometry {
  boss: PxFrame;
  tracker: PxFrame;
  player: PxFrame;
  barrier: PxFrame;
  column: boolean;
  bossAlign: 'left' | 'center' | 'right';
}

function presetGeometry(key: HudPresetKey, stage: HudStage, s: HudSizeSet): PresetGeometry {
  const W = Math.max(1, stage.width);
  const VH = Math.max(1, Math.min(stage.height, stage.visibleHeight));
  const m = s.margin;
  const g = s.gap;
  const bossW = Math.min(s.boss.width, W * 0.46);
  const trW = Math.min(s.tracker.width, W * 0.4);
  const barW = Math.min(s.barrier.width, W * 0.42);
  const plW = Math.min(s.player.width, W * 0.3);
  const colW = Math.min(s.bossColumn.width, W * 0.34);
  const belowNav = s.navTop + s.nav.height + g;
  const center = (w: number) => (W - w) / 2;
  const fromBottom = (h: number, bottom: number): PxFrame => ({ x: 0, y: VH - bottom - h, w: 0, h, bottom });

  const barrierBottom = { ...fromBottom(s.barrier.height, m), x: center(barW), w: barW };

  if (key === 'A') {
    const bossY = s.navTop;
    return {
      boss: { x: center(bossW), y: bossY, w: bossW, h: s.boss.height, bottom: null },
      tracker: { x: center(trW), y: bossY + s.boss.height + g, w: trW, h: s.tracker.height, bottom: null },
      player: { x: m, y: belowNav, w: plW, h: s.player.height, bottom: null },
      barrier: barrierBottom,
      column: false,
      bossAlign: 'center',
    };
  }
  if (key === 'B_LEFT' || key === 'B_RIGHT') {
    const left = key === 'B_LEFT';
    const bossX = left ? m + s.nav.width + g : W - m - bossW;
    const trX = left ? bossX : W - m - trW;
    return {
      boss: { x: bossX, y: s.navTop, w: bossW, h: s.boss.height, bottom: null },
      tracker: { x: trX, y: s.navTop + s.boss.height + g, w: trW, h: s.tracker.height, bottom: null },
      player: { ...fromBottom(s.player.height, m), x: left ? m : W - m - plW, w: plW },
      barrier: barrierBottom,
      column: false,
      bossAlign: left ? 'left' : 'right',
    };
  }
  if (key === 'C') {
    const bossBottom = m + s.barrier.height + g;
    const trBottom = bossBottom + s.boss.height + g;
    return {
      boss: { ...fromBottom(s.boss.height, bossBottom), x: center(bossW), w: bossW },
      tracker: { ...fromBottom(s.tracker.height, trBottom), x: center(trW), w: trW },
      player: { ...fromBottom(s.player.height, m), x: m, w: plW },
      barrier: barrierBottom,
      column: false,
      bossAlign: 'center',
    };
  }
  const left = key === 'D_LEFT';
  const colX = left ? m : W - m - colW;
  const bossY = belowNav;
  const trY = bossY + s.bossColumn.height + g;
  const barY = trY + s.tracker.height + g;
  return {
    boss: { x: colX, y: bossY, w: colW, h: s.bossColumn.height, bottom: null },
    tracker: { x: colX, y: trY, w: colW, h: s.tracker.height, bottom: null },
    player: { ...fromBottom(s.player.height, m), x: left ? m : W - m - plW, w: plW },
    barrier: { x: colX, y: barY, w: colW, h: s.barrier.height, bottom: null },
    column: true,
    bossAlign: left ? 'left' : 'right',
  };
}

function frameRect(frame: PxFrame, stage: HudStage): HudRect {
  const W = Math.max(1, stage.width);
  const H = Math.max(1, stage.height);
  return { x: frame.x / W, y: frame.y / H, width: frame.w / W, height: frame.h / H };
}

function frameStyle(frame: PxFrame, stage: HudStage): CSSProperties {
  const VH = Math.max(1, Math.min(stage.height, stage.visibleHeight));
  const style: CSSProperties = { left: Math.round(frame.x) + 'px', width: Math.round(frame.w) + 'px' };
  if (frame.bottom != null) style.bottom = Math.round(stage.height - VH + frame.bottom) + 'px';
  else style.top = Math.round(frame.y) + 'px';
  return style;
}

function overlapWith(rect: HudRect, rects: HudRect[]): number {
  return rects.reduce((sum, item) => sum + hudRectOverlapArea(rect, item), 0);
}

function box(frame: PxFrame, stage: HudStage, protectedRects: HudRect[]): HudBox {
  const rect = frameRect(frame, stage);
  return { style: frameStyle(frame, stage), rect, dim: overlapWith(rect, protectedRects) > 0 };
}

// 가운데 정렬 한 줄(경고 글자·안내 카드) 자리: 후보 중 보호영역·프레임과 가장 덜 겹치는 곳
function pickCenteredSlot(
  candidatesTopPx: number[],
  size: { width: number; height: number },
  stage: HudStage,
  avoid: HudRect[],
): { top: number; rect: HudRect } {
  const W = Math.max(1, stage.width);
  const H = Math.max(1, stage.height);
  const w = Math.min(size.width, W * 0.9);
  let best = { top: candidatesTopPx[0], rect: { x: 0, y: 0, width: 0, height: 0 } as HudRect };
  let bestScore = Number.POSITIVE_INFINITY;
  candidatesTopPx.forEach((top, index) => {
    const rect = { x: (W - w) / 2 / W, y: top / H, width: w / W, height: size.height / H };
    const score = overlapWith(rect, avoid) * 1000 + index * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = { top, rect };
    }
  });
  return best;
}

export function buildHudV3Layout(
  targeting: Pick<RaidTargetingPublicConfig, 'mode' | 'valid' | 'primary_zone' | 'face_zone' | 'hud_preset'> | null | undefined,
  stage: HudStage = HUD_DEFAULT_STAGE,
  sizes: HudSizeSet = HUD_SIZES_STUDENT,
): HudV3Layout {
  const protectedRects = hudProtectedRects(targeting);
  const preset = targeting?.hud_preset ?? 'AUTO';
  const candidates = protectedRects.length === 0 && preset === 'AUTO' ? (['A'] as HudPresetKey[]) : candidatesForPreset(preset);

  let chosen: HudPresetKey = candidates[0];
  let chosenGeometry = presetGeometry(chosen, stage, sizes);
  let bestScore = Number.POSITIVE_INFINITY;
  let bestOverlap = 0;
  candidates.forEach((key) => {
    const geometry = presetGeometry(key, stage, sizes);
    const overlap = [geometry.boss, geometry.tracker, geometry.player, geometry.barrier]
      .reduce((sum, frame) => sum + overlapWith(frameRect(frame, stage), protectedRects), 0);
    const score = overlap * 1000 + PRESET_ORDER.indexOf(key) * 0.01;
    if (score < bestScore) {
      bestScore = score;
      bestOverlap = overlap;
      chosen = key;
      chosenGeometry = geometry;
    }
  });

  const VH = Math.max(1, Math.min(stage.height, stage.visibleHeight));
  const nav: PxFrame = { x: sizes.margin, y: sizes.navTop, w: sizes.nav.width, h: sizes.nav.height, bottom: null };
  const frames = {
    nav: box(nav, stage, protectedRects),
    boss: box(chosenGeometry.boss, stage, protectedRects),
    tracker: box(chosenGeometry.tracker, stage, protectedRects),
    player: box(chosenGeometry.player, stage, protectedRects),
    barrier: box(chosenGeometry.barrier, stage, protectedRects),
  };
  const frameRects = [frames.nav.rect, frames.boss.rect, frames.tracker.rect, frames.player.rect, frames.barrier.rect];
  const avoid = [...protectedRects, ...frameRects];

  const warning = pickCenteredSlot(
    [VH * 0.3, VH * 0.46, VH * 0.62],
    sizes.warning,
    stage,
    avoid,
  );

  const barrierTopPx = chosenGeometry.barrier.y;
  const trackerTopPx = chosenGeometry.tracker.y;
  const trackerBottomPx = chosenGeometry.tracker.y + chosenGeometry.tracker.h;
  const guideCandidates = chosenGeometry.column
    ? [VH * 0.46, VH - sizes.margin - sizes.guide.height - 40]
    : chosen === 'C'
      ? [trackerTopPx - sizes.gap - sizes.guide.height, VH * 0.3]
      : [barrierTopPx - sizes.gap - sizes.guide.height - 28, trackerBottomPx + sizes.gap, VH * 0.46];
  const guide = pickCenteredSlot(guideCandidates, sizes.guide, stage, [...avoid, warning.rect]);

  const tapTop = chosenGeometry.column
    ? chosenGeometry.barrier.y + chosenGeometry.barrier.h + 10
    : chosen === 'C'
      ? trackerTopPx - 26
      : barrierTopPx - 26;
  const tapHint: CSSProperties = chosenGeometry.column
    ? { left: Math.round(chosenGeometry.barrier.x) + 'px', top: Math.round(tapTop) + 'px', width: Math.round(chosenGeometry.barrier.w) + 'px', textAlign: chosenGeometry.bossAlign === 'right' ? 'right' : 'left' }
    : { left: '50%', top: Math.round(tapTop) + 'px', transform: 'translateX(-50%)' };

  return {
    preset: chosen,
    presetLabel: HUD_PRESET_LABEL[chosen],
    auto: preset === 'AUTO',
    column: chosenGeometry.column,
    bossAlign: chosenGeometry.bossAlign,
    ...frames,
    warning: { left: '50%', top: Math.round(warning.top) + 'px', transform: 'translateX(-50%)', width: 'max-content', maxWidth: '90%' },
    guide: { left: '50%', top: Math.round(guide.top) + 'px', transform: 'translateX(-50%)' },
    tapHint,
    protectedRects,
    overlapScore: bestOverlap,
  };
}

// ── 패턴 → 기믹 트래커 내용 (기존 SpecialPatternOverlay와 같은 숫자·문구) ──

export type HudTone = 'violet' | 'danger' | 'cyan' | 'warning' | 'green';

export interface HudPatternInfo {
  eyebrow: string;
  title: string;
  description: string;
  tone: HudTone;
  // 목표 HP/피해가 있으면 진행 바, 없으면 남은 시간 바
  current: number | null;
  max: number | null;
  remainingMode: boolean;
  // 공격을 멈춰야 하는 패턴(ABSORB): 트래커 깜박임 + 화면 가장자리 강조
  blocking: boolean;
}

interface HudPatternLike {
  name: string;
  pattern_type: string;
  state: Record<string, unknown>;
}

function num(source: Record<string, unknown>, key: string, fallback = 0): number {
  const value = Number(source?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function targetLabel(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const label = (value as Record<string, unknown>).label;
  return typeof label === 'string' && label.trim() ? label : null;
}

export function describeHudPattern(pattern: HudPatternLike): HudPatternInfo | null {
  const type = String(pattern.pattern_type ?? '').toUpperCase();
  const st = pattern.state ?? {};
  const base = { current: null, max: null, remainingMode: false, blocking: false };

  if (type === 'BREAK') {
    const max = Math.max(1, num(st, 'objective_max_hp', 1));
    return { ...base, eyebrow: 'BREAK', title: pattern.name, description: '집중 공격으로 끊어내세요!', tone: 'violet', current: Math.max(0, Math.min(max, num(st, 'objective_current_hp', max))), max };
  }
  if (type === 'BOSS_STRIKE' || type === 'ULTIMATE') {
    return { ...base, eyebrow: 'ULTIMATE', title: pattern.name, description: '필살기가 완성되기 전에 시전을 끊어내세요!', tone: 'danger', current: num(st, 'objective_current_hp', 1), max: Math.max(1, num(st, 'objective_max_hp', 1)) };
  }
  if (type === 'SHIELD') {
    return { ...base, eyebrow: 'SHIELD', title: '보스 보호막', description: '보호막을 먼저 깨야 보스에게 피해가 들어가요!', tone: 'cyan', current: num(st, 'shield_current_hp', 1), max: Math.max(1, num(st, 'shield_max_hp', 1)) };
  }
  if (type === 'DAMAGE_CHECK') {
    const target = Math.max(1, num(st, 'target_damage', 1));
    const dealt = Math.max(0, num(st, 'damage_dealt', 0));
    return { ...base, eyebrow: 'DAMAGE CHECK', title: '화력 검증', description: '제한 시간 안에 목표 피해를 채우세요!', tone: 'warning', current: Math.max(0, target - dealt), max: target, remainingMode: true };
  }
  if (type === 'ABSORB') {
    const heal = num(st, 'heal_ratio', 1);
    return { ...base, eyebrow: 'ABSORB', title: '마력 흡수 — 공격 중지!', description: '지금 공격하면 보스가 피해의 ' + (heal * 100).toFixed(0) + '%를 회복해요!', tone: 'violet', blocking: true };
  }
  if (type === 'REFLECT') {
    const ratio = num(st, 'reflect_ratio', 0.3);
    return { ...base, eyebrow: 'REFLECT', title: '반격 태세 · 반사 ' + (ratio * 100).toFixed(0) + '%', description: '공격 피해의 일부가 공명방벽에 반사돼요!', tone: 'danger' };
  }
  if (type === 'DOT') {
    const label = targetLabel(st.interrupt_target);
    return { ...base, eyebrow: 'DOT', title: '지속 피해', description: label ? label + '을 파괴해 방벽 피해를 멈추세요!' : '공명방벽이 계속 줄어들어요!', tone: 'danger' };
  }
  if (type === 'MULTI_CORE') {
    const mode = String(st.mode ?? 'FIXED_ORDER');
    return { ...base, eyebrow: 'MULTI CORE', title: '다중 마력핵', description: mode === 'ANY_ORDER' ? '모든 마력핵을 파괴하세요!' : '빛나는 순서대로 핵을 파괴하세요!', tone: 'warning' };
  }
  if (type === 'SPLIT_TARGET') {
    return { ...base, eyebrow: 'SPLIT TARGET', title: '분산 공격', description: '양쪽 목표를 균형 있게 공격하세요!', tone: 'cyan' };
  }
  if (type === 'REGEN') {
    const label = targetLabel(st.core);
    return { ...base, eyebrow: 'REGEN', title: '보스 재생 중', description: label ? label + '을 파괴해 재생을 멈추세요!' : '보스가 HP를 회복하고 있어요!', tone: 'green' };
  }
  if (type === 'SEAL') {
    return { ...base, eyebrow: 'SEAL', title: '암흑 봉인', description: '봉인석을 모두 파괴하세요!', tone: 'violet' };
  }
  if (type === 'WEAK_POINT') {
    return { ...base, eyebrow: 'WEAK POINT', title: '약점 노출', description: '빛나는 약점을 노리세요!', tone: 'warning' };
  }
  return null;
}
