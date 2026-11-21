'use client';

import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createEditorExtensions } from '@conote/editor';
import { createCollaborativeRegistry, type ResolvedRanges } from '@conote/editor/collaboration';
import type { VersionMetaDto } from '@conote/shared';
import type * as Y from 'yjs';
import { describeApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import type { CollabSession, CollabState } from '@/lib/collab-session';
import { useCollabSession } from '@/lib/use-collab-session';
import { usePresence } from '@/lib/use-presence';
import {
  IMAGE_ACCEPT,
  ImageUploadError,
  checkImageFile,
  uploadPageImage,
} from '@/lib/image-upload';
import { EditorToolbar } from './editor-toolbar';
import { CollabStatus } from './collab-status';
import { PresenceBar } from './presence-bar';
import { createSlashMenuRender } from './slash-menu';
import { CommentsPanel } from './comments-panel';
import { VersionHistoryPanel, VersionPreview } from './version-history';

const IMAGE_INPUT_ID = 'editor-image-input';

/** Open the image picker. There is one editor per page, so the input is found by its id. */
function openImagePicker(): void {
  document.getElementById(IMAGE_INPUT_ID)?.click();
}

interface Props {
  pageId: string;
  /**
   * Whether the page's role allows editing (EDITOR or above), from the page list. A hint only:
   * the collaboration server decides, and a read-only connection cannot change the document.
   */
  canEdit: boolean;
  /** Whether the page's role allows commenting (COMMENTER or above); defaults to `canEdit`. */
  canComment?: boolean;
  /** Receives the editor once created; used by tests and future features. */
  onReady?: (editor: Editor) => void;
}

const alertBox = 'rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800';

/**
 * The page's editor, connected to the live document (WEBSOCKET_PROTOCOL §6). The document
 * itself is the Yjs document on the collaboration server: there is no separate save step, so
 * this component has no save button, no revision and no conflict dialog.
 */
export function PageEditor({ pageId, canEdit, canComment, onReady }: Props) {
  const { session, state } = useCollabSession(pageId);

  if (state === null || session === null || (state.phase === 'connecting' && !state.everSynced)) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="animate-pulse space-y-3 py-4"
        aria-label="Loading document"
      >
        <div className="h-4 w-3/4 rounded bg-slate-200" />
        <div className="h-4 w-full rounded bg-slate-200" />
        <div className="h-4 w-2/3 rounded bg-slate-200" />
        <span className="sr-only">Loading document…</span>
      </div>
    );
  }
  if (state.phase === 'denied' || state.phase === 'revoked') {
    return (
      <div role="alert" className={alertBox}>
        <p>{state.reason ?? 'This page is no longer available to you.'}</p>
      </div>
    );
  }
  if (state.phase === 'unavailable' || session.doc === null) {
    return (
      <div role="alert" className={alertBox}>
        <p>The document could not be opened right now. We will keep trying.</p>
        <button
          type="button"
          onClick={() => session.retry()}
          className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium hover:bg-red-100"
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <LoadedEditor
      key={state.generation}
      pageId={pageId}
      canEdit={canEdit}
      canComment={canComment ?? canEdit}
      doc={session.doc}
      session={session}
      state={state}
      {...(onReady ? { onReady } : {})}
    />
  );
}

function LoadedEditor({
  pageId,
  canEdit,
  canComment,
  doc,
  session,
  state,
  onReady,
}: Props & { canComment: boolean; doc: Y.Doc; session: CollabSession; state: CollabState }) {
  const { guard, user } = useAuth();
  const uploadRef = useRef<(files: File[]) => void>(() => undefined);
  const [uploading, setUploading] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  // While a version is restored the server holds writes back; the editor says so instead of
  // accepting typing that would be refused (D62).
  const editable = canEdit && !state.readOnly && !state.restoring;
  const [panel, setPanel] = useState<'comments' | 'history' | null>(null);
  const [previewVersion, setPreviewVersion] = useState<VersionMetaDto | null>(null);
  const [ranges, setRanges] = useState<ResolvedRanges>(new Map());

  // Built once per document: the registry holds the extensions, the host connects them to the page.
  const [extensions] = useState(() =>
    createEditorExtensions(
      createCollaborativeRegistry(doc, {
        ...(session.awareness ? { awareness: session.awareness } : {}),
        comments: {
          onResolved: setRanges,
          // Nothing is judged detached before the document has synced.
          isReady: () => {
            const current = session.getState();
            return current.phase === 'live' && current.everSynced;
          },
        },
      }),
      {
        host: { requestImage: openImagePicker },
        renderSlashMenu: createSlashMenuRender(),
      },
    ),
  );
  const { collaborators, notices } = usePresence(
    session.awareness,
    state.phase === 'live',
    user ? { id: user.id, name: user.displayName, color: user.presenceColor } : null,
  );

  const editor = useEditor({
    extensions,
    editable,
    immediatelyRender: false, // the page is server-rendered; the editor mounts on the client
    editorProps: {
      attributes: {
        class: 'conote-prose',
        'aria-label': 'Page content',
        'aria-multiline': 'true',
      },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (files.length === 0) return false;
        uploadRef.current(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = imageFiles(event.dataTransfer?.files);
        if (moved || files.length === 0) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (at)
          view.dispatch(
            view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))),
          );
        event.preventDefault();
        uploadRef.current(files);
        return true;
      },
    },
  });

  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);

  // Follows the server: a downgrade or upgrade arrives as a state change.
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // Leaving with changes the server has not confirmed would lose them: ask first.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!session.hasUnsyncedChanges()) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [session]);

  // Images: picker, paste and drop all end up here.
  const uploadFiles = useCallback(
    (files: File[]) => {
      if (!editor || !editable) return;
      void (async () => {
        setNotice(null);
        setUploading((n) => n + files.length);
        for (const file of files) {
          try {
            checkImageFile(file);
            const { url, alt } = await uploadPageImage(pageId, file, guard);
            editor.chain().focus().setImage({ src: url, alt }).run();
          } catch (error) {
            setNotice(error instanceof ImageUploadError ? error.message : describeApiError(error));
          } finally {
            setUploading((n) => n - 1);
          }
        }
      })();
    },
    [editor, editable, pageId, guard],
  );
  // The editor's paste/drop handlers are created once; they call the latest function.
  useEffect(() => {
    uploadRef.current = uploadFiles;
  }, [uploadFiles]);

  return (
    <div className="conote-editor" data-editable={editable ? 'true' : 'false'}>
      {editable && editor && (
        <>
          <EditorToolbar
            editor={editor}
            onRequestImage={openImagePicker}
            uploading={uploading > 0}
          />
          <input
            id={IMAGE_INPUT_ID}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            className="sr-only"
            aria-label="Choose images to insert"
            tabIndex={-1}
            onChange={(event) => {
              uploadFiles([...(event.target.files ?? [])]);
              event.target.value = ''; // allow choosing the same file again
            }}
          />
        </>
      )}
      <div className="mt-2 flex min-h-6 flex-wrap items-center justify-between gap-2">
        <CollabStatus state={state} onRetry={() => session.retry()} />
        <PresenceBar
          collaborators={collaborators}
          notices={notices}
          live={state.phase === 'live'}
        />
      </div>
      {!editable && (
        <p className="mb-2 text-sm text-slate-500" role="note">
          You have read-only access to this page.
        </p>
      )}
      {notice && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800"
        >
          {notice}
        </p>
      )}
      {state.restoring && (
        <p
          role="status"
          className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900"
        >
          A version is being restored. Editing is paused for a moment.
        </p>
      )}
      <div className="mt-2 flex gap-2" role="group" aria-label="Page panels">
        {(['comments', 'history'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={panel === value}
            onClick={() => setPanel(panel === value ? null : value)}
            className={`rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 ${panel === value ? 'bg-slate-100' : 'bg-white'}`}
          >
            {value === 'comments' ? 'Comments' : 'Version history'}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          {previewVersion && (
            <VersionPreview
              pageId={pageId}
              version={previewVersion}
              session={session}
              state={state}
              canEdit={canEdit}
              onClose={() => setPreviewVersion(null)}
            />
          )}
          <div hidden={previewVersion !== null}>
            <EditorContent editor={editor} />
          </div>
        </div>
        {editor && (
          <aside
            hidden={panel === null}
            aria-label="Page side panel"
            className="w-full shrink-0 lg:w-80"
          >
            {/* The comments panel stays mounted: it draws the highlights even when it is hidden. */}
            <div hidden={panel !== 'comments'}>
              <CommentsPanel
                editor={editor}
                pageId={pageId}
                state={state}
                canComment={canComment}
                ranges={ranges}
                ready={state.phase === 'live' && state.everSynced}
              />
            </div>
            {panel === 'history' && (
              <VersionHistoryPanel
                pageId={pageId}
                session={session}
                state={state}
                canEdit={canEdit}
                selected={previewVersion}
                onSelect={setPreviewVersion}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith('image/'));
}
