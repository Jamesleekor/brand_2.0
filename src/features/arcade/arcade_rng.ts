export const UINT32_MAX = 0xffff_ffff;

export const STARLINK_INITIAL_DOMAIN = 0xA341316C;
export const STARLINK_REFILL_DOMAIN = 0xC8013EA4;
export const STARLINK_RESHUFFLE_DOMAIN = 0xAD90777D;
export const STARLINK_ZERO_FALLBACK = 0x6D2B79F5;

export function assertNonZeroUint32(value: number, label = 'RNG state'): number {
  if (!Number.isInteger(value) || value < 1 || value > UINT32_MAX) {
    throw new Error(`${label} must be a non-zero unsigned 32-bit integer.`);
  }
  return value >>> 0;
}

// public.arcade_xorshift32_next(bigint)와 bit-for-bit 동일한 xorshift32.
export function xorshift32Next(state: number): number {
  let value = assertNonZeroUint32(state);
  value = (value ^ ((value << 13) >>> 0)) >>> 0;
  value = (value ^ (value >>> 17)) >>> 0;
  value = (value ^ ((value << 5) >>> 0)) >>> 0;
  return value >>> 0;
}

export function nextModulo(state: number, modulus: number): { state: number; value: number } {
  if (!Number.isInteger(modulus) || modulus <= 0) {
    throw new Error('RNG modulus must be a positive integer.');
  }
  const nextState = xorshift32Next(state);
  return { state: nextState, value: nextState % modulus };
}

// starlink_04_v0.3 locked deriveSeed32 contract.
// baseSeed/domain XOR -> ZERO fallback -> exactly 4 xorshift32 rounds.
export function deriveSeed32(baseSeed: number, domainConst: number): number {
  const base = assertNonZeroUint32(baseSeed, 'Gameplay seed');
  if (!Number.isInteger(domainConst) || domainConst < 0 || domainConst > UINT32_MAX) {
    throw new Error('RNG domain constant must be an unsigned 32-bit integer.');
  }

  let state = (base ^ (domainConst >>> 0)) >>> 0;
  if (state === 0) state = STARLINK_ZERO_FALLBACK;

  for (let round = 0; round < 4; round += 1) {
    state = xorshift32Next(state);
  }

  if (state === 0) state = STARLINK_ZERO_FALLBACK;
  return state >>> 0;
}

export interface StarlinkRngStreams {
  initial: number;
  refill: number;
  reshuffle: number;
}

export function deriveStarlinkRngStreams(gameplaySeed: number): StarlinkRngStreams {
  return {
    initial: deriveSeed32(gameplaySeed, STARLINK_INITIAL_DOMAIN),
    refill: deriveSeed32(gameplaySeed, STARLINK_REFILL_DOMAIN),
    reshuffle: deriveSeed32(gameplaySeed, STARLINK_RESHUFFLE_DOMAIN),
  };
}
