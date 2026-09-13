# Authentication and account provisioning

Status: required v1 behavior; not yet implemented. This document replaces the earlier draft's deferred OAuth assumption. Every product/account operation is exposed through CLI and MCP. The external identity provider may present its own login/consent screen; Reflow requires no operator UI.

## Initial setup and administrators

`reflow setup` is a local host CLI operation invoked by the initial Compose setup job. It creates a deployment administrator, initial workspace, and bootstrap-completed marker in one locked database transaction. Concurrent attempts create at most one initial administrator. Re-running setup reports completion and never resets a password or issues a new admin credential.

Provision a bootstrap password from a protected secret file or pre-bind a configured OIDC identity by issuer and immutable subject. No default password, public setup route, or first-visitor-becomes-admin behavior. Setup writes one-time credentials only to a protected output file. Remove bootstrap secret mounts after successful setup. Authentication email delivery must be available independently of user campaign enrollment when password verification/reset is enabled.

Deployment administrators can create normal accounts or other deployment administrators through `account.create` and `account.set_role`. Workspace administrators can manage only authorized workspace membership and workspace client credentials. A transaction prevents removing, disabling, or demoting the last enabled deployment administrator. Account disablement revokes sessions and blocks new tokens/commands; suspending active workflows is a separate explicit action.

Admin-created accounts receive a one-time activation credential or an explicit issuer/subject binding. Activation credentials expire, are single-use, and require setting a password before normal use. No invitation email is silently sent by account creation. Administrators may deliver credentials through their own authorized channel.

## Registration policy

`ALLOW_REGISTRATION=false` is the default deployment setting. Store the effective policy centrally and expose it through `registration_policy.get`. An administrator may update the persisted setting through either interface unless the deployment environment explicitly locks it. Return `POLICY_LOCKED` for attempted overrides; expose the source and effective revision to administrators. A supplied environment value takes precedence over the persisted value; when neither exists, use false. Restarting does not silently reset a persisted administrator choice.

| Path | Disabled | Enabled |
|---|---|---|
| CLI/MCP password registration | `REGISTRATION_DISABLED` | Create pending-verification non-admin account |
| First-time OAuth identity | Reject unless explicitly pre-provisioned | Create non-admin account after verified identity policy |
| Existing password/OAuth account login | Allowed subject to normal checks | Allowed subject to normal checks |
| Administrator account creation | Allowed with deployment-admin scope | Allowed with deployment-admin scope |
| Direct Better Auth signup endpoint | Same disabled check | Same validation and non-admin defaults |

Users cannot request their own deployment role, privileged scopes, workspace membership, or verified-email status in registration input. Self-registration creates an isolated workspace with the new user as workspace owner, **not** a deployment administrator. Sending remains disabled until ownership verification and administrator sending activation; registration alone must not turn a public endpoint into an unrestricted mail relay. Admin-created memberships can use an existing workspace.

Password registration is usable through CLI (`reflow auth register`) or the unauthenticated auth-only MCP tool surface. Accept passwords through stdin/protected client storage rather than shell arguments or agent conversation text. The stdio bridge can resolve a local secret reference without returning its bytes to the model. HTTP clients must use secure credential entry/transport; do not expose a general server-file-read tool.

Verification and password reset use single-use expiring challenges completed through CLI/MCP. Challenge start responses avoid account enumeration. Apply authentication-specific rate limits; public auth operations do not gain product scopes. Verify provider email claims before using them as email ownership evidence.

## Configured human OAuth/OIDC

Administrators configure provider ID, issuer/discovery URL or explicit endpoints, client ID, client-secret reference, scopes, and allowed redirect/origin settings. Better Auth's generic OAuth integration supplies external provider support. [Official integration](https://better-auth.com/docs/plugins/generic-oauth).

1. CLI/MCP starts a login challenge with a provider ID and client-bound verifier. Return challenge ID, authorization URL, expiry, and polling interval.
2. User authenticates at the configured provider. CLI can open that URL or print it for another device; this is an identity-provider interaction, not a Reflow dashboard.
3. Backend validates state, PKCE, issuer, audience, nonce when applicable, and exact callback destination. It resolves the external identity and applies registration policy before creating an account.
4. CLI/MCP completes or polls the challenge using the original verifier. A successful callback alone never releases credentials to an unauthenticated caller knowing only the challenge ID. Expired/reused/mismatched challenges fail.
5. Store resulting Reflow credentials in protected client storage. Return identity/scopes to the caller; keep tokens out of ordinary tool results and logs where client credential plumbing supports it.

Bind accounts by provider/issuer and immutable subject. Do not auto-link a new provider identity merely because its email matches an administrator. Existing users link identities after reauthentication, or a deployment administrator pre-binds a verified issuer/subject. Provider removal cannot silently disable the last administrator's only access method.

CLI local password login remains available for the initial administrator if configured; never use the OAuth resource-owner-password grant as a substitute for provider login.

## Machine clients and flow triggers

Administrators create a service client with workspace ID, allowed scopes, optional allowed sequence IDs, and expiry. Emit its client secret once; store a verifier where supported. OAuth client credentials use the Better Auth OAuth provider's supported machine grant. [Provider documentation](https://better-auth.com/docs/plugins/oauth-provider).

The client sends client ID and secret over TLS to the token endpoint, obtains a short-lived Reflow access token, then invokes `event.emit`, `enrollment.create`, or other granted operations. No cookie, human session, or browser is needed. Prefer a secret file/secret manager; never use a shared global flow-trigger secret across tenants.

Tokens contain/bind issuer, audience, principal, workspace, allowed scopes, and expiry. HTTP API and MCP audiences are explicit; a token for the identity provider or Resend is not a Reflow credential. At every request, intersect token scopes with current client policy and disabled state. Flow eligibility still enforces consent, suppression, caps, and published version requirements.

Rotation uses a bounded overlap period between old/new secrets. New token issuance with the old secret stops at the configured cutoff. Revocation or client disablement blocks active tokens through application checks even if their signatures remain valid. Recovery never prints stored client secrets.

Triggering retries preserve the original event ID/idempotency key. Token refresh/renewal does not create a new logical event or enrollment. The backend maps events to permitted sequences and cannot be asked to start arbitrary Temporal workflow types or task queues.

## MCP authentication and parity

HTTP MCP implements protected-resource metadata and OAuth discovery; public client authorization uses PKCE and the configured provider login path. Trusted first-party clients can have administrator-preconfigured grants. Other clients require an explicit authorization decision, available through a short-lived CLI/MCP authorization challenge (`auth.authorization_approve` or `auth.authorization_deny`) that displays client, resource, and requested scopes. No unconditional consent bypass. The final redirect is protocol output, not a dashboard. Validate this headless consent flow against selected MCP clients before release. [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

An unauthenticated MCP connection may discover only the auth/policy operations needed to establish access; product tools remain protected. For clients that expect an HTTP 401 discovery flow, use the standard OAuth transport path. STDIO can authenticate with OAuth or machine credentials using protected local configuration and serve the same product tools. The bridge must not become a privileged bypass.

Infrastructure bootstrap is CLI-only because it precedes the server. External provider login and protocol token exchange are transport prerequisites. After authentication, all account, policy, credential, sequence, template, recipient, trigger, monitoring, and recovery operations have CLI/MCP parity. Secret bytes are handled by credential plumbing rather than mandatory model-visible tool arguments.

## Required verification

Test concurrent bootstrap, restart without reset, last-admin protection, every signup bypass path, OAuth identity-linking attacks, mismatched state/nonce/issuer/audience, callback replay, registration toggling, machine scope escalation, workspace isolation, secret overlap/revocation, login challenge theft, and trigger retry dedupe. These are release acceptance requirements; the repository's current documentation checks do not implement or prove them.
