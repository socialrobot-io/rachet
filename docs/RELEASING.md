# Releasing npm packages

Two public packages ship from this repository:

| Package | Path | Role |
| --- | --- | --- |
| `@socialrobot-io/rachet` | `packages/cli` | CLI |
| `@socialrobot-io/rachet-sdk` | `packages/sdk` | Server-side SDK for UI backends |

Both are licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). The repository root, server, dashboard, and internal packages stay private and are not published.

## One-time npm setup

1. Ensure the `@socialrobot-io` npm organization and package publishing permissions are configured.
2. Configure npm trusted publishing for this GitHub repository and the workflow file `.github/workflows/release.yml` for both `@socialrobot-io/rachet` and `@socialrobot-io/rachet-sdk`.
3. Protect the GitHub Environment named `npm` if release approvals are required.

The workflow uses GitHub OIDC and npm provenance. It does not require a long-lived `NPM_TOKEN` secret. The new packages ship only Rachet names and commands. Keep the old `@socialrobot-io/reflow` registry entries only long enough to publish a deprecation message after the first Rachet release.

## Branch flow

`next` collects reviewed, runnable work. Open feature and fix PRs into `next`; CI checks each PR. Keep `main` at the released state. When ready to release, open a PR from `next` to `main` and merge it with a merge commit. Do not squash that promotion PR: the shared ancestry keeps the next promotion focused on new work.

For an urgent production fix, open a `hotfix/*` PR into `main`. Merge `main` back into `next` after the fix lands. Do not tag a commit on `next`; the release workflow accepts tags only on commits reachable from `main`.

The `next` and `main` branches require a PR and the repository sanity check. PRs into `main` also require the release branch-flow check, which accepts only `next` and `hotfix/*` from this repository. Nx uses `next` as the default base for affected commands; pass `--base=main` when comparing a release PR with `main`.

## Release procedure

1. On `next`, update `packages/cli/package.json` to the release version. The git tag must match that CLI version (`v0.2.3` for CLI `0.2.3`). Set `packages/sdk/package.json` to the SDK version to publish in the same release; it may differ from the CLI version.
2. Add `docs/releases/v<cli-version>.md` using [the template](releases/TEMPLATE.md). Write one to five short points about verified user-visible changes or required upgrade steps. Check each point against the release diff. The file is the exact GitHub Release body; no commit or PR list is appended automatically.
3. Run `make check` from a clean checkout. Inspect the dry-run tarballs and confirm they contain only compiled output, README, LICENSE, and package metadata.
4. Open the release PR from `next` to `main`. Review the version changes, notes, migrations, and deployment effect. Merge with a merge commit after required checks pass.
5. On the resulting `main` commit, create and push `v<cli-version>`. The release workflow rejects a tag outside `main`, a mismatched CLI version, or missing notes.

The release workflow runs the full check, rebuilds the CLI without Nx cache, verifies its publish artifact, publishes package versions that are not already in npm with public access and provenance, and creates the GitHub Release from the reviewed notes file.

After the first successful Rachet publish, deprecate the old names from an authenticated npm session:

```sh
npm deprecate @socialrobot-io/reflow "This package moved to @socialrobot-io/rachet. Install the Rachet package instead."
npm deprecate @socialrobot-io/reflow-sdk "This package moved to @socialrobot-io/rachet-sdk. Install the Rachet SDK instead."
```

Do not add compatibility exports or a `reflow` executable to the new packages. Deprecating the old registry entries is separate from runtime compatibility and lets npm show the migration message to anyone who tries to install an old name.

Do not publish the repository root with `npm publish`; it is intentionally private.
