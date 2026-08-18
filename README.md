# PagePulse

PagePulse is a self-hosted webpage-change monitoring platform for invited members. It checks public, JavaScript-rendered, and authorized authenticated pages; detects meaningful additions and text changes; and delivers alerts through email, browser push, Discord, and signed webhooks.

> Status: architecture-complete starter repository. The service boundaries, development environment, contracts, CI, deployment helpers, and implementation plan are ready for incremental development in Codex.

## Core capabilities

- Public HTML, JSON API, and RSS/Atom monitoring.
- Lightweight HTTP fetching plus isolated Chromium/Playwright workers.
- Entire-page, repeated-listing, CSS-selector, and visual element selection.
- Any-text, new-listing, and keyword appearance/disappearance rules.
- Hourly, daily, and custom timezone-aware schedules with a one-hour minimum.
- Before/after history, seven-day snapshots, and 30-day check/alert metadata.
- Invitation-only accounts with email/password, optional TOTP, session management, and owner controls.
- Encrypted per-monitor and reusable credential profiles with guided authenticated sessions.
- Email via SMTP, Resend, or Postmark; Web Push/PWA; Discord and generic webhooks.
- Full scoped personal-access-token API under `/api/v1`.
- Separate Light and Dark themes with system-independent onboarding selection.

## Repository layout

```text
apps/
  web/              React/Vite PWA
  api/              Fastify REST/OpenAPI service
  fetch-worker/     Lightweight HTTP/JSON/RSS checks
  browser-worker/   Playwright authenticated/rendered checks
packages/
  config/           Environment validation and shared logging
  contracts/        API schemas and queue payload contracts
  db/               Drizzle schema and migrations
  monitor-engine/   Normalization, identity, comparison, and rules
docs/                Product and engineering documentation
infrastructure/      Compose, gateway, deployment, and Infisical notes
scripts/             Bootstrap, validation, deployment, and rollback helpers
```

## Quick start

1. Install Node.js 24+, pnpm 11+, Docker Engine, and Docker Compose v2.
2. Copy `.env.example` to `.env` and keep its development-only values local.
3. Run `pnpm install`.
4. Run `pnpm compose:config` to validate the Compose model.
5. Run `docker compose -f compose.yaml -f compose.dev.yaml up --build`.
6. Open PagePulse at `http://localhost:8080`, Mailpit at `http://localhost:8025`, Adminer at `http://localhost:8081`, and Bull Board at `http://localhost:3001`.

The seeded owner and demo data are created through `pnpm bootstrap:dev` once the application layer is implemented. No production credentials belong in this repository.

## Documentation

- [Product requirements](docs/PRODUCT_REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Monitoring engine](docs/MONITORING_ENGINE.md)
- [Security model](docs/SECURITY_MODEL.md)
- [API design](docs/API.md)
- [Deployment and operations](docs/DEPLOYMENT.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Testing strategy](docs/TESTING.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Decision record](docs/DECISIONS.md)

## Rights

Copyright © 2026. All Rights Reserved. This repository is publicly visible but is not open source. No license is granted to use, copy, modify, distribute, or create derivative works except where required by GitHub’s Terms of Service. See [RIGHTS.md](RIGHTS.md).
