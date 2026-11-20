import { describe, expect, it } from 'vitest';
import type { PageDto } from '@conote/shared';
import { ancestorIds, buildPageTree, descendantIds, displayTitle, flattenTree } from './page-tree';

function page(over: Partial<PageDto> & { id: string }): PageDto {
  return {
    workspaceId: 'w',
    parentId: null,
    title: over.id,
    icon: null,
    position: 'i',
    myRole: 'EDITOR',
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

describe('buildPageTree', () => {
  it('nests children under parents and orders siblings by position', () => {
    const tree = buildPageTree([
      page({ id: 'b', position: 'r' }),
      page({ id: 'a', position: 'i' }),
      page({ id: 'a2', parentId: 'a', position: 'r' }),
      page({ id: 'a1', parentId: 'a', position: 'i' }),
    ]);
    expect(tree.map((n) => n.page.id)).toEqual(['a', 'b']);
    expect(tree[0]?.children.map((n) => n.page.id)).toEqual(['a1', 'a2']);
  });

  it('compares positions by code unit, not by locale', () => {
    const tree = buildPageTree([
      page({ id: 'x', position: 'a' }),
      page({ id: 'y', position: 'B1' }),
    ]);
    // Code-unit order puts upper case before lower case; a locale compare would not.
    expect(tree.map((n) => n.page.id)).toEqual(['y', 'x']);
  });

  it('shows a page whose parent is not visible as a root', () => {
    const tree = buildPageTree([page({ id: 'child', parentId: 'hidden-parent' })]);
    expect(tree.map((n) => n.page.id)).toEqual(['child']);
  });
});

describe('tree helpers', () => {
  const pages = [
    page({ id: 'a' }),
    page({ id: 'b', parentId: 'a' }),
    page({ id: 'c', parentId: 'b' }),
    page({ id: 'd', position: 'r' }),
  ];

  it('finds descendants, including the page itself', () => {
    expect([...descendantIds(buildPageTree(pages), 'a')].sort()).toEqual(['a', 'b', 'c']);
    expect([...descendantIds(buildPageTree(pages), 'd')]).toEqual(['d']);
    expect(descendantIds(buildPageTree(pages), 'missing').size).toBe(0);
  });

  it('lists ancestors nearest first', () => {
    expect(ancestorIds(pages, 'c')).toEqual(['b', 'a']);
    expect(ancestorIds(pages, 'a')).toEqual([]);
  });

  it('flattens depth-first with levels', () => {
    expect(flattenTree(buildPageTree(pages)).map((e) => `${e.level}:${e.page.id}`)).toEqual([
      '0:a',
      '1:b',
      '2:c',
      '0:d',
    ]);
  });

  it('shows Untitled for an empty title', () => {
    expect(displayTitle('')).toBe('Untitled');
    expect(displayTitle('  ')).toBe('Untitled');
    expect(displayTitle('Plan')).toBe('Plan');
  });
});
