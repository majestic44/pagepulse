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

Detailed dependency status is unavailable by default. Before owner sessions are implemented, configure
`OWNER_DIAGNOSTICS_TOKEN` (or `OWNER_DIAGNOSTICS_TOKEN_FILE`) to enable the temporary owner diagnostics endpoint:

```bash
curl -H "Authorization: Bearer $OWNER_DIAGNOSTICS_TOKEN" http://127.0.0.1:8080/api/v1/system/diagnostics
```

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
different lifetime is needed. Redeem its token through `POST /api/v1/auth/owner-setup` with a password of at least
12 characters. The response intentionally does not expose a verification token.

## Authentication configuration

The API uses Node's native Argon2id implementation. Keep `AUTH_ARGON2_MEMORY_KIB`,
`AUTH_ARGON2_PARALLELISM` and `AUTH_ARGON2_PASSES` at their reviewed defaults unless a capacity review supports a
change. Configure the verification/reset token lifetimes and bounded login, reset and redemption rate limits through
the matching `AUTH_*` and `*_TOKEN_TTL_MINUTES` variables in `.env.example`.

Email delivery is not part of this identity foundation. It is deferred to the Phase 5 provider work, so the current
development stack cannot send verification or password-reset messages and never prints those token values to logs.

## Codex workflow

Give Codex one implementation-plan issue at a time. Ask it to inspect this documentation and `AGENTS.md`, create a feature branch from `development`, implement tests and docs, validate locally, and open a PR. Do not combine authentication, browser isolation and notification delivery in one oversized change.

## Architecture decisions

Create `docs/adr/NNNN-title.md` for any change to database authority, queue model, encryption, service boundaries, public API, retention or deployment. Supersede decisions explicitly; do not silently rewrite the architecture.
