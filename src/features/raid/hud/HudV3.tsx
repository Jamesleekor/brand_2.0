// RAID_HUD_V3_20261106
// 학생 전투 화면 HUD v3 — MMORPG식 프레임 4개(보스 프레임 · 기믹 트래커 · 내 프레임 · 공명방벽 바)
// + 잠깐 뜨는 레이드 경고 글자. 위치는 hudLayout.ts가 정하고, 이 파일은 그리기만 한다.
// 전투 계산·타격 처리에는 관여하지 않는다(모두 pointer-events: none, 버튼만 예외).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import type { RaidBattleState } from '@/lib/rpc/raid_student_rpc';
import { cn } from '@/lib/utils/cn';
import { describeHudPattern, type HudBox, type HudPatternInfo, type HudTone, type HudV3Layout } from '@/features/raid/hud/hudLayout';

const HUD_STORAGE_KEY = 'brand.raidHud';
const FONT_LINK_ID = 'brand-hud-v3-fonts';

const C = {
  ink: '#f2ede4',
  muted: '#c6ced8',
  gold: '#e8c98a',
  goldLine: 'rgba(201,164,90,0.75)',
  team: '#7fe3f2',
  teamLine: 'rgba(95,212,232,0.55)',
  mech: '#c9a6ff',
  num: "'Barlow Condensed', 'Rajdhani', ui-sans-serif, system-ui, sans-serif",
  serif: "'Noto Serif KR', 'Nanum Myeongjo', serif",
};

const TONE: Record<HudTone, { line: string; text: string; glow: string; bar: string }> = {
  violet: { line: 'rgba(185,140,255,0.75)', text: '#c9a6ff', glow: 'rgba(176,120,255,0.95)', bar: 'linear-gradient(90deg,#7b3fe0,#c06bff 70%,#ffd18a)' },
  danger: { line: 'rgba(255,106,85,0.75)', text: '#ff9a88', glow: 'rgba(255,80,60,0.95)', bar: 'linear-gradient(90deg,#b8261a,#ff6a45 70%,#ffc35c)' },
  cyan: { line: 'rgba(95,212,232,0.75)', text: '#9ff0fb', glow: 'rgba(95,212,232,0.95)', bar: 'linear-gradient(90deg,#0e6f9c,#2fc0de 65%,#bff6ff)' },
  warning: { line: 'rgba(255,179,71,0.75)', text: '#ffd28a', glow: 'rgba(255,170,40,0.95)', bar: 'linear-gradient(90deg,#b8650f,#ffb347 70%,#ffe08a)' },
  green: { line: 'rgba(95,227,161,0.75)', text: '#a8f5cb', glow: 'rgba(80,220,150,0.95)', bar: 'linear-gradient(90deg,#127a4a,#3fd68a 70%,#c8ffe0)' },
};

const ELEMENT: Record<string, { label: string; color: string }> = {
  FIRE: { label: '화', color: '#ff8a3a' },
  WATER: { label: '수', color: '#5fb4ff' },
  WIND: { label: '풍', color: '#7fe3c0' },
  EARTH: { label: '토', color: '#d2a86a' },
  LIGHT: { label: '빛', color: '#ffe48a' },
  DARK: { label: '암', color: '#b48cff' },
};

// ── 켜고 끄기: ?hud=v3 → 이 기기에 기억, ?hud=legacy → 끔 ──
export function readHudV3Enabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const param = new URLSearchParams(window.location.search).get('hud');
    if (param === 'v3') window.localStorage.setItem(HUD_STORAGE_KEY, 'v3');
    if (param === 'legacy') window.localStorage.removeItem(HUD_STORAGE_KEY);
    return window.localStorage.getItem(HUD_STORAGE_KEY) === 'v3';
  } catch {
    return new URLSearchParams(window.location.search).get('hud') === 'v3';
  }
}

export function useHudV3Enabled(): boolean {
  const [enabled] = useState(readHudV3Enabled);
  useEffect(() => {
    if (!enabled || typeof document === 'undefined' || document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@900&family=Barlow+Condensed:wght@500;600;700&display=swap';
    document.head.appendChild(link);
  }, [enabled]);
  return enabled;
}

// ── 레이드 경고: 패턴 시작 · 그로기 시작 · 방벽 25% 이하 진입 때 1.7초 ──
export interface HudWarning {
  key: number;
  text: string;
  sub: string;
  tone: HudTone;
}

export function useHudRaidWarning(state: RaidBattleState | undefined, enabled: boolean): HudWarning | null {
  const [warning, setWarning] = useState<HudWarning | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenRef = useRef<{ init: boolean; run: number | null; groggy: string | null; critical: boolean }>({
    init: false, run: null, groggy: null, critical: false,
  });
  const combat = state?.combat;
  const pattern = combat?.active_pattern ?? null;
  const runId = pattern?.run_id ?? null;
  const groggyKey = combat?.groggy_active ? combat.groggy_until ?? 'on' : null;
  const groggyMult = Number(combat?.groggy_damage_multiplier ?? 1);
  const critical = Boolean(combat?.barrier_enabled && Number(combat?.barrier_ratio) <= 0.25 && state?.raid.status === 'ACTIVE');

  useEffect(() => {
    if (!state) return;
    const seen = seenRef.current;
    const show = (text: string, sub: string, tone: HudTone) => {
      if (!enabled) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      setWarning({ key: Date.now(), text, sub, tone });
      timerRef.current = setTimeout(() => setWarning(null), 1700);
    };
    if (!seen.init) {
      seen.init = true;
      seen.groggy = groggyKey;
      seen.critical = critical;
    }
    if (runId !== seen.run) {
      seen.run = runId;
      const info = pattern && state.raid.status === 'ACTIVE' ? describeHudPattern(pattern) : null;
      if (info) show(info.title, info.description, info.tone);
    }
    if (groggyKey !== seen.groggy) {
      seen.groggy = groggyKey;
      if (groggyKey) show('그로기! 받는 피해 ×' + groggyMult.toFixed(1), '지금 모두 공격!', 'cyan');
    }
    if (critical !== seen.critical) {
      seen.critical = critical;
      if (critical) show('공명방벽 위험!', '보스 공격을 버텨야 해요', 'danger');
    }
  }, [state, runId, groggyKey, groggyMult, critical, enabled, pattern]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return enabled ? warning : null;
}

// ── 작은 부품들 ──
function frameBg(dim: boolean) {
  return dim ? 'rgba(9,13,24,0.45)' : 'rgba(9,13,24,0.6)';
}

function Corners({ color, size = 10 }: { color: string; size?: number }) {
  const base: CSSProperties = { position: 'absolute', width: size, height: size, borderColor: color, borderStyle: 'solid', borderWidth: 0 };
  return (
    <>
      <span aria-hidden="true" style={{ ...base, left: -1, top: -1, borderLeftWidth: 2, borderTopWidth: 2 }} />
      <span aria-hidden="true" style={{ ...base, right: -1, top: -1, borderRightWidth: 2, borderTopWidth: 2 }} />
      <span aria-hidden="true" style={{ ...base, left: -1, bottom: -1, borderLeftWidth: 2, borderBottomWidth: 2 }} />
      <span aria-hidden="true" style={{ ...base, right: -1, bottom: -1, borderRightWidth: 2, borderBottomWidth: 2 }} />
    </>
  );
}

function Bar({ ratio, ghost, fill, height, ticks = true, border = 'rgba(255,255,255,0.16)' }: {
  ratio: number; ghost?: number; fill: string; height: number; ticks?: boolean; border?: string;
}) {
  const r = Math.max(0, Math.min(1, ratio));
  const g = Math.max(r, Math.min(1, ghost ?? r));
  return (
    <div style={{ position: 'relative', height, borderRadius: 2, border: `1px solid ${border}`, background: 'rgba(0,0,0,0.6)', overflow: 'hidden' }}>
      {ghost != null ? (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,238,214,0.88)', transformOrigin: 'left', transform: `scaleX(${g})`, transition: 'transform 380ms ease-out' }} />
      ) : null}
      <div style={{ position: 'absolute', inset: 0, background: fill, transformOrigin: 'left', transform: `scaleX(${r})`, transition: 'transform 160ms linear' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: Math.max(3, Math.round(height / 3)), background: 'linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0))' }} />
      {ticks ? (
        <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(90deg, rgba(0,0,0,0) 0 calc(10% - 1px), rgba(0,0,0,0.55) calc(10% - 1px) 10%)' }} />
      ) : null}
    </div>
  );
}

const Icon = {
  flame: (size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 2 1.5 3 2.5 3-1-3 0-6 0-8z" /></svg>
  ),
  burst: (size = 14) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true"><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5L19 19M19 5l-2.5 2.5M7.5 16.5L5 19" /></svg>
  ),
  bolt: (size = 15) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></svg>
  ),
  hex: (size = 22) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M12 2l8.5 5v10L12 22l-8.5-5V7z" /><path d="M12 8v5M12 16v.5" strokeLinecap="round" /></svg>
  ),
  shield: (size = 16) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" /></svg>
  ),
  sword: (size = 22) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.5 3.5h6v6l-9 9-3-3z" /><path d="M5 16l3 3M3 21l3-3" /></svg>
  ),
  back: (size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
  ),
  hub: (size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></svg>
  ),
};

// inline: 보스 묶음(보스 프레임 + 트래커 [+ D 배치의 방벽 바]) 안에 순서대로 쌓일 때
function Frame({ box, line, corner, className, children, glow, inline = false }: {
  box: HudBox; line: string; corner?: string; className?: string; children: ReactNode; glow?: string; inline?: boolean;
}) {
  return (
    <div
      className={cn('pointer-events-none', inline ? 'relative' : 'absolute z-30', className)}
      style={{
        ...(inline ? { width: box.style.width, maxWidth: '100%' } : box.style),
        boxSizing: 'border-box',
        background: frameBg(box.dim),
        border: `1px solid ${line}`,
        borderRadius: 4,
        boxShadow: glow ? `0 0 22px ${glow}, 0 6px 24px rgba(0,0,0,0.45)` : '0 6px 24px rgba(0,0,0,0.45)',
        color: C.ink,
      }}
    >
      {corner ? <Corners color={corner} /> : null}
      {children}
    </div>
  );
}

function useGhostRatio(ratio: number) {
  const [ghost, setGhost] = useState(ratio);
  useEffect(() => {
    if (ratio >= ghost) {
      setGhost(ratio);
      return undefined;
    }
    const timer = setTimeout(() => setGhost(ratio), 420);
    return () => clearTimeout(timer);
  }, [ratio, ghost]);
  return ghost;
}

// ── 보스 프레임: 이름·속성·PHASE·광폭/그로기 아이콘·HP·공격 예고 시전 바 ──
function HudBossFrame({ layout, state, hp, hpRatio, groggyActive, groggySeconds, cast }: {
  layout: HudV3Layout;
  state: RaidBattleState;
  hp: number;
  hpRatio: number;
  groggyActive: boolean;
  groggySeconds: number;
  cast: { name: string; seconds: number; total: number } | null;
}) {
  const ratio = Math.max(0, Math.min(1, Number.isFinite(hpRatio) ? hpRatio : 0));
  const ghost = useGhostRatio(ratio);
  const combat = state.combat;
  const element = ELEMENT[String(state.raid.boss_element)] ?? { label: '?', color: C.gold };
  const enrage = Boolean(combat?.enrage_active);
  return (
    <Frame inline box={layout.boss} line={groggyActive ? 'rgba(127,227,242,0.9)' : C.goldLine} corner={C.gold} glow={groggyActive ? 'rgba(95,212,232,0.45)' : undefined}>
      <div style={{ padding: '9px 14px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: layout.column ? 'wrap' : 'nowrap' }}>
          <div title={`${element.label} 속성`} style={{ width: 24, height: 24, flex: 'none', borderRadius: '50%', border: '1px solid rgba(232,201,138,0.8)', display: 'grid', placeItems: 'center', background: 'rgba(20,14,10,0.75)', color: element.color, fontSize: 12, fontWeight: 900 }}>
            {element.label}
          </div>
          <div className="truncate" style={{ fontFamily: C.serif, fontWeight: 900, fontSize: 19, color: '#f7e8c8', textShadow: '0 2px 6px rgba(0,0,0,0.8)', minWidth: 0 }}>
            {state.raid.boss_name}
          </div>
          <div style={{ fontFamily: C.num, fontWeight: 600, fontSize: 12, letterSpacing: '0.14em', color: C.gold, border: '1px solid rgba(201,164,90,0.55)', borderRadius: 2, padding: '1px 6px', flex: 'none' }}>
            PHASE {state.raid.phase?.phase_no ?? 1}
          </div>
          {enrage ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
              <span style={{ width: 24, height: 24, borderRadius: 3, border: '1px solid #ff7a3a', background: 'rgba(70,14,6,0.85)', display: 'grid', placeItems: 'center', color: '#ffa060' }}>{Icon.flame(14)}</span>
              <span style={{ fontFamily: C.num, fontWeight: 700, fontSize: 13, color: '#ffb48a' }}>광폭 ×{Number(combat.enrage_boss_damage_multiplier ?? 1).toFixed(1)}</span>
            </div>
          ) : null}
          {groggyActive ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
              <span style={{ width: 24, height: 24, borderRadius: 3, border: '1px solid #7fe3f2', background: 'rgba(8,48,62,0.9)', display: 'grid', placeItems: 'center', color: '#bff6ff', boxShadow: '0 0 10px rgba(127,227,242,0.7)' }}>{Icon.burst(14)}</span>
              <span style={{ fontFamily: C.num, fontWeight: 700, fontSize: 13, color: '#bff6ff' }}>그로기 ×{Number(combat.groggy_damage_multiplier ?? 1).toFixed(1)} · {groggySeconds.toFixed(1)}초</span>
            </div>
          ) : null}
          <div style={{ flex: 1 }} />
          <div style={{ fontFamily: C.num, fontWeight: 700, fontSize: 24, lineHeight: 1, color: '#fff', textShadow: '0 2px 4px rgba(0,0,0,0.8)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
            {(ratio * 100).toFixed(1)}%
          </div>
        </div>
        <div style={{ marginTop: 7 }}>
          <Bar ratio={ratio} ghost={ghost} height={14} fill="linear-gradient(90deg,#7e1010 0%,#c9321a 55%,#ff8a2a 100%)" />
        </div>
        <div style={{ marginTop: 3, textAlign: 'right', fontFamily: C.num, fontWeight: 500, fontSize: 13, color: '#cfd5de', fontVariantNumeric: 'tabular-nums' }}>
          {formatNumber(hp)} / {formatNumber(Number(state.raid.max_hp))}
        </div>
        {cast ? (
          <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#ff6a55', display: 'grid' }}>{Icon.bolt(15)}</span>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#ffd6cc', whiteSpace: 'nowrap' }}>{cast.name}</div>
            <div style={{ flex: 1 }}>
              <Bar ratio={cast.total > 0 ? 1 - cast.seconds / cast.total : 1} height={9} ticks={false} border="rgba(255,90,74,0.6)" fill="linear-gradient(90deg,#d4321f,#ff7a45 70%,#ffc35c)" />
            </div>
            <div style={{ fontFamily: C.num, fontWeight: 700, fontSize: 17, color: '#ffe08a', fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'right' }}>
              {cast.seconds.toFixed(1)}<span style={{ fontSize: 12, marginLeft: 1 }}>초</span>
            </div>
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

// ── 기믹 트래커 ──
function HudMechanicTracker({ box, info, seconds, totalSeconds }: {
  box: HudBox; info: HudPatternInfo; seconds: number; totalSeconds: number;
}) {
  const tone = TONE[info.tone];
  const hasProgress = info.current != null && info.max != null && info.max > 0;
  const ratio = hasProgress ? Math.max(0, Math.min(1, (info.current as number) / (info.max as number))) : totalSeconds > 0 ? seconds / totalSeconds : 1;
  return (
    <Frame inline box={box} line={tone.line} className={info.blocking ? 'hud-v3-blink' : undefined} glow={info.blocking ? tone.glow : undefined}>
      <div style={{ padding: '7px 12px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: tone.text, display: 'grid', flex: 'none' }}>{Icon.hex(22)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div className="truncate" style={{ fontSize: 14, fontWeight: 800, color: '#fff', minWidth: 0 }}>{info.title}</div>
            <div style={{ fontFamily: C.num, fontWeight: 600, fontSize: 12, letterSpacing: '0.14em', color: tone.text, flex: 'none' }}>{info.eyebrow}</div>
            <div style={{ flex: 1 }} />
            {hasProgress ? (
              <div style={{ fontFamily: C.num, fontWeight: 500, fontSize: 13, color: '#d8cdee', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
                {formatNumber(info.current as number)} / {formatNumber(info.max as number)}
              </div>
            ) : null}
            <div style={{ fontFamily: C.num, fontWeight: 700, fontSize: 16, color: '#ffe08a', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{seconds.toFixed(1)}초</div>
          </div>
          <div style={{ marginTop: 5 }}>
            <Bar ratio={ratio} height={7} ticks={false} border={tone.line} fill={tone.bar} />
          </div>
        </div>
      </div>
    </Frame>
  );
}

// ── 내 프레임 ──
function HudPlayerFrame({ box, resonance, elementBp, critBp, totalDamage }: {
  box: HudBox; resonance: number; elementBp: number; critBp: number; totalDamage: number;
}) {
  return (
    <Frame box={box} line={C.teamLine}>
      <div style={{ padding: '8px 12px 8px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 40, height: 40, flex: 'none', borderRadius: 3, border: '1px solid rgba(95,212,232,0.7)', background: 'linear-gradient(160deg,#18384f,#0a1826)', display: 'grid', placeItems: 'center', color: C.team }}>
          {Icon.sword(22)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>
            공명력 <b style={{ color: '#fff' }}>{formatNumber(resonance)}</b> · 속성 <b style={{ color: C.team }}>×{(elementBp / 10000).toFixed(2)}</b> · 치명 <b style={{ color: '#ffe08a' }}>{(critBp / 100).toFixed(0)}%</b>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 1 }}>
            <div style={{ fontSize: 11, color: C.muted }}>누적 피해</div>
            <div style={{ fontFamily: C.num, fontWeight: 700, fontSize: 21, lineHeight: 1.1, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(totalDamage)}</div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

// ── 공명방벽 바 ──
function barrierLabel(state: string | null | undefined) {
  if (state === 'STABLE') return '안정';
  if (state === 'CRACKED') return '균열';
  if (state === 'DANGER') return '위험';
  if (state === 'CRITICAL') return '붕괴 직전';
  if (state === 'COLLAPSED') return '붕괴';
  if (state === 'DISABLED') return '비활성';
  return '방어';
}

function HudBarrierBar({ box, combat, nextAttack, inline = false }: {
  box: HudBox;
  combat: RaidBattleState['combat'];
  nextAttack: { name: string; seconds: number } | null;
  inline?: boolean;
}) {
  const ratio = Math.max(0, Math.min(1, Number(combat.barrier_ratio ?? 0)));
  const fill = ratio <= 0.25
    ? 'linear-gradient(90deg,#8e1414,#e0402a 70%,#ff9a7a)'
    : ratio <= 0.5
      ? 'linear-gradient(90deg,#9a5a0c,#f0a43a 70%,#ffe2a0)'
      : 'linear-gradient(90deg,#0e6f9c,#2fc0de 65%,#bff6ff)';
  const ghost = useGhostRatio(ratio);
  return (
    <Frame inline={inline} box={box} line={ratio <= 0.25 ? 'rgba(255,106,85,0.75)' : C.teamLine}>
      <div style={{ padding: '7px 12px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: C.team, display: 'grid' }}>{Icon.shield(16)}</span>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#e9fbff' }}>공명방벽</div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#ffd28a', border: '1px solid rgba(255,190,90,0.6)', borderRadius: 2, padding: '0 5px', lineHeight: '16px' }}>{barrierLabel(combat.barrier_state)}</div>
          <div style={{ flex: 1 }} />
          {nextAttack ? (
            <div style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>
              다음 {nextAttack.name} <b style={{ fontFamily: C.num, color: '#ffe08a', fontSize: 13 }}>{nextAttack.seconds.toFixed(1)}초</b>
            </div>
          ) : null}
          <div style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>출전 {formatNumber(Number(combat.barrier_contributor_count ?? 0))}명</div>
          <div style={{ fontFamily: C.num, fontWeight: 700, fontSize: 19, lineHeight: 1, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{(ratio * 100).toFixed(0)}%</div>
        </div>
        <div style={{ marginTop: 6 }}>
          <Bar ratio={ratio} ghost={ghost} height={11} fill={fill} />
        </div>
      </div>
    </Frame>
  );
}

// ── 전체 HUD v3 ──
export function HudV3Overlay({
  layout,
  state,
  hp,
  hpRatio,
  totalDamage,
  secondsToBossAttack,
  bossAttackTelegraph,
  secondsToPatternEnd,
  groggyActive,
  secondsToGroggyEnd,
  warning,
  battleEnabled,
  guideActive,
  tapHintText,
  nowMs,
  onBack,
  onHub,
}: {
  layout: HudV3Layout;
  state: RaidBattleState;
  hp: number;
  hpRatio: number;
  totalDamage: number;
  secondsToBossAttack: number | null;
  bossAttackTelegraph: boolean;
  secondsToPatternEnd: number | null;
  groggyActive: boolean;
  secondsToGroggyEnd: number;
  warning: HudWarning | null;
  battleEnabled: boolean;
  guideActive: boolean;
  tapHintText: string;
  nowMs: number;
  onBack: () => void;
  onHub: () => void;
}) {
  const combat = state.combat;
  const bossAttack = combat?.boss_attack ?? null;
  const pattern = combat?.active_pattern ?? null;
  const info = pattern && pattern.pattern_type !== 'ENRAGE' ? describeHudPattern(pattern) : null;
  const patternTotal = pattern ? Math.max(0, (new Date(pattern.ends_at).getTime() - new Date(pattern.started_at).getTime()) / 1000) : 0;

  // 타격 안내 한 줄: 전투 시작 10초 · 빗나감 안내 중 · 특별 안내가 필요한 패턴 중에만
  const firstBattleMsRef = useRef<number | null>(null);
  if (battleEnabled && firstBattleMsRef.current == null) firstBattleMsRef.current = nowMs;
  const specialHint = ['ABSORB', 'MULTI_CORE', 'SPLIT_TARGET'].includes(String(pattern?.pattern_type ?? ''));
  const showTapHint = battleEnabled && (
    specialHint || guideActive || (firstBattleMsRef.current != null && nowMs - firstBattleMsRef.current < 10000)
  );

  const cast = bossAttackTelegraph && bossAttack
    ? { name: bossAttack.name, seconds: Math.max(0, secondsToBossAttack ?? 0), total: Math.max(0.1, Number(bossAttack.telegraph_seconds ?? 0)) }
    : null;
  const nextAttack = bossAttack && secondsToBossAttack != null && !cast && state.raid.status === 'ACTIVE'
    ? { name: bossAttack.name, seconds: secondsToBossAttack }
    : null;

  return (
    <>
      <style>{'@keyframes hudV3Blink{0%,100%{opacity:1}50%{opacity:.5}}.hud-v3-blink{animation:hudV3Blink 1.1s ease-in-out infinite}@keyframes hudV3Warn{0%{opacity:0;transform:translate(-50%,8px) scale(.92)}14%{opacity:1;transform:translate(-50%,0) scale(1.04)}24%{transform:translate(-50%,0) scale(1)}82%{opacity:1}100%{opacity:0;transform:translate(-50%,-14px)}}'}</style>

      {info?.blocking ? (
        <div className="pointer-events-none absolute inset-0 z-[25]" style={{ boxShadow: `inset 0 0 110px ${TONE[info.tone].glow}`, opacity: 0.55 }} />
      ) : null}

      <div className="absolute z-40 flex gap-2" style={{ ...layout.nav.style, width: undefined }}>
        <button type="button" onClick={onBack} aria-label="관문으로 돌아가기" title="관문" className="pointer-events-auto grid h-9 w-9 place-items-center rounded-[4px] border border-white/20 bg-[rgba(9,13,24,0.6)] text-[#ece6da] hover:bg-[rgba(9,13,24,0.8)]">
          {Icon.back(18)}
        </button>
        <button type="button" onClick={onHub} aria-label="레이드 허브로 이동" title="레이드 허브" className="pointer-events-auto grid h-9 w-9 place-items-center rounded-[4px] border border-cyan-300/30 bg-[rgba(9,13,24,0.6)] text-cyan-100 hover:bg-[rgba(9,13,24,0.8)]">
          {Icon.hub(18)}
        </button>
      </div>

      {/* 보스 묶음: 트래커는 보스 프레임 바로 아래(C 배치는 바로 위)에 붙고, D 배치는 방벽 바까지 한 기둥으로 쌓는다. */}
      <div
        className="pointer-events-none absolute z-30 flex"
        style={{
          ...layout.boss.style,
          flexDirection: 'column',
          gap: 8,
          alignItems: layout.column ? 'stretch' : layout.bossAlign === 'left' ? 'flex-start' : layout.bossAlign === 'right' ? 'flex-end' : 'center',
        }}
      >
        {layout.preset === 'C' && info && pattern ? (
          <HudMechanicTracker box={layout.tracker} info={info} seconds={secondsToPatternEnd ?? 0} totalSeconds={patternTotal} />
        ) : null}
        <HudBossFrame
          layout={layout}
          state={state}
          hp={hp}
          hpRatio={hpRatio}
          groggyActive={groggyActive}
          groggySeconds={secondsToGroggyEnd}
          cast={cast}
        />
        {layout.preset !== 'C' && info && pattern ? (
          <HudMechanicTracker box={layout.tracker} info={info} seconds={secondsToPatternEnd ?? 0} totalSeconds={patternTotal} />
        ) : null}
        {layout.column && combat?.barrier_enabled ? (
          <HudBarrierBar inline box={layout.barrier} combat={combat} nextAttack={nextAttack} />
        ) : null}
      </div>

      <HudPlayerFrame
        box={layout.player}
        resonance={Number(state.me.raid_power)}
        elementBp={Number(state.me.element_multiplier_bp ?? 10000)}
        critBp={Number(state.me.final_crit_bp)}
        totalDamage={totalDamage}
      />

      {!layout.column && combat?.barrier_enabled ? <HudBarrierBar box={layout.barrier} combat={combat} nextAttack={nextAttack} /> : null}

      {showTapHint ? (
        <div className="pointer-events-none absolute z-30 whitespace-nowrap text-[13px] font-black" style={{ ...layout.tapHint, color: info?.blocking ? '#f3e2ff' : C.ink, textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)' }}>
          {tapHintText}
        </div>
      ) : null}

      {warning ? (
        <div
          key={warning.key}
          role="status"
          className="pointer-events-none absolute z-[45] text-center"
          style={{ ...layout.warning, animation: 'hudV3Warn 1.7s ease-out both' }}
        >
          <div style={{ fontFamily: C.serif, fontWeight: 900, fontSize: 34, lineHeight: 1.15, color: '#fff', letterSpacing: '0.02em', textShadow: `0 0 22px ${TONE[warning.tone].glow}, 0 0 6px ${TONE[warning.tone].glow}, 0 3px 0 rgba(0,0,0,0.85)` }}>
            {warning.text}
          </div>
          <div style={{ marginTop: 4, fontSize: 15, fontWeight: 900, color: '#fff', textShadow: '0 2px 6px rgba(0,0,0,0.95)' }}>{warning.sub}</div>
        </div>
      ) : null}
    </>
  );
}

function formatNumber(value: number) {
  return Math.floor(Number.isFinite(value) ? value : 0).toLocaleString('ko-KR');
}
