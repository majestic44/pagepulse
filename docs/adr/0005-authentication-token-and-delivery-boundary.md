# ADR 0005: Authentication Token and Deferred Delivery Boundary

- Status: Accepted
- Date: 2026-08-23

## Decision

Use Node's native Argon2id implementation for password hashes. Store invitation, email-verification and
password-reset credentials only as SHA-256 digests with expiry, use and revocation timestamps in MariaDB. Rate-limit
unauthenticated authentication actions through Redis using a one-way hash of the requester IP, and fail closed when
the limit cannot be evaluated.

The API deliberately never returns a verification or reset token. Outbound email/provider delivery is deferred to
Phase 5; a future adapter must create and deliver a fresh plaintext token in the same request lifecycle while only
the digest is persisted. It must not put the plaintext token into a queue payload, outbox event or structured log.

## Consequences

The database remains authoritative for account state and token consumption, while Redis only coordinates abuse
protection. Password verification and account state can be tested now without adding an SMTP or provider dependency.
Until the delivery adapter exists, deployments cannot complete user-facing email verification or password reset and
must not advertise those flows as available.
