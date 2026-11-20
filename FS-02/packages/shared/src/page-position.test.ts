import { describe, expect, it } from 'vitest';
import {
  POSITION_MAX_LENGTH,
  comparePositions,
  isValidPosition,
  positionBetween,
  spreadPositions,
} from './index.js';

/** Small deterministic generator so failures are reproducible. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe('positionBetween', () => {
  it('returns a valid first key for an empty list', () => {
    const key = positionBetween(null, null);
    expect(isValidPosition(key)).toBe(true);
  });

  it('places a key strictly between two others, and before/after a single one', () => {
    const a = positionBetween(null, null);
    const after = positionBetween(a, null);
    const before = positionBetween(null, a);
    expect(before < a && a < after).toBe(true);
    const mid = positionBetween(a, after);
    expect(a < mid && mid < after).toBe(true);
  });

  it('keeps every key valid and ordered over many random insertions', () => {
    const random = lcg(7);
    const list: string[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const at = Math.floor(random() * (list.length + 1));
      const lower = list[at - 1] ?? null;
      const upper = list[at] ?? null;
      const key = positionBetween(lower, upper);
      expect(isValidPosition(key)).toBe(true);
      if (lower !== null) expect(lower < key).toBe(true);
      if (upper !== null) expect(key < upper).toBe(true);
      list.splice(at, 0, key);
    }
    expect(new Set(list).size).toBe(list.length);
    expect([...list].sort(comparePositions)).toEqual(list);
  });

  it('rejects bounds that are equal, reversed or malformed', () => {
    expect(() => positionBetween('b', 'a')).toThrow();
    expect(() => positionBetween('a', 'a')).toThrow();
    expect(() => positionBetween('A', null)).toThrow();
    expect(() => positionBetween('a0', null)).toThrow(); // trailing zero is not canonical
  });

  it('grows slowly when always appending, so the service can re-space before the column limit', () => {
    let last: string | null = null;
    let count = 0;
    for (;;) {
      const key: string = positionBetween(last, null);
      if (key.length > POSITION_MAX_LENGTH) break;
      last = key;
      count += 1;
      if (count > 5000) break;
    }
    expect(count).toBeGreaterThan(100);
  });
});

describe('spreadPositions', () => {
  it('returns the requested number of distinct, valid, ordered keys', () => {
    for (const count of [0, 1, 2, 35, 36, 37, 1296, 3000]) {
      const keys = spreadPositions(count);
      expect(keys).toHaveLength(count);
      expect(new Set(keys).size).toBe(count);
      expect(keys.every(isValidPosition)).toBe(true);
      expect([...keys].sort(comparePositions)).toEqual(keys);
    }
  });

  it('leaves room between neighbouring keys', () => {
    const [first, second] = spreadPositions(2);
    const mid = positionBetween(first ?? null, second ?? null);
    expect((first ?? '') < mid && mid < (second ?? '')).toBe(true);
  });
});
