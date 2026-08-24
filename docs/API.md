# REST and OpenAPI Design

Base path: `/api/v1`. The generated OpenAPI document is served to authenticated members and stored as a CI artifact. Browser sessions and PATs use the same authorization service.

## Resource groups

- `/auth`: sign-in/out, verification, reset, TOTP and sessions.
- `/invitations`: owner create/list/revoke and member redeem.
- `/members`: profile, preferences, export and deletion lifecycle.
- `/monitors`: CRUD, pause/resume, baseline, test, check-now and status.
- `/credential-profiles`: metadata CRUD, create/replace secret, guided session state.
- `/changes`: list/detail/mark expected/ignore/delete/export.
- `/alerts`: preferences, endpoints, tests, delivery history and manual retry.
- `/push-subscriptions`: VAPID subscription management.
- `/tokens`: PAT create/list/revoke; plaintext returned only at creation.
- `/owner`: users, limits, global pause, providers, retention and diagnostics.
- `/system`: public version/uptime; authenticated capability and readiness detail.

## Conventions

- JSON with RFC 3339 timestamps and stable string IDs.
- Standard error envelope: `code`, `message`, `requestId`, optional safe `details`.
- Cursor pagination for history; deterministic sort.
- `Idempotency-Key` on external write operations and manual triggers.
- `ETag`/revision preconditions for monitor and settings updates.
- `Retry-After` for rate limits and temporary unavailability.
- OpenAPI schemas originate in `@pagepulse/contracts` and are reused at runtime.

## PAT scopes

- `monitors:read`, `monitors:write`, `monitors:delete`
- `changes:read`, `history:delete`
- `deliveries:read`, `deliveries:retry`
- `checks:trigger`

PATs can access only their member’s resources and can never use owner routes, credential plaintext, session endpoints or provider secrets.

## Public endpoints

- `GET /health/live`
- `GET /system/version` returns version and uptime only.

Readiness and detailed diagnostics are not public through the gateway. Internal readiness is used by Compose/deployment health checks; owner diagnostics require an owner browser session and return only redacted status labels.

Owner bootstrap is deliberately CLI-only at this stage. The CLI creates a pending owner and emits an expiring
setup URL; the redemption endpoint is available with the invitation and password flow in Phase 2 item 12.

## Authentication foundation

The following unauthenticated endpoints are implemented for the invitation-only bootstrap flow. Request bodies are
validated against the `@pagepulse/contracts` schemas, and responses never contain an account, verification, or reset
token.

- `POST /api/v1/auth/owner-setup` accepts `{ token, password }`, consumes the CLI-issued setup token and returns
  `202 { "status": "verification_required" }`.
- `POST /api/v1/auth/invitations/redeem` accepts `{ token, password }` and returns the same `202` response.
- `POST /api/v1/auth/email-verifications/confirm` accepts `{ token }` and returns `204` when it activates the account.
- `POST /api/v1/auth/login` accepts `{ email, password }`. It returns `204` only when the account has no TOTP factor;
  otherwise it returns `202 { "status": "totp_required" }` and sets a five-minute, host-only, HTTP-only,
  `SameSite=Strict` challenge cookie (also `Secure` in production). Neither path exposes an opaque token.
- `POST /api/v1/auth/totp/login` accepts exactly one of `{ code }` or `{ recoveryCode }`, consumes the challenge and
  returns `204` only after the second factor succeeds. It then clears the challenge cookie and sets the normal session
  cookie. TOTP proof attempts use their own Redis-backed, IP-hashed rate limit.
- `POST /api/v1/auth/logout` clears the browser cookie and revokes its server-side session when present.
- `GET /api/v1/account/sessions` returns only the active sessions belonging to the signed-in account, with derived
  device labels and timestamps but never a session token.
- `DELETE /api/v1/account/sessions/{sessionId}` revokes one of the signed-in account's sessions. Revoking the current
  session also clears its cookie.
- `POST /api/v1/account/sessions/revoke-others` revokes every active session except the current browser session.
- `GET /api/v1/account/totp` returns only whether the signed-in account has an authenticator app enabled.
- `POST /api/v1/account/totp/enrollments` creates a 10-minute, encrypted enrollment and returns a one-time
  provisioning URI plus its manual entry key. The browser must not persist either value.
- `POST /api/v1/account/totp/enrollments/confirm` accepts `{ code }`, verifies the pending enrollment, enables the
  factor, revokes all other sessions, and returns a newly generated recovery-code set exactly once.
- `POST /api/v1/account/totp/recovery-codes` accepts `{ code }` or `{ recoveryCode }`, replaces every recovery code,
  revokes all other sessions, and returns the replacement set exactly once.
- `DELETE /api/v1/account/totp` accepts `{ code }` or `{ recoveryCode }` and disables the factor after proof, revoking
  all other sessions.
- `POST /api/v1/account/deletion` accepts the current `{ password }` plus exactly one TOTP proof when the account has
  an authenticator app. It is limited to active member accounts, immediately revokes every session, schedules permanent
  deletion seven days later, and returns a one-time recovery token with the deadline. The browser must display the token
  once and never persist it.
- `POST /api/v1/account/deletion/recover` accepts `{ token }` without a session, consumes an unexpired one-time
  recovery token, restores the member account to active, and requires a new sign-in. Invalid, expired, or consumed
  tokens receive the same `401` response.
- `GET /api/v1/owner/members` is owner-only and returns redeemed member administration details. It never returns
  session, token, TOTP, or credential material.
- `POST /api/v1/owner/members/{memberId}/suspend` is owner-only, transitions an active member to suspended, and
  revokes every current browser session for that member.
- `POST /api/v1/owner/members/{memberId}/reactivate` is owner-only and restores a suspended member to active.
- `DELETE /api/v1/owner/members/{memberId}` is owner-only and permanently removes a member. The operation is
  transactional, revokes current sessions first, and relies on foreign-key deletion for member-owned account records.
- `GET /api/v1/system/diagnostics` now requires an owner browser session rather than the retired bootstrap bearer
  token. Signed-out callers receive `401`; signed-in members receive `403`.
- `POST /api/v1/auth/password-resets` accepts `{ email }` and always returns
  `202 { "status": "reset_requested" }`, preventing account enumeration.
- `POST /api/v1/auth/password-resets/confirm` accepts `{ token, password }` and returns `204` on success.

Invalid redemption, verification and reset requests receive one generic `400` response. Login and invalid deletion
confirmation receive generic `401` responses. The API rate-limits login, redemption/verification, reset, and deletion
operations by a one-way hash of the requester IP; when Redis cannot enforce that limit, it returns `503` rather than
processing the request.

Sessions are authoritative in MariaDB, expire after eight idle hours and always within 30 days by default, and are
rotated on successful login. Completing a password reset revokes all active sessions for that account.

TOTP uses RFC 6238 with six digits, SHA-1 and 30-second time steps. The validator accepts the current or immediately
previous time step only and records successful time steps to prevent a code from being accepted twice. Enrollment and
stored factors require `TOTP_ENCRYPTION_KEK`; absence of that secret fails TOTP operations closed with a generic 503.

Member management is enforced at the API boundary, not only in the owner UI. Owners cannot use member lifecycle
routes against owner accounts, and member sessions are invalidated by both suspension and removal. Security/admin
audit events for those actions are the next Phase 2 item.

Outbound email delivery is deliberately deferred to Phase 5. Verification and password-reset flows store only token
hashes and do not return a recoverable plaintext token. Account deletion is the narrowly scoped exception: its recovery
token is displayed once to the already authenticated account holder, never logged or queued, and is stored only as a
hash. A deployment cannot complete email verification or password-reset delivery until a future delivery adapter issues
+a fresh token and sends it directly.
