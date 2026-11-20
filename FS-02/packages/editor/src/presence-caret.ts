import { Extension } from '@tiptap/core';
import { yCursorPlugin } from '@tiptap/y-tiptap';
import type { Awareness } from 'y-protocols/awareness';
import {
  AWARENESS_CURSOR_FIELD,
  parseRelayedAwareness,
  readableTextColor,
  type PresenceIdentity,
} from '@conote/shared';

/*
 * Collaborator carets and selections (Phase 7, FR-PR-02/03, WEBSOCKET_PROTOCOL §18).
 *
 * The Yjs cursor plugin does the hard part: it publishes the local selection as Yjs relative
 * positions (so it follows the text through concurrent edits) and turns every collaborator's
 * published selection into ProseMirror *decorations*. Decorations are drawn over the document
 * and are never part of it: they are not in the schema, not in the Yjs fragment, not in
 * `editor.getJSON()` and not stored. This module only decides what is drawn and for whom.
 *
 * What is drawn comes from the server (D61): name and colour are the identity the server
 * built for that connection. The editor validates them again and only ever writes them with
 * `textContent` and `CSSStyleDeclaration`, never as markup.
 */

/** Default minimum time between two published cursor changes. */
export const CURSOR_PUBLISH_INTERVAL_MS = 80;

/**
 * Publishes the cursor field at most once per `intervalMs`, latest value wins. Dragging a
 * selection changes it dozens of times a second; every change is a WebSocket message and a
 * broadcast to everyone on the page. Clearing the cursor (blur) is never delayed.
 */
export class CursorPublisher {
  private pending: { value: unknown } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastSentAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly awareness: Awareness,
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  publish(value: unknown): void {
    if (value === null || value === undefined || this.intervalMs <= 0) {
      this.cancel();
      this.send(value);
      return;
    }
    const wait = this.lastSentAt + this.intervalMs - this.now();
    if (wait <= 0 && this.timer === undefined) {
      this.send(value);
      return;
    }
    this.pending = { value };
    this.timer ??= setTimeout(
      () => {
        this.timer = undefined;
        const next = this.pending;
        this.pending = null;
        if (next) this.send(next.value);
      },
      Math.max(wait, 0),
    );
  }

  /** Drop what is waiting and stop the timer (the editor is going away). */
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = null;
  }

  private send(value: unknown): void {
    this.lastSentAt = this.now();
    this.awareness.setLocalStateField(AWARENESS_CURSOR_FIELD, value);
  }
}

/**
 * The part of `Awareness` the cursor plugin uses, with cursor writes going through the
 * publisher. A plain object instead of a subclass: the real awareness belongs to the session.
 */
function throttledView(awareness: Awareness, publisher: CursorPublisher): Awareness {
  return {
    getStates: () => awareness.getStates(),
    getLocalState: () => awareness.getLocalState(),
    on: (name: string, listener: never) => awareness.on(name, listener),
    off: (name: string, listener: never) => awareness.off(name, listener),
    setLocalStateField: (field: string, value: unknown) => {
      if (field === AWARENESS_CURSOR_FIELD) publisher.publish(value);
      else awareness.setLocalStateField(field, value);
    },
    // The plugin reads nothing else; a cast keeps the structural view from becoming a class.
  } as unknown as Awareness;
}

/** The caret of one collaborator: a thin coloured line with their name above it. */
export function buildCaret(user: PresenceIdentity): HTMLElement {
  const caret = document.createElement('span');
  caret.className = 'conote-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.dataset.userId = user.id;
  caret.style.setProperty('--conote-caret-color', user.color);
  caret.style.setProperty('--conote-caret-text', readableTextColor(user.color));
  const flag = document.createElement('span');
  flag.className = 'conote-caret__flag';
  flag.textContent = user.name; // text, never markup: the name is data
  caret.append(flag);
  return caret;
}

/** The highlight of a collaborator's selection, in their colour at low opacity. */
export function buildSelection(user: PresenceIdentity): { class: string; style: string } {
  // `user.color` is `#RRGGBB` (validated by `parseRelayedAwareness`); `33` is about 20% alpha.
  return { class: 'conote-selection', style: `background-color: ${user.color}33` };
}

export interface PresenceCaretOptions {
  /** Minimum time between two published cursor changes; 0 publishes every change. */
  publishIntervalMs?: number;
}

/**
 * Tiptap extension that shows collaborators' carets and selections and publishes this
 * editor's own cursor through `awareness`. Add it after the Collaboration extension, which
 * provides the Yjs sync plugin it reads positions from.
 */
export function createPresenceCaret(awareness: Awareness, options: PresenceCaretOptions = {}) {
  const publisher = new CursorPublisher(
    awareness,
    options.publishIntervalMs ?? CURSOR_PUBLISH_INTERVAL_MS,
  );
  return Extension.create({
    name: 'presenceCaret',
    addProseMirrorPlugins() {
      return [
        yCursorPlugin(throttledView(awareness, publisher), {
          // Draw only well-formed states of other clients; anything else is ignored.
          awarenessStateFilter: (ownClientId: number, clientId: number, state: unknown) =>
            clientId !== ownClientId && parseRelayedAwareness(state)?.cursor !== undefined,
          // The filter has accepted the state, so these always find a valid identity; the
          // fallbacks only keep a surprise from throwing inside the editor's render.
          cursorBuilder: (user: unknown) => {
            const state = parseRelayedAwareness({ user });
            return state ? buildCaret(state.user) : document.createElement('span');
          },
          selectionBuilder: (user: unknown) => {
            const state = parseRelayedAwareness({ user });
            return state ? buildSelection(state.user) : {};
          },
        }),
      ];
    },
    onDestroy() {
      publisher.cancel();
    },
  });
}
