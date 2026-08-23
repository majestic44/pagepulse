# Security Model

## Trust boundaries

Untrusted inputs include target URLs, fetched pages, redirects, JSON/RSS content, visual selectors, webhook destinations, custom headers, API input, queue jobs and imported session state. Page content never supplies instructions to the application or browser worker.

## Account security

- Native Node.js Argon2id password hashes with configurable memory, passes and parallelism. Passwords require at
  least 12 characters; hash parameters are bounded by startup validation and encoded with each hash for future rehash.
- Email verification and short-lived, single-use password reset tokens use 256 bits of entropy and are stored only as
  SHA-256 digests. Issuing a replacement revokes the prior unused token of that type.
- Optional RFC 6238 TOTP uses six digits, SHA-1 and 30-second steps. The validator accepts the current or immediately
  previous step, records a successful step to prevent reuse, and rate-limits all factor proofs separately from password
  sign-in. A verified password creates only a five-minute, HTTP-only challenge cookie until the factor succeeds.
- TOTP secrets are AES-256-GCM encrypted with a key derived from `TOTP_ENCRYPTION_KEK`, a fresh 96-bit nonce, and
  authenticated user/version context. Recovery codes have 60 bits of randomness, are returned only at enrollment or
  explicit replacement, and are stored only as user-bound HMAC-SHA-256 digests. Enabling, disabling, or replacing
  recovery codes revokes every other browser session.
- Server-side sessions use 256-bit opaque cookies stored only as SHA-256 digests in MariaDB. Cookies are host-only,
  HTTP-only and `SameSite=Strict`; production cookies are also `Secure`. Successful login replaces the prior browser
  session, password reset revokes all sessions, and members can revoke individual or all other active sessions.
  Sessions expire after eight idle hours and always within 30 days by default; both bounds are validated configuration.
- Rate limits for sign-in, reset, invitation, TOTP and PAT operations.
- Login, redemption/verification and reset rate-limit keys contain only a SHA-256 hash of the requester IP. Redis
  rate-limit errors fail closed with a generic temporary-unavailable response; plaintext IP addresses are not stored
  in the key or logged.
- Owner bootstrap is a CLI-generated, expiring one-time URL. The CLI creates the pending owner and its
  256-bit setup token atomically while holding a MariaDB advisory lock. Only a SHA-256 digest is stored;
  it prints the plaintext URL once to the invoking operator rather than to structured logs. The CLI refuses
  once an active owner exists; before redemption, an operator can rotate a pending owner's unused token only
  by supplying the same email. The token is valid for 30 minutes by default (5 minutes to 24 hours configured
  through `OWNER_SETUP_TOKEN_TTL_MINUTES`) and Phase 2 invitation redemption will consume it once.

Email and reset delivery are deferred until the notification platform work. Until then the API never returns,
logs, queues or stores a recoverable verification/reset token, and deployments must not present the resulting
verification or reset flow as deliverable to end users.

## Credential encryption

- Generate a random data-encryption key per credential/session record.
- Encrypt payloads with AES-256-GCM using unique nonces and authenticated context binding owner/record/version.
- Wrap each data key with a versioned key-encryption key from Infisical.
- Rotate by rewrapping data keys; maintain a controlled dual-key transition window.
- Queue messages contain record IDs only. API responses never reveal stored secret values.
- Destroy data keys early during permanent account deletion.

## PAT API

- Display plaintext once; store a searchable prefix and an Argon2id/SHA-256 hardened token verifier.
- Explicit scopes, expiry, rate limits, revocation, last-used time/IP audit.
- Idempotency keys required for create/update/delete/check/retry operations.
- OpenAPI documents authorization and error envelopes but never sample real secrets.

## Webhooks

- Resolve and validate every delivery and redirect against private/reserved networks.
- HTTPS required in production unless an owner explicitly enables a development-only exception.
- Timestamped HMAC signature over canonical payload; replay window documented.
- Encrypted optional headers; never returned after creation.
- Bounded retries with exponential backoff/jitter, response-size limit and delivery audit.

## Browser threats

Chromium runs without host filesystem or Docker socket access, under a non-root user, with blocked downloads/permissions and a disposable context. Network restrictions must account for required CDN assets without allowing private networks or unrelated navigation. A page cannot trigger arbitrary external requests through PagePulse.

## Logging and diagnostics

Allowed: correlation/request/job/monitor/member IDs, timing, result class, service/version, target domain. Forbidden: full URLs/query strings, email/name, credentials, cookies, authorization/custom headers, request bodies, fetched content, webhook payload secrets, TOTP, PATs and encryption material.

The shared logger recursively redacts sensitive field names before serializing JSON. New log fields must use a
domain, identifier or result class rather than a full URL, personal data or secret value.

Public health endpoints expose only service/version/uptime and an aggregate readiness result. Detailed dependency
status is available only when the temporary `OWNER_DIAGNOSTICS_TOKEN` Bearer guard is configured; it returns status
labels and never connection errors, addresses, configuration values or queue payloads. Replace that bootstrap guard
with owner-session authorization in Phase 2.

## Security gates

Dependency review and vulnerability scanning block release according to documented severity policy. Container images run as non-root, pin base-image digests during release hardening, publish SBOM/provenance, and are scanned before GHCR publication.
