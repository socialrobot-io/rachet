ALTER TABLE "templates" ADD COLUMN "html" text;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "html" text;--> statement-breakpoint
ALTER TABLE "templates" DROP CONSTRAINT IF EXISTS "templates_source_kind_check";--> statement-breakpoint
ALTER TABLE "template_versions" DROP CONSTRAINT IF EXISTS "template_versions_source_kind_check";--> statement-breakpoint
UPDATE "templates" SET "source_kind" = 'plain' WHERE "source_kind" = 'react_email';--> statement-breakpoint
UPDATE "template_versions" SET "source_kind" = 'plain' WHERE "source_kind" = 'react_email';--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_source_kind_check" CHECK ("source_kind" in ('plain', 'html'));--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_source_kind_check" CHECK ("source_kind" in ('plain', 'html'));
