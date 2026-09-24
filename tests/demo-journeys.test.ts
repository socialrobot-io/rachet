import { describe, expect, it } from 'vitest';
import { workflowDefinitionSchema } from '../packages/contracts/src/index.js';
import { validateActionNodes } from '../apps/server/src/domain/action-catalog.js';
import { simulateWorkflow } from '../apps/server/src/domain/simulate.js';
import { collectEmailSendTemplateRefs } from '../apps/server/src/domain/template-refs.js';
import { demoJourneys, demoPeople, demoTemplates, demoWorkflowId, type DemoTemplateVersions } from '../scripts/demo-journeys.js';

const versions = Object.fromEntries(demoTemplates.map((template, index) => [
  template.key,
  `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
])) as DemoTemplateVersions;

const journeys = demoJourneys(versions);
const contact = { firstName: 'Ava', hasUnfinishedWork: true };

function path(index: number, events: string[] = [], fields = contact) {
  const journey = journeys[index];
  if (!journey) throw new Error(`Missing demo journey at index ${index}`);
  return simulateWorkflow(journey.definition, fields, {}, events.map((eventType) => ({ eventType, data: {} })));
}

describe('local demo journeys', () => {
  it('keeps synthetic workflow IDs separate across workspaces', () => {
    expect(demoWorkflowId('workspace-a', 'demo-ava')).not.toBe(demoWorkflowId('workspace-b', 'demo-ava'));
  });
  it('contains three valid workflows with pinned, supported email actions', () => {
    expect(journeys).toHaveLength(3);
    for (const { definition } of journeys) {
      const validated = workflowDefinitionSchema.parse(definition);
      expect(() => validateActionNodes(validated.nodes)).not.toThrow();
      expect(collectEmailSendTemplateRefs(validated).every((ref) => Object.values(versions).includes(ref.templateVersionId ?? ''))).toBe(true);
      expect(validated.trigger.type).toBe('manual');
    }
  });

  it('onboards only after the app emits product events, with a finite timeout path', () => {
    expect(path(0, ['project.created.v1', 'teammate.invited.v1']).result).toBe('First project shared with a teammate');
    expect(path(0, ['project.created.v1']).result).toBe('Project created; collaboration tip sent');
    expect(path(0).result).toBe('No project created after help');
    expect(path(0).trace.filter((step) => step.action === 'email.send')).toHaveLength(2);
  });

  it('stops trial mail after conversion and distinguishes active from inactive workspaces', () => {
    expect(path(1, ['subscription.activated.v1']).trace.filter((step) => step.action === 'email.send')).toHaveLength(0);
    expect(path(1, ['workspace.active.v1', 'subscription.activated.v1']).result).toBe('Paid subscription activated');
    expect(path(1, ['workspace.active.v1']).trace.find((step) => step.nodeId === 'send_trial_value')).toBeDefined();
    expect(path(1).result).toBe('Trial ended without conversion');
    expect(path(1).trace.filter((step) => step.action === 'email.send')).toHaveLength(2);
  });

  it('personalizes the single winback email and ends without repeated sends', () => {
    expect(path(2).trace.find((step) => step.nodeId === 'send_resume_work')).toBeDefined();
    expect(path(2, ['session.started.v1'], { firstName: 'Ava', hasUnfinishedWork: false }).trace.find((step) => step.nodeId === 'send_whats_new')).toBeDefined();
    expect(path(2, ['session.started.v1']).result).toBe('User returned');
    expect(path(2).result).toBe('No return; stop messaging');
    expect(path(2).trace.filter((step) => step.action === 'email.send')).toHaveLength(1);
  });

  it('seeds people onto real journey steps, including completed onboarding paths', () => {
    const byName = new Map(journeys.map((journey) => [journey.name, journey.definition]));
    expect(demoPeople.length).toBeGreaterThanOrEqual(10);
    expect(new Set(demoPeople.map((person) => person.externalId)).size).toBe(demoPeople.length);
    expect(demoPeople.some((person) => person.state === 'completed' && person.journeyName === 'Demo · From signup to a shared project')).toBe(true);
    expect(demoPeople.some((person) => person.state === 'waiting')).toBe(true);
    for (const person of demoPeople) {
      const definition = byName.get(person.journeyName);
      expect(definition).toBeDefined();
      if (!definition) continue;
      expect(definition.nodes.some((node) => node.id === person.currentStepId)).toBe(true);
      expect(person.fields.demo).toBe(true);
    }
  });
});
