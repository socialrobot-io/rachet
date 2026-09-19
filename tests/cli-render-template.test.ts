import { describe, expect, it } from 'vitest';
import { placeholderProps, renderLocalReactEmailFile } from '../packages/cli/src/cli-render-template.js';
import { resolveReactEmailCli } from '../packages/cli/src/cli-templates.js';
import { access } from 'node:fs/promises';

describe('placeholderProps', () => {
  it('turns nested property access into {{path}} tokens', () => {
    const props = placeholderProps();
    expect((props.contact as Record<string, string>).firstName).toBe('{{contact.firstName}}');
    expect((props.variables as Record<string, string>).productUrl).toBe('{{variables.productUrl}}');
    expect((props.event as Record<string, string>).name).toBe('{{event.name}}');
  });
});

describe('renderLocalReactEmailFile', () => {
  it('renders a minimal default-export component', async () => {
    const source = `
      import { Html, Text } from 'react-email';
      export default function Mini({ contact }) {
        return <Html><Text>Hi {contact.firstName}</Text></Html>;
      }
    `;
    const rendered = await renderLocalReactEmailFile(source);
    expect(rendered.html).toContain('{{contact.firstName}}');
    expect(rendered.plainText).toContain('{{contact.firstName}}');
  });
});

describe('resolveReactEmailCli', () => {
  it('resolves the installed CLI from source and compiled layouts', async () => {
    const path = resolveReactEmailCli();
    await expect(access(path)).resolves.toBeUndefined();
  });
});

describe('missingReactEmailProjectDeps', () => {
  it('finds no missing deps in this repo', async () => {
    const { missingReactEmailProjectDeps } = await import('../packages/cli/src/cli-templates.js');
    expect(missingReactEmailProjectDeps()).toEqual([]);
  });
});
