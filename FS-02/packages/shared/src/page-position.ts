/**
 * Fractional-index keys for ordering sibling pages (docs/DATABASE_SCHEMA.md `Page.position`).
 *
 * A key is a base-36 fraction (`0.d1d2…`) written with digits `0-9a-z`, without a
 * trailing `0`. Keys compare correctly with plain code-unit string comparison
 * (`<`), never with a locale or database collation. `positionBetween` returns a key
 * strictly between two others, so a page can be inserted anywhere without touching
 * its siblings. Pure: no I/O.
 *
 * Approach after "Implementing Fractional Indexing" (David Greenspan); written here
 * rather than added as a dependency (CLAUDE.md §4.1, §4.14).
 */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

/** Column limit of `pages.position` (VarChar(64)). */
export const POSITION_MAX_LENGTH = 64;

const KEY_PATTERN = /^[0-9a-z]*[1-9a-z]$/;

export function isValidPosition(key: string): boolean {
  return key.length <= POSITION_MAX_LENGTH && KEY_PATTERN.test(key);
}

function digitValue(char: string | undefined): number {
  const value = char === undefined ? -1 : DIGITS.indexOf(char);
  if (value < 0) throw new Error('Invalid position key.');
  return value;
}

/** `a` may be empty (the lowest bound); `b` may be null (the highest bound). */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Strip the common prefix (`a` is padded with zeros).
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a === '' ? 0 : digitValue(a[0]);
  const digitB = b === null ? BASE : digitValue(b[0]);
  if (digitB - digitA > 1) {
    return DIGITS.charAt(Math.round((digitA + digitB) / 2));
  }
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS.charAt(digitA) + midpoint(a.slice(1), null);
}

/**
 * A key strictly between `before` and `after`. `null` means "no neighbour": both null
 * gives the first key of an empty list. Throws when the bounds are invalid or not in order.
 */
export function positionBetween(before: string | null, after: string | null): string {
  if (before !== null && !KEY_PATTERN.test(before)) throw new Error('Invalid position key.');
  if (after !== null && !KEY_PATTERN.test(after)) throw new Error('Invalid position key.');
  if (before !== null && after !== null && before >= after) {
    throw new Error('Position bounds are not in order.');
  }
  return midpoint(before ?? '', after);
}

/**
 * `count` evenly ordered keys with room between them, used to re-space the siblings of a
 * parent whose keys have grown too long to extend.
 */
export function spreadPositions(count: number): string[] {
  if (count <= 0) return [];
  const width = Math.max(1, Math.ceil(Math.log(count + 1) / Math.log(BASE)));
  const keys: string[] = [];
  for (let i = 1; i <= count; i++) {
    // Fixed width keeps code-unit order equal to numeric order; the trailing 'i' (value 18)
    // keeps the key valid (no trailing zero) and leaves room between neighbours.
    keys.push(i.toString(BASE).padStart(width, '0') + 'i');
  }
  return keys;
}

/** Compare two position keys the way the API orders siblings. */
export function comparePositions(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
