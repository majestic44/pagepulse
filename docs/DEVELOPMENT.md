# Development Guide

## Prerequisites

- Node.js 24.7+
- pnpm 11+
- Docker Engine and Compose v2
- Git

## Local stack

`compose.yaml` defines production-shaped core services. `compose.dev.yaml` adds Mailpit, Adminer, Bull Board,
and the devtools fake-target/webhook sink. All development ports bind to loopback only.

Use only `.env.example` development values locally. Production values come from Infisical.

Configuration is validated at startup. In production, sensitive configuration supports Docker/Infisical file
mounts through `<VARIABLE>_FILE` (for example, `DATABASE_URL_FILE=/run/secrets/database_url`); do not set both
the direct value and its `_FILE` form. Logs are structured JSON and redact sensitive keys recursively.

The scheduler reconciles MariaDB-backed monitor schedules and pending outbox rows every five minutes by default.

After signing in locally, visit `http://localhost:8080/monitors` to exercise monitor configuration. The page supports
creation, revision-protected edits, pause/resume, deletion, and hourly/daily/custom schedule configuration for the
signed-in account. Calendar schedules require an IANA time zone and are reconciled through BullMQ with DST-aware cron
patterns; custom intervals are never shorter than 60 minutes. It records target URLs but does not fetch them; outbound
SSRF protections arrive with the HTTP monitoring engine.
Set `SCHEDULER_RECONCILIATION_INTERVAL_MS` to a value between 60 seconds and one hour when a different recovery
cadence is needed.

## Commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm compose:config
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

## Container health

Starter images run as non-root users and provide container health checks. After starting the stack, use
`docker compose -f compose.yaml -f compose.dev.yaml ps` to confirm every service is healthy before testing
against it. API liveness is dependency-free; API readiness requires MariaDB and Redis. Worker checks require
both a live worker process and Redis connectivity.

Detailed dependency status is available only to an authenticated owner browser session at
`/api/v1/system/diagnostics`. The former static diagnostics bearer token is retired; do not add it to local or
production configuration.

## Fake targets

The fake-target service must provide deterministic scenarios for unchanged content, new jobs, keyword transitions, timestamp noise, redirect validation, oversized responses, slow/timeouts, login expiration, target disappearance and temporary recovery. Never test fetching protections against random third-party sites.

## Database workflow

Edit the Drizzle schema, generate SQL, review it manually, add migration tests and describe forward/rollback compatibility. Do not use automatic schema push in shared or production environments.

## Owner bootstrap

After migrations are applied, create the first owner from an interactive operator terminal:

```bash
pnpm owner:bootstrap -- --email owner@example.com
```

The command requires `APP_BASE_URL` and `DATABASE_URL`, creates one pending owner and prints a one-time
`/setup/owner` URL. It stores only a token digest and expires the URL after 30 minutes by default. Before the
owner completes setup, rerun it with the same email to revoke the prior unused URL and issue a replacement;
it refuses after the owner becomes active. Treat the printed URL as a credential: do not run this command in
CI or capture its output in logs. Configure `OWNER_SETUP_TOKEN_TTL_MINUTES` between 5 and 1,440 when a
different lifetime is needed. Open the URL in a browser, choose a password of at least 12 characters, then use the
verification link delivered to the owner email address. The setup and verification URLs remove their token query from
the browser address bar before rendering. The API response intentionally does not expose a verification token.

## Authentication configuration

The API uses Node's native Argon2id implementation. Keep `AUTH_ARGON2_MEMORY_KIB`,
`AUTH_ARGON2_PARALLELISM` and `AUTH_ARGON2_PASSES` at their reviewed defaults unless a capacity review supports a
change. Configure the verification/reset token lifetimes and bounded login, reset and redemption rate limits through
the matching `AUTH_*` and `*_TOKEN_TTL_MINUTES` variables in `.env.example`.

Session cookies are host-only, HTTP-only and `SameSite=Strict`; production deployments add the `Secure` attribute.
`SESSION_IDLE_TTL_MINUTES` defaults to 480 (eight hours) and `SESSION_ABSOLUTE_TTL_MINUTES` defaults to 43,200
(30 days). The idle lifetime must not exceed the absolute lifetime. Local HTTP development intentionally omits the
`Secure` attribute so browser session testing works on loopback; production requires HTTPS for `APP_BASE_URL`.

`AUTH_EMAIL_DELIVERY_MODE` defaults to `disabled`. The `compose.dev.yaml` override is intentionally the only shipped
configuration that enables `mailpit`; it sends verification messages only to the internal development Mailpit service,
available on the host at `http://127.0.0.1:8025`. Mailpit mode requires `NODE_ENV=development` and `APP_BASE_URL`.
It is rejected in test and production environments. PagePulse does not return, log, queue or persist a plaintext
verification token. Production verification and all password-reset delivery remain deferred until the reviewed
Phase 5 provider adapters are available.

## TOTP configuration

Set `TOTP_ENCRYPTION_KEK` through Infisical (or `TOTP_ENCRYPTION_KEK_FILE`) before enabling an authenticator app.
It is used only in API memory to encrypt/decrypt the short RFC 6238 secret and HMAC recovery-code digests; never copy
the development placeholder to production. Authenticator enrollment lasts 10 minutes and emits a provisioning URI and
manual key only to the active browser response. Recovery codes are displayed once, never logged, and should be saved
outside PagePulse. TOTP proof, enrollment confirmation, recovery-code replacement, and factor disablement share the
bounded `AUTH_TOTP_RATE_LIMIT_MAX` / `AUTH_TOTP_RATE_LIMIT_WINDOW_MS` policy.

## Account deletion recovery

`POST /api/v1/account/deletion` is available to active member browser sessions only. It requires the current password
and a fresh TOTP proof when a factor is enabled, revokes every session, and displays one opaque recovery token exactly
once. Save that token outside PagePulse; it is not logged, queued, or persisted in plaintext. Submit it to
`POST /api/v1/account/deletion/recover` within seven days to restore the account, then sign in again. The maintenance
worker performs an immediate cleanup at startup and repeats it every `ACCOUNT_DELETION_SWEEP_INTERVAL_MS` (one hour by
default), permanently deleting expired member accounts and removing expired 90-day audit events according to MariaDB's
authoritative deadlines. Owners can inspect the newest 100 redacted events at `/owner/audit-events`; that page never
shows email addresses, raw IP addresses, IP hashes, request IDs, tokens or request bodies.

## Codex workflow

Give Codex one implementation-plan issue at a time. Ask it to inspect this documentation and `AGENTS.md`, create a feature branch from `development`, implement tests and docs, validate locally, and open a PR. Do not combine authentication, browser isolation and notification delivery in one oversized change.

## Architecture decisions

Create `docs/adr/NNNN-title.md` for any change to database authority, queue model, encryption, service boundaries, public API, retention or deployment. Supersede decisions explicitly; do not silently rewrite the architecture.
