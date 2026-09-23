import { useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, Copy, Puzzle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function CopyCode({ code, label }: { code: string; label: string }) {
  const [message, setMessage] = useState('');
  return <div className="relative rounded-lg border bg-muted/40 p-3">
    <pre className="overflow-x-auto pr-12 font-mono text-xs leading-6"><code>{code}</code></pre>
    <Button className="absolute right-2 top-2" size="icon" variant="ghost" aria-label={`Copy ${label}`} onClick={() => {
      void navigator.clipboard.writeText(code).then(() => setMessage('Copied')).catch(() => setMessage('Select and copy the text manually.'));
    }}>{message === 'Copied' ? <Check /> : <Copy />}</Button>
    {message && <p role="status" className="mt-1 text-xs text-muted-foreground">{message}</p>}
  </div>;
}

type McpClient = {
  id: 'claude' | 'chatgpt' | 'cursor' | 'vscode' | 'windsurf' | 'zed' | 'other';
  name: string;
  intro: string;
  steps: string[];
  label: string;
  code: string;
  install?: { label: string; href: string };
};

// Client-owned install URL formats: cursor.com/docs/mcp/install-links and
// code.visualstudio.com/api/extension-guides/ai/mcp.
function cursorInstallUrl(endpoint: string) {
  const config = btoa(JSON.stringify({ url: endpoint }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=rachet&config=${encodeURIComponent(config)}`;
}

function vsCodeInstallUrl(endpoint: string) {
  const config = JSON.stringify({ name: 'rachet', type: 'http', url: endpoint });
  return `vscode:mcp/install?${encodeURIComponent(config)}`;
}

function mcpClients(endpoint: string): McpClient[] {
  return [
    {
      id: 'claude', name: 'Claude Code', intro: 'Add Rachet as a remote MCP server from your terminal.',
      steps: ['Run the command below.', 'Open Claude Code and complete the browser sign-in when prompted.'],
      label: 'Claude Code command', code: `claude mcp add --transport http rachet ${endpoint}`,
    },
    {
      id: 'chatgpt', name: 'ChatGPT', intro: 'Connect Rachet as a custom remote MCP app, if your ChatGPT plan supports custom apps.',
      steps: ['Open ChatGPT settings and create a custom MCP app.', 'Enter the server URL below, then complete OAuth sign-in in your browser.'],
      label: 'MCP server URL', code: endpoint,
    },
    {
      id: 'cursor', name: 'Cursor', intro: 'Add Rachet to your project MCP configuration.',
      steps: ['Use Add to Cursor, or merge this entry into .cursor/mcp.json.', 'Connect Rachet and approve access in your browser.'],
      label: 'Cursor configuration', code: JSON.stringify({ mcpServers: { rachet: { url: endpoint } } }, null, 2),
      install: { label: 'Add to Cursor', href: cursorInstallUrl(endpoint) },
    },
    {
      id: 'vscode', name: 'VS Code', intro: 'Add a remote HTTP server to your workspace MCP configuration.',
      steps: ['Use Add to VS Code, or merge this entry into .vscode/mcp.json.', 'Start the Rachet server from the MCP view and complete browser sign-in.'],
      label: 'VS Code configuration', code: JSON.stringify({ servers: { rachet: { type: 'http', url: endpoint } } }, null, 2),
      install: { label: 'Add to VS Code', href: vsCodeInstallUrl(endpoint) },
    },
    {
      id: 'windsurf', name: 'Windsurf', intro: 'Add Rachet in Windsurf’s MCP settings.',
      steps: ['Merge this entry into your Windsurf MCP configuration.', 'Reconnect the server and complete OAuth sign-in if prompted.'],
      label: 'Windsurf configuration', code: JSON.stringify({ mcpServers: { rachet: { serverUrl: endpoint } } }, null, 2),
    },
    {
      id: 'zed', name: 'Zed', intro: 'Add Rachet as a context server in Zed.',
      steps: ['Merge this entry into your Zed settings.json.', 'Reconnect the server and complete OAuth sign-in if prompted.'],
      label: 'Zed configuration', code: JSON.stringify({ context_servers: { rachet: { url: endpoint } } }, null, 2),
    },
    {
      id: 'other', name: 'Other MCP client', intro: 'Use any client that supports remote HTTP MCP and OAuth.',
      steps: ['Add a remote HTTP MCP server with the URL below.', 'Choose OAuth and approve Rachet’s requested access in your browser.'],
      label: 'MCP server URL', code: endpoint,
    },
  ];
}

const welcomePrompt = 'Welcome new users with one friendly email, then end the journey.';

function WelcomePromptCard() {
  const [message, setMessage] = useState('');
  return <div className="grid gap-6 border-t border-border/80 pt-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] sm:gap-10">
    <div>
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">04 / YOUR FIRST JOURNEY</p>
      <h3 className="mt-3 text-2xl font-semibold tracking-tight">Start with a sentence.</h3>
      <span aria-hidden="true" className="mt-5 block h-[3px] w-8 bg-[var(--sunny)]" />
      <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">Your connected agent can use Rachet’s skill for the details.</p>
    </div>
    <div className="sm:border-l sm:border-border/80 sm:pl-9">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">EXAMPLE PROMPT</p>
      <blockquote className="mt-4 max-w-md text-xl font-medium leading-snug tracking-tight sm:text-2xl">“{welcomePrompt}”</blockquote>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={() => {
          void navigator.clipboard.writeText(welcomePrompt).then(() => setMessage('Copied')).catch(() => setMessage('Select and copy the prompt manually.'));
        }}>{message === 'Copied' ? <Check /> : <Copy />}{message === 'Copied' ? 'Copied' : 'Copy prompt'}</Button>
        <span role="status" className="text-xs text-muted-foreground">{message === 'Copied' ? 'Ready to paste.' : message}</span>
      </div>
    </div>
  </div>;
}

export function DeveloperSetup() {
  const origin = import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin;
  const endpoint = `${origin}/mcp`;
  const login = origin === 'https://rachet.dev' ? 'rachet auth login' : `rachet auth login --url ${origin}`;
  return <section aria-label="Developer setup" className="scroll-mt-24 space-y-4">
    <div><h2 className="text-xl font-semibold tracking-tight">Connect your tools</h2><p className="mt-1 text-sm text-muted-foreground">Use the CLI, your application, or an AI agent.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">01 · Install the CLI</CardTitle><CardDescription>Run in your terminal, then sign in.</CardDescription></CardHeader><CardContent><CopyCode label="CLI commands" code={`npm install -g @socialrobot-io/rachet\n${login}`} /></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">02 · Add the SDK</CardTitle><CardDescription>Run in your project. Keep API keys on your server.</CardDescription></CardHeader><CardContent className="space-y-3"><CopyCode label="SDK command" code="npm install @socialrobot-io/rachet-sdk" /><p className="text-xs text-muted-foreground">Create a key in <a href="/settings/api-keys" className="underline underline-offset-4">API keys</a>. <a href="https://github.com/socialrobot-io/rachet/tree/main/packages/sdk#readme" target="_blank" rel="noreferrer" className="underline underline-offset-4">SDK quick start ↗</a></p></CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle className="text-base">03 · Connect your AI agent</CardTitle><CardDescription>Choose your client, add Rachet, then sign in to approve access.</CardDescription></CardHeader><CardContent>
      <div className="divide-y overflow-hidden rounded-xl border">
        {mcpClients(endpoint).map((client) => <details key={client.id} name="mcp-client" className="group px-4 sm:px-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
              {client.id === 'other' ? <Puzzle aria-hidden="true" className="size-4 text-muted-foreground" /> : <img src={`/brand/mcp/${client.id}.svg`} alt="" className="size-4" />}
            </span>{client.name}</span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 pb-5 pl-11"><p className="text-sm text-muted-foreground">{client.intro}</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm">{client.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            {client.install && <Button asChild size="sm" variant="outline" className="gap-2"><a href={client.install.href}>{client.install.label}<ArrowUpRight aria-hidden="true" /></a></Button>}
            <CopyCode label={client.label} code={client.code} />
          </div>
        </details>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Your client needs remote HTTP MCP and OAuth support. No static Authorization header is needed.</p>
    </CardContent></Card>
    <WelcomePromptCard />
  </section>;
}
