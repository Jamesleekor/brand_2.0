// RAID_CLASH_SFX_20261029 — 격돌 판정 효과음 (음원 파일 없이 브라우저에서 직접 합성)
// * PERFECT : 맑고 시원한 금속 "챙—" (금속 막대 배음 + 은은한 울림 + 반짝이는 "샥" 소리)
// * GOOD    : 가볍고 맑은 유리 "딩"
// * BAD     : 둔한 "툭"
// * MISS    : 힘 빠지는 낮은 "뿌웅"
// 중계 화면(교사 PC)과 교사 연습 모드에서만 울린다. 학생 크롬북(전투 화면)은 무음 운영이라 소리를 내지 않는다.
// 모든 소리는 1초 안에 끝난다.
import type { RaidClashJudgment } from '@/lib/rpc/raid_student_rpc';

/** 판정 효과음 하나를 destination으로 낸다. */
export function renderClashJudgmentSfx(ctx: AudioContext, destination: AudioNode, judgment: RaidClashJudgment, volume = 1) {
  const t = ctx.currentTime + 0.004;
  const out = ctx.createGain();
  out.gain.value = Math.max(0, volume);
  out.connect(destination);

  if (judgment === 'PERFECT') {
    // 금속 막대를 맑게 친 소리: 기본음 A6(1760Hz)과 금속 특유의 어긋난 배음, 바로 뒤 E7 잔향, 높은 "샥" 반짝임
    metalTing(ctx, out, t, 1760, 0.95, 0.30);
    metalTing(ctx, out, t + 0.04, 2637, 0.75, 0.13);
    noiseBurst(ctx, out, t, 0.07, 0.10, 'highpass', 7200);
    return;
  }
  if (judgment === 'GOOD') {
    // 맑은 유리잔 "딩" (금속음보다 짧고 부드럽게)
    tone(ctx, out, t, 1174.66, 0.30, 'sine', 0.30);
    tone(ctx, out, t, 2349.32, 0.16, 'sine', 0.09);
    noiseBurst(ctx, out, t, 0.025, 0.04, 'highpass', 5000);
    return;
  }
  if (judgment === 'BAD') {
    // 둔하게 막힌 "툭"
    tone(ctx, out, t, 230, 0.16, 'triangle', 0.30, 140);
    noiseBurst(ctx, out, t, 0.05, 0.08, 'lowpass', 900);
    return;
  }
  // MISS: 힘이 빠지는 낮은 "뿌웅" (거슬리지 않게 작게)
  tone(ctx, out, t, 170, 0.24, 'sawtooth', 0.14, 85, 520);
}

/** 금속 막대 타격음: 어긋난(비정수배) 배음일수록 금속처럼 들린다. 높은 배음은 더 빨리 사라진다. */
function metalTing(ctx: AudioContext, out: AudioNode, t: number, freq: number, decay: number, amp: number) {
  const partials: Array<[ratio: number, gain: number, decayScale: number]> = [
    [1, 1, 1],
    [1.0035, 0.55, 0.9], // 살짝 어긋난 쌍 → "웅웅" 맑은 울림(청량감)
    [2.76, 0.42, 0.55],
    [5.4, 0.2, 0.32],
    [8.93, 0.08, 0.2],
  ];
  for (const [ratio, gain, decayScale] of partials) {
    const frequency = freq * ratio;
    if (frequency > 18000) continue;
    tone(ctx, out, t, frequency, decay * decayScale, 'sine', amp * gain, undefined, undefined, 0.0015);
  }
}

function tone(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  frequency: number,
  duration: number,
  type: OscillatorType,
  amp: number,
  endFrequency?: number,
  lowpassHz?: number,
  attack = 0.004,
) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(30, frequency), t);
  if (endFrequency) osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), t + duration);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  let node: AudioNode = osc;
  if (lowpassHz) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpassHz;
    osc.connect(filter);
    node = filter;
  }
  node.connect(env);
  env.connect(out);
  osc.start(t);
  osc.stop(t + duration + 0.03);
}

function noiseBurst(ctx: AudioContext, out: AudioNode, t: number, duration: number, amp: number, filterType: BiquadFilterType, filterHz: number) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterHz;
  const env = ctx.createGain();
  env.gain.setValueAtTime(Math.max(0.0002, amp), t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  source.connect(filter);
  filter.connect(env);
  env.connect(out);
  source.start(t);
  source.stop(t + duration + 0.01);
}

// ── 교사 연습 모드용: 화면 하나에 오디오 엔진 하나 ─────────────────────
let sharedContext: AudioContext | null = null;
let sharedOut: GainNode | null = null;

/**
 * 소리를 켤 준비. 브라우저는 "사용자가 누른 순간"에만 소리를 허락하므로
 * 격돌 지원 버튼·연습 시작 버튼·키 입력 때 부른다. 실패해도 게임은 그대로 진행한다.
 */
export function unlockClashSfx() {
  if (typeof window === 'undefined') return;
  try {
    if (!sharedContext) {
      const Ctor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      sharedContext = new Ctor();
      sharedOut = sharedContext.createGain();
      sharedOut.gain.value = 0.8;
      sharedOut.connect(sharedContext.destination);
    }
    if (sharedContext.state !== 'running') void sharedContext.resume().catch(() => undefined);
  } catch {
    // 소리가 안 나도 격돌은 계속한다.
  }
}

/** 내 판정 효과음(교사 연습 모드). 키를 누른 그 순간 바로 울린다. */
export function playClashJudgmentSfx(judgment: RaidClashJudgment) {
  unlockClashSfx();
  const ctx = sharedContext;
  const out = sharedOut;
  if (!ctx || !out) return;
  try {
    if (ctx.state === 'running') renderClashJudgmentSfx(ctx, out, judgment);
    else void ctx.resume().then(() => renderClashJudgmentSfx(ctx, out, judgment)).catch(() => undefined);
  } catch {
    // 소리가 안 나도 격돌은 계속한다.
  }
}
