# Bright Data LinkedIn Enrichment (BuildableLabs POC — Phase 1)

A modular, production-quality Python pipeline that reads recruiter LinkedIn
profiles from an Excel file, enriches them via the **Bright Data Dataset API**,
flattens the response, merges it back onto the original rows, and exports an
enriched Excel workbook.

This is **Phase 1** of a larger recruiter-intelligence platform. Unipile
(email/messaging/inbox) is intentionally **out of scope** here — see
[Future: Unipile integration](#future-unipile-integration).

---

## Contents

- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Setup](#setup)
- [Running it (Phase 1 → Phase 2)](#running-it)
- [Module-by-module explanation](#module-by-module-explanation)
- [Output schema](#output-schema)
- [Error handling](#error-handling)
- [Testing](#testing)
- [Future: Unipile integration](#future-unipile-integration)

---

## How it works

```
Read Excel → Extract Profile_Link → Validate URL → Deduplicate
   → Build request (query params + JSON array body) → Authenticate
   → POST /datasets/v3/scrape (sync, per profile) → Receive JSON (dict OR list)
   → Handle API errors → Parse & flatten nested JSON → Merge with original row
   → Append to output dataframe → Export enriched_output.xlsx
```

Key design decisions:

- **Sync `/scrape` endpoint**, one profile per call, per the spec. `dataset_id`
  and `format` are sent as **URL query parameters**; the body is a **JSON
  array** even for one profile.
- **Dedup cache**: each distinct profile URL is fetched **at most once per run**
  (normalized so `/in/jane` and `/in/jane/` count as one), saving API credits.
- **Shape-agnostic parser**: handles a single dict *or* a one-item list — the
  one part of the contract the spec says to confirm empirically in Phase 1.
- **No dropped rows**: validation/enrichment failures are written back with a
  message in the `Enrichment_Error` column.
- **No secrets in code**: everything sensitive comes from `.env`.

---

## Project structure

```
.
├── main.py                 # Phase 2: full batch pipeline (CLI entry point)
├── phase1_smoke_test.py    # Phase 1: single-profile validation gate
├── config.py               # .env loading + validated Config dataclass
├── logger.py               # structured logging setup
├── utils.py                # URL validation, missing-value + timing helpers
├── excel_reader.py         # read input workbook
├── excel_writer.py         # write enriched workbook
├── brightdata_client.py    # Bright Data API client (retry/backoff, typed errors)
├── parser.py               # flatten nested JSON -> Enriched_* columns
├── test_offline.py         # offline tests (no API key needed)
├── make_sample_output.py   # generate a MOCK sample output for schema preview
├── sample_response.json    # fixture used by offline tests / sample generator
├── requirements.txt
├── .env.example
├── README.md
└── TESTING.md              # step-by-step testing guide
```

---

## Setup

```bash
# 1. Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create your .env from the template and add your API key
cp .env.example .env
#   then edit .env and set BRIGHTDATA_API_KEY=<your key>
```

`.env` (only the key is required; the rest have defaults):

```
BRIGHTDATA_API_KEY=your_key_here
DATASET_ID=gd_l1viktl72bvl7bjuj0
```

> The real `.env` is git-ignored. Never commit your API key.

---

## Running it

### Phase 1 — single-profile smoke test (do this first)

Phase 1 is a **validation gate**. It sends **one** real LinkedIn URL from the
Excel and prints what you must confirm before trusting Phase 2:

```bash
python phase1_smoke_test.py
# or test a specific URL:
python phase1_smoke_test.py https://www.linkedin.com/in/laurenseppala/
```

It reports: auth success, endpoint reachability, whether the query-param request
was accepted, the **actual response shape (dict vs list)**, which fields are
populated vs null, and the **real response time**. The raw payload is saved to
`phase1_raw_response.json` for inspection.

> If the real response shape differs from what the parser assumes, adjust
> `FIELD_MAP` in `parser.py` (candidate source keys) — no other code changes
> needed. The parser already tolerates dict *or* list.

### Phase 2 — full batch pipeline

Only after Phase 1 passes:

```bash
python main.py
# or with explicit paths + a log file:
python main.py --input LinkedIn_Enrichment_Test_Cases.xlsx \
               --output enriched_output.xlsx --log-file run.log
```

### Preview the output schema without an API key

```bash
python make_sample_output.py     # writes sample_enriched_output.xlsx (MOCK data)
```

---

## Module-by-module explanation

| Module | Responsibility |
|---|---|
| **config.py** | Loads `.env`, validates required settings, exposes an immutable `Config`. Masks the API key for safe logging. |
| **logger.py** | One-time structured logging config (`timestamp \| level \| module \| message`), console + optional file. |
| **utils.py** | `is_valid_linkedin_url`, `is_missing` (treats `[Missing Input]`/NaN/blank as empty), `normalize_url` (dedup key), `safe_get` (nested lookups), `timed` (timing context manager). |
| **excel_reader.py** | Reads the workbook with pandas; fails fast if `Profile_Link` is absent. |
| **brightdata_client.py** | Builds the request (query params + JSON array body), sets auth headers, performs the POST with a 60s default timeout, retries transient failures (429/5xx/timeout) with exponential backoff (honoring `Retry-After`), and maps every HTTP status to a typed, human-readable `EnrichmentError`. |
| **parser.py** | Normalizes dict-or-list, flattens nested JSON into `Enriched_*` columns via an extensible `FIELD_MAP` of candidate source keys, serializes experience/education to JSON, joins skills, and logs unmapped top-level keys. |
| **main.py** | Orchestrates the batch: read → validate → dedup → enrich → parse → merge → write, with per-row error capture and run-level summary logging. |
| **excel_writer.py** | Writes the merged DataFrame to `.xlsx`. |

---

## Output schema

The output preserves **all original input columns** and appends:

- `Enriched_Full_Name`, `Enriched_First_Name`, `Enriched_Last_Name`
- `Enriched_Headline`, `Enriched_About`
- `Enriched_Current_Job_Title`, `Enriched_Current_Company`
- `Enriched_Company_Website`, `Enriched_Company_LinkedIn`, `Enriched_Industry`
- `Enriched_Location`, `Enriched_Country`
- `Enriched_Experience` (JSON), `Enriched_Education` (JSON), `Enriched_Skills`
- `Enriched_Followers`, `Enriched_Connections`
- `Enriched_Public_Email`, `Enriched_Work_Email`, `Enriched_Phone_Number`
  *(expect these to be empty on public profiles — that is normal, not an error)*
- `Enriched_Profile_URL`
- `Enrichment_Error` — empty on success; a message on failure
- `Enrichment_Status` — set to `Enriched` / `Failed` (if the column exists)

---

## Error handling

Every failure keeps the row in the output with a message in `Enrichment_Error`:

| Case | Trigger | Message / behavior |
|---|---|---|
| Missing URL | `Profile_Link` empty / `[Missing Input]` | "Missing URL: ..." (no API call) |
| Invalid URL | not `linkedin.com/in/...` | "Invalid URL: ..." (no API call) |
| Auth failure | HTTP 401 | "Authentication failed (401) ..." |
| Invalid/expired token | HTTP 401/403 | "Forbidden (403) ..." |
| Wrong dataset id | HTTP 400/404 | "Bad request (...) — likely wrong DATASET_ID ..." |
| Rate limiting | HTTP 429 | backoff + retry up to `MAX_RETRIES`, honoring `Retry-After` |
| Timeout | `requests.Timeout` | retried, then "Request timed out after Ns ..." |
| Server error | HTTP 5xx | retried as transient |
| Other non-2xx | any other status | "Unexpected HTTP N ..." |
| Empty response | 2xx, empty/null body | "Empty API response ..." |
| Invalid JSON | `JSONDecodeError` | "Invalid JSON in response: ..." |

---

## Testing

See **[TESTING.md](TESTING.md)** for the full step-by-step guide covering
environment setup, API connectivity, single-record inspection, parser
validation, Excel integration, every error case, logging validation, and the
end-to-end checklist.

Quick offline check (no API key required):

```bash
python test_offline.py
```

---

## Future: Unipile integration

This module is deliberately structured to slot into the larger platform without
a rewrite:

- **`BrightDataClient` is self-contained** (its own auth, retry, error types).
  A future `UnipileClient` can live beside it with the same shape, and both can
  be composed by a higher-level `EnrichmentService`.
- **`Config` is centralized** — add `UNIPILE_API_KEY`, `UNIPILE_DSN`, etc.
  without touching business logic.
- **The parser's `FIELD_MAP` pattern** generalizes to any provider's payload.
- **Row-keyed merge** (original columns preserved, provider columns appended)
  means a Unipile pass can append `Unipile_*` columns the same way.

Planned Unipile scope (not implemented here): recruiter mailbox sync, email
send, read tracking, LinkedIn messaging, inbox sync, reply detection, and a
unified communication history — layered on top of this enriched dataset.
