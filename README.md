# Reflow — Social Robot email sequences

An agent-first email sequence engine, operated through MCP and CLI. Planned stack: TypeScript, Hono, Better Auth, Temporal, PostgreSQL, React Email, and Resend, deployed with Docker Compose.

**Status: specification draft.** This repository contains the product requirements and engineering design. It does not yet contain a runnable backend or production deployment.

- [Product requirements](docs/PRD.md): scope, workflows, behavior, release criteria, and delivery plan.
- [Architecture](docs/ARCHITECTURE.md): modules, consistency, durable execution, authentication, and deployment.
- [Operation catalog](docs/OPERATIONS.md): MCP and CLI parity requirements.
- [Example sequence](examples/onboarding.sequence.json): illustrative versioned sequence definition.
- [Research notes](docs/SOURCES.md): official documentation and integration constraints.

Reflow is the working repository name; Social Robot is the integrating product. All commands and contracts in these documents describe the proposed implementation.
