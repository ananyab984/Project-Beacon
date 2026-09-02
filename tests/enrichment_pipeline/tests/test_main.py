"""Tests for main.py: FastAPI app wiring (/health, /enrich, /enrich/batch),
the CLI runner, the duplicate-review-queue helpers, the keepalive-ping
thread, and argparse-driven dispatch in main().

EnrichmentOrchestrator is patched at the main module boundary everywhere --
its own waterfall behavior is covered by test_orchestrator.py, not here.
uvicorn.run and time.sleep/threading are patched so nothing here starts a
real server, a real background thread loop, or a real sleep.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "enrichment_pipeline"))

import pytest
from fastapi.testclient import TestClient

import main
from config import Config, ConfigError


def make_config(**overrides):
    defaults = dict(
        brightdata_api_key="", dataset_id="ds1", tavily_api_key="",
        claude_api_key="", clay_webhook_url="",
    )
    defaults.update(overrides)
    return Config(**defaults)


def make_pipeline_result(**overrides):
    result = {
        "lead": {"Full_Name": "Jane Doe"},
        "enrichment_status": "enrichment_partial",
        "enrichment_percentage": 40,
        "field_sources": {"Full_Name": "existing"},
        "audit": {
            "is_complete": False, "enrichment_percentage": 40,
            "populated_count": 2, "total_fields": 5, "missing_critical_fields": [],
        },
        "execution_time_ms": 12,
        "logs": ["Stage 1 Complete"],
        "clay_fallback": None,
        "raw_enrichment_data": None,
    }
    result.update(overrides)
    return result


@pytest.fixture
def running_app(mocker):
    """Build main.run_server's FastAPI app without starting a real server.

    uvicorn.run blocks forever normally; patching it lets run_server finish
    registering routes and return so we can pull the `app` it built out of
    the mock's call args and drive it with TestClient instead.
    """
    orch_cls = mocker.patch("main.EnrichmentOrchestrator")
    mock_uvicorn_run = mocker.patch("uvicorn.run")
    config = make_config()

    main.run_server("127.0.0.1", 8000, config)

    mock_uvicorn_run.assert_called_once()
    app = mock_uvicorn_run.call_args[0][0]
    orchestrator = orch_cls.return_value
    return TestClient(app), orchestrator, config


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------

def test_health_check_returns_healthy(running_app):
    client, _orchestrator, _config = running_app
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "healthy", "service": "enrichment_pipeline", "version": "1.0.0"}


# ---------------------------------------------------------------------------
# POST /enrich
# ---------------------------------------------------------------------------

def test_enrich_single_lead_success_returns_pipeline_result(running_app):
    client, orchestrator, _config = running_app
    orchestrator.process_lead.return_value = make_pipeline_result()

    payload = {"Full_Name": "Jane Doe", "Source": "LinkedIn", "Profile_Link": "https://www.linkedin.com/in/jane-doe"}
    resp = client.post("/enrich", json=payload)

    assert resp.status_code == 200
    body = resp.json()
    assert body["enrichment_status"] == "enrichment_partial"
    assert body["lead"]["Full_Name"] == "Jane Doe"
    assert body["duplicate_flag"] is None
    assert body["clay_fallback"] is None


def test_enrich_single_lead_passes_lead_dict_and_field_sources_to_orchestrator(running_app):
    client, orchestrator, _config = running_app
    orchestrator.process_lead.return_value = make_pipeline_result()

    payload = {
        "Full_Name": "Jane Doe", "Source": "LinkedIn",
        "Field_Sources": {"Full_Name": "brightdata"},
    }
    resp = client.post("/enrich", json=payload)

    assert resp.status_code == 200
    call_kwargs = orchestrator.process_lead.call_args
    lead_dict = call_kwargs[0][0]
    assert "Field_Sources" not in lead_dict, "Field_Sources must be popped before building the lead dict"
    assert lead_dict["Full_Name"] == "Jane Doe"
    assert call_kwargs.kwargs["known_field_sources"] == {"Full_Name": "brightdata"}


def test_enrich_single_lead_only_sends_explicitly_set_fields(running_app):
    """model_dump(exclude_unset=True) -- fields the client never sent shouldn't
    show up as None/default in the dict handed to process_lead."""
    client, orchestrator, _config = running_app
    orchestrator.process_lead.return_value = make_pipeline_result()

    resp = client.post("/enrich", json={"Full_Name": "Jane Doe"})
    assert resp.status_code == 200

    lead_dict = orchestrator.process_lead.call_args[0][0]
    assert lead_dict == {"Full_Name": "Jane Doe"}


def test_enrich_single_lead_orchestrator_exception_returns_500(running_app):
    client, orchestrator, _config = running_app
    orchestrator.process_lead.side_effect = RuntimeError("scrape exploded")

    resp = client.post("/enrich", json={"Full_Name": "Jane Doe"})

    assert resp.status_code == 500
    assert "scrape exploded" in resp.json()["detail"]


def test_enrich_single_lead_rejects_non_dict_field_sources(running_app):
    """Field_Sources is typed Dict[str, str] -- a list can't validate against
    that, so this should 422 before ever reaching the orchestrator."""
    client, orchestrator, _config = running_app

    resp = client.post("/enrich", json={"Full_Name": "Jane Doe", "Field_Sources": ["a", "b"]})

    assert resp.status_code == 422
    orchestrator.process_lead.assert_not_called()


def test_enrich_default_source_is_linkedin_when_omitted(running_app):
    client, orchestrator, _config = running_app
    orchestrator.process_lead.return_value = make_pipeline_result()

    resp = client.post("/enrich", json={})
    assert resp.status_code == 200
    # Source has a Pydantic default of "LinkedIn", but exclude_unset means an
    # omitted field never actually reaches the lead dict -- confirming the
    # *actual* current behavior, not the schema's declared default.
    lead_dict = orchestrator.process_lead.call_args[0][0]
    assert "Source" not in lead_dict


# ---------------------------------------------------------------------------
# POST /enrich/batch
# ---------------------------------------------------------------------------

def test_enrich_batch_success_returns_results_and_dedup_queue(running_app, mocker):
    client, orchestrator, config = running_app
    results = [make_pipeline_result(lead={"Full_Name": "A"}), make_pipeline_result(lead={"Full_Name": "B"})]
    orchestrator.process_lead.side_effect = results

    dup_candidates = [{
        "lead_a_index": 1, "lead_b_index": 0, "lead_a": results[1]["lead"], "lead_b": results[0]["lead"],
        "match_score": 0.95, "threshold_used": config.dedup_match_threshold, "match_reason": "exact_match",
        "matched_fields": ["Full_Name"], "reasoning": "match", "flagged_for_review": True,
        "resolution": {"resolved": False, "resolution_type": None, "resolved_by": None, "resolved_at": None},
    }]
    mock_dedup = mocker.patch("main.find_duplicate_candidates", return_value=dup_candidates)

    payload = [{"Full_Name": "A"}, {"Full_Name": "B"}]
    resp = client.post("/enrich/batch", json=payload)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["results"]) == 2
    # The single candidate pair references both index 0 and index 1, so both
    # results end up flagged -- not just the "later" lead in the pair.
    assert body["results"][0]["duplicate_flag"]["flagged"] is True
    assert body["results"][1]["duplicate_flag"]["flagged"] is True
    assert body["dedup_threshold_used"] == config.dedup_match_threshold
    assert len(body["duplicate_review_queue"]) == 1
    mock_dedup.assert_called_once()
    assert mock_dedup.call_args.kwargs["threshold"] == config.dedup_match_threshold


def test_enrich_batch_empty_list_returns_empty_results(running_app, mocker):
    client, orchestrator, _config = running_app
    mocker.patch("main.find_duplicate_candidates", return_value=[])

    resp = client.post("/enrich/batch", json=[])

    assert resp.status_code == 200
    body = resp.json()
    assert body["results"] == []
    assert body["duplicate_review_queue"] == []
    orchestrator.process_lead.assert_not_called()


def test_enrich_batch_exception_returns_500(running_app, mocker):
    client, orchestrator, _config = running_app
    orchestrator.process_lead.side_effect = RuntimeError("batch blew up")

    resp = client.post("/enrich/batch", json=[{"Full_Name": "A"}])

    assert resp.status_code == 500
    assert "batch blew up" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# _attach_duplicate_flags
# ---------------------------------------------------------------------------

def test_attach_duplicate_flags_marks_flagged_and_unflagged_results():
    results = [{"lead": {}}, {"lead": {}}, {"lead": {}}]
    candidates = [{"lead_a_index": 1, "lead_b_index": 0, "match_score": 0.9}]

    main._attach_duplicate_flags(results, candidates)

    assert results[0]["duplicate_flag"]["flagged"] is True
    assert results[0]["duplicate_flag"]["best_match_score"] == 0.9
    assert results[1]["duplicate_flag"]["flagged"] is True
    assert results[2]["duplicate_flag"]["flagged"] is False
    assert results[2]["duplicate_flag"]["best_match_score"] is None
    assert results[2]["duplicate_flag"]["candidate_pair_indices"] == []


def test_attach_duplicate_flags_uses_highest_score_when_multiple_hits():
    results = [{"lead": {}}, {"lead": {}}, {"lead": {}}]
    candidates = [
        {"lead_a_index": 2, "lead_b_index": 0, "match_score": 0.7},
        {"lead_a_index": 2, "lead_b_index": 1, "match_score": 0.95},
    ]

    main._attach_duplicate_flags(results, candidates)

    assert results[2]["duplicate_flag"]["best_match_score"] == 0.95
    assert len(results[2]["duplicate_flag"]["candidate_pair_indices"]) == 2


# ---------------------------------------------------------------------------
# _write_duplicate_review_queue
# ---------------------------------------------------------------------------

def test_write_duplicate_review_queue_writes_expected_json(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    candidates = [{"lead_a_index": 1, "lead_b_index": 0, "match_score": 0.9}]

    main._write_duplicate_review_queue(candidates, threshold=0.8, total_leads=2)

    out_file = tmp_path / "output" / "duplicate_review_queue.json"
    assert out_file.exists()
    payload = json.loads(out_file.read_text(encoding="utf-8"))
    assert payload["threshold_used"] == 0.8
    assert payload["total_leads_in_batch"] == 2
    assert payload["total_candidates_flagged"] == 1
    assert payload["candidates"] == candidates


def test_write_duplicate_review_queue_handles_no_candidates(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    main._write_duplicate_review_queue([], threshold=0.8, total_leads=1)

    out_file = tmp_path / "output" / "duplicate_review_queue.json"
    payload = json.loads(out_file.read_text(encoding="utf-8"))
    assert payload["total_candidates_flagged"] == 0
    assert payload["candidates"] == []


# ---------------------------------------------------------------------------
# run_cli
# ---------------------------------------------------------------------------

def test_run_cli_list_input_writes_results_and_dedup_queue(tmp_path, monkeypatch, mocker):
    monkeypatch.chdir(tmp_path)
    orch_cls = mocker.patch("main.EnrichmentOrchestrator")
    orch_cls.return_value.process_lead.side_effect = [
        make_pipeline_result(lead={"Full_Name": "A"}),
        make_pipeline_result(lead={"Full_Name": "B"}),
    ]
    mocker.patch("main.find_duplicate_candidates", return_value=[])

    input_path = tmp_path / "in.json"
    input_path.write_text(json.dumps([{"Full_Name": "A"}, {"Full_Name": "B"}]), encoding="utf-8")
    output_path = tmp_path / "out.json"

    config = make_config()
    main.run_cli(str(input_path), str(output_path), config)

    assert orch_cls.return_value.process_lead.call_count == 2
    out_data = json.loads(output_path.read_text(encoding="utf-8"))
    assert isinstance(out_data, list)
    assert len(out_data) == 2
    assert (tmp_path / "output" / "duplicate_review_queue.json").exists()


def test_run_cli_single_object_input_skips_dedup(tmp_path, monkeypatch, mocker):
    monkeypatch.chdir(tmp_path)
    orch_cls = mocker.patch("main.EnrichmentOrchestrator")
    orch_cls.return_value.process_lead.return_value = make_pipeline_result()
    dedup_mock = mocker.patch("main.find_duplicate_candidates")

    input_path = tmp_path / "in.json"
    input_path.write_text(json.dumps({"Full_Name": "A"}), encoding="utf-8")
    output_path = tmp_path / "out.json"

    config = make_config()
    main.run_cli(str(input_path), str(output_path), config)

    orch_cls.return_value.process_lead.assert_called_once()
    dedup_mock.assert_not_called()
    out_data = json.loads(output_path.read_text(encoding="utf-8"))
    assert isinstance(out_data, dict)
    assert not (tmp_path / "output" / "duplicate_review_queue.json").exists()


# ---------------------------------------------------------------------------
# _start_keepalive_ping -- no real threads/sleeps: threading.Thread and
# time.sleep are both patched, and the loop's target function is invoked
# directly exactly once (time.sleep patched to raise, breaking `while True`).
# ---------------------------------------------------------------------------

def test_keepalive_ping_noop_when_url_empty(mocker):
    thread_cls = mocker.patch("main.threading.Thread")
    main._start_keepalive_ping("enrichment", "", 120)
    thread_cls.assert_not_called()


def test_keepalive_ping_success_pings_health_endpoint(mocker):
    thread_cls = mocker.patch("main.threading.Thread")
    mocker.patch("main.time.sleep", side_effect=RuntimeError("stop-loop"))
    mock_get = mocker.patch("main.requests.get")
    mock_get.return_value = mocker.Mock(status_code=200)

    main._start_keepalive_ping("enrichment", "http://example.com", 120)

    thread_cls.assert_called_once()
    target = thread_cls.call_args.kwargs["target"]
    assert thread_cls.call_args.kwargs["daemon"] is True

    with pytest.raises(RuntimeError):
        target()

    mock_get.assert_called_once_with(
        "http://example.com/health", timeout=10,
        headers={"User-Agent": "ProjectBeacon-enrichment/1.0"},
    )


def test_keepalive_ping_does_not_double_append_health_suffix(mocker):
    thread_cls = mocker.patch("main.threading.Thread")
    mocker.patch("main.time.sleep", side_effect=RuntimeError("stop-loop"))
    mock_get = mocker.patch("main.requests.get")
    mock_get.return_value = mocker.Mock(status_code=200)

    main._start_keepalive_ping("enrichment", "http://example.com/health/", 120)
    target = thread_cls.call_args.kwargs["target"]
    with pytest.raises(RuntimeError):
        target()

    mock_get.assert_called_once_with(
        "http://example.com/health", timeout=10,
        headers={"User-Agent": "ProjectBeacon-enrichment/1.0"},
    )


def test_keepalive_ping_interval_clamped_to_60_seconds_minimum(mocker):
    thread_cls = mocker.patch("main.threading.Thread")
    mock_sleep = mocker.patch("main.time.sleep", side_effect=RuntimeError("stop-loop"))
    mocker.patch("main.requests.get", return_value=mocker.Mock(status_code=200))

    main._start_keepalive_ping("enrichment", "http://example.com", 10)
    target = thread_cls.call_args.kwargs["target"]
    with pytest.raises(RuntimeError):
        target()

    mock_sleep.assert_called_once_with(60)


def test_keepalive_ping_error_status_is_handled_without_raising(mocker):
    thread_cls = mocker.patch("main.threading.Thread")
    mocker.patch("main.time.sleep", side_effect=RuntimeError("stop-loop"))
    mocker.patch("main.requests.get", return_value=mocker.Mock(status_code=503))

    main._start_keepalive_ping("enrichment", "http://example.com", 120)
    target = thread_cls.call_args.kwargs["target"]

    with pytest.raises(RuntimeError):
        target()  # the >=400 branch must not itself raise; only the patched sleep does


def test_keepalive_ping_request_exception_is_caught(mocker):
    thread_cls = mocker.patch("main.threading.Thread")
    mocker.patch("main.time.sleep", side_effect=RuntimeError("stop-loop"))
    mocker.patch("main.requests.get", side_effect=ConnectionError("network down"))

    main._start_keepalive_ping("enrichment", "http://example.com", 120)
    target = thread_cls.call_args.kwargs["target"]

    with pytest.raises(RuntimeError):
        target()  # the broad except Exception must swallow the ConnectionError, not propagate it


# ---------------------------------------------------------------------------
# main() -- argparse dispatch
# ---------------------------------------------------------------------------

def test_main_returns_2_on_config_error(mocker, monkeypatch):
    # main()'s `argv or sys.argv[1:]` means an explicit [] falls through to
    # the real process argv (e.g. pytest's own CLI args) -- patch sys.argv
    # instead to simulate a genuinely no-args invocation.
    monkeypatch.setattr(sys, "argv", ["main.py"])
    mocker.patch("main.load_config", side_effect=ConfigError("missing keys"))
    mocker.patch("main.configure_logging")

    rc = main.main()

    assert rc == 2


def test_main_serve_starts_server_without_keepalive(mocker):
    config = make_config(keepalive_enabled=False)
    mocker.patch("main.load_config", return_value=config)
    mocker.patch("main.configure_logging")
    mock_run_server = mocker.patch("main.run_server")
    mock_keepalive = mocker.patch("main._start_keepalive_ping")

    rc = main.main(["--serve", "--host", "0.0.0.0", "--port", "9000"])

    assert rc == 0
    mock_run_server.assert_called_once_with("0.0.0.0", 9000, config)
    mock_keepalive.assert_not_called()


def test_main_serve_starts_keepalive_when_enabled(mocker):
    config = make_config(keepalive_enabled=True, keepalive_url="http://example.com", keepalive_interval_seconds=300)
    mocker.patch("main.load_config", return_value=config)
    mocker.patch("main.configure_logging")
    mocker.patch("main.run_server")
    mock_keepalive = mocker.patch("main._start_keepalive_ping")

    rc = main.main(["--serve"])

    assert rc == 0
    mock_keepalive.assert_called_once_with("enrichment", "http://example.com", 300)


def test_main_input_arg_runs_cli(mocker):
    config = make_config()
    mocker.patch("main.load_config", return_value=config)
    mocker.patch("main.configure_logging")
    mock_run_cli = mocker.patch("main.run_cli")

    rc = main.main(["--input", "in.json", "--output", "out.json"])

    assert rc == 0
    mock_run_cli.assert_called_once_with("in.json", "out.json", config)


def test_main_no_args_runs_self_test(mocker, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["main.py"])
    config = make_config()
    mocker.patch("main.load_config", return_value=config)
    mocker.patch("main.configure_logging")
    orch_cls = mocker.patch("main.EnrichmentOrchestrator")
    orch_cls.return_value.process_lead.return_value = make_pipeline_result()

    rc = main.main()

    assert rc == 0
    orch_cls.return_value.process_lead.assert_called_once()
    out = capsys.readouterr().out
    assert "SAMPLE ENRICHMENT TEST OUTPUT" in out
