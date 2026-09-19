import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { MAX_SKILL_RESOURCES, MAX_SKILL_TOTAL_BYTES, SKILL_MANIFEST_FILENAME, SKILL_URI_SCHEME } from './constants.js';
import type { Skill, SkillFrontmatter, SkillResourceEntry } from './types.js';

export interface LoadedSkillFile {
  /** Absolute filesystem path. */
  absolutePath: string;
  /** Resource URI (for example `skill://reflow/SKILL.md`). */
  uri: string;
  /** Relative path inside the skill folder, POSIX separators. */
  relativePath: string;
  bytes: Buffer;
  digest: `sha256:${string}`;
  mimeType: string;
}

export interface LoadedSkill {
  skill: Skill;
  files: LoadedSkillFile[];
}

export interface LoadSkillDirectoryOptions {
  /**
   * Authority used in `skill://{name}/…` URIs. Defaults to the frontmatter `name`
   * (or the directory basename when frontmatter is missing that field).
   */
  name?: string;
}

function sha256Digest(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function mimeTypeFor(relativePath: string): string {
  if (relativePath.endsWith('.md')) return 'text/markdown';
  if (relativePath.endsWith('.json')) return 'application/json';
  if (relativePath.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

/** Minimal YAML frontmatter parser for `name` / `description` (+ extra string fields). */
export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match?.[1]) {
    throw new Error('SKILL.md is missing YAML frontmatter');
  }
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  if (!fields.name || !fields.description) {
    throw new Error('SKILL.md frontmatter requires name and description');
  }
  return fields as SkillFrontmatter;
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

/**
 * Loads a skill folder into SEP-2640 metadata plus raw file bytes for `resources/read`.
 *
 * Filesystem discovery is intentionally local to this shim; the upstream SDK plans a
 * later `@modelcontextprotocol/node/ext/skills` for the same job.
 */
export async function loadSkillDirectory(
  directory: string,
  options: LoadSkillDirectoryOptions = {},
): Promise<LoadedSkill> {
  const root = path.resolve(directory);
  const manifestPath = path.join(root, SKILL_MANIFEST_FILENAME);
  const manifestStat = await stat(manifestPath).catch(() => undefined);
  if (!manifestStat?.isFile()) {
    throw new Error(`Skill directory is missing ${SKILL_MANIFEST_FILENAME}: ${root}`);
  }

  const manifestText = await readFile(manifestPath, 'utf8');
  const frontmatter = parseSkillFrontmatter(manifestText);
  const name = options.name ?? frontmatter.name;
  if (name !== frontmatter.name) {
    throw new Error(`Skill URI name "${name}" does not match frontmatter name "${frontmatter.name}"`);
  }

  const absoluteFiles = (await listFilesRecursive(root)).sort((left, right) => left.localeCompare(right));
  if (absoluteFiles.length > MAX_SKILL_RESOURCES) {
    throw new Error(`Skill exceeds MAX_SKILL_RESOURCES (${MAX_SKILL_RESOURCES})`);
  }

  const files: LoadedSkillFile[] = [];
  const resources: SkillResourceEntry[] = [];
  let totalBytes = 0;

  for (const absolutePath of absoluteFiles) {
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
    const bytes = await readFile(absolutePath);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
      throw new Error(`Skill exceeds MAX_SKILL_TOTAL_BYTES (${MAX_SKILL_TOTAL_BYTES})`);
    }
    const digest = sha256Digest(bytes);
    const uri = `${SKILL_URI_SCHEME}//${name}/${relativePath}`;
    files.push({
      absolutePath,
      uri,
      relativePath,
      bytes,
      digest,
      mimeType: mimeTypeFor(relativePath),
    });
    resources.push({ uri, digest, size: bytes.byteLength });
  }

  const skillUri = `${SKILL_URI_SCHEME}//${name}/${SKILL_MANIFEST_FILENAME}`;
  return {
    skill: {
      uri: skillUri,
      frontmatter,
      resources,
    },
    files,
  };
}
