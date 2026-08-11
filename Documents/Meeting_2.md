## Product / Engineering handoff note

### Context
- Call was primarily a scope clarification discussion for the recruitment outreach automation build.
- The most important outcome was not a scope change, but a clearer understanding of the implementation risks and what the client will judge as “working.”

### What the client cares about most
- They want the system to be **measurable in practice**, not just feature-complete.
- Their lens is operational:
  - can they see who is in the system
  - can they tell who has been contacted
  - can they track whether outreach is personalized
  - can they see whether enrichment is actually improving reachability / engagement
- They do **not** want milestone completion to be treated as a box-checking exercise if the workflow is still not usable.

### Confirmed milestone interpretation
- **M1 = foundation / system of record**
  - centralized lead database
  - corrected / normalized data model
  - outreach infrastructure
  - human approval queue
  - bounce / suppression logic
- **M2 = intelligence layer**
  - AI-generated outreach
  - inbound reply handling
  - FAQ / knowledge support
  - Kanban + metrics visibility
  - automated follow-up support
- **M3 = deeper pipeline automation**
  - profile scraping / enrichment
  - application-completion-oriented workflow automation
  - some dependency on client tech team for URL parameter automation
- **Important:** M2 and M3 were explicitly clarified as **parallel tracks**, not a strict sequence.

### Biggest implementation risk
- **Input data quality is poor and fragmented.**
- Current recruiter data is spread across people and spreadsheets.
- Some records are incomplete and may contain only a LinkedIn-derived name with no email or reliable identifier.
- Example discussed: partial names like “Danny M” where the source record is too weak to confidently identify the candidate later.

### Product implications
- The system should assume **messy inputs by default**.
- We likely need strong support for:
  - consolidation from fragmented sources
  - normalization of lead records
  - visibility into missing vs confirmed data
  - traceability of sourcing / outreach status
  - ability to operate even when enrichment is partial, not perfect
- The centralized app is expected to replace spreadsheet sprawl with an internal CRM-style workflow.

### Engineering implications
- Enrichment should not be treated as “done” just because a pipeline runs.
- If enriched output is still not actionable for outreach, that will be seen as incomplete from the client’s perspective.
- We should plan for:
  - handling ambiguous identity matches
  - preserving source context where data confidence is low
  - making confidence / completeness visible in the workflow
  - separating foundation work from enrichment work architecturally, even if both feed the same system

### Infrastructure / deployment notes
- App is expected to be **lightweight**, not a heavy custom platform.
- Client likely wants to host / align with their existing AWS-oriented setup.
- One short discussion with their CTO or technical contact should likely unblock deployment assumptions.

### Operating model implication
- This should be treated as an **iterative operational system**, not a one-time delivery.
- Expect post-launch refinement as real recruiter workflows hit edge cases.

### Resourcing signal from client
- They also described a need for a **local India-based technical coordinator / PM-type owner** who can bridge ops and engineering.
- Reason: current dev coverage is distributed across US / Europe, plus some Vietnam presence, which creates timezone and execution friction.
- This is adjacent to the product build, but relevant because it signals that implementation may stall without a clear day-to-day owner.

### Recommended internal focus
- Define **success metrics per milestone** in operational terms, not just technical outputs.
- Design M1 around **data cleanup, visibility, and workflow reliability**.
- Treat enrichment as useful only when it improves actual outreach usability.
- Keep M2 and M3 modular since they are parallel tracks.
- Plan early for messy-record handling and confidence gaps in candidate identity / contactability.

### One-paragraph version
- Client aligned with the three-milestone structure, with M2 and M3 understood as parallel tracks, but the key implementation concern is measurability and data quality. Current recruiter data is fragmented and often incomplete, so the product needs to function as a centralized CRM-style system that can normalize messy inputs, make missing/ambiguous data visible, and ensure enrichment is judged by operational usefulness rather than technical completion. Deployment should be lightweight with brief client tech-team alignment, and ongoing iteration should be expected once live.