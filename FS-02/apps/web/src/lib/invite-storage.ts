import { INVITATION_TOKEN_PATTERN } from '@conote/shared';

/**
 * An invitation link carries its token in the URL fragment (D30). If the visitor has to sign
 * in or register first, the token is kept for this browser tab only (sessionStorage) so the
 * invitation can still be reviewed afterwards. It is cleared once it is accepted or declined.
 */
export const INVITE_STORAGE_KEY = 'conote.invitation';

export function readStoredInvite(): string | null {
  try {
    const value = window.sessionStorage.getItem(INVITE_STORAGE_KEY);
    return value !== null && INVITATION_TOKEN_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeInvite(token: string): void {
  try {
    window.sessionStorage.setItem(INVITE_STORAGE_KEY, token);
  } catch {
    // Storage can be unavailable (private mode); the link itself still works while it is open.
  }
}

export function clearStoredInvite(): void {
  try {
    window.sessionStorage.removeItem(INVITE_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
