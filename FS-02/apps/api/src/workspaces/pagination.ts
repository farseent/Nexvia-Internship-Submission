import { AppError } from '@conote/shared';

/** Keyset cursor over `(createdAt desc, id desc)`: opaque base64url of `<iso>|<id>`. */
export interface Cursor {
  at: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  const invalid = (): never => {
    throw new AppError('VALIDATION_ERROR', 'The cursor is invalid.', {
      details: [{ path: 'cursor', message: 'The cursor is invalid.' }],
    });
  };
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const bar = text.indexOf('|');
  if (bar < 0) return invalid();
  const at = new Date(text.slice(0, bar));
  const id = text.slice(bar + 1);
  if (Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) return invalid();
  return { at, id };
}

/** Prisma `where` fragment selecting rows strictly after `cursor` in `(createdAt desc, id desc)`. */
export function afterCursor(cursor: Cursor | undefined, field: string = 'createdAt') {
  if (cursor === undefined) return {};
  return {
    OR: [{ [field]: { lt: cursor.at } }, { [field]: cursor.at, id: { lt: cursor.id } }],
  };
}

/**
 * Trim a page fetched with `limit + 1` rows and compute the next cursor.
 * `at` reads the sort timestamp of a row.
 */
export function pageOf<T extends { id: string }>(
  rows: readonly T[],
  limit: number,
  at: (row: T) => Date,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor =
    rows.length > limit && last !== undefined ? encodeCursor({ at: at(last), id: last.id }) : null;
  return { items, nextCursor };
}
