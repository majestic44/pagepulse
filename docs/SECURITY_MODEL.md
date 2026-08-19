# Security Model

## Trust boundaries

Untrusted inputs include target URLs, fetched pages, redirects, JSON/RSS content, visual selectors, webhook destinations, custom headers, API input, queue jobs and imported session state. Page content never supplies instructions to the application or browser worker.

## Account security

- Argon2id password hashes with configurable memory/time parameters.
- Email verification and short-lived, single-use password reset tokens stored as hashes.
- Optional RFC 6238 TOTP with encrypted secret and hashed single-use recovery codes.
- Server-side sessions with secure, HTTP-only, SameSite cookies, rotation after authentication changes, idle/absolute expiry, and revocation.
- Rate limits for sign-in, reset, invitation, TOTP and PAT operations.
- Owner bootstrap is a CLI-generated, expiring one-time URL.

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

## Security gates

Dependency review and vulnerability scanning block release according to documented severity policy. Container images run as non-root, pin base-image digests during release hardening, publish SBOM/provenance, and are scanned before GHCR publication.
