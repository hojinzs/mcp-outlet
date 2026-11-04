CREATE TYPE "public"."activity_action" AS ENUM('connector.disable', 'connector.enable', 'client_secret.view');--> statement-breakpoint
CREATE TYPE "public"."activity_target" AS ENUM('connector', 'oauth_client');--> statement-breakpoint
CREATE TYPE "public"."connection_test_result" AS ENUM('ok', 'private_address', 'unreachable', 'auth_failed', 'not_mcp', 'timeout', 'redirect');--> statement-breakpoint
CREATE TYPE "public"."connector_status" AS ENUM('pending', 'ok', 'error', 'reauth_required');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" "activity_action" NOT NULL,
	"target_type" "activity_target" NOT NULL,
	"target_id" uuid,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "connector_id" uuid;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "status" "connector_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "last_tested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "last_test_result" "connection_test_result";--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "disabled_by" uuid;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "last_called_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "known_tools" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "last_called_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_logs_at_index" ON "activity_logs" USING btree ("at");--> statement-breakpoint
CREATE INDEX "activity_logs_target_type_target_id_index" ON "activity_logs" USING btree ("target_type","target_id");--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_disabled_by_users_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_endpoint_id_at_index" ON "audit_logs" USING btree ("endpoint_id","at");--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "disabled_reason" CHECK (("connectors"."disabled_at" is null) = ("connectors"."disabled_reason" is null));