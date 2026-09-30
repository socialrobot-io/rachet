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
} from '@rachet/mcp-ext-skills';
import { createMcpServer } from '../apps/server/src/mcp.js';
import { createOperations } from '../apps/server/src/operations.js';
import type { RachetService } from '../apps/server/src/domain/service.js';

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
    const loaded = await loadSkillDirectory(new URL('../skills/rachet', import.meta.url).pathname);
    const mcp = new McpServer(
      { name: 'skills-test', version: '0.0.0' },
      { instructions: 'Start with skill://rachet/SKILL.md' },
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
    expect(client.getInstructions()).toContain('skill://rachet/SKILL.md');

    const resources = await client.listResources();
    const uris = resources.resources.map((resource) => resource.uri).sort();
    expect(uris).toContain('skill://rachet/SKILL.md');
    expect(uris).toContain(skillManifestUri('rachet'));
    expect(uris).toContain('skill://rachet/references/workflows.md');

    const skillMd = resources.resources.find((resource) => resource.uri === 'skill://rachet/SKILL.md');
    expect(skillMd?.name).toBe(skillResourceName('rachet', 'SKILL.md'));
    expect(skillMd?._meta).toMatchObject({ fastmcp: { skill: { name: 'rachet', is_manifest: false } } });

    const manifest = resources.resources.find((resource) => resource.uri === skillManifestUri('rachet'));
    expect(manifest?.name).toBe(skillResourceName('rachet', SKILL_MANIFEST_BASENAME));
    expect(manifest?._meta).toMatchObject({ fastmcp: { skill: { name: 'rachet', is_manifest: true } } });

    const listed = await client.request({ method: SKILLS_LIST_METHOD }, ListSkillsResultSchema);
    expect(listed.skills.map((skill) => skill.frontmatter.name)).toEqual(['rachet']);

    const got = await client.request(
      { method: SKILLS_GET_METHOD, params: { uri: 'skill://rachet/SKILL.md' } },
      GetSkillResultSchema,
    );
    expect(got.skill.frontmatter.description).toContain('Rachet workflows');

    const body = await client.readResource({ uri: 'skill://rachet/references/workflows.md' });
    expect(String((body.contents[0] as { text?: string }).text)).toContain('Schedules, deletion, and recovery');

    await client.close();
    await mcp.close();
  });

  it('createMcpServer lists rachet skill resources for Cursor-style discovery', async () => {
    const mcp = await createMcpServer({}, adminContext);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'rachet-skills-client', version: '0.0.0' });
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);

    const resources = await client.listResources();
    expect(resources.resources.some((resource) => resource.uri === 'skill://rachet/SKILL.md')).toBe(true);
    expect(resources.resources.some((resource) => resource.name === 'rachet/SKILL.md')).toBe(true);
    expect(client.getInstructions()).toContain('skill://rachet/SKILL.md');

    await client.close();
    await mcp.close();
  });

  it('exposes workflow and enrollment deletion through MCP tool discovery', async () => {
    const mcp = await createMcpServer(createOperations({} as RachetService), adminContext);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'rachet-delete-tools-client', version: '0.0.0' });
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    const workflowDelete = tools.tools.find((tool) => tool.name === 'workflow_delete');
    const workflowRevise = tools.tools.find((tool) => tool.name === 'workflow_revise');
    const enrollmentDelete = tools.tools.find((tool) => tool.name === 'enrollment_delete');
    expect(workflowDelete?.inputSchema).toMatchObject({
      properties: { dangerouslyDeleteWorkflow: { const: true } },
      required: expect.arrayContaining(['workspaceId', 'workflowId', 'dangerouslyDeleteWorkflow']),
    });
    expect(workflowRevise?.inputSchema).toMatchObject({
      required: expect.arrayContaining(['workspaceId', 'workflowId', 'expectedRevision', 'definition']),
    });
    expect(enrollmentDelete?.inputSchema).toMatchObject({
      required: expect.arrayContaining(['workspaceId', 'enrollmentId']),
    });

    await client.close();
    await mcp.close();
  });
});
