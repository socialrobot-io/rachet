import { SKILLS_EXTENSION_ID } from './constants.js';
import { SkillsCapabilitySchema } from './schemas.js';
import type { SkillsCapability } from './types.js';

/** Structural capabilities shape so this helper stays SDK-agnostic. */
export interface CapabilitiesWithExtensions {
  extensions?: Record<string, unknown>;
}

/**
 * Reads the Skills extension capability, or `undefined` when absent/malformed.
 */
export function skillsCapabilityOf(
  capabilities: CapabilitiesWithExtensions | undefined,
): SkillsCapability | undefined {
  const declared = capabilities?.extensions?.[SKILLS_EXTENSION_ID];
  if (declared === undefined) return undefined;
  const parsed = SkillsCapabilitySchema.safeParse(declared);
  return parsed.success ? parsed.data : undefined;
}
