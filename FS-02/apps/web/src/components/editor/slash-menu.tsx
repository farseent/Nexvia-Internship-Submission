'use client';

import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { ReactRenderer } from '@tiptap/react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type {
  SlashCommandDefinition,
  SlashMenuRender,
  SuggestionKeyDownProps,
  SuggestionProps,
} from '@conote/editor';

export interface SlashMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const LIST_ID = 'slash-menu-list';

/** The list of matching commands. Keyboard handling is driven by the suggestion plugin. */
const SlashMenu = forwardRef<
  SlashMenuHandle,
  SuggestionProps<SlashCommandDefinition, SlashCommandDefinition>
>(function SlashMenu({ items, command }, ref) {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => setSelected(0), [items]);
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (items.length === 0) return false;
      if (event.key === 'ArrowDown') {
        setSelected((index) => (index + 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowUp') {
        setSelected((index) => (index - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  return (
    <div className="w-72 max-w-[calc(100vw-1rem)] rounded-md border border-slate-200 bg-white p-1 shadow-lg">
      {items.length === 0 ? (
        <p role="status" className="px-3 py-2 text-sm text-slate-500">
          No matching commands
        </p>
      ) : (
        <ul
          ref={listRef}
          id={LIST_ID}
          role="listbox"
          aria-label="Insert"
          className="max-h-72 overflow-y-auto"
        >
          {items.map((item, index) => (
            <li
              key={item.id}
              id={`slash-option-${item.id}`}
              role="option"
              aria-selected={index === selected}
              onMouseEnter={() => setSelected(index)}
              // mousedown, not click: the editor must not lose focus before the command runs.
              onMouseDown={(event) => {
                event.preventDefault();
                command(item);
              }}
              className={`cursor-pointer rounded px-3 py-2 ${index === selected ? 'bg-indigo-50' : ''}`}
            >
              <div className="text-sm font-medium text-slate-900">{item.title}</div>
              <div className="text-xs text-slate-500">{item.description}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

/** Slash menu renderer for the editor package's `SlashCommand` extension. */
export function createSlashMenuRender(): SlashMenuRender {
  return () => {
    let renderer: ReactRenderer<
      SlashMenuHandle,
      SuggestionProps<SlashCommandDefinition, SlashCommandDefinition>
    > | null = null;
    let host: HTMLElement | null = null;

    const place = (props: SuggestionProps<SlashCommandDefinition, SlashCommandDefinition>) => {
      const rect = props.clientRect?.();
      if (host === null || !rect) return;
      const target = host;
      void computePosition({ getBoundingClientRect: () => rect }, target, {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [offset(6), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        target.style.left = `${x}px`;
        target.style.top = `${y}px`;
      });
    };

    const announce = (
      props: SuggestionProps<SlashCommandDefinition, SlashCommandDefinition>,
      open: boolean,
    ) => {
      const dom = props.editor.view.dom;
      if (open) {
        dom.setAttribute('aria-haspopup', 'listbox');
        dom.setAttribute('aria-expanded', 'true');
        dom.setAttribute('aria-controls', LIST_ID);
      } else {
        dom.removeAttribute('aria-expanded');
        dom.removeAttribute('aria-controls');
      }
    };

    return {
      onStart: (props) => {
        renderer = new ReactRenderer(SlashMenu, { props, editor: props.editor });
        host = renderer.element as HTMLElement;
        host.style.position = 'fixed';
        host.style.zIndex = '50';
        host.style.left = '0';
        host.style.top = '0';
        document.body.appendChild(host);
        announce(props, true);
        place(props);
      },
      onUpdate: (props) => {
        renderer?.updateProps(props);
        if (host) host.style.display = '';
        place(props);
      },
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === 'Escape') {
          if (host) host.style.display = 'none';
          return true;
        }
        return renderer?.ref?.onKeyDown(event) ?? false;
      },
      onExit: (props) => {
        announce(props, false);
        renderer?.destroy();
        host?.remove();
        renderer = null;
        host = null;
      },
    };
  };
}
