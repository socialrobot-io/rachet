import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { Command } from 'commander';
import type { ReflowClient } from './client.js';
import type { CliContext, SavedWorkspace } from './cli-state.js';
import { renderLocalReactEmailFile } from './cli-render-template.js';

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
      console.log('Next:');
      console.log(`  reflow template preview --dir ${dir}`);
      console.log(`  reflow template push ${dir}/welcome.tsx --name Welcome --subject "Welcome, {{contact.firstName}}"`);
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
    .description('Render a React Email .tsx locally, then create + publish HTML/plain text in the workspace.')
    .argument('<file>', 'Path to a React Email template (.tsx)')
    .requiredOption('--name <name>', 'Template name in the workspace')
    .requiredOption('--subject <subject>', 'Subject line (supports {{contact.firstName}} etc.)')
    .option('--preheader <preheader>', 'Inbox preheader text')
    .option('--workspace <id-or-slug>', 'Override active workspace')
    .action(async (file: string, options: { name: string; subject: string; preheader?: string; workspace?: string }) => {
      const context = await helpers.resolveCliContext();
      helpers.requireAuthentication(context);
      const workspace = await helpers.resolveWorkspace(context, options.workspace);
      const path = resolve(file);
      const tsxSource = await readFile(path, 'utf8');
      const rendered = await renderLocalReactEmailFile(tsxSource, undefined, { resolveDir: dirname(path) });
      const created = await helpers.client(context).call<{ id: string; revision: number }>('template.create', {
        workspaceId: workspace.id,
        name: options.name,
        subject: options.subject,
        ...(options.preheader ? { preheader: options.preheader } : {}),
        sourceKind: 'html',
        html: rendered.html,
        body: rendered.plainText,
        tsxSource,
      });
      const published = await helpers.client(context).call<{ id: string; version: number }>('template.publish', {
        workspaceId: workspace.id,
        templateId: created.id,
        expectedRevision: created.revision,
      });
      console.log(JSON.stringify({
        templateId: created.id,
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
