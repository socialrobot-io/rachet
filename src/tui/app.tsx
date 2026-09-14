import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { ReflowClient } from '../client.js';
import { workflowDefinitionSchema, type FlowNode, type WorkflowDefinition } from '../domain/contracts.js';
import { findNode, nodeDetails, nodeRoutes, nodeTitle } from './node-explorer.js';
import { openWorkflowSvg } from './svg-preview.js';

type Workflow = { id: string; name: string; state: string; revision: number; definition: WorkflowDefinition };
type Focus = 'workflows' | 'node';

function useTerminalWidth(): number {
  const { stdout } = useStdout();
  const [width, setWidth] = useState(stdout.columns ?? 100);
  useEffect(() => {
    const resize = () => setWidth(stdout.columns ?? 100);
    stdout.on('resize', resize);
    return () => { stdout.off('resize', resize); };
  }, [stdout]);
  return width;
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

function triggerLabel(definition: WorkflowDefinition): string {
  if (definition.trigger.type === 'event') return `Event · ${definition.trigger.eventType}`;
  if (definition.trigger.type === 'schedule') return `Schedule · ${definition.trigger.at}`;
  return 'Manual trigger';
}

function nodeColor(node: FlowNode): 'cyan' | 'yellow' | 'magenta' | 'green' | 'blue' {
  switch (node.type) {
    case 'action': return 'cyan';
    case 'delay': return 'yellow';
    case 'wait_for_event': return 'blue';
    case 'branch': return 'magenta';
    case 'end': return 'green';
  }
}

function NodeScreen({ workflow, node, history, routeIndex, focused }: {
  workflow: Workflow;
  node: FlowNode;
  history: string[];
  routeIndex: number;
  focused: boolean;
}) {
  const definition = workflow.definition;
  const routes = nodeRoutes(node);
  const ordinal = definition.nodes.findIndex((candidate) => candidate.id === node.id) + 1;
  const recent = [...history.slice(-3), node.id];

  return <Box flexDirection="column">
    <Box justifyContent="space-between">
      <Text bold>{workflow.name}</Text>
      <Text dimColor>v{workflow.revision} · {workflow.state}</Text>
    </Box>
    <Text dimColor>{definition.description}</Text>
    <Box marginTop={1} gap={1}>
      <Text backgroundColor="gray" color="black"> {triggerLabel(definition)} </Text>
      <Text dimColor>{recent.join('  ›  ')}</Text>
    </Box>

    <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={focused ? nodeColor(node) : 'gray'} paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={nodeColor(node)} bold>{node.type.toUpperCase().replaceAll('_', ' ')}</Text>
        <Text dimColor>Node {ordinal} of {definition.nodes.length} · Step {history.length + 1}</Text>
      </Box>
      <Text bold>{nodeTitle(node)}</Text>
      <Text dimColor>ID · {node.id}</Text>
      <Text> </Text>
      {nodeDetails(node).map((detail) => <Box key={detail.label}>
        <Box width={18}><Text dimColor>{detail.label}</Text></Box>
        <Text>{detail.value}</Text>
      </Box>)}
    </Box>

    <Box marginTop={1} flexDirection="column">
      <Text bold>{routes.length === 0 ? 'Workflow complete' : 'Choose the next path'}</Text>
      {routes.map((route, index) => {
        const target = findNode(definition, route.target);
        const selected = focused && index === routeIndex;
        return <Box key={`${route.label}:${route.target}`} marginTop={1} paddingX={1}>
          {selected
            ? <Text backgroundColor="cyan" color="black" bold>{' › '}{route.label}</Text>
            : <Text>{'   '}{route.label}</Text>}
          <Text dimColor>  {route.target}{target ? ` · ${nodeTitle(target)}` : ''}</Text>
        </Box>;
      })}
      {routes.length === 0 && <Text color="green">This path ends with “{nodeTitle(node)}”.</Text>}
    </Box>
  </Box>;
}

export function ReflowTui({ client, workspaceId }: { client: ReflowClient; workspaceId: string }) {
  const { exit } = useApp();
  const width = useTerminalWidth();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [focus, setFocus] = useState<Focus>('workflows');
  const [nodeId, setNodeId] = useState<string>();
  const [history, setHistory] = useState<string[]>([]);
  const [routeIndex, setRouteIndex] = useState(0);
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
  useEffect(() => {
    setNodeId(active?.definition.entryNodeId);
    setHistory([]);
    setRouteIndex(0);
  }, [active?.id, active?.definition.entryNodeId]);
  const currentNode = active ? findNode(active.definition, nodeId) ?? findNode(active.definition, active.definition.entryNodeId) : undefined;
  const routes = currentNode ? nodeRoutes(currentNode) : [];
  const windowStart = Math.max(0, selected - 13);
  const windowed = visible.slice(windowStart, windowStart + 14);

  const goBack = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setNodeId(previous);
    setHistory((value) => value.slice(0, -1));
    setRouteIndex(0);
  };
  const followRoute = () => {
    const route = routes[routeIndex];
    if (!route || !currentNode) return;
    setHistory((value) => [...value, currentNode.id]);
    setNodeId(route.target);
    setRouteIndex(0);
  };

  useInput((input, key) => {
    if (searching) {
      if (key.escape) { setQuery(''); setSearching(false); }
      else if (key.return) setSearching(false);
      else if (key.backspace || key.delete) setQuery((value) => value.slice(0, -1));
      else if (!key.ctrl && !key.meta && input) setQuery((value) => value + input);
      return;
    }
    if (input === 'q') exit();
    else if (input === '/') { setFocus('workflows'); setSearching(true); }
    else if (input === 'r') void load();
    else if (input === 'o' && active) {
      setStatus('Opening SVG…');
      void openWorkflowSvg(active.id, active.definition)
        .then((path) => setStatus(`Opened ${path}`))
        .catch((error: unknown) => setStatus(error instanceof Error ? `Error: ${error.message}` : 'Unable to open SVG'));
    }
    else if (input === '\t') setFocus((value) => value === 'workflows' ? 'node' : 'workflows');
    else if (key.escape) setFocus('workflows');
    else if (focus === 'node' && (key.backspace || key.leftArrow || input === 'h')) goBack();
    else if (focus === 'node' && input === 'g' && active) { setNodeId(active.definition.entryNodeId); setHistory([]); setRouteIndex(0); }
    else if (focus === 'node' && (key.return || key.rightArrow || input === 'l')) followRoute();
    else if (focus === 'node' && (key.upArrow || input === 'k')) setRouteIndex((value) => Math.max(0, value - 1));
    else if (focus === 'node' && (key.downArrow || input === 'j')) setRouteIndex((value) => Math.min(Math.max(routes.length - 1, 0), value + 1));
    else if (focus === 'workflows' && key.return && active) setFocus('node');
    else if (focus === 'workflows' && (key.upArrow || input === 'k')) setSelected((value) => Math.max(0, value - 1));
    else if (focus === 'workflows' && (key.downArrow || input === 'j')) setSelected((value) => Math.min(Math.max(visible.length - 1, 0), value + 1));
  });

  const listWidth = Math.min(36, Math.max(24, Math.floor(width * 0.3)));
  const compact = width < 80;

  return <Box flexDirection="column" paddingX={1}>
    <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
      <Text bold color="cyan">REFLOW</Text>
      <Text dimColor>{workspaceId}</Text>
    </Box>
    <Box marginTop={1} gap={1} flexDirection={compact ? 'column' : 'row'}>
      <Box width={compact ? '100%' : listWidth} flexDirection="column" borderStyle="round" borderColor={focus === 'workflows' ? 'cyan' : 'gray'} paddingX={1}>
        <Text bold>Workflows ({visible.length})</Text>
        {searching ? <Text color="yellow">/ {query || 'type to filter'}</Text> : <Text>/ {query || 'search'}</Text>}
        <Text> </Text>
        {windowed.map((workflow, index) => index + windowStart === selected
          ? <Text key={workflow.id} color="cyan" bold>› {workflow.name} <Text dimColor>v{workflow.revision} · {workflow.state}</Text></Text>
          : <Text key={workflow.id}>  {workflow.name} <Text dimColor>v{workflow.revision} · {workflow.state}</Text></Text>)}
      </Box>
      <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor={focus === 'node' ? 'cyan' : 'gray'} paddingX={1}>
        {active && currentNode
          ? <NodeScreen workflow={active} node={currentNode} history={history} routeIndex={routeIndex} focused={focus === 'node'} />
          : <Text>{query ? 'No workflows match this query.' : 'No workflows in this workspace.'}</Text>}
      </Box>
    </Box>
    <Box paddingX={1} justifyContent="space-between">
      <Text dimColor>Tab focus  ↑↓/jk choose  Enter/→ follow  Backspace/← back  g start  / search  o SVG  q quit</Text>
      {status.startsWith('Error:') ? <Text color="red">{status}</Text> : <Text>{status}</Text>}
    </Box>
  </Box>;
}
