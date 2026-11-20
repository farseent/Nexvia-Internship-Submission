'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, describeApiError } from './api-client';
import { useAuth } from './auth-context';

export interface LoadState<T> {
  data: T | null;
  /** User-facing message of the last failure, if any. */
  error: string | null;
  /** The API error code of the last failure, if it was an API error. */
  errorCode: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Load data through the authenticated client. `load` must be stable (wrap it in
 * `useCallback` with its inputs); the data reloads when it changes or `reload()` is called.
 * An expired session sends the user to the login page (see `useAuth().guard`).
 */
export function useLoad<T>(load: () => Promise<T>): LoadState<T> {
  const { guard } = useAuth();
  const [state, setState] = useState<{
    data: T | null;
    error: string | null;
    errorCode: string | null;
    /** The request (load function + reload counter) this result belongs to. */
    settledLoad: (() => Promise<T>) | null;
    settledTick: number | null;
  }>({ data: null, error: null, errorCode: null, settledLoad: null, settledTick: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    guard(load).then(
      (data) => {
        if (!cancelled) {
          setState({ data, error: null, errorCode: null, settledLoad: load, settledTick: tick });
        }
      },
      (error: unknown) => {
        if (cancelled) return;
        setState((previous) => ({
          data: previous.data,
          error: describeApiError(error),
          errorCode: error instanceof ApiError ? error.code : null,
          settledLoad: load,
          settledTick: tick,
        }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [guard, load, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const loading = state.settledLoad !== load || state.settledTick !== tick;
  return {
    data: state.data,
    error: state.error,
    errorCode: state.errorCode,
    loading,
    reload,
  };
}
