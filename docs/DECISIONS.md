# Confirmed Product and Architecture Decisions

This file is the authoritative record of the planning interview completed on 2026-08-18.

## Product and accounts

- Invitation-only member accounts; a bootstrap owner administers the system.
- Email/password sign-in, email verification and reset, optional TOTP, active-session view/revocation.
- Members own and manage their monitors; owner can invite/suspend/remove members, change limits, configure providers, pause monitoring, inspect health, and change retention.
- Member default: 50 monitors. Initial target: 50 users and 1,000 monitors.
- Member export and deletion controls; seven-day account deletion recovery; 90-day audit retention.

## Monitoring

- Sources: HTML, JSON APIs, RSS/Atom.
- Fetch modes: HTTP first; Chromium/Playwright for rendered or authenticated pages.
- Target selection: whole page, repeated-list detection, CSS selector, and visual element picker.
- Rules: any text change, new item/listing, keyword appears/disappears.
- Schedules: hourly, daily, or custom days/times/cron in the member timezone; one-hour minimum.
- Noise normalization: whitespace/formatting, relative timestamps, tracking parameters, common cookie/ad regions, and member ignore regions.
- Listing identity: URL, website ID, then fingerprint of title/location/content.
- Six-hour duplicate cooldown. Seven-day snapshot retention; 30-day check and alert metadata.
- Screenshots are stored only for meaningful browser-rendered changes.
- Login: common-form detection, field mapping, or guided browser recording. Members complete MFA/CAPTCHA; PagePulse reuses the authorized session and requests reauthorization when needed.
- Bot challenges are never bypassed: blocked checks notify the member, allow authorized refresh, and pause after repeated blocks.

## Notifications and API

- Immediate alerts, duplicate cooldown, quiet hours, daily digest, and recovery alerts.
- Channels: SMTP/Resend/Postmark email, VAPID Web Push/PWA, Discord, and generic signed webhooks.
- Webhook security: HMAC signatures, SSRF blocking, retries, delivery log/manual retry, optional custom headers.
- Full `/api/v1` monitor-management API using scoped personal access tokens, expiry, per-token rate limits, last-used time/IP auditing, and idempotency on writes.

## Platform

- pnpm monorepo; React/Vite PWA; Fastify REST/OpenAPI; Drizzle/mysql2; MariaDB; Redis/BullMQ Job Schedulers.
- Separate fetch and Chromium browser workers. Dynamic browser concurrency with a safe floor of one.
- Docker Compose on a Plesk VPS upgraded to 4 CPU/8 GB RAM. AMD64 and ARM64 images in GHCR.
- Cloudflare Tunnel only ingress, single origin, `/api` routing, application authentication, WAF/rate limits/no-cache/security-header baseline.
- Self-hosted Infisical colocated as a separate Compose project with independent PostgreSQL, Redis, volumes, networks, and recovery.
- Plesk scheduled backups with seven daily generations cover MariaDB, Redis, deployment configuration, and Infisical. Short-lived snapshot volume is excluded.
- JSON structured logs with safe IDs/timing/domain only; Docker rotation plus Plesk collection. Liveness, readiness, public version/uptime, and owner-only diagnostics.

## Delivery

- Feature branches → `development` → release PR → `main`.
- Conventional Commits and a human-approved release PR create semantic tags/releases.
- GHCR multi-architecture images; Plesk Git integration triggers health-gated Compose deployment and automatic rollback.
- Required PR checks: type/lint, API integration, container build, dependency scan. Unit tests are included even if initially non-blocking.
- Public personal `pagepulse` repository with All Rights Reserved notice.
