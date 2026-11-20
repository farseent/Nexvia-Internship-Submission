'use client';

import { useEffect, useRef, useState } from 'react';
import type { CollabTokenResponse } from '@conote/shared';
import { api } from './api-client';
import { CollabSession, type CollabState } from './collab-session';
import { useAuth } from './auth-context';

/** The live connection of one page; a new one is created when `pageId` changes. */
export function useCollabSession(pageId: string): {
  session: CollabSession | null;
  state: CollabState | null;
} {
  const { guard } = useAuth();
  const guardRef = useRef(guard);
  useEffect(() => {
    guardRef.current = guard;
  }, [guard]);

  const [session, setSession] = useState<CollabSession | null>(null);
  const [state, setState] = useState<CollabState | null>(null);

  useEffect(() => {
    const created = new CollabSession({
      pageId,
      fetchToken: (): Promise<CollabTokenResponse> =>
        guardRef.current(() => api.createCollabToken(pageId)),
    });
    const unsubscribe = created.subscribe(setState);
    setSession(created);
    setState(created.getState());
    created.start();
    return () => {
      unsubscribe();
      created.destroy();
      setSession(null);
      setState(null);
    };
  }, [pageId]);

  return { session, state };
}
