import type { Enrollment, Workflow, WorkflowDefinition } from './types';

export type WorkflowView = {
  key: string;
  label: string;
  definition: WorkflowDefinition;
  publishedVersionId: string | null;
};

export function workflowViews(workflow: Workflow): WorkflowView[] {
  const versions = [...workflow.publishedVersions].sort((a, b) => b.version - a.version);
  const views: WorkflowView[] = versions.map((version, index) => ({
    key: String(version.version),
    label: `v${version.version}${index === 0 ? ' · Latest published' : ''}`,
    definition: version.definition,
    publishedVersionId: version.id,
  }));
  if (workflow.state === 'draft' || versions.length === 0) {
    views.push({ key: 'draft', label: 'Draft · Unpublished', definition: workflow.definition, publishedVersionId: null });
  }
  return views;
}

/** Default to the latest published graph, even when an unpublished draft exists. */
export function workflowView(workflow: Workflow, requested: string | null): WorkflowView | null {
  const views = workflowViews(workflow);
  return requested === null ? views[0] ?? null : views.find((view) => view.key === requested) ?? null;
}

export function enrollmentsForView(workflow: Workflow, view: WorkflowView, enrollments: Enrollment[]): Enrollment[] {
  return enrollments.filter((row) => row.sequenceId === workflow.id && row.sequenceVersionId === view.publishedVersionId);
}

export function enrollmentWorkflowHref(enrollment: Pick<Enrollment, 'sequenceId' | 'workflowVersion'>): string {
  return `/workflows/${enrollment.sequenceId}?version=${enrollment.workflowVersion}`;
}
