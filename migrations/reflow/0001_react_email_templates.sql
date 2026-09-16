ALTER TABLE "templates" ADD COLUMN "source_kind" text DEFAULT 'plain' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "tsx_source" text;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "source_kind" text DEFAULT 'plain' NOT NULL;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "tsx_source" text;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_source_kind_check" CHECK ("source_kind" in ('plain', 'react_email'));--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_source_kind_check" CHECK ("source_kind" in ('plain', 'react_email'));
