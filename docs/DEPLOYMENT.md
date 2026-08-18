# Deployment and Operations

## Target

- Plesk-managed Linux VPS, 4 CPU / 8 GB RAM initially.
- Cloudflare Tunnel is the only ingress; no PagePulse, MariaDB, Redis or Infisical service exposes a public host port.
- PagePulse and Infisical are separate Compose projects with independent data services, networks, volumes, release cadence and recovery.
- Run production with `compose.yaml` and `compose.production.yaml` together. The production overlay replaces local
  builds with versioned GHCR images, removes the gateway host-port binding, and sets `NODE_ENV=production`.

## Secrets

Self-hosted Infisical injects production variables at deployment/runtime. The repository contains names and validation only. Infisical recovery keys, database credentials, session/encryption keys, VAPID keys, provider tokens, tunnel credentials and GHCR credentials are never committed.

Because Infisical’s own Compose stack requires PostgreSQL and Redis, budget and monitor it separately. At sustained memory pressure, move Infisical to a separate host or upgrade to at least 8 CPU / 16 GB.

## Release flow

1. Features merge to `development` after required checks.
2. A Conventional Commits release bot opens a human-reviewed release PR toward `main`.
3. Merging creates the semantic tag and GitHub release.
4. GitHub Actions builds/scans/signs AMD64 and ARM64 images and publishes immutable tag and digest metadata to GHCR.
5. Plesk Git integration updates the deployment checkout and runs `scripts/deploy.sh <version>`.
6. Deployment captures current digests, pulls new images, runs the one-shot migration container, starts services, and checks readiness.
7. Failure invokes `scripts/rollback.sh` with prior digests. Database migrations follow expand/contract so application rollback remains compatible.

## Cloudflare

- Tunnel routes one application hostname to internal `gateway:8080`.
- Managed WAF and login/API rate limits.
- No cache for `/api/*`, authenticated HTML or service-worker-sensitive responses.
- Gateway sets CSP, HSTS, frame, MIME, referrer and permissions policies.
- Do not place Cloudflare Access in front of PagePulse v1; application authentication remains authoritative.

## Backups

Plesk’s configured schedule retains seven daily generations covering:

- MariaDB logical/volume recovery material.
- PagePulse Redis AOF volume.
- Deployment configuration excluding secrets.
- Infisical application, PostgreSQL, Redis and configuration/recovery material.

The seven-day snapshot volume is excluded. Run a documented restore test at least quarterly and before risky infrastructure changes. A backup is not accepted until its restore is demonstrated.

## Operations thresholds

Upgrade or split services when any condition persists:

- Memory above 80%, swap activity, or an OOM kill.
- Browser queue oldest-job age exceeds 15 minutes.
- Scheduled checks start more than five minutes late.
- MariaDB or Infisical maintenance competes with browser jobs.
- More than one browser check cannot run safely.

## Incident controls

Owner can pause all monitoring without disabling review/export. Queue consumers shut down gracefully; active jobs return to retryable state. Credential compromise requires KEK rotation, session/token revocation, provider rotation, audit preservation and notification according to the incident runbook added in the hardening phase.
