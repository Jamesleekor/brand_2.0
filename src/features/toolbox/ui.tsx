// =====================================================================
// 모험가 도구함 — 공통 화면 부품
// =====================================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useToastStore } from '@/stores/ui_store';
import { toToolboxError, type ToolboxError } from './toolbox_rpc';
import type { ClassActivityKind, PersonalToolId } from './toolbox_types';

// ---------------------------------------------------------------------
// 도구 문양 (황동 선 그림). 이모지 대신 도구함 전용 문양을 쓴다.
// ---------------------------------------------------------------------
export type GlyphName = PersonalToolId | Lowercase<ClassActivityKind> | 'kit' | 'stopwatch' | 'signal';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function Glyph({ name, size }: { name: GlyphName; size?: 'lg' }) {
  return (
    <span className={size === 'lg' ? 'tbx-glyph tbx-glyph--lg' : 'tbx-glyph'} aria-hidden="true">
      <svg viewBox="0 0 24 24">{GLYPHS[name]}</svg>
    </span>
  );
}

const GLYPHS: Record<GlyphName, ReactNode> = {
  lottery: <g {...P}><path d="M7 4h10l-1.5 16h-7z" /><path d="M9.5 4l.5-1.5h4l.5 1.5" /><path d="M10 9l1 6M14 9l-1 6" /></g>,
  ladder: <g {...P}><path d="M7 3v18M17 3v18" /><path d="M7 7h10M7 12h10M7 17h10" /></g>,
  roulette: <g {...P}><circle cx="12" cy="13" r="8" /><circle cx="12" cy="13" r="2" /><path d="M12 5v6M18.9 9l-5.2 3M18.9 17l-5.2-3M5.1 9l5.2 3" /><path d="M10.5 2.5h3L12 5z" fill="currentColor" /></g>,
  order: <g {...P}><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4.5 5l1.5-1v4M4 12.5c.4-.9 2.2-1.1 2.2.2 0 1-2.2 1.6-2.2 2.8h2.4" /><path d="M4 17.2c.5-.6 2.2-.6 2.2.5 0 .7-.8.9-1.2.9.6 0 1.4.3 1.4 1 0 1.2-1.9 1.1-2.4.5" /></g>,
  timer: <g {...P}><circle cx="12" cy="13.5" r="7.5" /><path d="M12 13.5V9.5M12 13.5l3 2" /><path d="M10 2.5h4M12 2.5v3.5" /><path d="M18.5 6l1.5-1.5" /></g>,
  stopwatch: <g {...P}><circle cx="12" cy="13.5" r="7.5" /><path d="M12 13.5l3.5-3.5" /><path d="M10 2.5h4M12 2.5v3.5" /></g>,
  teams: <g {...P}><circle cx="8" cy="8" r="2.5" /><circle cx="16" cy="8" r="2.5" /><path d="M3.5 18c.4-3 2.2-4.5 4.5-4.5s4.1 1.5 4.5 4.5M11.5 18c.4-3 2.2-4.5 4.5-4.5s4.1 1.5 4.5 4.5" /></g>,
  buzzer: <g {...P}><path d="M5 17h14" /><path d="M7 17a5 5 0 0 1 10 0" /><path d="M12 9V6M7.5 10.5L5.5 8.5M16.5 10.5l2-2" /><path d="M4 20h16" /></g>,
  scoreboard: <g {...P}><rect x="3.5" y="5" width="17" height="13" rx="2" /><path d="M12 5v13" /><path d="M7 10v4M15.5 10h2.5v1.8h-2.5V14h2.5" /></g>,
  tournament: <g {...P}><path d="M3 5h5v4H3zM3 15h5v4H3z" /><path d="M8 7h3v10H8M11 12h4" /><path d="M15 10h6v4h-6z" /></g>,
  vote: <g {...P}><path d="M4 14l4-9h8l4 9" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M9.5 9.5l2 2 3.5-4" /></g>,
  cards: <g {...P}><rect x="3" y="6" width="9" height="6" rx="1.5" transform="rotate(-6 7.5 9)" /><rect x="12" y="4" width="9" height="6" rx="1.5" transform="rotate(5 16.5 7)" /><rect x="7" y="13" width="10" height="6.5" rx="1.5" /></g>,
  kit: <g {...P}><rect x="3" y="8" width="18" height="12" rx="2.5" /><path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2" /><path d="M3 13h18" /><path d="M10.5 13v2h3v-2" /></g>,
  signal: <g {...P}><path d="M3 12h3l2-5 3 10 3-7 2 2h5" /></g>,
};

// ---------------------------------------------------------------------
// 입력 부품
// ---------------------------------------------------------------------
export function Seg<T extends string>({ value, options, onChange, block, label }: {
  value: T; options: readonly { value: NoInfer<T>; label: string }[]; onChange: (v: NoInfer<T>) => void; block?: boolean; label?: string;
}) {
  return (
    <div className={block ? 'tbx-seg tbx-seg--block' : 'tbx-seg'} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, title, hint, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; title: string; hint?: string; disabled?: boolean;
}) {
  return (
    <div
      className="tbx-toggle" role="switch" aria-checked={checked} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
      onClick={() => { if (!disabled) onChange(!checked); }}
      onKeyDown={(e) => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onChange(!checked); } }}
    >
      <span className="tbx-toggle__text">
        <span className="tbx-h3" style={{ display: 'block', fontSize: 14 }}>{title}</span>
        {hint && <span className="tbx-small" style={{ display: 'block' }}>{hint}</span>}
      </span>
      <span className="tbx-toggle__switch" />
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 9999, step = 1, label, suffix }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label?: string; suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && text.trim() !== '') onChange(clamp(Math.round(n)));
    else setText(String(value));
  };
  return (
    <span className="tbx-stepper">
      <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--square" aria-label={`${label ?? ''} 줄이기`} onClick={() => onChange(clamp(value - step))} disabled={value <= min}>−</button>
      <input className="tbx-input tbx-input--num" inputMode="numeric" aria-label={label} value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9-]/g, ''))} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }} />
      <button type="button" className="tbx-btn tbx-btn--sm tbx-btn--square" aria-label={`${label ?? ''} 늘리기`} onClick={() => onChange(clamp(value + step))} disabled={value >= max}>+</button>
      {suffix && <span className="tbx-small" style={{ fontWeight: 800 }}>{suffix}</span>}
    </span>
  );
}

export function Notice({ children, tone, icon }: { children: ReactNode; tone?: 'ember' | 'signal'; icon?: string }) {
  return (
    <div className={tone ? `tbx-notice tbx-notice--${tone}` : 'tbx-notice'} role={tone === 'ember' ? 'alert' : undefined}>
      {icon && <span className="tbx-notice__icon" aria-hidden="true">{icon}</span>}
      <div>{children}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="tbx tbx-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={wide ? 'tbx-modal tbx-modal--wide' : 'tbx-modal'} role="dialog" aria-modal="true" aria-label={title}>
        <div className="tbx-row tbx-row--between" style={{ marginBottom: 14 }}>
          <h2 className="tbx-h2">{title}</h2>
          <button type="button" className="tbx-btn tbx-btn--ghost tbx-btn--sm tbx-btn--square" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        {children}
        {footer && <div className="tbx-row" style={{ justifyContent: 'flex-end', marginTop: 18, gap: 8, flexWrap: 'wrap' }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** 되돌리기 어려운 동작을 확인받는다. */
export function useConfirm() {
  const [req, setReq] = useState<{ title: string; body: ReactNode; confirm: string; danger?: boolean; resolve: (ok: boolean) => void } | null>(null);
  const ask = useCallback((title: string, body: ReactNode, confirm = '확인', danger = false) =>
    new Promise<boolean>((resolve) => setReq({ title, body, confirm, danger, resolve })), []);
  const close = (ok: boolean) => { req?.resolve(ok); setReq(null); };
  const dialog = (
    <Modal open={!!req} onClose={() => close(false)} title={req?.title ?? ''}
      footer={<>
        <button type="button" className="tbx-btn" onClick={() => close(false)}>취소</button>
        <button type="button" className={req?.danger ? 'tbx-btn tbx-btn--danger' : 'tbx-btn tbx-btn--brass'} onClick={() => close(true)}>{req?.confirm}</button>
      </>}>
      <div className="tbx-body" style={{ color: 'var(--tbx-ivory)' }}>{req?.body}</div>
    </Modal>
  );
  return { ask, dialog };
}

/** 서버 동작 실행: 진행 중 표시, 실패 시 알림과 화면 안 오류를 함께 준다. */
export function useAction() {
  const show = useToastStore((s) => s.show);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ToolboxError | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, success?: string): Promise<T | null> => {
    setBusy(key);
    setError(null);
    try {
      const result = await fn();
      if (success) show({ title: success, variant: 'success', duration: 1800 });
      return result;
    } catch (e) {
      const err = toToolboxError(e);
      setError(err);
      show({ title: err.title, description: err.message, variant: 'error', duration: 4200 });
      return null;
    } finally {
      setBusy(null);
    }
  }, [show]);
  return { run, busy, error, clearError: () => setError(null) };
}

export function InlineError({ error }: { error: ToolboxError | null }) {
  if (!error) return null;
  return <p className="tbx-field-error" role="alert">{error.title}: {error.message}</p>;
}

// ---------------------------------------------------------------------
// 소리 · 움직임 · 전체 화면
// ---------------------------------------------------------------------
const SOUND_KEY = 'brand.toolbox.sound';
const MOTION_KEY = 'brand.toolbox.reduceMotion';

function readFlag(key: string, fallback: boolean) {
  try { const v = window.localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
}
function writeFlag(key: string, value: boolean) {
  try { window.localStorage.setItem(key, value ? '1' : '0'); } catch { /* 저장 실패해도 동작은 계속 */ }
}

let audioCtx: AudioContext | null = null;
function tone(freq: number, ms: number, type: OscillatorType = 'sine', gain = 0.06, delay = 0) {
  try {
    audioCtx = audioCtx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
    const t0 = audioCtx.currentTime + delay / 1000;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  } catch { /* 소리를 못 내는 기기에서는 조용히 넘어간다 */ }
}

export const SOUNDS = {
  tick: () => tone(1250, 40, 'square', 0.02),
  reveal: () => { tone(660, 120, 'triangle', 0.06); tone(990, 220, 'triangle', 0.06, 110); },
  win: () => { tone(523, 140, 'triangle', 0.07); tone(659, 140, 'triangle', 0.07, 120); tone(784, 320, 'triangle', 0.07, 240); },
  buzz: () => tone(330, 160, 'sawtooth', 0.05),
  lock: () => { tone(220, 120, 'square', 0.04); tone(180, 200, 'square', 0.04, 120); },
  alarm: () => { [0, 380, 760].forEach((d) => { tone(880, 180, 'square', 0.05, d); tone(660, 160, 'square', 0.05, d + 190); }); },
};

export function useToolboxPrefs() {
  const [sound, setSoundState] = useState(() => readFlag(SOUND_KEY, true));
  const [reduceMotion, setReduceState] = useState(() => readFlag(MOTION_KEY, false));
  const setSound = (v: boolean) => { setSoundState(v); writeFlag(SOUND_KEY, v); };
  const setReduceMotion = (v: boolean) => { setReduceState(v); writeFlag(MOTION_KEY, v); };
  const play = useCallback((name: keyof typeof SOUNDS) => { if (readFlag(SOUND_KEY, true)) SOUNDS[name](); }, []);
  return { sound, setSound, reduceMotion, setReduceMotion, play };
}

export function PrefButtons({ prefs, motion = true }: { prefs: ReturnType<typeof useToolboxPrefs>; motion?: boolean }) {
  return (
    <>
      <button type="button" className="tbx-btn tbx-btn--sm" aria-pressed={prefs.sound} onClick={() => prefs.setSound(!prefs.sound)}
        title={prefs.sound ? '소리 끄기' : '소리 켜기'}>{prefs.sound ? '🔊 소리' : '🔇 소리 끔'}</button>
      {motion && (
        <button type="button" className="tbx-btn tbx-btn--sm" aria-pressed={prefs.reduceMotion} onClick={() => prefs.setReduceMotion(!prefs.reduceMotion)}
          title="연출을 짧게 하고 결과를 바로 보여줘요">{prefs.reduceMotion ? '⏩ 빠른 결과' : '✨ 연출'}</button>
      )}
    </>
  );
}

export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const onChange = () => setOn(document.fullscreenElement === ref.current && !!ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await ref.current?.requestFullscreen();
    } catch { /* 전체 화면을 막은 브라우저에서는 그대로 둔다 */ }
  }, []);
  return { ref, on, toggle };
}

// ---------------------------------------------------------------------
// 팀 색상 — 어두운 글자와 밝은 글자 모두 읽히는 8색
// ---------------------------------------------------------------------
export const TEAM_COLORS = ['#E8706A', '#F2B544', '#63D9C9', '#7AA7FF', '#BBA4FF', '#8FD16A', '#FF8FC2', '#E9E1D3'];
export const TEAM_COLOR_NAMES = ['산호', '호박', '청록', '하늘', '보라', '풀잎', '분홍', '상아'];

export function colorAt(i: number) { return TEAM_COLORS[i % TEAM_COLORS.length]; }

// ---------------------------------------------------------------------
// 공정한 무작위 (암호학적 난수, 편향 없는 정수)
// ---------------------------------------------------------------------
export function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  let x: number;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % maxExclusive;
}

export function shuffle<T>(items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function formatClock(totalMs: number, withTenths = false): string {
  const ms = Math.max(0, totalMs);
  const total = withTenths ? Math.floor(ms / 100) : Math.ceil(ms / 1000);
  const sec = withTenths ? Math.floor(total / 10) : total;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const base = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return withTenths ? `${base}.${total % 10}` : base;
}

export const KIND_LABEL: Record<ClassActivityKind, string> = {
  BUZZER: '선착순 버저', SCOREBOARD: '팀 점수판', TOURNAMENT: '토너먼트 대진표', VOTE: '투표', CARDS: '발표 카드 구름',
};
export const KIND_GLYPH: Record<ClassActivityKind, GlyphName> = {
  BUZZER: 'buzzer', SCOREBOARD: 'scoreboard', TOURNAMENT: 'tournament', VOTE: 'vote', CARDS: 'cards',
};

/** 학생 화면의 '운영국' 기준 한국어 시간 표현 */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
