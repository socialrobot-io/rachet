import { z } from 'zod';
import { MAX_SKILL_RESOURCES, SKILL_DIGEST_PATTERN, SKILLS_GET_METHOD, SKILLS_LIST_METHOD } from './constants.js';

/** SHA-256 content digest: `sha256:{64 lowercase hex}`. */
export const SkillDigestSchema = z
  .string()
  .regex(SKILL_DIGEST_PATTERN, 'digest must be formatted "sha256:{64 lowercase hex chars}"');

/** One file belonging to a skill. */
export const SkillResourceEntrySchema = z.object({
  uri: z.string(),
  digest: SkillDigestSchema,
  size: z.number().int().nonnegative(),
});

/**
 * YAML frontmatter of `SKILL.md` as JSON. `name` and `description` are required;
 * further author keys are preserved.
 */
export const SkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

/**
 * Complete resource list, or `"dynamic"` when digests cannot be published up front.
 */
export const SkillResourcesSchema = z.union([
  z.array(SkillResourceEntrySchema).max(MAX_SKILL_RESOURCES),
  z.literal('dynamic'),
]);

/** A single skill served by an MCP server. */
export const SkillSchema = z.object({
  uri: z.string(),
  frontmatter: SkillFrontmatterSchema,
  resources: SkillResourcesSchema,
});

export const SkillCacheScopeSchema = z.enum(['public', 'private']);

const skillCacheHintShape = {
  ttlMs: z.number().int().nonnegative().optional(),
  cacheScope: SkillCacheScopeSchema.optional(),
};

/** Params for `skills/list` (pagination only). */
export const ListSkillsRequestParamsSchema = z
  .object({
    cursor: z.string().optional(),
  })
  .optional();

/** Full JSON-RPC request schema for `skills/list` (current monolithic SDK). */
export const ListSkillsRequestSchema = z.object({
  method: z.literal(SKILLS_LIST_METHOD),
  params: ListSkillsRequestParamsSchema,
});

/** Result of `skills/list`. No `resultType` (era codec owns that field). */
export const ListSkillsResultSchema = z.object({
  skills: z.array(SkillSchema),
  nextCursor: z.string().optional(),
  ...skillCacheHintShape,
}).passthrough();

/** Params for `skills/get`. */
export const GetSkillRequestParamsSchema = z.object({
  uri: z.string(),
});

/** Full JSON-RPC request schema for `skills/get`. */
export const GetSkillRequestSchema = z.object({
  method: z.literal(SKILLS_GET_METHOD),
  params: GetSkillRequestParamsSchema,
});

/** Result of `skills/get`. */
export const GetSkillResultSchema = z.object({
  skill: SkillSchema,
  ...skillCacheHintShape,
}).passthrough();

/** Value at `capabilities.extensions["io.modelcontextprotocol/skills"]`. */
export const SkillsCapabilitySchema = z.looseObject({
  directoryRead: z.boolean().optional(),
});
