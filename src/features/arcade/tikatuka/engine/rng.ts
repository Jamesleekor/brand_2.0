import type { RandomSource } from './types';

const UINT32_MAX = 0xffff_ffff;
const UINT32_RANGE = 0x1_0000_0000;

function assertIntegerRange(minInclusive: number, maxInclusive: number) {
  if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive) || minInclusive > maxInclusive) {
    throw new Error('RNG 범위는 min <= max인 정수 범위여야 합니다.');
  }
}

function normalizeNonZeroUint32Seed(seed: number): number {
  if (!Number.isInteger(seed) || seed < 1 || seed > UINT32_MAX) {
    throw new Error('라카루카 RNG seed는 1~4294967295 정수여야 합니다.');
  }
  return seed >>> 0;
}

/** PostgreSQL arcade_xorshift32_next(bigint)와 동일한 unsigned 32-bit 변환. */
export function tikatukaXorshift32Next(state: number): number {
  let value = state >>> 0;
  value = (value ^ ((value << 13) >>> 0)) >>> 0;
  value = (value ^ (value >>> 17)) >>> 0;
  value = (value ^ ((value << 5) >>> 0)) >>> 0;
  return value >>> 0;
}

export class SeededRandomSource implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = normalizeNonZeroUint32Seed(seed);
  }

  private nextUint32(): number {
    this.state = tikatukaXorshift32Next(this.state);
    return this.state;
  }

  nextInt(minInclusive: number, maxInclusive: number): number {
    assertIntegerRange(minInclusive, maxInclusive);
    const span = maxInclusive - minInclusive + 1;
    if (!Number.isSafeInteger(span) || span <= 0 || span > UINT32_RANGE) {
      throw new Error('RNG 정수 범위가 지원 범위를 벗어났습니다.');
    }
    return minInclusive + (this.nextUint32() % span);
  }

  nextFloat(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  snapshotState(): number {
    return this.state >>> 0;
  }
}

/**
 * Test-only deterministic source. nextInt() values are consumed exactly as supplied,
 * making dice/Tazza scenarios readable without coupling tests to xorshift internals.
 */
export class SequenceRandomSource implements RandomSource {
  private cursor = 0;

  constructor(
    private readonly sequence: readonly number[],
    private readonly loop = false,
  ) {
    if (sequence.length === 0) throw new Error('Sequence RNG에는 최소 1개의 값이 필요합니다.');
  }

  private takeNext(): number {
    if (this.cursor >= this.sequence.length) {
      if (!this.loop) throw new Error('Sequence RNG 값이 모두 소진되었습니다.');
      this.cursor = 0;
    }
    const value = this.sequence[this.cursor];
    this.cursor += 1;
    return value;
  }

  nextInt(minInclusive: number, maxInclusive: number): number {
    assertIntegerRange(minInclusive, maxInclusive);
    const value = this.takeNext();
    if (!Number.isInteger(value) || value < minInclusive || value > maxInclusive) {
      throw new Error(`Sequence RNG 값 ${value}이 요청 범위 ${minInclusive}~${maxInclusive}를 벗어났습니다.`);
    }
    return value;
  }

  nextFloat(): number {
    const value = this.takeNext();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new Error(`Sequence RNG float 값 ${value}은 0 이상 1 미만이어야 합니다.`);
    }
    return value;
  }

  consumedCount(): number {
    return this.cursor;
  }
}

export function createSeededRandomSource(seed: number): SeededRandomSource {
  return new SeededRandomSource(seed);
}

export function createSequenceRandomSource(sequence: readonly number[], loop = false): SequenceRandomSource {
  return new SequenceRandomSource(sequence, loop);
}
