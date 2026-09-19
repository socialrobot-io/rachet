# Releasing the CLI

The publishable npm package lives in `packages/cli`. The repository root, server, dashboard, and internal contracts package are private workspace projects and are not included in the CLI tarball.

The public package name is `@socialrobot-io/reflow`. The package is licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`).

## One-time npm setup

1. Ensure the `@socialrobot-io` npm organization and package publishing permissions are configured.
2. Configure npm trusted publishing for this GitHub repository and the workflow file `.github/workflows/release.yml`.
3. Protect the GitHub Environment named `npm` if release approvals are required.

The workflow uses GitHub OIDC and npm provenance. It does not require a long-lived `NPM_TOKEN` secret.

## Release procedure

1. Update `packages/cli/package.json` to the release version.
2. Run `make check` from a clean checkout.
3. Inspect the dry-run tarball output and confirm that only the compiled CLI, its README, and package metadata are present.
4. Create and push a tag named `v<version>` matching the package version exactly.

The release workflow repeats the full check, verifies the tag/version match, and publishes from `packages/cli` with public access and provenance.

Do not publish the repository root with `npm publish`; it is intentionally private.
