import { RachetSdk } from '@socialrobot-io/rachet-sdk';

/** Published workflow the product welcome enrolls into. */
export const WELCOME_WORKFLOW_NAME = 'Welcome first workflow';

export type WelcomeUser = { id: string; email: string; name?: string | null };

type ListedWorkflow = {
  name: string;
  state: string;
  publishedVersions: Array<{ id: string; version: number }>;
};

type ListedEnrollment = { id: string; idempotencyKey: string };

type Starter = (user: WelcomeUser) => Promise<void>;
type WorkflowCreated = (userId: string, workflowId: string) => Promise<void>;

let starter: Starter = async () => {};
let onWorkflowCreated: WorkflowCreated = async () => {};

export function setWelcomeStarter(next: Starter) {
  starter = next;
}

export function runWelcomeStarter(user: WelcomeUser) {
  return starter(user);
}

export function setWelcomeWorkflowCreated(next: WorkflowCreated) {
  onWorkflowCreated = next;
}

export async function runWelcomeWorkflowCreated(userId: string, workflowId: string) {
  try {
    await onWorkflowCreated(userId, workflowId);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Welcome workflow event failed',
      userId,
      workflowId,
      error: error instanceof Error ? error.message : 'unknown',
    }));
  }
}

export function welcomeFirstName(name: string | null | undefined, email: string): string {
  const given = name?.trim().split(/\s+/)[0];
  if (given) return given;
  const mailbox = email.split('@')[0]?.trim();
  return mailbox || 'there';
}

export function welcomeVariables(publicUrl: string, from: string) {
  const base = publicUrl.replace(/\/$/, '');
  const bracketed = from.match(/<([^<>\s]+)>/);
  const address = (bracketed?.[1] ?? from).trim();
  return {
    workflowsUrl: `${base}/workflows`,
    integrationsUrl: `${base}/settings/integrations`,
    replyMailto: `mailto:${address}`,
    logoUrl: `${base}/brand/rachet-logo.png`,
    signatureUrl: `${base}/brand/founder-signature.png`,
  };
}

export function welcomeIdempotencyKey(userId: string) {
  return `welcome-${userId}`;
}

export function welcomeEventId(workflowId: string) {
  return `workflow.created.v1:${workflowId}`;
}

async function publishedWelcomeVersionId(sdk: RachetSdk, workspaceId: string): Promise<string | null> {
  const rows = await sdk.call<ListedWorkflow[]>('workflow.list', { workspaceId });
  const match = rows.find((row) => row.name === WELCOME_WORKFLOW_NAME && row.state === 'published');
  const latest = match?.publishedVersions.slice().sort((left, right) => right.version - left.version)[0];
  return latest?.id ?? null;
}

export async function startProductWelcome(input: {
  sdk: RachetSdk;
  workspaceId: string;
  publicUrl: string;
  from: string;
  user: WelcomeUser;
}): Promise<void> {
  const workflowVersionId = await publishedWelcomeVersionId(input.sdk, input.workspaceId);
  if (!workflowVersionId) return;
  await input.sdk.trigger({
    workflowVersionId,
    contact: {
      email: input.user.email,
      externalId: input.user.id,
      fields: { firstName: welcomeFirstName(input.user.name, input.user.email) },
    },
    variables: welcomeVariables(input.publicUrl, input.from),
    idempotencyKey: welcomeIdempotencyKey(input.user.id),
  });
}

export async function signalProductWelcome(input: {
  sdk: RachetSdk;
  workspaceId: string;
  userId: string;
  createdWorkflowId: string;
}): Promise<void> {
  try {
    const rows = await input.sdk.call<ListedEnrollment[]>('enrollment.list', { workspaceId: input.workspaceId });
    const enrollment = rows.find((row) => row.idempotencyKey === welcomeIdempotencyKey(input.userId));
    if (!enrollment) return;
    await input.sdk.call('event.emit', {
      workspaceId: input.workspaceId,
      enrollmentId: enrollment.id,
      eventId: welcomeEventId(input.createdWorkflowId),
      eventType: 'workflow.created.v1',
      data: { workflowId: input.createdWorkflowId },
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Welcome workflow event failed',
      userId: input.userId,
      workflowId: input.createdWorkflowId,
      error: error instanceof Error ? error.message : 'unknown',
    }));
  }
}
