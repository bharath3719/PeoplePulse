CREATE TYPE "public"."leave_accrual_frequency" AS ENUM('NONE', 'MONTHLY', 'YEARLY');--> statement-breakpoint
CREATE TYPE "public"."leave_day_count_basis" AS ENUM('WORKING_DAYS', 'CALENDAR_DAYS');--> statement-breakpoint
CREATE TYPE "public"."leave_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."leave_session" AS ENUM('FIRST', 'SECOND');--> statement-breakpoint
CREATE TYPE "public"."leave_txn_kind" AS ENUM('OPENING', 'GRANT', 'ACCRUAL', 'ADJUSTMENT', 'DEBIT', 'REVERSAL');--> statement-breakpoint
CREATE TABLE "holiday" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "holiday_tenant_location_date_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","location_id","date")
);
--> statement-breakpoint
CREATE TABLE "leave_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"start_session" "leave_session" NOT NULL,
	"end_date" date NOT NULL,
	"end_session" "leave_session" NOT NULL,
	"days_hundredths" integer NOT NULL,
	"reason" text,
	"status" "leave_request_status" DEFAULT 'PENDING' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "leave_request_dates_ck" CHECK ("leave_request"."end_date" >= "leave_request"."start_date"),
	CONSTRAINT "leave_request_days_ck" CHECK ("leave_request"."days_hundredths" > 0)
);
--> statement-breakpoint
CREATE TABLE "leave_txn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"calendar_year" integer NOT NULL,
	"kind" "leave_txn_kind" NOT NULL,
	"days_hundredths" integer NOT NULL,
	"leave_request_id" uuid,
	"accrual_period" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "leave_txn_nonzero_ck" CHECK ("leave_txn"."days_hundredths" <> 0),
	CONSTRAINT "leave_txn_sign_ck" CHECK (
    ("leave_txn"."kind" = 'DEBIT' and "leave_txn"."days_hundredths" < 0)
    or ("leave_txn"."kind" in ('GRANT', 'ACCRUAL', 'REVERSAL') and "leave_txn"."days_hundredths" > 0)
    or "leave_txn"."kind" in ('OPENING', 'ADJUSTMENT')
  )
);
--> statement-breakpoint
CREATE TABLE "leave_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"day_count_basis" "leave_day_count_basis" DEFAULT 'WORKING_DAYS' NOT NULL,
	"allows_half_day" boolean DEFAULT true NOT NULL,
	"accrual_frequency" "leave_accrual_frequency" DEFAULT 'NONE' NOT NULL,
	"annual_entitlement_hundredths" integer DEFAULT 0 NOT NULL,
	"pro_rata_on_join" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "leave_type_tenant_code_uq" UNIQUE("tenant_id","code"),
	CONSTRAINT "leave_type_entitlement_ck" CHECK ("leave_type"."annual_entitlement_hundredths" between 0 and 36600),
	CONSTRAINT "leave_type_unpaid_no_accrual_ck" CHECK ("leave_type"."is_paid" or "leave_type"."accrual_frequency" = 'NONE')
);
--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "weekly_off_days" smallint[] DEFAULT '{0}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_leave_type_id_leave_type_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_txn" ADD CONSTRAINT "leave_txn_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_txn" ADD CONSTRAINT "leave_txn_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_txn" ADD CONSTRAINT "leave_txn_leave_type_id_leave_type_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_txn" ADD CONSTRAINT "leave_txn_leave_request_id_leave_request_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holiday_tenant_date_idx" ON "holiday" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "leave_request_tenant_idx" ON "leave_request" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "leave_request_employee_idx" ON "leave_request" USING btree ("employee_id","start_date");--> statement-breakpoint
CREATE INDEX "leave_request_tenant_status_idx" ON "leave_request" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "leave_txn_tenant_idx" ON "leave_txn" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "leave_txn_balance_idx" ON "leave_txn" USING btree ("employee_id","leave_type_id","calendar_year");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_txn_accrual_uq" ON "leave_txn" USING btree ("employee_id","leave_type_id","accrual_period") WHERE accrual_period is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_txn_request_uq" ON "leave_txn" USING btree ("leave_request_id","kind") WHERE leave_request_id is not null;--> statement-breakpoint
CREATE INDEX "leave_type_tenant_idx" ON "leave_type" USING btree ("tenant_id");