import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_ROLES,
  WORKSPACE_ROLES,
  canCommentOnPage,
  canEditPage,
  canInviteWithRole,
  canReadPage,
  canRestrictMember,
  decideRemoval,
  decideRoleChange,
  resolveEffectivePageRole,
  roleAtLeast,
  workspaceRoleAtLeast,
  type PageAccessRole,
  type WorkspaceRole,
} from './index.js';

const resolve = (
  workspaceRole: WorkspaceRole | null,
  ...overrideChain: (PageAccessRole | null)[]
) => resolveEffectivePageRole({ workspaceRole, overrideChain });

describe('role ordering', () => {
  it('orders VIEWER < COMMENTER < EDITOR < ADMIN < OWNER', () => {
    expect([...WORKSPACE_ROLES]).toEqual(['VIEWER', 'COMMENTER', 'EDITOR', 'ADMIN', 'OWNER']);
    expect(roleAtLeast('EDITOR', 'COMMENTER')).toBe(true);
    expect(roleAtLeast('COMMENTER', 'EDITOR')).toBe(false);
    expect(roleAtLeast('NONE', 'VIEWER')).toBe(false);
    expect(workspaceRoleAtLeast(null, 'VIEWER')).toBe(false);
    expect(workspaceRoleAtLeast('ADMIN', 'ADMIN')).toBe(true);
  });

  it('never allows OWNER as an assignable role', () => {
    expect([...ASSIGNABLE_ROLES]).not.toContain('OWNER');
  });
});

describe('resolveEffectivePageRole (D23)', () => {
  it('gives non-members no access, whatever overrides exist', () => {
    expect(resolve(null)).toBe('NONE');
    expect(resolve(null, 'EDITOR')).toBe('NONE');
  });

  it('falls back to the workspace role without overrides', () => {
    for (const role of WORKSPACE_ROLES) expect(resolve(role, null, null)).toBe(role);
  });

  it('lets an override on the page replace the workspace role, up or down', () => {
    expect(resolve('EDITOR', 'VIEWER')).toBe('VIEWER');
    expect(resolve('VIEWER', 'EDITOR')).toBe('EDITOR');
    expect(resolve('COMMENTER', 'NONE')).toBe('NONE');
  });

  it('inherits the nearest ancestor override, the page itself winning', () => {
    expect(resolve('EDITOR', null, 'VIEWER', 'NONE')).toBe('VIEWER');
    expect(resolve('EDITOR', null, null, 'NONE')).toBe('NONE');
    expect(resolve('EDITOR', 'EDITOR', 'NONE')).toBe('EDITOR');
  });

  it('never restricts admins or the owner', () => {
    for (const role of ['ADMIN', 'OWNER'] as const) {
      expect(resolve(role, 'NONE')).toBe(role);
      expect(resolve(role, null, 'VIEWER')).toBe(role);
    }
  });

  it('exposes capability helpers consistent with the order', () => {
    expect(canReadPage('NONE')).toBe(false);
    expect(canReadPage('VIEWER')).toBe(true);
    expect(canCommentOnPage('VIEWER')).toBe(false);
    expect(canCommentOnPage('COMMENTER')).toBe(true);
    expect(canEditPage('COMMENTER')).toBe(false);
    expect(canEditPage('EDITOR')).toBe(true);
    expect(canEditPage('ADMIN')).toBe(true);
  });

  it('only lets non-admin members be restricted', () => {
    expect(canRestrictMember('EDITOR')).toBe(true);
    expect(canRestrictMember('VIEWER')).toBe(true);
    expect(canRestrictMember('ADMIN')).toBe(false);
    expect(canRestrictMember('OWNER')).toBe(false);
  });
});

describe('workspace management rules', () => {
  it('lets only admins invite, and only the owner invite admins', () => {
    expect(canInviteWithRole('EDITOR', 'VIEWER')).toBe(false);
    expect(canInviteWithRole('ADMIN', 'EDITOR')).toBe(true);
    expect(canInviteWithRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canInviteWithRole('OWNER', 'ADMIN')).toBe(true);
  });

  it('protects the owner and limits what an admin can change', () => {
    expect(decideRoleChange('OWNER', 'EDITOR', 'ADMIN')).toBe('ALLOWED');
    expect(decideRoleChange('OWNER', 'OWNER', 'EDITOR')).toBe('OWNER_PROTECTED');
    expect(decideRoleChange('ADMIN', 'OWNER', 'EDITOR')).toBe('OWNER_PROTECTED');
    expect(decideRoleChange('ADMIN', 'VIEWER', 'EDITOR')).toBe('ALLOWED');
    expect(decideRoleChange('ADMIN', 'VIEWER', 'ADMIN')).toBe('FORBIDDEN');
    expect(decideRoleChange('ADMIN', 'ADMIN', 'EDITOR')).toBe('FORBIDDEN');
    expect(decideRoleChange('EDITOR', 'VIEWER', 'COMMENTER')).toBe('FORBIDDEN');
    expect(decideRoleChange('EDITOR', 'OWNER', 'COMMENTER')).toBe('FORBIDDEN');
  });

  it('decides removal and leaving', () => {
    expect(decideRemoval('OWNER', 'OWNER', true)).toBe('OWNER_PROTECTED');
    expect(decideRemoval('ADMIN', 'OWNER', false)).toBe('OWNER_PROTECTED');
    expect(decideRemoval('VIEWER', 'VIEWER', true)).toBe('ALLOWED');
    expect(decideRemoval('ADMIN', 'ADMIN', true)).toBe('ALLOWED');
    expect(decideRemoval('VIEWER', 'EDITOR', false)).toBe('FORBIDDEN');
    expect(decideRemoval('ADMIN', 'ADMIN', false)).toBe('FORBIDDEN');
    expect(decideRemoval('ADMIN', 'EDITOR', false)).toBe('ALLOWED');
    expect(decideRemoval('OWNER', 'ADMIN', false)).toBe('ALLOWED');
  });
});

describe('resolveEffectivePageRole: exhaustive (AC-3.1)', () => {
  const memberRoles: (WorkspaceRole | null)[] = [null, ...WORKSPACE_ROLES];
  const overrides: (PageAccessRole | null)[] = [null, 'NONE', 'VIEWER', 'COMMENTER', 'EDITOR'];

  /** Every override chain of the given depth (index 0 = the page itself, then its ancestors). */
  function chains(depth: number): (PageAccessRole | null)[][] {
    if (depth === 0) return [[]];
    return chains(depth - 1).flatMap((rest) => overrides.map((first) => [first, ...rest]));
  }

  /** Independent statement of the D23 table, written as explicit rules rather than reusing the implementation. */
  function expected(role: WorkspaceRole | null, chain: (PageAccessRole | null)[]) {
    if (role === null) return 'NONE';
    if (role === 'ADMIN' || role === 'OWNER') return role;
    const nearest = chain.find((entry) => entry !== null);
    return nearest ?? role;
  }

  it('matches the D23 table for every role, override and inheritance depth 0–4', () => {
    let combinations = 0;
    for (const role of memberRoles) {
      for (let depth = 0; depth <= 4; depth += 1) {
        for (const chain of chains(depth)) {
          expect(resolveEffectivePageRole({ workspaceRole: role, overrideChain: chain })).toBe(
            expected(role, chain),
          );
          combinations += 1;
        }
      }
    }
    // 6 roles × (1 + 5 + 25 + 125 + 625) chains.
    expect(combinations).toBe(6 * 781);
  });

  it('holds the invariants: non-members never have access, admins and owners never lose it', () => {
    for (let depth = 0; depth <= 4; depth += 1) {
      for (const chain of chains(depth)) {
        expect(resolve(null, ...chain)).toBe('NONE');
        expect(resolve('ADMIN', ...chain)).toBe('ADMIN');
        expect(resolve('OWNER', ...chain)).toBe('OWNER');
        for (const role of ['VIEWER', 'COMMENTER', 'EDITOR'] as const) {
          const nearest = chain.find((entry) => entry !== null);
          if (nearest === 'NONE') expect(resolve(role, ...chain)).toBe('NONE');
        }
      }
    }
  });
});
