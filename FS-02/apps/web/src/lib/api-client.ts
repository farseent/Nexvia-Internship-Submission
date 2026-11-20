import type {
  CollabTokenResponse,
  AssetDto,
  AssetUploadTarget,
  AssignableRole,
  ChangePasswordRequest,
  CreateAssetUploadRequest,
  CreateInvitationRequest,
  CreatePageRequest,
  ErrorCode,
  ErrorDetail,
  InvitationDto,
  LoginRequest,
  MemberDto,
  MovePageRequest,
  PageAccessRole,
  PageDto,
  PagePermissionDto,
  RegisterRequest,
  SessionInfoDto,
  UpdateProfileRequest,
  UserDto,
  UserSummaryDto,
  WorkspaceDto,
} from '@conote/shared';

/** Error raised for every failed API call, whatever the cause. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'UNKNOWN';
  readonly details: ErrorDetail[];
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(input: {
    status: number;
    code: ApiError['code'];
    message: string;
    details?: ErrorDetail[];
    requestId?: string;
    retryAfterSeconds?: number;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.status = input.status;
    this.code = input.code;
    this.details = input.details ?? [];
    this.requestId = input.requestId;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Raw bytes instead of JSON; only image upload (ASSET-04) uses it. */
interface RawUpload {
  file: Blob;
  contentType: string;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  upload?: RawUpload,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': upload?.contentType ?? 'application/json',
      },
      // The API requires a JSON content type on every state-changing request (D25); the one
      // exception is the image upload, which declares the image's own type.
      ...(method === 'GET' ? {} : { body: upload?.file ?? JSON.stringify(body ?? {}) }),
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (isRecord(json) && json['success'] === true) return json['data'] as T;

  const retryAfter = Number(response.headers.get('retry-after'));
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
  if (isRecord(json) && json['success'] === false && isRecord(json['error'])) {
    const error = json['error'];
    throw new ApiError({
      status: response.status,
      code: typeof error['code'] === 'string' ? (error['code'] as ErrorCode) : 'UNKNOWN',
      message: typeof error['message'] === 'string' ? error['message'] : 'Request failed.',
      details: Array.isArray(error['details']) ? (error['details'] as ErrorDetail[]) : [],
      ...(typeof error['requestId'] === 'string' ? { requestId: error['requestId'] } : {}),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }
  throw new ApiError({
    status: response.status,
    code: 'UNKNOWN',
    message: 'The server returned an unexpected response.',
  });
}

export const api = {
  register: (input: RegisterRequest) =>
    request<{ user: UserDto }>('POST', '/api/v1/auth/register', input),
  login: (input: LoginRequest) => request<{ user: UserDto }>('POST', '/api/v1/auth/login', input),
  logout: () => request<null>('POST', '/api/v1/auth/logout'),
  updateProfile: (input: UpdateProfileRequest) =>
    request<{ user: UserDto }>('PATCH', '/api/v1/users/me', input),
  changePassword: (input: ChangePasswordRequest) =>
    request<null>('POST', '/api/v1/auth/password', input),
  listSessions: () => request<{ sessions: SessionInfoDto[] }>('GET', '/api/v1/auth/sessions'),
  revokeSession: (sessionId: string) =>
    request<null>('DELETE', `/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`),

  // ───────────── Workspaces and members ─────────────
  listWorkspaces: () => request<{ workspaces: WorkspaceDto[] }>('GET', '/api/v1/workspaces'),
  createWorkspace: (input: { name: string }) =>
    request<{ workspace: WorkspaceDto }>('POST', '/api/v1/workspaces', input),
  getWorkspace: (id: string) =>
    request<{ workspace: WorkspaceDto }>('GET', `/api/v1/workspaces/${enc(id)}`),
  renameWorkspace: (id: string, input: { name: string }) =>
    request<{ workspace: WorkspaceDto }>('PATCH', `/api/v1/workspaces/${enc(id)}`, input),
  deleteWorkspace: (id: string, input: { confirmName: string }) =>
    request<null>('DELETE', `/api/v1/workspaces/${enc(id)}`, input),
  listMembers: (id: string) =>
    request<{ members: MemberDto[] }>('GET', `/api/v1/workspaces/${enc(id)}/members`),
  changeMemberRole: (id: string, userId: string, role: AssignableRole) =>
    request<{ member: MemberDto }>(
      'PATCH',
      `/api/v1/workspaces/${enc(id)}/members/${enc(userId)}`,
      { role },
    ),
  removeMember: (id: string, userId: string) =>
    request<null>('DELETE', `/api/v1/workspaces/${enc(id)}/members/${enc(userId)}`),
  transferOwnership: (id: string, input: { userId: string; password: string }) =>
    request<{ workspace: WorkspaceDto }>(
      'POST',
      `/api/v1/workspaces/${enc(id)}/transfer-ownership`,
      input,
    ),

  // ───────────── Invitations ─────────────
  // Lists are requested with the largest page (100); paging controls arrive with larger workspaces.
  listInvitations: (id: string) =>
    request<{ invitations: InvitationDto[] }>(
      'GET',
      `/api/v1/workspaces/${enc(id)}/invitations?limit=100`,
    ),
  createInvitation: (id: string, input: CreateInvitationRequest) =>
    request<{ invitation: InvitationDto; inviteUrl: string }>(
      'POST',
      `/api/v1/workspaces/${enc(id)}/invitations`,
      input,
    ),
  revokeInvitation: (id: string, invitationId: string) =>
    request<null>('DELETE', `/api/v1/workspaces/${enc(id)}/invitations/${enc(invitationId)}`),
  resendInvitation: (id: string, invitationId: string) =>
    request<{ invitation: InvitationDto; inviteUrl: string }>(
      'POST',
      `/api/v1/workspaces/${enc(id)}/invitations/${enc(invitationId)}/resend`,
    ),
  previewInvitation: (token: string) =>
    request<{
      workspaceName: string;
      role: AssignableRole;
      invitedBy: string | null;
      emailHint: string;
    }>('POST', '/api/v1/invitations/preview', { token }),
  acceptInvitation: (token: string) =>
    request<{ workspace: WorkspaceDto }>('POST', '/api/v1/invitations/accept', { token }),
  declineInvitation: (token: string) =>
    request<null>('POST', '/api/v1/invitations/decline', { token }),

  // ───────────── Pages ─────────────
  listPages: (workspaceId: string) =>
    request<{ pages: PageDto[] }>('GET', `/api/v1/workspaces/${enc(workspaceId)}/pages`),
  createPage: (workspaceId: string, input: CreatePageRequest) =>
    request<{ page: PageDto }>('POST', `/api/v1/workspaces/${enc(workspaceId)}/pages`, input),
  getPage: (pageId: string) =>
    request<{ page: PageDto; breadcrumbs: { id: string; title: string }[] }>(
      'GET',
      `/api/v1/pages/${enc(pageId)}`,
    ),
  updatePage: (pageId: string, input: { title?: string; icon?: string | null }) =>
    request<{ page: PageDto }>('PATCH', `/api/v1/pages/${enc(pageId)}`, input),
  movePage: (pageId: string, input: MovePageRequest) =>
    request<{ page: PageDto }>('POST', `/api/v1/pages/${enc(pageId)}/move`, input),
  deletePage: (pageId: string) =>
    request<{ deleteBatchId: string }>('DELETE', `/api/v1/pages/${enc(pageId)}`),
  restorePage: (pageId: string) =>
    request<{ page: PageDto }>('POST', `/api/v1/pages/${enc(pageId)}/restore`),
  purgePage: (pageId: string) => request<null>('POST', `/api/v1/pages/${enc(pageId)}/purge`),
  listTrash: (workspaceId: string) =>
    request<{ pages: PageDto[] }>('GET', `/api/v1/workspaces/${enc(workspaceId)}/trash?limit=100`),

  // ───────────── Live collaboration (PAGE-10) and images (D55) ─────────────
  /** A 60-second token for opening the page's document on the collaboration server. */
  createCollabToken: (pageId: string) =>
    request<CollabTokenResponse>('POST', `/api/v1/pages/${enc(pageId)}/collab-token`, {}),
  authorizeImageUpload: (input: CreateAssetUploadRequest) =>
    request<{ asset: AssetDto; upload: AssetUploadTarget }>(
      'POST',
      '/api/v1/assets/uploads',
      input,
    ),
  uploadImageBytes: (target: AssetUploadTarget, file: Blob) =>
    request<null>(target.method, target.url, undefined, {
      file,
      contentType: target.headers['Content-Type'] ?? file.type,
    }),
  completeImageUpload: (assetId: string) =>
    request<{ asset: AssetDto }>('POST', `/api/v1/assets/${enc(assetId)}/complete`),

  // ───────────── Page permissions ─────────────
  listPagePermissions: (pageId: string) =>
    request<{
      overrides: PagePermissionDto[];
      inherited: { user: UserSummaryDto; role: PageAccessRole; fromPageId: string }[];
    }>('GET', `/api/v1/pages/${enc(pageId)}/permissions`),
  setPagePermission: (pageId: string, userId: string, role: PageAccessRole) =>
    request<{ permission: PagePermissionDto }>(
      'PUT',
      `/api/v1/pages/${enc(pageId)}/permissions/${enc(userId)}`,
      { role },
    ),
  removePagePermission: (pageId: string, userId: string) =>
    request<null>('DELETE', `/api/v1/pages/${enc(pageId)}/permissions/${enc(userId)}`),
};

function enc(value: string): string {
  return encodeURIComponent(value);
}

/** Human-readable text for an API failure, safe to show to the user. */
export function describeApiError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return 'Incorrect email or password.';
    case 'EMAIL_TAKEN':
      return 'An account with this email already exists.';
    case 'RATE_LIMITED': {
      const seconds = error.retryAfterSeconds;
      if (seconds === undefined) return 'Too many attempts. Please wait a moment and try again.';
      const wait = seconds >= 90 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
      return `Too many attempts. Please try again in about ${wait}.`;
    }
    case 'SERVICE_UNAVAILABLE':
      return 'The service is temporarily unavailable. Please try again shortly.';
    case 'NETWORK_ERROR':
      return error.message;
    case 'INVALID_ORIGIN':
    case 'UNSUPPORTED_MEDIA_TYPE':
      return 'The request was rejected. Reload the page and try again.';
    case 'VALIDATION_ERROR':
      return 'Please check the highlighted fields.';
    case 'FORBIDDEN':
      return 'You do not have permission to do this.';
    case 'NOT_FOUND':
      return 'This item no longer exists, or you no longer have access to it.';
    case 'ALREADY_MEMBER':
      return 'This person is already a member of the workspace.';
    case 'INVITATION_EXISTS':
      return 'A pending invitation for this email already exists. Resend or revoke it instead.';
    case 'INVITATION_INVALID':
      return 'This invitation is not valid. It may have expired, been used, or been sent to a different account.';
    case 'INVALID_MOVE':
      return 'That page cannot be placed there (it would exceed the nesting limit or loop).';
    case 'CANNOT_RESTRICT_ADMIN':
      return 'Admins and the owner always have full access and cannot be restricted.';
    case 'OWNER_PROTECTED':
      return 'The workspace owner cannot be removed or demoted. Transfer ownership first.';
    case 'CONFLICT':
      return 'This changed while you were working. Reload and try again.';
    case 'PAYLOAD_TOO_LARGE':
      return 'This is too large to save.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/** Map API field errors (`details`) to `{ field: message }`. */
export function fieldErrorsFromApi(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const result: Record<string, string> = {};
  for (const detail of error.details) {
    if (detail.path !== '' && result[detail.path] === undefined)
      result[detail.path] = detail.message;
  }
  return result;
}
