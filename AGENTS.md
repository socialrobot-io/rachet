# Working on Reflow

This repository contains a runnable TypeScript backend plus product specifications and tooling. Read README.md and the relevant docs before extending it. Verify CLI/MCP commands before reporting them as available. Backend implementation is TypeScript with Hono, Better Auth, Temporal, React Email, and a Resend adapter; Python scripts here only maintain the repository.

For operating Reflow, read `skills/reflow/SKILL.md`. For Resend, Temporal, or Better Auth implementation, install/load the official skills listed in `skills.lock.json` using `docs/SKILLS.md`. Treat upstream skills as implementation guidance; the user's requirements and Reflow's durable send/policy invariants determine product behavior.

Keep product operations equivalent across CLI and MCP using shared contracts. Configured OAuth, client-secret machine access, one-time admin setup, and default-disabled registration are required. Never implement an operator dashboard as a prerequisite. Keep secret handling out of model-visible content and preserve idempotency across retries.

Before finishing a repository change, run `make check`. Update README/docs when behavior or setup changes. Once runtime code exists, also run its typecheck, lint, tests, workflow replay checks, and affected integration checks. Passing documentation checks alone does not establish production readiness.
