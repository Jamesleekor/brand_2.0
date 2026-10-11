export const UINT32_MAX = 0xffff_ffff;

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
