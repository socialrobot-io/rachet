export type FlowNode =
  | {
      id: string;
      type: 'action';
      action: string;
      input: Record<string, unknown>;
      next: string;
      onError?: string;
    }
  | { id: string; type: 'delay'; durationSeconds: number; next: string }
  | {
      id: string;
      type: 'wait_for_event';
      eventType: string;
      timeoutSeconds: number;
      onEvent: string;
      onTimeout: string;
    }
  | {
      id: string;
      type: 'branch';
      condition: { op: string; eventType?: string; [key: string]: unknown };
      onTrue: string;
      onFalse: string;
    }
  | { id: string; type: 'end'; reason: string };

export type WorkflowDefinition = {
  schemaVersion: string;
  description: string;
  trigger: { type: string; eventType?: string; at?: string };
  entryNodeId: string;
  purpose?: string;
  topic?: string;
  nodes: FlowNode[];
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export type PublishedVersion = {
  id: string;
  sequenceId: string;
  version: number;
  createdAt: string;
};

export type Workflow = {
  id: string;
  workspaceId: string;
  name: string;
  state: string;
  revision: number;
  definition: WorkflowDefinition;
  createdAt: string;
  updatedAt: string;
  publishedVersions: PublishedVersion[];
};

export type Enrollment = {
  id: string;
  workspaceId: string;
  sequenceVersionId: string;
  contactId: string;
  state: string;
  currentStepId: string | null;
  workflowId: string;
  input: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  contactEmail: string;
  contactFields: Record<string, unknown>;
  sequenceId: string;
  workflowName: string;
  workflowVersion: number;
  definition: WorkflowDefinition;
};

export type Message = {
  id: string;
  workspaceId: string;
  enrollmentId: string;
  stepId: string;
  state: string;
  recipient: string;
  subject: string;
  html: string;
  plainText: string;
  createdAt: string;
  acceptedAt: string | null;
};

export type RenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  plainText: string;
};

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

export type OAuthClient = {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  application_type?: string;
};

export type OAuthConsent = {
  id: string;
  clientId: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
};
