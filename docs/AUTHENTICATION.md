# Authentication and connected clients

Rachet uses Better Auth 1.7.4 for browser sessions, OAuth 2.1 authorization, API keys, and optional upstream OAuth/OIDC sign-in. The dashboard is the human login and consent surface. Product authorization is still enforced by Rachet workspace roles and operation scopes after Better Auth establishes identity.

## Initial administrator

When the database contains no users, `/auth/login` becomes the one-time administrator registration page. It requires `REFLOW_SETUP_SECRET`, plus the administrator name, email, and organization name. The secret is compared without exposing it in URLs or logs. Database locking and constraints ensure concurrent attempts can create only one deployment administrator. The user, profile, immutable default organization, owner membership, and initialization marker are provisioned in the same database transaction.

Later account invitations are authorized with the authenticated `account.create` operation. `ALLOW_REGISTRATION=false` is the default. When registration is explicitly enabled, a new verified non-admin user gets a new isolated organization as owner. The current product exposes exactly that default organization and has no create/switch organization flow.

## Dashboard sessions

The same-origin dashboard signs in at `/auth/login` using a single-use magic link or GitHub. Password authentication is disabled. Magic links expire after 10 minutes, are stored hashed, and require both `AUTH_RESEND_API_KEY` and an explicit `AUTH_EMAIL_FROM` sender on a domain verified in that authentication Resend account. This deployment-level authentication account must be separate from every organization's workflow-delivery account. No placeholder sender is used; the login page hides magic links and shows a configuration warning if the key is set without a sender. Unknown or unauthorized addresses receive the same generic response and no email. GitHub never asks for an email before OAuth: an authorized registration intent is carried in Better Auth's server-owned OAuth state and bound to the provider's verified email during the callback.

Cookies remain HTTP-only, SameSite, and secure on HTTPS deployments. CSRF and origin checks remain enabled, trusted origins are explicit, OAuth tokens are encrypted at rest, and authentication endpoints are rate limited in database-backed storage.

An optional upstream OAuth/OIDC provider can be configured with `OAUTH_PROVIDER_ID`, `OAUTH_DISCOVERY_URL`, `OAUTH_CLIENT_ID`, and `OAUTH_CLIENT_SECRET` (or its file variant). Rachet-issued access tokens—not upstream provider tokens—authorize Rachet operations.

## CLI login

`rachet auth login --url https://rachet.example.com` uses OAuth Authorization Code with PKCE:

1. The CLI binds an ephemeral callback on `127.0.0.1`.
2. It registers a native public client and creates a verifier, S256 challenge, and state value.
3. It opens the Rachet dashboard authorization page (or prints the URL with `--no-open`).
4. The user signs in and explicitly approves the requested scopes.
5. The callback validates state, exchanges the short-lived code, and stores the resulting short-lived access token plus rotating refresh token.

The CLI configuration is mode `0600` under `${XDG_CONFIG_HOME:-~/.config}/reflow/config.json`. Passwords and dashboard session cookies are never copied into it. Expired access tokens are refreshed before an operation; a failed or revoked refresh requires a new login. `REFLOW_TOKEN`, `REFLOW_API_KEY`, and `REFLOW_WORKSPACE_ID` remain process-local automation overrides.

The published CLI intentionally does not expose a generic `/api/auth/*` proxy. Account creation and credential administration use named Rachet operations with their normal authorization checks.

## MCP and dynamic client registration

HTTP MCP is an OAuth protected resource at `/mcp`. Rachet publishes protected-resource, OAuth authorization-server, and OpenID discovery metadata. Public MCP clients use PKCE and the same dashboard login/consent pages as the CLI.

Unauthenticated dynamic registration is limited to public clients (`token_endpoint_auth_method=none`) and rejects client credentials. Redirects are limited to loopback HTTP, native schemes explicitly listed in `OAUTH_PUBLIC_REDIRECT_SCHEMES` (default: `cursor`), and exact HTTPS origins listed in `OAUTH_PUBLIC_REDIRECT_ORIGINS`. Every dynamically registered client requires consent; there is no consent bypass.

The dashboard's **Connected apps** page lists grants for the signed-in user and revokes them. The **API keys** page creates, lists, and revokes SDK credentials. A key is shown once, stored hashed, limited to the user's immutable organization and selected scopes, and never returned by list operations. Secret-returning `credential.create` is excluded from the MCP tool catalog and its resource listing.

Cursor starts OAuth with the standard `profile` scope. Rachet accepts it only to complete identity setup. Reading, changing, publishing, and sending through MCP still require the matching `rachet:read`, `rachet:write`, or `rachet:send` scope.

The MCP resource's allowed scopes are stored in the database. On startup, Rachet updates that resource from its configured scope list, including when an existing deployment moves from `reflow:*` to `rachet:*`. Redeploy after a scope change so the stored policy is updated.

After first sign-in, an organization owner is directed to **Integrations**, where they can choose Resend (Webhooks and Push are marked coming soon). They can skip setup to build and simulate, but cannot send workflow email until an owner or admin saves that organization's sender, API key, and webhook signing secret and Resend accepts a test email. These integration secrets are encrypted with `INTEGRATION_ENCRYPTION_KEY`; they are managed only through authenticated browser endpoints and are never returned by status, CLI, or MCP operations. The Integrations page remains available for rotation.

## Machine access and stdio

Non-interactive systems use a scoped organization-bound API key or an administrator-provisioned confidential OAuth client. Credentials belong in a secret manager or protected environment/file, never command arguments, prompts, or logs. Rachet intersects credential scopes with current organization membership and role checks on every operation.

The published `@socialrobot-io/rachet-sdk` uses the same `/v1/operations` contract for UI server actions. Give it a `send`-scoped API key and keep that key on the server; do not embed it in browser JavaScript. Add the UI origin to `TRUSTED_ORIGINS` when the UI calls Rachet directly from a browser, although a server-side action/proxy is recommended.

See [Sending product events](EVENTS.md) for a complete scoped API-key and HTTP integration example.

The stdio MCP bridge is a trusted, single-user host adapter. It refuses to start unless both `REFLOW_STDIO_TRUSTED_HOST=true` and `REFLOW_ACTOR_USER_ID` are set. Do not expose it through a shared service or remote transport; use authenticated HTTP MCP instead.

## Scope and role enforcement

Browser sessions derive coarse scopes from current roles:

- any workspace membership grants `rachet:read`;
- owner, admin, author, or operator grants `rachet:write`;
- owner, admin, or sender grants `rachet:send`;
- deployment administrators receive all three.

OAuth and API-key scopes can only narrow that set. Each operation also checks the role against the target workspace, so a workspace identifier in request input never grants access.

## Redirect and deployment checklist

- Use HTTPS for `PUBLIC_URL` and every trusted origin in production.
- Keep `BETTER_AUTH_SECRET` high-entropy and at least 32 characters.
- Keep `REFLOW_SETUP_SECRET` high-entropy and at least 32 characters; rotate or remove access to it after initialization.
- Use a dedicated Resend account/key for `AUTH_RESEND_API_KEY`; do not reuse workflow delivery credentials. Set `AUTH_EMAIL_FROM` to a sender on a domain verified in that account.
- Leave `ALLOW_REGISTRATION=false` unless public account creation is intentional.
- Keep `OAUTH_PUBLIC_REDIRECT_ORIGINS` empty unless a known web MCP client requires an HTTPS callback. Cursor currently requires the exact `https://www.cursor.com` origin.
- Keep `OAUTH_PUBLIC_REDIRECT_SCHEMES` limited to installed native MCP clients that own those URI schemes.
- Verify the dashboard login, consent, deny, refresh, logout, and Connected apps revocation paths.
- Verify at least one intended MCP client through discovery, registration, PKCE, consent, and tool invocation.
- Configure npm trusted publishing separately; npm credentials are unrelated to Rachet runtime authentication.
