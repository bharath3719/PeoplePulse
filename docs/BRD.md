# Business Requirements Document (BRD)

**Product:** "PeoplePulse" — Cloud HRMS for Indian SMBs
*(Working title — replace with final product name)*

---

## 1. Document Control

| Field | Detail |
|---|---|
| Document Title | Business Requirements Document — PeoplePulse HRMS |
| Version | 1.0 (Draft) |
| Date | 13 July 2026 |
| Author | Product Team |
| Reviewers | Founder/Sponsor, Engineering Lead, HR Domain SME, Compliance Advisor |
| Status | Draft — Pending Review |

### Revision History

| Version | Date | Author | Change Summary |
|---|---|---|---|
| 0.1 | 13-Jul-2026 | Product Team | Initial draft |
| 1.0 | 13-Jul-2026 | Product Team | Full-suite scope, India compliance, phased release plan |

---

## 2. Executive Summary

PeoplePulse is a cloud-based, mobile-first Human Resource Management System (HRMS) targeting Indian small and medium businesses (10–200 employees). It consolidates the full employee lifecycle — hire to retire — into a single platform: Core HR, Attendance & Time, Leave, Payroll (India statutory-compliant), Recruitment (ATS), Performance Management, and Learning & Development (L&D).

Indian SMBs today run HR on spreadsheets, WhatsApp, standalone biometric devices, and outsourced payroll vendors. This fragmentation causes payroll errors, statutory non-compliance penalties (PF/ESI/TDS), poor employee experience, and zero people analytics. PeoplePulse replaces this patchwork with one affordable, self-serve, compliance-first system.

**Business model:** SaaS subscription, per-employee-per-month (PEPM) pricing with tiered plans, targeting ₹40–₹120 PEPM depending on module bundle.

---

## 3. Business Objectives & Success Metrics

| # | Objective | Success Metric (12 months post-GA) |
|---|---|---|
| BO-1 | Acquire paying SMB customers | 150+ paying companies; 8,000+ active employee records |
| BO-2 | Reduce customer payroll processing time | Payroll run completed in < 2 hours for a 100-employee org (baseline: 2–3 days) |
| BO-3 | Ensure statutory compliance | 100% accurate PF/ESI/PT/TDS computations; zero customer penalties attributable to platform errors |
| BO-4 | Drive employee self-service adoption | ≥ 70% of employees active on mobile/web ESS monthly |
| BO-5 | Retention & satisfaction | Logo churn < 3% monthly; NPS ≥ 40 |
| BO-6 | Reduce manual HR workload | ≥ 50% reduction in HR admin hours (customer-reported) |

---

## 4. Scope

### 4.1 In Scope (V1 across phased releases — see §13)

- **Core HR** — employee master data, org structure, documents, onboarding/offboarding workflows, letters.
- **Attendance & Time** — mobile punch (geo-fenced, selfie), web punch, biometric device integration, shifts & rosters, overtime.
- **Leave Management** — configurable leave policies, holiday calendars, approvals, accruals, encashment, comp-off.
- **Payroll (India)** — salary structures (CTC breakdown), monthly payroll runs, statutory computations (PF, ESI, PT, TDS, LWF), payslips, Form 16, full & final settlement, gratuity, bank transfer files.
- **Recruitment (ATS)** — job requisitions, careers page, candidate pipeline, interview scheduling, offer letters, candidate-to-employee conversion.
- **Performance Management** — goal/OKR setting, review cycles (annual/half-yearly), self + manager reviews, ratings, feedback.
- **Learning & Development** — course catalog (video/doc/quiz), assignments, completion tracking, certificates.
- **Employee Self-Service (ESS)** — web + mobile apps for employees and managers.
- **Reports & Analytics** — standard reports per module, dashboards, export (Excel/CSV/PDF).
- **Platform Administration** — multi-company support, role-based access, approval workflows, audit logs, notifications (email/push/WhatsApp\*).

### 4.2 Out of Scope (V1)

- Multi-country payroll (India only)
- Benefits administration/insurance marketplace
- Advanced workforce planning & succession planning
- Contractor/gig-worker payments (only salaried employees)
- Employee helpdesk/ticketing
- Deep ERP integrations (Tally export file only, not live sync)
- On-premise deployment

### 4.3 Assumptions of Scope

- Single legal-entity payroll per company account (multi-entity in V2).
- English UI in V1; Hindi + regional languages in V2.
- WhatsApp notifications subject to Meta Business API approval; email/push are the committed channels.

---

## 5. Stakeholders & User Personas

### 5.1 Stakeholders

| Stakeholder | Interest |
|---|---|
| Founder/Sponsor | Business viability, market fit, cost control |
| Product & Engineering | Feasible, phased delivery |
| Compliance/Payroll SME | Statutory correctness (PF/ESI/TDS) |
| Pilot Customers (3–5 SMBs) | Usable product; early feedback |
| Investors (future) | Traction metrics |

### 5.2 Personas

| Persona | Description | Primary Goals |
|---|---|---|
| HR Admin (Priya) | Sole HR person at a 60-employee company; wears many hats | Run payroll error-free, stop chasing attendance data, generate compliance reports |
| Founder/Owner (Rajesh) | SMB owner, approves payouts | Visibility into headcount cost, attrition, payroll approval on mobile |
| Manager (Anil) | Team lead of 8 | Approve leaves fast, track team attendance, run performance reviews |
| Employee (Sneha) | Field/desk employee | Punch in from phone, apply leave, download payslip, see tax deductions |
| Accountant (CA firm) | External accountant | Download payroll registers, TDS reports, Tally-compatible exports |
| Candidate (external) | Job applicant | Apply easily, track application status |

---

## 6. Current State & Problem Statement

Typical Indian SMB (10–200 employees) HR operations today:

- Employee data lives in Excel sheets and physical files; no single source of truth.
- Attendance captured on standalone biometric devices or registers; data manually exported and reconciled monthly.
- Leave requested over WhatsApp/email; balances tracked (inaccurately) in spreadsheets.
- Payroll either done manually in Excel (error-prone) or outsourced (₹80–150/employee/month, slow turnaround, no employee visibility).
- Compliance (PF ECR filing, ESI, PT, TDS returns) handled by external consultants with frequent data mismatches; penalties for late/incorrect filing are common.
- Recruitment managed via job portals + email; no pipeline visibility.
- Performance & training are ad hoc or absent, hurting retention.

**Consequences:** payroll errors (3–7% of runs), compliance penalties, 5–10 HR-hours/week wasted on reconciliation, poor employee trust, no data for decisions.

---

## 7. Proposed Solution Overview

A single multi-tenant SaaS platform where:

- HR configures company settings (locations, departments, policies, salary structures) once during guided onboarding.
- Employees are onboarded digitally; their data flows automatically from ATS → Core HR → Payroll.
- Attendance and leave data flow into payroll with zero manual reconciliation ("attendance-to-payroll in one click").
- Payroll computes all Indian statutory deductions automatically, generates payslips, bank files, and compliance-ready reports (PF ECR, ESI, PT, TDS/24Q inputs).
- Employees and managers self-serve via mobile app, drastically reducing HR queries.
- Performance and L&D modules close the loop on talent development.

**Key differentiators for SMB segment:** 30-minute self-serve setup, pre-built India statutory templates, PEPM pricing with no implementation fee, WhatsApp-first notifications, and an accountant-friendly export pack.

---

## 8. Functional Requirements

Priority uses MoSCoW: **M**ust, **S**hould, **C**ould, **W**on't (this release).

### 8.1 Core HR (Module: CHR)

| ID | Requirement | Priority |
|---|---|---|
| CHR-01 | Maintain employee master: personal, contact, employment, bank, PAN/Aadhaar/UAN/ESIC identifiers, emergency contacts | M |
| CHR-02 | Configurable org structure: legal entity → locations → departments → designations → grades; reporting manager hierarchy | M |
| CHR-03 | Employee document vault (offer letter, PAN, Aadhaar, certificates) with expiry alerts | M |
| CHR-04 | Digital onboarding: offer-accepted candidate completes profile, uploads docs, e-signs policies before Day 1 | M |
| CHR-05 | Offboarding workflow: resignation, notice period tracking, clearance checklist, exit interview form, trigger F&F | M |
| CHR-06 | Letter generation from templates (offer, appointment, confirmation, increment, relieving, experience) with merge fields | S |
| CHR-07 | Employee lifecycle events: confirmation, transfer, promotion, increment — with effective dates and history | M |
| CHR-08 | Org chart visualization | C |
| CHR-09 | Bulk import/export of employee data via Excel template with validation report | M |
| CHR-10 | Custom fields (per company) on employee profile | S |

### 8.2 Attendance & Time (Module: ATT)

| ID | Requirement | Priority |
|---|---|---|
| ATT-01 | Mobile punch in/out with GPS geo-fencing and optional selfie capture | M |
| ATT-02 | Web punch from ESS portal | M |
| ATT-03 | Biometric device integration (ESSL/ZKTeco class devices) via device push or CSV import | S |
| ATT-04 | Shift management: fixed, rotational, night shifts; weekly-off patterns; roster assignment | M |
| ATT-05 | Attendance regularization requests (missed punch) with approval workflow | M |
| ATT-06 | Late-coming/early-going rules with configurable grace and penalty (e.g., 3 lates = ½ day LOP) | S |
| ATT-07 | Overtime capture and approval; OT rates configurable | S |
| ATT-08 | Daily attendance dashboard for HR/managers (present/absent/late/on-leave/WFH) | M |
| ATT-09 | Monthly attendance finalization ("lock") feeding payroll | M |
| ATT-10 | Work-from-home / on-duty request types | S |

### 8.3 Leave Management (Module: LVE)

| ID | Requirement | Priority |
|---|---|---|
| LVE-01 | Configurable leave types (CL/SL/EL/PL, maternity, paternity, LOP, comp-off) with accrual rules (monthly/yearly, pro-rata) | M |
| LVE-02 | Carry-forward, lapse, and encashment rules per leave type | M |
| LVE-03 | Multi-level leave approval workflow (manager → HR) | M |
| LVE-04 | Holiday calendars per location; optional/restricted holidays with employee choice | M |
| LVE-05 | Leave application via mobile/web with balance display and team calendar conflict view | M |
| LVE-06 | Comp-off earning from approved extra work days | S |
| LVE-07 | Maternity leave per Maternity Benefit Act (26 weeks) template | M |
| LVE-08 | Leave balance import at go-live | M |

### 8.4 Payroll — India (Module: PAY)

| ID | Requirement | Priority |
|---|---|---|
| PAY-01 | Configurable salary structures: earnings (Basic, HRA, Special Allowance, LTA, etc.) and deductions; CTC ↔ gross ↔ net computation | M |
| PAY-02 | Statutory computations: EPF (employee 12%, employer 12% with EPS split, wage ceiling rules), ESI (0.75%/3.25%, ₹21,000 threshold), Professional Tax (state-wise slabs), LWF (state-wise), TDS on salary (old & new regime) | M |
| PAY-03 | Monthly payroll run wizard: pull locked attendance/leave (LOP), new joiners/exits pro-rata, arrears, one-time earnings/deductions, preview → approve → finalize | M |
| PAY-04 | Payslip generation (PDF) and publication to ESS; password-protected email option | M |
| PAY-05 | Bank transfer file generation (NEFT format, configurable per bank) | M |
| PAY-06 | Statutory output reports: PF ECR text file, ESI return data, PT report by state, TDS deduction register (24Q-ready data), Form 16 Part B generation | M |
| PAY-07 | Employee investment declaration (80C, 80D, HRA rent, home loan) with proof upload and HR verification window | M |
| PAY-08 | Full & Final settlement: leave encashment, gratuity (Payment of Gratuity Act formula), notice recovery, pending dues | M |
| PAY-09 | Reimbursement claims (fuel, telecom, LTA) with approval and payout via payroll | S |
| PAY-10 | Loan/advance management with EMI auto-deduction | S |
| PAY-11 | Payroll journal export for Tally (XML/Excel) | S |
| PAY-12 | Bonus computation support (Payment of Bonus Act) | C |
| PAY-13 | Payroll lock, audit trail of every change, and variance report vs previous month | M |

### 8.5 Recruitment / ATS (Module: REC)

| ID | Requirement | Priority |
|---|---|---|
| REC-01 | Job requisition creation and approval | M |
| REC-02 | Hosted careers page per company with application form; resume upload | M |
| REC-03 | Candidate pipeline board (Sourced → Screening → Interview → Offer → Hired/Rejected), drag-and-drop | M |
| REC-04 | Resume parsing to auto-fill candidate fields | C |
| REC-05 | Interview scheduling with panel, feedback scorecards | S |
| REC-06 | Offer letter generation and digital acceptance | M |
| REC-07 | One-click convert hired candidate → employee (data flows to Core HR onboarding) | M |
| REC-08 | Email templates and automated candidate status notifications | S |
| REC-09 | Job board posting integration (Naukri/LinkedIn/Indeed) | W (V2) |

### 8.6 Performance Management (Module: PMS)

| ID | Requirement | Priority |
|---|---|---|
| PMS-01 | Goal/OKR setting per employee with weightages; manager alignment/cascade | M |
| PMS-02 | Review cycles: configurable (annual/half-yearly/quarterly), timeline stages (self → manager → normalization → publish) | M |
| PMS-03 | Self-assessment and manager assessment forms (configurable templates, rating scales) | M |
| PMS-04 | Final rating publication and employee acknowledgment | M |
| PMS-05 | Continuous feedback (praise/notes) outside cycles | S |
| PMS-06 | Rating distribution/bell-curve report for HR | S |
| PMS-07 | 360° feedback | W (V2) |
| PMS-08 | Increment letter trigger from published ratings | C |

### 8.7 Learning & Development (Module: LND)

| ID | Requirement | Priority |
|---|---|---|
| LND-01 | Course creation: video (upload/YouTube link), documents, external links, quizzes | M |
| LND-02 | Course assignment to individuals/departments/all; due dates | M |
| LND-03 | Progress and completion tracking; quiz pass thresholds | M |
| LND-04 | Auto-generated completion certificates | S |
| LND-05 | Mandatory compliance training flags (e.g., POSH) with reminder escalation | S |
| LND-06 | Training feedback forms | C |
| LND-07 | SCORM support | W (V2) |

### 8.8 Employee Self-Service & Mobile (Module: ESS)

| ID | Requirement | Priority |
|---|---|---|
| ESS-01 | Mobile apps (Android priority, iOS) + responsive web: punch, leave, payslips, holidays, profile, approvals | M |
| ESS-02 | Manager view: team attendance, pending approvals (leave/regularization/claims) with one-tap approve | M |
| ESS-03 | Push notifications for approvals, payslip publication, announcements | M |
| ESS-04 | Company announcements/notice board | S |
| ESS-05 | Employee directory with search | S |
| ESS-06 | Profile edit requests with HR approval for sensitive fields | M |

### 8.9 Reports, Analytics & Admin (Module: RPT / ADM)

| ID | Requirement | Priority |
|---|---|---|
| RPT-01 | Standard reports per module (≥ 25 at GA): headcount, attrition, attendance muster roll (Form 25 style), leave balances, salary register, statutory registers, pipeline, review status, training completion | M |
| RPT-02 | HR dashboard: headcount, joiners/exits, attrition %, attendance summary, payroll cost trend | M |
| RPT-03 | Export to Excel/CSV/PDF; scheduled email reports | S |
| ADM-01 | Role-based access control: pre-built roles (Super Admin, HR Admin, Payroll Admin, Manager, Employee) + custom roles with field-level sensitivity (salary visibility) | M |
| ADM-02 | Approval workflow configuration (levels, delegation, auto-escalation) | M |
| ADM-03 | Audit log of all sensitive actions (who/what/when/old→new) | M |
| ADM-04 | Notification templates and channel settings (email, push; WhatsApp when approved) | S |
| ADM-05 | Data export (full company data) and account closure per DPDP obligations | M |

---

## 9. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Availability | 99.5% uptime (GA); 99.9% target by month 12. Payroll week (25th–5th) treated as change-freeze critical window |
| NFR-02 | Performance | Page loads < 2s (p95); payroll run for 200 employees < 5 minutes; mobile punch round-trip < 3s on 4G |
| NFR-03 | Scalability | Architecture supports 500 tenant companies / 50,000 employee records in year 1 without redesign |
| NFR-04 | Security | Encryption in transit (TLS 1.2+) and at rest; field-level protection for salary, PAN, Aadhaar, bank data; OWASP ASVS L2 practices; MFA for admin roles |
| NFR-05 | Data Privacy | Compliance with India DPDP Act 2023: consent capture, purpose limitation, data principal rights (access/correction/erasure), breach notification readiness |
| NFR-06 | Data Residency | All customer data hosted in Indian data-center regions |
| NFR-07 | Multi-tenancy | Strict tenant isolation; no cross-tenant data access paths |
| NFR-08 | Auditability | Immutable audit trail for payroll and master-data changes, retained ≥ 8 years (statutory records) |
| NFR-09 | Usability | Self-serve company onboarding in ≤ 30 minutes; WCAG 2.1 AA for web ESS |
| NFR-10 | Backup/DR | Daily backups, 35-day retention; RPO ≤ 24h, RTO ≤ 8h at GA |
| NFR-11 | Browser/Device | Latest 2 versions Chrome/Edge/Safari/Firefox; Android 9+; iOS 15+ |
| NFR-12 | Maintainability | Statutory rate tables (PF/ESI/PT/TDS slabs) configurable without code deployment |

---

## 10. Compliance & Statutory Requirements (India)

The platform must correctly implement and keep current:

| Area | Statute / Rule | Platform Obligation |
|---|---|---|
| Provident Fund | EPF & MP Act 1952 | 12% employee + 12% employer (8.33% EPS capped at ₹15,000 wage, balance EPF); ECR file generation; UAN capture |
| ESI | ESI Act 1948 | 0.75% employee / 3.25% employer for gross ≤ ₹21,000; contribution period rules; return data |
| Professional Tax | State Acts (KA, MH, WB, TN, etc.) | State-wise slab engine; monthly/annual remittance reports |
| Income Tax (TDS) | Income Tax Act — Sec 192 | Old vs new regime, declarations & proofs, monthly TDS, Form 16 Part B, 24Q data |
| Labour Welfare Fund | State LWF Acts | State-wise contribution schedule |
| Gratuity | Payment of Gratuity Act 1972 | 15/26 formula on last drawn basic+DA, 5-year eligibility, F&F integration |
| Bonus | Payment of Bonus Act 1965 | 8.33%–20% computation support (Could) |
| Maternity | Maternity Benefit Act 1961 | 26-week paid leave template |
| Minimum Wages / S&E | State rules | Muster roll & register report formats |
| Data Protection | DPDP Act 2023 | Consent, rights handling, breach process, data residency |

> **Compliance governance:** a named Compliance SME must sign off statutory logic each release; rate tables reviewed every Union/State budget cycle. **Compliance errors are Sev-1 defects.**

---

## 11. Assumptions, Constraints & Dependencies

### Assumptions

- **A1.** Customers have at least one HR/admin user with basic computer literacy; onboarding is self-serve with guided checklists.
- **A2.** Employees have smartphones for ESS (fallback: kiosk/web punch).
- **A3.** Pilot customers (3–5) are committed before build completion for feedback loops.

### Constraints

- **C1.** Lean initial team; budget favors phased delivery over big-bang.
- **C2.** India-only statutory logic in V1.
- **C3.** WhatsApp Business API approval timeline outside our control.

### Dependencies

- **D1.** Payroll/compliance SME (internal or retained CA firm) for rules validation and test cases.
- **D2.** Cloud provider with Indian regions.
- **D3.** SMS/email/push providers; biometric device vendor documentation.
- **D4.** Digital signature/e-sign provider for offer letters and policy acknowledgment (Aadhaar eSign optional).

---

## 12. Risks & Mitigations

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | Statutory computation errors → customer penalties, trust loss | High | Medium | SME sign-off, golden test-case suite per statute, parallel-run payroll with pilot customers for 2 cycles |
| R2 | Full-suite V1 scope causes delay/quality issues | High | High | Phased releases (§13); Performance & L&D ship after payroll stabilizes |
| R3 | Payroll module competes with entrenched outsourcing habit | Medium | Medium | Offer "assisted payroll" onboarding; accountant export pack; CA-partner channel |
| R4 | Data breach of PII (Aadhaar/PAN/salary) | High | Low | Encryption, field-level access, security review before payroll GA, breach runbook |
| R5 | Biometric device fragmentation | Medium | High | Ship CSV import first; support top 2 device brands; mobile punch as primary |
| R6 | Statutory rule changes (budget) mid-cycle | Medium | High | Config-driven rate tables (NFR-12); compliance watch calendar |
| R7 | Low employee app adoption undermines value | Medium | Medium | WhatsApp/push nudges, vernacular UI in V2, manager-driven rollout kit |

---

## 13. Phased Release Plan

| Phase | Target | Modules / Capabilities | Rationale |
|---|---|---|---|
| **Phase 1 — Foundation** (Months 0–4) | Private beta | Core HR, Attendance (mobile/web punch), Leave, ESS mobile v1, Admin/RBAC, basic reports | Fastest path to daily-active usage; builds the data spine payroll needs |
| **Phase 2 — Payroll** (Months 4–8) | GA | Full India payroll + statutory outputs, investment declarations, F&F, bank files, Tally export; biometric integration | Highest-value, highest-risk module gets dedicated focus + 2 parallel-run cycles with pilots |
| **Phase 3 — Talent** (Months 8–12) | GA+ | Recruitment/ATS, Performance Management, L&D, advanced dashboards, WhatsApp notifications | Completes full suite once transactional core is stable |

**Exit criteria per phase:** pilot sign-off, defect thresholds (zero Sev-1/Sev-2 open), and support-readiness (docs, runbooks).

---

## 14. Glossary

| Term | Meaning |
|---|---|
| CTC | Cost to Company — total annual employment cost |
| LOP | Loss of Pay — unpaid absence deducted in payroll |
| ECR | Electronic Challan-cum-Return — monthly PF filing file |
| ESS | Employee Self-Service |
| F&F | Full & Final settlement on exit |
| UAN | Universal Account Number (PF) |
| PEPM | Per Employee Per Month pricing |
| MoSCoW | Must/Should/Could/Won't prioritization |
| DPDP | Digital Personal Data Protection Act, 2023 |

---

## 15. Approval

| Role | Name | Signature | Date |
|---|---|---|---|
| Business Sponsor | | | |
| Product Lead | | | |
| Engineering Lead | | | |
| Compliance SME | | | |
