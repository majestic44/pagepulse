# ADR 0010: Transactional Security and Administrative Audit Retention

- Status: Accepted
- Date: 2026-08-24

## Decision

Store security and administrative audit events in MariaDB with a 90-day expiry. Each event contains only an action
name, opaque actor and target identifiers, a SHA-256 requester-IP hash when there is an HTTP request, a request ID and
timestamps. The audit table has no foreign keys so account-removal records remain available as pseudonymous history.

Record an audit event in the same MariaDB transaction as the associated owner setup, verification, password reset,
session, TOTP, member-lifecycle or account-deletion state change. A failure to persist the audit event rolls back that
state change. The maintenance worker deletes expired events in bounded MariaDB batches.

Owners may read the newest 100 events through the authenticated owner endpoint and browser page. That output excludes
IP hashes, request IDs, retention deadlines, email addresses, tokens, credentials and request bodies.

## Consequences

Audit history is durable and transactionally consistent with the protected state it describes, but it is intentionally
not a general activity log. Failed unauthenticated attempts, request payloads and plaintext identifiers are excluded to
avoid account-enumeration and sensitive-data retention risks. Deleting an account does not erase its prior opaque audit
references; expiry is the retention boundary.
