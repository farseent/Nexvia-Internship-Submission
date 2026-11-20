# CoNote – REST API Contracts

**Status:** Implemented: operational endpoints `GET /health` and `GET /ready` (Phase 1) and **`AUTH-01`–`AUTH-07` and `USER-01`–`USER-02` (Phase 2; see §3.1 and §4.1 for confirmed behaviour and differences from the design)**. Phase 2 decisions D41–D47 were accepted by the owner on 2026-11-13. **Phase 3 (implemented 2026-11-14; owner-verified locally 2026-11-15; decisions D48–D53 accepted by the owner on 2026-11-15): `WS-01`–`WS-09`, `INV-01`–`INV-07` (INV-07 is new), `PAGE-01`–`PAGE-09`, `PP-01`–`PP-03`, `ACT-01`–`ACT-02`; see §15 for the implemented behaviour and differences from the design.** **Phase 6 (2026-11-17): `PAGE-10` is implemented (§7, notes below); `CONTENT-01`/`CONTENT-02` are removed (D59, accepted 2026-11-18); `PAGE-10` was exercised through the web editor in the owner's local verification on 2026-11-18 (HANDOVER §11.11).** Comments and versions remain design-only.
**Last updated:** 2026-11-16

Decision IDs (`D#`, `U#`) are in [DECISIONS.md](DECISIONS.md). Models are in [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md). Collaboration traffic (Yjs sync, awareness, application events, version create/restore) is **not** REST; see [WEBSOCKET_PROTOCOL.md](WEBSOCKET_PROTOCOL.md).

Endpoint IDs (e.g. `AUTH-02`) are permanent and used by TESTING.md and IMPLEMENTATION_PLAN.md.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1` (D31). Browsers call it on the web origin, which proxies to the API (D6). The API is not publicly reachable. |
| Format | JSON (`Content-Type: application/json`), UTF-8. Exception: `VER-03` returns binary. |
| Identifiers | UUIDs (D29). |
| Timestamps | ISO 8601 UTC strings. |
| Authentication | Session cookie (D5). "Auth: Session" below means a valid, unexpired, unrevoked session; otherwise `401 UNAUTHENTICATED`. |
| CSRF | For `POST`, `PUT`, `PATCH`, `DELETE`: `Content-Type: application/json` required (else `415`) and `Origin` must be on the allow-list (else `403 INVALID_ORIGIN`). |
| Validation | Zod schemas from `packages/shared`; unknown fields are rejected; failures return `400 VALIDATION_ERROR`. |
| Rate limiting | Redis-backed. **Every rate-limited endpoint fails closed with `503 SERVICE_UNAVAILABLE` when Redis is unavailable; there is no per-process fallback (D45).** Stricter on `AUTH-01`, `AUTH-02`, `AUTH-07`, `INV-05`, `INV-06`, `PAGE-10`, `ASSET-01`. Exceeding returns `429 RATE_LIMITED` with the standard retry headers emitted by the rate-limit plugin. Implemented Phase 2 limits and initial values are recorded in §3.1; they are untuned starting points. |
| Existence hiding | If the actor has no access at all to a workspace/page/thread, the API returns `404 NOT_FOUND`, not `403`. `403 FORBIDDEN` is used when the actor can see the resource but lacks the required role. |
| Pagination | Cursor-based: `?limit=<1..100>&cursor=<opaque>`; default limit 50. Response `meta: { "nextCursor": string | null }`. |
| No-content results | Operations with no payload return `200` with `data: null`. |

### Role notation

Workspace roles are ordered `VIEWER < COMMENTER < EDITOR < ADMIN < OWNER`. **`WS≥X`** means the actor's workspace role is at least `X`. The **effective page role** (D23) is ordered `NONE < VIEWER < COMMENTER < EDITOR < ADMIN < OWNER`; **`PAGE≥X`** means the actor's effective role on that page is at least `X`. `NONE` or no workspace membership means no access.

### Response envelope (D31)

Success:

```json
{ "success": true, "data": { }, "meta": { } }
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable summary",
    "details": [ { "path": "email", "message": "Invalid email" } ],
    "requestId": "uuid"
  }
}
```

`details` is optional. `requestId` is also returned in the `X-Request-Id` response header and written to logs.

### Error codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body, query or path failed validation |
| 400 | `INVITATION_INVALID` | Token unknown, expired, revoked, used, or email mismatch (deliberately indistinguishable) |
| 401 | `UNAUTHENTICATED` | Missing/invalid/expired session |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password (uniform message) |
| 403 | `FORBIDDEN` | Insufficient role |
| 403 | `INVALID_ORIGIN` | Origin not allowed on a state-changing request |
| 404 | `NOT_FOUND` | Resource missing or hidden |
| 409 | `CONFLICT` | Generic state conflict |
| 409 | `EMAIL_TAKEN` | Email already registered |
| 409 | `ALREADY_MEMBER` | Invitee is already a workspace member |
| 409 | `INVITATION_EXISTS` | A pending invitation for that email exists |
| 409 | `INVALID_MOVE` | Move would create a cycle, cross workspaces, or exceed the depth limit |
| 409 | `CANNOT_RESTRICT_ADMIN` | Page override targets an Admin/Owner |
| 409 | `OWNER_PROTECTED` | Operation would remove or demote the Owner |
| 413 | `PAYLOAD_TOO_LARGE` | Body or declared upload size over the limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Wrong content type |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected error (no internal details leaked) |
| 503 | `SERVICE_UNAVAILABLE` | A dependency (database, Redis, storage) is unavailable |

## 2. Resource shapes

```text
UserSummary   { id, displayName, presenceColor, avatarUrl | null }
User          { id, email, displayName, presenceColor, avatarUrl | null, createdAt }
SessionInfo   { id, createdAt, lastSeenAt, expiresAt, userAgent | null, current: boolean }
Workspace     { id, name, myRole, createdAt, updatedAt }
Member        { user: UserSummary, email?: string /* only for ADMIN+ viewers */, role, joinedAt }
Invitation    { id, email, role, status: "PENDING"|"ACCEPTED"|"REVOKED"|"EXPIRED", expiresAt, createdAt, invitedBy: UserSummary | null }
Page          { id, workspaceId, parentId | null, title, icon | null, position, myRole, createdAt, updatedAt, deletedAt | null }
PagePermission{ user: UserSummary, role: "NONE"|"VIEWER"|"COMMENTER"|"EDITOR", createdAt }
Asset         { id, status: "PENDING"|"READY", contentType, sizeBytes, url /* "/api/v1/assets/{id}" */ }
Thread        { id, pageId, quotedText, anchor: { start: base64, end: base64 }, anchorStatus: "ACTIVE"|"DETACHED",
                resolved: boolean, resolvedAt | null, resolvedBy: UserSummary | null, createdBy: UserSummary | null,
                createdAt, comments: Comment[] }
Comment       { id, threadId, author: UserSummary | null, body, createdAt, deleted: boolean /* body is "" when true */ }
VersionMeta   { id, pageId, kind: "AUTO"|"MANUAL"|"PRE_RESTORE", label | null, sizeBytes, createdBy: UserSummary | null,
                contributors: UserSummary[], createdAt }
Activity      { id, workspaceId, pageId | null, actor: UserSummary | null, action, metadata | null, createdAt }
```

`myRole` is `WorkspaceRole` for `Workspace` and the effective page role for `Page`. `avatarUrl` and image URLs use the stable form `/api/v1/assets/{assetId}` (see `ASSET-03`).

## 3. Authentication (`AUTH`)

### AUTH-01 `POST /api/v1/auth/register`
- **Auth:** none. **Authz:** none. **Rate limited (strict).**
- **Request:** `{ "email": string, "password": string, "displayName": string }`
- **Validation:** email valid, ≤ 254 chars, normalized to lowercase; password 12–128 chars (initial policy); displayName 1–80 trimmed.
- **Response `201`:** `{ "user": User }` and `Set-Cookie` (session). The user is logged in.
- **Errors:** `400 VALIDATION_ERROR`, `409 EMAIL_TAKEN`, `429`. Note: `EMAIL_TAKEN` reveals that an email is registered; this is accepted for the MVP and mitigated by rate limiting.

### AUTH-02 `POST /api/v1/auth/login`
- **Auth:** none. **Rate limited (strict).**
- **Request:** `{ "email": string, "password": string }`
- **Response `200`:** `{ "user": User }` and `Set-Cookie`. Creates a new session; updates `lastLoginAt`.
- **Errors:** `400`, `401 INVALID_CREDENTIALS` (identical for unknown email and wrong password; comparable work is performed in both cases), `429`.

### AUTH-03 `POST /api/v1/auth/logout`
- **Auth:** Session. **Request:** none (`{}`).
- **Response `200`:** `data: null`; revokes the current session and clears the cookie.
- **Side effect:** publishes a `session.revoked` access event (D22).

### AUTH-04 `GET /api/v1/auth/session`
- **Auth:** Session.
- **Response `200`:** `{ "user": User, "session": SessionInfo }`.
- **Errors:** `401`.

### AUTH-05 `GET /api/v1/auth/sessions`
- **Auth:** Session. **Response `200`:** `{ "sessions": SessionInfo[] }` (own, non-revoked, non-expired). `current` is `true` only for the session represented by the request's valid session cookie; all other returned sessions have `current: false`.

### AUTH-06 `DELETE /api/v1/auth/sessions/:sessionId`
- **Auth:** Session. **Authz:** the session must belong to the actor.
- **Response `200`:** `data: null`. Publishes `session.revoked`.
- **Errors:** `404 NOT_FOUND` (also when it belongs to someone else).

### AUTH-07 `POST /api/v1/auth/password`
- **Auth:** Session. **Rate limited (strict).**
- **Request:** `{ "currentPassword": string, "newPassword": string }` (new: 12–128 chars).
- **Response `200`:** `data: null`. Updates the hash and `passwordChangedAt`, **revokes all other sessions**, publishes `session.revoked` for each.
- **Errors:** `400`, `401 INVALID_CREDENTIALS` (wrong current password), `429`.

### 3.1 Phase 2 implementation notes (confirmed behaviour)

| Topic | Behaviour |
|---|---|
| Cookie | Name `conote_session` (non-production) or `__Host-conote_session` (`NODE_ENV=production`); `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`, `Secure` in production, `Max-Age` = absolute lifetime (30 days). The name is derived from `NODE_ENV`, not configurable. Cleared with identical attributes on logout, on revoking the current session, and when a stale cookie is presented. |
| Session lifetime | Idle (sliding) 7 days and absolute 30 days (`SESSION_IDLE_TTL_DAYS`, `SESSION_ABSOLUTE_TTL_DAYS`). `lastSeenAt` and the sliding expiry are written at most once per minute per session. `SessionInfo.expiresAt` is the earlier of the idle and absolute expiry. |
| Check order | Origin/Content-Type (`403`/`415`) → rate limit (`429`/`503`) → request body parsing → **authentication (`401`)** → validation (`400`) → handler. An unauthenticated caller therefore always sees `401`, never `400`. A malformed JSON body is still `400` before authentication. |
| JSON body | Every `POST`/`PUT`/`PATCH`/`DELETE` must send `Content-Type: application/json` **and a JSON body**; send `{}` when there is nothing to send (logout, session revocation). An empty body with that content type is `400`. |
| Request limits | Bodies larger than 64 KiB are rejected with `413 PAYLOAD_TOO_LARGE`. |
| Validation errors | `400 VALIDATION_ERROR` with `details: [{ path, message }]` (`path` is the field, e.g. `email`; messages never echo submitted values). |
| Registration | The email is trimmed and lower-cased. A taken email returns `409 EMAIL_TAKEN`; two simultaneous registrations of one email produce exactly one `201`. A new presence colour is picked at random from a fixed palette. |
| Login | A new session token is issued on every login (an existing cookie is never reused). Unknown email and wrong password return the identical `401 INVALID_CREDENTIALS`; an Argon2id verification is performed in both cases. |
| Logout / revocation | The session row is marked revoked (never reused); a `session.revoked` event `{v:1,type,userId,sessionId,at}` is published to Redis channel `conote:events:access` on a best-effort basis (a Redis outage does not fail the request). |
| Password change | Wrong current password: `401 INVALID_CREDENTIALS` (the web client treats only `UNAUTHENTICATED` as "signed out"). The current session stays valid; every other live session is revoked in the same transaction. |
| Caching | Every `/api/*` response carries `Cache-Control: no-store`. |
| Rate limits | Initial values, per window: `AUTH-01` 10 / hour per client IP; `AUTH-02` 20 / 15 min per client IP **and** 10 / 15 min per email address (all attempts count, so the limit also blocks the correct password once exceeded); `AUTH-07` 5 / 15 min per client IP **and** per user; all other authenticated endpoints 300 / minute per client IP. `429` carries `Retry-After` and `X-RateLimit-*` headers. These are untuned starting values (ARCHITECTURE §10.4). |
| Fail closed | If Redis is unreachable every rate-limited endpoint (all of the above) answers `503 SERVICE_UNAVAILABLE`; if PostgreSQL is unreachable the affected endpoint answers `503`. No dependency detail is exposed. |
| Client IP / trusted proxies | `TRUST_PROXY` is a comma-separated list of trusted IP addresses, CIDR ranges or `loopback`, `linklocal`, `uniquelocal`; empty means trust none. Forwarded headers are trusted only when the immediate peer is in that list. A boolean or hop count is not supported. Production must put a reverse proxy in front of the web tier that sets `X-Forwarded-For`, prevent direct access to the web tier, and list the web tier's address in the API's `TRUST_PROXY`; see ARCHITECTURE §10.3. |

## 4. Users (`USER`)

### USER-01 `GET /api/v1/users/me`
- **Auth:** Session. **Response `200`:** `{ "user": User }`.

### USER-02 `PATCH /api/v1/users/me`
- **Auth:** Session.
- **Request (all optional, at least one):** `{ "displayName"?: string, "presenceColor"?: "#RRGGBB", "avatarAssetId"?: uuid | null }`
- **Validation:** as in DATABASE_SCHEMA §10; `avatarAssetId` must be a `READY` `AVATAR` asset uploaded by the actor.
- **Response `200`:** `{ "user": User }`. **Errors:** `400`, `404` (asset).

### 4.1 Phase 2 implementation notes

`avatarAssetId` is **not implemented** (the `Asset` model arrives in Phase 4): it is rejected as an unknown field with `400 VALIDATION_ERROR`, and `User.avatarUrl` is always `null`. Only `displayName` and `presenceColor` can be updated; `presenceColor` is normalized to upper case. `email`, `id` and every other field are rejected with `400`. The request must contain at least one field.

## 5. Workspaces (`WS`)

### WS-01 `POST /api/v1/workspaces`
- **Auth:** Session. **Request:** `{ "name": string }` (1–100).
- **Response `201`:** `{ "workspace": Workspace }` with `myRole: "OWNER"`. The creator becomes `OWNER`. Logs `workspace.created`.

### WS-02 `GET /api/v1/workspaces`
- **Auth:** Session. **Response `200`:** `{ "workspaces": Workspace[] }` (workspaces the actor belongs to).

### WS-03 `GET /api/v1/workspaces/:workspaceId`
- **Auth:** Session. **Authz:** `WS≥VIEWER`. **Response `200`:** `{ "workspace": Workspace }`. **Errors:** `404`.

### WS-04 `PATCH /api/v1/workspaces/:workspaceId`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. **Request:** `{ "name": string }`.
- **Response `200`:** `{ "workspace": Workspace }`. Logs `workspace.updated`. **Errors:** `400`, `403`, `404`.

### WS-05 `DELETE /api/v1/workspaces/:workspaceId`
- **Auth:** Session. **Authz:** `OWNER`. **Request:** `{ "confirmName": string }` (must equal the workspace name).
- **Response `200`:** `data: null`. Cascades (DATABASE_SCHEMA §8); publishes access events so open collaboration connections close.
- **Errors:** `400` (confirmation mismatch), `403`, `404`.

### WS-06 `GET /api/v1/workspaces/:workspaceId/members`
- **Auth:** Session. **Authz:** `WS≥VIEWER`. **Response `200`:** `{ "members": Member[] }` (`email` included only for `WS≥ADMIN`).

### WS-07 `PATCH /api/v1/workspaces/:workspaceId/members/:userId`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. **Request:** `{ "role": "ADMIN"|"EDITOR"|"COMMENTER"|"VIEWER" }`.
- **Rules:** `OWNER` cannot be assigned here (use `WS-09`); the Owner's role cannot be changed (`409 OWNER_PROTECTED`); **only the Owner may grant or revoke `ADMIN`** (an Admin may manage `EDITOR`/`COMMENTER`/`VIEWER` members only; otherwise `403`).
- **Response `200`:** `{ "member": Member }`. Logs `member.role_changed`; publishes `member.role_changed` access event.
- **Errors:** `400`, `403`, `404`, `409`.

### WS-08 `DELETE /api/v1/workspaces/:workspaceId/members/:userId`
- **Auth:** Session. **Authz:** the actor removing **themselves** (leave; allowed for any non-owner), or `WS≥ADMIN` removing another member (Admins may remove only non-Admin members; the Owner may remove Admins).
- **Rules:** the Owner can neither be removed nor leave (`409 OWNER_PROTECTED`; transfer ownership first). The member's page overrides in the workspace are deleted in the same transaction.
- **Response `200`:** `data: null`. Logs `member.removed` or `member.left`; publishes `member.removed` access event.
- **Errors:** `403`, `404`, `409`.

### WS-09 `POST /api/v1/workspaces/:workspaceId/transfer-ownership`
- **Auth:** Session. **Authz:** `OWNER`. **Request:** `{ "userId": uuid, "password": string }` (the actor re-enters their password).
- **Rules:** target must be an existing member. In one transaction the target becomes `OWNER` and the actor becomes `ADMIN`.
- **Response `200`:** `{ "workspace": Workspace }`. Logs `ownership.transferred`; publishes access events.
- **Errors:** `400`, `401 INVALID_CREDENTIALS`, `403`, `404`.

## 6. Invitations (`INV`)

Invitation links have the form `<APP_URL>/invite#token=<token>`; the token is in the **URL fragment** so it is not sent to servers or written to access logs, and the web app posts it in a request body (D30). The raw token is returned **once** (`INV-01`, `INV-04`) and only its hash is stored. Email delivery is optional and provider-dependent (U6); the MVP guarantees link-based invitations.

### INV-01 `POST /api/v1/workspaces/:workspaceId/invitations`
- **Auth:** Session. **Authz:** `WS≥ADMIN`; only the Owner may invite with role `ADMIN`.
- **Request:** `{ "email": string, "role": "ADMIN"|"EDITOR"|"COMMENTER"|"VIEWER" }`
- **Response `201`:** `{ "invitation": Invitation, "inviteUrl": string }`. Expires in 7 days (D30). Logs `member.invited`.
- **Errors:** `400`, `403`, `404`, `409 ALREADY_MEMBER`, `409 INVITATION_EXISTS`.

### INV-02 `GET /api/v1/workspaces/:workspaceId/invitations`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. **Query:** `status?` (`PENDING|ACCEPTED|REVOKED|EXPIRED`), pagination.
- **Response `200`:** `{ "invitations": Invitation[] }` (never includes tokens).

### INV-03 `DELETE /api/v1/workspaces/:workspaceId/invitations/:invitationId`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. Revokes a `PENDING` invitation. Logs `invitation.revoked`.
- **Response `200`:** `data: null`. **Errors:** `404`, `409 CONFLICT` (not pending).

### INV-04 `POST /api/v1/workspaces/:workspaceId/invitations/:invitationId/resend`
- **Auth:** Session. **Authz:** as `INV-01`. Rotates the token (old link stops working), extends expiry, re-sends email if an adapter is configured.
- **Response `200`:** `{ "invitation": Invitation, "inviteUrl": string }`. **Errors:** `404`, `409` (not pending).

### INV-05 `POST /api/v1/invitations/preview`
- **Auth:** none. **Rate limited (strict).** **Request:** `{ "token": string }`.
- **Response `200`:** `{ "workspaceName": string, "role": string, "invitedBy": string | null, "emailHint": "j***@example.com" }`.
- **Errors:** `400 INVITATION_INVALID`, `429`.

### INV-06 `POST /api/v1/invitations/accept`
- **Auth:** Session. **Rate limited (strict).** **Request:** `{ "token": string }`.
- **Rules:** token valid and unexpired; the actor's email equals the invitation email; the invitation becomes `ACCEPTED` and a `WorkspaceMember` is created in one transaction (single use).
- **Response `200`:** `{ "workspace": Workspace }`. Logs `member.joined`.
- **Errors:** `400 INVITATION_INVALID`, `401`, `429`.

### INV-07 `POST /api/v1/invitations/decline` (added in Phase 3, D48)
- **Auth:** Session. **Rate limited (strict).** **Request:** `{ "token": string }`.
- **Rules:** same checks as `INV-06` (pending, unexpired, signed-in email equals the invited email). The invitation becomes `DECLINED`; no membership is created. The address may be invited again.
- **Response `200`:** `data: null`. Logs `member.declined`. **Errors:** `400 INVITATION_INVALID`, `401`, `429`.

## 7. Pages (`PAGE`)

### PAGE-01 `POST /api/v1/workspaces/:workspaceId/pages`
- **Auth:** Session. **Authz:** root page: `WS≥EDITOR`; child page: `PAGE≥EDITOR` on the parent.
- **Request:** `{ "title"?: string (≤200), "icon"?: string (≤32), "parentId"?: uuid | null, "afterPageId"?: uuid | null }` (`afterPageId` places the page after that sibling; omitted = last).
- **Response `201`:** `{ "page": Page }`. Logs `page.created`.
- **Errors:** `400`, `403`, `404`, `409 INVALID_MOVE` (depth limit or parent in another workspace).

### PAGE-02 `GET /api/v1/workspaces/:workspaceId/pages`
- **Auth:** Session. **Authz:** `WS≥VIEWER`.
- **Response `200`:** `{ "pages": Page[] }` — a flat list of non-deleted pages with effective role ≥ `VIEWER`, ordered by `(parentId, position)`; the client builds the tree. Pages whose ancestors are inaccessible appear as roots in the client's view. Unpaginated in the MVP (revisited with Phase 9 measurements).

### PAGE-03 `GET /api/v1/pages/:pageId`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`.
- **Response `200`:** `{ "page": Page, "breadcrumbs": [{ "id", "title" }] }` (only accessible ancestors).
- **Errors:** `404` (missing, deleted, or no access).

### PAGE-04 `PATCH /api/v1/pages/:pageId`
- **Auth:** Session. **Authz:** `PAGE≥EDITOR`. **Request (≥1 field):** `{ "title"?: string, "icon"?: string | null }`.
- **Response `200`:** `{ "page": Page }`. Logs `page.renamed` (title changes). **Errors:** `400`, `403`, `404`.

### PAGE-05 `POST /api/v1/pages/:pageId/move`
- **Auth:** Session. **Authz:** `PAGE≥EDITOR` on the page and on the destination parent (root destination: `WS≥EDITOR`).
- **Request:** `{ "parentId": uuid | null, "afterPageId"?: uuid | null }`.
- **Rules:** same workspace; cannot move under itself or a descendant; depth limit 10. The service takes the workspace-tree transaction advisory lock before reading the tree and holds it through commit; all structural mutations use the same lock. A composite database FK independently rejects cross-workspace parent references. Permission overrides stay on the pages; effective access under the new parent is recomputed (access events published for affected users). Concurrent structural changes serialize; if the resulting move is invalid, return `409 INVALID_MOVE`.
- **Response `200`:** `{ "page": Page }`. Logs `page.moved`. **Errors:** `400`, `403`, `404`, `409 INVALID_MOVE`.

### PAGE-06 `DELETE /api/v1/pages/:pageId`
- **Auth:** Session. **Authz:** `PAGE≥EDITOR`.
- **Behaviour:** soft deletes the page and all descendants with one `deleteBatchId` (D24); open collaboration connections are closed via access events.
- **Response `200`:** `{ "deleteBatchId": uuid }`. Logs `page.deleted`. **Errors:** `403`, `404`.

### PAGE-07 `POST /api/v1/pages/:pageId/restore`
- **Auth:** Session. **Authz:** effective role ≥ `EDITOR` (computed ignoring the deleted flag).
- **Behaviour:** restores the page and the descendants deleted in the same batch. If the original parent is deleted or missing, the page is restored as a workspace root.
- **Response `200`:** `{ "page": Page }`. Logs `page.restored`. **Errors:** `403`, `404`, `409` (not deleted).

### PAGE-08 `GET /api/v1/workspaces/:workspaceId/trash`
- **Auth:** Session. **Authz:** `WS≥EDITOR`. **Query:** pagination.
- **Response `200`:** `{ "pages": Page[] }` — deleted batch roots the actor could edit, with `deletedAt`.

### PAGE-09 `POST /api/v1/pages/:pageId/purge`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. Permanently deletes a page that is already soft-deleted (cascade). Logs `page.purged`.
- **Response `200`:** `data: null`. **Errors:** `403`, `404`, `409` (page not deleted).

### PAGE-10 `POST /api/v1/pages/:pageId/collab-token`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`. **Rate limited (strict).**
- **Request:** `{}`.
- **Response `200`:** `{ "token": string, "expiresAt": string, "collabUrl": string, "documentName": "page:<pageId>", "role": string, "readOnly": boolean }`.
- **Notes:** the token is an EdDSA JWT with a 60-second lifetime (D22). `role` and `readOnly` are advisory for the UI; the collab server decides from the database.
- **Errors:** `404` (also for deleted pages and pages the caller cannot read, so existence is not revealed), `429`, and **`503 SERVICE_UNAVAILABLE` when no signing key is configured** (`COLLAB_JWT_PRIVATE_KEY`; readable-page checks come first, so an unreadable page still answers 404).
- **Implemented 2026-11-17 (Phase 6):** the token has exactly the claims `iss`, `aud`, `sub`, `sid`, `pid`, `jti`, `iat`, `exp` and the header `kid`; **there is no role claim** (D60.1). `collabUrl` is `COLLAB_URL`. Rate limit `collabToken`: 120 per minute per client address (untuned). Like every `POST`, it needs the same-origin `Origin` check (D25). Test evidence: `apps/api/test/collab-token.int.test.ts` (9 tests); also used by the web editor in the owner's browser walkthrough of 2026-11-18 (HANDOVER §11.11).

### 7.1 Interim page-content endpoints (`CONTENT`, Phase 4, D54) — REMOVED in Phase 6 (D59, accepted 2026-11-18)

> **Removed on 2026-11-17.** `CONTENT-01` and `CONTENT-02`, the `contentSave` rate limit and the shared request/response schemas no longer exist; the document is the Yjs document. The `page_contents` table remains as a read-only seed source (D59). The text below is kept as a historical record of the Phase 4 contract.

> Interim: these two endpoints exist only until Phase 6 replaces document persistence with the Yjs document store (D15). Nothing else may depend on them. Not part of the original design; recorded as D54 (accepted 2026-11-16).

#### CONTENT-01 `GET /api/v1/pages/:pageId/content`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER` (`404` when the page does not exist, is in the trash, or the caller has no access).
- **Response `200`:** `{ "content": Document | null, "schemaVersion": 1, "revision": integer, "updatedAt": string | null }`. A page that was never edited returns `content: null`, `revision: 0`, `updatedAt: null`. `Document` is the editor's ProseMirror JSON (D56). Stored content is validated again before it is returned; a stored document that no longer satisfies the format is `500 INTERNAL_ERROR`.
- **Errors:** `400` (malformed id), `401`, `404`.

#### CONTENT-02 `PUT /api/v1/pages/:pageId/content`
- **Auth:** Session. **Authz:** `PAGE≥EDITOR` (`403` for viewers and commenters; `404` when the page is not visible). **Rate limited** (`contentSave`, 240 per minute per client address).
- **Request:** `{ "baseRevision": integer ≥ 0, "content": Document }`. Unknown fields are rejected. The request body limit of this route is 1 MiB + 4 KiB (the API default of 64 KiB applies everywhere else).
- **Validation:** `content` must satisfy `validateEditorDocument` in `packages/shared`: at most 1 MiB serialized, 20 000 nodes and depth 24; only the node types, marks and attributes of schema version 1; content rules per node; link targets `http`, `https`, `mailto`; image sources only of the form `/api/v1/assets/<uuid>`. `400 VALIDATION_ERROR` with `details[].path` such as `content.content.1.attrs.level` (the message never contains document text).
- **Concurrency:** compare-and-set on the revision. `baseRevision: 0` creates the first revision, any other value updates only if the stored revision equals it. Otherwise `409 CONFLICT`. Of two simultaneous saves based on the same revision exactly one succeeds.
- **Response `200`:** `{ "revision": integer, "updatedAt": string }` (revision = `baseRevision + 1`). The page's `updatedAt` is set to the same time.
- **Errors:** `400`, `401`, `403`, `404`, `409`, `413` (body over the limit), `415`, `429`.

## 8. Page permissions (`PP`)

Overrides follow D23. Changes publish `page.access_changed` access events (D22).

### PP-01 `GET /api/v1/pages/:pageId/permissions`
- **Auth:** Session. **Authz:** `WS≥ADMIN`.
- **Response `200`:** `{ "overrides": PagePermission[], "inherited": [{ "user": UserSummary, "role": string, "fromPageId": uuid }] }` (overrides on ancestor pages that currently apply).

### PP-02 `PUT /api/v1/pages/:pageId/permissions/:userId`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. **Request:** `{ "role": "NONE"|"VIEWER"|"COMMENTER"|"EDITOR" }`.
- **Rules:** target must be a workspace member; targets with role `ADMIN`/`OWNER` are rejected (`409 CANNOT_RESTRICT_ADMIN`).
- **Response `200`:** `{ "permission": PagePermission }` (upsert). Logs `page.permission_set`.
- **Errors:** `400`, `403`, `404`, `409`.

### PP-03 `DELETE /api/v1/pages/:pageId/permissions/:userId`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. Removes the override (access falls back to inheritance). Logs `page.permission_removed`.
- **Response `200`:** `data: null`. **Errors:** `403`, `404`.

## 9. Assets (`ASSET`)

Upload flow (U7 partly resolved, D55 accepted 2026-11-16): authorize → send the bytes → confirm → read. Phase 4 implements `PAGE_IMAGE` assets and a local-disk storage adapter; the object-storage (presigned) variant and avatars are not implemented. Allowed types: `image/png`, `image/jpeg`, `image/gif`, `image/webp` (no SVG). Limit: 5 MiB. Documents reference an image only by `/api/v1/assets/<assetId>`.

### ASSET-01 `POST /api/v1/assets/uploads`
- **Auth:** Session. **Rate limited** (`assetUpload`, 120 per 15 minutes per client address).
- **Request:** `{ "purpose": "PAGE_IMAGE", "pageId": uuid, "contentType": string, "sizeBytes": integer ≥ 1 }`. `purpose: "AVATAR"` is not accepted yet (`400`). *Deviation from the design: `filename` was dropped; the server never uses it and nothing stores it.*
- **Authz:** `PAGE≥EDITOR` on the page (`403`; `404` when the page is not visible or in the trash).
- **Validation:** `contentType` must be in the allow-list (`415 UNSUPPORTED_MEDIA_TYPE`); `sizeBytes` ≤ 5 MiB (`413 PAYLOAD_TOO_LARGE`). The storage key `<workspaceId>/<assetId>` is generated server-side.
- **Response `201`:** `{ "asset": Asset /* status PENDING, url */, "upload": { "url": string, "method": "PUT", "headers": { "Content-Type": string }, "expiresAt": string } }`. The authorization is valid for 10 minutes.
- **Errors:** `400`, `401`, `403`, `404`, `413`, `415`, `429`.

### ASSET-04 `PUT /api/v1/assets/:assetId/content` (local-disk adapter only; added in Phase 4)
- **Auth:** Session. **Authz:** the uploader, still `PAGE≥EDITOR` on the page (`404` for anyone else, `403` if the right was lost). Answers `404` when the configured adapter does not receive uploads through the API.
- **Request:** the raw image bytes with the announced `Content-Type`. **This is the one state-changing route that does not take JSON**: the JSON content-type rule (D25) is waived for `PUT /api/v1/assets/<uuid>/content` with the four image types only; the Origin check still applies and every other route still answers `415`. Body limit 5 MiB (`413`).
- **Response `200`:** `{ "success": true, "data": null }`. **Errors:** `401`, `403`, `404`, `409` (already confirmed, or authorization expired), `413`, `415` (type differs from the authorization).

### ASSET-02 `POST /api/v1/assets/:assetId/complete`
- **Auth:** Session. **Authz:** the uploader with `PAGE≥EDITOR` (`404` otherwise). Idempotent for an asset that is already `READY`.
- **Checks:** the object exists, its size equals the announced size, and its leading bytes are the announced image type. A failed check deletes the object and answers `409 CONFLICT`; the asset stays `PENDING`.
- **Response `200`:** `{ "asset": Asset /* READY */ }`. **Errors:** `401`, `403`, `404`, `409`.

### ASSET-03 `GET /api/v1/assets/:assetId`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER` on the asset's page (`404` for everyone else, for assets that are not `READY` and for pages in the trash).
- **Response `200` (local-disk adapter):** the image bytes with the stored `Content-Type`, `Content-Disposition: inline` and `X-Content-Type-Options: nosniff`. (An S3-compatible adapter would answer `302` to a short-lived presigned URL.) Like all `/api/` responses it carries `Cache-Control: no-store`. The stable URL is same-origin, so `<img>` requests carry the session cookie.
- **Errors:** `400`, `401`, `404`.

## 10. Comments (`CMT`)

Creating, replying, resolving and deleting are REST operations (D8, FR-CM-06), so `PAGE≥COMMENTER` is enough and a read-only collaboration connection suffices. After each change the API publishes a `comments.changed` page event (D32).

### CMT-01 `GET /api/v1/pages/:pageId/threads`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`. **Query:** `status?` (`open|resolved|all`, default `open`), pagination.
- **Response `200`:** `{ "threads": Thread[] }`.

### CMT-02 `POST /api/v1/pages/:pageId/threads`
- **Auth:** Session. **Authz:** `PAGE≥COMMENTER`.
- **Request:** `{ "anchor": { "start": base64, "end": base64 }, "quotedText": string (≤500), "body": string (1–5000) }`
- **Validation:** anchors are valid base64 within a size limit; they are stored opaquely (the API does not interpret Yjs positions).
- **Response `201`:** `{ "thread": Thread }` (thread and first comment created in one transaction). Logs `comment.thread_created`.
- **Errors:** `400`, `403`, `404`.

### CMT-03 `POST /api/v1/threads/:threadId/comments`
- **Auth:** Session. **Authz:** `PAGE≥COMMENTER` on the thread's page. **Request:** `{ "body": string (1–5000) }`.
- **Response `201`:** `{ "comment": Comment }`. **Errors:** `400`, `403`, `404`.

### CMT-04 `POST /api/v1/threads/:threadId/resolve`
- **Auth:** Session. **Authz:** `PAGE≥COMMENTER`. Sets resolved; idempotent. Logs `comment.thread_resolved`.
- **Response `200`:** `{ "thread": Thread }`. **Errors:** `403`, `404`.

### CMT-05 `POST /api/v1/threads/:threadId/reopen`
- **Auth:** Session. **Authz:** `PAGE≥COMMENTER`. Clears resolved. Logs `comment.thread_reopened`.
- **Response `200`:** `{ "thread": Thread }`. **Errors:** `403`, `404`.

### CMT-06 `DELETE /api/v1/comments/:commentId`
- **Auth:** Session. **Authz:** the comment's author (with `PAGE≥COMMENTER`) or `WS≥ADMIN`. Soft delete.
- **Response `200`:** `data: null`. **Errors:** `403`, `404`.

## 11. Version history (`VER`)

Listing and reading versions are REST. **Creating a manual snapshot and restoring a version are performed through the collaboration connection** (they must be serialized with live editing by the collab server, D9, D21); see WEBSOCKET_PROTOCOL.md ("Application messages: version.create, version.restore").

### VER-01 `GET /api/v1/pages/:pageId/versions`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`. **Query:** `kind?` (`AUTO|MANUAL|PRE_RESTORE`), pagination.
- **Response `200`:** `{ "versions": VersionMeta[] }` newest first.

### VER-02 `GET /api/v1/pages/:pageId/versions/:versionId`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`. **Response `200`:** `{ "version": VersionMeta }`. **Errors:** `404`.

### VER-03 `GET /api/v1/pages/:pageId/versions/:versionId/state`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`.
- **Response `200`:** binary body (`Content-Type: application/octet-stream`), the full Yjs state of the snapshot. The client loads it into a separate, non-collaborative `Y.Doc` and renders it read-only (FR-VH-04). This is the only non-JSON success response; errors still use the JSON envelope.
- **Errors:** `404`.

## 12. Activity (`ACT`)

### ACT-01 `GET /api/v1/workspaces/:workspaceId/activity`
- **Auth:** Session. **Authz:** `WS≥ADMIN`. **Query:** `pageId?`, `actorId?`, `action?`, pagination.
- **Response `200`:** `{ "activity": Activity[] }` newest first.

### ACT-02 `GET /api/v1/pages/:pageId/activity`
- **Auth:** Session. **Authz:** `PAGE≥VIEWER`. **Query:** `action?`, pagination.
- **Response `200`:** `{ "activity": Activity[] }` for that page.

## 13. Operational endpoints (`OPS`)

Not under `/api/v1`; not proxied through the web app; used by orchestration and monitoring on the internal network.

| ID | Endpoint | Behaviour |
|---|---|---|
| OPS-01 | `GET /health` | Liveness: `200` if the process is running. |
| OPS-02 | `GET /ready` | API readiness: `200` when PostgreSQL is reachable and schema-compatible; schema-compatible means the migration history table exists, has no failed migration, and every migration directory shipped with this build is recorded as applied (D41). Applied migrations unknown to this build are tolerated; rolled-back rows do not count. A missing migrations directory, PostgreSQL failure or incompatible schema returns `503`/unavailable. Redis health is reported separately and Redis outage alone does not make the API unready. Response includes `status`, `service`, `dependencies.postgres`, and `dependencies.redis` (`healthy`/`degraded`/`unavailable`) without secrets. Collab has its own readiness endpoint: PostgreSQL is required; Redis-down is reported as degraded multi-instance capability. |

## 14. Side effects on other systems

| Trigger | Redis event published (D22, D32) |
|---|---|
| Logout, session revoke, password change | `access` channel: `session.revoked` (user id, session id) |
| Member role change / removal / leave / workspace deletion / ownership transfer | `access` channel: `member.role_changed`, `member.removed`, `workspace.deleted` |
| Page permission change, page move, page delete/restore/purge | `access` channel: `page.access_changed` (page id, affected user ids if known) |
| Comment thread or comment created/resolved/reopened/deleted | `page` channel: `comments.changed` (page id) |

Channel names and payloads are specified in WEBSOCKET_PROTOCOL.md. Events are at-most-once; the collab server's periodic revalidation and client refetch on reconnect cover missed events (D22).

## 15. Phase 3 implementation notes (2026-11-14)

Confirmed behaviour of the implemented endpoints, and where it adds to or differs from the design above. Source: `apps/api/src/routes/{workspaces,invitations,pages,page-permissions,activity}.ts`.

- **Registration:** all Phase 3 routes except `INV-05` are inside the authenticated scope; `INV-05` is public and rate limited. New `invitation` rate-limit rule (20 per 15 minutes per client address, D51) applies to `INV-05`, `INV-06` and `INV-07`; ownership transfer (`WS-09`) also uses the per-user `password` limiter. All remain fail-closed (D45).
- **Status codes:** non-members and effective role `NONE` get `404 NOT_FOUND` with the same body as a missing resource; members below the required role get `403 FORBIDDEN`. A plain member deleting someone else's membership gets `403` before the target is looked up.
- **`INVITATION` statuses:** `PENDING | ACCEPTED | DECLINED | REVOKED | EXPIRED`. `EXPIRED` is derived, never stored; `INV-02 ?status=PENDING` returns only unexpired pending invitations and `?status=EXPIRED` only expired ones. `inviteUrl` is `<APP_URL>/invite#token=<token>` and is returned only by `INV-01` and `INV-04`. Revoking or resending an `ADMIN`-role invitation needs the owner.
- **`INV-01`:** `409 ALREADY_MEMBER` when the address belongs to a current member; `409 INVITATION_EXISTS` when an unexpired pending invitation exists; an expired pending one is retired as `REVOKED` and replaced.
- **`WS-05`:** the owner only; the body must carry `confirmName` equal to the workspace name (trimmed), otherwise `400 VALIDATION_ERROR` with `details[0].path = "confirmName"`. Publishes `workspace.deleted` after commit.
- **`WS-06`:** `email` is present only when the caller is `WS≥ADMIN`. Order: role (owner first), then display name.
- **`WS-07`/`WS-08`/`WS-09`:** as designed; role changes by an unchanged role are no-ops (no log, no event). Access events `member.role_changed` / `member.removed` are published after commit (both users for a transfer).
- **`PAGE-01`:** `afterPageId`: omitted = last, `null` = first, an id = directly after that sibling (`409 INVALID_MOVE` if it is not a sibling). A parent in another workspace is `409 INVALID_MOVE` (or `404` if the caller cannot see it).
- **`PAGE-02`:** flat list ordered by `(parentId nulls first, position, id)` using code-unit order (D50); each page carries `myRole`.
- **`PAGE-03`:** returns `breadcrumbs` (root first) containing only ancestors the caller can open.
- **`PAGE-05`:** destination needs `PAGE≥EDITOR` on the new parent (or `WS≥EDITOR` for the root). The response `myRole` is `NONE` when the move put the page out of the caller's reach. Publishes `page.access_changed`.
- **`PAGE-06`/`PAGE-07`:** delete marks the live subtree with one `deleteBatchId`; restore revives the target and its descendants of the same batch, under the original parent when it is alive and the depth limit allows, otherwise as a root; always placed last among siblings (D50).
- **`PAGE-08`:** `WS≥EDITOR`; lists batch roots the caller could restore; cursor keyset `(deletedAt desc, id desc)`.
- **`PAGE-09`:** `WS≥ADMIN`; `409 CONFLICT` unless the page is deleted.
- **`PP-02`:** target must be a member (`404` otherwise); admins and the owner give `409 CANNOT_RESTRICT_ADMIN`. **`PP-03`:** `404` when no override exists.
- **`ACT-01`/`ACT-02`:** keyset pagination `(createdAt desc, id desc)`; invalid cursor is `400 VALIDATION_ERROR`. Metadata holds ids only (no emails, tokens or titles).
- **Not implemented:** email delivery of invitations (D52); page search (no requirement).