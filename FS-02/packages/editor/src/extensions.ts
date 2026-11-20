import type { Extensions } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import {
  HEADING_LEVELS,
  TABLE_CELL_CONTENT,
  TEXT_ALIGNMENTS,
  isAllowedLinkHref,
  parseAssetUrl,
} from '@conote/shared';

export interface BaseExtensionOptions {
  /** Text shown in an empty document. */
  placeholder?: string;
  /**
   * Keep the built-in undo/redo (default). Set to `false` when the Yjs collaboration binding
   * is added: it brings its own history and the two must not both be active (D20).
   */
  undoRedo?: boolean;
}

/**
 * Text structure, marks, links and lists. Only the features of the approved document schema
 * are enabled: StarterKit also ships blockquote, code, code block, horizontal rule and
 * strikethrough, which the schema does not contain (D56).
 */
export function coreExtensions(options: BaseExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      strike: false,
      heading: { levels: [...HEADING_LEVELS] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        isAllowedUri: (url: string) => isAllowedLinkHref(url),
      },
      ...(options.undoRedo === false ? { undoRedo: false as const } : {}),
    }),
  ];
}

export function taskListExtensions(): Extensions {
  return [TaskList, TaskItem.configure({ nested: true })];
}

/** Tables without nested tables; cells follow the shared content rule. */
export function tableExtensions(): Extensions {
  return [
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader.extend({ content: TABLE_CELL_CONTENT }),
    TableCell.extend({ content: TABLE_CELL_CONTENT }),
  ];
}

export function textAlignExtensions(): Extensions {
  return [
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: [...TEXT_ALIGNMENTS] }),
  ];
}

/**
 * Block images. Only the stable asset URL is accepted (docs/API_CONTRACTS.md ASSET-03), so
 * pasted images from other sites and `data:` URLs are dropped instead of embedded.
 */
export function imageExtensions(): Extensions {
  return [
    Image.configure({ inline: false, allowBase64: false }).extend({
      parseHTML() {
        return [
          {
            tag: 'img[src]',
            getAttrs: (element) =>
              typeof element === 'string' || parseAssetUrl(element.getAttribute('src')) === null
                ? false
                : {},
          },
        ];
      },
    }),
  ];
}

export function placeholderExtensions(text: string): Extensions {
  return [Placeholder.configure({ placeholder: text })];
}
