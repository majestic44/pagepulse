# ADR 0007: Optional TOTP Authentication

- Status: Accepted
- Date: 2026-08-23

## Decision

Use RFC 6238 TOTP with SHA-1, six digits and a 30-second time step as an optional second factor. A verified password
for an account with TOTP enabled creates only a five-minute opaque login challenge. The challenge is kept in a
host-only, HTTP-only, `SameSite=Strict` cookie and stored in MariaDB only as a SHA-256 digest. The normal browser
session is created only after an authenticator or recovery code succeeds.

Encrypt the base32 TOTP secret using AES-256-GCM with a key derived from `TOTP_ENCRYPTION_KEK`, a random 96-bit nonce,
and user/version authenticated context. Store recovery codes only as user-bound HMAC-SHA-256 digests. Accept the
current or immediately prior time step and persist a successful step to prevent code reuse. Enabling, disabling, or
replacing recovery codes revokes every other session for that account.

## Consequences

TOTP remains optional, interoperable with standard authenticator apps, and authoritative in MariaDB. Redis is used
only for the existing fail-closed, IP-hashed rate limit. The API never logs, queues, or persists a plaintext TOTP
secret, challenge token, or recovery code; an unavailable encryption key fails factor operations closed.
