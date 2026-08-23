# Architecture

## Service topology

| Service               | Responsibility                                                | Publicly exposed     |
| --------------------- | ------------------------------------------------------------- | -------------------- |
| `gateway`             | Static web app, `/api` proxy, security headers                | Tunnel network only  |
| `api`                 | Auth, REST/OpenAPI, monitor configuration, admin and PAT API  | Through gateway      |
| `scheduler`           | Reconciles authoritative schedules into BullMQ Job Schedulers | No                   |
| `fetch-worker`        | HTTP HTML/JSON/RSS fetching and extraction                    | No                   |
| `browser-worker`      | Isolated Chromium rendering, login and visual selection       | No                   |
| `change-worker`       | Normalization, identity, comparison and event creation        | No                   |
| `notification-worker` | Immediate/digest/push/webhook delivery                        | No                   |
| `maintenance-worker`  | Retention, recovery, stale-state and cleanup jobs             | No                   |
| `migrate`             | One-shot, locked Drizzle migrations                           | No                   |
| `mariadb`             | Authoritative durable application state                       | No host port         |
| `redis`               | BullMQ jobs, locks, rate-limit and ephemeral coordination     | No host port         |
| `cloudflared`         | Sole production ingress                                       | Outbound tunnel only |

Development-only services include Mailpit, Adminer, Bull Board, a webhook sink, and fake changing targets.

## Service health

- `GET /health/live` is public and dependency-free. It confirms only that the API process can respond.
- `GET /health/ready` concurrently probes MariaDB and Redis. It returns `200` only when both are reachable,
  otherwise `503`, and never includes connection errors or configuration values. Individual dependency probes are
  bounded so a stalled connection reports degraded health promptly.
- `GET /api/v1/system/version` is public and returns only the service name, application version and uptime.
- `GET /api/v1/system/diagnostics` is not registered unless `OWNER_DIAGNOSTICS_TOKEN` is configured. It requires
  that token as a Bearer credential and returns safe dependency status labels only. Phase 2 owner-session
  authorization will replace this bootstrap guard.
- Worker container health checks require both a live worker process and a successful Redis probe.
- The gateway re-resolves the API's internal Compose DNS name for proxied requests, so an API container can be
  recreated without leaving the gateway bound to a stale container address.

## Check lifecycle

1. MariaDB stores the monitor and next schedule state.
2. Scheduler transactionally upserts a BullMQ Job Scheduler using the monitor ID and schedule revision.
3. A due job routes to `page-fetch` or `browser-fetch` without secrets in its payload.
4. Worker loads the current monitor revision, rejects stale/paused jobs, validates the destination, and fetches within limits.
5. Worker writes a bounded raw snapshot to the private volume and enqueues a reference for `change-detection`.
6. Change worker normalizes, extracts identities, evaluates rules, and commits check/event/snapshot metadata in MariaDB.
7. A transactional outbox produces notification jobs after commit.
8. Notification worker applies cooldown, quiet hours and digest rules, then records every delivery attempt.
9. Maintenance removes expired files/rows and detects missing or orphaned artifacts.

## Consistency

- MariaDB is the source of truth for monitor state, check outcome, event and delivery history.
- Redis jobs are replayable. Jobs use deterministic IDs and are idempotent.
- Queue messages are TypeBox-validated versioned payloads containing IDs and correlation metadata only; credentials, cookies, secrets and fetched content are rejected.
- Workers stop claiming jobs before their Redis connection is closed, allowing BullMQ to finish active jobs during `SIGTERM`/`SIGINT` shutdown.
- Transactional outbox rows bridge MariaDB commits to BullMQ. A publisher marks a row published only after BullMQ accepts its deterministic notification job ID, so a crash can cause an at-least-once retry but cannot lose a committed event; notification consumers must remain idempotent.
- Scheduler reconciliation reads active, revision-matching `monitor_schedules` rows from MariaDB and upserts their deterministic BullMQ Job Schedulers. It removes only stale schedulers with the PagePulse-owned key prefix, repairing Redis after restart or data loss without deleting unrelated jobs.
- File writes use prepare → fsync → atomic rename; metadata commits only after a successful publish.

## Queue contracts

| Queue                          | Consumer                | Version 1 payload                             |
| ------------------------------ | ----------------------- | --------------------------------------------- |
| `monitor-schedule`             | scheduler               | monitor ID, monitor revision, correlation ID  |
| `page-fetch` / `browser-fetch` | fetch or browser worker | monitor ID/revision, check ID, correlation ID |
| `change-detection`             | change worker           | monitor ID/revision, check ID, correlation ID |
| `notification`                 | notification worker     | outbox event ID, correlation ID               |
| `digest`                       | notification worker     | user ID, digest-window start, correlation ID  |
| `maintenance`                  | maintenance worker      | maintenance task, correlation ID              |

The producer and consumer validate the same contract. Future incompatible payload changes require a new version rather than reinterpretation of queued data.

## Resource profile for 4 CPU / 8 GB

- MariaDB: 1.5–2 GB limit.
- PagePulse Redis: 384–512 MB with AOF every second.
- API/gateway/scheduler/notification/maintenance: approximately 1–1.5 GB combined.
- Fetch/change workers: approximately 512–768 MB combined.
- Browser worker: one concurrent Chromium check by default, 1.5–2 GB limit.
- Infisical stack consumes the remaining capacity and makes this host a constrained starting point.

Dynamic browser concurrency must never exceed configured memory thresholds. Sustained queue lag, swap use, OOM events, or Infisical pressure triggers the documented 8 CPU/16 GB or split-host upgrade.

## Network zones

- `edge`: cloudflared and gateway.
- `app`: gateway, API, scheduler and workers.
- `data`: API/workers, MariaDB and Redis.
- Browser jobs run with restricted capabilities, read-only root filesystem where possible, tmpfs scratch, and no access to the Docker socket.
- Infisical is a separate Compose project and network; secrets are injected before PagePulse startup rather than granting every container network access to Infisical.
