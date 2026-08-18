# Development Guide

## Prerequisites

- Node.js 24+
- pnpm 11+
- Docker Engine and Compose v2
- Git

## Local stack

`compose.yaml` defines production-shaped core services. `compose.dev.yaml` adds Mailpit, Adminer, Bull Board, webhook sink, fake targets and bind-mounted development apps.

Use only `.env.example` development values locally. Production values come from Infisical.

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

## Fake targets

The fake-target service must provide deterministic scenarios for unchanged content, new jobs, keyword transitions, timestamp noise, redirect validation, oversized responses, slow/timeouts, login expiration, target disappearance and temporary recovery. Never test fetching protections against random third-party sites.

## Database workflow

Edit the Drizzle schema, generate SQL, review it manually, add migration tests and describe forward/rollback compatibility. Do not use automatic schema push in shared or production environments.

## Codex workflow

Give Codex one implementation-plan issue at a time. Ask it to inspect this documentation and `AGENTS.md`, create a feature branch from `development`, implement tests and docs, validate locally, and open a PR. Do not combine authentication, browser isolation and notification delivery in one oversized change.

## Architecture decisions

Create `docs/adr/NNNN-title.md` for any change to database authority, queue model, encryption, service boundaries, public API, retention or deployment. Supersede decisions explicitly; do not silently rewrite the architecture.
