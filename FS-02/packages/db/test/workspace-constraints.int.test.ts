import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '../src/index.js';
import { requireInfraEnv } from '../../../tests/helpers.js';

/**
 * Constraints Prisma cannot express, added by hand in the Phase 3 migration
 * (docs/DATABASE_SCHEMA.md §5). Run against a real, migrated PostgreSQL.
 */
const { DATABASE_URL } = requireInfraEnv();
const DOMAIN = '@db-constraints.example';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createPrismaClient(DATABASE_URL);
});

afterAll(async () => {
  await prisma.workspace.deleteMany({
    where: { members: { some: { user: { email: { endsWith: DOMAIN } } } } },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.$disconnect();
});

async function user() {
  return prisma.user.create({
    data: {
      email: `u-${randomUUID().slice(0, 8)}${DOMAIN}`,
      passwordHash: 'not-a-real-hash',
      displayName: 'T',
      presenceColor: '#4F46E5',
    },
    select: { id: true },
  });
}

async function workspaceWithOwner(ownerId: string) {
  return prisma.workspace.create({
    data: {
      name: 'W',
      createdById: ownerId,
      members: { create: { userId: ownerId, role: 'OWNER' } },
    },
    select: { id: true },
  });
}

describe('one owner per workspace', () => {
  it('allows creating a workspace together with its owner', async () => {
    const owner = await user();
    const ws = await workspaceWithOwner(owner.id);
    expect(
      await prisma.workspaceMember.count({ where: { workspaceId: ws.id, role: 'OWNER' } }),
    ).toBe(1);
  });

  it('rejects a second OWNER', async () => {
    const owner = await user();
    const other = await user();
    const ws = await workspaceWithOwner(owner.id);
    await expect(
      prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: other.id, role: 'OWNER' },
      }),
    ).rejects.toThrow();
  });

  it('rejects a workspace committed without an owner', async () => {
    const owner = await user();
    await expect(
      prisma.workspace.create({ data: { name: 'Ownerless', createdById: owner.id } }),
    ).rejects.toThrow();
  });

  it('rejects removing or demoting the only owner while the workspace survives', async () => {
    const owner = await user();
    const ws = await workspaceWithOwner(owner.id);
    await expect(
      prisma.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: owner.id } },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: owner.id } },
        data: { role: 'ADMIN' },
      }),
    ).rejects.toThrow();
    expect(
      await prisma.workspaceMember.count({ where: { workspaceId: ws.id, role: 'OWNER' } }),
    ).toBe(1);
  });

  it('allows transferring ownership inside one transaction', async () => {
    const owner = await user();
    const next = await user();
    const ws = await workspaceWithOwner(owner.id);
    await prisma.workspaceMember.create({
      data: { workspaceId: ws.id, userId: next.id, role: 'EDITOR' },
    });
    await prisma.$transaction(async (tx) => {
      await tx.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: owner.id } },
        data: { role: 'ADMIN' },
      });
      await tx.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: next.id } },
        data: { role: 'OWNER' },
      });
    });
    const owners = await prisma.workspaceMember.findMany({
      where: { workspaceId: ws.id, role: 'OWNER' },
    });
    expect(owners.map((m) => m.userId)).toEqual([next.id]);
  });

  it('allows deleting a whole workspace (owner membership cascades)', async () => {
    const owner = await user();
    const ws = await workspaceWithOwner(owner.id);
    await prisma.workspace.delete({ where: { id: ws.id } });
    expect(await prisma.workspaceMember.count({ where: { workspaceId: ws.id } })).toBe(0);
  });
});

describe('invitation constraints', () => {
  const base = (workspaceId: string, email: string, status: 'PENDING' | 'REVOKED' = 'PENDING') => ({
    workspaceId,
    email,
    role: 'EDITOR' as const,
    tokenHash: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
    status,
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  it('rejects OWNER invitations, upper-case emails and malformed token hashes', async () => {
    const owner = await user();
    const ws = await workspaceWithOwner(owner.id);
    await expect(
      prisma.invitation.create({ data: { ...base(ws.id, 'a@x.example'), role: 'OWNER' } }),
    ).rejects.toThrow();
    await expect(prisma.invitation.create({ data: base(ws.id, 'A@x.example') })).rejects.toThrow();
    await expect(
      prisma.invitation.create({
        data: { ...base(ws.id, 'b@x.example'), tokenHash: 'plain-token' },
      }),
    ).rejects.toThrow();
  });

  it('allows one pending invitation per email, and a new one after the old is closed', async () => {
    const owner = await user();
    const ws = await workspaceWithOwner(owner.id);
    const first = await prisma.invitation.create({ data: base(ws.id, 'p@x.example') });
    await expect(prisma.invitation.create({ data: base(ws.id, 'p@x.example') })).rejects.toThrow();
    await prisma.invitation.update({ where: { id: first.id }, data: { status: 'REVOKED' } });
    await expect(
      prisma.invitation.create({ data: base(ws.id, 'p@x.example') }),
    ).resolves.toBeDefined();
  });
});

describe('page constraints', () => {
  it('rejects a parent from another workspace (composite foreign key)', async () => {
    const owner = await user();
    const wsA = await workspaceWithOwner(owner.id);
    const wsB = await workspaceWithOwner(owner.id);
    const parent = await prisma.page.create({
      data: { workspaceId: wsA.id, position: 'i' },
      select: { id: true },
    });
    await expect(
      prisma.page.create({ data: { workspaceId: wsB.id, parentId: parent.id, position: 'i' } }),
    ).rejects.toThrow();
  });

  it('rejects a page that is its own parent, and malformed position keys', async () => {
    const owner = await user();
    const ws = await workspaceWithOwner(owner.id);
    const page = await prisma.page.create({
      data: { workspaceId: ws.id, position: 'i' },
      select: { id: true },
    });
    await expect(
      prisma.page.update({ where: { id: page.id }, data: { parentId: page.id } }),
    ).rejects.toThrow();
    for (const position of ['', 'I', 'a0', 'a b']) {
      await expect(
        prisma.page.create({ data: { workspaceId: ws.id, position } }),
      ).rejects.toThrow();
    }
  });

  it('cascades from parent to children and to permissions', async () => {
    const owner = await user();
    const member = await user();
    const ws = await workspaceWithOwner(owner.id);
    await prisma.workspaceMember.create({
      data: { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
    });
    const parent = await prisma.page.create({
      data: { workspaceId: ws.id, position: 'i' },
      select: { id: true },
    });
    const child = await prisma.page.create({
      data: { workspaceId: ws.id, parentId: parent.id, position: 'i' },
      select: { id: true },
    });
    await prisma.pagePermission.create({
      data: { pageId: child.id, userId: member.id, role: 'VIEWER' },
    });
    await prisma.page.delete({ where: { id: parent.id } });
    expect(await prisma.page.count({ where: { id: child.id } })).toBe(0);
    expect(await prisma.pagePermission.count({ where: { pageId: child.id } })).toBe(0);
  });

  it('allows one override per page and user', async () => {
    const owner = await user();
    const member = await user();
    const ws = await workspaceWithOwner(owner.id);
    await prisma.workspaceMember.create({
      data: { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
    });
    const page = await prisma.page.create({
      data: { workspaceId: ws.id, position: 'i' },
      select: { id: true },
    });
    await prisma.pagePermission.create({
      data: { pageId: page.id, userId: member.id, role: 'VIEWER' },
    });
    await expect(
      prisma.pagePermission.create({ data: { pageId: page.id, userId: member.id, role: 'NONE' } }),
    ).rejects.toThrow();
  });
});
