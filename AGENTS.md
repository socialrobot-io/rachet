# Working on Rachet

This repository contains a runnable TypeScript backend plus product specifications and tooling. Read README.md and the relevant docs before extending it. Verify CLI/MCP commands before reporting them as available. Backend implementation is TypeScript with Hono, Better Auth, Temporal, React Email, and a Resend adapter; Python scripts here only maintain the repository.

For operating Rachet, read `skills/reflow/SKILL.md`. For Resend, Temporal, or Better Auth implementation, install/load the official skills listed in `skills.lock.json` using `docs/SKILLS.md`. Treat upstream skills as implementation guidance; the user's requirements and Rachet's durable send/policy invariants determine product behavior.

Keep product operations equivalent across CLI and MCP using shared contracts. Configured OAuth, client-secret machine access, one-time admin setup, and default-disabled registration are required. Never implement an operator dashboard as a prerequisite. Keep secret handling out of model-visible content and preserve idempotency across retries.

## Writing

Follow [docs/WRITING.md](docs/WRITING.md) for all user-facing prose and documentation changes. Keep only information that helps the reader act, decide, stay safe, or solve a problem.

Before finishing a repository change, run `make check`. Update README/docs when behavior or setup changes. Once runtime code exists, also run its typecheck, lint, tests, workflow replay checks, and affected integration checks. Passing documentation checks alone does not establish production readiness.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
