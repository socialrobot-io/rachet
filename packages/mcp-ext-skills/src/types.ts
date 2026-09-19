import type { z } from 'zod';
import type {
  GetSkillRequestParamsSchema,
  GetSkillResultSchema,
  ListSkillsRequestParamsSchema,
  ListSkillsResultSchema,
  SkillCacheScopeSchema,
  SkillFrontmatterSchema,
  SkillResourceEntrySchema,
  SkillResourcesSchema,
  SkillsCapabilitySchema,
  SkillSchema,
} from './schemas.js';

export type SkillResourceEntry = z.infer<typeof SkillResourceEntrySchema>;
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
export type SkillResources = z.infer<typeof SkillResourcesSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type SkillCacheScope = z.infer<typeof SkillCacheScopeSchema>;
export type ListSkillsRequestParams = z.infer<typeof ListSkillsRequestParamsSchema>;
export type ListSkillsResult = z.infer<typeof ListSkillsResultSchema>;
export type GetSkillRequestParams = z.infer<typeof GetSkillRequestParamsSchema>;
export type GetSkillResult = z.infer<typeof GetSkillResultSchema>;
export type SkillsCapability = z.infer<typeof SkillsCapabilitySchema>;
