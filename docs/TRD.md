# Technical Requirements Document (TRD)

**Product:** PeoplePulse — Cloud HRMS for Indian SMBs

---

## 1. Document Control

| Field | Detail |
|---|---|
| Document Title | Technical Requirements Document — PeoplePulse HRMS |
| Version | 1.0 (Draft) |
| Date | 13 July 2026 |
| Parent Document | [BRD-HRMS v1.0](BRD.md) (approved) |
| Audience | Engineering, QA, DevOps, Security |
| Status | Draft — Pending Review |

> **Traceability:** Every technical requirement (TR-xx) references the BRD requirement(s) it implements (e.g., CHR-01, PAY-02, NFR-05).

---

## 2. System Overview

PeoplePulse is a multi-tenant SaaS web + mobile application composed of:

- **Web application** — HR admin console + employee self-service (responsive SPA).
- **Mobile apps** — Android & iOS ESS apps (punch, leave, payslips, approvals).
- **Backend API platform** — modular monolith exposing REST APIs, organized by bounded contexts (Core HR, Attendance, Leave, Payroll, ATS, PMS, LND, Platform).
- **Async workers** — background jobs: payroll runs, report generation, notifications, imports, document generation.
- **Integration layer** — biometric device ingestion, bank file generation, e-sign, email/SMS/push/WhatsApp, Tally export.

### 2.1 Architectural Style Decision

**Modular monolith first, not microservices.** Rationale for an SMB-scale startup:

- Single deployable unit → low ops burden for a small team.
- Strict module boundaries (separate packages/schemas per bounded context) preserve a future path to extract services (payroll worker is the first extraction candidate).
- Payroll requires strong transactional consistency with attendance/leave data — simpler in one database.

### 2.2 Recommended Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Backend | Node.js (NestJS, TypeScript) **or** Python (Django) — pick one based on team skills; this TRD assumes NestJS | Strong typing, modular architecture support, large hiring pool in India |
| Web frontend | React + TypeScript, Vite, TanStack Query | Ecosystem, hiring pool |
| Mobile | React Native (single codebase, Android-first) | SMB employees are Android-dominant; code sharing with web team |
| Primary DB | PostgreSQL 16 | Row-level security for tenancy, JSONB for custom fields, mature |
| Cache/queues | Redis (cache, rate limits) + BullMQ (jobs) | Simple, well-known |
| Object storage | S3-compatible (documents, payslips, videos) | Presigned URL patterns |
| Search | PostgreSQL full-text (V1); OpenSearch only if needed | Avoid premature infra |
| PDF generation | Headless Chromium (payslips, letters, Form 16) via worker | HTML templates → PDF |
| Auth | JWT access + refresh tokens; TOTP MFA for admin roles | Standard |
| Infra | Managed Kubernetes or ECS-class containers, Indian region | Detailed in Architecture Doc |

---

## 3. Multi-Tenancy Model (NFR-07)

**TR-01 — Tenancy strategy:** shared database, shared schema, with `tenant_id` on every tenant-owned row, enforced by PostgreSQL **Row-Level Security (RLS)**.

- Every request resolves tenant context from the JWT (`tenant_id` claim); the API sets `app.current_tenant` on the DB session; RLS policies filter all queries.
- No API code path may query tenant tables without tenant context — enforced by a repository layer that refuses raw access, plus integration tests that assert cross-tenant isolation.
- Rationale vs schema-per-tenant: hundreds of SMB tenants with small data volumes; migrations and pooling stay simple.
- Tenant-aware object storage: documents stored under `tenants/{tenant_id}/...` prefixes; presigned URLs scoped and short-lived (≤ 15 min).

**TR-02 — Tenant provisioning:** self-serve signup creates tenant, seeds default roles, leave types, salary components, statutory settings (from India template), and a guided setup checklist (BRD NFR-09).

---

## 4. Data Model (Key Entities)

> **Notation:** entity → notable fields. All tenant-owned tables carry `id` (uuid), `tenant_id`, `created_at`, `updated_at`, `created_by`.

### 4.1 Identity & Org

- `tenant` → name, plan, status, statutory_profile (PF/ESI registration numbers, PT states)
- `user` → email/phone, password_hash, mfa_secret, status; 1..1 with employee (nullable for external accountant users)
- `role` / `permission` / `user_role` → RBAC with field-level sensitivity flags (e.g., `salary.view`) [ADM-01]
- `location` → name, address, state (drives PT/LWF), geo_fence (lat, lng, radius)
- `department` / `designation` / `grade`

### 4.2 Core HR

- `employee` → emp_code, name, dob, gender, join_date, employment_type, department_id, designation_id, grade_id, location_id, manager_id, status (onboarding/active/notice/exited), confirmation_date
- `employee_identifiers` → PAN, Aadhaar (encrypted, masked display), UAN, ESIC number, bank account (encrypted), IFSC [CHR-01, NFR-04]
- `employee_event` → type (join/confirm/transfer/promote/increment/exit), effective_date, payload (JSONB), **immutable** [CHR-07]
- `document` → owner (employee/candidate), type, s3_key, expiry_date [CHR-03]
- `letter_template` / `generated_letter` [CHR-06]
- `custom_field_definition` / `custom_field_value` (JSONB-backed) [CHR-10]
- `exit_record` → resignation_date, notice_days, last_working_day, clearance_checklist (JSONB), exit_interview [CHR-05]

### 4.3 Attendance & Leave

- `shift` → start, end, grace_minutes, is_night; `roster_assignment` → employee, shift, date_range, weekly_off_pattern [ATT-04]
- `punch_event` → employee_id, ts, source (mobile/web/biometric/import), lat/lng, selfie_key, device_id — **append-only** [ATT-01..03]
- `attendance_day` → employee_id, date, status (P/A/½/L/WFH/OD/H/WO), first_in, last_out, work_minutes, ot_minutes, locked_flag — derived nightly + on-demand [ATT-08, ATT-09]
- `regularization_request` [ATT-05]
- `leave_type` → code, accrual_rule (JSONB), carry_forward_rule, encashable [LVE-01, LVE-02]
- `leave_balance` → employee, leave_type, year, opening, accrued, used, encashed
- `leave_request` → dates, days (supports half-day), status, approver_chain (JSONB) [LVE-03]
- `holiday_calendar` / `holiday` → location-scoped, optional_flag [LVE-04]

### 4.4 Payroll

- `salary_component` → code, name, type (earning/deduction), calc_rule (fixed/%of-basic/formula), taxable_flag, pf_wage_flag, esi_wage_flag [PAY-01]
- `salary_structure` → employee_id, effective_from, components[] (amounts/percentages), ctc_annual — **versioned, never edited in place**
- `payroll_run` → month, status (draft/preview/approved/finalized), locked_attendance_snapshot_id, totals; `payroll_run_item` → employee, earnings (JSONB), deductions (JSONB), employer_costs (JSONB), lop_days, net_pay [PAY-03]
- `statutory_config` → PF/ESI/PT/LWF/TDS rate tables with effective-date versioning — **data, not code** [NFR-12]
- `investment_declaration` → regime, sections (80C/80D/HRA…), declared vs verified amounts, proof documents [PAY-07]
- `fnf_settlement` → components incl. leave encashment, gratuity, notice recovery [PAY-08]
- `loan` / `loan_emi`, `reimbursement_claim` [PAY-09, PAY-10]
- `payslip` → run_item_id, pdf_key, published_at
- `audit_log` → actor, entity, action, before/after (JSONB), ts — **write-only** [ADM-03, NFR-08]

### 4.5 ATS / PMS / LND (summary)

- `job_requisition`, `candidate`, `application`, `pipeline_stage`, `interview`, `scorecard`, `offer` [REC-01..07]
- `goal`, `review_cycle`, `review_form`, `review_response`, `final_rating`, `feedback_note` [PMS-01..06]
- `course`, `course_module`, `quiz`, `assignment`, `enrollment_progress`, `certificate` [LND-01..05]

---

## 5. Module Technical Specifications

### 5.1 Attendance Processing (ATT)

**TR-10 — Punch ingestion.** All sources write immutable `punch_event` rows. Mobile punch validates: geo-fence distance (Haversine vs location radius), device time skew ≤ 5 min vs server, optional selfie stored to S3. Offline punches queue on device and sync with original timestamp + `offline=true` flag for HR visibility.

**TR-11 — Day derivation.** A nightly job (and on-demand recompute) folds punches + roster + approved leave/OD/WFH into `attendance_day` using per-tenant rules: grace minutes, half-day threshold, late-count penalties [ATT-06]. Derivation is **deterministic and re-runnable**; recompute is blocked for locked months.

**TR-12 — Month lock.** HR locks a month per location [ATT-09]; lock snapshots `attendance_day` aggregates (payable days, LOP, OT hours) into an immutable snapshot referenced by the payroll run. Unlock requires Payroll Admin role + reason, and **voids any draft payroll run** using that snapshot.

**TR-13 — Biometric integration.** Phase 2: (a) CSV/Excel import with validation report (mandatory), (b) device push protocol for ESSL/ZKTeco-class devices via an ingestion endpoint keyed by device serial + shared secret. Duplicate suppression on (device_id, emp_code, ts).

### 5.2 Leave Engine (LVE)

**TR-15 — Accrual job.** Monthly job posts accruals per `leave_type.accrual_rule` (JSONB DSL: frequency, rate, pro-rata on join/exit month, cap). Year-end job applies carry-forward/lapse/encashment marking [LVE-02]. All balance mutations go through a **ledger** (`leave_txn`) — balances are derived, never directly edited; manual adjustments are ledger entries with reason.

**TR-16 — Validation on apply:** balance sufficiency (unless LOP), overlap check, sandwich rules (optional per policy), notice-period restrictions. Approval chain resolved from workflow config [ADM-02] with delegation and 72h auto-escalation.

### 5.3 Payroll Computation (PAY) — Core Logic

**TR-20 — Run pipeline** (draft → preview → approved → finalized, each transition audited):

1. Resolve eligible employees (active any day in month; joiners/exits pro-rated by calendar days).
2. Pull locked attendance snapshot → payable days, LOP days, OT.
3. Resolve effective `salary_structure` (as of month); compute earned components: `earned = monthly_component × payable_days / month_days`.
4. Apply one-time earnings/deductions, arrears, approved reimbursements, loan EMIs.
5. Statutory engine (below).
6. Net pay = gross earnings − total deductions. Persist run items; generate variance report vs previous month [PAY-13].

**TR-21 — Statutory engine** (all rates from versioned `statutory_config`, effective-dated):

- **EPF:** PF wage = Σ components flagged `pf_wage` (Basic + DA typically). Employee 12% of PF wage. Employer 12% split: EPS = 8.33% of min(PF wage, ₹15,000); EPF = remainder. EDLI + admin charges computed for employer cost. Ceiling behavior configurable (restrict to ₹15,000 vs actual) per tenant election.
- **ESI:** applicable if gross ≤ ₹21,000 at contribution-period start; employee 0.75%, employer 3.25% of ESI wage; contribution-period continuation rule (remain covered till period end even if wage crosses threshold mid-period).
- **PT:** slab lookup by (state of work location, gross/month); supports states with annual quirks (e.g., Karnataka ₹200/month; Maharashtra Feb ₹300).
- **LWF:** state schedule (monthly/half-yearly/annual) from config.
- **TDS (Sec 192):** annualize projected taxable income = (earned YTD + projected remaining months) − exemptions (HRA calc: min of actual HRA, rent−10% basic, 50%/40% basic by metro) − standard deduction − declared/verified Chapter VI-A (per regime rules); compute annual tax per regime slabs + cess; monthly TDS = (annual tax − TDS paid YTD) / remaining months. Regime per employee declaration [PAY-07]; proof verification window switches computation from declared → verified amounts.

> **Worked example (validation fixture):** Employee, Karnataka, new regime FY 2026-27 slabs from config; monthly Basic ₹30,000, HRA ₹15,000, Special ₹15,000 (gross ₹60,000); full attendance. PF wage = ₹30,000 → employee PF ₹3,600; EPS = 8.33% × 15,000 = ₹1,249.50 → ₹1,250 (rounding rule: nearest rupee, EPS rounding per EPFO convention), employer EPF = ₹3,600 − ₹1,250 = ₹2,350. ESI: N/A (gross > ₹21,000). PT (KA): ₹200. TDS: computed from annualized ₹7.2L gross per engine. **Golden tests must lock outputs like these for every statute (see §9).**

**TR-22 — Determinism & immutability.** Finalized runs are immutable; corrections happen via next-month arrears or a reversal run. All intermediate inputs (snapshot ids, structure versions, config versions) are stored on the run for full reproducibility [PAY-13, NFR-08].

**TR-23 — Outputs:** payslip PDFs (HTML template → Chromium worker, password option = PAN uppercase + DOB per convention) [PAY-04]; bank NEFT file per configurable bank template (CSV/TXT column mapping) [PAY-05]; PF ECR text file per EPFO spec; ESI/PT/LWF registers; TDS register (24Q-ready); Form 16 Part B annually [PAY-06]; Tally XML voucher export [PAY-11].

**TR-24 — F&F:** triggered from exit workflow; composes final month earnings + leave encashment (per-day = monthly gross or basic per policy × encashable days) + gratuity if ≥ 5 years (15/26 × last basic+DA × completed years, >6 months rounds up) − notice recovery − outstanding loans [PAY-08].

### 5.4 ATS, PMS, LND (key technical notes)

**TR-30 (ATS):** hosted careers page rendered from tenant config at `careers.{product}.in/{tenant-slug}` (no auth); applications create candidates with dedup on email+phone; hired → employee conversion copies profile into onboarding state [REC-07]. Offer letters use the letter-template engine + e-sign integration.

**TR-31 (PMS):** review cycle is a state machine (setup → self → manager → normalization → published → acknowledged); form templates are JSONB schemas rendered dynamically; ratings locked on publish; bell-curve report reads aggregated ratings only for users with `pms.reports` permission.

**TR-32 (LND):** video via direct S3 upload (presigned) + streaming playback, or embedded YouTube; quiz engine with pass threshold and attempt limits; completion events drive certificate PDF generation; mandatory-training escalation uses the notification scheduler [LND-05].

---

## 6. API Design

**TR-40 — Conventions:** REST, JSON, versioned base path `/api/v1`; resource-oriented; cursor pagination (`?cursor=&limit=`); RFC 7807 `problem+json` errors; **idempotency keys on all mutating financial endpoints** (payroll, F&F); rate limiting per tenant + per user (Redis).

Representative endpoints (not exhaustive):

| Method & Path | Purpose | BRD Ref |
|---|---|---|
| `POST /auth/login`, `/auth/refresh`, `/auth/mfa/verify` | Auth | NFR-04 |
| `GET/POST/PATCH /employees`, `POST /employees:import` | Employee CRUD + bulk | CHR-01, CHR-09 |
| `POST /punches` | Mobile/web punch | ATT-01 |
| `POST /devices/{serial}/punches` | Biometric push | ATT-03 |
| `GET /attendance/days?month=`, `POST /attendance/locks` | Attendance view/lock | ATT-08/09 |
| `POST /leave-requests`, `POST /leave-requests/{id}/decision` | Leave flow | LVE-03/05 |
| `POST /payroll/runs`, `POST /payroll/runs/{id}/preview` · `/approve` · `/finalize` | Payroll pipeline | PAY-03 |
| `GET /payroll/runs/{id}/outputs/{type}` | ECR/bank/registers download | PAY-05/06 |
| `POST /declarations`, `POST /declarations/{id}/verify` | Tax declarations | PAY-07 |
| `POST /requisitions`, `/applications`, `PATCH /applications/{id}/stage` | ATS pipeline | REC-01/03 |
| `POST /review-cycles`, `/review-responses` | PMS | PMS-02/03 |
| `POST /courses`, `/assignments`, `/progress` | LND | LND-01..03 |
| `GET /reports/{code}?params`, `POST /exports` | Reporting | RPT-01..03 |

**TR-41 — Webhooks (V1.5):** outbound events (`employee.created`, `payroll.finalized`) with HMAC signatures for accountant/ERP tooling.

---

## 7. Integrations

| Integration | Direction | Mechanism | Phase |
|---|---|---|---|
| Biometric devices (ESSL/ZKTeco class) | In | Device push endpoint + CSV import fallback | 2 |
| Bank salary transfer | Out | Downloadable NEFT file per bank template; no direct bank API in V1 | 2 |
| E-sign (offer letters, policy ack) | Out/In | Vendor API (e.g., Aadhaar eSign-capable provider); webhook on completion | 1 (policy ack), 3 (offers) |
| Email | Out | Transactional provider (SES-class), per-tenant sender config | 1 |
| Push notifications | Out | FCM/APNs | 1 |
| SMS / WhatsApp | Out | DLT-registered SMS provider; WhatsApp Business API post-approval | 2/3 |
| Tally | Out | Voucher XML/Excel export file | 2 |
| Job boards | Out | Deferred (BRD REC-09 = V2) | — |

---

## 8. Security & Privacy Engineering (NFR-04, NFR-05)

- **TR-50 Authentication:** Argon2id password hashing; JWT (15-min access, rotating refresh); TOTP MFA mandatory for Super Admin/Payroll Admin; session revocation list in Redis.
- **TR-51 Authorization:** permission checks at API layer + field-level redaction in serializers (salary, identifiers) driven by role flags; RLS as the final backstop.
- **TR-52 PII protection:** Aadhaar, PAN, bank account encrypted at column level (AES-256-GCM, keys in cloud KMS, per-tenant data keys); UI shows masked values (XXXX-XXXX-1234); decrypt permission audited. Aadhaar stored only if tenant enables it; DPDP consent recorded at employee onboarding.
- **TR-53 DPDP obligations:** consent artifacts, data-principal request workflows (export/correct/erase where legally permissible — payroll records retained per statute override erasure, documented), 8-year retention for statutory records then scheduled purge [ADM-05, NFR-08].
- **TR-54 AppSec:** OWASP ASVS L2 checklist in CI; dependency scanning; secrets in vault; quarterly pen-test before Payroll GA; `audit_log` immutable (no UPDATE/DELETE grants).
- **TR-55 Transport & storage:** TLS 1.2+ everywhere; S3 buckets private, presigned-URL only; backups encrypted.

---

## 9. Quality & Testing Strategy

- **TR-60 Statutory golden-test suite:** version-controlled fixture library — ≥ 200 cases spanning PF ceiling elections, ESI threshold crossings, every PT state supported at launch, both tax regimes, HRA metro/non-metro, joiner/exit pro-rata, F&F with gratuity. Compliance SME signs the expected outputs; suite runs on every commit touching payroll; **any diff is a release blocker** (BRD R1).
- **TR-61 Parallel-run harness:** import a pilot customer's previous-month payroll register; diff engine highlights per-employee deltas — used for the two mandatory parallel cycles before Payroll GA.
- **TR-62 Tenant-isolation tests:** automated suite attempts cross-tenant reads/writes for every module.
- **TR-63 Standard pyramid:** unit ≥ 70% on domain logic, API integration tests per endpoint, E2E smoke (Playwright) on critical journeys (punch→lock→payroll→payslip; apply-leave→approve; candidate→hire→onboard).
- **TR-64 Performance tests:** payroll 200-employee run < 5 min; punch endpoint 50 rps sustained; p95 API < 400 ms (NFR-02).

---

## 10. Environments & Delivery (summary — detailed in Architecture Doc)

- **Environments:** dev → staging (anonymized seed data) → production (Indian region).
- **CI/CD:** trunk-based, PR checks (tests, lint, security scan), one-click deploy, feature flags for phased module rollout (BRD §13).
- **Observability:** structured logs with `tenant_id` correlation, metrics + alerts on payroll job failures, error tracking. Payroll-week change freeze (NFR-01).

---

## 11. Traceability Matrix (excerpt)

| BRD Req | TRD Item(s) |
|---|---|
| PAY-02 | TR-21, TR-60 |
| PAY-03 | TR-20, TR-22, TR-40 |
| ATT-09 | TR-12 |
| NFR-05 | TR-52, TR-53 |
| NFR-07 | TR-01, TR-62 |
| ADM-03 | §4.4 `audit_log`, TR-22, TR-54 |

Full matrix to be maintained in the project tracker with one row per BRD requirement.

---

## 12. Open Technical Decisions

| # | Decision | Options | Recommendation |
|---|---|---|---|
| OD-1 | Backend framework | NestJS vs Django | Whichever the founding engineers know best; TRD assumes NestJS |
| OD-2 | Mobile | React Native vs Flutter | React Native (web code sharing) |
| OD-3 | E-sign vendor | Aadhaar eSign providers vs simple click-wrap | Click-wrap for policy ack (Phase 1); evaluate Aadhaar eSign for offers |
| OD-4 | WhatsApp BSP | Meta direct vs BSP partner | BSP partner (faster approval) |
| OD-5 | PF ceiling default | Restrict to ₹15,000 vs actual wage | Tenant-electable; default restrict |
