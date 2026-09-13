# Integration research and decision notes

Official documentation consulted on 2026-09-13. These links establish vendor/protocol behavior. Product choices, capacity targets, schema examples, topology, and recovery policies are proposed Reflow requirements, not vendor guarantees. Exact package versions must be pinned and integration-tested during implementation.

| Source | Verified constraint / design implication |
|---|---|
| [Better Auth Hono integration](https://better-auth.com/docs/integrations/hono) | Mount the auth handler in Hono; account for CORS/trusted-origin configuration |
| [Better Auth API keys](https://better-auth.com/docs/plugins/api-key) | Supports managed keys including organization ownership; Reflow still enforces resource authorization |
| [Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider) | Machine grant support and user authorization are distinct; do not assume API keys implement the MCP OAuth flow |
| [MCP authorization, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) | HTTP resource discovery, scoped access, audience validation; client provisioning must match actual client support |
| [MCP transports, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) | STDIO and Streamable HTTP transport baseline; implementation must negotiate supported protocol versions |
| [React Email rendering](https://react.email/docs/utilities/render) | Render React email components to HTML and plain text |
| [React Email changelog](https://react.email/docs/changelog) | Package layout has evolved; use the selected release's documented imports, not remembered legacy package names |
| [Temporal self-hosting](https://docs.temporal.io/self-hosted-guide) | Production hosting includes security, visibility, monitoring, upgrades, and retention |
| [Temporal deployment](https://docs.temporal.io/self-hosted-guide/deployment) | Separate local development setup from production server deployment |
| [Temporal readiness checklist](https://docs.temporal.io/self-hosted-guide/production-checklist) | Production qualification requires operational evidence beyond container startup |
| [Temporal TypeScript messages](https://docs.temporal.io/develop/typescript/workflows/message-passing) | Signals, queries, and updates expose different workflow interaction semantics |
| [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys) | Provider dedupe retention is 24 hours; durable scheduling alone cannot guarantee safe retries indefinitely |
| [Resend webhook introduction](https://resend.com/docs/webhooks/introduction) | At-least-once and unordered delivery; use event IDs to dedupe |
| [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests) | Verify signatures using original request body bytes and signing metadata |
| [Resend event types](https://resend.com/docs/webhooks/event-types) | Delivery, engagement, inbound, domain/contact, and suppression events differ |
| [Resend webhook creation](https://www.resend.com/docs/api-reference/webhooks/create-webhook) | Webhook provisioning can be automated; returned signing secret must be protected |
| [Resend receiving](https://resend.com/docs/dashboard/receiving/introduction) | Inbound notification and full-content retrieval are separate capabilities |
| [Resend retries/replays](https://resend.com/docs/webhooks/retries-and-replays) | Provider retries are finite; retain our own verified inbox and replay mechanism |

## Important distinctions

- Configured OAuth human login and secret-based machine authentication are separate required flows. STDIO is an additional compatibility path.
- A Resend delivery event means acceptance by the recipient's mail server, not proof a human read the email.
- Temporal makes workflow progression durable. External email submission still has a transaction gap and bounded provider deduplication.
- A verified webhook is not necessarily correlated or processed yet; admission and application are separate durable stages.
- React Email supplies rendering, not an isolation guarantee for uploaded TSX.
- Docker Compose defines a deployment topology, not host redundancy or automatic disaster recovery.

The webhook overview and dedicated retries page can differ in the schedule details they display. Reflow intentionally does not hard-code an operational dependency on a particular retry count; internal inbox persistence, monitoring, and recovery remain necessary.

## Account lifecycle and skills additions

- [Better Auth generic OAuth](https://better-auth.com/docs/plugins/generic-oauth): configurable external OAuth/OIDC providers and callback handling.
- [Better Auth administration](https://better-auth.com/docs/plugins/admin): account administration building blocks; Reflow defines administrator scope and signup policy.
- [Better Auth email/password](https://better-auth.com/docs/authentication/email-password): password account and verification building blocks.
- [Official Resend skill](https://resend.com/docs/resend-skill) and [Temporal developer skill announcement](https://temporal.io/blog/introducing-temporal-developer-skill): requested development skills; pinned installation sources are in [skills.lock.json](../skills.lock.json).
- [Official Better Auth skills](https://better-auth.com/docs/ai-resources/skills): the requested six-skill pack, installed at the revision recorded in the same lock file.
