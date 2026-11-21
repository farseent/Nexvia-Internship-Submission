'use client';

import { useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { useEditor, EditorContent } from '@tiptap/react';
import { createDefaultRegistry, createEditorExtensions } from '@conote/editor';
import { ydocToContent } from '@conote/editor/collaboration';
import type { VersionMetaDto } from '@conote/shared';
import { api, describeApiError } from '@/lib/api-client';
import type { CollabSession, CollabState } from '@/lib/collab-session';
import { useLoad, useReloadOn } from '@/lib/use-load';

const buttonClass =
  'rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50';

const KIND_LABEL = { AUTO: 'Automatic', MANUAL: 'Saved', PRE_RESTORE: 'Before a restore' } as const;

interface Props {
  pageId: string;
  session: CollabSession;
  state: CollabState;
  /** Whether this person may save and restore versions (Editor or above). The server decides. */
  canEdit: boolean;
  selected: VersionMetaDto | null;
  onSelect: (version: VersionMetaDto | null) => void;
}

/** The page's version history (FR-VH-01 … 06; D9). */
export function VersionHistoryPanel({
  pageId,
  session,
  state,
  canEdit,
  selected,
  onSelect,
}: Props) {
  const load = useCallback(() => api.listVersions(pageId), [pageId]);
  const { data, error, reload } = useLoad(load);
  useReloadOn(state.versionsTick, reload);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const writable = canEdit && !state.readOnly && state.phase === 'live' && !state.restoring;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const result = await session.createVersion(label.trim() === '' ? undefined : label.trim());
    setBusy(false);
    if (result.ok) setLabel('');
    else setMessage(result.message);
  };

  return (
    <section aria-label="Version history" className="space-y-3 text-sm">
      {canEdit && (
        <div className="space-y-2 rounded-md border border-slate-200 p-2">
          <label htmlFor="version-label" className="block text-xs font-medium text-slate-600">
            Save the page as it is now
          </label>
          <input
            id="version-label"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            maxLength={120}
            placeholder="Name (optional)"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <button
            type="button"
            className={buttonClass}
            disabled={!writable || busy}
            onClick={() => void save()}
          >
            Save version
          </button>
        </div>
      )}
      {(error || message) && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-2 text-red-800">
          {message ?? error}
        </p>
      )}
      {state.restoreError && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-2 text-red-800">
          {state.restoreError}
        </p>
      )}
      {data !== null && data.versions.length === 0 && (
        <p className="text-slate-500">No versions yet.</p>
      )}
      <ul className="space-y-1.5">
        {(data?.versions ?? []).map((version) => (
          <li key={version.id}>
            <button
              type="button"
              aria-pressed={selected?.id === version.id}
              onClick={() => onSelect(selected?.id === version.id ? null : version)}
              className={`block w-full rounded-md border p-2 text-left ${selected?.id === version.id ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'}`}
            >
              <span className="block font-medium">{version.label ?? KIND_LABEL[version.kind]}</span>
              <span className="block text-xs text-slate-500">
                {KIND_LABEL[version.kind]} ·{' '}
                <time dateTime={version.createdAt}>
                  {new Date(version.createdAt).toLocaleString()}
                </time>
              </span>
              <span className="block text-xs text-slate-500">
                {version.createdBy ? `By ${version.createdBy.displayName}` : 'Automatic'}
                {version.contributors.length > 0
                  ? ` · Edited by ${version.contributors.map((u) => u.displayName).join(', ')}`
                  : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A previous version, read-only (FR-VH-04): its state is loaded into a separate Y.Doc that is not
 * connected to anything, so looking at history can never change the page.
 */
export function VersionPreview({
  pageId,
  version,
  session,
  state,
  canEdit,
  onClose,
}: {
  pageId: string;
  version: VersionMetaDto;
  session: CollabSession;
  state: CollabState;
  canEdit: boolean;
  onClose: () => void;
}) {
  // The result belongs to one version; switching versions shows "Loading" until the next arrives.
  const [loaded, setLoaded] = useState<{
    versionId: string;
    content: ReturnType<typeof ydocToContent> | null;
    error: string | null;
  } | null>(null);
  const current = loaded?.versionId === version.id ? loaded : null;
  const content = current?.content ?? null;
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? current?.error ?? null;
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getVersionState(pageId, version.id).then(
      (bytes) => {
        if (cancelled) return;
        const doc = new Y.Doc();
        try {
          Y.applyUpdate(doc, bytes);
          setLoaded({ versionId: version.id, content: ydocToContent(doc), error: null });
        } catch {
          setLoaded({
            versionId: version.id,
            content: null,
            error: 'This version cannot be shown.',
          });
        } finally {
          doc.destroy();
        }
      },
      (err: unknown) => {
        if (!cancelled)
          setLoaded({ versionId: version.id, content: null, error: describeApiError(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pageId, version.id]);

  const canRestore = canEdit && !state.readOnly && state.phase === 'live' && !state.restoring;

  const restore = async () => {
    setRestoring(true);
    setActionError(null);
    const result = await session.restoreVersion(version.id);
    setRestoring(false);
    setConfirming(false);
    if (result.ok) onClose();
    else setActionError(result.message);
  };

  return (
    <div
      data-testid="version-preview"
      className="mt-3 rounded-md border border-slate-300 bg-slate-50 p-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Viewing {version.label ?? KIND_LABEL[version.kind]} from{' '}
          {new Date(version.createdAt).toLocaleString()}{' '}
          <span className="font-normal text-slate-500">(read only)</span>
        </p>
        <div className="flex gap-2">
          {canRestore && !confirming && (
            <button type="button" className={buttonClass} onClick={() => setConfirming(true)}>
              Restore this version
            </button>
          )}
          <button type="button" className={buttonClass} onClick={onClose}>
            Back to the page
          </button>
        </div>
      </div>
      {confirming && (
        <div
          role="alertdialog"
          aria-label="Confirm restore"
          className="mb-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm"
        >
          <p>
            Restore this version for everyone? The page as it is now is saved first, so you can come
            back to it.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={restoring}
              onClick={() => void restore()}
            >
              Restore
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={restoring}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mb-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {content === null && !error && <p className="text-sm text-slate-500">Loading version…</p>}
      {content !== null && <PreviewContent content={content} />}
    </div>
  );
}

function PreviewContent({ content }: { content: ReturnType<typeof ydocToContent> }) {
  const [extensions] = useState(() =>
    createEditorExtensions(createDefaultRegistry({ undoRedo: false }), { host: {} }),
  );
  const editor = useEditor({
    extensions,
    content,
    editable: false,
    immediatelyRender: false,
    editorProps: { attributes: { class: 'conote-prose', 'aria-label': 'Version content' } },
  });
  return <EditorContent editor={editor} />;
}
