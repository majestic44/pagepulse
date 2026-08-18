# Recommended GitHub Repository Settings

## General

- Default branch initially `main`; create `development` immediately after the foundation commit.
- Enable squash merge; disable merge commits; optionally keep rebase merge.
- Enable automatically delete head branches and update-branch support.
- Enable private vulnerability reporting and Dependabot alerts/security updates.

## `main` ruleset

- Require pull requests with zero approvals for a sole maintainer.
- Require successful checks, conversation resolution and branch up to date.
- Required checks: `Typecheck, lint and unit tests`, `API integration tests`, `Dependency vulnerability review`, and all Docker build matrix checks.
- Block direct pushes, deletions and force pushes; apply to administrators.
- Allow only release PRs from `development` or the release automation workflow by convention.

## `development` ruleset

- Require pull requests from feature branches.
- Require the same checks, conversation resolution and up-to-date branch.
- Block deletions and force pushes; apply to administrators.

## Tags

Protect `v*.*.*` from deletion and modification. Release automation is the only expected tag creator.
