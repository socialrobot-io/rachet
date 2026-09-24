# Contributing

Rachet is an Nx TypeScript workspace containing a Hono API, Better Auth, Temporal workers, a React dashboard, shared contracts, and the published CLI. Python utilities only maintain repository metadata and the first-party skill.

Install Node.js 22+, pnpm 11+, Docker Compose, and Python 3.9+. Start the complete local stack with `pnpm dev`; it provisions development infrastructure, migrates the database, performs first-admin setup when needed, and runs the API, worker, dispatcher, and dashboard.

```sh
make check
```

This validates documentation and examples, linting, shared contracts, typechecks, backend and dashboard tests, Temporal execution and replay, production builds, Compose configuration, and the CLI package contents. It does not constitute a general secret scanner.

CI runs the same command from a clean checkout. Add regression coverage for every runtime bug and keep CLI/MCP behavior on the shared operation contract. Do not add empty checks that succeed without testing runtime behavior.

Update [README](README.md), [PRD](docs/PRD.md), [architecture](docs/ARCHITECTURE.md), [authentication](docs/AUTHENTICATION.md), [operation catalog](docs/OPERATIONS.md), [event guide](docs/EVENTS.md), and the [agent skill](skills/reflow/SKILL.md) when their behavior changes. Verify every documented CLI/MCP command before reporting it as available. Keep changes focused and explain the affected behavior and validation in the commit/PR description.

Follow the [writing guide](docs/WRITING.md) for documentation and user-facing copy.

Install the official implementation skills and first-party interaction skill using [skill setup](docs/SKILLS.md). Review upstream changes before advancing their pinned revisions. Do not commit `.env`, credentials, message bodies from real recipients, or production exports.
