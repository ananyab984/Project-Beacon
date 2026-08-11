# draft_poc — AI Draft Messages Pipeline (POC)

Generates **personalized outreach drafts** (Email + LinkedIn) for freelance
linguists from enriched lead data, then **scores each draft** through a
two-stage evaluation layer so only reliable drafts are marked "send".

```
Enriched Lead ─▶ Prompt Builder ─▶ Groq / LLM ─▶ Email Draft   (if Email present)
                                             └─▶ LinkedIn Draft (if LinkedIn profile link present)
                                                     │
                                                     ▼
                                            Evaluation Metrics ─▶ SEND / HOLD
```

Built to mirror the other enrichment POCs (env-based config, REST LLM layer,
strict-JSON + anti-hallucination prompting, xlsx/json output).

## Features

- **Multi-Source Enriched Profile Loading**: Seamlessly loads enriched profiles from `.xlsx`, `.csv`, and `.json` outputs (`linkedin_poc/enriched_final.xlsx`, `Ada_poc/ada_projectbeacon_output.json`, `bodalgo`, `proz`).
- **Enriched Profile Enforcement**: Automatically filters out un-enriched, pending, or sparse profiles (`is_enriched == True`).
- **Channel-Aware Routing**:
  - `email` channel: routes to enriched leads with valid email addresses.
  - `linkedin` channel: routes to enriched leads with LinkedIn profile IDs/links, keeping connection notes strictly under 300 characters.
- **Single-Stage Programmatic Evaluation**: Fast, deterministic rule checks (length, readability, required links/CTA, spam filter, personalization depth, entity grounding filter) without secondary LLM-as-a-judge overhead.


## Quick start

```bash
cd draft_poc
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env        # then paste your Groq key into GROQ_API_KEY
.venv/bin/python main.py --limit 5
```

### CLI Options

```bash
# Process enriched LinkedIn profiles for LinkedIn messaging
python main.py --input ../linkedin_poc/enriched_final.xlsx --channel linkedin --limit 5

# Process enriched profiles with email addresses for Email drafting
python main.py --input ../Ada_poc/ada_projectbeacon_output.json --channel email --limit 5

# Combined multi-source run across all enriched lead files
python main.py --limit 10
```

Outputs land in `output/`: `drafts.json` (full drafts + all metric scores +
judge reasoning) and `drafts.xlsx` (one-row-per-draft summary).

## Files

| File | Role |
|---|---|
| `config.py` | Env-based, validated config singleton (Groq key, models, thresholds). |
| `leads.py` | Loads + normalizes enriched leads from `.json`, `.xlsx`, `.csv`; filters `is_enriched` leads and checks `has_email` / `has_linkedin`. |
| `prompt_builder.py` | Brand constants + few-shot exemplars → channel-specific `(system, user)` prompts. Enforces strict character bounds for LinkedIn. |
| `groq_client.py` | REST Groq chat client with exponential backoff & rate-limit retries. |
| `draft_generator.py` | Lead → prompt → Groq → `{subject?, body}` with link guardrails. |
| `readability.py` | Dependency-free Flesch Reading Ease + Flesch-Kincaid grade. |
| `evaluator.py` | Two-stage metrics: programmatic gates + LLM-as-a-judge faithfulness & quality rubric. |
| `main.py` | Pipeline runner, channel router, console report, output writer. |

