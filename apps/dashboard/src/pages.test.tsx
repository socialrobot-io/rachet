import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnrollmentDetailPage, EnrollmentsPage, WorkflowDetailPage, WorkflowsPage } from './pages';
import { useWorkspaceData } from './workspace-data';
import type { Enrollment, Workflow, WorkflowDefinition } from './types';

vi.mock('./workspace-data', () => ({ useWorkspaceData: vi.fn() }));
vi.mock('./auth', () => ({ useAuth: () => ({ workspaces: [{ id: 'workspace', name: 'Test workspace' }] }) }));

const graph = (description: string, purpose = 'transactional'): WorkflowDefinition => ({
  schemaVersion: '1', description, purpose, trigger: { type: 'manual' }, entryNodeId: 'wait',
  nodes: [{ id: 'wait', type: 'delay', durationSeconds: 60, next: 'done' }, { id: 'done', type: 'end', reason: 'completed' }],
});
const workflow: Workflow = {
  id: 'welcome', workspaceId: 'workspace', name: 'Welcome', state: 'draft', revision: 3,
  definition: graph('Draft description'), createdAt: '2026-10-01', updatedAt: '2026-10-02',
  publishedVersions: [
    { id: 'version-1', sequenceId: 'welcome', version: 1, createdAt: '2026-10-01', definition: graph('Original description') },
    { id: 'version-2', sequenceId: 'welcome', version: 2, createdAt: '2026-10-02', definition: graph('Marketing description', 'marketing') },
  ],
};
const enrollments: Enrollment[] = [1, 2].map((version) => ({
  id: `enrollment-${version}`, workspaceId: 'workspace', sequenceVersionId: `version-${version}`, sequenceId: workflow.id,
  workflowVersion: version, contactId: `contact-${version}`, state: 'waiting', currentStepId: 'wait', workflowId: 'run',
  input: {}, idempotencyKey: `enrollment-${version}`, createdAt: '2026-10-01', updatedAt: '2026-10-02',
  contactEmail: `person-v${version}@example.com`, contactFields: {}, workflowName: workflow.name,
  definition: workflow.publishedVersions[version - 1].definition,
}));

function render(path: string) {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/workflows" element={<WorkflowsPage />} />
    <Route path="/workflows/:workflowId" element={<WorkflowDetailPage />} />
    <Route path="/enrollments" element={<EnrollmentsPage />} />
    <Route path="/enrollments/:enrollmentId" element={<EnrollmentDetailPage />} />
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(useWorkspaceData).mockReturnValue({
    workspaceId: 'workspace', workflows: [workflow], enrollments, messages: [], error: null, loading: false, setEnrollments: vi.fn(),
  });
});

describe('version visibility in the dashboard', () => {
  it('shows the number of published versions on workflow cards', () => {
    expect(render('/workflows')).toContain('2 published versions');
  });

  it('defaults to the latest graph and counts only its active enrollment', () => {
    const html = render('/workflows/welcome');
    expect(html).toContain('Marketing description');
    expect(html).toContain('v2 · Published');
    expect(html).toContain('Marketing');
    expect(html).toContain('1 active');
    expect(html).toContain('person-v2@example.com');
    expect(html).not.toContain('person-v1@example.com');
    expect(html).toContain('/enrollments?workflow=welcome&amp;version=2');
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
  });

  it('opens a pinned historical graph and its enrollment', () => {
    const html = render('/workflows/welcome?version=1');
    expect(html).toContain('Original description');
    expect(html).toContain('v1 · Published');
    expect(html).toContain('person-v1@example.com');
    expect(html).not.toContain('person-v2@example.com');
  });

  it('renders published versions without enrollments and gives drafts a separate empty state', () => {
    const draft = render('/workflows/welcome?version=draft');
    expect(draft).toContain('Draft description');
    expect(draft).toContain('Drafts have no enrollments');
    expect(draft).toContain('0 active');
    vi.mocked(useWorkspaceData).mockReturnValue({ ...useWorkspaceData(), enrollments: [] });
    expect(render('/workflows/welcome?version=1')).toContain('Original description');
  });

  it('shows pinned version badges and links in both enrollment views', () => {
    const list = render('/enrollments');
    expect(list).toContain('>v1<');
    expect(list).toContain('>v2<');
    expect(list).toContain('/workflows/welcome?version=1');
    const detail = render('/enrollments/enrollment-1');
    expect(detail).toContain('>v1<');
    expect(detail).toContain('/workflows/welcome?version=1');
  });

  it('scopes the enrollment list and totals to the version in the link', () => {
    const html = render('/enrollments?workflow=welcome&version=1');
    expect(html).toContain('person-v1@example.com');
    expect(html).not.toContain('person-v2@example.com');
    expect(html).toContain('1 contact');
    expect(html).toContain('Showing 1');
  });
});
