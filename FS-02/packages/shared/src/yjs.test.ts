import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { YJS_FRAGMENT_NAME } from './collab.js';
import {
  DocumentReplica,
  InvalidYjsUpdateError,
  REMOTE_ORIGIN,
  encodeDocumentCoverage,
  isEmptyYjsUpdate,
  mergeStateVectors,
  stateVectorCovers,
  stateVectorsEqual,
  synchronizeReplicas as synchronizeReplicaPair,
} from './yjs.js';

/*
 * CRDT tests on plain Yjs structures that mirror what Tiptap stores: a `Y.XmlFragment` of
 * `paragraph` elements, each holding one `Y.XmlText` whose formatting attributes are marks
 * (`{ bold: {} }`, the y-prosemirror convention). The same scenarios run against the real
 * editor in packages/editor/src/collaboration.test.ts.
 */

// ───────────── helpers ─────────────

interface Peer {
  name: string;
  replica: DocumentReplica;
  /** Every incremental update this peer produced, in order. */
  log: Uint8Array[];
}

function peer(name: string): Peer {
  const log: Uint8Array[] = [];
  const replica = new DocumentReplica({ onLocalUpdate: (update) => log.push(update) });
  return { name, replica, log };
}

/** Two-way sync of two peers (the library function works on replicas). */
function synchronizeReplicas(a: Peer, b: Peer): void {
  synchronizeReplicaPair(a.replica, b.replica);
}

const fragmentOf = (p: Peer) => p.replica.doc.getXmlFragment(YJS_FRAGMENT_NAME);

/** Append one paragraph and return its text node (a local change of `p`). */
function addParagraph(p: Peer, text: string, index?: number): void {
  const fragment = fragmentOf(p);
  p.replica.doc.transact(() => {
    const paragraph = new Y.XmlElement('paragraph');
    fragment.insert(index ?? fragment.length, [paragraph]);
    const node = new Y.XmlText();
    paragraph.insert(0, [node]);
    node.insert(0, text);
  });
}

function textAt(p: Peer, paragraph: number): Y.XmlText {
  const element = fragmentOf(p).get(paragraph);
  if (!(element instanceof Y.XmlElement)) throw new Error(`no paragraph ${paragraph}`);
  const node = element.get(0);
  if (!(node instanceof Y.XmlText)) throw new Error(`paragraph ${paragraph} has no text`);
  return node;
}

/** What two converged replicas must agree on. */
function state(p: Peer): string {
  return JSON.stringify({
    xml: fragmentOf(p).toString(),
    deltas: fragmentOf(p)
      .toArray()
      .map((node) => (node instanceof Y.XmlElement ? node.toArray() : []))
      .map((children) => children.map((c) => (c instanceof Y.XmlText ? c.toDelta() : null))),
  });
}

function expectConverged(peers: Peer[], context = ''): void {
  const [first, ...rest] = peers;
  if (!first) throw new Error('no peers');
  for (const other of rest) {
    expect(state(other), `${context} ${other.name} vs ${first.name}`).toBe(state(first));
    expect(
      stateVectorsEqual(other.replica.stateVector(), first.replica.stateVector()),
      `${context} state vectors of ${other.name} and ${first.name}`,
    ).toBe(true);
  }
}

/** Both peers start from the same single paragraph. */
function twoPeersWith(text: string): [Peer, Peer] {
  const a = peer('A');
  const b = peer('B');
  addParagraph(a, text);
  synchronizeReplicas(a, b);
  expectConverged([a, b]);
  return [a, b];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

// ───────────── handshake and initial synchronization ─────────────

describe('state vector synchronization', () => {
  it('a new replica receives the whole document from an empty state vector (initial sync)', () => {
    const a = peer('A');
    addParagraph(a, 'hello');
    addParagraph(a, 'world');
    const fresh = peer('fresh');
    fresh.replica.applyRemoteUpdate(a.replica.diffSince(fresh.replica.stateVector()));
    expectConverged([a, fresh]);
    expect(fragmentOf(fresh).length).toBe(2);
  });

  it('the diff contains only what the other side lacks', () => {
    const [a, b] = twoPeersWith('shared');
    const before = a.replica.diffSince(b.replica.stateVector());
    expect(isEmptyYjsUpdate(before)).toBe(true);

    textAt(a, 0).insert(6, ' and more');
    const diff = a.replica.diffSince(b.replica.stateVector());
    const full = a.replica.diffSince();
    expect(isEmptyYjsUpdate(diff)).toBe(false);
    expect(diff.length).toBeLessThan(full.length);
    b.replica.applyRemoteUpdate(diff);
    expectConverged([a, b]);
  });

  it('merges state vectors per client with the maximum', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.getText('t').insert(0, 'aaaa');
    docB.getText('t').insert(0, 'bb');
    const svA = Y.encodeStateVector(docA);
    const svB = Y.encodeStateVector(docB);
    const merged = mergeStateVectors(svA, svB);

    expect(stateVectorCovers(merged, svA)).toBe(true);
    expect(stateVectorCovers(merged, svB)).toBe(true);
    expect(stateVectorCovers(svA, svB)).toBe(false);
    expect(Y.decodeStateVector(merged).size).toBe(2);
    expect(Y.decodeStateVector(merged).get(docA.clientID)).toBe(4);
    expect(Y.decodeStateVector(merged).get(docB.clientID)).toBe(2);
    // A vector never moves backwards when merged with an older one.
    expect(stateVectorsEqual(mergeStateVectors(merged, svA), merged)).toBe(true);
    expect(stateVectorsEqual(mergeStateVectors(svA, merged), merged)).toBe(true);
  });

  it('coverage changes on deletion even though the state vector does not', () => {
    const doc = new Y.Doc();
    doc.getText('t').insert(0, 'abcdef');
    const sv = Y.encodeStateVector(doc);
    const coverage = encodeDocumentCoverage(doc);
    doc.getText('t').delete(1, 2);
    expect(stateVectorsEqual(Y.encodeStateVector(doc), sv)).toBe(true);
    expect(encodeDocumentCoverage(doc)).not.toEqual(coverage);
    expect(encodeDocumentCoverage(doc)).toEqual(encodeDocumentCoverage(doc));
  });
});

// ───────────── concurrent editing ─────────────

describe('concurrent editing (G1)', () => {
  it('two users editing different sections keep both edits', () => {
    const a = peer('A');
    const b = peer('B');
    for (const text of ['one', 'two', 'three']) addParagraph(a, text);
    synchronizeReplicas(a, b);

    textAt(a, 0).insert(3, ' (edited by A)');
    textAt(b, 2).insert(5, ' (edited by B)');
    synchronizeReplicas(a, b);

    expectConverged([a, b]);
    expect(textAt(a, 0).toString()).toContain('one (edited by A)');
    expect(textAt(a, 1).toString()).toContain('two');
    expect(textAt(a, 2).toString()).toContain('three (edited by B)');
  });

  it('two users editing the same section keep both edits', () => {
    const [a, b] = twoPeersWith('The quick fox');
    textAt(a, 0).insert(4, 'brown ');
    textAt(b, 0).insert(13, ' jumps');
    synchronizeReplicas(a, b);

    expectConverged([a, b]);
    expect(textAt(a, 0).toString()).toContain('brown');
    expect(textAt(a, 0).toString()).toContain('jumps');
    expect(textAt(a, 0).toString()).toContain('quick');
  });

  it('simultaneous insertions at the same position are both kept, in one agreed order', () => {
    const [a, b] = twoPeersWith('ab');
    textAt(a, 0).insert(1, 'AAA');
    textAt(b, 0).insert(1, 'BBB');
    synchronizeReplicas(a, b);

    expectConverged([a, b]);
    const text = textAt(a, 0).toString();
    expect(text).toContain('AAA');
    expect(text).toContain('BBB');
    expect(text.indexOf('a')).toBeLessThan(text.indexOf('b'));
  });

  it('simultaneous deletions of overlapping ranges delete the union once', () => {
    const [a, b] = twoPeersWith('abcdefg');
    textAt(a, 0).delete(2, 2); // "cd"
    textAt(b, 0).delete(3, 2); // "de"
    synchronizeReplicas(a, b);

    expectConverged([a, b]);
    expect(textAt(a, 0).toString()).toContain('abfg');
  });

  it('an insertion inside a range deleted at the same time survives', () => {
    const [a, b] = twoPeersWith('abcdefg');
    textAt(a, 0).delete(1, 4); // "bcde"
    textAt(b, 0).insert(3, 'X'); // between "c" and "d"
    synchronizeReplicas(a, b);

    expectConverged([a, b]);
    const text = textAt(a, 0).toString();
    expect(text).toContain('X');
    expect(text).toContain('a');
    expect(text).toContain('fg');
    expect(text).not.toContain('bcde');
  });

  it('deleting a whole paragraph while another user edits it converges', () => {
    const a = peer('A');
    const b = peer('B');
    addParagraph(a, 'keep');
    addParagraph(a, 'remove me');
    synchronizeReplicas(a, b);

    fragmentOf(a).delete(1, 1);
    textAt(b, 1).insert(0, 'edit ');
    synchronizeReplicas(a, b);

    expectConverged([a, b]);
    expect(textAt(a, 0).toString()).toContain('keep');
  });

  it('concurrent formatting of overlapping ranges keeps both formats', () => {
    const [a, b] = twoPeersWith('abcdefghij');
    textAt(a, 0).format(0, 6, { bold: {} });
    textAt(b, 0).format(3, 7, { italic: {} });
    synchronizeReplicas(a, b);

    expectConverged([a, b]);
    const delta = textAt(a, 0).toDelta() as {
      insert: string;
      attributes?: Record<string, unknown>;
    }[];
    const at = (index: number) => {
      let offset = 0;
      for (const part of delta) {
        if (index < offset + part.insert.length) return part.attributes ?? {};
        offset += part.insert.length;
      }
      return {};
    };
    expect(at(1)).toHaveProperty('bold');
    expect(at(1)).not.toHaveProperty('italic');
    expect(at(4)).toHaveProperty('bold');
    expect(at(4)).toHaveProperty('italic');
    expect(at(8)).not.toHaveProperty('bold');
    expect(at(8)).toHaveProperty('italic');
  });

  it('conflicting formatting of the same range (bold on / bold off) converges', () => {
    const [a, b] = twoPeersWith('abcdef');
    textAt(a, 0).format(0, 6, { bold: {} });
    synchronizeReplicas(a, b);
    textAt(a, 0).format(0, 6, { bold: null });
    textAt(b, 0).format(0, 6, { bold: {}, underline: {} });
    synchronizeReplicas(a, b);
    expectConverged([a, b]);
  });

  it('three replicas editing at once converge no matter how updates are relayed', () => {
    const peers = ['A', 'B', 'C'].map(peer);
    const [a, b, c] = peers as [Peer, Peer, Peer];
    addParagraph(a, '0123456789');
    synchronizeReplicas(a, b);
    synchronizeReplicas(a, c);

    textAt(a, 0).insert(2, 'a');
    textAt(b, 0).delete(4, 3);
    textAt(c, 0).format(0, 5, { bold: {} });

    // A relays to B, B to C, C to A: a ring, never directly from the origin.
    synchronizeReplicas(a, b);
    synchronizeReplicas(b, c);
    synchronizeReplicas(c, a);
    synchronizeReplicas(a, b);
    expectConverged(peers);
  });
});

// ───────────── local and remote update handling ─────────────

describe('local and remote update handling', () => {
  it('reports each local transaction once and never reports remote updates', () => {
    const a = peer('A');
    const b = peer('B');
    addParagraph(a, 'x');
    expect(a.log.length).toBe(1);

    for (const update of a.log) b.replica.applyRemoteUpdate(update);
    expect(b.log.length).toBe(0);
    expectConverged([a, b]);

    textAt(b, 0).insert(1, 'y');
    expect(b.log.length).toBe(1);
    for (const update of b.log) a.replica.applyRemoteUpdate(update);
    expect(a.log.length).toBe(1);
    expectConverged([a, b]);
  });

  it('live relay of incremental updates keeps two replicas identical after every step', () => {
    const a = peer('A');
    const b = peer('B');
    const relay = (from: Peer, to: Peer, since: number) => {
      for (const update of from.log.slice(since)) to.replica.applyRemoteUpdate(update);
    };
    addParagraph(a, 'start');
    relay(a, b, 0);
    expectConverged([a, b]);
    textAt(a, 0).insert(5, '!');
    relay(a, b, 1);
    expectConverged([a, b]);
    textAt(b, 0).delete(0, 1);
    relay(b, a, 0);
    expectConverged([a, b]);
  });

  it('tags remote transactions with the remote origin', () => {
    const a = peer('A');
    const b = peer('B');
    const origins: unknown[] = [];
    b.replica.doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
    addParagraph(a, 'x');
    for (const update of a.log) b.replica.applyRemoteUpdate(update);
    expect(origins).toEqual([REMOTE_ORIGIN]);
  });

  it('rejects an empty update without damaging the replica', () => {
    // Arbitrary garbage bytes are deliberately not tested: Yjs does not specify its behaviour on
    // them, so the server must authenticate and size-limit input before it reaches Yjs (Phase 6).
    const [a, b] = twoPeersWith('safe');
    const before = state(b);
    expect(() => b.replica.applyRemoteUpdate(new Uint8Array(0))).toThrow(InvalidYjsUpdateError);
    expect(state(b)).toBe(before);
    textAt(a, 0).insert(4, '!');
    synchronizeReplicas(a, b);
    expectConverged([a, b]);
  });
});

// ───────────── repeated and out-of-order updates ─────────────

describe('repeated and out-of-order updates', () => {
  it('applying the same update repeatedly changes nothing', () => {
    const a = peer('A');
    const b = peer('B');
    addParagraph(a, 'once');
    textAt(a, 0).insert(4, ' only');
    const all = a.replica.diffSince();

    b.replica.applyRemoteUpdate(all);
    const once = state(b);
    const vector = b.replica.stateVector();
    for (let i = 0; i < 5; i += 1) b.replica.applyRemoteUpdate(all);
    for (const update of a.log) b.replica.applyRemoteUpdate(update);

    expect(state(b)).toBe(once);
    expect(stateVectorsEqual(b.replica.stateVector(), vector)).toBe(true);
    expect(b.log.length).toBe(0);
    expect(b.replica.hasPendingUpdates()).toBe(false);
    expectConverged([a, b]);
  });

  it('holds back an update whose dependencies have not arrived and integrates it later', () => {
    const a = peer('A');
    const b = peer('B');
    addParagraph(a, 'base'); // update 0
    textAt(a, 0).insert(4, ' text'); // update 1, depends on 0
    textAt(a, 0).delete(0, 2); // update 2, depends on 0 and 1
    expect(a.log.length).toBe(3);
    const [u0, u1, u2] = a.log as [Uint8Array, Uint8Array, Uint8Array];

    b.replica.applyRemoteUpdate(u2);
    expect(b.replica.hasPendingUpdates()).toBe(true);
    expect(fragmentOf(b).length).toBe(0);
    b.replica.applyRemoteUpdate(u1);
    expect(b.replica.hasPendingUpdates()).toBe(true);
    b.replica.applyRemoteUpdate(u0);
    expect(b.replica.hasPendingUpdates()).toBe(false);
    expectConverged([a, b]);
    expect(textAt(b, 0).toString()).toContain('se text');
  });

  it('every delivery order, with duplicates, gives the same document', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const random = mulberry32(seed);
      const source = peer('source');
      addParagraph(source, 'abcdefghij');
      addParagraph(source, 'klmnopqrst');
      for (let i = 0; i < 12; i += 1) {
        const target = textAt(source, Math.floor(random() * 2));
        const length = target.length;
        if (random() < 0.4 && length > 2) target.delete(Math.floor(random() * (length - 1)), 1);
        else if (random() < 0.5) target.insert(Math.floor(random() * (length + 1)), String(i));
        else if (length > 3) target.format(0, 3, { bold: random() < 0.5 ? {} : null });
      }
      const updates = source.log;
      const delivery = shuffled([...updates, ...shuffled(updates, random).slice(0, 6)], random);

      const sink = peer('sink');
      for (const update of delivery) sink.replica.applyRemoteUpdate(update);
      expect(sink.replica.hasPendingUpdates(), `seed ${seed}`).toBe(false);
      expectConverged([source, sink], `seed ${seed}`);
    }
  });

  it('never moves a replica back to an older state', () => {
    const [a, b] = twoPeersWith('v1');
    const older = b.replica.diffSince();
    textAt(a, 0).insert(2, '-v2');
    synchronizeReplicas(a, b);
    const newer = state(b);

    b.replica.applyRemoteUpdate(older); // a stale full state arrives late
    expect(state(b)).toBe(newer);
    expect(textAt(b, 0).toString()).toContain('v1-v2');
  });
});

// ───────────── randomized convergence (AC-5.2) ─────────────

type Operation = (p: Peer, random: () => number) => void;

const OPERATIONS: Operation[] = [
  (p, random) =>
    addParagraph(
      p,
      `p${Math.floor(random() * 1000)}`,
      Math.floor(random() * (fragmentOf(p).length + 1)),
    ),
  (p, random) => {
    if (fragmentOf(p).length === 0) return addParagraph(p, 'seed');
    const node = textAt(p, Math.floor(random() * fragmentOf(p).length));
    node.insert(
      Math.floor(random() * (node.length + 1)),
      String.fromCharCode(97 + Math.floor(random() * 26)),
    );
  },
  (p, random) => {
    if (fragmentOf(p).length === 0) return;
    const node = textAt(p, Math.floor(random() * fragmentOf(p).length));
    if (node.length === 0) return;
    const index = Math.floor(random() * node.length);
    node.delete(index, 1 + Math.floor(random() * Math.min(3, node.length - index)));
  },
  (p, random) => {
    if (fragmentOf(p).length === 0) return;
    const node = textAt(p, Math.floor(random() * fragmentOf(p).length));
    if (node.length < 2) return;
    const index = Math.floor(random() * (node.length - 1));
    const mark = ['bold', 'italic', 'underline'][Math.floor(random() * 3)] as string;
    node.format(index, 1 + Math.floor(random() * (node.length - index - 1)), {
      [mark]: random() < 0.7 ? {} : null,
    });
  },
  (p, random) => {
    if (fragmentOf(p).length > 1 && random() < 0.5) {
      fragmentOf(p).delete(Math.floor(random() * fragmentOf(p).length), 1);
    }
  },
];

describe('randomized convergence', () => {
  const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);

  it.each(SEEDS)(
    'seed %i: five replicas, random edits, random delivery order and duplication',
    (seed) => {
      const random = mulberry32(seed);
      const peers = Array.from({ length: 5 }, (_, i) => peer(`P${i}`));
      const inboxes = new Map<Peer, Uint8Array[]>(peers.map((p) => [p, []]));
      const sent = new Map<Peer, number>(peers.map((p) => [p, 0]));

      const publish = (from: Peer) => {
        for (const update of from.log.slice(sent.get(from) ?? 0)) {
          for (const to of peers) if (to !== from) inboxes.get(to)?.push(update);
        }
        sent.set(from, from.log.length);
      };
      const deliverOne = (to: Peer) => {
        const inbox = inboxes.get(to);
        if (!inbox || inbox.length === 0) return;
        const index = Math.floor(random() * inbox.length); // any order, not the arrival order
        const update = inbox[index] as Uint8Array;
        to.replica.applyRemoteUpdate(update);
        if (random() < 0.7) inbox.splice(index, 1); // otherwise it stays and will be delivered again
        // Applying a remote update can make Yjs clean up redundant formatting, which is a local
        // update of its own. A provider broadcasts every local update, so the test must too:
        // cleanups that are never exchanged would make replicas delete different format items.
        publish(to);
      };

      for (let step = 0; step < 400; step += 1) {
        const actor = peers[Math.floor(random() * peers.length)] as Peer;
        const roll = random();
        if (roll < 0.55) {
          const operation = OPERATIONS[Math.floor(random() * OPERATIONS.length)] as Operation;
          operation(actor, random);
          publish(actor);
        } else {
          deliverOne(actor);
        }
      }

      // Everything is delivered eventually, in random order, some of it twice. Delivering can
      // itself produce updates (formatting cleanup), so repeat until the network is quiet.
      for (let round = 0; round < 20; round += 1) {
        for (const p of peers) publish(p);
        let delivered = false;
        for (const to of peers) {
          const inbox = inboxes.get(to) ?? [];
          inboxes.set(to, []);
          for (const update of shuffled(inbox, random)) {
            to.replica.applyRemoteUpdate(update);
            delivered = true;
          }
        }
        if (!delivered) break;
      }
      for (const p of peers) {
        expect(p.replica.hasPendingUpdates(), `seed ${seed}: ${p.name} still pending`).toBe(false);
      }
      expectConverged(peers, `seed ${seed}`);
    },
  );
});
