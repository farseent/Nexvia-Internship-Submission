import { describe, expect, it } from 'vitest';
import {
  INVITATION_TOKEN_PATTERN,
  PAGE_TITLE_MAX_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
  buildInviteUrl,
  createInvitationRequestSchema,
  createPageRequestSchema,
  createWorkspaceRequestSchema,
  deleteWorkspaceRequestSchema,
  maskEmail,
  movePageRequestSchema,
  parseInviteFragment,
  setPagePermissionRequestSchema,
  updateMemberRoleRequestSchema,
  updatePageRequestSchema,
} from './index.js';

const TOKEN = 'A'.repeat(43);
const UUID = '6f1f0a2e-8f5b-4a39-9d0c-3a2f4e1b7c11';

describe('workspace requests', () => {
  it('trims and bounds the name', () => {
    expect(createWorkspaceRequestSchema.parse({ name: '  Team  ' }).name).toBe('Team');
    expect(createWorkspaceRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(
      createWorkspaceRequestSchema.safeParse({ name: 'x'.repeat(WORKSPACE_NAME_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(createWorkspaceRequestSchema.safeParse({ name: 'A', role: 'OWNER' }).success).toBe(
      false,
    );
  });

  it('requires a confirmation name for deletion', () => {
    expect(deleteWorkspaceRequestSchema.safeParse({}).success).toBe(false);
    expect(deleteWorkspaceRequestSchema.safeParse({ confirmName: 'Team' }).success).toBe(true);
  });

  it('never accepts OWNER as a member or invitation role', () => {
    expect(updateMemberRoleRequestSchema.safeParse({ role: 'OWNER' }).success).toBe(false);
    expect(updateMemberRoleRequestSchema.safeParse({ role: 'EDITOR' }).success).toBe(true);
    expect(
      createInvitationRequestSchema.safeParse({ email: 'a@example.com', role: 'OWNER' }).success,
    ).toBe(false);
  });

  it('normalizes the invitation email', () => {
    const parsed = createInvitationRequestSchema.parse({
      email: ' Ada@Example.COM ',
      role: 'VIEWER',
    });
    expect(parsed.email).toBe('ada@example.com');
  });
});

describe('page requests', () => {
  it('allows an empty title but bounds its length', () => {
    expect(createPageRequestSchema.safeParse({ title: '' }).success).toBe(true);
    expect(
      createPageRequestSchema.safeParse({ title: 'x'.repeat(PAGE_TITLE_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it('requires at least one field to update', () => {
    expect(updatePageRequestSchema.safeParse({}).success).toBe(false);
    expect(updatePageRequestSchema.safeParse({ icon: null }).success).toBe(true);
    expect(updatePageRequestSchema.safeParse({ title: 'New' }).success).toBe(true);
  });

  it('validates move and permission bodies', () => {
    expect(movePageRequestSchema.safeParse({ parentId: null }).success).toBe(true);
    expect(movePageRequestSchema.safeParse({ parentId: UUID, afterPageId: null }).success).toBe(
      true,
    );
    expect(movePageRequestSchema.safeParse({ parentId: 'nope' }).success).toBe(false);
    expect(setPagePermissionRequestSchema.safeParse({ role: 'NONE' }).success).toBe(true);
    expect(setPagePermissionRequestSchema.safeParse({ role: 'ADMIN' }).success).toBe(false);
  });
});

describe('invitation links', () => {
  it('builds a fragment link and parses it back', () => {
    const url = buildInviteUrl('http://localhost:3000/', TOKEN);
    expect(url).toBe(`http://localhost:3000/invite#token=${TOKEN}`);
    expect(parseInviteFragment(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(INVITATION_TOKEN_PATTERN.test(TOKEN)).toBe(true);
  });

  it('rejects malformed fragments', () => {
    expect(parseInviteFragment('')).toBeNull();
    expect(parseInviteFragment('#token=short')).toBeNull();
    expect(parseInviteFragment('#other=value')).toBeNull();
  });

  it('masks the address', () => {
    expect(maskEmail('jane@example.com')).toBe('j***@example.com');
    expect(maskEmail('nonsense')).toBe('***');
  });
});
