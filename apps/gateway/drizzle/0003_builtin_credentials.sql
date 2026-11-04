ALTER TYPE "public"."connection_test_result" ADD VALUE 'permission_denied';--> statement-breakpoint
ALTER TYPE "public"."connection_test_result" ADD VALUE 'upstream_error';--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "account" text;