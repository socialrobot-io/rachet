# Contributing

The repository is at specification stage. The backend will use TypeScript; current Python utilities perform offline repository checks and skill installation only. Git, Python 3.9+, and Make are sufficient for the current checks. No email credentials, database, Temporal server, or network access are required.

```sh
make check
```

This validates required documentation, local Markdown file links and code fences, JSON syntax/duplicate keys, example graph references/reachability/cycles, first-party skill metadata, pinned upstream skill revisions, whitespace/conflict markers, and accidental inclusion of private runtime directories. Unit tests verify rejection of malformed graphs/links/JSON and protect existing skill installations against overwrite. These checks do not constitute a general secret scanner or runtime JSON Schema validator.

CI runs the same command. Once backend code exists, add shared-contract/schema validation, typecheck, lint, unit/integration tests, Temporal history replay, CLI/MCP parity, auth policy tests, and production image/Compose checks. Do not add empty checks that succeed without testing runtime behavior.

Update [README](README.md), [PRD](docs/PRD.md), [architecture](docs/ARCHITECTURE.md), [authentication](docs/AUTHENTICATION.md), [operation catalog](docs/OPERATIONS.md), and the [agent skill](skills/reflow/SKILL.md) when their behavior changes. Mark commands as proposed until implemented. Keep changes focused and explain the affected behavior and validation in the commit/PR description.

Install the official implementation skills and first-party interaction skill using [skill setup](docs/SKILLS.md). Review upstream changes before advancing their pinned revisions. Do not commit `.env`, credentials, message bodies from real recipients, or production exports.
