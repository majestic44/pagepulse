# Product Requirements

## Problem

People repeatedly inspect career pages, announcements, feeds, and authenticated portals for meaningful additions. Generic diff tools often generate noise, cannot handle rendered/login flows safely, and do not provide a clear review or notification workflow.

## Outcome

PagePulse lets an invited member define what matters on a page, checks it responsibly, presents an understandable before/after change, and delivers one actionable alert without duplicate noise.

## Primary journeys

1. Owner bootstraps PagePulse, configures delivery providers, and invites a member.
2. Member verifies email, sets password/theme/timezone/quiet hours, optionally enables TOTP, and sends a test alert.
3. Member creates a monitor, selects a source and target region, chooses a change rule and schedule, and verifies extraction.
4. For authenticated pages, member configures credentials and completes guided MFA/CAPTCHA authorization if required.
5. PagePulse checks the source, normalizes content, compares it, records a meaningful event, and alerts the member.
6. Member reviews previous/current content, marks an expected change, adjusts the rule, or ignores it.
7. Owner reviews queue health, paused/blocked monitors, delivery failures, and storage/retention status.

## MVP acceptance criteria

- Invitation-only accounts and owner/member authorization are enforced server-side.
- A member can create, test, pause, edit, resume, and delete a monitor.
- HTTP, JSON, RSS, and Chromium checks follow the documented scheduler and safety rules.
- No check interval can be shorter than one hour.
- The three rule families produce deterministic, tested results after normalization.
- Authentication/session material is encrypted and isolated from the API and queues.
- Blocked, failed, unchanged, changed, and recovered checks are visibly distinct.
- Alerts support immediate, quiet-hour, cooldown, digest, and recovery policies.
- Theme choice persists and all core flows meet WCAG 2.2 AA and keyboard requirements.
- PAT API permissions match UI authorization and every write supports idempotency.
- Retention jobs remove expired content without breaking audit/reference integrity.

## Explicit non-goals for v1

- Automated CAPTCHA solving or bypassing access controls.
- SMS, native mobile applications, multi-organization tenancy, billing, or public signup.
- PDF/image/OCR monitoring or pixel-level visual comparison.
- Check intervals below one hour.
- High-availability multi-host orchestration.

## Success measures

- 99% of eligible scheduled checks are started within five minutes of their due time.
- Fewer than 2% of alerts are duplicates after cooldown/identity processing.
- At least 95% of ordinary HTML checks use the lightweight fetch worker.
- No credentials or private page content appear in logs, queue payloads, exports, or diagnostics.
- A failed release restores the last healthy image set without database corruption.
