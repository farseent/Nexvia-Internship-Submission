import type { WorkspaceRole } from '@conote/shared';
import { uniqueEmail, type Body, type Harness } from './auth-harness.js';

/** A registered test user with a live session. */
export interface TestUser {
  token: string;
  id: string;
  email: string;
  name: string;
}

export async function newUser(h: Harness, label = 'user'): Promise<TestUser> {
  const email = uniqueEmail(label);
  const res = await h.register({ email, displayName: `Test ${label}` });
  if (res.status !== 201 || res.token === undefined)
    throw new Error('registration failed in test setup');
  return { token: res.token, id: res.body.data.user.id as string, email, name: `Test ${label}` };
}

export async function newWorkspace(h: Harness, owner: TestUser, name = 'Team'): Promise<string> {
  const res = await h.call('POST', '/api/v1/workspaces', { token: owner.token, body: { name } });
  if (res.status !== 201) throw new Error(`workspace creation failed: ${res.status}`);
  return res.body.data.workspace.id as string;
}

/** The raw invitation token embedded in an invite URL (`…/invite#token=<token>`). */
export function tokenFromUrl(inviteUrl: string): string {
  const token = inviteUrl.split('#token=')[1];
  if (token === undefined) throw new Error('invite URL has no token');
  return token;
}

/** Invite a fresh user by email and have them accept: returns the new member. */
export async function addMember(
  h: Harness,
  workspaceId: string,
  inviter: TestUser,
  role: Exclude<WorkspaceRole, 'OWNER'>,
): Promise<TestUser> {
  const member = await newUser(h, role.toLowerCase());
  const invite = await h.call('POST', `/api/v1/workspaces/${workspaceId}/invitations`, {
    token: inviter.token,
    body: { email: member.email, role },
  });
  if (invite.status !== 201) throw new Error(`invitation failed in test setup: ${invite.status}`);
  const accept = await h.call('POST', '/api/v1/invitations/accept', {
    token: member.token,
    body: { token: tokenFromUrl(invite.body.data.inviteUrl as string) },
  });
  if (accept.status !== 200) throw new Error(`accept failed in test setup: ${accept.status}`);
  return member;
}

export async function newPage(
  h: Harness,
  user: TestUser,
  workspaceId: string,
  body: Record<string, unknown> = {},
): Promise<Body> {
  const res = await h.call('POST', `/api/v1/workspaces/${workspaceId}/pages`, {
    token: user.token,
    body,
  });
  if (res.status !== 201) throw new Error(`page creation failed in test setup: ${res.status}`);
  return res.body.data.page;
}

export const errorCode = (res: { body: Body }): string | undefined => res.body?.error?.code;
