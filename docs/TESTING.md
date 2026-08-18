# Testing Strategy

## Unit tests

Required for canonicalization, URL safety, identity fingerprints, rule transitions, schedules/DST, cooldown, quiet hours, signatures, encryption envelopes and authorization policies.

## API integration tests

Run Fastify against disposable MariaDB and Redis services. Cover migrations, invitation/auth/TOTP/session lifecycle, ownership isolation, monitor CRUD/revisions, PAT scopes/rate limits/idempotency, outbox publication, exports/deletion and owner controls.

## Worker contract tests

Use versioned queue-payload fixtures. Verify stale job rejection, idempotent retries, graceful shutdown, timeout/cancellation, blocked/auth-required classification, atomic snapshot publication and retention cleanup.

## Browser tests

Use only local fake targets. Test rendered extraction, visual locator stability, login mapping, session expiration/refresh, MFA handoff boundary, blocked downloads/permissions, navigation restriction and temporary cleanup.

## End-to-end tests

Initially non-blocking but required before the first production release: invitation → onboarding → monitor creation → fake target change → diff review → email/webhook/push record → export/delete. Cover both themes, keyboard flow, reduced motion and responsive layouts.

## Required PR checks

- Strict typecheck and ESLint.
- API integration tests.
- AMD64/ARM64 Docker builds.
- Dependency and container vulnerability scans.

Unit tests run in CI from the start even if branch protection initially names only the required checks above. Release gating adds end-to-end, SBOM, provenance and image scan.
