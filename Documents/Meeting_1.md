## Handoff note for Product & Engineering

### Objective
Build phase one of a freelancer recruitment automation workflow focused on **discovery, qualification, tracking, and enriched handoff into onboarding**. The current process is manual and fragmented across recruiter-owned trackers, LinkedIn activity, and separate systems.

### What phase one needs to achieve
- Enable search/discovery of freelancers across **LinkedIn** and **ProZ**.
- Support use cases like finding **dubbing specialists by language**.
- Capture enough structured data to distinguish vague self-labels from actually qualified leads.
- Feed discovered/enriched freelancer data into the onboarding flow with **pre-populated fields via URL parameters**.
- Keep phase one constrained to the previously aligned **4–6 week window**.

### Current-state constraints
- Lead data is fragmented across **5–6 recruiter-specific tracker files**.
- LinkedIn outreach is **not centrally tracked**; it remains in individual recruiter LinkedIn accounts.
- A **2,000+ lead import** is expected and is the highest-risk data task in phase one.
- Existing trackers do **not** have a confirmed **DNC / opt-out** column.
- There is **no structured rate card**; rate guidance is shared verbally as a band range and is not surfaced in first contact.

### Users and workflow controls
- Expected active users: **~5 recruiters**.
- Final outreach approval sits with **Sundar**.
- Human-review SLA for flagged replies: **under 2 hours during working hours**.

### Source systems in scope
- Primary sourcing channels: **LinkedIn Premium** and **ProZ**.
- **Sales Navigator is not currently available**, but can be acquired if needed.
- Reddit/subreddits are used occasionally, but are **not primary scope for phase one**.

### Technical considerations
- Onboarding endpoint needs to support **URL-param-based prefill** for freelancer data.
- Sundar already has **admin access to rateglobal3.io**; no IT approval is needed for that access path.

### Product questions to resolve
- What is the minimum structured freelancer profile needed in phase one to make search results actionable?  
- What enrichment fields are mandatory before a lead is considered qualified enough for downstream outreach?  
- How should the system represent recruiter-owned leads vs platform-imported leads vs LinkedIn-originated leads?  
- What is the correct state model for outreach, review, follow-up, and opt-out given the lack of current DNC structure?  
- What exact handoff contract is needed between discovery/enrichment and the onboarding form prefill flow?  

### Engineering questions to resolve
- What is the ingestion strategy for the **2,000+ lead import** across multiple recruiter-specific files?  
- How inconsistent are the existing tracker schemas, and what normalization layer is required?  
- What can and cannot be captured from LinkedIn Premium without Sales Navigator?  
- How will deduplication work across recruiter trackers, ProZ, and LinkedIn-sourced records?  
- How should flagged-response routing work to meet the **<2 hour** human-review expectation?  
- What URL parameter contract and validation rules are needed for onboarding prefill?  

### Risks
- Import complexity may be underestimated because tracker count is known, but tracker structure/quality is still unclear.
- LinkedIn activity is partly outside shared systems, so phase one visibility may be incomplete.
- Missing DNC / opt-out structure creates workflow and compliance ambiguity.
- “Qualified freelancer” criteria are directionally described, but not yet reduced to a field-level definition.
