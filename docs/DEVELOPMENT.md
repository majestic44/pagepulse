# Development Guide

## Prerequisites

- Node.js 24+
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
against it. Worker checks confirm that the worker process is alive; dependency-aware readiness is added in
Phase 1.

## Fake targets

The fake-target service must provide deterministic scenarios for unchanged content, new jobs, keyword transitions, timestamp noise, redirect validation, oversized responses, slow/timeouts, login expiration, target disappearance and temporary recovery. Never test fetching protections against random third-party sites.

## Database workflow

Edit the Drizzle schema, generate SQL, review it manually, add migration tests and describe forward/rollback compatibility. Do not use automatic schema push in shared or production environments.

## Codex workflow

Give Codex one implementation-plan issue at a time. Ask it to inspect this documentation and `AGENTS.md`, create a feature branch from `development`, implement tests and docs, validate locally, and open a PR. Do not combine authentication, browser isolation and notification delivery in one oversized change.

## Architecture decisions

Create `docs/adr/NNNN-title.md` for any change to database authority, queue model, encryption, service boundaries, public API, retention or deployment. Supersede decisions explicitly; do not silently rewrite the architecture.
