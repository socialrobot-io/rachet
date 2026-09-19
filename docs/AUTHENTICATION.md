# Authentication and connected clients

Reflow uses Better Auth 1.7.4 for browser sessions, OAuth 2.1 authorization, API keys, and optional upstream OAuth/OIDC sign-in. The dashboard is the human login and consent surface. Product authorization is still enforced by Reflow workspace roles and operation scopes after Better Auth establishes identity.

## Initial administrator

Initial setup is a trusted deployment-host command, not a public route:

```sh
pnpm setup -- --email admin@example.com --name Admin --password-file /run/secrets/reflow_admin_password
```

It takes a PostgreSQL advisory lock, creates one deployment administrator and one initial workspace, and records an initialization marker. It cannot be used to reset an existing deployment. Keep the password file outside the repository and remove it after setup.

Later accounts are created with the authenticated `account.create` operation. `ALLOW_REGISTRATION=false` is the default. When registration is explicitly enabled, a new verified non-admin user gets a new isolated workspace as owner; registration never joins an existing tenant and its workspace starts with sending disabled.

## Dashboard sessions

The same-origin dashboard signs in at `/auth/login` with Better Auth's email/password flow. In production, email verification is required and verification mail uses the separately configured Resend credential. Cookies remain HTTP-only, SameSite, and secure on HTTPS deployments. CSRF and origin checks remain enabled, trusted origins are explicit, OAuth tokens stored for an upstream identity provider are encrypted, and authentication endpoints are rate limited in database-backed storage.

An optional upstream OAuth/OIDC provider can be configured with `OAUTH_PROVIDER_ID`, `OAUTH_DISCOVERY_URL`, `OAUTH_CLIENT_ID`, and `OAUTH_CLIENT_SECRET` (or its file variant). Reflow-issued access tokens—not upstream provider tokens—authorize Reflow operations.

## CLI login

`reflow auth login --url https://reflow.example.com` uses OAuth Authorization Code with PKCE:

1. The CLI binds an ephemeral callback on `127.0.0.1`.
2. It registers a native public client and creates a verifier, S256 challenge, and state value.
3. It opens the Reflow dashboard authorization page (or prints the URL with `--no-open`).
4. The user signs in and explicitly approves the requested scopes.
5. The callback validates state, exchanges the short-lived code, and stores the resulting short-lived access token plus rotating refresh token.

The CLI configuration is mode `0600` under `${XDG_CONFIG_HOME:-~/.config}/reflow/config.json`. Passwords and dashboard session cookies are never copied into it. Expired access tokens are refreshed before an operation; a failed or revoked refresh requires a new login. `REFLOW_TOKEN`, `REFLOW_API_KEY`, and `REFLOW_WORKSPACE_ID` remain process-local automation overrides.

The published CLI intentionally does not expose a generic `/api/auth/*` proxy. Account creation and credential administration use named Reflow operations with their normal authorization checks.

## MCP and dynamic client registration

HTTP MCP is an OAuth protected resource at `/mcp`. Reflow publishes protected-resource, OAuth authorization-server, and OpenID discovery metadata. Public MCP clients use PKCE and the same dashboard login/consent pages as the CLI.

Unauthenticated dynamic registration is limited to public clients (`token_endpoint_auth_method=none`) and rejects client credentials. Redirects are limited to loopback HTTP, native schemes explicitly listed in `OAUTH_PUBLIC_REDIRECT_SCHEMES` (default: `cursor`), and exact HTTPS origins listed in `OAUTH_PUBLIC_REDIRECT_ORIGINS`. Every dynamically registered client requires consent; there is no consent bypass.

The dashboard's **Connected apps** page lists grants for the signed-in user and revokes them. Revocation removes the consent so the client must authorize again. The one-time secret returned by `credential.create` is deliberately excluded from the MCP tool catalog and its resource listing, preventing an agent transcript from becoming credential storage.

## Machine access and stdio

Non-interactive systems use a scoped user-bound API key or an administrator-provisioned confidential OAuth client. Credentials belong in a secret manager or protected environment/file, never command arguments, prompts, or logs. Reflow intersects credential scopes with current workspace membership and role checks on every operation.

See [Sending product events](EVENTS.md) for a complete scoped API-key and HTTP integration example.

The stdio MCP bridge is a trusted, single-user host adapter. It refuses to start unless both `REFLOW_STDIO_TRUSTED_HOST=true` and `REFLOW_ACTOR_USER_ID` are set. Do not expose it through a shared service or remote transport; use authenticated HTTP MCP instead.

## Scope and role enforcement

Browser sessions derive coarse scopes from current roles:

- any workspace membership grants `reflow:read`;
- owner, admin, author, or operator grants `reflow:write`;
- owner, admin, or sender grants `reflow:send`;
- deployment administrators receive all three.

OAuth and API-key scopes can only narrow that set. Each operation also checks the role against the target workspace, so a workspace identifier in request input never grants access.

## Redirect and deployment checklist

- Use HTTPS for `PUBLIC_URL` and every trusted origin in production.
- Keep `BETTER_AUTH_SECRET` high-entropy and at least 32 characters.
- Leave `ALLOW_REGISTRATION=false` unless public account creation is intentional.
- Keep `OAUTH_PUBLIC_REDIRECT_ORIGINS` empty unless a known web MCP client requires an HTTPS callback. Cursor currently requires the exact `https://www.cursor.com` origin.
- Keep `OAUTH_PUBLIC_REDIRECT_SCHEMES` limited to installed native MCP clients that own those URI schemes.
- Verify the dashboard login, consent, deny, refresh, logout, and Connected apps revocation paths.
- Verify at least one intended MCP client through discovery, registration, PKCE, consent, and tool invocation.
- Configure npm trusted publishing separately; npm credentials are unrelated to Reflow runtime authentication.
