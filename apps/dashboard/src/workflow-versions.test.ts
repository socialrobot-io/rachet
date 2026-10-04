import { describe, expect, it } from 'vitest';
import { countsByStep } from './flow';
import { enrollmentWorkflowHref, enrollmentsForView, workflowView, workflowViews } from './workflow-versions';
import type { Enrollment, Workflow, WorkflowDefinition } from './types';

const definition = (description: string, purpose = 'transactional'): WorkflowDefinition => ({
  schemaVersion: '1', description, purpose, trigger: { type: 'manual' }, entryNodeId: 'wait',
  nodes: [{ id: 'wait', type: 'delay', durationSeconds: 60, next: 'done' }, { id: 'done', type: 'end', reason: 'completed' }],
});
const workflow: Workflow = {
  id: 'welcome', workspaceId: 'workspace', name: 'Welcome', state: 'draft', revision: 3,
  definition: definition('Unpublished changes'), createdAt: '2026-10-01', updatedAt: '2026-10-02',
  // Intentionally unsorted: version numbers, not response order, select the latest.
  publishedVersions: [
    { id: 'version-1', sequenceId: 'welcome', version: 1, createdAt: '2026-10-01', definition: definition('Original') },
    { id: 'version-2', sequenceId: 'welcome', version: 2, createdAt: '2026-10-02', definition: definition('Marketing welcome', 'marketing') },
  ],
};
const enrollment = (id: string, version: number, sequenceId = workflow.id): Enrollment => ({
  id, workspaceId: 'workspace', sequenceVersionId: `version-${version}`, sequenceId, workflowVersion: version,
  contactId: id, state: 'waiting', currentStepId: 'wait', workflowId: id, input: {}, idempotencyKey: id,
  createdAt: '2026-10-01', updatedAt: '2026-10-02', contactEmail: `${id}@example.com`, contactFields: {},
  workflowName: 'Welcome', definition: definition('Enrollment graph'),
});

describe('workflow version views', () => {
  it('defaults to the latest published graph, even with a newer draft', () => {
    expect(workflowView(workflow, null)).toMatchObject({ key: '2', definition: { description: 'Marketing welcome', purpose: 'marketing' } });
    expect(workflowViews(workflow).map((view) => view.key)).toEqual(['2', '1', 'draft']);
    expect(workflow.publishedVersions.map((version) => version.version)).toEqual([1, 2]);
  });

  it('shows historical snapshots with no enrollments and keeps draft separate', () => {
    expect(workflowView(workflow, '1')?.definition.description).toBe('Original');
    expect(workflowView(workflow, 'draft')?.definition.description).toBe('Unpublished changes');
    expect(workflowViews({ ...workflow, state: 'published' }).map((view) => view.key)).toEqual(['2', '1']);
    expect(workflowView({ ...workflow, publishedVersions: [] }, null)?.key).toBe('draft');
  });

  it('does not silently show a different graph for an invalid version link', () => {
    for (const requested of ['99', 'v1', '0', '']) expect(workflowView(workflow, requested)).toBeNull();
  });

  it('counts only the selected version when versions reuse the same step IDs', () => {
    const rows = [enrollment('old', 1), enrollment('new', 2), enrollment('other-workflow', 2, 'other')];
    const selected = workflowView(workflow, '2')!;
    const related = enrollmentsForView(workflow, selected, rows);
    expect(related.map((row) => row.id)).toEqual(['new']);
    expect(countsByStep(related).get('wait')).toBe(1);
    expect(enrollmentsForView(workflow, workflowView(workflow, 'draft')!, rows)).toEqual([]);
    expect(enrollmentsForView(workflow, selected, [])).toEqual([]);
  });

  it('links an enrollment to its pinned version', () => {
    expect(enrollmentWorkflowHref(enrollment('old', 1))).toBe('/workflows/welcome?version=1');
  });
});
