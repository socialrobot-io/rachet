import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'author', 'sender', 'operator', 'viewer']);
export const draftState = pgEnum('draft_state', ['draft', 'published', 'archived']);
export const enrollmentState = pgEnum('enrollment_state', [
  'pending_start', 'running', 'waiting', 'paused', 'needs_attention', 'completed', 'cancelled', 'suppressed', 'failed',
]);
export const sendState = pgEnum('send_state', ['prepared', 'dispatching', 'accepted', 'retryable', 'rejected', 'unknown', 'abandoned']);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  ...timestamps,
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  sendingEnabled: boolean('sending_enabled').notNull().default(false),
  ...timestamps,
});

export const profiles = pgTable('profiles', {
  userId: text('user_id').primaryKey(),
  deploymentAdmin: boolean('deployment_admin').notNull().default(false),
  disabled: boolean('disabled').notNull().default(false),
  ...timestamps,
});

export const memberships = pgTable('memberships', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  role: memberRole('role').notNull(),
  ...timestamps,
}, (table) => [primaryKey({ columns: [table.workspaceId, table.userId] }), index('membership_user_idx').on(table.userId)]);

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  externalId: text('external_id'),
  email: text('email').notNull(),
  emailKey: text('email_key').notNull(),
  timezone: text('timezone'),
  fields: jsonb('fields').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => [
  uniqueIndex('contact_email_unique').on(table.workspaceId, table.emailKey),
  uniqueIndex('contact_external_unique').on(table.workspaceId, table.externalId),
]);

export const suppressions = pgTable('suppressions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  emailKey: text('email_key').notNull(),
  topic: text('topic').notNull().default('*'),
  reason: text('reason').notNull(),
  source: text('source').notNull(),
  active: boolean('active').notNull().default(true),
  ...timestamps,
}, (table) => [uniqueIndex('suppression_unique').on(table.workspaceId, table.emailKey, table.topic)]);

export const templates = pgTable('templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  state: draftState('state').notNull().default('draft'),
  revision: integer('revision').notNull().default(1),
  subject: text('subject').notNull(),
  preheader: text('preheader'),
  body: text('body').notNull(),
  html: text('html'),
  sourceKind: text('source_kind').$type<'plain' | 'html'>().notNull().default('plain'),
  tsxSource: text('tsx_source'),
  propsSchema: jsonb('props_schema').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => [uniqueIndex('template_name_unique').on(table.workspaceId, table.name)]);

export const templateVersions = pgTable('template_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  templateId: uuid('template_id').notNull().references(() => templates.id),
  version: integer('version').notNull(),
  contentHash: text('content_hash').notNull(),
  subject: text('subject').notNull(),
  preheader: text('preheader'),
  body: text('body').notNull(),
  html: text('html'),
  sourceKind: text('source_kind').$type<'plain' | 'html'>().notNull().default('plain'),
  tsxSource: text('tsx_source'),
  propsSchema: jsonb('props_schema').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('template_version_unique').on(table.templateId, table.version)]);

export const sequences = pgTable('sequences', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  state: draftState('state').notNull().default('draft'),
  revision: integer('revision').notNull().default(1),
  definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
  ...timestamps,
}, (table) => [uniqueIndex('sequence_name_unique').on(table.workspaceId, table.name)]);

export const sequenceVersions = pgTable('sequence_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  sequenceId: uuid('sequence_id').notNull().references(() => sequences.id),
  version: integer('version').notNull(),
  contentHash: text('content_hash').notNull(),
  definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('sequence_version_unique').on(table.sequenceId, table.version)]);

export const enrollments = pgTable('enrollments', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  sequenceVersionId: uuid('sequence_version_id').notNull().references(() => sequenceVersions.id),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  state: enrollmentState('state').notNull().default('pending_start'),
  currentStepId: text('current_step_id'),
  workflowId: text('workflow_id').notNull().unique(),
  input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text('idempotency_key').notNull(),
  ...timestamps,
}, (table) => [uniqueIndex('enrollment_idempotency_unique').on(table.workspaceId, table.idempotencyKey)]);

export const sendIntents = pgTable('send_intents', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  enrollmentId: uuid('enrollment_id').notNull().references(() => enrollments.id),
  stepId: text('step_id').notNull(),
  state: sendState('state').notNull().default('prepared'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  payloadHash: text('payload_hash').notNull(),
  recipient: text('recipient').notNull(),
  subject: text('subject').notNull(),
  html: text('html').notNull(),
  plainText: text('plain_text').notNull(),
  providerMessageId: text('provider_message_id'),
  errorCode: text('error_code'),
  firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex('send_occurrence_unique').on(table.enrollmentId, table.stepId)]);

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  providerMessageId: text('provider_message_id'),
  payload: jsonb('payload').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('webhook_event_unique').on(table.provider, table.eventId)]);

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  claimedUntil: timestamp('claimed_until', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('outbox_aggregate_unique').on(table.kind, table.aggregateId)]);
