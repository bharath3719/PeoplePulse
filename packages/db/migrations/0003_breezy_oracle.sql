ALTER TABLE "user" ADD COLUMN "mfa_pending_secret" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "mfa_recovery_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- An enrolment started but never confirmed used to sit in mfa_secret, counting
-- for nothing until mfa_enabled_at was set. It is now a pending secret.
UPDATE "user" SET "mfa_pending_secret" = "mfa_secret", "mfa_secret" = NULL WHERE "mfa_enabled_at" IS NULL AND "mfa_secret" IS NOT NULL;
