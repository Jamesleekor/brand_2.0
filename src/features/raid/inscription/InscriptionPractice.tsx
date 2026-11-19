// RAID_INSCRIPTION_V1_20261118 — 주문 각인 연습 모드
// 서버 없이 브라우저 안에서만 돌아간다(레이드가 없어도 언제든 연습 가능).
// 실전과 같은 규칙: 같은 키 · 같은 글자 수 · 같은 제한 시간, 틀리면 0.4초 멈춘 뒤 새 주문.
// 기록(최고 기록 · 성공 횟수)은 이 기기 브라우저에만 저장한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils/cn';
import InscriptionStage, { INSCRIPTION_STAGE_STYLE } from './InscriptionStage';
import {
  INSCRIPTION_DEFAULTS,
  INSCRIPTION_PRESETS,
  formatSeconds,
  inscriptionKeys,
  makeInscriptionPool,
  type InscriptionPreset,
} from './inscriptionCore';
import { useInscriptionTyping } from './useInscriptionTyping';

const FONT_NUM = "'Barlow Condensed', 'Rajdhani', ui-sans-serif, system-ui, sans-serif";
const FONT_SERIF = "'Noto Serif KR', 'Nanum Myeongjo', serif";
const RECORD_KEY = 'brand.inscriptionPractice.v1';
const COUNTDOWN_MS = INSCRIPTION_DEFAULTS.countdownMs;

type PracticePhase = 'ready' | 'countdown' | 'playing' | 'result';

interface PracticeRecord {
  best: number | null;
  tries: number;
  successes: number;
}
type PracticeRecords = Partial<Record<InscriptionPreset['key'], PracticeRecord>>;

interface PracticeResult {
  success: boolean;
  elapsedMs: number;
  mistakes: number;
  newBest: boolean;
}

function readRecords(): PracticeRecords {
  try {
    const raw = window.localStorage.getItem(RECORD_KEY);
    return raw ? (JSON.parse(raw) as PracticeRecords) : {};
  } catch {
    return {};
  }
}

function writeRecords(records: PracticeRecords) {
  try {
    window.localStorage.setItem(RECORD_KEY, JSON.stringify(records));
  } catch {
    // 저장이 안 돼도 연습은 계속한다.
  }
}

export default function InscriptionPractice({ presets = INSCRIPTION_PRESETS }: { presets?: InscriptionPreset[] }) {
  const [presetKey, setPresetKey] = useState<InscriptionPreset['key']>(presets[0]?.key ?? 'EASY');
  const preset = presets.find((item) => item.key === presetKey) ?? presets[0];
  const [phase, setPhase] = useState<PracticePhase>('ready');
  const [round, setRound] = useState(0);
  const [pool, setPool] = useState<string[] | null>(null);
  const [startAt, setStartAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [records, setRecords] = useState<PracticeRecords>(() => (typeof window === 'undefined' ? {} : readRecords()));
  const finishedRef = useRef(false);

  const deadline = startAt + preset.timeLimitMs;

  // 카운트다운·입력 중에는 0.05초마다 시계를 다시 그린다.
  useEffect(() => {
    if (phase !== 'countdown' && phase !== 'playing') return;
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === 'countdown' && now >= startAt) setPhase('playing');
  }, [now, phase, startAt]);

  const finish = useCallback((success: boolean, elapsedMs: number, mistakes: number) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const previous = records[preset.key] ?? { best: null, tries: 0, successes: 0 };
    const newBest = success && (previous.best == null || elapsedMs < previous.best);
    const nextRecord: PracticeRecord = {
      best: newBest ? elapsedMs : previous.best,
      tries: previous.tries + 1,
      successes: previous.successes + (success ? 1 : 0),
    };
    const nextRecords = { ...records, [preset.key]: nextRecord };
    setRecords(nextRecords);
    writeRecords(nextRecords);
    setResult({ success, elapsedMs, mistakes, newBest });
    setPhase('result');
  }, [preset.key, records]);

  const typing = useInscriptionTyping({
    active: phase === 'playing',
    resetKey: round,
    sequences: pool,
    onComplete: () => {
      finish(true, Math.max(0, Date.now() - startAt), typingMistakesRef.current);
    },
  });
  const typingMistakesRef = useRef(0);
  typingMistakesRef.current = typing.mistakes;

  // 시간 초과
  useEffect(() => {
    if (phase === 'playing' && now >= deadline && !typing.done) finish(false, preset.timeLimitMs, typing.mistakes);
  }, [deadline, finish, now, phase, preset.timeLimitMs, typing.done, typing.mistakes]);

  const start = useCallback(() => {
    finishedRef.current = false;
    setPool(makeInscriptionPool(preset.letterCount, preset.useGh));
    setRound((value) => value + 1);
    setResult(null);
    const t = Date.now();
    setNow(t);
    setStartAt(t + COUNTDOWN_MS);
    setPhase('countdown');
  }, [preset.letterCount, preset.useGh]);

  // 준비·결과 화면에서는 Enter(또는 스페이스)로 바로 시작
  useEffect(() => {
    if (phase !== 'ready' && phase !== 'result') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') {
        event.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, start]);

  const keys = useMemo(() => inscriptionKeys(preset.useGh), [preset.useGh]);
  const record = records[preset.key];
  const timeLeftMs = phase === 'playing' ? Math.max(0, deadline - now) : phase === 'countdown' ? preset.timeLimitMs : null;

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <style>{INSCRIPTION_STAGE_STYLE}</style>

      {/* 난이도 고르기 (입력 중에는 잠금) */}
      <div className="flex flex-wrap justify-center gap-2">
        {presets.map((item) => {
          const selected = item.key === preset.key;
          const locked = phase === 'countdown' || phase === 'playing';
          return (
            <button
              key={item.key}
              type="button"
              disabled={locked}
              onClick={() => {
                setPresetKey(item.key);
                setPhase('ready');
                setResult(null);
              }}
              className={cn(
                'rounded-[12px] border-2 px-4 py-2 text-left transition',
                selected ? 'border-[#ffe08a] bg-[#2a1748]/90 shadow-[0_0_18px_rgba(255,224,138,0.3)]' : 'border-[#2e3a52] bg-[#120e1e]/85 hover:border-[#c9a6ff]/60',
                locked && !selected && 'opacity-40',
              )}
            >
              <div className={cn('text-base font-black', selected ? 'text-[#ffe08a]' : 'text-white')}>{item.label}</div>
              <div className="text-[11px] font-bold text-[#cdbdf0]">{item.note}</div>
            </button>
          );
        })}
      </div>

      <div className="relative flex min-h-[360px] w-full max-w-4xl flex-col items-center justify-center rounded-[14px] border border-[#2e3a52] bg-[#120e1e]/85 px-3 py-6"
        style={{ background: 'radial-gradient(circle at center, rgba(76,29,149,0.35), rgba(18,14,30,0.92) 70%)' }}>
        {phase === 'ready' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="text-4xl font-black text-white" style={{ fontFamily: FONT_SERIF }}>✒ 주문 각인 연습</div>
            <div className="max-w-lg text-sm font-bold leading-6 text-[#e6d9ff]">
              화면에 뜨는 알파벳을 순서대로 키보드로 치세요. 틀리면 잠깐 멈춘 뒤 <b className="text-white">새 주문</b>이 나와요.
              제한 시간 안에 주문 하나를 끝까지 치면 성공! 한글 입력 상태여도 그대로 쳐져요.
            </div>
            <div className="text-sm font-black text-white/85">손가락 위치: 왼손 <b>A S D F</b> · 오른손 <b>J K L</b>{preset.useGh ? ' · 검지로 G H' : ''}</div>
            <button
              type="button"
              onClick={start}
              className="rounded-card-lg border-2 border-[#ffe08a] bg-gradient-to-b from-[#9b5cf6] to-[#4c1d95] px-10 py-4 text-xl font-black text-white shadow-[0_0_30px_rgba(192,107,255,0.55)] hover:scale-[1.03]"
            >
              연습 시작 (Enter)
            </button>
          </div>
        )}

        {phase === 'countdown' && (
          <div className="flex flex-col items-center gap-3">
            <div className="text-sm font-black text-[#e6d9ff]">손가락을 {keys.join(' ')} 위에 올려 두세요</div>
            <div className="text-8xl font-black tabular-nums text-white drop-shadow-[0_0_20px_rgba(255,224,138,0.8)]" style={{ fontFamily: FONT_NUM }}>
              {Math.max(1, Math.ceil((startAt - now) / 1000))}
            </div>
          </div>
        )}

        {phase === 'playing' && (
          <InscriptionStage
            sequence={typing.sequence}
            letterCount={preset.letterCount}
            typedCount={typing.typedCount}
            wrong={typing.wrong}
            done={typing.done}
            mistakes={typing.mistakes}
            attemptIndex={typing.attemptIndex}
            timeLeftMs={timeLeftMs}
            timeLimitMs={preset.timeLimitMs}
            keys={keys}
          />
        )}

        {phase === 'result' && result && (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className={cn('text-5xl font-black', result.success ? 'text-[#ffe08a]' : 'text-[#d4b6ff]')} style={{ fontFamily: FONT_SERIF }}>
              {result.success ? '각인 성공!' : '시간 초과…'}
            </div>
            {result.success ? (
              <div className="text-2xl font-black text-white" style={{ fontFamily: FONT_NUM }}>{formatSeconds(result.elapsedMs, 2)}초</div>
            ) : (
              <div className="text-base font-black text-white/85">{formatSeconds(preset.timeLimitMs, 0)}초 안에 끝까지 치지 못했어요. 천천히, 정확하게!</div>
            )}
            <div className="text-sm font-black text-[#e6d9ff]">오타 {result.mistakes}회{result.mistakes > 0 ? ` · 새 주문 ${result.mistakes}번` : ' · 한 번에 성공!'}</div>
            {result.newBest && <div className="rounded-full border border-[#ffe08a]/70 bg-[#3a2a0a]/80 px-4 py-1 text-sm font-black text-[#ffe08a]">🏅 {preset.label} 최고 기록!</div>}
            <button
              type="button"
              onClick={start}
              className="mt-2 rounded-card-lg border-2 border-[#ffe08a] bg-gradient-to-b from-[#9b5cf6] to-[#4c1d95] px-8 py-3 text-lg font-black text-white hover:scale-[1.03]"
            >
              다시 하기 (Enter)
            </button>
          </div>
        )}
      </div>

      {/* 이 기기의 연습 기록 */}
      <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-black">
        <span className="rounded-full border border-[#2e3a52] bg-[#120e1e]/85 px-3 py-1.5 text-[#cdbdf0]">
          {preset.label} 기록 · 최고 {record?.best != null ? `${formatSeconds(record.best, 2)}초` : '없음'} · 성공 {record?.successes ?? 0} / {record?.tries ?? 0}회
        </span>
        <span className="text-white/50">기록은 이 크롬북에만 저장돼요.</span>
      </div>
    </div>
  );
}
