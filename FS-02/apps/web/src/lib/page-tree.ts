import type { PageDto } from '@conote/shared';

/** Display title: an empty title shows as "Untitled" (docs/DATABASE_SCHEMA.md §10). */
export function displayTitle(title: string): string {
  return title.trim() === '' ? 'Untitled' : title;
}

export interface PageNode {
  page: PageDto;
  children: PageNode[];
}

/**
 * Build the page tree from the flat list of PAGE-02. A page whose parent is not in the list
 * (the parent is hidden from this user, or missing) is shown as a root, as the API contract
 * describes. Siblings are ordered by position with plain code-unit comparison, the same
 * order the server uses (never `localeCompare`).
 */
export function buildPageTree(pages: readonly PageDto[]): PageNode[] {
  const nodes = new Map<string, PageNode>(pages.map((page) => [page.id, { page, children: [] }]));
  const roots: PageNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.page.parentId === null ? undefined : nodes.get(node.page.parentId);
    (parent === undefined ? roots : parent.children).push(node);
  }
  const bySiblingOrder = (a: PageNode, b: PageNode): number =>
    a.page.position < b.page.position
      ? -1
      : a.page.position > b.page.position
        ? 1
        : a.page.id < b.page.id
          ? -1
          : 1;
  const sortAll = (list: PageNode[]): void => {
    list.sort(bySiblingOrder);
    for (const node of list) sortAll(node.children);
  };
  sortAll(roots);
  return roots;
}

/** Ids of the page and every descendant (used to prevent moving a page under itself). */
export function descendantIds(roots: readonly PageNode[], pageId: string): Set<string> {
  const result = new Set<string>();
  const collect = (node: PageNode): void => {
    result.add(node.page.id);
    for (const child of node.children) collect(child);
  };
  const find = (list: readonly PageNode[]): PageNode | undefined => {
    for (const node of list) {
      if (node.page.id === pageId) return node;
      const inner = find(node.children);
      if (inner !== undefined) return inner;
    }
    return undefined;
  };
  const start = find(roots);
  if (start !== undefined) collect(start);
  return result;
}

/** Ids of the ancestors of a page, nearest first (to expand the tree to the current page). */
export function ancestorIds(pages: readonly PageDto[], pageId: string): string[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const result: string[] = [];
  let current = byId.get(pageId);
  for (let hops = 0; current !== undefined && current.parentId !== null && hops < 64; hops += 1) {
    result.push(current.parentId);
    current = byId.get(current.parentId);
  }
  return result;
}

/** Depth-first flat list with nesting level, for select lists and keyboard order. */
export function flattenTree(roots: readonly PageNode[]): { page: PageDto; level: number }[] {
  const out: { page: PageDto; level: number }[] = [];
  const walk = (list: readonly PageNode[], level: number): void => {
    for (const node of list) {
      out.push({ page: node.page, level });
      walk(node.children, level + 1);
    }
  };
  walk(roots, 0);
  return out;
}
