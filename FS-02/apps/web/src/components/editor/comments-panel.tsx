'use client';

import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createCommentAnchor,
  setActiveCommentThread,
  setCommentThreads,
  type ResolvedRanges,
} from '@conote/editor/collaboration';
import { anchorFromBase64, anchorToBase64, type ThreadDto } from '@conote/shared';
import { api, describeApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import type { CollabState } from '@/lib/collab-session';
import { useLoad, useReloadOn } from '@/lib/use-load';

interface Props {
  editor: Editor;
  pageId: string;
  state: CollabState;
  /** PAGE role Commenter or above (a hint; the API decides). */
  canComment: boolean;
  /** Where each thread is in the live document; `null` = detached. */
  ranges: ResolvedRanges;
  /** The document has synced, so an anchor that does not resolve really is detached. */
  ready: boolean;
}

const NO_THREADS: ThreadDto[] = [];

const inputClass =
  'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600';
const buttonClass =
  'rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50';

/**
 * Comments of the page (FR-CM-01 … 06; D8). Threads live in the API, not in the document: this
 * panel lists them, draws their highlights through the editor plugin (decorations only) and
 * refetches whenever the server says they may have changed.
 */
export function CommentsPanel({ editor, pageId, state, canComment, ranges, ready }: Props) {
  const { user } = useAuth();
  const load = useCallback(() => api.listThreads(pageId), [pageId]);
  const { data, error, reload } = useLoad(load);
  // The server says the threads may have changed (or the connection came back): fetch them again.
  useReloadOn(state.commentsTick, reload);
  const [filter, setFilter] = useState<'open' | 'resolved'>('open');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Stable between renders: the highlight effect below dispatches, which renders again.
  const threads = useMemo(() => data?.threads ?? NO_THREADS, [data]);

  // Highlights follow the thread list; positions are computed from the live document.
  useEffect(() => {
    setCommentThreads(
      editor,
      threads.map((t) => ({
        id: t.id,
        resolved: t.resolvedAt !== null,
        anchor: { start: anchorFromBase64(t.anchor.start), end: anchorFromBase64(t.anchor.end) },
      })),
    );
  }, [editor, threads, ready]);

  useEffect(() => {
    setActiveCommentThread(editor, activeId);
  }, [editor, activeId]);

  // Whether there is a selection to comment on.
  useEffect(() => {
    const update = () => setHasSelection(!editor.state.selection.empty);
    update();
    editor.on('selectionUpdate', update);
    return () => void editor.off('selectionUpdate', update);
  }, [editor]);

  // Clicking a highlight opens its thread.
  useEffect(() => {
    const dom = editor.view.dom;
    const onClick = (event: Event) => {
      const el = (event.target as HTMLElement | null)?.closest('[data-comment-thread]');
      const id = el?.getAttribute('data-comment-thread');
      if (id) setActiveId(id);
    };
    dom.addEventListener('click', onClick);
    return () => dom.removeEventListener('click', onClick);
  }, [editor]);

  /** Run an API action; resolves to whether it worked, so a draft is kept when it did not. */
  const act = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      reload();
      return true;
    } catch (err) {
      setMessage(describeApiError(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startThread = () => {
    const { from, to } = editor.state.selection;
    const created = createCommentAnchor(editor.state, from, to);
    const body = draft.trim();
    if (created === null || body === '') return;
    void act(async () => {
      const { thread } = await api.createThread(pageId, {
        anchor: {
          start: anchorToBase64(created.anchor.start),
          end: anchorToBase64(created.anchor.end),
        },
        quotedText: created.quotedText,
        body,
      });
      setDraft('');
      setActiveId(thread.id);
    });
  };

  const visible = threads.filter((t) =>
    filter === 'open' ? t.resolvedAt === null : t.resolvedAt !== null,
  );
  const isDetached = (t: ThreadDto) =>
    ranges.has(t.id) ? ranges.get(t.id) === null : t.anchorStatus === 'DETACHED';

  return (
    <section aria-label="Comments" className="space-y-3 text-sm">
      {canComment ? (
        <div className="space-y-2 rounded-md border border-slate-200 p-2">
          <label htmlFor="new-comment" className="block text-xs font-medium text-slate-600">
            {hasSelection ? 'Comment on the selected text' : 'Select text to comment on it'}
          </label>
          <textarea
            id="new-comment"
            className={inputClass}
            rows={2}
            maxLength={5000}
            value={draft}
            disabled={!hasSelection || busy || !ready}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="button"
            className={buttonClass}
            disabled={!hasSelection || draft.trim() === '' || busy || !ready}
            onClick={startThread}
          >
            Comment
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          You can read comments on this page but not add any.
        </p>
      )}

      <div role="tablist" aria-label="Comment filter" className="flex gap-1">
        {(['open', 'resolved'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={filter === value}
            className={`${buttonClass} ${filter === value ? 'bg-slate-100' : ''}`}
            onClick={() => setFilter(value)}
          >
            {value === 'open' ? 'Open' : 'Resolved'}
          </button>
        ))}
      </div>

      {(error || message) && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-2 text-red-800">
          {message ?? error}
        </p>
      )}
      {data !== null && visible.length === 0 && (
        <p className="text-slate-500">
          {filter === 'open' ? 'No open comments.' : 'No resolved comments.'}
        </p>
      )}

      <ul className="space-y-2">
        {visible.map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            active={thread.id === activeId}
            detached={ready && isDetached(thread)}
            canComment={canComment}
            busy={busy}
            currentUserId={user?.id ?? null}
            onSelect={() => {
              setActiveId(thread.id);
              const range = ranges.get(thread.id);
              if (range) {
                editor.commands.setTextSelection(range);
                editor.commands.scrollIntoView();
              }
            }}
            onReply={(body) => act(() => api.replyToThread(thread.id, body))}
            onToggle={() =>
              void act(() =>
                thread.resolvedAt === null
                  ? api.resolveThread(thread.id)
                  : api.reopenThread(thread.id),
              )
            }
            onDelete={(commentId) => void act(() => api.deleteComment(commentId))}
          />
        ))}
      </ul>
    </section>
  );
}

function ThreadCard({
  thread,
  active,
  detached,
  canComment,
  busy,
  currentUserId,
  onSelect,
  onReply,
  onToggle,
  onDelete,
}: {
  thread: ThreadDto;
  active: boolean;
  detached: boolean;
  canComment: boolean;
  busy: boolean;
  currentUserId: string | null;
  onSelect: () => void;
  onReply: (body: string) => Promise<boolean>;
  onToggle: () => void;
  onDelete: (commentId: string) => void;
}) {
  const [reply, setReply] = useState('');
  return (
    <li
      data-testid="comment-thread"
      data-thread-id={thread.id}
      className={`space-y-2 rounded-md border p-2 ${active ? 'border-sky-500 bg-sky-50' : 'border-slate-200'}`}
    >
      <button type="button" className="block w-full text-left" onClick={onSelect}>
        <span className="block truncate text-xs italic text-slate-600">“{thread.quotedText}”</span>
        {detached && (
          <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
            Detached: the commented text was changed or removed
          </span>
        )}
        {thread.resolvedAt !== null && (
          <span className="mt-1 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900">
            Resolved{thread.resolvedBy ? ` by ${thread.resolvedBy.displayName}` : ''}
          </span>
        )}
      </button>
      <ul className="space-y-1.5">
        {thread.comments.map((comment) => (
          <li key={comment.id} className="rounded bg-white/60 p-1.5">
            <div className="flex items-baseline justify-between gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">
                {comment.author?.displayName ?? 'Former member'}
              </span>
              <time dateTime={comment.createdAt}>
                {new Date(comment.createdAt).toLocaleString()}
              </time>
            </div>
            <p className="whitespace-pre-wrap break-words">{comment.body}</p>
            {comment.author?.id === currentUserId && canComment && (
              <button
                type="button"
                className="mt-1 text-xs text-slate-500 underline"
                disabled={busy}
                onClick={() => onDelete(comment.id)}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
      {canComment && (
        <div className="space-y-1">
          <label className="sr-only" htmlFor={`reply-${thread.id}`}>
            Reply
          </label>
          <textarea
            id={`reply-${thread.id}`}
            className={inputClass}
            rows={1}
            maxLength={5000}
            placeholder="Reply…"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              className={buttonClass}
              disabled={busy || reply.trim() === ''}
              onClick={() => {
                void onReply(reply.trim()).then((ok) => {
                  if (ok) setReply('');
                });
              }}
            >
              Reply
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => onToggle()}
            >
              {thread.resolvedAt === null ? 'Resolve' : 'Reopen'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
