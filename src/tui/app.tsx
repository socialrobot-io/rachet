import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { ReflowClient } from '../client.js';
import { workflowDefinitionSchema, type WorkflowDefinition } from '../domain/contracts.js';
import { WorkflowImage } from './workflow-image.js';
import { openWorkflowSvg } from './svg-preview.js';

type Workflow = {
  id: string;
  name: string;
  state: string;
  revision: number;
  definition: WorkflowDefinition;
};

function useTerminalSize(): { width: number; height: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState({ width: stdout.columns ?? 100, height: stdout.rows ?? 30 });
  useEffect(() => {
    const resize = () => setSize({ width: stdout.columns ?? 100, height: stdout.rows ?? 30 });
    stdout.on('resize', resize);
    return () => { stdout.off('resize', resize); };
  }, [stdout]);
  return size;
}

function parseWorkflows(value: unknown): Workflow[] {
  if (!Array.isArray(value)) throw new Error('workflow.list returned an invalid response');
  return value.map((row) => {
    if (typeof row !== 'object' || row === null) throw new Error('workflow.list returned an invalid workflow');
    const record = row as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.name !== 'string') throw new Error('Workflow identity is missing');
    return {
      id: record.id,
      name: record.name,
      state: typeof record.state === 'string' ? record.state : 'draft',
      revision: typeof record.revision === 'number' ? record.revision : 1,
      definition: workflowDefinitionSchema.parse(record.definition),
    };
  });
}

export function ReflowTui({ client, workspaceId }: { client: ReflowClient; workspaceId: string }) {
  const { exit } = useApp();
  const { width, height } = useTerminalSize();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState('Loading workflows…');

  const load = useCallback(async () => {
    setStatus('Loading workflows…');
    try {
      setWorkflows(parseWorkflows(await client.call('workflow.list', { workspaceId })));
      setStatus('Ready');
    } catch (error) {
      setStatus(error instanceof Error ? `Error: ${error.message}` : 'Unable to load workflows');
    }
  }, [client, workspaceId]);

  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => workflows.filter((workflow) => workflow.name.toLowerCase().includes(query.toLowerCase())), [query, workflows]);
  useEffect(() => { setSelected((value) => Math.min(value, Math.max(visible.length - 1, 0))); }, [visible.length]);
  const active = visible[selected];
  const windowStart = Math.max(0, selected - 13);
  const windowed = visible.slice(windowStart, windowStart + 14);

  useInput((input, key) => {
    if (searching) {
      if (key.escape) { setQuery(''); setSearching(false); }
      else if (key.return) setSearching(false);
      else if (key.backspace || key.delete) setQuery((value) => value.slice(0, -1));
      else if (!key.ctrl && !key.meta && input) setQuery((value) => value + input);
      return;
    }
    if (input === 'q') exit();
    else if (input === '/') setSearching(true);
    else if (input === 'r') void load();
    else if (input === 'o' && active) {
      setStatus('Opening SVG…');
      void openWorkflowSvg(active.id, active.definition)
        .then((path) => setStatus(`Opened ${path}`))
        .catch((error: unknown) => setStatus(error instanceof Error ? `Error: ${error.message}` : 'Unable to open SVG'));
    }
    else if (key.upArrow || input === 'k') setSelected((value) => Math.max(0, value - 1));
    else if (key.downArrow || input === 'j') setSelected((value) => Math.min(Math.max(visible.length - 1, 0), value + 1));
  });

  const listWidth = Math.min(36, Math.max(24, Math.floor(width * 0.32)));
  const compact = width < 80;
  const graphWidth = Math.max(30, compact ? width - 6 : width - listWidth - 7);
  const graphHeight = Math.max(10, height - (compact ? 15 : 9));

  return <Box flexDirection="column" paddingX={1}>
    <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
      <Text bold color="cyan">REFLOW</Text>
      <Text dimColor>{workspaceId}</Text>
    </Box>
    <Box marginTop={1} gap={1} flexDirection={compact ? 'column' : 'row'}>
      <Box width={compact ? '100%' : listWidth} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Workflows ({visible.length})</Text>
        {searching
          ? <Text color="yellow">/ {query || 'type to filter'}</Text>
          : <Text>/ {query || 'search'}</Text>}
        <Text> </Text>
        {windowed.map((workflow, index) => index + windowStart === selected
          ? <Text key={workflow.id} color="cyan" bold>› {workflow.name} <Text dimColor>v{workflow.revision} · {workflow.state}</Text></Text>
          : <Text key={workflow.id}>  {workflow.name} <Text dimColor>v{workflow.revision} · {workflow.state}</Text></Text>)}
      </Box>
      <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold>{active?.name ?? 'Workflow'}</Text>
          <Text color="magenta">SVG</Text>
        </Box>
        <Text dimColor>{active?.definition.description ?? ''}</Text>
        <Text> </Text>
        {active
          ? <WorkflowImage definition={active.definition} width={graphWidth} height={graphHeight} />
          : <Text>{query ? 'No workflows match this query.' : 'No workflows in this workspace.'}</Text>}
      </Box>
    </Box>
    <Box paddingX={1} justifyContent="space-between">
      <Text dimColor>↑↓/jk select  / search  o open SVG  r refresh  q quit</Text>
      {status.startsWith('Error:') ? <Text color="red">{status}</Text> : <Text>{status}</Text>}
    </Box>
  </Box>;
}
