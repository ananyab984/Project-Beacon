"""One-profile experiment: does the ASYNC trigger/snapshot endpoint return the
experience array that the sync /scrape endpoint leaves empty?

Flow (per Bright Data docs):
    POST /datasets/v3/trigger?dataset_id=...   body=[{"url": ...}]  -> snapshot_id
    GET  /datasets/v3/progress/{snapshot_id}                       -> poll until "ready"
    GET  /datasets/v3/snapshot/{snapshot_id}?format=json           -> records

Then it prints the experience array and computes total years if dates exist.
Usage:
    python async_experiment.py https://www.linkedin.com/in/chen-chen-28ba7122
"""

from __future__ import annotations

import json
import re
import sys
import time

import requests

from config import load_config
from logger import configure_logging, get_logger

log = get_logger(__name__)

TRIGGER = "https://api.brightdata.com/datasets/v3/trigger"
PROGRESS = "https://api.brightdata.com/datasets/v3/progress/{}"
SNAPSHOT = "https://api.brightdata.com/datasets/v3/snapshot/{}"

YEAR_RE = re.compile(r"(19|20)\d{2}")


def years_from_experience(experience: list) -> float | None:
    """Estimate total years covered by experience entries using date spans."""
    spans = []
    for item in experience or []:
        if not isinstance(item, dict):
            continue
        text = " ".join(str(item.get(k, "")) for k in ("duration", "start_date", "end_date", "subtitle"))
        yrs = [int(y) for y in YEAR_RE.findall(text)]
        # YEAR_RE captures the century group; re-extract full 4-digit years:
        yrs = [int(m.group()) for m in re.finditer(r"(?:19|20)\d{2}", text)]
        if yrs:
            spans.append((min(yrs), max(yrs)))
    if not spans:
        return None
    earliest = min(s[0] for s in spans)
    latest = max(s[1] for s in spans)
    return latest - earliest


def main(argv: list[str]) -> int:
    cfg = load_config(require_api_key=True)
    configure_logging(cfg.log_level)
    url = argv[0] if argv else "https://www.linkedin.com/in/chen-chen-28ba7122"

    headers = {"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json"}

    # 1) trigger
    log.info("Triggering async collection for %s", url)
    r = requests.post(
        TRIGGER,
        params={"dataset_id": cfg.dataset_id, "include_errors": "true"},
        headers=headers,
        json=[{"url": url}],
        timeout=cfg.request_timeout,
    )
    log.info("trigger status=%s body=%s", r.status_code, r.text[:200])
    r.raise_for_status()
    snapshot_id = r.json().get("snapshot_id")
    if not snapshot_id:
        log.error("No snapshot_id returned; aborting.")
        return 1
    log.info("snapshot_id=%s", snapshot_id)

    # 2) poll progress
    for attempt in range(60):  # up to ~5 min
        time.sleep(5)
        p = requests.get(PROGRESS.format(snapshot_id), headers=headers, timeout=cfg.request_timeout)
        status = p.json().get("status")
        log.info("poll %d: status=%s", attempt + 1, status)
        if status == "ready":
            break
        if status == "failed":
            log.error("Snapshot failed: %s", p.text[:200])
            return 1
    else:
        log.error("Timed out waiting for snapshot to be ready.")
        return 1

    # 3) fetch snapshot
    s = requests.get(SNAPSHOT.format(snapshot_id), params={"format": "json"}, headers=headers, timeout=cfg.request_timeout)
    s.raise_for_status()
    data = s.json()
    with open("async_raw_response.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    obj = data[0] if isinstance(data, list) and data else data
    exp = obj.get("experience") if isinstance(obj, dict) else None

    print("=" * 60)
    print(f"Profile: {obj.get('name') if isinstance(obj, dict) else '?'}")
    print(f"experience type: {type(exp).__name__}  count: {len(exp) if isinstance(exp, list) else 'n/a'}")
    if isinstance(exp, list) and exp:
        print("\nExperience entries:")
        print(json.dumps(exp, indent=2, ensure_ascii=False)[:1500])
        est = years_from_experience(exp)
        print(f"\nEstimated years of experience (date span): {est}")
    else:
        print("\n>>> ASYNC endpoint ALSO returned no experience array. <<<")
    print("\nFull async response saved to async_raw_response.json")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
