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
import { Glyph, PrefButtons, useFullscreen, useToolboxPrefs, type GlyphName } from '../ui';
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

/** 전체 화면에서도 같은 무대를 쓰도록 감싼다. */
export function StageShell({ fs, prefs, children, tall, corner }: {
  fs: ReturnType<typeof useFullscreen<HTMLDivElement>>; prefs: ReturnType<typeof useToolboxPrefs>;
  children: ReactNode; tall?: boolean; corner?: ReactNode;
}) {
  return (
    <div ref={fs.ref} className="tbx" data-reduce-motion={prefs.reduceMotion}
      style={fs.on ? { background: 'var(--tbx-deep)', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '3vh 3vw', overflow: 'auto' } : undefined}>
      <div className={tall || fs.on ? 'tbx-stage tbx-stage--tall' : 'tbx-stage'} style={fs.on ? { minHeight: '86vh', border: 0 } : undefined}>
        {corner && <div className="tbx-stage__corner">{corner}</div>}
        {children}
      </div>
    </div>
  );
}
