import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentView } from './components/DocumentView';
import type { WorkflowDefinition } from './types';

const definition: WorkflowDefinition = {
  schemaVersion: '1',
  description: 'Record that a workflow was created.',
  trigger: { type: 'event', eventType: 'signup.completed.v1' },
  entryNodeId: 'wait_created',
  nodes: [
    {
      id: 'wait_created',
      type: 'wait_for_event',
      eventType: 'workflow.created.v1',
      timeoutSeconds: 172800,
      onEvent: 'mark_created',
      onTimeout: 'timed_out',
    },
    {
      id: 'mark_created',
      type: 'action',
      action: 'contact.update',
      input: { fields: { literal: { onboardingStatus: 'workflow_created' } } },
      next: 'created_exit',
    },
    { id: 'created_exit', type: 'end', reason: 'workflow_created' },
    { id: 'timed_out', type: 'end', reason: 'timed_out' },
  ],
};

describe('DocumentView contact.update', () => {
  it('shows the fields the step writes under the action name', () => {
    const html = renderToStaticMarkup(<DocumentView definition={definition} />);
    expect(html).toContain('contact.update');
    expect(html).toContain('onboardingStatus = workflow_created');
  });
});
