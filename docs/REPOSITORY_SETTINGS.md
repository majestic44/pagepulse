# GitHub Repository Settings and Rulesets

This is the intended configuration for PagePulse. Configure it in **Settings → General**, **Settings → Branches → Rulesets**, **Settings → Security → Advanced Security**, and **Settings → Actions → General**. It uses GitHub's ruleset controls rather than the legacy branch-protection screen.

Rulesets layer together: if several rulesets (or a legacy protection rule) target a ref, GitHub applies every rule and uses the most restrictive compatible setting. Do not create overlapping legacy branch-protection rules for `main` or `development`; remove or deliberately reconcile them first.

## Repository-wide settings

| GitHub setting                                | Value                                                                                                             | Why                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Default branch                                | `main`                                                                                                            | Production/release branch. Create `development` from the foundation commit. |
| Merge methods                                 | Enable **Squash merging**; disable **Merge commits**; leave **Rebase merging** disabled unless explicitly adopted | Matches linear history and keeps release history readable.                  |
| Automatically delete head branches            | Enabled                                                                                                           | Removes merged feature branches.                                            |
| Always suggest updating pull request branches | Enabled                                                                                                           | Helps contributors satisfy strict checks.                                   |
| Allow auto-merge                              | Disabled until merge-queue ownership is established                                                               | Enable only when required checks are trustworthy.                           |
| Private vulnerability reporting               | Enabled                                                                                                           | Lets researchers report security issues privately.                          |
| Dependabot alerts and security updates        | Enabled                                                                                                           | Alerts and proposes fixes for vulnerable dependencies.                      |
| Actions permissions                           | **Read repository contents permission**; do not let Actions create or approve PRs                                 | CI needs read-only source access.                                           |
| Fork pull-request workflows                   | Do not expose repository secrets to workflows from forks                                                          | Prevents untrusted code from receiving secrets.                             |

Use repository environments and required reviewers for deployment credentials. Never put deployment, webhook, database, browser-session, or encryption secrets in repository variables, logs, or CI fixtures.

## Ruleset conventions

Create three **branch/tag rulesets**, all with enforcement status **Active**:

| Ruleset name           | Target                       | Bypass list                                                                                                   | Purpose                                       |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `Protect main`         | Include branch `main`        | Empty. Add a named break-glass maintainer only with a documented incident procedure, using **Always** bypass. | Production changes flow through a release PR. |
| `Protect development`  | Include branch `development` | Empty.                                                                                                        | Feature work flows through PRs and CI.        |
| `Protect release tags` | Include tag `v*.*.*`         | The release GitHub App/workflow only, if GitHub requires a bypass for tag creation.                           | Release tags remain immutable.                |

GitHub supports bypasses for repository roles, teams, GitHub Apps, and Dependabot. A bypass can be **Always** or **For pull requests only**. Do not grant broad `Repository administrators`, `Maintain`, or `Write` bypasses. If automation needs one, grant the specific app and record its rationale and removal owner.

Branch patterns use GitHub `fnmatch` syntax. `main` and `development` are exact patterns; do not use `*` for a protected production target. Verify GitHub's ruleset evaluation result before activating a change.

## `Protect main`

### Target and history controls

- Target branches: include `main` only.
- Enable **Restrict deletions** and **Block force pushes**.
- Enable **Require linear history**. This requires squash or rebase merging to stay enabled repository-wide; PagePulse uses squash merges.
- Do not enable **Restrict creations** or **Restrict updates** here. The pull-request rule prevents direct changes; update restrictions are for limiting writers and can block normal merge/release automation.
- Do not enable **Require signed commits** until every maintainer and release automation path has been verified to sign commits.

### Pull requests

Enable **Require a pull request before merging** with these additional settings:

- Required approvals: `0` while PagePulse has a sole maintainer. Raise this to `1` before granting another person merge rights.
- Require review from Code Owners: disabled while the sole maintainer owns `*` in `.github/CODEOWNERS`; enable when a non-author code-owner review can be required.
- Dismiss stale approvals and require approval of the most recent reviewable push: enable both when approvals become required.
- Require conversation resolution before merging: enabled.
- Allowed merge methods: **Squash** only.

Do not configure a merge queue yet. It needs a dedicated queue-aware CI workflow and operational ownership. If enabled later, document its check names and deployment behavior here before making it required.

### Required CI status checks

Enable **Require status checks to pass before merging** and **Require branches to be up to date before merging**. Select each check only after it has reported from the repository's GitHub Actions workflow; set the expected source to **GitHub Actions** where GitHub offers that picker.

Require the following checks from [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

- `Typecheck, lint and unit tests`
- `API integration tests`
- `Dependency vulnerability review`
- `Dependency vulnerability scan`
- Each `Docker image builds` matrix result: `web`, `api`, `fetch-worker`, `browser-worker`, and `control-worker` (copy the exact names GitHub displays, normally `Docker image builds (name)`).

Do not require a check that does not run for PRs to `main`; a skipped or renamed check blocks merges. Docker CI validates both `linux/amd64` and `linux/arm64` in each matrix job. CodeQL default setup is configured separately in GitHub; require its result only after it has reported consistently for pull requests.

### Optional GitHub Advanced Security controls

If the repository plan and features are enabled, configure these as separate controls after their workflows have produced baseline results:

- **Require code scanning results**: require the approved scanner and block at the agreed severity threshold.
- **Require code quality results** and **Restrict code coverage**: wait for a stable coverage upload and documented threshold; these can be plan-dependent or in preview.
- **Require deployments to succeed before merging**: do not use production as a PR merge gate. A dedicated secret-free staging environment is required first.

## `Protect development`

Apply the same target/history controls, PR settings, and CI checks as `Protect main`, except that `development` is the sole included branch. Feature branches open PRs into `development`.

Release PRs flow from `development` into `main`. GitHub rulesets do not natively restrict a PR's head branch to a particular name, so enforce that convention in the release PR workflow or a dedicated validation check.

## `Protect release tags`

Target tags with the include pattern `v*.*.*`. Enable:

- **Restrict deletions**
- **Block force pushes**
- **Restrict updates**, so an existing release tag cannot be moved

Do not enable **Restrict creations** unless the identified release GitHub App is on the bypass list; otherwise it prevents the release workflow from creating tags. Release tags are created only after the release PR into `main` passes its required checks.

## Push rulesets: deliberately not enabled by default

GitHub push rulesets can restrict paths, path length, extensions, file size, commit metadata, and branch names across a private/internal repository's fork network. They are useful for carefully tested secret-file or large-artifact policy, but are not a replacement for secret scanning and can affect forks. Do not add one until its target patterns, bypass effect, and developer impact are reviewed. Never use it to permit credentials, private fetched content, cookies, or webhook secrets.

## Validation checklist

After changing settings, verify with a disposable feature branch and a draft PR:

1. A direct push, force push, and deletion of `main` and `development` are denied.
2. A PR cannot merge while a required check is pending, failing, missing, or stale against the base branch.
3. A PR cannot merge with an unresolved review thread.
4. A successful PR merges only by squash and leaves no merge commit on the protected branch.
5. The release workflow can create a new `vX.Y.Z` tag, but no user can update or delete it.
6. The ruleset evaluation view shows only the intended active rulesets; no legacy branch protection or organization rule adds an unexpected requirement.

Document every exception, bypass, or temporarily disabled required check in its PR. Make production ruleset changes through a PR into `development`, test them, and release them to `main` like any other operational change.
