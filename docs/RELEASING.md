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

## Release procedure

1. Update `packages/cli/package.json` to the release version. The git tag must match that CLI version (`v0.1.3` for CLI `0.1.3`).
2. Set `packages/sdk/package.json` to the SDK version you want published in the same release (independent of the CLI version when needed).
3. Run `make check` from a clean checkout.
4. Inspect dry-run tarballs and confirm each package only contains its compiled output, README, LICENSE, and package metadata.
5. Create and push a tag named `v<cli-version>`.

The release workflow runs the full check, verifies the tag matches the CLI version, publishes both packages with public access and provenance, and creates the matching GitHub Release with generated notes.

After the first successful Rachet publish, deprecate the old names from an authenticated npm session:

```sh
npm deprecate @socialrobot-io/reflow "This package moved to @socialrobot-io/rachet. Install the Rachet package instead."
npm deprecate @socialrobot-io/reflow-sdk "This package moved to @socialrobot-io/rachet-sdk. Install the Rachet SDK instead."
```

Do not add compatibility exports or a `reflow` executable to the new packages. Deprecating the old registry entries is separate from runtime compatibility and lets npm show the migration message to anyone who tries to install an old name.

Do not publish the repository root with `npm publish`; it is intentionally private.
