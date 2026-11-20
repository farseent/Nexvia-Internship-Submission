'use client';

import Link from 'next/link';
import type { PageNode } from '@/lib/page-tree';
import { displayTitle } from '@/lib/page-tree';
import { canEditPageDto } from './workspace-context';

export interface PageTreeNavProps {
  nodes: readonly PageNode[];
  workspaceId: string;
  currentPageId: string | null;
  expanded: ReadonlySet<string>;
  onToggle(pageId: string): void;
  onAddChild(parentId: string): void;
  busyParentId: string | null;
  onNavigate?: () => void;
}

/** Nested, keyboard-accessible page navigation (WAI-ARIA tree pattern, simplified to a list of links). */
export function PageTreeNav(props: PageTreeNavProps) {
  return (
    <ul role="tree" aria-label="Pages" className="flex flex-col gap-0.5">
      {props.nodes.map((node) => (
        <PageTreeItem key={node.page.id} node={node} level={1} {...props} />
      ))}
    </ul>
  );
}

function PageTreeItem({
  node,
  level,
  ...props
}: PageTreeNavProps & { node: PageNode; level: number }) {
  const { page, children } = node;
  const isOpen = props.expanded.has(page.id);
  const isCurrent = props.currentPageId === page.id;
  const title = displayTitle(page.title);
  const hasChildren = children.length > 0;

  return (
    <li role="none">
      <div
        role="treeitem"
        aria-level={level}
        aria-selected={isCurrent}
        aria-expanded={hasChildren ? isOpen : undefined}
        className={`group flex items-center gap-1 rounded-md pr-1 ${
          isCurrent ? 'bg-indigo-50 text-indigo-900' : 'hover:bg-slate-100'
        }`}
        style={{ paddingLeft: `${(level - 1) * 12 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => props.onToggle(page.id)}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${title}`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200"
          >
            <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span className="h-6 w-6 shrink-0" aria-hidden="true" />
        )}
        <Link
          href={`/workspaces/${page.workspaceId}/pages/${page.id}`}
          aria-current={isCurrent ? 'page' : undefined}
          onClick={props.onNavigate}
          className="min-w-0 flex-1 truncate py-1 text-sm"
        >
          <span aria-hidden="true" className="mr-1">
            {page.icon ?? '📄'}
          </span>
          {title}
        </Link>
        {canEditPageDto(page) ? (
          <button
            type="button"
            onClick={() => props.onAddChild(page.id)}
            disabled={props.busyParentId === page.id}
            aria-label={`Add a subpage to ${title}`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 opacity-100 hover:bg-slate-200 disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
          >
            <span aria-hidden="true">+</span>
          </button>
        ) : null}
      </div>
      {hasChildren && isOpen ? (
        <ul role="group" className="flex flex-col gap-0.5">
          {children.map((child) => (
            <PageTreeItem key={child.page.id} node={child} level={level + 1} {...props} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
