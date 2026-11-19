// RAID_INSCRIPTION_V1_20261118 — 주문 각인 키보드 입력 처리(실전 · 연습 공용)
// * 크롬북 키보드 전용. event.code로 읽으므로 한글 입력 상태여도 A~Z가 그대로 들어온다.
// * 키를 꾹 누르고 있을 때 생기는 반복 입력(event.repeat)과 Ctrl/Alt 조합은 무시한다.
// * 틀리면(화면에 없는 알파벳 포함) 0.4초 잠깐 멈췄다가 "새 문자열"로 처음부터 다시 친다.
// * 문자열 하나를 끝까지 맞게 치면 onComplete를 한 번 부른다. 성공 판정은 서버(또는 연습 모드)가 한다.
import { useCallback, useEffect, useRef, useState } from 'react';

import { INSCRIPTION_DEFAULTS, inscriptionLetterFromEvent } from './inscriptionCore';

export interface InscriptionWrongKey {
  /** 틀린 칸 위치(0부터) */
  pos: number;
  key: string;
  at: number;
}

export interface InscriptionTypingState {
  attemptIndex: number;
  typedCount: number;
  mistakes: number;
  wrong: InscriptionWrongKey | null;
  done: boolean;
}

export function useInscriptionTyping({
  active,
  resetKey,
  sequences,
  missLockMs = INSCRIPTION_DEFAULTS.missLockMs,
  initialAttempt = 0,
  initialMistakes = 0,
  onProgress,
  onComplete,
}: {
  /** true일 때만 키를 받는다 */
  active: boolean;
  /** 이 값이 바뀌면 처음 상태로 돌아간다(새 각인 · 새 연습 판) */
  resetKey: string | number;
  /** 문자열 묶음(보통 40개). n번째 시도는 sequences[n % 40]을 친다(서버와 같은 규칙) */
  sequences: string[] | null | undefined;
  missLockMs?: number;
  initialAttempt?: number;
  initialMistakes?: number;
  onProgress?: (attemptIndex: number, typedCount: number) => void;
  onComplete: (attemptIndex: number, sequence: string) => void;
}) {
  const makeInitial = (): InscriptionTypingState => ({
    attemptIndex: Math.max(0, initialAttempt),
    typedCount: 0,
    mistakes: Math.max(0, initialMistakes),
    wrong: null,
    done: false,
  });
  const [state, setStateRaw] = useState<InscriptionTypingState>(makeInitial);
  const stateRef = useRef(state);
  const sequencesRef = useRef(sequences);
  const lockTimerRef = useRef<number | null>(null);
  const callbacksRef = useRef({ onProgress, onComplete });
  callbacksRef.current = { onProgress, onComplete };
  sequencesRef.current = sequences;

  const setState = useCallback((next: InscriptionTypingState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  // 새 각인/새 연습 판이 시작되면 처음부터
  const initialRef = useRef({ initialAttempt, initialMistakes });
  initialRef.current = { initialAttempt, initialMistakes };
  useEffect(() => {
    if (lockTimerRef.current != null) window.clearTimeout(lockTimerRef.current);
    lockTimerRef.current = null;
    setState({
      attemptIndex: Math.max(0, initialRef.current.initialAttempt),
      typedCount: 0,
      mistakes: Math.max(0, initialRef.current.initialMistakes),
      wrong: null,
      done: false,
    });
  }, [resetKey, setState]);

  useEffect(() => () => {
    if (lockTimerRef.current != null) window.clearTimeout(lockTimerRef.current);
  }, []);

  const sequenceFor = (attemptIndex: number): string | null => {
    const pool = sequencesRef.current;
    if (!pool || pool.length === 0) return null;
    return pool[attemptIndex % pool.length] ?? null;
  };

  /** 틀린 뒤 잠깐 멈췄다가 다음 문자열로 넘어간다 */
  const moveToNextAttempt = useCallback(() => {
    const current = stateRef.current;
    const next = { ...current, attemptIndex: current.attemptIndex + 1, typedCount: 0, wrong: null, done: false };
    setState(next);
    callbacksRef.current.onProgress?.(next.attemptIndex, 0);
  }, [setState]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const letter = inscriptionLetterFromEvent(event);
      if (!letter) return;
      event.preventDefault();
      if (event.repeat) return;
      const current = stateRef.current;
      if (current.done || current.wrong) return;
      const sequence = sequenceFor(current.attemptIndex);
      if (!sequence) return;

      if (letter === sequence[current.typedCount]) {
        const typedCount = current.typedCount + 1;
        if (typedCount >= sequence.length) {
          setState({ ...current, typedCount, done: true });
          callbacksRef.current.onComplete(current.attemptIndex, sequence);
        } else {
          setState({ ...current, typedCount });
          callbacksRef.current.onProgress?.(current.attemptIndex, typedCount);
        }
        return;
      }

      // 오타: 틀린 칸을 빨갛게 보여 주고 잠깐 멈춘 뒤 새 문자열로
      setState({ ...current, mistakes: current.mistakes + 1, wrong: { pos: current.typedCount, key: letter, at: Date.now() } });
      if (lockTimerRef.current != null) window.clearTimeout(lockTimerRef.current);
      lockTimerRef.current = window.setTimeout(() => {
        lockTimerRef.current = null;
        moveToNextAttempt();
      }, Math.max(0, missLockMs));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // sequenceFor는 ref만 읽으므로 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, missLockMs, moveToNextAttempt, setState]);

  /** 서버가 완성 문자열을 받아 주지 않았을 때(드문 경우): 다음 문자열로 이어서 친다 */
  const continueAfterReject = useCallback(() => {
    if (!stateRef.current.done) return;
    moveToNextAttempt();
  }, [moveToNextAttempt]);

  /** 새로고침 뒤 다시 들어온 경우 등: 서버가 기억하는 시도 번호가 더 크면 그쪽으로 맞춘다 */
  const syncFromServer = useCallback((attemptIndex: number, mistakes: number) => {
    const current = stateRef.current;
    if (current.done || attemptIndex <= current.attemptIndex) return;
    setState({ ...current, attemptIndex, mistakes: Math.max(current.mistakes, mistakes), typedCount: 0, wrong: null });
  }, [setState]);

  const sequence = sequenceFor(state.attemptIndex);
  return { ...state, sequence, continueAfterReject, syncFromServer };
}
