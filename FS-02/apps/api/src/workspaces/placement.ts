import { AppError, positionBetween, spreadPositions } from '@conote/shared';
import { bySiblingOrder, type Db } from './access.js';

/** Re-space siblings when a new key would exceed this length (the column holds 64). */
export const REBALANCE_AT_LENGTH = 48;

export interface Sibling {
  id: string;
  position: string;
}

/** Live (non-deleted) children of `parentId` (null = workspace root), in display order. */
export async function listSiblings(
  db: Db,
  workspaceId: string,
  parentId: string | null,
  excludeId?: string,
): Promise<Sibling[]> {
  const rows = await db.page.findMany({
    where: {
      workspaceId,
      parentId,
      deletedAt: null,
      ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
    },
    select: { id: true, position: true },
  });
  // Sorted here with code-unit order, never by a database collation (see `page-position.ts`).
  return rows.sort(bySiblingOrder);
}

export interface Placement {
  /** Position key of the page being placed. */
  position: string;
  /** Siblings whose keys must change (only when the keys were re-spaced). */
  updates: Sibling[];
}

/**
 * Decide where a page goes among `siblings` (already sorted, excluding the page itself).
 * `afterPageId`: undefined = last, null = first, an id = right after that sibling.
 */
export function planPlacement(
  siblings: readonly Sibling[],
  afterPageId: string | null | undefined,
): Placement {
  let index = siblings.length;
  if (afterPageId === null) {
    index = 0;
  } else if (afterPageId !== undefined) {
    const at = siblings.findIndex((sibling) => sibling.id === afterPageId);
    if (at < 0) throw new AppError('INVALID_MOVE', 'The move is not allowed.');
    index = at + 1;
  }
  const before = siblings[index - 1]?.position ?? null;
  const after = siblings[index]?.position ?? null;

  if (before === null || after === null || before < after) {
    const key = positionBetween(before, after);
    if (key.length <= REBALANCE_AT_LENGTH) return { position: key, updates: [] };
  }

  // Keys grew too long (or two siblings share a key): re-space all of them evenly.
  const keys = spreadPositions(siblings.length + 1);
  const position = keys[index];
  if (position === undefined) throw new Error('unreachable: placement index out of range');
  return {
    position,
    updates: siblings.map((sibling, i) => ({
      id: sibling.id,
      position: keys[i < index ? i : i + 1] ?? sibling.position,
    })),
  };
}

/** Apply the key changes of a placement. */
export async function applyPlacementUpdates(db: Db, placement: Placement): Promise<void> {
  for (const update of placement.updates) {
    await db.page.update({
      where: { id: update.id },
      data: { position: update.position },
      select: { id: true },
    });
  }
}
