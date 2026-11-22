CREATE TYPE "public"."punch_direction" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."punch_source" AS ENUM('WEB', 'MOBILE', 'BIOMETRIC', 'IMPORT');--> statement-breakpoint
CREATE TABLE "punch_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"punched_at" timestamp with time zone NOT NULL,
	"direction" "punch_direction",
	"source" "punch_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "roster_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"weekly_off_days" smallint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "roster_assignment_employee_from_uq" UNIQUE("employee_id","effective_from"),
	CONSTRAINT "roster_assignment_weekly_offs_ck" CHECK (cardinality("roster_assignment"."weekly_off_days") <= 6)
);
--> statement-breakpoint
CREATE TABLE "shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"grace_minutes" smallint DEFAULT 15 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "shift_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "shift_minutes_ck" CHECK ("shift"."start_minute" between 0 and 1439 and "shift"."end_minute" between 0 and 1439),
	CONSTRAINT "shift_not_empty_ck" CHECK ("shift"."start_minute" <> "shift"."end_minute"),
	CONSTRAINT "shift_grace_ck" CHECK ("shift"."grace_minutes" between 0 and 120),
	CONSTRAINT "shift_default_active_ck" CHECK ("shift"."is_active" or not "shift"."is_default")
);
--> statement-breakpoint
ALTER TABLE "punch_event" ADD CONSTRAINT "punch_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_event" ADD CONSTRAINT "punch_event_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_assignment" ADD CONSTRAINT "roster_assignment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_assignment" ADD CONSTRAINT "roster_assignment_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_assignment" ADD CONSTRAINT "roster_assignment_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "punch_event_tenant_idx" ON "punch_event" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "punch_event_employee_idx" ON "punch_event" USING btree ("employee_id","punched_at");--> statement-breakpoint
CREATE INDEX "roster_assignment_tenant_idx" ON "roster_assignment" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "roster_assignment_shift_idx" ON "roster_assignment" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "shift_tenant_idx" ON "shift" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_tenant_default_uq" ON "shift" USING btree ("tenant_id") WHERE is_default;--> statement-breakpoint
-- attendance.manage is new in Slice 3. Signup writes the seeded roles into each
-- company as data, so a company that already exists has its roles as they were
-- the day it signed up, without the new permission. It goes to every role that
-- already configures leave policy: the people who set holidays and weekly offs
-- are the people who set shifts. Chosen by what a role can do, never by its
-- name (ENGINEERING-STANDARDS S1), so a renamed or custom role is treated the
-- same as a seeded one.
--
-- Company by company under its own tenant context, so this holds whether or not
-- the migrating role bypasses row-level security.
DO $$
DECLARE
  company uuid;
BEGIN
  FOR company IN SELECT id FROM tenant LOOP
    PERFORM set_config('app.current_tenant', company::text, true);
    INSERT INTO role_permission (role_id, tenant_id, permission)
      SELECT rp.role_id, rp.tenant_id, 'attendance.manage'
      FROM role_permission rp
      WHERE rp.tenant_id = company AND rp.permission = 'leave.manage'
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.current_tenant', '', true);
END $$;
