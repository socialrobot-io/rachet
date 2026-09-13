# Reflow — Social Robot email sequences

An agent-first email sequence engine, operated through MCP and CLI. Planned stack: TypeScript, Hono, Better Auth, Temporal, PostgreSQL, React Email, and Resend, deployed with Docker Compose.

**Status: specification draft.** This repository contains the product requirements and engineering design. It does not yet contain a runnable backend or production deployment.

- [Product requirements](docs/PRD.md): scope, workflows, behavior, release criteria, and delivery plan.
- [Architecture](docs/ARCHITECTURE.md): modules, consistency, durable execution, authentication, and deployment.
- [Operation catalog](docs/OPERATIONS.md): MCP and CLI parity requirements.
- [Authentication](docs/AUTHENTICATION.md): configured OAuth, client secrets, initial admin, and optional registration.
- [Agent skills](docs/SKILLS.md): pinned official development skills and the installable Reflow interaction skill.
- [Example sequence](examples/onboarding.sequence.json): illustrative versioned sequence definition.
- [Research notes](docs/SOURCES.md): official documentation and integration constraints.

Reflow is the working repository name; Social Robot is the integrating product. All commands and contracts in these documents describe the proposed implementation.

## Repository checks

Requires Git, Python 3.9+, and Make. No dependencies or credentials are needed:

```sh
make check
```

CI runs the same offline checks. See [contributing](CONTRIBUTING.md) for their scope and the runtime checks required as implementation is added.

## Install the Reflow agent skill

```sh
python3 scripts/install_reflow_skill.py
```

This installs the repository's interaction skill into your Codex skills directory without overwriting modified content. For the official Resend, Temporal, and Better Auth implementation skills, see [skill setup](docs/SKILLS.md).

## Required authentication behavior

Initial setup creates an administrator. Administrators create and manage accounts through CLI/MCP. Self-registration is disabled by default and available through CLI/MCP only when `ALLOW_REGISTRATION=true`. Configured OAuth supports human login; scoped client ID/secret authentication lets application servers and agents trigger flows without a browser. These are v1 requirements, not implemented features in this specification repository.
