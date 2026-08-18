# ADR 0003: Envelope Encryption for Monitored-Site Secrets

- Status: Accepted
- Date: 2026-08-18

## Decision

Encrypt each credential/session record with a random data key and AES-256-GCM. Wrap data keys with versioned master keys supplied by Infisical. Decrypt only inside the browser worker for an active job.

## Consequences

Key rotation can rewrap data keys. Queue/API/log layers never handle plaintext secrets. Infisical recovery and PagePulse encrypted database backups are both required for disaster recovery.
