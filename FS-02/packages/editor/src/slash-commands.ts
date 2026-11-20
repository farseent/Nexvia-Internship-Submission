import type { Editor, Range } from '@tiptap/core';

/**
 * What a slash command may ask of the application that hosts the editor. The editor package
 * has no network or storage access (docs/ARCHITECTURE.md §5), so anything that needs it, such
 * as choosing and uploading an image, is a callback supplied by the host.
 */
export interface SlashCommandHost {
  /** Open the image picker. When absent, the image command is hidden. */
  requestImage?: (() => void) | undefined;
}

export interface SlashCommandContext {
  editor: Editor;
  /** The `/query` text the menu was opened with; commands delete it before acting. */
  range: Range;
  host: SlashCommandHost;
}

export interface SlashCommandDefinition {
  id: string;
  title: string;
  description: string;
  /** Extra words that should find the command. */
  keywords: readonly string[];
  /** Hide the command for hosts that cannot support it. */
  isAvailable?: (host: SlashCommandHost) => boolean;
  run: (context: SlashCommandContext) => void;
}

/** Table inserted by the slash command: a header row and two body rows of three columns. */
export const SLASH_TABLE_SIZE = { rows: 3, cols: 3 } as const;

const heading = (level: 1 | 2 | 3): SlashCommandDefinition => ({
  id: `heading-${level}`,
  title: `Heading ${level}`,
  description:
    level === 1
      ? 'Large section heading'
      : level === 2
        ? 'Medium section heading'
        : 'Small section heading',
  keywords: ['title', 'h' + String(level), 'header'],
  run: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setNode('heading', { level }).run();
  },
});

/** The commands of the base editor features, in menu order. */
export const BASE_SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  {
    id: 'paragraph',
    title: 'Text',
    description: 'Plain paragraph',
    keywords: ['paragraph', 'normal', 'p'],
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('paragraph').run();
    },
  },
  heading(1),
  heading(2),
  heading(3),
  {
    id: 'bullet-list',
    title: 'Bulleted list',
    description: 'Unordered list',
    keywords: ['unordered', 'ul', 'bullets'],
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    id: 'ordered-list',
    title: 'Numbered list',
    description: 'Ordered list',
    keywords: ['ordered', 'ol', 'numbers'],
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
];

export const TASK_LIST_SLASH_COMMAND: SlashCommandDefinition = {
  id: 'task-list',
  title: 'Checklist',
  description: 'Track tasks with checkboxes',
  keywords: ['todo', 'task', 'checkbox', 'check'],
  run: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).toggleTaskList().run();
  },
};

export const TABLE_SLASH_COMMAND: SlashCommandDefinition = {
  id: 'table',
  title: 'Table',
  description: 'Rows and columns with a header row',
  keywords: ['grid', 'rows', 'columns'],
  run: ({ editor, range }) => {
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertTable({ ...SLASH_TABLE_SIZE, withHeaderRow: true })
      .run();
  },
};

export const IMAGE_SLASH_COMMAND: SlashCommandDefinition = {
  id: 'image',
  title: 'Image',
  description: 'Upload an image',
  keywords: ['picture', 'photo', 'upload', 'img'],
  isAvailable: (host) => host.requestImage !== undefined,
  run: ({ editor, range, host }) => {
    editor.chain().focus().deleteRange(range).run();
    host.requestImage?.();
  },
};

function score(command: SlashCommandDefinition, query: string): number {
  const title = command.title.toLowerCase();
  if (title.startsWith(query)) return 0;
  if (command.keywords.some((word) => word.toLowerCase().startsWith(query))) return 1;
  if (title.split(/\s+/).some((word) => word.startsWith(query))) return 2;
  if (
    title.includes(query) ||
    command.keywords.some((word) => word.toLowerCase().includes(query))
  ) {
    return 3;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Commands matching what was typed after the slash, best matches first; an empty query
 * returns everything in menu order. Commands the host cannot support are left out.
 */
export function filterSlashCommands(
  commands: readonly SlashCommandDefinition[],
  query: string,
  host: SlashCommandHost = {},
): SlashCommandDefinition[] {
  const needle = query.trim().toLowerCase();
  const available = commands.filter((command) => command.isAvailable?.(host) ?? true);
  if (needle === '') return available;
  return available
    .map((command, index) => ({ command, index, rank: score(command, needle) }))
    .filter((entry) => Number.isFinite(entry.rank))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.command);
}
