import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { expect } from 'vitest';
import { YJS_FRAGMENT_NAME, encodeDocumentCoverage, stateVectorsEqual } from '@conote/shared';
import type { PrismaClient } from '../src/index.js';

/** Email domain of every user the document-store tests create; used for cleanup. */
export const DOCUMENT_TEST_DOMAIN = '@document-store.example';

export async function cleanupDocumentTestData(prisma: PrismaClient): Promise<void> {
  await prisma.workspace.deleteMany({
    where: { members: { some: { user: { email: { endsWith: DOCUMENT_TEST_DOMAIN } } } } },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOCUMENT_TEST_DOMAIN } } });
}

/** A real page (the document tables reference `pages`) in a throw-away workspace. */
export async function createTestPage(prisma: PrismaClient): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `d-${randomUUID().slice(0, 8)}${DOCUMENT_TEST_DOMAIN}`,
      passwordHash: 'not-a-real-hash',
      displayName: 'T',
      presenceColor: '#4F46E5',
    },
    select: { id: true },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: 'W',
      createdById: user.id,
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
    select: { id: true },
  });
  const page = await prisma.page.create({
    data: { workspaceId: workspace.id, position: 'i' },
    select: { id: true },
  });
  return page.id;
}

// ───────────── document editing helpers ─────────────

export const fragmentOf = (doc: Y.Doc) => doc.getXmlFragment(YJS_FRAGMENT_NAME);

export function addParagraph(doc: Y.Doc, text: string, index?: number): void {
  const fragment = fragmentOf(doc);
  doc.transact(() => {
    const paragraph = new Y.XmlElement('paragraph');
    fragment.insert(index ?? fragment.length, [paragraph]);
    const node = new Y.XmlText();
    paragraph.insert(0, [node]);
    node.insert(0, text);
  });
}

export function textAt(doc: Y.Doc, paragraph: number): Y.XmlText {
  const element = fragmentOf(doc).get(paragraph);
  if (!(element instanceof Y.XmlElement)) throw new Error(`no paragraph ${paragraph}`);
  const node = element.get(0);
  if (!(node instanceof Y.XmlText)) throw new Error(`paragraph ${paragraph} has no text`);
  return node;
}

/** Readable content of a document: every paragraph's text, formatting included. */
export function contentOf(doc: Y.Doc): string {
  return fragmentOf(doc).toString();
}

/** Same content, same operations, same deletions. */
export function expectSameDocument(actual: Y.Doc, expected: Y.Doc, context = ''): void {
  expect(contentOf(actual), `${context} content`).toBe(contentOf(expected));
  expect(
    stateVectorsEqual(Y.encodeStateVector(actual), Y.encodeStateVector(expected)),
    `${context} state vector`,
  ).toBe(true);
  expect(Buffer.from(encodeDocumentCoverage(actual)).toString('hex'), `${context} coverage`).toBe(
    Buffer.from(encodeDocumentCoverage(expected)).toString('hex'),
  );
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One random edit of the document (insert, delete, format, add or remove a paragraph). */
export function randomEdit(doc: Y.Doc, random: () => number): void {
  const fragment = fragmentOf(doc);
  const roll = random();
  if (fragment.length === 0 || roll < 0.15) {
    addParagraph(
      doc,
      `p${Math.floor(random() * 1000)}`,
      Math.floor(random() * (fragment.length + 1)),
    );
    return;
  }
  if (roll < 0.2 && fragment.length > 1) {
    fragment.delete(Math.floor(random() * fragment.length), 1);
    return;
  }
  const node = textAt(doc, Math.floor(random() * fragment.length));
  if (roll < 0.6 || node.length < 3) {
    node.insert(
      Math.floor(random() * (node.length + 1)),
      String.fromCharCode(97 + Math.floor(random() * 26)),
    );
  } else if (roll < 0.8) {
    const index = Math.floor(random() * node.length);
    node.delete(index, 1 + Math.floor(random() * Math.min(3, node.length - index)));
  } else {
    const index = Math.floor(random() * (node.length - 1));
    node.format(index, 1 + Math.floor(random() * (node.length - index - 1)), {
      [random() < 0.5 ? 'bold' : 'italic']: random() < 0.7 ? {} : null,
    });
  }
}
