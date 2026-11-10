ALTER TYPE "public"."leave_txn_kind" ADD VALUE 'CARRY_OUT';--> statement-breakpoint
ALTER TYPE "public"."leave_txn_kind" ADD VALUE 'CARRY_IN';--> statement-breakpoint
ALTER TYPE "public"."leave_txn_kind" ADD VALUE 'ENCASHMENT';--> statement-breakpoint
ALTER TYPE "public"."leave_txn_kind" ADD VALUE 'LAPSE';--> statement-breakpoint
ALTER TABLE "leave_txn" DROP CONSTRAINT "leave_txn_sign_ck";--> statement-breakpoint
ALTER TABLE "leave_type" ADD COLUMN "carry_forward_max_hundredths" integer;--> statement-breakpoint
ALTER TABLE "leave_type" ADD COLUMN "encash_max_hundredths" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_txn" ADD CONSTRAINT "leave_txn_sign_ck" CHECK (
    ("leave_txn"."kind"::text in ('DEBIT', 'CARRY_OUT', 'ENCASHMENT', 'LAPSE') and "leave_txn"."days_hundredths" < 0)
    or ("leave_txn"."kind"::text in ('GRANT', 'ACCRUAL', 'REVERSAL', 'CARRY_IN') and "leave_txn"."days_hundredths" > 0)
    or "leave_txn"."kind"::text in ('OPENING', 'ADJUSTMENT')
  );--> statement-breakpoint
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_carry_forward_ck" CHECK ("leave_type"."carry_forward_max_hundredths" is null or "leave_type"."carry_forward_max_hundredths" between 0 and 36600);--> statement-breakpoint
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_encash_ck" CHECK ("leave_type"."encash_max_hundredths" between 0 and 36600);--> statement-breakpoint
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_unpaid_no_encash_ck" CHECK ("leave_type"."is_paid" or "leave_type"."encash_max_hundredths" = 0);