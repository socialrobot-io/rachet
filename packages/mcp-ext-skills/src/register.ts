/**
 * FastMCP Skills Provider resource shape + SEP-2640 methods.
 *
 * Matches SocialRobot / post-scheduler registration so Cursor-style hosts that
 * only chip `resources/list` discover skill:// URIs. See
 * https://gofastmcp.com/servers/providers/skills
 *
 * Temporary: remove when official typescript-sdk ext/skills + host discovery land.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SKILL_URI_SCHEME, SKILLS_EXTENSION_ID } from './constants.js';
import { installSkills, type SkillsCacheHint } from './install.js';
import type { LoadedSkill, LoadedSkillFile } from './load.js';
import type { Skill } from './types.js';

/** FastMCP synthetic manifest resource basename. */
export const SKILL_MANIFEST_BASENAME = '_manifest';

/** FastMCP `supporting_files` disclosure. */
export type SupportingFilesMode = 'template' | 'resources';

export type RegisterFastMcpSkillsOptions = {
  /**
   * Loaded skills to serve. Usually one entry from `loadSkillDirectory`.
   */
  skills: readonly LoadedSkill[];
  /**
   * - `resources` (default): every file in `resources/list` (Cursor-friendly).
   * - `template`: only SKILL.md + `_manifest` listed; other files via URI after
   *   reading the manifest (not implemented for the monolithic SDK yet).
   */
  supportingFiles?: SupportingFilesMode;
  /** Cache hints for `skills/list` and `skills/get`. */
  cacheHint?: SkillsCacheHint;
};

/** FastMCP Resource.name: `{skill}/SKILL.md`, `{skill}/_manifest`, … */
export function skillResourceName(skillName: string, relativePath: string): string {
  return `${skillName}/${relativePath}`;
}

export function skillManifestUri(skillName: string): string {
  return `${SKILL_URI_SCHEME}//${skillName}/${SKILL_MANIFEST_BASENAME}`;
}

function skillMeta(
  skillName: string,
  extras?: { is_manifest?: boolean },
): Record<string, unknown> {
  return {
    fastmcp: {
      skill: {
        name: skillName,
        ...(extras?.is_manifest !== undefined ? { is_manifest: extras.is_manifest } : {}),
      },
    },
  };
}

function toManifestJson(skillName: string, files: readonly LoadedSkillFile[]): string {
  return JSON.stringify(
    {
      skill: skillName,
      files: files.map((file) => ({
        path: file.relativePath,
        size: file.bytes.byteLength,
        hash: file.digest,
      })),
    },
    null,
    2,
  );
}

function readFileContents(file: LoadedSkillFile) {
  return {
    contents: [
      {
        uri: file.uri,
        mimeType: file.mimeType,
        text: file.bytes.toString('utf8'),
      },
    ],
  };
}

/**
 * Registers skills in the FastMCP resource shape and installs SEP-2640 handlers.
 *
 * Advertises the skills extension under both `extensions` and `experimental`
 * (SocialRobot does the same for broader host compatibility).
 */
export function registerFastMcpSkills(
  server: McpServer,
  options: RegisterFastMcpSkillsOptions,
): { skills: Skill[] } {
  const supportingFiles = options.supportingFiles ?? 'resources';
  if (supportingFiles === 'template') {
    throw new Error('registerFastMcpSkills: supportingFiles "template" is not implemented in this shim; use "resources"');
  }

  const sepSkills: Skill[] = [];

  server.server.registerCapabilities({
    resources: {},
    experimental: { [SKILLS_EXTENSION_ID]: {} },
    extensions: { [SKILLS_EXTENSION_ID]: {} },
  });

  for (const loaded of options.skills) {
    const skillName = loaded.skill.frontmatter.name;
    const skillMd = loaded.files.find((file) => file.relativePath === 'SKILL.md');
    if (!skillMd) continue;

    const description =
      typeof loaded.skill.frontmatter.description === 'string'
        ? loaded.skill.frontmatter.description
        : `Skill: ${skillName}`;

    server.registerResource(
      skillResourceName(skillName, 'SKILL.md'),
      skillMd.uri,
      {
        mimeType: 'text/markdown',
        description,
        _meta: skillMeta(skillName, { is_manifest: false }),
      },
      async () => readFileContents(skillMd),
    );

    const manifestUri = skillManifestUri(skillName);
    const manifestJson = toManifestJson(skillName, loaded.files);
    server.registerResource(
      skillResourceName(skillName, SKILL_MANIFEST_BASENAME),
      manifestUri,
      {
        mimeType: 'application/json',
        description: `File listing for ${skillName}`,
        _meta: skillMeta(skillName, { is_manifest: true }),
      },
      async () => ({
        contents: [{ uri: manifestUri, mimeType: 'application/json', text: manifestJson }],
      }),
    );

    for (const file of loaded.files) {
      if (file.relativePath === 'SKILL.md') continue;
      server.registerResource(
        skillResourceName(skillName, file.relativePath),
        file.uri,
        {
          mimeType: file.mimeType,
          description: `File from ${skillName} skill`,
          _meta: skillMeta(skillName),
        },
        async () => readFileContents(file),
      );
    }

    sepSkills.push(loaded.skill);
  }

  // installSkills merges extension capability again; handlers are the SEP surface.
  installSkills(server.server, {
    skills: sepSkills,
    ...(options.cacheHint !== undefined ? { cacheHint: options.cacheHint } : {}),
  });

  return { skills: sepSkills };
}

/** Build SocialRobot-style MCP server instructions that point hosts at the first skill. */
export function skillServerInstructions(skills: readonly LoadedSkill[], productLine = 'Reflow MCP'): string {
  const first = skills[0];
  return [
    `${productLine} exposes product operations and Agent Skills as resources.`,
    'List skills with skills/list, fetch an entry with skills/get, and read files with resources/read.',
    first ? `Start with ${first.skill.uri} for the primary workflow skill.` : null,
  ]
    .filter(Boolean)
    .join(' ');
}
