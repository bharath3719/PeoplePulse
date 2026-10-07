ALTER TABLE "user" ADD COLUMN "mfa_last_used_step" bigint;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "mfa_failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "mfa_locked_until" timestamp with time zone;