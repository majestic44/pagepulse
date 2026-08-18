# Codex Working Agreement

## Mission

Build PagePulse incrementally from `docs/IMPLEMENTATION_PLAN.md`. Preserve the documented service boundaries and security controls. Never implement CAPTCHA bypassing, secret logging, private-network webhooks, or unrestricted target fetching.

## Branch workflow

- Start feature branches from `development`.
- Open pull requests into `development`.
- Release PRs move reviewed work from `development` to `main`.
- Do not push directly to protected branches.
- Use Conventional Commits.

## Required checks

- Type checking and linting.
- API integration tests.
- Docker image builds for AMD64 and ARM64.
- Dependency vulnerability scanning.

## Engineering rules

- TypeScript strict mode remains enabled.
- Validate every boundary: environment variables, API input, queue payload, database result, webhook delivery, and fetched content.
- MariaDB is authoritative. Redis coordinates jobs but is never the sole record of a scheduled or completed check.
- Queue payloads contain IDs, never credentials, cookies, fetched private content, or webhook secrets.
- Authenticated page secrets are decrypted only inside the browser worker for the duration of a job.
- All outbound requests pass SSRF and redirect validation.
- Add a migration and rollback note for every schema change.
- Update OpenAPI, documentation, tests, and example configuration with behavior changes.
- Pin production container versions; never use `latest`.

## Definition of done

Implementation, tests, docs, migrations, health behavior, logging redaction, accessibility, and failure states are complete. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, and container builds pass.
