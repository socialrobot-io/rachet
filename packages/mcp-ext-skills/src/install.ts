/**
 * Server side of SEP-2640 for the current monolithic `@modelcontextprotocol/sdk`.
 *
 * Mirrors `installSkills` from typescript-sdk#2818
 * (`@modelcontextprotocol/server/ext/skills`), adapted to
 * `Server.setRequestHandler(requestSchema, handler)` instead of the split-package
 * `{ params, result }` form. Remove when the official export ships.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  GetSkillRequestSchema,
  ListSkillsRequestSchema,
} from './schemas.js';
import { SKILLS_EXTENSION_ID } from './constants.js';
import type { ListSkillsResult, Skill, SkillCacheScope } from './types.js';

export interface SkillsCacheHint {
  /** Milliseconds after which a client should refresh. Defaults to `0`. */
  ttlMs?: number;
  /** Cache scope for the result. Defaults to `'private'`. */
  cacheScope?: SkillCacheScope;
}

export interface InstallSkillsOptions {
  /**
   * Skills this server serves, in `skills/list` order. Each `uri` must be unique;
   * it is the key `skills/get` resolves against.
   */
  skills: readonly Skill[];
  /**
   * Max skills per `skills/list` page. Unset means one page of everything.
   */
  pageSize?: number;
  /** Cache hints stamped onto `skills/list` and `skills/get` results. */
  cacheHint?: SkillsCacheHint;
}

export interface SkillsRegistration {
  readonly skills: ReadonlyMap<string, Skill>;
}

function offsetFromCursor(cursor: string | undefined, total: number): number {
  if (cursor === undefined) return 0;
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > total) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid cursor: ${cursor}`);
  }
  return offset;
}

/**
 * Declares `io.modelcontextprotocol/skills` and registers `skills/list` + `skills/get`.
 *
 * Call before connecting a transport. The caller must also register skill files as
 * ordinary MCP resources and advertise the `resources` capability SEP-2640 requires.
 */
export function installSkills(server: Server, options: InstallSkillsOptions): SkillsRegistration {
  const { skills, pageSize, cacheHint } = options;

  if (pageSize !== undefined && (!Number.isSafeInteger(pageSize) || pageSize < 1)) {
    throw new RangeError(`installSkills: pageSize must be a positive integer (got ${String(pageSize)})`);
  }

  const byUri = new Map<string, Skill>();
  for (const skill of skills) {
    if (byUri.has(skill.uri)) {
      throw new Error(`installSkills: duplicate skill URI ${skill.uri}`);
    }
    byUri.set(skill.uri, skill);
  }
  const ordered = [...byUri.values()];

  server.registerCapabilities({
    experimental: { [SKILLS_EXTENSION_ID]: {} },
    extensions: { [SKILLS_EXTENSION_ID]: {} },
  });

  const hints =
    cacheHint === undefined
      ? {}
      : {
          ttlMs: cacheHint.ttlMs ?? 0,
          cacheScope: cacheHint.cacheScope ?? ('private' as const),
        };

  server.setRequestHandler(ListSkillsRequestSchema, (request): ListSkillsResult => {
    const start = offsetFromCursor(request.params?.cursor, ordered.length);
    const end = pageSize === undefined ? ordered.length : Math.min(start + pageSize, ordered.length);
    const page = ordered.slice(start, end);
    return {
      skills: page,
      ...(end < ordered.length ? { nextCursor: String(end) } : {}),
      ...hints,
    };
  });

  server.setRequestHandler(GetSkillRequestSchema, (request) => {
    const skill = byUri.get(request.params.uri);
    if (skill === undefined) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown skill URI: ${request.params.uri}`);
    }
    return { skill, ...hints };
  });

  return { skills: byUri };
}
