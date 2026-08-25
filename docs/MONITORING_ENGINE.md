# Monitoring Engine

## Fetch selection

Use the HTTP worker for HTML, JSON and RSS unless the monitor requires rendered DOM, visual element selection, stored credentials, or an established browser session. Escalation to Chromium is explicit and recorded; an HTTP failure alone must not silently send arbitrary pages to a browser worker.

## Destination safety

- Only `http` and `https` URLs.
- Resolve every initial host and redirect; reject loopback, link-local, multicast, metadata, private, reserved and non-routable addresses.
- Revalidate DNS at connection time to mitigate rebinding.
- The shared HTTP transport permits only GET over HTTP(S), follows at most three validated redirects by default, disables response compression, and bounds response bytes and request duration. It supplies the `PagePulse/1.0 (+https://pagepulse.local)` user agent without exposing target URLs in errors or logs.
- HTML, JSON and RSS/Atom adapters apply strict source-specific content-type checks on top of the shared transport. JSON parsing is bounded by depth and node count; RSS/Atom parsing caps the number and field size of entries. Per-domain concurrency arrives with scheduler dispatch.
- Apply exponential backoff with jitter for temporary network and 5xx failures.
- Never bypass TLS failures, CAPTCHA, bot challenges, paywalls or access controls.

## Extraction preview

An authenticated member can preview whole-page or CSS-selector extraction for an existing public monitor. The preview
does not accept an arbitrary URL, credentials, or browser session and does not persist fetched HTML. It performs a
fresh DNS check before every initial/redirect request and again at connection time, rejects any hostname with a
loopback, private, link-local, multicast, metadata, documentation, or otherwise reserved address, follows at most
three redirects, disables response compression, accepts HTML only, and returns at most 512 KiB of source and 20,000
characters of text. Preview requests are rate-limited and error responses intentionally omit destination and fetch
details.

The same bounded parse can identify up to six conservative repeated-list candidates from sibling structures inside the
chosen target. Candidates contain CSS selectors, counts, and short text samples only. A member may save an item
selector, a required identity selector evaluated within each item, and up to ten ignore selectors evaluated only within
that item. When configured, preview returns at most five bounded item samples after ignores are applied; it does not
persist HTML or add any fetched content to a queue.

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
4. Normalize Unicode, whitespace and safe formatting; mask approved relative timestamps so clock-driven labels do not create diffs.
5. Strip known tracking parameters and sort remaining query parameters in canonical HTTP URLs.
6. Detect/remove common ad/cookie regions conservatively from HTML `id`/`class` markers.
7. Apply member ignore selectors plus bounded literal text patterns; patterns are never evaluated as regular expressions.
8. Produce a canonical typed representation and SHA-256 content hash.

## Rule evaluation

- `text-change`: canonical previous hash differs from current hash.
- `new-item`: extract repeated items; identity priority is website ID → canonical URL → title/location/content fingerprint. Each identity is stored as a SHA-256 digest so rule evaluation never needs to emit the source value.
- `keyword`: normalized token/phrase transitions from absent to present or present to absent.

Rules are pure, deterministic functions with fixture tests. A first successful source establishes a baseline and produces no match; subsequent evaluations compare canonical hashes, stable listing identities, and normalized literal keyword transitions. Members can configure text-change and new-item rules plus up
to 25 normalized keyword phrases that alert when they appear or disappear. A saved rule revision resets to a pending
baseline; the first successful check establishes that new baseline and does not alert immediately unless the member
explicitly requests a test.

## Outcomes

`unchanged`, `changed`, `blocked`, `authentication_required`, `target_missing`, `temporary_failure`, `permanent_failure`, `paused`, and `cancelled` are distinct states. Recovery alerts occur when a monitor returns to successful checking after an eligible failure state.

## Scheduling

- BullMQ v6 Job Schedulers; do not use legacy repeatable-job APIs.
- One-hour minimum; schedules stored with member IANA timezone and resolved safely across DST.
- Deterministic scheduler key contains monitor ID and schedule revision.
- Jobs receive up to one minute of deterministic jitter before dispatch to avoid synchronized checks. The scheduler queue retries dispatch with bounded exponential backoff; the fetch queue uses the same retry policy for temporary failures.
- Missed runs collapse into one catch-up check rather than a burst.

MariaDB stores the member-selected schedule definition and the monitor revision; Redis is rebuilt from that committed
state during reconciliation. Hourly schedules compile to a timezone-aware cron pattern at the selected local minute,
daily schedules compile to the selected local `HH:MM`, and custom schedules use a fixed whole-minute interval of at
least one hour. BullMQ/cron-parser receives the IANA time zone for calendar schedules, so daylight-saving transitions
are resolved by the scheduler instead of application-side timestamp arithmetic.

The scheduler queues only monitor and check IDs. Before a fetch worker uses a per-domain concurrency slot, it re-reads
the active monitor revision from MariaDB and derives the hostname locally; stale jobs are discarded without a network
request.

## Snapshot publication and retention

The fetch worker normalizes a successful HTTP response, serializes only its canonical representation, and writes it to
the private snapshot volume using prepare → file sync → an atomic non-overwriting publish. It then commits the check outcome
and snapshot metadata together in MariaDB. Queue retries use the stable check ID, so an already-recorded check is never
overwritten. Snapshot rows contain a storage key, SHA-256 checksum, byte size, media type, confidentiality flag and
expiry—not fetched content.

The maintenance worker removes expired snapshot files before deleting their metadata in bounded batches. A missing file
is treated as already removed so cleanup can recover from partial prior attempts; a failed deletion retains the row for
the next sweep. Snapshots are retained for seven days by default and check metadata for 30 days; configuration rejects a
snapshot retention period longer than the associated check history.
