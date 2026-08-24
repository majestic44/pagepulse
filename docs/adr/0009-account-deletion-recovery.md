# ADR 0009: Recoverable Member Account Deletion

- Status: Accepted
- Date: 2026-08-24

## Decision

Allow active member accounts to request self-service deletion after confirming the current password and, when enabled,
a fresh TOTP factor. The request moves the account to `deleting`, records a MariaDB deletion deadline seven days later,
revokes every browser session, and returns one opaque recovery token exactly once. Store only the SHA-256 token digest.

Recovery accepts the token without a session, consumes it, and restores the account to `active` only before the
deadline. Owners are excluded from self-service deletion so the installation cannot lose its sole administrative account.
The maintenance worker performs a bounded transactional sweep on startup and at a configured interval. It deletes only
expired `deleting` member records; existing foreign keys remove currently implemented dependent records.

## Consequences

The recovery token is a credential: it is never logged, queued, or placed in URLs. It is intentionally shown to the
already authenticated member once because outbound mail delivery is deferred to Phase 5. Account deletion and recovery
have their own IP-hashed Redis rate limit. Future credential-profile data keys must be destroyed before the permanent
delete transaction is extended to cover them.
