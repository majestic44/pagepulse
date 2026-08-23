# ADR 0008: Owner Session Authorization and Member Lifecycle

- Status: Accepted
- Date: 2026-08-23

## Decision

Use the existing authenticated browser session and fixed `owner` role for owner-only diagnostics and member lifecycle
actions. A signed-out caller receives `401`; an authenticated member receives `403`. Owner-only endpoints list member
accounts, suspend active members, reactivate suspended members, and permanently remove members. They never operate on
an owner account.

Suspension updates `users.status` from `active` to `suspended` inside a MariaDB transaction and revokes every active
session for the target. Reactivation is restricted to `suspended` members and restores `active`. Removal first revokes
all target sessions, then deletes the member; existing foreign keys cascade member-owned records. There is no new
schema state in this phase, and user-requested seven-day deletion recovery remains a separate next item.

## Consequences

The temporary static diagnostics bearer secret is removed from configuration and Compose. Access checks are enforced
at the API boundary regardless of the owner UI. Removal is intentionally irreversible and should be used only for
administrative removal; self-service account-deletion recovery and its retention rules are implemented separately.
