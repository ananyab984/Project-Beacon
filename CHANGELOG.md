# Project Beacon — Changelog

All notable changes across implementation phases are documented in this file.

---

## [Phase 1] — Bug Fixes & Security Scoping
**Date:** 2026-08-17

### 1. Lead Name Pre-Enrichment Display Priority
Fixed an issue where leads with manually-entered full names were displaying random placeholder IDs (`maskedLabel`, e.g. `Lead #LW1G4N`) prior to enrichment completion.

**Modified Files:**
- [`client/src/components/features/lead-card.tsx`](file:///Users/ananya/Desktop/Global3/client/src/components/features/lead-card.tsx)
  - Updated `label` priority to `lead.displayName ?? lead.fullName ?? lead.maskedLabel ?? "—"`.
- [`client/src/routes/recruiter.leads.tsx`](file:///Users/ananya/Desktop/Global3/client/src/routes/recruiter.leads.tsx)
  - Updated table row `label` rendering to prioritize `displayName ?? fullName ?? maskedLabel`.
  - Updated `ActivityCell` dialog title to show manual name over masked label.
  - Updated `sortVal` lead name sorting key to prioritize `displayName ?? fullName ?? maskedLabel`.
- [`client/src/routes/owner.leads.tsx`](file:///Users/ananya/Desktop/Global3/client/src/routes/owner.leads.tsx)
  - Updated table row `label` rendering to prioritize `displayName ?? fullName ?? maskedLabel`.
  - Updated `sortVal` lead name sorting key to prioritize `displayName ?? fullName ?? maskedLabel`.

---

### 2. Email & Outreach Account Connection Status Synchronization
Fixed UI flicker and stale state where connected email/LinkedIn accounts would falsely indicate "not connected" upon login or page refresh, and modal auto-popped unnecessarily.

**Modified Files:**
- [`client/src/routes/recruiter.tsx`](file:///Users/ananya/Desktop/Global3/client/src/routes/recruiter.tsx)
  - Removed uncoordinated mount-time fetch that force-opened the connection dialog on initial hydration.
  - Added React Query cache invalidation (`["connected-accounts"]`) upon Unipile OAuth redirect completion and popup postMessage events.
- [`client/src/components/features/connect-account-dialog.tsx`](file:///Users/ananya/Desktop/Global3/client/src/components/features/connect-account-dialog.tsx)
  - Removed `enabled: isOpen` gating on `useQuery` so the connection status cache remains warm and consistent across dialog opens.
  - Added `staleTime: 30_000` to prevent redundant network requests on every interaction.
- [`client/src/routes/recruiter.settings.tsx`](file:///Users/ananya/Desktop/Global3/client/src/routes/recruiter.settings.tsx)
  - Added `staleTime: 30_000` to `["connected-accounts"]` query.
- [`client/src/routes/owner.settings.tsx`](file:///Users/ananya/Desktop/Global3/client/src/routes/owner.settings.tsx)
  - Added `staleTime: 30_000` to `["connected-accounts"]` query.

---

### 3. LinkedIn Conversation Recruiter Scoping (Security)
Enforced server-side recruiter scoping so recruiters can only access and interact with their own conversation threads, preventing cross-recruiter visibility.

**Modified Files:**
- [`server/src/routes/conversation.routes.ts`](file:///Users/ananya/Desktop/Global3/server/src/routes/conversation.routes.ts)
  - `GET /api/conversations`: Added `where = role === "owner" ? {} : { recruiterId: req.user.id }` query-level filter.
  - `GET /api/conversations/:id`: Added authorization check returning `403 FORBIDDEN` if a non-owner tries to read another recruiter's conversation.
  - `POST /api/conversations/:id/messages`: Added authorization check returning `403 FORBIDDEN` if a non-owner attempts to send messages in another recruiter's thread.

---

## [Phase 2] — Rubric Aggregation Implementation & Unipile Mapping
**Date:** 2026-08-17

Implemented exact mathematical scoring and aggregation matching `final rubrics.pdf` and `final rubrics calculation.pdf`.

### 1. Rubric Scored & Outcome Metrics Aggregation
- **Category A (100% Weight Composite):**
  - **Outreach Volume (30%, target 420 msgs, Higher is Better):** Counts outbound interaction events from Unipile webhook feed.
  - **Proactive Sourcing (30%, target 34 leads, Higher is Better):** Counts self-sourced leads created by the recruiter.
  - **Time-to-First-Touch (20%, target <= 1.0 day, Lower is Better):** Computes average business days between lead assignment/claim and earliest Unipile outbound message timestamp.
  - **Progression Rate (10%, target 80%, Higher is Better):** Computes distinct assigned leads advancing past NEW/CONTACTED stage.
  - **Reason-Logged Rate (10%, target 100%, Higher is Better):** Computes percentage of COLD closures and DNC flag events with documented reasons.
- **Category B (0% Weight Signal Metrics):**
  - Onboarding vs. Queue Size (`onboard_vs_queue`)
  - Cold Lead Conversion (`cold_lead_conversion`, target 18)
  - Manual Interviews (`manual_interviews`, target 15)
  - Manual Conversion (`manual_conversion`, target 10)
- **Score Band Classification:** Automatic calculation of `Strong` (>=85), `Solid` (70-84), `Coaching` (50-69), and `Review` (<50).

**Modified Files:**
- [`server/src/jobs/scoring.job.ts`](file:///Users/ananya/Desktop/Global3/server/src/jobs/scoring.job.ts)
  - Rewrote calculation engine to use exact PDF normalization rules, business days calculation, band labeling, and per-metric status snapshots.
- [`server/src/services/unipile.service.ts`](file:///Users/ananya/Desktop/Global3/server/src/services/unipile.service.ts)
  - Updated `message_received` webhook to capture provider-acknowledged timestamp (`body.timestamp`) and attach `recruiterId` for both inbound and outbound messages in `interaction_events`.
- [`server/src/routes/evaluation.routes.ts`](file:///Users/ananya/Desktop/Global3/server/src/routes/evaluation.routes.ts)
  - Added on-demand fallback scoring for new recruiters.
  - Added `POST /api/recruiters/:id/recompute-score` endpoint for immediate live recalculation.
- [`client/src/lib/api.ts`](file:///Users/ananya/Desktop/Global3/client/src/lib/api.ts)
  - Added `recomputeRecruiterScore` API method.

---

## [Phase 3] — Dashboard Auto-Sync & Real-Time Aggregation
**Date:** 2026-08-17

Implemented dashboard auto-sync architecture ensuring frontend consumes the exact backend aggregation source of truth.

### 1. Polling & Reactive Invalidation Strategy
- **Architecture Choice:** Implemented intelligent TanStack React Query polling (`refetchInterval: 10_000` with `staleTime: 5_000`) combined with mutation-based cache invalidation.
- **Rationale:** Polling is robust against network reconnects and tab suspensions while requiring zero persistent socket connection overhead. Combined with instant query invalidation upon user mutations (e.g. sending an email, logging an activity, progressing a lead), scores update instantly when triggered in-app and within seconds when fed asynchronously by Unipile webhooks.
- **Live Recalculate Score Action:** Added a dedicated button on the evaluation dashboard to trigger immediate server-side re-computation and cache refresh.

**Modified Files:**
- [`client/src/components/features/evaluation-dashboard.tsx`](file:///Users/ananya/Desktop/Global3/client/src/components/features/evaluation-dashboard.tsx)
  - Added 10s auto-sync polling interval for score and KPI summary queries.
  - Added live "Recalculate Score" button triggering `api.recomputeRecruiterScore`.
- [`client/src/routes/owner.recruiters.tsx`](file:///Users/ananya/Desktop/Global3/client/src/routes/owner.recruiters.tsx)
  - Added 10s auto-sync polling to roster `CleanRecruiterCard` score query.

---

## [Part B] — Client & Market Demand CRUD, Contractor Access Control, and Headcount Automation
**Date:** 2026-08-17

### 1. Client & Market Demand Full CRUD Endpoints
Implemented full CRUD operations and audit history tracking for Clients, Client Demands, and Requirements.

**Modified Files:**
- [`server/src/routes/client.routes.ts`](file:///Users/ananya/Desktop/Global3/server/src/routes/client.routes.ts)
  - Added `GET /api/clients/:id`: Single client detail with associated demands and requirements.
  - Added `PATCH /api/clients/:id`: Partial update of client metadata.
  - Added `DELETE /api/clients/:id`: Secure client deletion (owner only).
- [`server/src/routes/client-demand.routes.ts`](file:///Users/ananya/Desktop/Global3/server/src/routes/client-demand.routes.ts)
  - Added `GET /api/client-demands/:id`: Detail view of single demand line with service breakdown.
  - Added `PATCH /api/client-demands/:id`: Update priority, deadline, contact details, notes, and headcountNeeded (recomputing gap).
  - Added `DELETE /api/client-demands/:id`: Delete demand line and cascade service breakdown (owner only).
- [`server/src/routes/requirement.routes.ts`](file:///Users/ananya/Desktop/Global3/server/src/routes/requirement.routes.ts)
  - Added `GET /api/requirements/:id`: Single requirement detail with recruiter assignment and audit history.
  - Added `GET /api/requirements/:id/history`: Dedicated assignment history audit trail endpoint.
  - Expanded `PATCH /api/requirements/:id`: Update title, language, service, region, projectName, headcountNeeded, priority, status, deadline, and notes.
  - Added `DELETE /api/requirements/:id`: Delete requirement (owner only).
- [`client/src/lib/api.ts`](file:///Users/ananya/Desktop/Global3/client/src/lib/api.ts)
  - Added API client wrappers: `getClient`, `updateClient`, `deleteClient`, `getClientDemand`, `updateClientDemand`, `deleteClientDemand`, `getRequirement`, `updateRequirement`, `deleteRequirement`, `getRequirementHistory`.

### 2. Lead $\rightarrow$ Demand / Requirement Headcount Automation
- When a lead's stage is transitioned to `ONBOARDED` in `PATCH /api/leads/:id`:
  - Automatically matches active Requirements with matching language and positive gap.
  - Increments `filled`, decrements `gap`, and auto-sets `status = "FULFILLED"` when `gap === 0`.
  - Concurrently increments `filled` and decrements `gap` in matching `ClientDemand` records.
  - If a lead is transitioned OUT of `ONBOARDED`, safely decrements `filled` and restores `gap`.

**Modified Files:**
- [`server/src/routes/lead.routes.ts`](file:///Users/ananya/Desktop/Global3/server/src/routes/lead.routes.ts)

### 3. Contractor Access Control Enforcement
- Enforced strict database-level scoping on `GET /api/leads`: contractors can only view leads where `createdByContractorId = req.user.id`, completely walled off from the Global Leads pool.
- Prevented contractors from executing lead claims or bulk updates.

**Modified Files:**
- [`server/src/routes/lead.routes.ts`](file:///Users/ananya/Desktop/Global3/server/src/routes/lead.routes.ts)

### 4. Language Requirements Dashboard Auto-Sync
- Configured 10s auto-polling intervals (`refetchInterval: 10_000`, `staleTime: 5_000`) on Requirements and Market Demand queries across owner and recruiter views.

**Modified Files:**
- [`client/src/routes/owner.clients.tsx`](file:///Users/ananya/Desktop/Global3/client/src/routes/owner.clients.tsx)
- [`client/src/routes/recruiter.clients.tsx`](file:///Users/ananya/Desktop/Global3/client/src/routes/recruiter.clients.tsx)

---

## [Part D] — Google Sheets Demand Ingestion & Cross-View Dashboard Verification
**Date:** 2026-08-17

### 1. Google Sheets Demand-Ingestion Sync Engine
- Built complete backend integration for `POST /api/sheet-sync/sync`:
  - Converts standard Google Sheets `/spreadsheets/d/.../edit#gid=0` and `/pub?output=csv` URLs into direct CSV export endpoints.
  - Supports RFC-compliant CSV parsing with embedded quotes, commas, and flexible header matching (Client, Language, Service, Headcount, Priority, Project, Notes).
  - Deterministic duplicate row detection using `sheetRowId` hashing and `(clientId + language)` matching. Updates existing demand, recalibrates `gap`, upserts `serviceBreakdown`, and updates corresponding `Requirement` rows instead of duplicating data.
  - Inserts new `ClientDemand`, `ClientDemandService`, and `Requirement` transactionally.

**Modified Files:**
- [`server/src/routes/sheet-sync.routes.ts`](file:///Users/ananya/Desktop/Global3/server/src/routes/sheet-sync.routes.ts)

### 2. Cross-View Language Sync Verification
- Verified end-to-end alignment between Owner and Recruiter surfaces:
  - Both views consume the exact same backend endpoints (`GET /api/requirements`, `GET /api/clients`, `GET /api/client-demands`).
  - Auto-sync polling (`refetchInterval: 10_000`) ensures changes made on one surface (or triggered by lead onboarding automation) propagate consistently across both dashboards without manual reload.

---

## [Part E] — Reports & Analytics Page
**Date:** 2026-08-17

### 1. Reports & Analytics Backend & Frontend
- Built live analytics aggregation endpoint `GET /api/reports/analytics?range=7d|30d|90d|ytd` computing real outreach volumes, active recruiters count, team composite scores, market fill rates, AI time saved, language distribution, and recruiter throughput.
- Built persistent report audit history endpoint `GET /api/reports/recent`.
- Implemented real CSV downloads (`/api/reports/export/:type`) for Recruiter Scorecards, Market Demand Matrix, Lead Pipeline, and Executive Summary.
- Updated `owner.reports.tsx` to display real dynamic data, preview modals, and print/PDF generation.

**Modified Files:**
- [`server/src/routes/reports.routes.ts`](file:///Users/ananya/Desktop/Global3/server/src/routes/reports.routes.ts)
- [`server/src/index.ts`](file:///Users/ananya/Desktop/Global3/server/src/index.ts)
- [`client/src/lib/api-types.ts`](file:///Users/ananya/Desktop/Global3/client/src/lib/api-types.ts)
- [`client/src/lib/api.ts`](file:///Users/ananya/Desktop/Global3/client/src/lib/api.ts)
- [`client/src/routes/owner.reports.tsx`](file:///Users/ananya/Desktop/Global3/client/src/routes/owner.reports.tsx)

---

## [Part F] — Dynamic Rubric Target Scaling by Market Demand
**Date:** 2026-08-17

### 1. Market-Demand-Driven Dynamic Rubric Targets
- Updated `scoring.job.ts` so rubric targets are no longer static hardcoded constants.
- Volumetric metrics dynamically scale with the recruiter's active assigned requirements (`headcountNeeded` / `gap`):
  - **Outreach Volume:** Dynamically scales based on required headcount (42 outreach attempts per required seat).
  - **Proactive Sourcing:** Dynamically scales based on assigned seats (3.4 sourced candidates per required seat).
  - **Cold Lead Reactivation:** Dynamically scales based on assigned requirements volume (1.8 reactivations per seat).
  - **Rate & SLA Metrics:** `Time-to-First-Touch` ($\le$ 1.0 day), `Progression Rate` ($\ge$ 80%), and `Reason-Logged Rate` (= 100%) maintain quality benchmarks against the dynamic lead workload.
- Dynamically resolved targets are snapshotted in `kpiConfigSnapshot` on every score evaluation.

**Modified Files:**
- [`server/src/jobs/scoring.job.ts`](file:///Users/ananya/Desktop/Global3/server/src/jobs/scoring.job.ts)

---

## [Part G] — Regional Language Mapping, Service Dropdown Expansion & UI Polish
**Date:** 2026-08-18

### 1. Service Dropdown Alignment
- Expanded `STANDARD_SERVICES` to include all 8 services from the intake form: Dubbing, Subtitling, Audio Description, SDH, CC, Conform, Prelude, Scripting, plus Translation, Voice Over, Localization QA, and Quality Control.

### 2. Google Sheets Direct Input UI
- Made the Google Sheets sync URL field in `google-sheets-sync-section.tsx` an always-interactive input box with direct paste and Save/Sync actions.

### 3. Region-Wise Language Recruitment Mapping Seed & Auto-Fill
- Seeded team members in `server/prisma/seed.ts`: Mathu (Recruiter), Divya (Recruiter), Varsha (Contractor), Sharmistha (Contractor), Sunaina (Contractor) with regional language assignments.
- Added `REGION_LANGUAGE_MAPPINGS` in `client-demand-dialog.tsx` to automatically default the assigned recruiter or contractor when selecting any language.

### 4. Percentage & Target Label Display Bug Fix
- Fixed rubric category weight badge rendering (`Weight: 80%` instead of `8000%`) and individual metric scored badge (`Scored 30%` instead of `3000%`) in `owner.reports.tsx`.
- Corrected parameter order in `formatValue(unit, value)` so targets show clear numbers (e.g. `Target: 420`) instead of unit strings.

**Modified Files:**
- [`client/src/components/features/client-demand-dialog.tsx`](file:///Users/ananya/Desktop/Global3/client/src/components/features/client-demand-dialog.tsx)
- [`client/src/components/features/google-sheets-sync-section.tsx`](file:///Users/ananya/Desktop/Global3/client/src/components/features/google-sheets-sync-section.tsx)
- [`client/src/routes/owner.reports.tsx`](file:///Users/ananya/Desktop/Global3/client/src/routes/owner.reports.tsx)
- [`server/prisma/seed.ts`](file:///Users/ananya/Desktop/Global3/server/prisma/seed.ts)

---

## [Part H] — Recruiter Evaluation Dashboard `toFixed` Type Safety Fix
**Date:** 2026-08-18

**Modified Files:**
- [`client/src/components/features/evaluation-dashboard.tsx`](file:///Users/ananya/Desktop/Global3/client/src/components/features/evaluation-dashboard.tsx)

---

## [Part I] — Zero-Activity Recruiter Evaluation Scoring Correction
**Date:** 2026-08-18

### 1. Default Score of 30 for Inactive Recruiters Fixed
- **Root Cause:**
  - `time_to_first_touch` (20% weight, `LOWER_IS_BETTER`) previously returned `100%` when `actual === 0` (assuming 0 days turnaround was perfect), awarding 20 points to recruiters with 0 touches.
  - `reason_logged_rate` (10% weight) defaulted to `100%` when `totalClosures === 0`, awarding 10 points when no leads existed.
  - This resulted in an unintended baseline score of `30/100` for newly created or inactive recruiters.
- **Fix:**
  - Updated `calculateNormalizedMetricScore` in [`scoring.job.ts`](file:///Users/ananya/Desktop/Global3/server/src/jobs/scoring.job.ts) so `actual <= 0` strictly scores `0`.
  - Conditioned `reasonLoggedRate` to require assigned lead activity before awarding a 100% baseline.
  - Added a `hasActivity` guard (`outreachVolume > 0 || proactiveSourcing > 0 || touchDelaysDays.length > 0`) ensuring recruiters with zero pipeline work strictly evaluate to `0/100` score and `0%` outreach effectiveness.

**Modified Files:**
- [`server/src/jobs/scoring.job.ts`](file:///Users/ananya/Desktop/Global3/server/src/jobs/scoring.job.ts)
- [`client/src/components/features/evaluation-dashboard.tsx`](file:///Users/ananya/Desktop/Global3/client/src/components/features/evaluation-dashboard.tsx)

---

## [Part M] — Real-Time Database-Driven Metrics & Zero-Outreach Fix
**Date:** 2026-08-18

### 1. Database-Driven Scorecard & Outreach Metrics
- **Root Cause:**
  - `outreachEffectiveness` was previously taking the overall score value instead of calculating response and progression yield over actual outbound outreach.
  - When leads were imported without outbound communication, volumetric self-sourcing calculations gave partial points to composite scores.
- **Fix:**
  - `outreachEffectiveness` is now calculated strictly from live database interaction events:
    `outreachVolume > 0 ? (repliedCount + advancedLeadsCount) / outreachVolume * 100 : 0%`.
  - All 13 metrics in `RecruiterKpiSummary` (`responseRate`, `slaAdherence`, `outreachVolume`, `pipelineHealth`, `profileQuality`, `dncPct`) are calculated 100% dynamically from actual database records.
  - For recruiters with zero outbound communication, `overallScore` strictly evaluates to `0` with the status `"New"`.

**Modified Files:**
- [`server/src/jobs/scoring.job.ts`](file:///Users/ananya/Desktop/Global3/server/src/jobs/scoring.job.ts)
- [`server/src/routes/lead.routes.ts`](file:///Users/ananya/Desktop/Global3/server/src/routes/lead.routes.ts)



