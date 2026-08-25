# Monitoring Engine

## Fetch selection

Use the HTTP worker for HTML, JSON and RSS unless the monitor requires rendered DOM, visual element selection, stored credentials, or an established browser session. Escalation to Chromium is explicit and recorded; an HTTP failure alone must not silently send arbitrary pages to a browser worker.

## Destination safety

- Only `http` and `https` URLs.
- Resolve every initial host and redirect; reject loopback, link-local, multicast, metadata, private, reserved and non-routable addresses.
- Revalidate DNS at connection time to mitigate rebinding.
- Restrict redirects, bytes, decompression ratio, content types and duration.
- Use a PagePulse user agent and configurable per-domain concurrency.
- Apply exponential backoff with jitter for temporary network and 5xx failures.
- Never bypass TLS failures, CAPTCHA, bot challenges, paywalls or access controls.

## Browser isolation

- Fresh context for every check; no shared browser storage directory.
- Credentials/session decrypted only in worker memory after job claim.
- Block downloads, clipboard, camera, microphone, geolocation, notifications and filesystem access.
- Restrict navigation to the configured site and validated required assets.
- Enforce job timeout, memory/cgroup limit and dynamic concurrency.
- Clear context, buffers and tmpfs after completion.
- Members complete MFA/CAPTCHA during an authorized setup/refresh session.

## Normalization pipeline

1. Parse by source type.
2. Extract the configured target.
3. Remove scripts/styles and excluded regions.
4. Normalize Unicode, whitespace and safe formatting.
5. Normalize tracking parameters and approved relative timestamps.
6. Detect/remove common ad/cookie regions conservatively.
7. Apply member ignore selectors/patterns.
8. Produce a canonical typed representation and SHA-256 content hash.

## Rule evaluation

- `text-change`: canonical previous hash differs from current hash.
- `new-item`: extract repeated items; identity priority is website ID → canonical URL → title/location/content fingerprint.
- `keyword`: normalized token/phrase transitions from absent to present or present to absent.

Rules are pure, versioned functions with fixture tests. A rule revision establishes a new baseline and does not alert immediately unless the member explicitly requests a test.

## Outcomes

`unchanged`, `changed`, `blocked`, `authentication_required`, `target_missing`, `temporary_failure`, `permanent_failure`, `paused`, and `cancelled` are distinct states. Recovery alerts occur when a monitor returns to successful checking after an eligible failure state.

## Scheduling

- BullMQ v6 Job Schedulers; do not use legacy repeatable-job APIs.
- One-hour minimum; schedules stored with member IANA timezone and resolved safely across DST.
- Deterministic scheduler key contains monitor ID and schedule revision.
- Jobs include jitter to avoid synchronized checks.
- Missed runs collapse into one catch-up check rather than a burst.

MariaDB stores the member-selected schedule definition and the monitor revision; Redis is rebuilt from that committed
state during reconciliation. Hourly schedules compile to a timezone-aware cron pattern at the selected local minute,
daily schedules compile to the selected local `HH:MM`, and custom schedules use a fixed whole-minute interval of at
least one hour. BullMQ/cron-parser receives the IANA time zone for calendar schedules, so daylight-saving transitions
are resolved by the scheduler instead of application-side timestamp arithmetic.
