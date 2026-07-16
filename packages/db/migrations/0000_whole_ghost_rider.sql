CREATE TYPE "public"."tenant_status" AS ENUM('ACTIVE', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."employee_event_type" AS ENUM('JOIN', 'CONFIRM', 'TRANSFER', 'PROMOTION', 'INCREMENT', 'EXIT', 'PF_STATUS_CHANGE');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('ONBOARDING', 'ACTIVE', 'NOTICE', 'EXITED');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('FULL_TIME', 'PART_TIME', 'INTERN', 'CONTRACT');--> statement-breakpoint
CREATE TYPE "public"."esi_status" AS ENUM('NOT_APPLICABLE', 'NOT_COVERED', 'COVERED');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED');--> statement-breakpoint
CREATE TYPE "public"."pf_status" AS ENUM('NOT_APPLICABLE', 'EXCLUDED', 'MEMBER');--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "tenant_status" DEFAULT 'ACTIVE' NOT NULL,
	"epf_registered" boolean DEFAULT false NOT NULL,
	"epf_establishment_code" text,
	"epf_registered_from" date,
	"esi_registered" boolean DEFAULT false NOT NULL,
	"esi_establishment_code" text,
	"esi_registered_from" date,
	"pf_restrict_to_ceiling" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_tenant_key_uq" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"role_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permission_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"mfa_secret" text,
	"mfa_enabled_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_role" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "user_tenant" (
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_tenant_user_id_tenant_id_pk" PRIMARY KEY("user_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_tenant_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "designation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "designation_tenant_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "grade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grade_tenant_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text NOT NULL,
	"pincode" text,
	"geo_lat" double precision,
	"geo_lng" double precision,
	"geo_radius_meters" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_tenant_name_uq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"emp_code" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"date_of_birth" date,
	"gender" "gender",
	"personal_email" text,
	"work_email" text,
	"phone" text,
	"join_date" date NOT NULL,
	"confirmation_date" date,
	"exit_date" date,
	"status" "employee_status" DEFAULT 'ONBOARDING' NOT NULL,
	"employment_type" "employment_type" DEFAULT 'FULL_TIME' NOT NULL,
	"location_id" uuid,
	"department_id" uuid,
	"designation_id" uuid,
	"grade_id" uuid,
	"manager_id" uuid,
	"pan_encrypted" text,
	"pan_last4" text,
	"uan" text,
	"esic_number" text,
	"bank_account_encrypted" text,
	"bank_account_last4" text,
	"bank_ifsc" text,
	"bank_name" text,
	"pf_status" "pf_status" DEFAULT 'NOT_APPLICABLE' NOT NULL,
	"pf_joining_wage_paise" bigint,
	"has_prior_pf_membership" boolean DEFAULT false NOT NULL,
	"pf_restrict_to_ceiling" boolean,
	"esi_status" "esi_status" DEFAULT 'NOT_APPLICABLE' NOT NULL,
	"deleted_at" timestamp with time zone,
	"anonymised_at" timestamp with time zone,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "employee_tenant_code_uq" UNIQUE("tenant_id","emp_code")
);
--> statement-breakpoint
CREATE TABLE "employee_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "employee_event_type" NOT NULL,
	"effective_date" date NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_email" text,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenant" ADD CONSTRAINT "user_tenant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenant" ADD CONSTRAINT "user_tenant_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designation" ADD CONSTRAINT "designation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade" ADD CONSTRAINT "grade_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_designation_id_designation_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."designation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_grade_id_grade_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grade"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_event" ADD CONSTRAINT "employee_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_event" ADD CONSTRAINT "employee_event_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_status_idx" ON "tenant" USING btree ("status");--> statement-breakpoint
CREATE INDEX "role_tenant_idx" ON "role" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "role_permission_tenant_idx" ON "role_permission" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "user_role_tenant_idx" ON "user_role" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "user_tenant_tenant_idx" ON "user_tenant" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "department_tenant_idx" ON "department" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "designation_tenant_idx" ON "designation" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "grade_tenant_idx" ON "grade" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "location_tenant_idx" ON "location" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "employee_tenant_idx" ON "employee" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "employee_tenant_status_idx" ON "employee" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "employee_manager_idx" ON "employee" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "employee_event_tenant_idx" ON "employee_event" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "employee_event_employee_idx" ON "employee_event" USING btree ("employee_id","effective_date");--> statement-breakpoint
CREATE INDEX "audit_tenant_at_idx" ON "audit_log" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("tenant_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("tenant_id","actor_user_id");