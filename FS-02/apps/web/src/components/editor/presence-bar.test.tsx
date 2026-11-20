// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresenceCollaborator } from '@conote/shared';
import { usePresence } from '@/lib/use-presence';
import { PresenceBar } from './presence-bar';

afterEach(cleanup);

const person = (id: string, name: string, extra: Partial<PresenceCollaborator> = {}) => ({
  userId: id,
  name,
  color: '#4F46E5',
  connections: 1,
  hasCursor: false,
  isSelf: false,
  ...extra,
});

describe('PresenceBar', () => {
  it('shows avatars with initials and the number of people online', () => {
    render(
      <PresenceBar
        live
        notices={[]}
        collaborators={[person('1', 'Ada Lovelace', { isSelf: true }), person('2', 'Bob Brown')]}
      />,
    );
    expect(screen.getAllByTestId('presence-avatar').map((a) => a.textContent)).toEqual([
      'AL',
      'BB',
    ]);
    expect(screen.getByTestId('presence-count').textContent).toBe('2 online');
    expect(screen.getByRole('button', { name: /2 people online/ })).toBeTruthy();
  });

  it('says one person for one, and collapses many avatars into +N', () => {
    const many = Array.from({ length: 7 }, (_, i) => person(String(i), `User ${i}`));
    const { rerender } = render(<PresenceBar live notices={[]} collaborators={many} />);
    expect(screen.getAllByTestId('presence-avatar')).toHaveLength(4);
    expect(screen.getByText('+3')).toBeTruthy();
    rerender(<PresenceBar live notices={[]} collaborators={many.slice(0, 1)} />);
    expect(screen.getByRole('button', { name: /1 person online/ })).toBeTruthy();
  });

  it('opens the list with the keyboard, names everyone and closes with Escape', async () => {
    const user = userEvent.setup();
    render(
      <PresenceBar
        live
        notices={[]}
        collaborators={[
          person('1', 'Ada', { isSelf: true }),
          person('2', 'Bob', { connections: 2 }),
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: /online/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('list', { name: 'People on this page' });
    expect(within(list).getByText(/Ada/).textContent).toContain('(you)');
    expect(within(list).getByText('2 tabs')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('list', { name: 'People on this page' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('announces joins and leaves politely and shows no collaborators while offline', () => {
    render(
      <PresenceBar
        live={false}
        collaborators={[person('1', 'Ada', { isSelf: true })]}
        notices={[
          { kind: 'join', userId: '2', name: 'Bob', id: 1 },
          { kind: 'leave', userId: '3', name: 'Cy', id: 2 },
        ]}
      />,
    );
    const announcer = screen.getByTestId('presence-announcer');
    expect(announcer.getAttribute('aria-live')).toBe('polite');
    expect(announcer.textContent).toBe('Bob joinedCy left');
    expect(screen.getByTestId('presence-count').textContent).toBe('Offline');
  });

  it('renders a hostile name as text', () => {
    render(
      <PresenceBar
        live
        notices={[]}
        collaborators={[person('1', '<img src=x onerror=alert(1)>', { isSelf: true })]}
      />,
    );
    expect(document.querySelector('img')).toBeNull();
  });
});

const ADA = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada', color: '#4F46E5' };
const BOB = { id: '22222222-2222-4222-8222-222222222222', name: 'Bob', color: '#0E7490' };

function Harnessed({ awareness, live }: { awareness: Awareness; live: boolean }) {
  const { collaborators, notices } = usePresence(awareness, live, ADA);
  return <PresenceBar collaborators={collaborators} notices={notices} live={live} />;
}

function remote(awareness: Awareness, clientId: number, state: object | null, clock: number) {
  const other = new Awareness(new Y.Doc());
  other.clientID = clientId;
  other.meta.set(clientId, { clock, lastUpdated: Date.now() });
  if (state) other.states.set(clientId, state);
  applyAwarenessUpdate(awareness, encodeAwarenessUpdate(other, [clientId]), 'test');
  other.destroy();
}

describe('usePresence with a PresenceBar', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lists people as their awareness arrives, once per person, and announces later joins and leaves', () => {
    const awareness = new Awareness(new Y.Doc());
    render(<Harnessed awareness={awareness} live />);
    expect(screen.getByTestId('presence-count').textContent).toBe('1 online');

    act(() => vi.advanceTimersByTime(2000)); // past the quiet start
    act(() => remote(awareness, 101, { user: BOB }, 1));
    act(() => remote(awareness, 102, { user: BOB }, 1)); // Bob's second tab
    expect(screen.getByTestId('presence-count').textContent).toBe('2 online');
    expect(screen.getByTestId('presence-announcer').textContent).toBe('Bob joined');

    act(() => remote(awareness, 101, null, 2)); // one tab closes: still here, no notice
    expect(screen.getByTestId('presence-count').textContent).toBe('2 online');
    act(() => remote(awareness, 102, null, 2)); // the last tab closes
    expect(screen.getByTestId('presence-count').textContent).toBe('1 online');
    act(() => vi.advanceTimersByTime(3100)); // grace period
    expect(screen.getByTestId('presence-announcer').textContent).toContain('Bob left');
    awareness.destroy();
  });

  it('does not announce people who were already there', () => {
    const awareness = new Awareness(new Y.Doc());
    remote(awareness, 101, { user: BOB }, 1);
    render(<Harnessed awareness={awareness} live />);
    expect(screen.getByTestId('presence-count').textContent).toBe('2 online');
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByTestId('presence-announcer').textContent).toBe('');
    awareness.destroy();
  });

  it('lists only the current person while the connection is not live', () => {
    const awareness = new Awareness(new Y.Doc());
    remote(awareness, 101, { user: BOB }, 1);
    render(<Harnessed awareness={awareness} live={false} />);
    expect(screen.getAllByTestId('presence-avatar')).toHaveLength(1);
    expect(screen.getByTestId('presence-count').textContent).toBe('Offline');
    awareness.destroy();
  });
});
