# ADR 0006: Server-Side Session Lifecycle

- Status: Accepted
- Date: 2026-08-23

## Decision

Use a random 256-bit opaque token in a host-only, HTTP-only, `SameSite=Strict` browser cookie. Store only its
SHA-256 digest in MariaDB alongside a derived browser/operating-system label, activity timestamp, idle expiry,
absolute expiry and revocation timestamp. Add the `Secure` attribute in production.

The default lifecycle is eight hours of inactivity and a 30-day absolute maximum. A successful login creates a new
session and revokes the browser's previous session, a password reset revokes every active session, and a signed-in
member can revoke one session or all other sessions. MariaDB is authoritative; Redis is not part of session state.

## Consequences

The API can list and revoke active sessions without exposing a recoverable token. Restarting API instances preserves
valid sessions, while a database restore or explicit session revocation invalidates them predictably. The cookie is
usable on the local HTTP stack only because the `Secure` flag is intentionally development-specific; production
requires an HTTPS `APP_BASE_URL` and sends the secure form.
