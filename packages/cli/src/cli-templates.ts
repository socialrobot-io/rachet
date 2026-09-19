import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { Command } from 'commander';
import type { ReflowClient } from './client.js';
import type { CliContext, SavedWorkspace } from './cli-state.js';
import { renderLocalReactEmailFile } from './cli-render-template.js';

/** React Email 6 splits: `react-email` = components+CLI, `@react-email/ui` = preview app. */
const REACT_EMAIL_DEPS = {
  'react-email': '6.9.5',
  '@react-email/ui': '6.9.5',
} as const;

const SAMPLE_WELCOME = `import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'react-email';

type Props = {
  contact: { firstName: string };
  variables: { productUrl: string };
};

export default function WelcomeEmail({ contact, variables }: Props) {
  return (
    <Html>
      <Head />
      <Preview>Your account is ready.</Preview>
      <Body style={{ backgroundColor: '#f4f4f5', fontFamily: 'Arial, sans-serif', margin: 0, padding: '32px 12px' }}>
        <Container style={{ backgroundColor: '#ffffff', borderRadius: 8, margin: '0 auto', maxWidth: 560, padding: 32 }}>
          <Heading style={{ color: '#18181b', fontSize: 24, margin: '0 0 16px' }}>
            Welcome, {contact.firstName}
          </Heading>
          <Text style={{ color: '#3f3f46', fontSize: 15, lineHeight: '24px' }}>
            Thanks for signing up. Open the product to get started.
          </Text>
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button
              href={variables.productUrl}
              style={{ backgroundColor: '#18181b', borderRadius: 6, color: '#fff', display: 'inline-block', padding: '12px 20px', textDecoration: 'none' }}
            >
              Open product
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

WelcomeEmail.PreviewProps = {
  contact: { firstName: 'Ada' },
  variables: { productUrl: 'https://example.com/app' },
} satisfies Props;
`;

export function resolveReactEmailCli(): string {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve('react-email/dist/cli/index.mjs');
  } catch {
    // The CLI subpath is not exported by every React Email release. Resolve
    // the package entry first so this also works from a compiled `dist/` tree.
    return join(dirname(require.resolve('react-email')), 'cli/index.mjs');
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function packageResolvableFromCwd(specifier: string): boolean {
  const require = createRequire(join(process.cwd(), 'package.json'));
  try {
    require.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

/** Packages React Email 6 needs in the project that owns emails/*.tsx. */
export function missingReactEmailProjectDeps(): string[] {
  return (Object.keys(REACT_EMAIL_DEPS) as Array<keyof typeof REACT_EMAIL_DEPS>)
    .filter((name) => !packageResolvableFromCwd(name));
}

export function reactEmailInstallHint(missing: string[]): string {
  const specs = missing.map((name) => `${name}@${REACT_EMAIL_DEPS[name as keyof typeof REACT_EMAIL_DEPS]}`);
  return `pnpm add ${specs.join(' ')}   # or: npm i ${specs.join(' ')}`;
}

export function registerTemplateCommands(
  program: Command,
  helpers: {
    resolveCliContext: () => Promise<CliContext>;
    requireAuthentication: (context: CliContext) => void;
    resolveWorkspace: (context: CliContext, selector?: string, persist?: boolean) => Promise<SavedWorkspace>;
    client: (context: CliContext) => ReflowClient;
  },
): void {
  const template = program.command('template').description('Author, preview, and publish React Email templates.');

  template.command('init')
    .description('Create a minimal emails/ folder with a sample React Email template.')
    .argument('[dir]', 'Directory for templates', 'emails')
    .action(async (dir: string) => {
      const root = resolve(dir);
      await mkdir(root, { recursive: true });
      const sample = join(root, 'welcome.tsx');
      if (!(await pathExists(sample))) await writeFile(sample, SAMPLE_WELCOME, 'utf8');
      console.log(`Created ${root}`);
      const missing = missingReactEmailProjectDeps();
      if (missing.length > 0) {
        console.log('');
        console.log('Install React Email in this project (templates import `react-email`; preview needs `@react-email/ui`):');
        console.log(`  ${reactEmailInstallHint(missing)}`);
      }
      console.log('Next:');
      console.log(`  reflow template preview --dir ${dir}`);
      console.log(`  reflow template push ${dir}/welcome.tsx --name Welcome --subject "Welcome, {{contact.firstName}}" --allow-code-execution`);
    });

  template.command('preview')
    .alias('dev')
    .description('Open the React Email preview app for local templates (default port 3030).')
    .option('-d, --dir <path>', 'Template directory', 'emails')
    .option('-p, --port <port>', 'Preview port', '3030')
    .action(async (options: { dir: string; port: string }) => {
      const dir = resolve(options.dir);
      if (!(await pathExists(dir))) {
        throw new Error(`Template directory not found: ${dir}. Run \`reflow template init\` first.`);
      }
      const missing = missingReactEmailProjectDeps();
      if (missing.length > 0) {
        throw new Error(
          `Missing ${missing.join(' and ')} in ${process.cwd()}. `
          + `React Email 6 needs both packages: \`react-email\` (components) and \`@react-email/ui\` (preview). `
          + `Install with: ${reactEmailInstallHint(missing)}`,
        );
      }
      const bin = resolveReactEmailCli();
      console.log(`Previewing ${dir} on http://localhost:${options.port}`);
      const child = spawn(process.execPath, [bin, 'dev', '--dir', dir, '--port', options.port], {
        stdio: 'inherit',
        env: process.env,
      });
      const exitCode: number = await new Promise((resolvePromise) => {
        child.on('exit', (code) => resolvePromise(code ?? 1));
      });
      if (exitCode !== 0) process.exitCode = exitCode;
    });

  template.command('push')
    .description('Render a React Email .tsx locally, then create or revise + publish HTML/plain text in the workspace (upserts by --name).')
    .argument('<file>', 'Path to a React Email template (.tsx)')
    .requiredOption('--name <name>', 'Template name in the workspace')
    .requiredOption('--subject <subject>', 'Subject line (supports {{contact.firstName}} etc.)')
    .option('--allow-code-execution', 'Acknowledge that the local TSX template is trusted Node.js code')
    .option('--preheader <preheader>', 'Inbox preheader text')
    .option('--workspace <id-or-slug>', 'Override active workspace')
    .action(async (file: string, options: { name: string; subject: string; preheader?: string; workspace?: string; allowCodeExecution?: boolean }) => {
      if (!options.allowCodeExecution) {
        throw new Error('React Email TSX executes locally with your user permissions. Review the file, then re-run with --allow-code-execution.');
      }
      const context = await helpers.resolveCliContext();
      helpers.requireAuthentication(context);
      const workspace = await helpers.resolveWorkspace(context, options.workspace);
      const path = resolve(file);
      const tsxSource = await readFile(path, 'utf8');
      const rendered = await renderLocalReactEmailFile(tsxSource, undefined, { resolveDir: dirname(path) });
      const client = helpers.client(context);
      const content = {
        subject: options.subject,
        ...(options.preheader ? { preheader: options.preheader } : {}),
        sourceKind: 'html' as const,
        html: rendered.html,
        body: rendered.plainText,
        tsxSource,
      };
      const existing = (await client.call<Array<{
        id: string;
        name: string;
        state: string;
        revision: number;
      }>>('template.list', { workspaceId: workspace.id }))
        .find((row) => row.name === options.name && row.state !== 'archived');

      let templateId: string;
      let expectedRevision: number;
      let action: 'created' | 'revised';
      if (existing) {
        const revised = await client.call<{ id: string; revision: number }>('template.revise', {
          workspaceId: workspace.id,
          templateId: existing.id,
          expectedRevision: existing.revision,
          ...content,
        });
        templateId = revised.id;
        expectedRevision = revised.revision;
        action = 'revised';
      } else {
        const created = await client.call<{ id: string; revision: number }>('template.create', {
          workspaceId: workspace.id,
          name: options.name,
          ...content,
        });
        templateId = created.id;
        expectedRevision = created.revision;
        action = 'created';
      }

      const published = await client.call<{ id: string; version: number }>('template.publish', {
        workspaceId: workspace.id,
        templateId,
        expectedRevision,
      });
      console.log(JSON.stringify({
        action,
        templateId,
        templateVersionId: published.id,
        version: published.version,
        file: basename(path),
        tip: 'Pin templateVersionId on email.send as { "literal": "<templateVersionId>" }',
      }, null, 2));
    });

  template.command('list')
    .description('List templates and published version ids in the active workspace.')
    .option('--workspace <id-or-slug>', 'Override active workspace')
    .action(async (options: { workspace?: string }) => {
      const context = await helpers.resolveCliContext();
      helpers.requireAuthentication(context);
      const workspace = await helpers.resolveWorkspace(context, options.workspace);
      const rows = await helpers.client(context).call<Array<{
        id: string; name: string; state: string; sourceKind: string;
        versions?: Array<{ id: string; version: number }>;
      }>>('template.list', { workspaceId: workspace.id });
      for (const row of rows) {
        const latest = row.versions?.at(-1);
        console.log(`${row.state.padEnd(10)} ${row.sourceKind.padEnd(12)} ${row.name}`);
        console.log(`  templateId ${row.id}`);
        if (latest) console.log(`  latestVersionId ${latest.id} (v${latest.version})`);
      }
    });

  template.command('archive')
    .description('Archive a template that no workflow still references.')
    .argument('<templateId>', 'Template UUID')
    .option('--workspace <id-or-slug>', 'Override active workspace')
    .action(async (templateId: string, options: { workspace?: string }) => {
      const context = await helpers.resolveCliContext();
      helpers.requireAuthentication(context);
      const workspace = await helpers.resolveWorkspace(context, options.workspace);
      const archived = await helpers.client(context).call('template.archive', { workspaceId: workspace.id, templateId });
      console.log(JSON.stringify(archived, null, 2));
    });
}
