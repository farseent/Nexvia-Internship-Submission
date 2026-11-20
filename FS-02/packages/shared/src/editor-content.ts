import { z } from 'zod';
import { parseAssetUrl } from './assets.js';

/**
 * The persisted document format of the rich-text editor, and its validation (D54, D56).
 *
 * A document is the ProseMirror JSON that `editor.getJSON()` produces for the Tiptap
 * extension set in `packages/editor`. That extension set reads its content rules from this
 * module, and `packages/editor` has tests that fail when the two disagree. The same JSON can
 * seed a `Y.Doc` when Yjs arrives (Phase 5), because a Yjs document is built from a
 * ProseMirror schema and this validator accepts exactly what that schema accepts.
 *
 * Pure: no I/O. Error messages never echo document content.
 */

/** Version of the document format. Bump it together with any change to the rules below. */
export const EDITOR_SCHEMA_VERSION = 1;

/** Serialized JSON size limit of one document. Starting value (D54), not tuned. */
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_DOCUMENT_NODES = 20_000;
export const MAX_DOCUMENT_DEPTH = 24;

export const HEADING_LEVELS = [1, 2, 3] as const;
export const TEXT_ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number];
/** Table cells support a narrower set than paragraphs and headings. */
export const TABLE_CELL_ALIGNMENTS = ['left', 'center', 'right'] as const;

export const MAX_LINK_LENGTH = 2048;
export const LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'] as const;

const MAX_ISSUES = 20;
const MAX_IMAGE_TEXT_LENGTH = 500;

// ───────────── Links ─────────────

/** True for an absolute `http`, `https` or `mailto` URL without whitespace or control characters. */
export function isAllowedLinkHref(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LINK_LENGTH) {
    return false;
  }
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u0020\u007f-\u009f]/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'mailto:') return url.pathname.length > 0;
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
}

/**
 * Turn what a person typed into an allowed link target, or `null`. A bare domain gets
 * `https://`, a bare address gets `mailto:`; anything else must already be an allowed URL.
 */
export function normalizeLinkInput(input: string): string | null {
  const text = input.trim();
  if (text === '') return null;
  let candidate = text;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    candidate = /^[^\s/@]+@[^\s/@]+$/.test(text) ? `mailto:${text}` : `https://${text}`;
  }
  try {
    candidate = new URL(candidate).href;
  } catch {
    return null;
  }
  return isAllowedLinkHref(candidate) ? candidate : null;
}

// ───────────── Schema model ─────────────

type AttrCheck = (value: unknown) => boolean;

const nullOr =
  (check: AttrCheck): AttrCheck =>
  (value) =>
    value === null || check(value);
const intBetween =
  (min: number, max: number): AttrCheck =>
  (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const oneOf =
  (...allowed: readonly unknown[]): AttrCheck =>
  (value) =>
    allowed.includes(value);
const stringUpTo =
  (max: number): AttrCheck =>
  (value) =>
    typeof value === 'string' && value.length <= max;
const isBoolean: AttrCheck = (value) => typeof value === 'boolean';

const textAlign = nullOr(oneOf(...TEXT_ALIGNMENTS));
/** A pixel size, as a number or (when it came from pasted HTML) a digit string. */
const pixelSize = nullOr(
  (value) => intBetween(1, 10_000)(value) || (typeof value === 'string' && /^\d{1,5}$/.test(value)),
);
const colwidth = nullOr(
  (value) => Array.isArray(value) && value.length <= 100 && value.every(intBetween(0, 10_000)),
);

/** Content rule of table cells: no nested tables (a restriction of the Tiptap default). */
export const TABLE_CELL_CONTENT =
  '(paragraph | heading | bulletList | orderedList | taskList | image)+';

interface NodeModel {
  /** ProseMirror content expression; absent for leaf nodes. */
  content?: string;
  /** ProseMirror `group`, space separated. */
  group?: string;
  inline?: boolean;
  attrs: Record<string, AttrCheck>;
}

const cellAttrs: Record<string, AttrCheck> = {
  colspan: intBetween(1, 100),
  rowspan: intBetween(1, 100),
  colwidth,
  align: nullOr(oneOf(...TABLE_CELL_ALIGNMENTS)),
};

const NODE_MODELS: Record<string, NodeModel> = {
  doc: { content: 'block+', attrs: {} },
  paragraph: { content: 'inline*', group: 'block', attrs: { textAlign } },
  heading: {
    content: 'inline*',
    group: 'block',
    attrs: { textAlign, level: oneOf(...HEADING_LEVELS) },
  },
  text: { group: 'inline', inline: true, attrs: {} },
  hardBreak: { group: 'inline', inline: true, attrs: {} },
  bulletList: { content: 'listItem+', group: 'block list', attrs: {} },
  orderedList: {
    content: 'listItem+',
    group: 'block list',
    attrs: { start: intBetween(1, 1_000_000), type: nullOr(oneOf('1', 'a', 'A', 'i', 'I')) },
  },
  listItem: { content: 'paragraph block*', attrs: {} },
  taskList: { content: 'taskItem+', group: 'block list', attrs: {} },
  taskItem: { content: 'paragraph block*', attrs: { checked: isBoolean } },
  table: { content: 'tableRow+', group: 'block', attrs: {} },
  tableRow: { content: '(tableCell | tableHeader)*', attrs: {} },
  tableCell: { content: TABLE_CELL_CONTENT, attrs: cellAttrs },
  tableHeader: { content: TABLE_CELL_CONTENT, attrs: cellAttrs },
  image: {
    group: 'block',
    attrs: {
      src: (value) => parseAssetUrl(value) !== null,
      alt: nullOr(stringUpTo(MAX_IMAGE_TEXT_LENGTH)),
      title: nullOr(stringUpTo(MAX_IMAGE_TEXT_LENGTH)),
      width: pixelSize,
      height: pixelSize,
    },
  },
};

const MARK_MODELS: Record<string, Record<string, AttrCheck>> = {
  bold: {},
  italic: {},
  underline: {},
  link: {
    href: isAllowedLinkHref,
    target: nullOr(oneOf('_blank')),
    rel: nullOr(stringUpTo(100)),
    class: nullOr(stringUpTo(100)),
    title: nullOr(stringUpTo(200)),
  },
};

export interface EditorSchemaDescription {
  nodes: Record<
    string,
    { content: string | undefined; group: string | undefined; attrs: string[] }
  >;
  marks: Record<string, string[]>;
}

/**
 * The nodes, content rules, groups and attribute names this validator accepts. The editor
 * package compares it with the ProseMirror schema its extensions produce.
 */
export function describeEditorSchema(): EditorSchemaDescription {
  return {
    nodes: Object.fromEntries(
      Object.entries(NODE_MODELS).map(([name, model]) => [
        name,
        { content: model.content, group: model.group, attrs: Object.keys(model.attrs) },
      ]),
    ),
    marks: Object.fromEntries(
      Object.entries(MARK_MODELS).map(([n, attrs]) => [n, Object.keys(attrs)]),
    ),
  };
}

// ───────────── Content expressions ─────────────

const expressionCache = new Map<string, RegExp>();

/** Node type names a content-expression identifier stands for (a type name or a group name). */
function membersOf(identifier: string): string[] {
  return Object.entries(NODE_MODELS)
    .filter(
      ([name, model]) => name === identifier || (model.group ?? '').split(' ').includes(identifier),
    )
    .map(([name]) => name);
}

/**
 * Compile the subset of ProseMirror content expressions used here (names, groups, sequences,
 * `|`, parentheses and `+ * ?`) into a regular expression over `<type>` tokens.
 */
function compileContentExpression(expression: string): RegExp {
  const cached = expressionCache.get(expression);
  if (cached !== undefined) return cached;
  let source = '^';
  for (const token of expression.match(/[A-Za-z]+|[()|+*?]/g) ?? []) {
    if (/^[A-Za-z]+$/.test(token)) {
      const members = membersOf(token);
      if (members.length === 0)
        throw new Error(`Unknown identifier in content expression: ${token}`);
      source += `(?:${members.map((name) => `<${name}>`).join('|')})`;
    } else if (token === '(') {
      source += '(?:';
    } else {
      source += token;
    }
  }
  const compiled = new RegExp(`${source}$`);
  expressionCache.set(expression, compiled);
  return compiled;
}

// ───────────── Validation ─────────────

export interface EditorMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface EditorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: EditorNode[];
  marks?: EditorMark[];
  text?: string;
}

export interface EditorDocument {
  type: 'doc';
  attrs?: Record<string, unknown>;
  content?: EditorNode[];
}

export interface EditorContentIssue {
  path: (string | number)[];
  message: string;
}

export type EditorContentValidation =
  { ok: true; document: EditorDocument } | { ok: false; issues: EditorContentIssue[] };

/** The smallest valid document: one empty paragraph. */
export function emptyEditorDocument(): EditorDocument {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

interface WalkState {
  issues: EditorContentIssue[];
  nodes: number;
  stopped: boolean;
}

function report(state: WalkState, path: (string | number)[], message: string): void {
  if (state.issues.length < MAX_ISSUES) state.issues.push({ path, message });
  if (state.issues.length >= MAX_ISSUES) state.stopped = true;
}

function checkAttrs(
  state: WalkState,
  path: (string | number)[],
  value: unknown,
  checks: Record<string, AttrCheck>,
): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    report(state, [...path, 'attrs'], 'Attributes must be an object.');
    return;
  }
  for (const key of Object.keys(value)) {
    const check = Object.hasOwn(checks, key) ? checks[key] : undefined;
    if (check === undefined) {
      report(state, [...path, 'attrs', key], 'Unknown attribute.');
    } else if (!check(value[key])) {
      report(state, [...path, 'attrs', key], 'Invalid attribute value.');
    }
  }
}

function checkMarks(state: WalkState, path: (string | number)[], value: unknown): void {
  if (!Array.isArray(value)) {
    report(state, [...path, 'marks'], 'Marks must be an array.');
    return;
  }
  const seen = new Set<string>();
  value.forEach((mark: unknown, index) => {
    const markPath = [...path, 'marks', index];
    if (!isPlainObject(mark) || typeof mark['type'] !== 'string') {
      report(state, markPath, 'Invalid mark.');
      return;
    }
    const extra = Object.keys(mark).filter((key) => key !== 'type' && key !== 'attrs');
    if (extra.length > 0) report(state, markPath, 'Unknown mark field.');
    const type = mark['type'];
    const checks = Object.hasOwn(MARK_MODELS, type) ? MARK_MODELS[type] : undefined;
    if (checks === undefined) {
      report(state, [...markPath, 'type'], 'Unknown mark type.');
      return;
    }
    if (seen.has(type)) report(state, markPath, 'Duplicate mark.');
    seen.add(type);
    checkAttrs(state, markPath, mark['attrs'], checks);
  });
}

function walk(state: WalkState, node: unknown, path: (string | number)[], depth: number): void {
  if (state.stopped) return;
  if (depth > MAX_DOCUMENT_DEPTH) {
    report(state, path, 'The document is nested too deeply.');
    state.stopped = true;
    return;
  }
  if (!isPlainObject(node)) {
    report(state, path, 'A node must be an object.');
    return;
  }
  state.nodes += 1;
  if (state.nodes > MAX_DOCUMENT_NODES) {
    report(state, path, 'The document has too many nodes.');
    state.stopped = true;
    return;
  }
  for (const key of Object.keys(node)) {
    if (!['type', 'attrs', 'content', 'marks', 'text'].includes(key)) {
      report(state, [...path, key], 'Unknown node field.');
    }
  }
  const type = node['type'];
  const model =
    typeof type === 'string' && Object.hasOwn(NODE_MODELS, type) ? NODE_MODELS[type] : undefined;
  if (typeof type !== 'string' || model === undefined) {
    report(state, [...path, 'type'], 'Unknown node type.');
    return;
  }
  if (depth > 0 && type === 'doc') {
    report(state, [...path, 'type'], 'A document cannot contain another document.');
    return;
  }

  checkAttrs(state, path, node['attrs'], model.attrs);

  if (node['marks'] !== undefined) {
    if (model.inline === true) checkMarks(state, path, node['marks']);
    else report(state, [...path, 'marks'], 'Marks are only allowed on inline content.');
  }

  if (type === 'text') {
    if (typeof node['text'] !== 'string' || node['text'] === '') {
      report(state, [...path, 'text'], 'Text nodes need non-empty text.');
    }
    if (node['content'] !== undefined) report(state, [...path, 'content'], 'Text has no content.');
    return;
  }
  if (node['text'] !== undefined) report(state, [...path, 'text'], 'Only text nodes have text.');

  const content = node['content'];
  if (model.content === undefined) {
    if (content !== undefined && !(Array.isArray(content) && content.length === 0)) {
      report(state, [...path, 'content'], 'This node cannot have content.');
    }
    return;
  }
  if (content !== undefined && !Array.isArray(content)) {
    report(state, [...path, 'content'], 'Content must be an array.');
    return;
  }
  const children: unknown[] = content ?? [];
  const before = state.issues.length;
  children.forEach((child, index) => walk(state, child, [...path, 'content', index], depth + 1));
  if (state.stopped || state.issues.length > before) return;
  const sequence = children.map((child) => `<${(child as { type: string }).type}>`).join('');
  if (!compileContentExpression(model.content).test(sequence)) {
    report(state, [...path, 'content'], 'This content is not allowed here.');
  }
}

/**
 * Validate a persisted or submitted document (D54). Checks the size, depth and node limits,
 * node and mark types, attributes (link targets, image sources, heading levels, ...) and the
 * content rules of every node. It never changes the document.
 */
export function validateEditorDocument(value: unknown): EditorContentValidation {
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return { ok: false, issues: [{ path: [], message: 'The document is not valid JSON.' }] };
  }
  if (size > MAX_DOCUMENT_BYTES) {
    return { ok: false, issues: [{ path: [], message: 'The document is too large.' }] };
  }
  if (!isPlainObject(value) || value['type'] !== 'doc') {
    return { ok: false, issues: [{ path: ['type'], message: 'The root must be a document.' }] };
  }
  const state: WalkState = { issues: [], nodes: 0, stopped: false };
  walk(state, value, [], 0);
  if (state.issues.length > 0) return { ok: false, issues: state.issues };
  return { ok: true, document: value as unknown as EditorDocument };
}

/**
 * Zod form of `validateEditorDocument`, for request and response schemas. It is a refinement
 * (no transform) so that it also works when Zod encodes a response, and it is typed as the
 * document it has verified.
 */
export const editorDocumentSchema = z.unknown().superRefine((value, ctx) => {
  const result = validateEditorDocument(value);
  if (result.ok) return;
  for (const issue of result.issues) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
  }
}) as unknown as z.ZodType<EditorDocument>;
