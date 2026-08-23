# ADR 0004: Public Health and Restricted Diagnostics Boundary

- Status: Superseded by ADR 0008
- Date: 2026-08-22

## Decision

Expose dependency-free API liveness publicly. Expose API readiness publicly as an aggregate status that probes
MariaDB and Redis but never returns failure details. Expose detailed, safe dependency status only through a diagnostics
route guarded by a file-backed `OWNER_DIAGNOSTICS_TOKEN` until Phase 2 owner-session authorization is available.

## Consequences

Load balancers can distinguish a live API process from a ready service without learning infrastructure details.
This temporary bootstrap authorization was retired once owner-session authorization became available in Phase 2;
ADR 0008 records its replacement. Worker containers report unhealthy when they cannot reach Redis, rather than merely
when their main process exits.
