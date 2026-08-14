# Testing Guide — Bright Data Enrichment Pipeline

A step-by-step guide to validate every part of the pipeline before moving on to
the Unipile integration. Work top to bottom; each section states the **command**
and the **expected result**.

---

## 1. Environment setup

```bash
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                 # then edit .env: set BRIGHTDATA_API_KEY
```

**Verify dependencies installed:**

```bash
python -c "import pandas, openpyxl, requests, dotenv; print('deps OK')"
```

Expected: `deps OK`.

**Verify config loads and the key is picked up (key stays masked):**

```bash
python -c "from config import load_config; c=load_config(); print(c.dataset_id, c.masked_key())"
```

Expected: `gd_l1viktl72bvl7bjuj0 ab12...wx90` (your key, masked). If you see a
`ConfigError`, your `.env` is missing or the key is blank.

---

## 2. Offline tests (no API key, no network)

```bash
python test_offline.py
```

Expected: every line `[PASS]`, ending with `All offline tests PASSED ✅`.
This validates URL rules, `[Missing Input]` handling, dedup, error capture, and
the parser against **both** a dict and a one-item list.

---

## 3. API connectivity test (Phase 1)

```bash
python phase1_smoke_test.py
```

This confirms, against a **real** response — not an assumption:

- **Authentication works** → prints `✅ Authentication + endpoint OK`.
- **Dataset ID is correct** → a 400/404 here means `DATASET_ID` is wrong.
- **Endpoint reachable** → a network error/timeout points to connectivity.
- **API returns data for one URL** → non-empty `phase1_raw_response.json`.
- **Query-param request shape accepted** → if `dataset_id`/`format` as query
  params were rejected you'd get a 400 with a body explaining the problem.

**How to read the output:**

- `📦 Response SHAPE: dict ...` vs `list of 1 item(s) ...` — **this is the shape
  confirmation the spec asks for.** The parser handles either; note which you
  actually got.
- `⏱ Response time` — should be ~10–30s. The script flags it if it's outside
  that range.
- `PRESENT` / `EMPTY/NULL` field lists — confirms which requested fields the
  dataset actually returns.

---

## 4. Single record test

```bash
# Test a specific recruiter URL from the Excel:
python phase1_smoke_test.py https://www.linkedin.com/in/laurenseppala/
```

Then inspect the raw JSON:

```bash
python -m json.tool phase1_raw_response.json | head -50
```

- **Inspect the raw response** and confirm dict vs list at the top level.
- **Verify expected fields** are present (name, headline, current_company, …).
- **Debug API failures**: the script prints targeted tips per status code
  (401 → key, 400/404 → dataset id, 429 → rate limit, timeout → raise
  `REQUEST_TIMEOUT`).

---

## 5. Parser validation

The parser is fully testable offline via the fixture:

```bash
python -c "
import json; from parser import parse_profile
raw = json.load(open('sample_response.json'))
flat = parse_profile(raw)
for k, v in flat.items(): print(f'{k:32} = {v!r}')
"
```

Verify:

- **Nested JSON flattened**: `Enriched_Current_Company` = `Globalization
  Partners` (came from `current_company.name`); `Enriched_Company_Website` came
  from `current_company.website`.
- **Missing fields handled safely**: `Enriched_Public_Email` and
  `Enriched_Phone_Number` are `''` (empty), **not** an error. `null` in the
  JSON becomes `''`.
- **No exceptions**: the command completes and prints all columns.
- **Unmapped-key logging**: with `LOG_LEVEL=INFO`, the parser logs
  `Unmapped top-level response keys: some_new_unmapped_field` — this is how you
  discover new fields Bright Data returns so you can add them to `FIELD_MAP`.

To confirm dict/list parity explicitly:

```bash
python -c "
import json; from parser import parse_profile
raw = json.load(open('sample_response.json'))
print('identical:', parse_profile(raw) == parse_profile([raw]))
"
```

Expected: `identical: True`.

---

## 6. Excel integration test

Generate a sample output (mock data, no API needed) or run the real batch:

```bash
python make_sample_output.py         # MOCK -> sample_enriched_output.xlsx
# OR, after Phase 1 passes:
python main.py                        # REAL -> enriched_output.xlsx
```

Verify the output:

```bash
python -c "
import pandas as pd
df = pd.read_excel('sample_enriched_output.xlsx', engine='openpyxl')
print('rows:', len(df), 'cols:', len(df.columns))
print('has originals:', {'Case_ID','Profile_Link','Email_Address'} <= set(df.columns))
print('has enrichment:', 'Enriched_Full_Name' in df.columns)
print('has error col:', 'Enrichment_Error' in df.columns)
"
```

Confirm:

- **Excel loads correctly** — no read error.
- **Every row processed** — output row count == input row count (10).
- **Duplicates fetched once** — if you duplicate a `Profile_Link` row in the
  input, the logs show `Cache hit ... (already fetched this run)` and
  `Batch summary: ... N cache hits`.
- **Original columns intact** — all 18 input columns still present.
- **New enrichment columns added** — `Enriched_*` columns present.
- **Output generated** — the `.xlsx` file exists.

---

## 7. Error-handling tests

Each case keeps the row in the output with a message in `Enrichment_Error`.

| Case | How to trigger | Expected behavior |
|---|---|---|
| **Invalid URL** | Already covered by TC09-style rows, or add a row with `https://example.com/in/x`. | Row kept; `Enrichment_Error` = "Invalid URL: ..."; **no API call**. |
| **Empty URL** | Blank a `Profile_Link` cell (or `[Missing Input]`). | Row kept; "Missing URL: ..."; **no API call**. |
| **Expired/invalid API key** | Set `BRIGHTDATA_API_KEY=bad` in `.env`, run `phase1_smoke_test.py`. | Fails with "Authentication failed (401)" or "Forbidden (403)". |
| **Wrong Dataset ID** | Set `DATASET_ID=gd_wrong` in `.env`. | "Bad request (400/404) — likely wrong DATASET_ID". |
| **Network timeout** | Set `REQUEST_TIMEOUT=1` in `.env` (below the 10–30s norm). | Retried up to `MAX_RETRIES`, then "Request timed out after 1s ...". |
| **Rate limiting (429)** | Fire many requests quickly, or mock a 429. | Backoff + retry (honors `Retry-After`); after `MAX_RETRIES`, "Rate limited (429) (gave up after N retries)". |
| **Empty API response** | Occurs naturally for some profiles; or mock an empty body. | "Empty API response ...". |
| **Invalid JSON** | Mock a non-JSON 2xx body. | "Invalid JSON in response: ...". |

**Mocking a status code offline** (example: 429 retry/backoff):

```bash
python -c "
from unittest.mock import patch, MagicMock
from config import Config
from brightdata_client import BrightDataClient, EnrichmentError
from logger import configure_logging
configure_logging('INFO')
cfg = Config(api_key='x', dataset_id='gd_test', max_retries=2, retry_backoff_base=0.01)
resp = MagicMock(status_code=429, headers={}, text='rate limited')
with patch('requests.Session.post', return_value=resp):
    try:
        BrightDataClient(cfg).enrich_profile('https://www.linkedin.com/in/x/')
    except EnrichmentError as e:
        print('Got expected error:', e.message)
"
```

Expected: logs show two retries with increasing backoff, then
`Got expected error: Rate limited (429) ... (gave up after 2 retries)`.

---

## 8. Logging validation

Run any pipeline command with `LOG_LEVEL=INFO` (default). You should see:

- Run start banner + config summary (**API key masked**).
- `Reading input Excel: ...` and `Loaded N rows`.
- Per recruiter: `Processing recruiter i/N (Case_ID) link=...`.
- `Built request payload ...` (at DEBUG level — set `LOG_LEVEL=DEBUG`).
- `API request START ...` / `API request END ... status=... elapsed=Ns`.
- `Enrichment SUCCESS` or an `ERROR`/`WARNING` with the reason.
- `Cache hit ...` for deduplicated URLs.
- Retry warnings on transient failures.
- Final `Batch summary: X succeeded, Y failed, Z cache hits (N rows total)`.
- `run COMPLETE in Ns -> enriched_output.xlsx`.

Confirm timings appear (per-request `elapsed=` and total run seconds), and that
the secret never appears in plaintext.

---

## 9. End-to-end validation checklist

Before declaring Phase 1 done and moving to Unipile:

- [ ] `python test_offline.py` → all PASS.
- [ ] `python phase1_smoke_test.py` → auth OK, endpoint reachable.
- [ ] Query-param request shape (`dataset_id` + `format`) accepted (no 400).
- [ ] **Response shape confirmed** (dict vs list) and matches parser handling.
- [ ] Response time observed and noted (10–30s expected).
- [ ] Requested fields' real presence confirmed (email/phone expected empty).
- [ ] `python main.py` → `enriched_output.xlsx` generated.
- [ ] Output row count == input row count; no rows dropped.
- [ ] Original columns preserved; `Enriched_*` columns added.
- [ ] Duplicate URLs fetched once (cache-hit log observed).
- [ ] Every error case above behaves as documented.
- [ ] Logs are complete, timed, and leak no secrets.
