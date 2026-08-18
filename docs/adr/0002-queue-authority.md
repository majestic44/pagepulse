# ADR 0002: MariaDB Authority with Redis/BullMQ Coordination

- Status: Accepted
- Date: 2026-08-18

## Decision

Persist schedules, check results and domain events in MariaDB. Use Redis with BullMQ Job Schedulers for delayed/retryable execution. Reconcile Redis from MariaDB and publish notifications through a transactional outbox.

## Consequences

Redis loss delays work but does not erase product history or monitor definitions. Jobs must be idempotent and scheduler reconciliation is a required service, not optional maintenance.
