'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { deriveCollaborators, type PresenceCollaborator } from '@conote/shared';
import { PresenceTracker, type PresenceEvent } from './presence-tracker';

export interface PresenceSelf {
  id: string;
  name: string;
  color: string;
}

const MAX_NOTICES = 3;
const NOTICE_MS = 5000;

/**
 * Who is online on the page, from the session's awareness (WEBSOCKET_PROTOCOL §18). One entry
 * per person, the current person first. While the connection is not live the others are not
 * known, so only the current person is listed and nothing is announced; when it is live again
 * the people already there are the starting point, not news.
 */
export function usePresence(
  awareness: Awareness | null,
  live: boolean,
  self: PresenceSelf | null,
): { collaborators: PresenceCollaborator[]; notices: PresenceEvent[] } {
  const selfId = self?.id ?? null;
  const selfName = self?.name ?? null;
  const selfColor = self?.color ?? null;
  const selfValue = useMemo(
    () =>
      selfId !== null && selfName !== null && selfColor !== null
        ? { id: selfId, name: selfName, color: selfColor }
        : null,
    [selfId, selfName, selfColor],
  );
  const [collaborators, setCollaborators] = useState<PresenceCollaborator[]>(() =>
    deriveCollaborators(new Map(), 0, selfValue),
  );
  const [notices, setNotices] = useState<PresenceEvent[]>([]);
  const trackerRef = useRef<PresenceTracker | null>(null);

  useEffect(() => {
    const tracker = new PresenceTracker();
    trackerRef.current = tracker;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const unsubscribe = tracker.subscribe((event) => {
      setNotices((current) => [...current, event].slice(-MAX_NOTICES));
      const timer = setTimeout(() => {
        timers.delete(timer);
        setNotices((current) => current.filter((n) => n.id !== event.id));
      }, NOTICE_MS);
      timers.add(timer);
    });
    return () => {
      unsubscribe();
      tracker.dispose();
      for (const timer of timers) clearTimeout(timer);
      trackerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const tracker = trackerRef.current;
    tracker?.reset();
    if (!awareness || !live) return;
    const refresh = () => {
      const list = deriveCollaborators(awareness.getStates(), awareness.clientID, selfValue);
      setCollaborators(list);
      tracker?.update(list);
    };
    refresh();
    awareness.on('change', refresh);
    return () => awareness.off('change', refresh);
  }, [awareness, live, selfValue]);

  // Not live: the others are not known, so only the current person is listed.
  const offline = useMemo(() => deriveCollaborators(new Map(), 0, selfValue), [selfValue]);
  return { collaborators: live && awareness ? collaborators : offline, notices };
}
