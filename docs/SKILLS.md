# Agent skills

There are two kinds of skills in this project:

- Official Resend, Temporal, and Better Auth skills guide implementation. Sources and immutable revisions are recorded in [skills.lock.json](../skills.lock.json).
- The first-party [reflow skill](../skills/reflow/SKILL.md) guides agents in translating natural-language intent into validated workflows and operating them through MCP/CLI. Its reference files travel with the package.

The official skills were installed into the current user's Codex skills directory during this task. They will be available for automatic discovery on the next turn. For another machine, use the Codex skill installer with the repository, revision, and path from the lock file. With the standard Codex installation:

```sh
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" --repo resend/resend-skills --path skills/resend --ref 2a9310fb040fd06a17ce1e8e7aea478d79daea62
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" --repo temporalio/skill-temporal-developer --path . --name temporal-developer --ref ef2c99ac6ff12dec98994a0c63016126bf4cd215
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" --repo better-auth/skills --path better-auth/best-practices better-auth/create-auth better-auth/emailAndPassword better-auth/organization better-auth/twoFactor security --ref 20c9e88a5c007461a703f1c213572b073196113e
```

These commands require network access and the Codex installer. Other agent clients can install the same directories from the linked GitHub revisions using their own skill installer. Installation adds instructions, not a Resend credential, Temporal server, or Reflow runtime. Do not run an unpinned package installation command as an implicit skill update.

The [official Better Auth pack](https://better-auth.com/docs/ai-resources/skills) includes best practices, auth creation, email/password, organizations, two-factor authentication, and security. All six are installed. Installing a guidance pack does not enable every corresponding product feature. Follow version-matched Better Auth documentation when changing authentication; runtime versions are pinned in `package.json` and `pnpm-lock.yaml`.

Install the first-party skill with the repository's dependency-free installer:

```sh
python3 scripts/install_reflow_skill.py
```

It defaults to `$CODEX_HOME/skills/reflow` (or `~/.codex/skills/reflow`), can target another skills root with `--dest`, and refuses to overwrite different existing content. An identical installation is a no-op. To update, inspect differences and explicitly replace the old installation; the installer does not silently discard local modifications. Start a new turn/session for discovery.

`make check` validates the first-party skill metadata and internal references. Release qualification must also exercise realistic MCP/CLI flows with that release's skill and discovered schemas. Maintain it alongside operation contracts and package it for `reflow skill export` / `reflow_skill_export` when the backend is built.

Upstream skill updates are explicit: choose/review a revision, update the lock, reinstall, read relevant guidance, and rerun the affected implementation tests. Vendor advice must not replace Reflow's user-required Temporal orchestration with provider-native automations or bypass its send ledger. The pinned Temporal skill recommends evaluating task-queue fairness; qualify support against the chosen self-hosted version before enabling it.
