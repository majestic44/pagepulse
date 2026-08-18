# Data Model

## Identity and authorization

- `users`: email, password hash, verification state, timezone, theme, status, deletion deadline.
- `roles`: fixed `owner` and `member` roles for v1.
- `invitations`: hashed token, inviter, email, expiry and redemption state.
- `sessions`: hashed token, device metadata, last used, expiry and revocation.
- `totp_methods`: encrypted secret, recovery-code hashes and timestamps.
- `personal_access_tokens`: prefix, token hash, scopes, expiry, rate tier, last-used IP/time and revocation.

## Monitoring

- `credential_profiles`: owner, domain hints, encrypted envelope payload, key version and status.
- `monitors`: owner, URL, source type, fetch mode, schedule, timezone, state, revision, next due and failure counters.
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
- `outbox_events`: committed domain events awaiting queue publication.
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
- The deployment migration container obtains a MariaDB advisory lock and records application schema compatibility.
- Every migration requires a restore/rollback note even when the database change itself is not reversed.
