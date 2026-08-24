# ADR 0005: Authentication Token and Development Delivery Boundary

- Status: Accepted
- Date: 2026-08-23

## Decision

Use Node's native Argon2id implementation for password hashes. Store invitation, email-verification and
password-reset credentials only as SHA-256 digests with expiry, use and revocation timestamps in MariaDB. Rate-limit
unauthenticated authentication actions through Redis using a one-way hash of the requester IP, and fail closed when
the limit cannot be evaluated.

The API deliberately never returns a verification or reset token. Development Compose may enable a single Mailpit
adapter, which sends a fresh plaintext verification token directly in the requesting API process while only its digest
is persisted. The adapter has a fixed internal destination (`mailpit:1025`) and is rejected outside development. It
must not put the plaintext token into a queue payload, outbox event or structured log.

Production verification-provider delivery and password-reset delivery remain deferred to Phase 5. Their future
adapters must follow the same direct-delivery and plaintext-token handling rule.

## Consequences

The database remains authoritative for account state and token consumption, while Redis only coordinates abuse
protection. Local owner and invitation onboarding can be tested end-to-end through Mailpit without adding a real SMTP
provider or letting configuration choose an arbitrary network destination. Production deployments fail closed for
verification delivery and must not advertise it or password resets as available until their provider work is complete.
