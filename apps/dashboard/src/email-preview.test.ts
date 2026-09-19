import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { renderWithSamples, templateVersionIdOf } from './email-preview';
import type { RenderedEmail } from './types';

function fakeRender(required: string[]): (props: Record<string, unknown>) => Promise<RenderedEmail> {
  return async (props) => {
    for (const path of required) {
      const value = path.split('.').reduce<unknown>((current, part) => {
        if (typeof current !== 'object' || current === null) return undefined;
        return (current as Record<string, unknown>)[part];
      }, props);
      if (value === undefined) throw new ApiError(422, `Missing template property: ${path}`);
    }
    return { subject: 'Hi', preheader: '', html: '<p>Hi</p>', plainText: 'Hi' };
  };
}

describe('renderWithSamples', () => {
  it('renders directly when no props are missing', async () => {
    const result = await renderWithSamples(fakeRender([]));
    expect(result.subject).toBe('Hi');
  });

  it('fills missing properties with samples and retries', async () => {
    const seen: Record<string, unknown>[] = [];
    const render = (props: Record<string, unknown>) => {
      seen.push(structuredClone(props));
      return fakeRender(['contact.firstName', 'contact.locale', 'variables.plan'])(props);
    };
    const result = await renderWithSamples(render);
    expect(result.subject).toBe('Hi');
    const last = seen.at(-1)!;
    expect(last).toMatchObject({
      contact: { firstName: 'Ada', locale: 'en' },
      variables: { plan: 'pro' },
    });
  });

  it('keeps base props and only fills what is missing', async () => {
    const result = await renderWithSamples(fakeRender(['contact.firstName']), {
      contact: { firstName: 'Grace', email: 'grace@example.com' },
    });
    expect(result.subject).toBe('Hi');
  });

  it('rethrows errors that are not missing-property errors', async () => {
    await expect(
      renderWithSamples(async () => {
        throw new ApiError(404, 'Template version not found');
      }),
    ).rejects.toThrow('Template version not found');
  });

  it('gives up when a property can never be satisfied', async () => {
    await expect(
      renderWithSamples(async () => {
        throw new ApiError(422, 'Missing template property: contact.never');
      }),
    ).rejects.toThrow('Template preview needs more properties than expected');
  });
});

describe('templateVersionIdOf', () => {
  it('reads the literal pin', () => {
    expect(
      templateVersionIdOf({ templateVersionId: { literal: 'c71f5508-b40b-4108-84c6-f7e28ebf0943' } }),
    ).toBe('c71f5508-b40b-4108-84c6-f7e28ebf0943');
  });

  it('returns undefined for path-based or missing pins', () => {
    expect(templateVersionIdOf({ templateVersionId: { path: 'contact.x' } })).toBeUndefined();
    expect(templateVersionIdOf({})).toBeUndefined();
  });
});
