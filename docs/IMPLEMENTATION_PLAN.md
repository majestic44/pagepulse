# Codex Implementation Plan

Each numbered item should normally become one GitHub issue and one focused pull request into `development`. Dependencies are explicit; do not skip security foundations to reach UI milestones faster.

## Phase 0 — Repository foundation

1. Finish workspace package wiring, shared TypeScript/ESLint/Prettier configuration and dependency policy.
2. Make every starter container build as a non-root, health-checked multi-stage image.
3. Finalize core/dev/production Compose overlays and validate isolated networks/volumes/log rotation.
4. Add CI for type/lint/unit/integration, dependency review, container builds and vulnerability scanning.
5. Add release PR automation, semantic tags, GHCR multi-arch publication, SBOM/provenance and Plesk deployment metadata.

Exit: clean install, checks, images and local helper stack work from a fresh clone.

## Phase 1 — Configuration, data and service health

6. Implement strict environment schema, secret-file support and structured redacting logger.
7. Implement Drizzle schema/migration runner, advisory lock and schema compatibility records.
8. Implement Redis/BullMQ connections, queue names, versioned payload schemas and graceful shutdown.
9. Implement liveness/readiness/version endpoints and owner-only diagnostic aggregation.
10. Implement transactional outbox and a scheduler reconciliation skeleton.

Exit: API and workers start, report truthful health and recover queue state from MariaDB.

## Phase 2 — Identity and administration

11. Owner bootstrap CLI with expiring setup token.
12. Invitation redemption, email verification, Argon2id password login/reset and rate limits.
13. Session rotation/revocation and active-session UI/API.
14. Optional TOTP enrollment/challenge/recovery codes.
15. Owner/member authorization policies and member lifecycle including suspension/removal.
16. Seven-day account deletion recovery and permanent deletion workflow.
17. Security/admin audit events with 90-day retention.

Exit: invitation-only account lifecycle passes isolation and abuse tests.

## Phase 3 — Monitor configuration

18. Monitor CRUD, revision concurrency, 50-monitor default limits, pause/resume and validation.
19. Hourly/daily/custom scheduling, timezone/DST and one-hour minimum.
20. Whole-page/CSS selector target configuration and extraction preview.
21. Repeated-list auto-detection and member-selected identity/ignore regions.
22. Keyword and text/new-item rule configuration with baseline semantics.
23. Light/Dark/System token implementation and first-time theme selection.

Exit: members can safely configure and test non-authenticated monitors.

## Phase 4 — HTTP monitoring engine

24. SSRF-safe URL resolution, redirect control, size/decompression/time limits and user agent.
25. HTML fetch/parser, JSON source and RSS/Atom adapters.
26. Normalization pipeline and noise removal.
27. Listing identity and deterministic rule engine with fixture suite.
28. BullMQ Job Schedulers, due reconciliation, jitter, domain concurrency and backoff.
29. Atomic snapshot storage, check outcomes and seven-day retention.
30. Change review UI with previous/current content and expected/ignore actions.

Exit: public HTTP sources are monitored end to end without notifications.

## Phase 5 — Notification platform

31. Endpoint model and verification for SMTP, Resend and Postmark.
32. Immediate email templates and delivery attempt/retry history.
33. VAPID Web Push, service worker, installable PWA and capability detection.
34. Discord webhook adapter.
35. Generic webhook HMAC, SSRF defense, custom headers and replay documentation.
36. Six-hour cooldown, quiet hours, daily digest and recovery alerts.
37. Delivery UI, test notifications and manual retry with audit.

Exit: every configured channel has verified delivery, retry and failure behavior.

## Phase 6 — Authenticated and rendered monitoring

38. Envelope-encryption service with rotatable Infisical KEKs and key-version audit.
39. Per-monitor and reusable credential profiles without secret readback.
40. Hardened Chromium worker container, tmpfs, limits, permissions/download blocks and cleanup.
41. Common login-form detection and explicit field mapping.
42. Guided browser login recording with member-controlled MFA/CAPTCHA step.
43. Encrypted session reuse, automatic re-login and reauthorization state.
44. Visual element selector and locator resilience.
45. Meaningful-change screenshots only and private storage controls.
46. Dynamic browser concurrency/memory pressure controller.

Exit: authenticated/rendered checks meet the isolation and secret-leak test suite.

## Phase 7 — External API and data controls

47. Generated OpenAPI and consistent errors/pagination/revision preconditions.
48. PAT creation/hash/display-once/revocation/expiry/auditing.
49. Full scoped monitor/change/delivery/check API.
50. Per-token rate limiting and idempotency records for writes.
51. Monitor/history exports and pre-deletion archive.
52. Individual history deletion and 30-day metadata retention.

Exit: external API never exceeds member/UI permissions and is fully contract tested.

## Phase 8 — Owner operations and production hardening

53. Owner provider/limit/retention/global-pause controls.
54. Queue/worker/storage/blocked-monitor diagnostic dashboard.
55. Cloudflare Tunnel/gateway/WAF/rate-limit deployment runbook.
56. Infisical separate-stack deployment, backup, key rotation and recovery runbook.
57. Plesk seven-generation backup and quarterly restore-test procedure.
58. Health-gated deployment and automatic image rollback drill.
59. WCAG 2.2 AA, keyboard, reduced-motion and responsive/PWA audit.
60. Load test at 50 users/1,000 monitors and document 8 CPU/16 GB or split-host thresholds.
61. Threat-model review, dependency/container scan closure, SBOM/provenance and incident runbook.

Exit: first semantic release candidate is recoverable, observable, accessible and documented.

## Suggested first Codex task

Start with issue 1 only: make the workspace install, lint, typecheck and test with placeholder service packages. Do not begin authentication or monitoring features until Phase 0 is green.
