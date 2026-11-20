import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  createHarness,
  deleteTestUsers,
  subscribeAccessEvents,
  type Harness,
} from './auth-harness.js';
import { requireInfraEnv } from '../../../tests/helpers.js';
import { addMember, errorCode, newUser, newWorkspace, tokenFromUrl } from './workspace-harness.js';

const DAY = 24 * 60 * 60 * 1000;

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await deleteTestUsers(h.deps);
  await h.close();
});

describe('workspaces (WS-01 … WS-05)', () => {
  it('creates a workspace with the creator as its owner and logs it', async () => {
    const owner = await newUser(h, 'owner');
    const res = await h.call('POST', '/api/v1/workspaces', {
      token: owner.token,
      body: { name: '  Product Team  ' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.workspace).toMatchObject({ name: 'Product Team', myRole: 'OWNER' });

    const id = res.body.data.workspace.id as string;
    const members = await h.call('GET', `/api/v1/workspaces/${id}/members`, { token: owner.token });
    expect(members.body.data.members).toHaveLength(1);
    expect(members.body.data.members[0]).toMatchObject({ role: 'OWNER', email: owner.email });

    const activity = await h.call('GET', `/api/v1/workspaces/${id}/activity`, {
      token: owner.token,
    });
    expect(activity.body.data.activity.map((a: { action: string }) => a.action)).toContain(
      'workspace.created',
    );
  });

  it('validates the name and rejects unknown fields', async () => {
    const owner = await newUser(h);
    const blank = await h.call('POST', '/api/v1/workspaces', {
      token: owner.token,
      body: { name: '  ' },
    });
    expect(blank.status).toBe(400);
    expect(errorCode(blank)).toBe('VALIDATION_ERROR');
    const extra = await h.call('POST', '/api/v1/workspaces', {
      token: owner.token,
      body: { name: 'A', role: 'OWNER' },
    });
    expect(extra.status).toBe(400);
  });

  it('lists only the workspaces the caller belongs to, with their role', async () => {
    const owner = await newUser(h, 'owner');
    const other = await newUser(h, 'other');
    const mine = await newWorkspace(h, owner, 'Mine');
    await newWorkspace(h, other, 'Theirs');
    const viewer = await addMember(h, mine, owner, 'VIEWER');

    const ownerList = await h.call('GET', '/api/v1/workspaces', { token: owner.token });
    expect(ownerList.body.data.workspaces.map((w: { name: string }) => w.name)).toEqual(['Mine']);
    const viewerList = await h.call('GET', '/api/v1/workspaces', { token: viewer.token });
    expect(viewerList.body.data.workspaces).toHaveLength(1);
    expect(viewerList.body.data.workspaces[0]).toMatchObject({ name: 'Mine', myRole: 'VIEWER' });
  });

  it('hides a workspace from non-members (404) and requires a session (401)', async () => {
    const owner = await newUser(h, 'owner');
    const stranger = await newUser(h, 'stranger');
    const id = await newWorkspace(h, owner);
    const res = await h.call('GET', `/api/v1/workspaces/${id}`, { token: stranger.token });
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('NOT_FOUND');
    expect((await h.call('GET', `/api/v1/workspaces/${id}`)).status).toBe(401);
    expect((await h.call('GET', '/api/v1/workspaces')).status).toBe(401);
  });

  it('lets only admins and the owner rename; members get 403, strangers 404', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner, 'Old');
    const admin = await addMember(h, id, owner, 'ADMIN');
    const editor = await addMember(h, id, owner, 'EDITOR');
    const stranger = await newUser(h, 'stranger');

    const ok = await h.call('PATCH', `/api/v1/workspaces/${id}`, {
      token: admin.token,
      body: { name: 'New' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.workspace).toMatchObject({ name: 'New', myRole: 'ADMIN' });
    expect(
      (
        await h.call('PATCH', `/api/v1/workspaces/${id}`, {
          token: editor.token,
          body: { name: 'X' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await h.call('PATCH', `/api/v1/workspaces/${id}`, {
          token: stranger.token,
          body: { name: 'X' },
        })
      ).status,
    ).toBe(404);
  });

  it('deletes a workspace only for the owner, after the exact name is retyped', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner, 'Doomed');
    const admin = await addMember(h, id, owner, 'ADMIN');

    const byAdmin = await h.call('DELETE', `/api/v1/workspaces/${id}`, {
      token: admin.token,
      body: { confirmName: 'Doomed' },
    });
    expect(byAdmin.status).toBe(403);

    const wrong = await h.call('DELETE', `/api/v1/workspaces/${id}`, {
      token: owner.token,
      body: { confirmName: 'doomed' },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details[0].path).toBe('confirmName');
    expect((await h.call('GET', `/api/v1/workspaces/${id}`, { token: owner.token })).status).toBe(
      200,
    );

    const sub = await subscribeAccessEvents(requireInfraEnv().REDIS_URL);
    try {
      const done = await h.call('DELETE', `/api/v1/workspaces/${id}`, {
        token: owner.token,
        body: { confirmName: 'Doomed' },
      });
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ success: true, data: null });
      const events = await sub.waitFor(1);
      expect(events[0]).toMatchObject({ v: 1, type: 'workspace.deleted', workspaceId: id });
    } finally {
      await sub.stop();
    }
    expect((await h.call('GET', `/api/v1/workspaces/${id}`, { token: owner.token })).status).toBe(
      404,
    );
    expect((await h.call('GET', `/api/v1/workspaces/${id}`, { token: admin.token })).status).toBe(
      404,
    );
  });

  it('cascades pages, memberships and invitations when a workspace is deleted', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner, 'Cascade');
    await h.call('POST', `/api/v1/workspaces/${id}/pages`, {
      token: owner.token,
      body: { title: 'P' },
    });
    await h.call('DELETE', `/api/v1/workspaces/${id}`, {
      token: owner.token,
      body: { confirmName: 'Cascade' },
    });
    expect(await h.deps.prisma.page.count({ where: { workspaceId: id } })).toBe(0);
    expect(await h.deps.prisma.workspaceMember.count({ where: { workspaceId: id } })).toBe(0);
  });
});

describe('membership (WS-06 … WS-09)', () => {
  it('shows member emails only to admins', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner);
    const viewer = await addMember(h, id, owner, 'VIEWER');
    const asViewer = await h.call('GET', `/api/v1/workspaces/${id}/members`, {
      token: viewer.token,
    });
    expect(asViewer.status).toBe(200);
    expect(asViewer.body.data.members).toHaveLength(2);
    expect(asViewer.body.data.members[0].email).toBeUndefined();
    expect(JSON.stringify(asViewer.body)).not.toContain(owner.email);
    const asOwner = await h.call('GET', `/api/v1/workspaces/${id}/members`, { token: owner.token });
    expect(asOwner.body.data.members[0]).toMatchObject({ role: 'OWNER', email: owner.email });
  });

  it('changes roles within the rules and publishes an access event', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner);
    const admin = await addMember(h, id, owner, 'ADMIN');
    const editor = await addMember(h, id, owner, 'EDITOR');
    const viewer = await addMember(h, id, owner, 'VIEWER');
    const patch = (token: string, userId: string, role: string) =>
      h.call('PATCH', `/api/v1/workspaces/${id}/members/${userId}`, { token, body: { role } });

    const sub = await subscribeAccessEvents(requireInfraEnv().REDIS_URL);
    try {
      const ok = await patch(admin.token, viewer.id, 'COMMENTER');
      expect(ok.status).toBe(200);
      expect(ok.body.data.member).toMatchObject({ role: 'COMMENTER' });
      const events = await sub.waitFor(1);
      expect(events[0]).toMatchObject({
        type: 'member.role_changed',
        workspaceId: id,
        userId: viewer.id,
      });
    } finally {
      await sub.stop();
    }

    // Only the owner grants or revokes ADMIN; an admin cannot touch another admin.
    expect((await patch(admin.token, editor.id, 'ADMIN')).status).toBe(403);
    expect((await patch(owner.token, editor.id, 'ADMIN')).status).toBe(200);
    expect((await patch(admin.token, editor.id, 'VIEWER')).status).toBe(403);
    // Plain members cannot manage anyone; the owner's role is protected.
    expect((await patch(viewer.token, editor.id, 'VIEWER')).status).toBe(403);
    const protectedOwner = await patch(owner.token, owner.id, 'EDITOR');
    expect(protectedOwner.status).toBe(409);
    expect(errorCode(protectedOwner)).toBe('OWNER_PROTECTED');
    const viaAdmin = await patch(admin.token, owner.id, 'EDITOR');
    expect(errorCode(viaAdmin)).toBe('OWNER_PROTECTED');
    // OWNER cannot be assigned through this endpoint, and unknown members are 404.
    expect((await patch(owner.token, viewer.id, 'OWNER')).status).toBe(400);
    const stranger = await newUser(h, 'stranger');
    expect((await patch(owner.token, stranger.id, 'VIEWER')).status).toBe(404);
  });

  it('removes members, lets members leave, and protects the owner', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner);
    const admin = await addMember(h, id, owner, 'ADMIN');
    const admin2 = await addMember(h, id, owner, 'ADMIN');
    const editor = await addMember(h, id, owner, 'EDITOR');
    const viewer = await addMember(h, id, owner, 'VIEWER');
    const del = (token: string, userId: string) =>
      h.call('DELETE', `/api/v1/workspaces/${id}/members/${userId}`, { token });

    expect((await del(viewer.token, editor.id)).status).toBe(403);
    expect((await del(admin.token, admin2.id)).status).toBe(403);
    const owned = await del(admin.token, owner.id);
    expect(owned.status).toBe(409);
    expect(errorCode(owned)).toBe('OWNER_PROTECTED');
    const ownerLeaves = await del(owner.token, owner.id);
    expect(errorCode(ownerLeaves)).toBe('OWNER_PROTECTED');

    const sub = await subscribeAccessEvents(requireInfraEnv().REDIS_URL);
    try {
      expect((await del(admin.token, editor.id)).status).toBe(200);
      const events = await sub.waitFor(1);
      expect(events[0]).toMatchObject({
        type: 'member.removed',
        workspaceId: id,
        userId: editor.id,
      });
    } finally {
      await sub.stop();
    }
    expect((await h.call('GET', `/api/v1/workspaces/${id}`, { token: editor.token })).status).toBe(
      404,
    );

    expect((await del(viewer.token, viewer.id)).status).toBe(200); // leave
    expect((await h.call('GET', `/api/v1/workspaces/${id}`, { token: viewer.token })).status).toBe(
      404,
    );
    expect((await del(owner.token, admin2.id)).status).toBe(200); // the owner may remove an admin

    const actions = (
      await h.call('GET', `/api/v1/workspaces/${id}/activity?limit=100`, { token: owner.token })
    ).body.data.activity.map((a: { action: string }) => a.action);
    expect(actions).toContain('member.removed');
    expect(actions).toContain('member.left');
  });

  it('deletes a removed member’s page overrides in the same operation', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner);
    const editor = await addMember(h, id, owner, 'EDITOR');
    const page = await h.call('POST', `/api/v1/workspaces/${id}/pages`, {
      token: owner.token,
      body: { title: 'P' },
    });
    const pageId = page.body.data.page.id as string;
    await h.call('PUT', `/api/v1/pages/${pageId}/permissions/${editor.id}`, {
      token: owner.token,
      body: { role: 'VIEWER' },
    });
    expect(await h.deps.prisma.pagePermission.count({ where: { pageId } })).toBe(1);
    await h.call('DELETE', `/api/v1/workspaces/${id}/members/${editor.id}`, { token: owner.token });
    expect(await h.deps.prisma.pagePermission.count({ where: { pageId } })).toBe(0);
  });

  it('transfers ownership atomically after re-entering the password', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner);
    const editor = await addMember(h, id, owner, 'EDITOR');
    const url = `/api/v1/workspaces/${id}/transfer-ownership`;

    const wrong = await h.call('POST', url, {
      token: owner.token,
      body: { userId: editor.id, password: 'wrong password!!' },
    });
    expect(wrong.status).toBe(401);
    expect(errorCode(wrong)).toBe('INVALID_CREDENTIALS');
    expect(
      (
        await h.call('POST', url, {
          token: editor.token,
          body: { userId: owner.id, password: PASSWORD },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await h.call('POST', url, {
          token: owner.token,
          body: { userId: owner.id, password: PASSWORD },
        })
      ).status,
    ).toBe(400);
    const stranger = await newUser(h, 'stranger');
    expect(
      (
        await h.call('POST', url, {
          token: owner.token,
          body: { userId: stranger.id, password: PASSWORD },
        })
      ).status,
    ).toBe(404);

    const ok = await h.call('POST', url, {
      token: owner.token,
      body: { userId: editor.id, password: PASSWORD },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.workspace.myRole).toBe('ADMIN');

    const members = await h.call('GET', `/api/v1/workspaces/${id}/members`, {
      token: editor.token,
    });
    const roles = Object.fromEntries(
      members.body.data.members.map((m: { user: { id: string }; role: string }) => [
        m.user.id,
        m.role,
      ]),
    );
    expect(roles[editor.id]).toBe('OWNER');
    expect(roles[owner.id]).toBe('ADMIN');
    expect(
      await h.deps.prisma.workspaceMember.count({ where: { workspaceId: id, role: 'OWNER' } }),
    ).toBe(1);
    // The former owner can now leave; the new owner cannot.
    expect(
      (
        await h.call('DELETE', `/api/v1/workspaces/${id}/members/${owner.id}`, {
          token: owner.token,
        })
      ).status,
    ).toBe(200);
    const stuck = await h.call('DELETE', `/api/v1/workspaces/${id}/members/${editor.id}`, {
      token: editor.token,
    });
    expect(errorCode(stuck)).toBe('OWNER_PROTECTED');
  });
});

describe('invitations (INV-01 … INV-07)', () => {
  const invite = (token: string, workspaceId: string, email: string, role = 'EDITOR') =>
    h.call('POST', `/api/v1/workspaces/${workspaceId}/invitations`, {
      token,
      body: { email, role },
    });

  it('creates a link invitation that expires in 7 days and never exposes the token elsewhere', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner);
    const invitee = await newUser(h, 'invitee');
    const res = await invite(owner.token, id, invitee.email.toUpperCase());
    expect(res.status).toBe(201);
    expect(res.body.data.invitation).toMatchObject({
      email: invitee.email,
      role: 'EDITOR',
      status: 'PENDING',
    });
    const token = tokenFromUrl(res.body.data.inviteUrl);
    expect(res.body.data.inviteUrl).toBe(`http://localhost:3000/invite#token=${token}`);
    const expires = new Date(res.body.data.invitation.expiresAt).getTime();
    expect(expires - h.clock.now.getTime()).toBe(7 * DAY);

    const stored = await h.deps.prisma.invitation.findUniqueOrThrow({
      where: { id: res.body.data.invitation.id },
    });
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(token);

    const list = await h.call('GET', `/api/v1/workspaces/${id}/invitations`, {
      token: owner.token,
    });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(list.body.meta).toEqual({ nextCursor: null });
  });

  it('enforces who may invite, and rejects duplicates and existing members', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner);
    const admin = await addMember(h, id, owner, 'ADMIN');
    const editor = await addMember(h, id, owner, 'EDITOR');
    const stranger = await newUser(h, 'stranger');
    const target = await newUser(h, 'target');

    expect((await invite(editor.token, id, target.email)).status).toBe(403);
    expect((await invite(stranger.token, id, target.email)).status).toBe(404);
    expect((await invite(admin.token, id, target.email, 'ADMIN')).status).toBe(403);
    expect((await invite(owner.token, id, target.email, 'OWNER')).status).toBe(400);

    expect((await invite(admin.token, id, target.email)).status).toBe(201);
    const dup = await invite(admin.token, id, target.email, 'VIEWER');
    expect(dup.status).toBe(409);
    expect(errorCode(dup)).toBe('INVITATION_EXISTS');
    const member = await invite(owner.token, id, editor.email);
    expect(member.status).toBe(409);
    expect(errorCode(member)).toBe('ALREADY_MEMBER');
  });

  it('previews a link without a session, with a masked address and one generic error', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner, 'Preview Co');
    const invitee = await newUser(h, 'invitee');
    const created = await invite(owner.token, id, invitee.email, 'COMMENTER');
    const token = tokenFromUrl(created.body.data.inviteUrl);

    const preview = await h.call('POST', '/api/v1/invitations/preview', { body: { token } });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      workspaceName: 'Preview Co',
      role: 'COMMENTER',
      invitedBy: owner.name,
    });
    expect(preview.body.data.emailHint).toMatch(/^[a-z]\*\*\*@/);
    expect(preview.body.data.emailHint).not.toBe(invitee.email);

    const bogus = await h.call('POST', '/api/v1/invitations/preview', {
      body: { token: 'B'.repeat(43) },
    });
    expect(bogus.status).toBe(400);
    expect(errorCode(bogus)).toBe('INVITATION_INVALID');
    const malformed = await h.call('POST', '/api/v1/invitations/preview', {
      body: { token: 'short' },
    });
    expect(malformed.status).toBe(400);
  });

  it('accepts exactly once, for the invited account only', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner);
    const invitee = await newUser(h, 'invitee');
    const wrongUser = await newUser(h, 'wrong');
    const token = tokenFromUrl(
      (await invite(owner.token, id, invitee.email, 'VIEWER')).body.data.inviteUrl,
    );
    const accept = (as: string | undefined) =>
      h.call('POST', '/api/v1/invitations/accept', { token: as, body: { token } });

    expect((await accept(undefined)).status).toBe(401);
    const wrong = await accept(wrongUser.token);
    expect(wrong.status).toBe(400);
    expect(errorCode(wrong)).toBe('INVITATION_INVALID');

    const ok = await accept(invitee.token);
    expect(ok.status).toBe(200);
    expect(ok.body.data.workspace).toMatchObject({ id, myRole: 'VIEWER' });
    const again = await accept(invitee.token);
    expect(again.status).toBe(400);
    expect(errorCode(again)).toBe('INVITATION_INVALID');
    expect((await h.call('POST', '/api/v1/invitations/preview', { body: { token } })).status).toBe(
      400,
    );

    const list = await h.call('GET', `/api/v1/workspaces/${id}/invitations?status=ACCEPTED`, {
      token: owner.token,
    });
    expect(list.body.data.invitations).toHaveLength(1);
  });

  it('lets two concurrent accepts create exactly one membership', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner);
    const invitee = await newUser(h, 'invitee');
    const token = tokenFromUrl((await invite(owner.token, id, invitee.email)).body.data.inviteUrl);
    const results = await Promise.all([
      h.call('POST', '/api/v1/invitations/accept', { token: invitee.token, body: { token } }),
      h.call('POST', '/api/v1/invitations/accept', { token: invitee.token, body: { token } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(
      await h.deps.prisma.workspaceMember.count({ where: { workspaceId: id, userId: invitee.id } }),
    ).toBe(1);
  });

  it('lets the invitee decline, after which the link is dead', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner);
    const invitee = await newUser(h, 'invitee');
    const wrongUser = await newUser(h, 'wrong');
    const token = tokenFromUrl((await invite(owner.token, id, invitee.email)).body.data.inviteUrl);

    expect(
      (
        await h.call('POST', '/api/v1/invitations/decline', {
          token: wrongUser.token,
          body: { token },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.call('POST', '/api/v1/invitations/decline', {
          token: invitee.token,
          body: { token },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await h.call('POST', '/api/v1/invitations/accept', {
          token: invitee.token,
          body: { token },
        })
      ).status,
    ).toBe(400);
    const declined = await h.call('GET', `/api/v1/workspaces/${id}/invitations?status=DECLINED`, {
      token: owner.token,
    });
    expect(declined.body.data.invitations).toHaveLength(1);
    // The address can be invited again once the earlier invitation is closed.
    expect((await invite(owner.token, id, invitee.email)).status).toBe(201);
  });

  it('rejects expired links and reports them as EXPIRED; a new invitation replaces them', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner);
    const invitee = await newUser(h, 'invitee');
    const created = await invite(owner.token, id, invitee.email);
    const token = tokenFromUrl(created.body.data.inviteUrl);

    // Expire it directly: advancing the shared clock a week would also expire the test sessions.
    await h.deps.prisma.invitation.update({
      where: { id: created.body.data.invitation.id as string },
      data: { expiresAt: new Date(h.clock.now.getTime() - 1000) },
    });
    expect((await h.call('POST', '/api/v1/invitations/preview', { body: { token } })).status).toBe(
      400,
    );
    expect(
      (
        await h.call('POST', '/api/v1/invitations/accept', {
          token: invitee.token,
          body: { token },
        })
      ).status,
    ).toBe(400);
    const expired = await h.call('GET', `/api/v1/workspaces/${id}/invitations?status=EXPIRED`, {
      token: owner.token,
    });
    expect(expired.body.data.invitations).toHaveLength(1);
    expect(expired.body.data.invitations[0].status).toBe('EXPIRED');

    const fresh = await invite(owner.token, id, invitee.email);
    expect(fresh.status).toBe(201);
    const accepted = await h.call('POST', '/api/v1/invitations/accept', {
      token: invitee.token,
      body: { token: tokenFromUrl(fresh.body.data.inviteUrl) },
    });
    expect(accepted.status).toBe(200);
  });

  it('revokes pending invitations and rotates the token on resend', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner);
    const admin = await addMember(h, id, owner, 'ADMIN');
    const invitee = await newUser(h, 'invitee');
    const created = await invite(owner.token, id, invitee.email);
    const invitationId = created.body.data.invitation.id as string;
    const oldToken = tokenFromUrl(created.body.data.inviteUrl);

    const resent = await h.call(
      'POST',
      `/api/v1/workspaces/${id}/invitations/${invitationId}/resend`,
      { token: owner.token },
    );
    expect(resent.status).toBe(200);
    const newToken = tokenFromUrl(resent.body.data.inviteUrl);
    expect(newToken).not.toBe(oldToken);
    expect(
      (await h.call('POST', '/api/v1/invitations/preview', { body: { token: oldToken } })).status,
    ).toBe(400);
    expect(
      (await h.call('POST', '/api/v1/invitations/preview', { body: { token: newToken } })).status,
    ).toBe(200);

    const stranger = await newUser(h, 'stranger');
    expect(
      (
        await h.call('DELETE', `/api/v1/workspaces/${id}/invitations/${invitationId}`, {
          token: stranger.token,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await h.call('DELETE', `/api/v1/workspaces/${id}/invitations/${invitationId}`, {
          token: admin.token,
        })
      ).status,
    ).toBe(200);
    const again = await h.call('DELETE', `/api/v1/workspaces/${id}/invitations/${invitationId}`, {
      token: owner.token,
    });
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('CONFLICT');
    expect(
      (await h.call('POST', '/api/v1/invitations/preview', { body: { token: newToken } })).status,
    ).toBe(400);
    expect(
      (
        await h.call('POST', `/api/v1/workspaces/${id}/invitations/${invitationId}/resend`, {
          token: owner.token,
        })
      ).status,
    ).toBe(409);
  });

  it('keeps invitation management and the accept endpoint authenticated', async () => {
    const owner = await newUser(h, 'owner');
    const id = await newWorkspace(h, owner);
    expect(
      (
        await h.call('POST', `/api/v1/workspaces/${id}/invitations`, {
          body: { email: 'a@x.example', role: 'VIEWER' },
        })
      ).status,
    ).toBe(401);
    expect((await h.call('GET', `/api/v1/workspaces/${id}/invitations`)).status).toBe(401);
    expect(
      (await h.call('POST', '/api/v1/invitations/accept', { body: { token: 'A'.repeat(43) } }))
        .status,
    ).toBe(401);
  });
});
