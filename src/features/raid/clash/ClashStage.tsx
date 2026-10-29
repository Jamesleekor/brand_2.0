// RAID_CLASH_V1_20261028 — 원형 수축 고리 QTE 렌더러 (학생·연습·중계 공용)
// 고정된 파란 판정 고리 + 바깥에서 안쪽으로 줄어드는 고리 + 중앙 키 표시.
// 그리기는 절대 시각 기준으로 계산하므로 프레임이 떨어져도 고리 위치가 어긋나지 않는다.
import { useEffect, useMemo, useState } from 'react';

import type { RaidClashJudgment, RaidClashProfile } from '@/lib/rpc/raid_student_rpc';
import {
  CLASH_JUDGMENT_STYLE,
  CLASH_KEY_LABEL,
  clashNowMs,
  clashRingProgress,
  type LocalClashNote,
} from './clashCore';

export interface ClashStageJudgment {
  judgment: RaidClashJudgment;
  /** 판정이 화면에 들어온 로컬 시각(ms) — 섬광 연출용 */
  atMs: number;
}

// 화면 여러 곳에 고리를 나눠 띄운다. 다음 고리까지 시선 이동 거리가 너무 멀지 않게 배치.
const RING_POSITIONS: Array<{ x: number; y: number }> = [
  { x: 0.34, y: 0.44 },
  { x: 0.5, y: 0.34 },
  { x: 0.66, y: 0.44 },
  { x: 0.6, y: 0.64 },
  { x: 0.4, y: 0.64 },
  { x: 0.3, y: 0.3 },
  { x: 0.7, y: 0.3 },
  { x: 0.5, y: 0.52 },
];

const VIEW_W = 1600;
const VIEW_H = 900;
const FLASH_MS = 520;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

export function useClashClock(active: boolean) {
  const [now, setNow] = useState(() => clashNowMs());
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const loop = () => {
      setNow(clashNowMs());
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [active]);
  return now;
}

export default function ClashStage({
  notes,
  profile,
  judgments,
  playStartsAtMs,
  size = 'student',
  showKeys = true,
}: {
  notes: LocalClashNote[];
  profile: Pick<RaidClashProfile, 'approach_ms' | 'bad_ms' | 'countdown_ms'>;
  judgments: Partial<Record<number, ClashStageJudgment>>;
  /** 로컬 시계 기준 play_starts_at(ms). 3-2-1 카운트다운 표시에 쓴다. */
  playStartsAtMs: number | null;
  size?: 'student' | 'broadcast';
  showKeys?: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const now = useClashClock(true);
  const radius = size === 'broadcast' ? 112 : 96;

  const countdown = useMemo(() => {
    if (playStartsAtMs == null) return null;
    const elapsed = now - playStartsAtMs;
    if (elapsed < 0) return null;
    if (elapsed >= profile.countdown_ms) return null;
    return Math.max(1, Math.ceil((profile.countdown_ms - elapsed) / 1000));
  }, [now, playStartsAtMs, profile.countdown_ms]);

  const waitingForStart = playStartsAtMs != null && now < playStartsAtMs;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-full w-full select-none"
      role="img"
      aria-label="격돌 입력 고리"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="clash-ring-fill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(14,165,233,0.30)" />
          <stop offset="100%" stopColor="rgba(14,165,233,0.04)" />
        </radialGradient>
      </defs>

      {waitingForStart && (
        <text x={VIEW_W / 2} y={VIEW_H / 2} textAnchor="middle" dominantBaseline="middle" fill="#e0f2fe" fontSize="56" fontWeight="900">
          준비…
        </text>
      )}

      {countdown != null && (
        <text
          key={countdown}
          x={VIEW_W / 2}
          y={VIEW_H / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#fef9c3"
          fontSize="220"
          fontWeight="900"
          style={{ filter: reducedMotion ? undefined : 'drop-shadow(0 0 24px rgba(250,204,21,0.65))' }}
        >
          {countdown}
        </text>
      )}

      {notes.map((note) => {
        const pos = RING_POSITIONS[note.index % RING_POSITIONS.length];
        const cx = pos.x * VIEW_W;
        const cy = pos.y * VIEW_H;
        const judged = judgments[note.index];
        const appearAt = note.idealMs - profile.approach_ms;

        if (judged) {
          const age = now - judged.atMs;
          if (age > FLASH_MS || age < -50) return null;
          const style = CLASH_JUDGMENT_STYLE[judged.judgment];
          const t = Math.max(0, Math.min(1, age / FLASH_MS));
          const burst = reducedMotion ? radius * 1.1 : radius * (1 + t * 0.75);
          return (
            <g key={note.index} opacity={1 - t * 0.85}>
              <circle cx={cx} cy={cy} r={burst} fill="none" stroke={style.color} strokeWidth={judged.judgment === 'PERFECT' ? 14 : 10}
                style={{ filter: reducedMotion ? undefined : `drop-shadow(0 0 18px ${style.glow})` }} />
              <circle cx={cx} cy={cy} r={radius * 0.82} fill={style.glow} opacity={0.35} />
              <text x={cx} y={cy + 6} textAnchor="middle" dominantBaseline="middle" fill={style.text} fontSize={size === 'broadcast' ? 46 : 40} fontWeight="900"
                stroke="rgba(0,0,0,0.65)" strokeWidth={6} paintOrder="stroke">
                {style.label}
              </text>
            </g>
          );
        }

        // 아직 나타나기 전(살짝 미리 보기 300ms) / BAD 창이 끝난 미판정 고리는 숨긴다.
        if (now < appearAt - 300) return null;
        if (now > note.idealMs + profile.bad_ms + 120) return null;

        const progress = clashRingProgress(now, note.idealMs, profile.approach_ms);
        const visible = now >= appearAt;
        const shrink = radius * (1 + 1.55 * Math.max(-0.35, Math.min(1, progress)));
        const fadeIn = visible ? 1 : 0.35;
        return (
          <g key={note.index} opacity={fadeIn}>
            {/* 고정 판정 고리 */}
            <circle cx={cx} cy={cy} r={radius} fill="url(#clash-ring-fill)" stroke="#38bdf8" strokeWidth={9} opacity={0.95} />
            <circle cx={cx} cy={cy} r={radius - 14} fill="none" stroke="rgba(186,230,253,0.45)" strokeWidth={2} />
            {/* 수축 고리 */}
            {visible && (
              <circle cx={cx} cy={cy} r={Math.max(radius * 0.4, shrink)} fill="none" stroke="#7dd3fc" strokeWidth={7}
                style={{ filter: reducedMotion ? undefined : 'drop-shadow(0 0 10px rgba(56,189,248,0.8))' }} />
            )}
            {showKeys && (
              <text x={cx} y={cy + 4} textAnchor="middle" dominantBaseline="middle" fill="#ffffff" fontSize={size === 'broadcast' ? 92 : 82} fontWeight="900"
                stroke="rgba(2,6,23,0.85)" strokeWidth={8} paintOrder="stroke">
                {CLASH_KEY_LABEL[note.key]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
