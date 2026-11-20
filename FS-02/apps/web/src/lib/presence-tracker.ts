import {
  PRESENCE_LEAVE_GRACE_MS,
  PRESENCE_QUIET_MS,
  type PresenceCollaborator,
} from '@conote/shared';

export interface PresenceEvent {
  kind: 'join' | 'leave';
  userId: string;
  name: string;
  /** Unique, for list keys. */
  id: number;
}

export interface PresenceTrackerOptions {
  graceMs?: number;
  quietMs?: number;
  now?: () => number;
}

type Listener = (event: PresenceEvent) => void;

/**
 * Turns successive snapshots of who is online into join and leave notices
 * (WEBSOCKET_PROTOCOL §6, §18.5). Framework-free.
 *
 *  - Computed per person, not per tab: a second tab of someone already here is not a join and
 *    closing one of two tabs is not a leave (AC-7.2). The current person is never announced.
 *  - A person whose last state disappears is announced as gone only after a grace period, and
 *    not at all if they come back within it (a page reload, a short network drop).
 *  - For a short quiet period after `reset()` people already present are the starting point:
 *    the server sends the existing states right after connecting, which is not news.
 */
export class PresenceTracker {
  private readonly graceMs: number;
  private readonly quietMs: number;
  private readonly now: () => number;
  private readonly known = new Map<string, string>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<Listener>();
  private quietUntil: number;
  private nextId = 1;

  constructor(options: PresenceTrackerOptions = {}) {
    this.graceMs = options.graceMs ?? PRESENCE_LEAVE_GRACE_MS;
    this.quietMs = options.quietMs ?? PRESENCE_QUIET_MS;
    this.now = options.now ?? Date.now;
    this.quietUntil = this.now() + this.quietMs;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Forget everything and start a quiet period (connection (re)established). */
  reset(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.known.clear();
    this.quietUntil = this.now() + this.quietMs;
  }

  dispose(): void {
    this.reset();
    this.listeners.clear();
  }

  /** The people online now (`isSelf` entries are ignored). */
  update(collaborators: readonly PresenceCollaborator[]): void {
    const present = new Map<string, string>();
    for (const c of collaborators) if (!c.isSelf) present.set(c.userId, c.name);
    const quiet = this.now() < this.quietUntil;

    for (const [userId, name] of present) {
      const timer = this.pending.get(userId);
      if (timer !== undefined) {
        clearTimeout(timer); // back within the grace period: never left
        this.pending.delete(userId);
      }
      if (!this.known.has(userId)) {
        this.known.set(userId, name);
        if (!quiet) this.emit({ kind: 'join', userId, name });
      } else this.known.set(userId, name);
    }

    for (const [userId, name] of [...this.known]) {
      if (present.has(userId) || this.pending.has(userId)) continue;
      if (quiet) {
        this.known.delete(userId);
        continue;
      }
      this.pending.set(
        userId,
        setTimeout(() => {
          this.pending.delete(userId);
          this.known.delete(userId);
          this.emit({ kind: 'leave', userId, name });
        }, this.graceMs),
      );
    }
  }

  private emit(event: Omit<PresenceEvent, 'id'>): void {
    const full = { ...event, id: this.nextId++ };
    for (const listener of this.listeners) listener(full);
  }
}
