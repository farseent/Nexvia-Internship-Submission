import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresenceCollaborator } from '@conote/shared';
import { PresenceTracker, type PresenceEvent } from './presence-tracker';

const person = (id: string, name = id, isSelf = false): PresenceCollaborator => ({
  userId: id,
  name,
  color: '#4F46E5',
  connections: 1,
  hasCursor: false,
  isSelf,
});

describe('PresenceTracker', () => {
  let events: PresenceEvent[];
  let tracker: PresenceTracker;
  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    tracker = new PresenceTracker({ graceMs: 3000, quietMs: 1000, now: () => Date.now() });
    tracker.subscribe((e) => events.push(e));
  });
  afterEach(() => {
    tracker.dispose();
    vi.useRealTimers();
  });
  const settleQuiet = () => vi.advanceTimersByTime(1001);

  it('does not announce people already there when the page opens', () => {
    tracker.update([person('a', 'Ann')]);
    tracker.update([person('a', 'Ann'), person('b', 'Bob')]); // still within the quiet period
    vi.advanceTimersByTime(10_000);
    expect(events).toEqual([]);
  });

  it('announces a join once, and never the current person', () => {
    tracker.update([]);
    settleQuiet();
    tracker.update([person('me', 'Me', true), person('b', 'Bob')]);
    tracker.update([person('me', 'Me', true), person('b', 'Bob')]);
    expect(events.map((e) => [e.kind, e.name])).toEqual([['join', 'Bob']]);
  });

  it('announces a leave only after the grace period', () => {
    tracker.update([person('b', 'Bob')]);
    settleQuiet();
    tracker.update([]);
    vi.advanceTimersByTime(2999);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(events.map((e) => [e.kind, e.name])).toEqual([['leave', 'Bob']]);
  });

  it('announces nothing when the person comes back within the grace period', () => {
    tracker.update([person('b', 'Bob')]);
    settleQuiet();
    tracker.update([]);
    vi.advanceTimersByTime(1500);
    tracker.update([person('b', 'Bob')]);
    vi.advanceTimersByTime(10_000);
    expect(events).toEqual([]);
  });

  it('announces a join again after a completed leave', () => {
    tracker.update([person('b', 'Bob')]);
    settleQuiet();
    tracker.update([]);
    vi.advanceTimersByTime(3001);
    tracker.update([person('b', 'Bob')]);
    expect(events.map((e) => e.kind)).toEqual(['leave', 'join']);
  });

  it('treats several tabs of one person as one (the snapshot is per person)', () => {
    tracker.update([person('b', 'Bob')]);
    settleQuiet();
    tracker.update([{ ...person('b', 'Bob'), connections: 2 }]);
    tracker.update([{ ...person('b', 'Bob'), connections: 1 }]); // one tab closed
    vi.advanceTimersByTime(10_000);
    expect(events).toEqual([]);
  });

  it('reset forgets everyone without announcing and starts a new quiet period', () => {
    tracker.update([person('b', 'Bob')]);
    settleQuiet();
    tracker.reset();
    tracker.update([]);
    vi.advanceTimersByTime(10_000);
    expect(events).toEqual([]);
    tracker.update([person('c', 'Cy')]); // quiet period is over by now
    expect(events.map((e) => e.name)).toEqual(['Cy']);
  });

  it('gives events unique ids', () => {
    settleQuiet();
    tracker.update([person('a')]);
    tracker.update([]);
    vi.advanceTimersByTime(3001);
    expect(new Set(events.map((e) => e.id)).size).toBe(2);
  });
});
