/**
 * Wire constants for the MCP Skills extension (SEP-2640).
 *
 * Temporary local copy of the shapes from typescript-sdk#2818
 * (modelcontextprotocol core/client/server ext/skills). Delete this package when that lands.
 */

/** Reverse-DNS id under ServerCapabilities.extensions. */
export const SKILLS_EXTENSION_ID = 'io.modelcontextprotocol/skills';

/** Request method that enumerates served skills. */
export const SKILLS_LIST_METHOD = 'skills/list';

/** Request method that fetches one skill by its SKILL.md URI. */
export const SKILLS_GET_METHOD = 'skills/get';

/** Canonical URI scheme for skills. Servers MAY use other schemes. */
export const SKILL_URI_SCHEME = 'skill:';

/** Manifest filename that terminates every SKILL.md URI. */
export const SKILL_MANIFEST_FILENAME = 'SKILL.md';

/** SEP-2640 normative max resource entries per skill. */
export const MAX_SKILL_RESOURCES = 512;

/** SEP-2640 normative max total skill bytes (16 MiB). */
export const MAX_SKILL_TOTAL_BYTES = 16_777_216;

/** Digest format: sha256: + 64 lowercase hex chars. */
export const SKILL_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
