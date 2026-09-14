CREATE TYPE "public"."draft_state" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."enrollment_state" AS ENUM('pending_start', 'running', 'waiting', 'paused', 'needs_attention', 'completed', 'cancelled', 'suppressed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'author', 'sender', 'operator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."send_state" AS ENUM('prepared', 'dispatching', 'accepted', 'retryable', 'rejected', 'unknown', 'abandoned');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"external_id" text,
	"email" text NOT NULL,
	"email_key" text NOT NULL,
	"timezone" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sequence_version_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"state" "enrollment_state" DEFAULT 'pending_start' NOT NULL,
	"current_step_id" text,
	"workflow_id" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_workflow_id_unique" UNIQUE("workflow_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_until" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"deployment_admin" boolean DEFAULT false NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "send_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"state" "send_state" DEFAULT 'prepared' NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"plain_text" text NOT NULL,
	"provider_message_id" text,
	"error_code" text,
	"first_attempt_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "send_intents_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "sequence_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"state" "draft_state" DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email_key" text NOT NULL,
	"topic" text DEFAULT '*' NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"subject" text NOT NULL,
	"preheader" text,
	"body" text NOT NULL,
	"props_schema" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"state" "draft_state" DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"subject" text NOT NULL,
	"preheader" text,
	"body" text NOT NULL,
	"props_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_message_id" text,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sending_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_sequence_version_id_sequence_versions_id_fk" FOREIGN KEY ("sequence_version_id") REFERENCES "public"."sequence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_intents" ADD CONSTRAINT "send_intents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_intents" ADD CONSTRAINT "send_intents_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_versions" ADD CONSTRAINT "sequence_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_versions" ADD CONSTRAINT "sequence_versions_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_email_unique" ON "contacts" USING btree ("workspace_id","email_key");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_external_unique" ON "contacts" USING btree ("workspace_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_idempotency_unique" ON "enrollments" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "membership_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_aggregate_unique" ON "outbox" USING btree ("kind","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "send_occurrence_unique" ON "send_intents" USING btree ("enrollment_id","step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_version_unique" ON "sequence_versions" USING btree ("sequence_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_name_unique" ON "sequences" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_unique" ON "suppressions" USING btree ("workspace_id","email_key","topic");--> statement-breakpoint
CREATE UNIQUE INDEX "template_version_unique" ON "template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "template_name_unique" ON "templates" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_unique" ON "webhook_events" USING btree ("provider","event_id");