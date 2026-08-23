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

Readiness and detailed diagnostics are not public through the gateway. Internal readiness is used by Compose/deployment health checks; owner diagnostics are authenticated and redacted.

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
- `POST /api/v1/auth/login` accepts `{ email, password }` and returns `204` only for an active, verified account.
  Session creation is intentionally deferred to Phase 2 item 13.
- `POST /api/v1/auth/password-resets` accepts `{ email }` and always returns
  `202 { "status": "reset_requested" }`, preventing account enumeration.
- `POST /api/v1/auth/password-resets/confirm` accepts `{ token, password }` and returns `204` on success.

Invalid redemption, verification and reset requests receive one generic `400` response. Login receives a generic
`401`. The API rate-limits login, redemption/verification and reset operations by a one-way hash of the requester IP;
when Redis cannot enforce that limit, it returns `503` rather than processing the request.

Outbound email delivery is deliberately deferred to Phase 5. This foundation creates only token hashes and does not
return, log, queue, or persist a recoverable plaintext token. Consequently, a deployment cannot complete email
verification or password-reset delivery until the future delivery adapter issues a fresh token and sends it directly.
