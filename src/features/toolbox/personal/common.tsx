// =====================================================================
// 개인 도구 공통 — 머리말, 기기 안 임시 보관, 준비 패널
// ---------------------------------------------------------------------
// 개인 도구는 서버에 저장하지 않는다. 같은 기기에서 새로고침했을 때
// 이어 볼 수 있도록 이 기기 안(localStorage)에만 잠시 보관한다.
// 보관이 안 되는 환경에서도 도구는 정상 작동한다.
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ParticipantPicker, PickerSummary, type PickerOptions } from '../ParticipantPicker';
import { buildUnits, useClassRoster, type ClassRoster } from '../roster';
import { toolboxRpc } from '../toolbox_rpc';
import { Glyph, Modal, Notice, PrefButtons, useFullscreen, useToolboxPrefs, type GlyphName } from '../ui';
import type { PersonalToolId, RosterItem, Unit } from '../toolbox_types';

export interface PersonalToolProps {
  client: SupabaseClient;
  classroomId: number | null;
  audience: 'student' | 'teacher';
  /** 기기 안 보관 키를 사람마다 나누기 위한 값 */
  ownerKey: string;
  /** 교사 팀 만들기 → 학급 활동으로 보내기 */
  onSendTeams?: (target: 'SCOREBOARD' | 'TOURNAMENT' | 'BUZZER', teams: RosterItem[]) => void;
  /** 순서 정하기 등에서 다른 개인 도구로 이동 */
  onOpenTool?: (tool: PersonalToolId) => void;
}

export const PERSONAL_TOOLS: { id: PersonalToolId; name: string; desc: string; glyph: GlyphName }[] = [
  { id: 'lottery', name: '제비뽑기', desc: '가려진 제비를 골라 결과를 확인해요', glyph: 'lottery' },
  { id: 'ladder', name: '사다리타기', desc: '사람과 결과를 사다리로 한 명씩 이어요', glyph: 'ladder' },
  { id: 'roulette', name: '룰렛', desc: '모두 같은 확률로 한 명을 골라요', glyph: 'roulette' },
  { id: 'order', name: '순서 정하기', desc: '모두의 발표 순서를 한 번에 정해요', glyph: 'order' },
  { id: 'timer', name: '타이머·스톱워치', desc: '남은 시간과 걸린 시간을 크게 보여줘요', glyph: 'timer' },
  { id: 'teams', name: '팀 만들기', desc: '정한 인원으로 팀을 고르게 나눠요', glyph: 'teams' },
];

// ---------------------------------------------------------------------
// 기기 안 임시 보관
// ---------------------------------------------------------------------
export function useLocalState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void, () => void] {
  const read = (): T => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch { return initial; }
  };
  const [state, setState] = useState<T>(read);
  const keyRef = useRef(key);
  useEffect(() => { if (keyRef.current !== key) { keyRef.current = key; setState(read()); } }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState((prev) => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* 보관 실패는 무시 */ }
      return value;
    });
  }, [key]);
  const clear = useCallback(() => {
    try { window.localStorage.removeItem(key); } catch { /* 무시 */ }
    setState(initial);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [state, set, clear];
}

// ---------------------------------------------------------------------
// 화면 머리말
// ---------------------------------------------------------------------
export function ToolHeader({ tool, right }: { tool: PersonalToolId; right?: ReactNode }) {
  const meta = PERSONAL_TOOLS.find((t) => t.id === tool)!;
  return (
    <div className="tbx-row tbx-row--between tbx-row--wrap" style={{ gap: 12 }}>
      <div className="tbx-hero">
        <Glyph name={meta.glyph} size="lg" />
        <div>
          <h1 className="tbx-h1">{meta.name}</h1>
          <p className="tbx-small">{meta.desc}</p>
        </div>
      </div>
      {right && <div className="tbx-row tbx-row--wrap" style={{ gap: 6 }}>{right}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------
// 참가자 준비 — 펼침/접힘
// ---------------------------------------------------------------------
export function useParticipants(props: PersonalToolProps, tool: PersonalToolId) {
  const { roster } = useClassRoster(props.client, props.classroomId, props.audience === 'teacher');
  const [items, setItems] = useLocalState<RosterItem[]>(`brand.toolbox.${props.ownerKey}.${tool}.items`, []);
  const units = useMemo(() => buildUnits(items, roster), [items, roster]);
  return { roster, items, setItems, units };
}

export function ParticipantSection({ props, roster, items, setItems, units, options, locked, onUnlock, title = '참가자' }: {
  props: PersonalToolProps; roster: ClassRoster | null; items: RosterItem[]; setItems: (v: RosterItem[]) => void; units: Unit[];
  options?: PickerOptions; locked?: boolean; onUnlock?: () => void; title?: string;
}) {
  return (
    <section className="tbx-panel tbx-stack">
      <h2 className="tbx-h2">{title}</h2>
      {locked
        ? <PickerSummary units={units} onEdit={() => onUnlock?.()} />
        : <ParticipantPicker client={props.client} classroomId={props.classroomId} roster={roster} value={items} onChange={setItems}
            options={{ teacher: props.audience === 'teacher', ...options }} />}
    </section>
  );
}

/** 교사가 개인 도구를 시작하면 최근 명단으로 남긴다(최근 5개만 유지). */
export function rememberRecent(props: PersonalToolProps, name: string, items: RosterItem[]) {
  if (props.audience !== 'teacher' || items.length === 0) return;
  void toolboxRpc.saveRoster(props.client, name.slice(0, 40), items, true).catch(() => undefined);
}

export function useToolChrome() {
  const prefs = useToolboxPrefs();
  const fs = useFullscreen<HTMLDivElement>();
  const chrome = (
    <>
      <PrefButtons prefs={prefs} />
      <button type="button" className="tbx-btn tbx-btn--sm" onClick={() => void fs.toggle()}>{fs.on ? '전체 화면 끝내기' : '⛶ 전체 화면'}</button>
    </>
  );
  return { prefs, fs, chrome };
}

/** 전체 화면에서도 같은 무대를 쓰도록 감싼다.
 *  dock(조작줄)을 주면 무대 바로 위에 놓고, 전체 화면에서도 함께 보인다.
 *  fill이면 무대가 남은 화면 높이를 채운다(설정 패널 없이 무대가 주인공). */
export function StageShell({ fs, prefs, children, tall, fill, corner, dock, below, bare }: {
  fs: ReturnType<typeof useFullscreen<HTMLDivElement>>; prefs: ReturnType<typeof useToolboxPrefs>;
  children: ReactNode; tall?: boolean; fill?: boolean; corner?: ReactNode; dock?: ReactNode; below?: ReactNode;
  /** 무대 배경 없이 내용만 (팀 만들기처럼 카드가 주인공일 때) */
  bare?: boolean;
}) {
  const stageClass = bare ? 'tbx-stage-bare' : ['tbx-stage', (tall || fs.on) && 'tbx-stage--tall', fill && 'tbx-stage--fill'].filter(Boolean).join(' ');
  return (
    <div ref={fs.ref} className="tbx tbx-tool" data-reduce-motion={prefs.reduceMotion} data-fullscreen={fs.on}>
      {dock}
      <div className={stageClass}>
        {fs.on && <div className="tbx-stage__corner"><button type="button" className="tbx-btn tbx-btn--sm" onClick={() => void fs.toggle()}>전체 화면 끝내기</button></div>}
        {!fs.on && corner && <div className="tbx-stage__corner">{corner}</div>}
        {children}
      </div>
      {below}
    </div>
  );
}

// ---------------------------------------------------------------------
// 조작줄 — 설정을 오른쪽 패널 대신 무대 위 한 줄에 모은다.
// 긴 설정(참가자 고르기, 결과 목록)은 칩을 눌러 여는 대화상자로 보낸다.
// ---------------------------------------------------------------------
export function ToolDock({ children, primary }: { children?: ReactNode; primary?: ReactNode }) {
  return (
    <div className="tbx-dock" role="toolbar" aria-label="도구 설정">
      <div className="tbx-dock__items">{children}</div>
      {primary && <div className="tbx-dock__primary">{primary}</div>}
    </div>
  );
}

/** 지금 값을 보여주고 누르면 고칠 수 있는 칩 */
export function DockChip({ icon, label, value, onClick, tone, disabled, title }: {
  icon?: string; label: string; value?: ReactNode; onClick: () => void; tone?: 'ember'; disabled?: boolean; title?: string;
}) {
  return (
    <button type="button" className="tbx-dock-chip" data-tone={tone} onClick={onClick} disabled={disabled} title={title}>
      {icon && <span aria-hidden="true">{icon}</span>}
      <span className="tbx-dock-chip__label">{label}</span>
      {value !== undefined && <span className="tbx-dock-chip__value">{value}</span>}
      <span className="tbx-dock-chip__edit" aria-hidden="true">바꾸기</span>
    </button>
  );
}

/** 조작줄 안의 작은 켜기/끄기 */
export function DockToggle({ checked, onChange, label, disabled, title }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; title?: string;
}) {
  return (
    <button type="button" className="tbx-dock-toggle" role="switch" aria-checked={checked} disabled={disabled} title={title} onClick={() => onChange(!checked)}>
      <span className="tbx-dock-toggle__switch" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

/** 칩 묶음 사이 얇은 구분선 */
export function DockSep() { return <span className="tbx-dock-sep" aria-hidden="true" />; }

/** 참가자 칩 + 고르기 대화상자.
 *  대화상자 안에서는 임시 명단을 고치고, '적용'을 눌러야 실제 명단이 바뀐다.
 *  진행 중인 판이 있으면(locked) 적용할 때 onUnlock으로 판을 처음으로 돌린다.
 *  onUnlock이 false를 돌려주면(확인 창에서 취소) 바꾸지 않는다. */
export function useParticipantEditor({ props, roster, items, setItems, units, options, locked, onUnlock, title = '참가자', disabled }: {
  props: PersonalToolProps; roster: ClassRoster | null; items: RosterItem[]; setItems: (v: RosterItem[]) => void; units: Unit[];
  options?: PickerOptions; locked?: boolean; onUnlock?: () => void | boolean | Promise<void | boolean>; title?: string;
  /** 잠깐 바꿀 수 없을 때(룰렛이 도는 중 등) */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RosterItem[]>(items);
  const show = useCallback(() => { setDraft(items); setOpen(true); }, [items]);
  const word = units.some((u) => u.type !== 'STUDENT') ? '개' : '명';
  const preview = units.slice(0, 3).map((u) => u.label).join(', ') + (units.length > 3 ? ' 외' : '');
  const changed = JSON.stringify(draft) !== JSON.stringify(items);

  const apply = async () => {
    if (!changed) { setOpen(false); return; }
    if (locked && onUnlock) {
      const ok = await onUnlock();
      if (ok === false) return;
    }
    setItems(draft);
    setOpen(false);
  };

  const chip = (
    <DockChip icon="👥" label={title} value={units.length ? `${units.length}${word}` : '비어 있음'} tone={units.length ? undefined : 'ember'}
      title={units.length ? preview : '참가자를 골라 주세요'} onClick={show} disabled={disabled} />
  );
  const modal = (
    <Modal open={open} onClose={() => setOpen(false)} title={title} wide
      footer={<>
        <button type="button" className="tbx-btn tbx-btn--ghost" onClick={() => setOpen(false)}>취소</button>
        <button type="button" className="tbx-btn tbx-btn--brass" onClick={() => void apply()}>{changed ? `이대로 적용 (${draft.length})` : '닫기'}</button>
      </>}>
      {locked && changed && <div style={{ marginBottom: 12 }}><Notice icon="↺">적용하면 지금 진행 중인 판은 처음으로 돌아가요.</Notice></div>}
      <ParticipantPicker client={props.client} classroomId={props.classroomId} roster={roster} value={draft} onChange={setDraft}
        options={{ teacher: props.audience === 'teacher', ...options }} />
    </Modal>
  );
  return { chip, modal, open: show, preview };
}

/** 요소의 실제 너비를 따라간다(사다리처럼 폭에 맞춰 그릴 때). */
export function useElementWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => setWidth(el.clientWidth);
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/** 창 높이(전체 화면 전환·창 크기 변경을 따라간다) */
export function useViewportHeight() {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  useEffect(() => {
    const onResize = () => setH(window.innerHeight);
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onResize);
    return () => { window.removeEventListener('resize', onResize); document.removeEventListener('fullscreenchange', onResize); };
  }, []);
  return h;
}
