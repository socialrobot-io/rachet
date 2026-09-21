import { describe, expect, it } from 'vitest';
import { normalizeOrganizationSlug, validEmail } from './registration-form';

describe('registration form values', () => {
  it('turns domain-like organization values into URL-safe slugs', () => {
    expect(normalizeOrganizationSlug('bedtimefable.ai')).toBe('bedtimefable-ai');
    expect(normalizeOrganizationSlug('  Wololo & Friends  ')).toBe('wololo-friends');
  });

  it('rejects incomplete email addresses', () => {
    expect(validEmail('ntorres.dev@gmail.com')).toBe(true);
    expect(validEmail('ntorres.dev@')).toBe(false);
  });
});
