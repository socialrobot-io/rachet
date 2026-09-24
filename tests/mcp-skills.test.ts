import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  GetSkillResultSchema,
  ListSkillsResultSchema,
  SKILL_MANIFEST_BASENAME,
  SKILLS_EXTENSION_ID,
  SKILLS_GET_METHOD,
  SKILLS_LIST_METHOD,
  loadSkillDirectory,
  parseSkillFrontmatter,
  registerFastMcpSkills,
  skillManifestUri,
  skillResourceName,
} from '@reflow/mcp-ext-skills';
import { createMcpServer } from '../apps/server/src/mcp.js';
import { createOperations } from '../apps/server/src/operations.js';
import type { ReflowService } from '../apps/server/src/domain/service.js';

const adminContext = {
  principal: {
    userId: 'test',
    workspaceIds: [],
    workspaceRoles: {},
    deploymentAdmin: true,
    scopes: ['rachet:read', 'rachet:write', 'rachet:send'],
  },
  requestId: 'test',
} as const;

describe('mcp-ext-skills FastMCP + SEP-2640', () => {
  it('parses skill frontmatter', () => {
    const frontmatter = parseSkillFrontmatter(`---
name: demo
description: A demo skill.
---

# Body
`);
    expect(frontmatter).toEqual({ name: 'demo', description: 'A demo skill.' });
  });

  it('lists FastMCP-shaped skill resources and answers skills/list', async () => {
    const loaded = await loadSkillDirectory(new URL('../skills/reflow', import.meta.url).pathname);
    const mcp = new McpServer(
      { name: 'skills-test', version: '0.0.0' },
      { instructions: 'Start with skill://reflow/SKILL.md' },
    );
    registerFastMcpSkills(mcp, {
      skills: [loaded],
      supportingFiles: 'resources',
      cacheHint: { ttlMs: 60_000, cacheScope: 'public' },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'skills-test-client', version: '0.0.0' });
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);

    expect(client.getServerCapabilities()?.extensions?.[SKILLS_EXTENSION_ID]).toEqual({});
    expect(client.getServerCapabilities()?.experimental?.[SKILLS_EXTENSION_ID]).toEqual({});
    expect(client.getInstructions()).toContain('skill://reflow/SKILL.md');

    const resources = await client.listResources();
    const uris = resources.resources.map((resource) => resource.uri).sort();
    expect(uris).toContain('skill://reflow/SKILL.md');
    expect(uris).toContain(skillManifestUri('reflow'));
    expect(uris).toContain('skill://reflow/references/workflows.md');

    const skillMd = resources.resources.find((resource) => resource.uri === 'skill://reflow/SKILL.md');
    expect(skillMd?.name).toBe(skillResourceName('reflow', 'SKILL.md'));
    expect(skillMd?._meta).toMatchObject({ fastmcp: { skill: { name: 'reflow', is_manifest: false } } });

    const manifest = resources.resources.find((resource) => resource.uri === skillManifestUri('reflow'));
    expect(manifest?.name).toBe(skillResourceName('reflow', SKILL_MANIFEST_BASENAME));
    expect(manifest?._meta).toMatchObject({ fastmcp: { skill: { name: 'reflow', is_manifest: true } } });

    const listed = await client.request({ method: SKILLS_LIST_METHOD }, ListSkillsResultSchema);
    expect(listed.skills.map((skill) => skill.frontmatter.name)).toEqual(['reflow']);

    const got = await client.request(
      { method: SKILLS_GET_METHOD, params: { uri: 'skill://reflow/SKILL.md' } },
      GetSkillResultSchema,
    );
    expect(got.skill.frontmatter.description).toContain('Rachet workflows');

    const body = await client.readResource({ uri: 'skill://reflow/references/workflows.md' });
    expect(String((body.contents[0] as { text?: string }).text)).toContain('Author from natural language');

    await client.close();
    await mcp.close();
  });

  it('createMcpServer lists reflow skill resources for Cursor-style discovery', async () => {
    const mcp = await createMcpServer({}, adminContext);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'reflow-skills-client', version: '0.0.0' });
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);

    const resources = await client.listResources();
    expect(resources.resources.some((resource) => resource.uri === 'skill://reflow/SKILL.md')).toBe(true);
    expect(resources.resources.some((resource) => resource.name === 'reflow/SKILL.md')).toBe(true);
    expect(client.getInstructions()).toContain('skill://reflow/SKILL.md');

    await client.close();
    await mcp.close();
  });

  it('exposes workflow and enrollment deletion through MCP tool discovery', async () => {
    const mcp = await createMcpServer(createOperations({} as ReflowService), adminContext);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'reflow-delete-tools-client', version: '0.0.0' });
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    const workflowDelete = tools.tools.find((tool) => tool.name === 'workflow_delete');
    const enrollmentDelete = tools.tools.find((tool) => tool.name === 'enrollment_delete');
    expect(workflowDelete?.inputSchema).toMatchObject({
      properties: { dangerouslyDeleteWorkflow: { const: true } },
      required: expect.arrayContaining(['workspaceId', 'workflowId', 'dangerouslyDeleteWorkflow']),
    });
    expect(enrollmentDelete?.inputSchema).toMatchObject({
      required: expect.arrayContaining(['workspaceId', 'enrollmentId']),
    });

    await client.close();
    await mcp.close();
  });
});
