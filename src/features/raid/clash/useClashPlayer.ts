// RAID_CLASH_V1_20261028 — 대표 학생(또는 연습 모드)의 키보드 입력 처리
// * PC·크롬북 키보드 전용. 터치·클릭은 격돌 입력으로 받지 않는다.
// * event.code(KeyQ/KeyW/KeyE/KeyR)로 판별 → 한글 입력 상태·Caps Lock과 무관.
// * 키 반복(event.repeat)과 한 노트 연타는 한 번만 판정.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { RaidClashJudgment, RaidClashKeyCode, RaidClashProfile } from '@/lib/rpc/raid_student_rpc';
import {
  CLASH_KEYS,
  activeClashNote,
  clashEventMs,
  clashNowMs,
  expiredClashNotes,
  judgeClash,
  type LocalClashNote,
} from './clashCore';
import type { ClashStageJudgment } from './ClashStage';

export interface ClashJudgedInput {
  note: LocalClashNote;
  judgment: RaidClashJudgment;
  keyCode: RaidClashKeyCode | null;
  offsetMs: number | null;
}

export function useClashPlayer({
  active,
  notes,
  profile,
  onJudged,
}: {
  active: boolean;
  notes: LocalClashNote[];
  profile: Pick<RaidClashProfile, 'approach_ms' | 'perfect_ms' | 'good_ms' | 'bad_ms'>;
  onJudged: (input: ClashJudgedInput) => void;
}) {
  const [judgments, setJudgments] = useState<Partial<Record<number, ClashStageJudgment>>>({});
  const judgedRef = useRef<Partial<Record<number, RaidClashJudgment>>>({});
  const notesRef = useRef(notes);
  const profileRef = useRef(profile);
  const onJudgedRef = useRef(onJudged);
  notesRef.current = notes;
  profileRef.current = profile;
  onJudgedRef.current = onJudged;

  const record = useCallback((note: LocalClashNote, judgment: RaidClashJudgment, keyCode: RaidClashKeyCode | null, offsetMs: number | null) => {
    if (judgedRef.current[note.index]) return;
    judgedRef.current = { ...judgedRef.current, [note.index]: judgment };
    setJudgments((current) => ({ ...current, [note.index]: { judgment, atMs: clashNowMs() } }));
    onJudgedRef.current({ note, judgment, keyCode, offsetMs });
  }, []);

  /** 서버가 확정한 판정으로 덮어쓴다(드물게 화면 판정과 다를 때). */
  const applyServerJudgment = useCallback((index: number, judgment: RaidClashJudgment) => {
    if (judgedRef.current[index] === judgment) return;
    judgedRef.current = { ...judgedRef.current, [index]: judgment };
    setJudgments((current) => ({ ...current, [index]: { judgment, atMs: current[index]?.atMs ?? clashNowMs() } }));
  }, []);

  const reset = useCallback(() => {
    judgedRef.current = {};
    setJudgments({});
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const code = event.code as RaidClashKeyCode;
      if (!CLASH_KEYS.includes(code)) return;
      // 글자 입력칸(이름·메모 등)에 타이핑 중인 키는 가로채지 않는다.
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const at = clashEventMs(event);
      const note = activeClashNote(at, notesRef.current, judgedRef.current, profileRef.current);
      if (!note) return;
      const offset = Math.round(at - note.idealMs);
      // BAD 창 밖(너무 이른) 입력은 무시한다. 연타해도 가장 이른 인정 입력은 BAD라 이득이 없다.
      if (Math.abs(offset) > profileRef.current.bad_ms) return;
      const judgment = code === note.key ? judgeClash(offset, profileRef.current) : 'MISS';
      record(note, judgment, code, offset);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [active, record]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      const expired = expiredClashNotes(clashNowMs(), notesRef.current, judgedRef.current, profileRef.current);
      for (const note of expired) record(note, 'MISS', null, null);
    }, 50);
    return () => window.clearInterval(timer);
  }, [active, record]);

  return { judgments, applyServerJudgment, reset };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
}
