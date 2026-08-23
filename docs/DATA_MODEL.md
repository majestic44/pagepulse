# Data Model

## Identity and authorization

- `users`: email, password hash, verification state, timezone, theme, status, deletion deadline.
- `owner_setup_tokens`: one SHA-256 token digest bound to the pending owner, with expiry, redemption and revocation timestamps. Plaintext setup tokens are never stored.
- `roles`: fixed `owner` and `member` roles for v1.
- `invitations`: SHA-256 token digest, inviter, canonical email, expiry, redemption and revocation state.
- `account_tokens`: SHA-256 digest for a short-lived, single-use email-verification or password-reset token, with
  expiry, use and revocation timestamps. Issuing a token of either type revokes the prior unused token for that user.
- `sessions`: hashed token, device metadata, last used, expiry and revocation.
- `totp_methods`: encrypted secret, recovery-code hashes and timestamps.
- `personal_access_tokens`: prefix, token hash, scopes, expiry, rate tier, last-used IP/time and revocation.

## Monitoring

- `credential_profiles`: owner, domain hints, encrypted envelope payload, key version and status.
- `monitors`: owner, URL, source type, fetch mode, schedule, timezone, state, revision, next due and failure counters.
- `monitor_schedules`: internal authoritative scheduler registry keyed by monitor and revision, with a bounded interval and correlation ID. Phase 3 will own member-facing schedule, timezone and DST configuration.
- `monitor_targets`: whole page, selector, repeated-list configuration or visual locator.
- `monitor_rules`: rule type and versioned configuration.
- `monitor_ignore_rules`: selectors, normalized patterns and built-in noise flags.
- `auth_flows`: encrypted field mappings/session references and reauthorization state.
- `checks`: due/start/end, worker/fetch method, result class, HTTP metadata, content hash, timings and correlation ID.
- `snapshots`: storage key, checksum, byte size, media type, expiry and confidentiality flag.
- `detected_items`: monitor, stable identity, first/last seen and current content hash.
- `changes`: previous/current snapshot references, rule match, summary and lifecycle state.

## Delivery and administration

- `notification_preferences`: per-user channel, quiet hours, digest time and recovery behavior.
- `alert_endpoints`: encrypted provider configuration and verification state.
- `alert_deliveries`: event, endpoint, attempt, outcome, next retry and response classification.
- `webhook_idempotency`: member/token/key/request hash/result/expiry.
- `outbox_events`: identifier-only committed domain events awaiting queue publication. They record event type, subject identifiers, correlation ID, availability and publication state; they never store fetched content or secrets.
- `audit_events`: actor, action, safe target identifiers, IP hash, request ID and retention deadline.
- `system_settings`: owner-configurable limits and retention with revision/audit metadata.

## Deletion and retention

- User deletion is soft for seven days; sign-in is blocked during recovery unless deletion is cancelled.
- Permanent deletion destroys member credential data keys first, then removes personal content in ordered batches.
- Snapshots/screenshots expire after seven days.
- Checks and alert deliveries expire after 30 days.
- Audit events expire after 90 days but contain no secret or private fetched content.
- Referential actions must preserve owner audit events with pseudonymous actor IDs after account deletion.

## Migration rules

- Drizzle SQL migrations are forward-only in production.
- Destructive changes use expand/migrate/contract across releases.
- The migration runner obtains the `pagepulse_migrations` MariaDB advisory lock before applying SQL migrations.
- Each successful migration run records the schema version, migration identifier, compatible application versions, and deployed application version in `schema_compatibility`.
- Every migration requires a restore/rollback note even when the database change itself is not reversed.
- Migration `0003_tired_thunderbolt_ross` is additive: it adds account authentication fields to `users`, plus
  `invitations` and `account_tokens`. Rollback is a reviewed restore from a verified pre-migration backup after the
  authentication endpoints are disabled; it must not be dropped in place on a live deployment.
