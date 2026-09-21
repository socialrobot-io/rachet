CREATE TABLE "registration_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_key" text NOT NULL,
	"name" text NOT NULL,
	"organization_name" text NOT NULL,
	"organization_slug" text,
	"method" text NOT NULL,
	"kind" text NOT NULL,
	"created_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_intents_method_check" CHECK ("method" IN ('magic-link', 'github', 'host-setup')),
	CONSTRAINT "registration_intents_kind_check" CHECK ("kind" IN ('bootstrap', 'public', 'invite'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "registration_intents_active_email_unique"
	ON "registration_intents" ("email_key") WHERE "consumed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "registration_intents_expiry_idx" ON "registration_intents" ("expires_at");
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "default_workspace_id" uuid;
--> statement-breakpoint
UPDATE "profiles" AS profile
SET "default_workspace_id" = (
	SELECT "workspace_id"
	FROM "memberships"
	WHERE "user_id" = profile."user_id"
	ORDER BY "created_at", "workspace_id"
	LIMIT 1
)
WHERE profile."default_workspace_id" IS NULL
	AND EXISTS (SELECT 1 FROM "memberships" WHERE "user_id" = profile."user_id");
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_default_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("default_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reflow_provision_registered_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	intent "registration_intents"%ROWTYPE;
	workspace_id uuid;
	workspace_slug text;
BEGIN
	PERFORM pg_advisory_xact_lock(731947202);

	SELECT * INTO intent
	FROM "registration_intents"
	WHERE "email_key" = lower(trim(NEW."email"))
		AND "consumed_at" IS NULL
		AND "expires_at" > now()
	ORDER BY CASE WHEN "kind" = 'bootstrap' THEN 0 ELSE 1 END, "created_at"
	LIMIT 1
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'Registration is not authorized or has expired' USING ERRCODE = '42501';
	END IF;

	IF intent."kind" = 'bootstrap' AND EXISTS (
		SELECT 1 FROM "system_settings" WHERE "key" = 'initialized'
	) THEN
		RAISE EXCEPTION 'Reflow is already initialized' USING ERRCODE = '23505';
	END IF;

	workspace_id := gen_random_uuid();
	workspace_slug := coalesce(
		nullif(intent."organization_slug", ''),
		'org-' || substring(replace(workspace_id::text, '-', '') from 1 for 20)
	);

	INSERT INTO "workspaces" ("id", "name", "slug")
	VALUES (workspace_id, intent."organization_name", workspace_slug);

	INSERT INTO "profiles" ("user_id", "deployment_admin", "default_workspace_id")
	VALUES (NEW."id", intent."kind" = 'bootstrap', workspace_id);

	INSERT INTO "memberships" ("workspace_id", "user_id", "role")
	VALUES (workspace_id, NEW."id", 'owner');

	IF intent."kind" = 'bootstrap' THEN
		INSERT INTO "system_settings" ("key", "value")
		VALUES (
			'initialized',
			jsonb_build_object('userId', NEW."id", 'workspaceId', workspace_id, 'method', intent."method")
		);
	END IF;

	UPDATE "registration_intents" SET "consumed_at" = now() WHERE "id" = intent."id";
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "reflow_provision_registered_user"
	AFTER INSERT ON "user"
	FOR EACH ROW EXECUTE FUNCTION reflow_provision_registered_user();
