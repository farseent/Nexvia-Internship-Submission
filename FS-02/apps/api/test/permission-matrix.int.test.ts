import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workspaceRoleAtLeast, type WorkspaceRole } from '@conote/shared';
import { createHarness, deleteTestUsers, type Harness } from './auth-harness.js';
import { addMember, newPage, newUser, newWorkspace, type TestUser } from './workspace-harness.js';

/**
 * AC-3.2 / AC-3.3: every Phase 3 action, for every role, allowed and denied.
 * A member below the minimum role gets 403; a user outside the workspace gets 404.
 */
let h: Harness;
let ws: string;
let owner: TestUser;
let target: TestUser; // receives page overrides; never acts, so overrides don't hide pages from actors
const actors = {} as Record<WorkspaceRole | 'STRANGER', TestUser>;
let counter = 0;

beforeAll(async () => {
  h = await createHarness();
  owner = await newUser(h, 'owner');
  ws = await newWorkspace(h, owner, 'Matrix');
  actors.OWNER = owner;
  actors.ADMIN = await addMember(h, ws, owner, 'ADMIN');
  actors.EDITOR = await addMember(h, ws, owner, 'EDITOR');
  actors.COMMENTER = await addMember(h, ws, owner, 'COMMENTER');
  actors.VIEWER = await addMember(h, ws, owner, 'VIEWER');
  target = await addMember(h, ws, owner, 'VIEWER');
  actors.STRANGER = await newUser(h, 'stranger');
});

afterAll(async () => {
  await deleteTestUsers(h.deps);
  await h.close();
});

interface Action {
  name: string;
  min: WorkspaceRole;
  success: number;
  /** Runs the action as `user`, creating whatever it needs first as the owner. */
  run(user: TestUser): Promise<{ status: number }>;
}

const freshPage = async () =>
  (await newPage(h, owner, ws, { title: `p${(counter += 1)}` })).id as string;
const freshEmail = () => `matrix-${(counter += 1)}@invitee.example`;
const call = (
  method: Parameters<Harness['call']>[0],
  url: string,
  user: TestUser,
  body?: unknown,
) => h.call(method, url, { token: user.token, ...(body === undefined ? {} : { body }) });

const actions: Action[] = [
  {
    name: 'GET workspace',
    min: 'VIEWER',
    success: 200,
    run: (u) => call('GET', `/api/v1/workspaces/${ws}`, u),
  },
  {
    name: 'GET members',
    min: 'VIEWER',
    success: 200,
    run: (u) => call('GET', `/api/v1/workspaces/${ws}/members`, u),
  },
  {
    name: 'GET pages',
    min: 'VIEWER',
    success: 200,
    run: (u) => call('GET', `/api/v1/workspaces/${ws}/pages`, u),
  },
  {
    name: 'GET page',
    min: 'VIEWER',
    success: 200,
    run: async (u) => call('GET', `/api/v1/pages/${await freshPage()}`, u),
  },
  {
    name: 'GET page activity',
    min: 'VIEWER',
    success: 200,
    run: async (u) => call('GET', `/api/v1/pages/${await freshPage()}/activity`, u),
  },
  {
    name: 'PATCH workspace',
    min: 'ADMIN',
    success: 200,
    run: (u) => call('PATCH', `/api/v1/workspaces/${ws}`, u, { name: 'Matrix' }),
  },
  {
    name: 'GET invitations',
    min: 'ADMIN',
    success: 200,
    run: (u) => call('GET', `/api/v1/workspaces/${ws}/invitations`, u),
  },
  {
    name: 'POST invitation',
    min: 'ADMIN',
    success: 201,
    run: (u) =>
      call('POST', `/api/v1/workspaces/${ws}/invitations`, u, {
        email: freshEmail(),
        role: 'VIEWER',
      }),
  },
  {
    name: 'GET workspace activity',
    min: 'ADMIN',
    success: 200,
    run: (u) => call('GET', `/api/v1/workspaces/${ws}/activity`, u),
  },
  {
    name: 'POST page',
    min: 'EDITOR',
    success: 201,
    run: (u) => call('POST', `/api/v1/workspaces/${ws}/pages`, u, {}),
  },
  {
    name: 'PATCH page',
    min: 'EDITOR',
    success: 200,
    run: async (u) => call('PATCH', `/api/v1/pages/${await freshPage()}`, u, { title: 'x' }),
  },
  {
    name: 'POST move page',
    min: 'EDITOR',
    success: 200,
    run: async (u) =>
      call('POST', `/api/v1/pages/${await freshPage()}/move`, u, { parentId: null }),
  },
  {
    name: 'DELETE page',
    min: 'EDITOR',
    success: 200,
    run: async (u) => call('DELETE', `/api/v1/pages/${await freshPage()}`, u),
  },
  {
    name: 'POST restore page',
    min: 'EDITOR',
    success: 200,
    run: async (u) => {
      const id = await freshPage();
      await call('DELETE', `/api/v1/pages/${id}`, owner);
      return call('POST', `/api/v1/pages/${id}/restore`, u);
    },
  },
  {
    name: 'GET trash',
    min: 'EDITOR',
    success: 200,
    run: (u) => call('GET', `/api/v1/workspaces/${ws}/trash`, u),
  },
  {
    name: 'POST purge page',
    min: 'ADMIN',
    success: 200,
    run: async (u) => {
      const id = await freshPage();
      await call('DELETE', `/api/v1/pages/${id}`, owner);
      return call('POST', `/api/v1/pages/${id}/purge`, u);
    },
  },
  {
    name: 'GET page permissions',
    min: 'ADMIN',
    success: 200,
    run: async (u) => call('GET', `/api/v1/pages/${await freshPage()}/permissions`, u),
  },
  {
    name: 'PUT page permission',
    min: 'ADMIN',
    success: 200,
    run: async (u) =>
      call('PUT', `/api/v1/pages/${await freshPage()}/permissions/${actors.VIEWER.id}`, u, {
        role: 'NONE',
      }),
  },
  {
    name: 'DELETE page permission',
    min: 'ADMIN',
    success: 200,
    run: async (u) => {
      const id = await freshPage();
      await call('PUT', `/api/v1/pages/${id}/permissions/${target.id}`, owner, {
        role: 'NONE',
      });
      return call('DELETE', `/api/v1/pages/${id}/permissions/${target.id}`, u);
    },
  },
];

const ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER'];

describe.each(actions)('$name', (action) => {
  it.each(ROLES)('as %s', async (role) => {
    const res = await action.run(actors[role]);
    const allowed = workspaceRoleAtLeast(role, action.min);
    expect(res.status).toBe(allowed ? action.success : 403);
  });

  it('as a non-member (404, nothing revealed)', async () => {
    const res = await action.run(actors.STRANGER);
    expect(res.status).toBe(404);
  });

  it('without a session (401)', async () => {
    const res = await action.run({ token: '', id: '', email: '', name: '' });
    expect(res.status).toBe(401);
  });
});
