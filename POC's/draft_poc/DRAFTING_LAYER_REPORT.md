# The Reliable Drafting Layer — Research & Design Report

**POC:** `draft_poc` — AI-generated outreach (Email + LinkedIn) for freelance linguists
**Provider:** Groq (OpenAI-compatible), model-swappable
**Question 1:** Do we need to *add context / RAG*, or is the *prompt layer* enough?
**Question 2:** What *evaluation metrics* make this the most reliable drafting layer, and what *cases* must it handle?

---

## TL;DR

1. **No RAG for the POC.** A well-engineered prompt with **structured lead data + 2–3 few-shot exemplars + a brand-voice block** does the heavy lifting. The failure mode here isn't *missing knowledge*, it's *under-specification* — and we solve that by handing the model the lead's real attributes. RAG earns its place later, only when you build a large, changing library of *past winning messages* to retrieve the closest exemplar per lead.
2. **Reliability comes from the evaluation layer, not a bigger model.** Gate every draft through **cheap programmatic checks first**, then **one low-temperature LLM-as-a-judge call**. The single most important gate is **faithfulness** (did the draft invent facts about the recipient?) — in recruitment outreach, a hallucinated credential is reputationally expensive.

---

## Part 1 — Context vs. prompt layer (do we add RAG?)

### Verdict: prompt layer + structured data + few-shot. Skip RAG.

**What genuinely improves draft quality (all implemented in `prompt_builder.py`):**

| Add this | Why it helps | Where in the POC |
|---|---|---|
| **Structured lead data** in the prompt (name, language pair, country, services, years, current role) | This *is* the personalization signal, and doubles as the ground truth for the hallucination check. | `Lead.grounding_facts()` → `LEAD FACTS` block |
| **2–3 few-shot exemplars** of approved outreach | Highest-ROI addition: pins down structure, length, and brand voice; also gives the judge a reference for "brand-voice" scoring. | `_EMAIL_EXEMPLAR`, `_LINKEDIN_EXEMPLAR` (your real templates) |
| **Brand-voice do/don't block** | Enforces tone, banned hype, one-CTA rule, length target. | `_VOICE_RULES` |
| Light recipient public-profile facts | Only if pre-fetched into **verifiable** structured fields — otherwise it becomes a hallucination liability. | (already covered by the enrichment upstream) |

**What's overkill for the POC:** a vector DB / retrieval pipeline, fine-tuning, or pulling large company knowledge bases. The common production pattern is hybrid — **role + few-shot + (optional) RAG** — but you graduate to the RAG part when your exemplar library grows large, not on day one.

**When RAG *does* start to pay off (future):**
- You accumulate a corpus of **real messages that got replies** and want to retrieve the closest-matching winner as a per-lead exemplar.
- You need enriched **company/industry context** too large to fit in every prompt.

> Sources: [Meilisearch — RAG vs prompt engineering](https://www.meilisearch.com/blog/rag-vs-prompt-engineering) · [MindStudio — prompt vs context engineering](https://www.mindstudio.ai/blog/prompt-engineering-vs-context-engineering-vs-intent-engineering) · [InterSystems — RAG vs fine-tuning vs prompt engineering](https://www.intersystems.com/resources/rag-vs-fine-tuning-vs-prompt-engineering-everything-you-need-to-know/)

---

## Part 2 — The evaluation layer (what makes it reliable)

Two stages. **Programmatic checks run first and cost nothing** — they fail fast before you spend an LLM-judge call. All of the below are implemented in `evaluator.py`.

### Stage A — Programmatic hard gates + soft warnings

| Metric | Measures | Pass criteria (this POC) | Severity |
|---|---|---|---|
| **Length** | Fit to channel | Email **90–230 words** (ideal 120–180 — matched to your *long-form relationship* template, not the generic <80-word cold email). LinkedIn DM **120–700 chars**. | gate |
| **LinkedIn note cap** | Connection-note limit | ≤ **300 chars** (LinkedIn's hard cap for connection requests). Surfaced as a warning since this is a DM, not a note. | warn |
| **Readability** | Ease of reading | Flesch Reading Ease ≥ **45** (~60–70 = plain business English); FK grade ≤ **12**. | warn |
| **Required elements** | Structure integrity | Greeting-with-name ✓, apply link ✓, `global3.io` ✓, one CTA ✓, sign-off ✓ (email), subject ≤ 8 words (email). | gate |
| **Spam / formatting** | Deliverability | ≤ 1 trigger word, none in subject; CAPS ratio < 30%; ≤ 1 "!"; no fake `RE:`. (Word-boundary matched so "**free**lance" doesn't trip "free".) | warn |
| **Personalization depth** | Real tailoring | References ≥ 1 real lead attribute **beyond the name** (language / country / service / experience). Fails on name-only templates. | gate |
| **Entity grounding (pre-filter)** | Cheap hallucination catch | Flags stray numbers and proper-noun-like phrases not traceable to the lead facts or brand. Noisy by design → **warn**; the LLM judge is the authoritative gate. | warn |

**Why these thresholds:** best cold emails run short, but *your* email is a relationship email (~150 words), so the band is set to your template rather than the generic <80-word rule. Cold-email reply rates climb steeply with personalization depth (no personalization ~1–3% → deep/signal-based ~10–18%), which is exactly the lever the drafting layer controls — hence personalization depth is a **gate**, not a nicety.

> Sources: [textstat / Flesch–Kincaid](https://en.wikipedia.org/wiki/Flesch%E2%80%93Kincaid_readability_tests) · [Instantly cold-email benchmark 2026](https://instantly.ai/cold-email-benchmark-report-2026) · [Autobound cold email guide 2026](https://www.autobound.ai/blog/cold-email-guide-2026) · [ConnectSafely spam-trigger words 2026](https://connectsafely.ai/articles/spam-trigger-words-cold-email-linkedin-guide-2026) · [ReactIn — LinkedIn connection char limit](https://www.reactin.io/blog/linkedin-connection-request-character-limit-2026) · [SpamAssassin default threshold = 5.0](https://instantly.ai/blog/spamassassin-score/)

### Stage B — LLM-as-a-judge (one call, low temperature, strict JSON)

Scores what code can't. Rubric (in `_judge_prompt`):

| Dimension | Scale | Pass |
|---|---|---|
| **Faithfulness** (no hallucination) | pass/fail | No claim about the recipient absent from the lead facts. **Hard gate**; lists every unsupported claim. |
| **Personalization quality** | 1–5 | ≥ 4 = clearly written for *this* linguist, not template-swappable. |
| **Clarity / CTA strength** | 1–5 | ≥ 4 = one specific, low-friction ask. |
| **Brand-voice adherence** | 1–5 (reference-based vs. exemplar) | ≥ 4 = matches your warm, non-salesy tone. |

**Send rule:** all Stage-A gates pass **and** faithfulness = pass **and** mean(8,9,10) ≥ **4.0** with no dimension < **3**.

**Judge best-practices baked in:**
- **Anchored 1–5 scale** (judges use 1–10 inconsistently; the extra granularity is noise).
- **Faithfulness as binary** — the most reliable format for a hard gate.
- **"Concise is better than verbose"** stated in the judge prompt to blunt *verbosity bias*.
- **Reference-based** brand-voice (judge compares to your exemplar).
- **Self-preference bias mitigation:** `JUDGE_MODEL` is configurable — set it to a **different model family than the drafter** so the judge doesn't over-rate its own family's output. (For a first run, same model is acceptable; note it in results.)
- **Optional G-Eval upgrade:** Groq's API exposes `logprobs`, so you can later weight the 1–5 score by token probabilities for a smoother, less biased score.

> Sources: [Confident AI — G-Eval definitive guide](https://www.confident-ai.com/blog/g-eval-the-definitive-guide) · [DeepEval metrics](https://deepeval.com/docs/metrics-llm-evals) · [W&B — LLM-as-a-Judge](https://wandb.ai/site/articles/exploring-llm-as-a-judge/) · [Self-Preference Bias in Rubric-Based Evaluation (arXiv)](https://arxiv.org/pdf/2604.06996)

### Hallucination detection — the layered defense

Cheapest → strongest (recruitment outreach makes this the top priority):
1. **Entity overlap (implemented, `warn`)** — NER-lite pre-filter; catches invented companies, credentials, numbers.
2. **LLM faithfulness judge (implemented, `gate`)** — the authoritative check; lists each unsupported claim.
3. **NLI entailment (future hardening)** — decompose the draft into atomic claims, verify each against the lead data with a DeBERTa-MNLI model (this is how RAGAS *faithfulness* works). Add when you want claim-level auditability.

> Sources: [RAGAS/DeepEval faithfulness](https://medium.com/@sjha979/ragas-vs-deepeval-measuring-faithfulness-and-response-relevancy-in-rag-evaluation-2b3a9984bc77) · [Detecting LLM hallucinations](https://medium.com/@techsachin/detecting-llm-hallucinations-strategies-and-overview-57eea69e6a07)

---

## Part 3 — Cases the drafting layer must handle

| Case | Risk | How the POC handles it |
|---|---|---|
| **Sparse lead** (only name + language) | Model pads with invented specifics | Personalization gate needs a real attribute; faithfulness gate rejects invented ones; prompt forbids using absent facts. |
| **Rich lead** (services, years, role) | Over-stuffed, unfocused message | Length gate; judge clarity/CTA score; "personalize the *opening*" instruction. |
| **Missing language / role** | Awkward "[language]" leftovers | `Lead.primary_language` fallback; required-elements check. |
| **Hallucinated employer / credential / metric** | Reputational damage | Entity-grounding pre-filter + faithfulness hard gate. |
| **Dropped brand link** | Broken CTA | `_ensure_links()` guardrail repairs it post-generation. |
| **Too long / too short** | Deliverability & reply-rate hit | Channel length gates. |
| **Spam-y phrasing or ALL-CAPS** | Lands in spam | Spam/formatting warn. |
| **Model returns non-JSON** | Pipeline crash | JSON salvage in `groq_client.chat_json` + generator fallback. |
| **Wrong channel length** (LinkedIn note vs DM) | Truncation | 300-char note cap surfaced as a warning. |
| **API 429 / 5xx / timeout** | Run fails | Exponential-backoff retries in `groq_client`. |

---

## Part 4 — How to make it the most reliable drafting layer (roadmap)

**Already in the POC (day one):** structured-data prompting · few-shot exemplars · brand-voice rules · link guardrails · two-stage eval · faithfulness gate · JSON-safe parsing · retries.

**Next hardening steps, in priority order:**
1. **Judge model ≠ drafter model** — flip `JUDGE_MODEL` to another family to kill self-preference bias. *(One env change.)*
2. **Generate N variants → pairwise judge → pick best.** Pairwise ranking is more reliable than pointwise for choosing among candidates. Regenerate-on-HOLD loop.
3. **Ground-truth calibration** — log every draft's scores, then correlate against **real reply data**. Tune thresholds to what actually gets replies (the only metric that ultimately matters).
4. **NLI-based claim verification** for auditable, claim-level faithfulness.
5. **SpamAssassin pass** on the rendered email for a real deliverability score (default threshold 5.0).
6. **Exemplar RAG** once you have a corpus of reply-winning messages: retrieve the closest winner per lead as the few-shot example.
7. **Human-in-the-loop for HOLDs** — route anything below the send bar to a recruiter, and feed their edits back as new exemplars (a compounding quality flywheel).

---

### Bottom line
The reliability of an AI drafting layer is an **evaluation problem, not a generation problem**. Structured lead data + few-shot exemplars in the prompt gets you good drafts without RAG; a cheap programmatic gate plus a single well-designed LLM-judge call — anchored to the lead's real facts and your brand exemplars, with faithfulness as a hard gate — is what keeps a recruitment-outreach layer from ever inventing a credential and quietly sending it.
