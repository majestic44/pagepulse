# ADR 0001: Separate API, Fetch and Browser Workers

- Status: Accepted
- Date: 2026-08-18

## Decision

Use a React/Vite PWA, Fastify API, lightweight fetch worker and isolated Chromium browser worker as separate deployable services. MariaDB is authoritative and Redis/BullMQ coordinates background work.

## Rationale

Browser checks have a larger attack surface and resource profile than ordinary HTTP checks. Separation allows independent resource limits, scaling and secret access while keeping the API responsive.

## Consequences

More images and contracts must be maintained. Queue messages and shared packages require version discipline. The browser worker can be stopped without disabling review and ordinary HTTP monitoring.
