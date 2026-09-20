CREATE TABLE "enrollment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
	CONSTRAINT "enrollment_events_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_event_identity_unique" ON "enrollment_events" USING btree ("enrollment_id","event_id");
--> statement-breakpoint
CREATE INDEX "enrollment_event_workspace_idx" ON "enrollment_events" USING btree ("workspace_id","enrollment_id");
--> statement-breakpoint
INSERT INTO "enrollment_events" (
	"workspace_id",
	"enrollment_id",
	"event_id",
	"event_type",
	"data",
	"payload_hash",
	"delivered_at",
	"created_at",
	"updated_at"
)
SELECT DISTINCT ON (audit.target_id, audit.details->>'eventId')
	audit.workspace_id,
	enrollment.id,
	audit.details->>'eventId',
	audit.details->>'eventType',
	COALESCE(audit.details->'data', '{}'::jsonb),
	md5(jsonb_build_object(
		'eventType', audit.details->>'eventType',
		'data', COALESCE(audit.details->'data', '{}'::jsonb)
	)::text),
	audit.created_at,
	audit.created_at,
	audit.created_at
FROM "audit_events" audit
INNER JOIN "enrollments" enrollment ON enrollment.id::text = audit.target_id
WHERE audit.action = 'event.emit'
	AND audit.target_type = 'enrollment'
	AND audit.workspace_id IS NOT NULL
	AND NULLIF(audit.details->>'eventId', '') IS NOT NULL
	AND NULLIF(audit.details->>'eventType', '') IS NOT NULL
ORDER BY audit.target_id, audit.details->>'eventId', audit.created_at;
