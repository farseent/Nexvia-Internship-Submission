'use client';

import type { CollabState } from '@/lib/collab-session';

/**
 * The connection indicator under the toolbar. It says what is true of the connection, never
 * "saved": the server stores changes shortly after they arrive, and the client cannot see that.
 */
export function CollabStatus({ state, onRetry }: { state: CollabState; onRetry: () => void }) {
  if (state.phase === 'offline') {
    return (
      <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-amber-800">
        <span>
          Offline. Your changes are kept here and will be sent when the connection is back.
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Reconnect now
        </button>
      </p>
    );
  }
  if (state.phase === 'connecting') {
    return (
      <p role="status" className="text-sm text-slate-600">
        Connecting…
      </p>
    );
  }
  if (state.unsyncedChanges) {
    return (
      <p role="status" className="text-sm text-slate-600">
        Syncing…
      </p>
    );
  }
  return (
    <p role="status" className="text-sm text-slate-500">
      Live
    </p>
  );
}
