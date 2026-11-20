'use client';

import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { TEXT_ALIGNMENTS, normalizeLinkInput, type TextAlignment } from '@conote/shared';

interface Props {
  editor: Editor;
  /** Open the image picker. */
  onRequestImage: () => void;
  uploading: boolean;
}

const btn =
  'inline-flex min-h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-indigo-100 aria-pressed:text-indigo-900 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';
const separator = 'mx-1 hidden h-5 w-px bg-slate-200 sm:block';

function ToolButton(props: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={btn}
      aria-label={props.label}
      title={props.label}
      {...(props.pressed === undefined ? {} : { 'aria-pressed': props.pressed })}
      disabled={props.disabled ?? false}
      // Keep the selection in the editor when a toolbar button is pressed with the mouse.
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

const ALIGN_PATHS: Record<TextAlignment, string> = {
  left: 'M3 5h14M3 9h9M3 13h14M3 17h9',
  center: 'M3 5h14M6 9h8M3 13h14M6 17h8',
  right: 'M3 5h14M8 9h9M3 13h14M8 17h9',
  justify: 'M3 5h14M3 9h14M3 13h14M3 17h14',
};

function AlignIcon({ alignment }: { alignment: TextAlignment }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d={ALIGN_PATHS[alignment]} />
    </svg>
  );
}

/** One tab stop for the whole toolbar; arrow keys move between its controls. */
function useRovingFocus(root: React.RefObject<HTMLDivElement | null>) {
  const active = useRef<HTMLElement | null>(null);
  const controls = () =>
    [...(root.current?.querySelectorAll<HTMLElement>('button, select') ?? [])].filter(
      (element) => !(element as HTMLButtonElement).disabled,
    );

  // Runs after every render: controls come and go (table row, link form).
  useEffect(() => {
    const all = controls();
    const current =
      active.current !== null && all.includes(active.current) ? active.current : all[0];
    for (const element of all) element.tabIndex = element === current ? 0 : -1;
  });

  const onFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!controls().includes(target)) return;
    active.current = target;
    for (const element of controls()) element.tabIndex = element === target ? 0 : -1;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    const all = controls();
    const index = all.indexOf(event.target as HTMLElement);
    if (index === -1) return;
    const keys: Record<string, number> = {
      ArrowRight: (index + 1) % all.length,
      ArrowLeft: (index - 1 + all.length) % all.length,
      Home: 0,
      End: all.length - 1,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    all[next]?.focus();
  };

  return { onFocus, onKeyDown };
}

export function EditorToolbar({ editor, onRequestImage, uploading }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const roving = useRovingFocus(root);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      link: e.isActive('link'),
      block: e.isActive('heading', { level: 1 })
        ? 'h1'
        : e.isActive('heading', { level: 2 })
          ? 'h2'
          : e.isActive('heading', { level: 3 })
            ? 'h3'
            : 'p',
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      align: TEXT_ALIGNMENTS.find((a) => e.isActive({ textAlign: a })) ?? 'left',
      inTable: e.isActive('table'),
      headerRow: e.isActive('tableHeader'),
      hasSelection: !e.state.selection.empty,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();

  const openLink = () => {
    setLinkValue((editor.getAttributes('link')['href'] as string | undefined) ?? '');
    setLinkError(null);
    setLinkOpen(true);
  };
  const applyLink = (event: React.FormEvent) => {
    event.preventDefault();
    const href = normalizeLinkInput(linkValue);
    if (href === null) {
      setLinkError('Enter a web address (https://…) or an email address.');
      return;
    }
    chain().extendMarkRange('link').setLink({ href }).run();
    setLinkOpen(false);
  };

  const setBlock = (value: string) => {
    if (value === 'p') chain().setParagraph().run();
    else
      chain()
        .setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 })
        .run();
  };

  return (
    <div className="sticky top-0 z-20 -mx-1 border-b border-slate-200 bg-white/95 px-1 py-1 backdrop-blur">
      <div
        ref={root}
        role="toolbar"
        aria-label="Formatting"
        aria-orientation="horizontal"
        className="flex flex-nowrap items-center gap-0.5 overflow-x-auto sm:flex-wrap"
        {...roving}
      >
        <ToolButton label="Undo" onClick={() => chain().undo().run()} disabled={!s.canUndo}>
          ↶
        </ToolButton>
        <ToolButton label="Redo" onClick={() => chain().redo().run()} disabled={!s.canRedo}>
          ↷
        </ToolButton>
        <span className={separator} aria-hidden="true" />

        <select
          aria-label="Text style"
          value={s.block}
          onChange={(event) => setBlock(event.target.value)}
          className="min-h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 [@media(pointer:coarse)]:min-h-11"
        >
          <option value="p">Text</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <span className={separator} aria-hidden="true" />

        <ToolButton label="Bold" pressed={s.bold} onClick={() => chain().toggleBold().run()}>
          <span className="font-bold">B</span>
        </ToolButton>
        <ToolButton label="Italic" pressed={s.italic} onClick={() => chain().toggleItalic().run()}>
          <span className="italic">I</span>
        </ToolButton>
        <ToolButton
          label="Underline"
          pressed={s.underline}
          onClick={() => chain().toggleUnderline().run()}
        >
          <span className="underline">U</span>
        </ToolButton>
        <ToolButton
          label="Link"
          pressed={s.link}
          onClick={openLink}
          disabled={!s.hasSelection && !s.link}
        >
          Link
        </ToolButton>
        <span className={separator} aria-hidden="true" />

        <ToolButton
          label="Bulleted list"
          pressed={s.bullet}
          onClick={() => chain().toggleBulletList().run()}
        >
          • List
        </ToolButton>
        <ToolButton
          label="Numbered list"
          pressed={s.ordered}
          onClick={() => chain().toggleOrderedList().run()}
        >
          1. List
        </ToolButton>
        <ToolButton
          label="Checklist"
          pressed={s.task}
          onClick={() => chain().toggleTaskList().run()}
        >
          ☑ Tasks
        </ToolButton>
        <span className={separator} aria-hidden="true" />

        {TEXT_ALIGNMENTS.map((alignment) => (
          <ToolButton
            key={alignment}
            label={`Align ${alignment}`}
            pressed={s.align === alignment}
            onClick={() => chain().setTextAlign(alignment).run()}
          >
            <AlignIcon alignment={alignment} />
          </ToolButton>
        ))}
        <span className={separator} aria-hidden="true" />

        <ToolButton
          label="Insert table"
          onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          disabled={s.inTable}
        >
          Table
        </ToolButton>
        <ToolButton label="Insert image" onClick={onRequestImage} disabled={uploading}>
          {uploading ? 'Uploading…' : 'Image'}
        </ToolButton>
      </div>

      {s.inTable && (
        <div
          role="group"
          aria-label="Table"
          className="mt-1 flex flex-nowrap items-center gap-0.5 overflow-x-auto border-t border-slate-100 pt-1 sm:flex-wrap"
        >
          <ToolButton label="Add row below" onClick={() => chain().addRowAfter().run()}>
            + Row
          </ToolButton>
          <ToolButton label="Add column right" onClick={() => chain().addColumnAfter().run()}>
            + Column
          </ToolButton>
          <ToolButton label="Delete row" onClick={() => chain().deleteRow().run()}>
            − Row
          </ToolButton>
          <ToolButton label="Delete column" onClick={() => chain().deleteColumn().run()}>
            − Column
          </ToolButton>
          <ToolButton
            label="Toggle header row"
            pressed={s.headerRow}
            onClick={() => chain().toggleHeaderRow().run()}
          >
            Header row
          </ToolButton>
          <ToolButton label="Delete table" onClick={() => chain().deleteTable().run()}>
            Delete table
          </ToolButton>
        </div>
      )}

      {linkOpen && (
        <form
          onSubmit={applyLink}
          className="mt-1 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2"
        >
          <label className="sr-only" htmlFor="editor-link-input">
            Link address
          </label>
          <input
            id="editor-link-input"
            type="text"
            inputMode="url"
            autoFocus
            value={linkValue}
            onChange={(event) => setLinkValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setLinkOpen(false);
                editor.commands.focus();
              }
            }}
            placeholder="https://example.com"
            aria-invalid={linkError !== null}
            aria-describedby={linkError ? 'editor-link-error' : undefined}
            className="min-h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-2 text-sm"
          />
          <button type="submit" className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>
            Apply
          </button>
          {s.link && (
            <button
              type="button"
              className={btn}
              onClick={() => {
                chain().extendMarkRange('link').unsetLink().run();
                setLinkOpen(false);
              }}
            >
              Remove link
            </button>
          )}
          <button type="button" className={btn} onClick={() => setLinkOpen(false)}>
            Cancel
          </button>
          {linkError && (
            <p id="editor-link-error" role="alert" className="w-full text-sm text-red-700">
              {linkError}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
