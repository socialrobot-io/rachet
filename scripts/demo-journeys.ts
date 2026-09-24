import type { FlowNode, WorkflowDefinition } from '../packages/contracts/src/index.js';

/** Illustrative project-collaboration SaaS journeys; enrollment is always explicit. */
export const demoTemplates = [
  { key: 'welcome', name: 'Demo / Welcome to your workspace', subject: 'Your first project starts here', preheader: 'One small step to get your team moving.', body: 'Hi {{contact.firstName}},\n\nCreate a project around something your team is already working on. Add a goal and your first task; you can invite a teammate when you are ready.\n\n— The team' },
  { key: 'setup_help', name: 'Demo / Project setup help', subject: 'Need a hand getting your first project going?', preheader: 'A two-minute way to get unstuck.', body: 'Hi {{contact.firstName}},\n\nStart with a project name and one task. You do not need a perfect plan. If something is blocking you, reply and tell us where you got stuck.\n\n— The team' },
  { key: 'collaboration_tip', name: 'Demo / Invite your teammate', subject: 'Your project is ready for a teammate', preheader: 'Give the work a shared home.', body: 'Hi {{contact.firstName}},\n\nYou have a project underway. Invite one teammate and assign a task so you can see progress together.\n\n— The team' },
  { key: 'trial_value', name: 'Demo / Trial value recap', subject: 'You are already making progress', preheader: 'Keep the momentum going during your trial.', body: 'Hi {{contact.firstName}},\n\nYour team has started using the workspace. Keep the project moving, invite collaborators, and decide whether a paid plan fits before your trial ends.\n\n— The team' },
  { key: 'trial_help', name: 'Demo / Trial activation help', subject: 'Let us help you get value from your trial', preheader: 'A simple next step for your team.', body: 'Hi {{contact.firstName}},\n\nThere is still time to try a real project with your team. Create one project and bring in a collaborator. Reply if you would like help setting it up.\n\n— The team' },
  { key: 'trial_ending', name: 'Demo / Trial ending', subject: 'Your trial ends tomorrow', preheader: 'Choose the right next step for your team.', body: 'Hi {{contact.firstName}},\n\nYour trial ends tomorrow. Review your workspace and choose a plan only if it is useful for your team. No action is needed if you do not want to continue.\n\n— The team' },
  { key: 'resume_work', name: 'Demo / Resume unfinished work', subject: 'Your project is right where you left it', preheader: 'Pick up one task without starting over.', body: 'Hi {{contact.firstName}},\n\nYou still have work in progress. Return to your project and take one small next step when the timing is right.\n\n— The team' },
  { key: 'whats_new', name: 'Demo / What is new', subject: 'A fresh way to get your team moving', preheader: 'See what has changed since your last visit.', body: 'Hi {{contact.firstName}},\n\nIf your priorities have changed, start a new project for the work that matters now. Your workspace is ready whenever you are.\n\n— The team' },
] as const;

export type DemoTemplateKey = (typeof demoTemplates)[number]['key'];
export type DemoTemplateVersions = Record<DemoTemplateKey, string>;

/** Stable local-only people fixtures. Seeded as enrollments without Temporal or send work. */
export const demoPeople = [
  {
    externalId: 'demo-ava',
    email: 'ava.chen@example.com',
    fields: { firstName: 'Ava', lastName: 'Chen', demo: true },
    journeyName: 'Demo · From signup to a shared project',
    state: 'waiting' as const,
    currentStepId: 'wait_first_project',
    events: [] as string[],
    hoursAgo: 8,
  },
  {
    externalId: 'demo-leo',
    email: 'leo.nguyen@example.com',
    fields: { firstName: 'Leo', lastName: 'Nguyen', demo: true },
    journeyName: 'Demo · From signup to a shared project',
    state: 'waiting' as const,
    currentStepId: 'wait_project_after_help',
    events: [] as string[],
    hoursAgo: 52,
  },
  {
    externalId: 'demo-noah',
    email: 'noah.patel@example.com',
    fields: { firstName: 'Noah', lastName: 'Patel', demo: true },
    journeyName: 'Demo · From signup to a shared project',
    state: 'waiting' as const,
    currentStepId: 'wait_teammate_invite',
    events: ['project.created.v1'],
    hoursAgo: 30,
  },
  {
    externalId: 'demo-mia',
    email: 'mia.rossi@example.com',
    fields: { firstName: 'Mia', lastName: 'Rossi', demo: true },
    journeyName: 'Demo · From signup to a shared project',
    state: 'completed' as const,
    currentStepId: 'exit_collaborating',
    events: ['project.created.v1', 'teammate.invited.v1'],
    hoursAgo: 96,
  },
  {
    externalId: 'demo-sam',
    email: 'sam.okonkwo@example.com',
    fields: { firstName: 'Sam', lastName: 'Okonkwo', demo: true },
    journeyName: 'Demo · From signup to a shared project',
    state: 'completed' as const,
    currentStepId: 'exit_solo_project',
    events: ['project.created.v1'],
    hoursAgo: 120,
  },
  {
    externalId: 'demo-priya',
    email: 'priya.desai@example.com',
    fields: { firstName: 'Priya', lastName: 'Desai', demo: true },
    journeyName: 'Demo · Seven-day trial to paid',
    state: 'waiting' as const,
    currentStepId: 'wait_subscription',
    events: ['workspace.active.v1'],
    hoursAgo: 84,
  },
  {
    externalId: 'demo-jordan',
    email: 'jordan.lee@example.com',
    fields: { firstName: 'Jordan', lastName: 'Lee', demo: true },
    journeyName: 'Demo · Seven-day trial to paid',
    state: 'waiting' as const,
    currentStepId: 'wait_last_day',
    events: [] as string[],
    hoursAgo: 150,
  },
  {
    externalId: 'demo-casey',
    email: 'casey.brooks@example.com',
    fields: { firstName: 'Casey', lastName: 'Brooks', demo: true },
    journeyName: 'Demo · Seven-day trial to paid',
    state: 'completed' as const,
    currentStepId: 'exit_converted',
    events: ['workspace.active.v1', 'subscription.activated.v1'],
    hoursAgo: 72,
  },
  {
    externalId: 'demo-riley',
    email: 'riley.ahn@example.com',
    fields: { firstName: 'Riley', lastName: 'Ahn', demo: true },
    journeyName: 'Demo · Seven-day trial to paid',
    state: 'completed' as const,
    currentStepId: 'exit_expired',
    events: [] as string[],
    hoursAgo: 200,
  },
  {
    externalId: 'demo-quinn',
    email: 'quinn.martinez@example.com',
    fields: { firstName: 'Quinn', lastName: 'Martinez', hasUnfinishedWork: true, demo: true },
    journeyName: 'Demo · Thoughtful re-engagement',
    state: 'waiting' as const,
    currentStepId: 'wait_for_return',
    events: [] as string[],
    hoursAgo: 40,
  },
  {
    externalId: 'demo-drew',
    email: 'drew.kim@example.com',
    fields: { firstName: 'Drew', lastName: 'Kim', hasUnfinishedWork: false, demo: true },
    journeyName: 'Demo · Thoughtful re-engagement',
    state: 'waiting' as const,
    currentStepId: 'wait_for_return',
    events: [] as string[],
    hoursAgo: 60,
  },
  {
    externalId: 'demo-blake',
    email: 'blake.hoffman@example.com',
    fields: { firstName: 'Blake', lastName: 'Hoffman', hasUnfinishedWork: true, demo: true },
    journeyName: 'Demo · Thoughtful re-engagement',
    state: 'completed' as const,
    currentStepId: 'exit_returned',
    events: ['session.started.v1'],
    hoursAgo: 48,
  },
] as const;

export type DemoPerson = (typeof demoPeople)[number];

export function demoWorkflowId(workspaceId: string, externalId: string): string {
  return `demo/${workspaceId}/${externalId}`;
}

function email(id: string, template: DemoTemplateKey, next: string, versions: DemoTemplateVersions): FlowNode {
  return {
    id, type: 'action', action: 'email.send',
    input: { templateVersionId: { literal: versions[template] } },
    next, onError: 'attention',
  };
}

export function demoJourneys(versions: DemoTemplateVersions): Array<{ name: string; intent: string; definition: WorkflowDefinition }> {
  return [
    {
      name: 'Demo · From signup to a shared project',
      intent: 'Help a new project-app user create a first project and invite a teammate; stop after one setup reminder and one collaboration tip.',
      definition: {
        schemaVersion: '1',
        description: 'After account creation, welcome the user. Give them 48 hours to create a project; offer help if they do not. Once they create one, allow five days for a teammate invite and send one collaboration tip only if needed.',
        trigger: { type: 'manual' }, purpose: 'marketing', topic: 'onboarding', entryNodeId: 'send_welcome',
        nodes: [
          email('send_welcome', 'welcome', 'wait_first_project', versions),
          { id: 'wait_first_project', type: 'wait_for_event', eventType: 'project.created.v1', timeoutSeconds: 172800, onEvent: 'wait_teammate_invite', onTimeout: 'send_setup_help' },
          email('send_setup_help', 'setup_help', 'wait_project_after_help', versions),
          { id: 'wait_project_after_help', type: 'wait_for_event', eventType: 'project.created.v1', timeoutSeconds: 432000, onEvent: 'wait_teammate_invite', onTimeout: 'exit_not_activated' },
          { id: 'wait_teammate_invite', type: 'wait_for_event', eventType: 'teammate.invited.v1', timeoutSeconds: 432000, onEvent: 'exit_collaborating', onTimeout: 'send_collaboration_tip' },
          email('send_collaboration_tip', 'collaboration_tip', 'exit_solo_project', versions),
          { id: 'exit_collaborating', type: 'end', reason: 'First project shared with a teammate' },
          { id: 'exit_solo_project', type: 'end', reason: 'Project created; collaboration tip sent' },
          { id: 'exit_not_activated', type: 'end', reason: 'No project created after help' },
        ],
      },
    },
    {
      name: 'Demo · Seven-day trial to paid',
      intent: 'During a seven-day trial, send one context-sensitive check-in on day three, one ending notice on day six if unpaid, and stop immediately when payment activates.',
      definition: {
        schemaVersion: '1',
        description: 'Enroll when a seven-day trial starts. On day three, tailor the check-in to whether the workspace became active. Wait for a paid subscription, send one final-day notice only if still unpaid, and stop at conversion or expiry.',
        trigger: { type: 'manual' }, purpose: 'marketing', topic: 'trial', entryNodeId: 'delay_three_days',
        nodes: [
          { id: 'delay_three_days', type: 'delay', durationSeconds: 259200, next: 'check_already_paid' },
          { id: 'check_already_paid', type: 'branch', condition: { op: 'event_received', eventType: 'subscription.activated.v1' }, onTrue: 'exit_converted', onFalse: 'check_workspace_active' },
          { id: 'check_workspace_active', type: 'branch', condition: { op: 'event_received', eventType: 'workspace.active.v1' }, onTrue: 'send_trial_value', onFalse: 'send_trial_help' },
          email('send_trial_value', 'trial_value', 'wait_subscription', versions),
          email('send_trial_help', 'trial_help', 'wait_subscription', versions),
          { id: 'wait_subscription', type: 'wait_for_event', eventType: 'subscription.activated.v1', timeoutSeconds: 259200, onEvent: 'exit_converted', onTimeout: 'send_trial_ending' },
          email('send_trial_ending', 'trial_ending', 'wait_last_day', versions),
          { id: 'wait_last_day', type: 'wait_for_event', eventType: 'subscription.activated.v1', timeoutSeconds: 86400, onEvent: 'exit_converted', onTimeout: 'exit_expired' },
          { id: 'exit_converted', type: 'end', reason: 'Paid subscription activated' },
          { id: 'exit_expired', type: 'end', reason: 'Trial ended without conversion' },
        ],
      },
    },
    {
      name: 'Demo · Thoughtful re-engagement',
      intent: 'After 14 days of inactivity, send one message matched to whether the user has unfinished work, stop on return, and do not keep chasing them.',
      definition: {
        schemaVersion: '1',
        description: 'Enroll a user after 14 days without a session. If unfinished work was present at enrollment, remind them where they left off; otherwise share a fresh-start note. Wait seven days for a return and send nothing further.',
        trigger: { type: 'manual' }, purpose: 'marketing', topic: 'reengagement', entryNodeId: 'check_unfinished_work',
        nodes: [
          { id: 'check_unfinished_work', type: 'branch', condition: { op: 'eq', left: { path: 'contact.hasUnfinishedWork' }, right: { literal: true } }, onTrue: 'send_resume_work', onFalse: 'send_whats_new' },
          email('send_resume_work', 'resume_work', 'wait_for_return', versions),
          email('send_whats_new', 'whats_new', 'wait_for_return', versions),
          { id: 'wait_for_return', type: 'wait_for_event', eventType: 'session.started.v1', timeoutSeconds: 604800, onEvent: 'exit_returned', onTimeout: 'exit_no_return' },
          { id: 'exit_returned', type: 'end', reason: 'User returned' },
          { id: 'exit_no_return', type: 'end', reason: 'No return; stop messaging' },
        ],
      },
    },
  ];
}
