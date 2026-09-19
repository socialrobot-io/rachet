/**
 * Temporary SEP-2640 Skills extension shim for @modelcontextprotocol/sdk.
 *
 * Tracks typescript-sdk#2818 (official ext/skills subpath exports). Delete this
 * package and switch to those exports when that PR ships.
 */

export type { CapabilitiesWithExtensions } from './capability.js';
export { skillsCapabilityOf } from './capability.js';
export {
  MAX_SKILL_RESOURCES,
  MAX_SKILL_TOTAL_BYTES,
  SKILL_DIGEST_PATTERN,
  SKILL_MANIFEST_FILENAME,
  SKILL_URI_SCHEME,
  SKILLS_EXTENSION_ID,
  SKILLS_GET_METHOD,
  SKILLS_LIST_METHOD,
} from './constants.js';
export type { InstallSkillsOptions, SkillsCacheHint, SkillsRegistration } from './install.js';
export { installSkills } from './install.js';
export type { LoadSkillDirectoryOptions, LoadedSkill, LoadedSkillFile } from './load.js';
export { loadSkillDirectory, parseSkillFrontmatter } from './load.js';
export type { RegisterFastMcpSkillsOptions, SupportingFilesMode } from './register.js';
export {
  SKILL_MANIFEST_BASENAME,
  registerFastMcpSkills,
  skillManifestUri,
  skillResourceName,
  skillServerInstructions,
} from './register.js';
export {
  GetSkillRequestParamsSchema,
  GetSkillRequestSchema,
  GetSkillResultSchema,
  ListSkillsRequestParamsSchema,
  ListSkillsRequestSchema,
  ListSkillsResultSchema,
  SkillCacheScopeSchema,
  SkillDigestSchema,
  SkillFrontmatterSchema,
  SkillResourceEntrySchema,
  SkillResourcesSchema,
  SkillsCapabilitySchema,
  SkillSchema,
} from './schemas.js';
export type {
  GetSkillRequestParams,
  GetSkillResult,
  ListSkillsRequestParams,
  ListSkillsResult,
  Skill,
  SkillCacheScope,
  SkillFrontmatter,
  SkillResourceEntry,
  SkillResources,
  SkillsCapability,
} from './types.js';
