@AGENTS.md

## Global3 (G3) project notes

**What this is:** End-to-end AI-powered recruitment automation platform for Global3 (G3), replacing a spreadsheet-driven recruiter workflow (data fragmented across trackers, LinkedIn DMs, ProZ profiles) with a centralized recruiter CRM + AI-assisted workflows + automated enrichment.

**Architecture:** Next.js frontend, Supabase/Neon (PostgreSQL, via Prisma) database, n8n for workflow automation, Resend for email infra, Claude/OpenAI behind an abstraction layer, external integrations: ProZ, LinkedIn (via Unipile), and future enrichment providers (Bright Data, etc).

**My role:** Researching, designing, and building the PoC for the data enrichment pipeline, starting with the ProZ API — auth with G3 credentials, test dataset design, mapping API responses to G3's schema, validating enrichment quality, documenting limitations, and prepping the enrichment service to plug into the wider platform later.

### Milestones

- **M1 – Foundation:** Import/normalize recruiter data, core data model (candidates, services, outreach stages, availability, recruiter ownership), centralized DB + dashboard, outreach infra with approval workflow/email tracking/suppression/attribution. Replace spreadsheets with a searchable, auditable system.
- **M2 – Intelligence Layer:** AI-personalized outreach, inbound reply classification + drafting assist, recruiter-managed FAQ/knowledge base, automated follow-up sequences (human-in-the-loop), operational metrics (outreach visibility, AI edit rates, reply classification accuracy).
- **M3 – Data Enrichment & Automation:** Enrich leads via ProZ/LinkedIn, resolve incomplete profiles, identity resolution + profile completeness + recruiter qualification workflows, LinkedIn reply tracking + onboarding pre-fill, analytics on sourcing effectiveness/language coverage/funnel performance.

### Status as of latest assessment (Aug 19, 2026)

Tracked on two axes: **Build %** (feature exists) vs **Testing %** (of what's built, how much is validated).

- **M1: Build 100% / Testing 70%.** Everything built (data model, auth, leads pipeline, outreach+approval via Unipile, DNC/flags, Client/Demand/Requirement CRUD, live Reports dashboard). Remaining gap is testing only — duplicate-detection logic needs a firm test pass before trusting the full recruiter-tracker import.
- **M2: Build ~35% / Testing ~70% of what's built.** AI outreach drafting is built and tested. Rubric/evaluation dashboard is built but needs another testing pass. Not built at all: inbound reply classification, FAQ/knowledge base, Kanban board, automated follow-up sequences.
- **M3: Build ~55% / Testing ~65%** (against active scope; ProZ excluded — see below). Built and tested: LinkedIn enrichment (Bright Data + LLM fallback), Unipile reply tracking. Needs testing: dedup logic (shared with M1). Partially built: onboarding URL-prefill (built on our side, blocked on G3 tech team implementing the receiving end). Not built: Slack escalation alerts, re-enrichment loop for flagged/ambiguous identity records, enrichment-specific analytics (source effectiveness, language coverage, funnel conversion — currently only a one-off POC comparison, not in the live dashboard).

**ProZ enrichment (my focus area):** Currently paused/excluded from the active build scope due to access issues — ProZ API credentials not yet confirmed with G3. Design work (10 test cases, schema mapping) and scraping scripts are already done and sit ready to resume once access opens up.

### Key reference docs already in this project

- `G3_Enrichment_Full_Report_2026-09-05.pdf`, `G3_Enrichment_Edge_Case_Comparison_2026-09-05.pdf` — enrichment PoC findings
- `G3_Enrichment_PoC_Vendor_Comparison_2026-09-04.pdf`, `Parallel_API_Fit_And_Risk_Analysis`, `Clay_Pricing_*`, `Open_Source_Alternatives_Analysis`, `Enrichment_Platform_Research` — vendor/tooling evaluation for enrichment
- `G3_Deployment_Architecture_and_Vercel_Fit_2026-09-04.pdf`, `Deployment_Approach_Note_For_Andrea` — deployment/infra decisions
- `Onboarding_Prefill_Plan` / `Onboarding_Prefill_Build_Prompt` — onboarding pre-fill via URL params
- `Enrichment_Status_And_Waterfall_Build_Prompt`, `Multi_Platform_Lead_Archetypes_Enrichment_Prompt` — enrichment waterfall design
- `Milestone_Progress_Assessment_2026-08-19.md` — the M1/M2/M3 status breakdown above
- `Meeting_1.md`, `Meeting_2.md` — meeting notes
- `G3 Recruitment Automation Implementation v1.1.docx` — implementation spec

When working on this project, check the Project docs list before assuming something isn't documented — a lot of prior research (vendor comparisons, deployment tradeoffs, edge cases) already exists and shouldn't be redone from scratch.
