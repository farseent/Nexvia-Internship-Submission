'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { initialsOf, readableTextColor, type PresenceCollaborator } from '@conote/shared';
import type { PresenceEvent } from '@/lib/presence-tracker';

const MAX_AVATARS = 4;

function Avatar({ person, size = 'sm' }: { person: PresenceCollaborator; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      data-testid="presence-avatar"
      data-user-id={person.userId}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border-2 border-white font-semibold ${
        size === 'sm' ? 'h-7 w-7 text-[0.7rem]' : 'h-8 w-8 text-xs'
      }`}
      style={{ backgroundColor: person.color, color: readableTextColor(person.color) }}
    >
      {initialsOf(person.name)}
    </span>
  );
}

/**
 * Who is on the page (FR-PR-01, FR-PR-04, FR-PR-05): an avatar stack, the number of people
 * online, a list opened from a button (keyboard: Tab to the button, Enter or Space to open,
 * Escape to close), and join/leave notices announced politely to screen readers.
 * Avatars are initials on the person's colour; there is no avatar upload yet (Phase 4, U7).
 */
export function PresenceBar({
  collaborators,
  notices,
  live,
}: {
  collaborators: readonly PresenceCollaborator[];
  notices: readonly PresenceEvent[];
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const count = collaborators.length;
  const shown = collaborators.slice(0, MAX_AVATARS);
  const hidden = count - shown.length;
  const label = live
    ? `${count} ${count === 1 ? 'person' : 'people'} online`
    : 'Connection lost: collaborators are not shown';

  return (
    <div ref={root} className="relative flex items-center gap-2" data-testid="presence-bar">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}. ${open ? 'Hide' : 'Show'} the list`}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-600"
      >
        <span className="flex -space-x-2">
          {shown.map((person) => (
            <Avatar key={person.userId} person={person} />
          ))}
          {hidden > 0 && (
            <span
              aria-hidden="true"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[0.7rem] font-semibold text-slate-700"
            >
              +{hidden}
            </span>
          )}
        </span>
        <span data-testid="presence-count" aria-hidden="true">
          {live ? `${count} online` : 'Offline'}
        </span>
      </button>

      {open && (
        <ul
          id={listId}
          aria-label="People on this page"
          className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-slate-200 bg-white p-2 shadow-lg"
        >
          {collaborators.map((person) => (
            <li key={person.userId} className="flex items-center gap-2 py-1 text-sm">
              <Avatar person={person} size="md" />
              <span className="min-w-0 flex-1 truncate">
                {person.name}
                {person.isSelf && <span className="text-slate-500"> (you)</span>}
              </span>
              {person.connections > 1 && (
                <span className="text-xs text-slate-500">{person.connections} tabs</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div role="status" aria-live="polite" className="sr-only" data-testid="presence-announcer">
        {notices.map((notice) => (
          <p key={notice.id}>
            {notice.name} {notice.kind === 'join' ? 'joined' : 'left'}
          </p>
        ))}
      </div>
      {notices.length > 0 && (
        <div
          aria-hidden="true"
          className="absolute right-0 top-full z-10 mt-1 space-y-1"
          data-testid="presence-notices"
        >
          {notices.map((notice) => (
            <p
              key={notice.id}
              className="rounded-md bg-slate-800 px-2.5 py-1 text-xs text-white shadow"
            >
              {notice.name} {notice.kind === 'join' ? 'joined' : 'left'}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
