# Agent skills

There are two kinds of skills in this project:

- Official Resend, Temporal, and Better Auth skills guide implementation. Sources and immutable revisions are recorded in [skills.lock.json](../skills.lock.json).
- The first-party [reflow skill](../skills/reflow/SKILL.md) guides agents in translating natural-language intent into validated workflows and operating them through MCP/CLI. Its reference files travel with the package.

## MCP serving (SEP-2640 + FastMCP shape)

The authenticated MCP server advertises `capabilities.extensions["io.modelcontextprotocol/skills"]` (and the same id under `experimental` for host compatibility). It answers `skills/list` / `skills/get` for `skill://reflow/SKILL.md`.

Skill files are also ordinary MCP resources in the [FastMCP Skills Provider](https://gofastmcp.com/servers/providers/skills) shape that Cursor-style UIs discover via `resources/list`:

| URI | Resource.name | Purpose |
|---|---|---|
| `skill://reflow/SKILL.md` | `reflow/SKILL.md` | Main instructions |
| `skill://reflow/_manifest` | `reflow/_manifest` | JSON inventory (`path`, `size`, `hash`) |
| `skill://reflow/{file}` | `reflow/{file}` | Supporting files |

Resources carry `_meta.fastmcp.skill`. Disclosure mode is FastMCP `resources` (every file listed). Server `instructions` point hosts at `skill://reflow/SKILL.md`. Override the on-disk skill root with `REFLOW_SKILL_DIR` when needed.

Until [typescript-sdk#2818](https://github.com/modelcontextprotocol/typescript-sdk/pull/2818) lands, Rachet uses the temporary workspace package `@reflow/mcp-ext-skills` (schemas, `installSkills`, and FastMCP `registerFastMcpSkills`, adapted for `@modelcontextprotocol/sdk`). Remove that package and switch to the official `@modelcontextprotocol/*/ext/skills` exports when they ship.

Hosts that already install the skill locally can keep using [scripts/install_reflow_skill.py](../scripts/install_reflow_skill.py). MCP discovery is additive, not a replacement for that installer.

## Official implementation skills

Project-level Better Auth skills live under `.agents/skills/` and are locked in [skills-lock.json](../skills-lock.json) (the `npx skills` format). Install or refresh them with:

```sh
npx skills add better-auth/skills -y -p -s '*'
```

That installs all six: best practices, create-auth, email/password, organization, two-factor, and security.

Codex-oriented pins for Resend, Temporal, and Better Auth also remain in [skills.lock.json](../skills.lock.json). On another machine with the Codex installer:

```sh
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" --repo resend/resend-skills --path skills/resend --ref 2a9310fb040fd06a17ce1e8e7aea478d79daea62
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" --repo temporalio/skill-temporal-developer --path . --name temporal-developer --ref ef2c99ac6ff12dec98994a0c63016126bf4cd215
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" --repo better-auth/skills --path better-auth/best-practices better-auth/create-auth better-auth/emailAndPassword better-auth/organization better-auth/twoFactor security --ref 20c9e88a5c007461a703f1c213572b073196113e
```

These commands require network access. Installation adds instructions, not a Resend credential, Temporal server, or Rachet runtime. Do not run an unpinned package installation command as an implicit skill update.

The [official Better Auth pack](https://better-auth.com/docs/ai-resources/skills) includes best practices, auth creation, email/password, organizations, two-factor authentication, and security. Installing a guidance pack does not enable every corresponding product feature. Follow version-matched Better Auth documentation when changing authentication; runtime versions are pinned in `package.json` and `pnpm-lock.yaml`.

## Local first-party skill install

Install the first-party skill with the repository's dependency-free installer:

```sh
python3 scripts/install_reflow_skill.py
```

It defaults to `$CODEX_HOME/skills/reflow` (or `~/.codex/skills/reflow`), can target another skills root with `--dest`, and refuses to overwrite different existing content. An identical installation is a no-op. To update, inspect differences and explicitly replace the old installation; the installer does not silently discard local modifications. Start a new turn/session for discovery.

`make check` validates the first-party skill metadata and internal references. Release qualification must also exercise realistic MCP/CLI flows with that release's skill and discovered schemas. Maintain it alongside operation contracts.

Upstream skill updates are explicit: choose/review a revision, update the lock, reinstall, read relevant guidance, and rerun the affected implementation tests. Vendor advice must not replace Rachet's user-required Temporal orchestration with provider-native automations or bypass its send ledger. The pinned Temporal skill recommends evaluating task-queue fairness; qualify support against the chosen self-hosted version before enabling it.
