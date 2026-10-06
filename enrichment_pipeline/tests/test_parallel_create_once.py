"""ParallelClient creates exactly one paid Task Run per call and then waits on
that same run -- a hiccup while fetching the result must re-poll the run, never
create another one (which used to happen on every transient error)."""

from __future__ import annotations

import dataclasses
import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config
from providers.parallel_client import ParallelClient, ParallelError


class FakeStatusError(Exception):
    def __init__(self, status_code: int):
        super().__init__(f"HTTP {status_code}")
        self.status_code = status_code


def _done(content=None, status="completed"):
    return SimpleNamespace(
        run=SimpleNamespace(status=status, error="boom" if status == "failed" else None),
        output=SimpleNamespace(content=content if content is not None else {"headline": "Translator"}),
    )


class FakeTaskRun:
    def __init__(self, create_effects, result_effects):
        self.create_effects = list(create_effects)
        self.result_effects = list(result_effects)
        self.create_calls = 0
        self.result_run_ids = []

    def create(self, **kwargs):
        self.create_calls += 1
        effect = self.create_effects.pop(0)
        if isinstance(effect, BaseException):
            raise effect
        return SimpleNamespace(run_id=effect)

    def result(self, run_id, **kwargs):
        self.result_run_ids.append(run_id)
        effect = self.result_effects.pop(0)
        if isinstance(effect, BaseException):
            raise effect
        return effect


def _client(create_effects, result_effects, deadline_seconds=3700.0):
    cfg = Config(
        brightdata_api_key="", dataset_id="", tavily_api_key="", claude_api_key="", groq_api_key="",
        parallel_api_key="test-key",
    )
    cfg = dataclasses.replace(cfg, parallel_deadline_seconds=deadline_seconds)
    client = ParallelClient(cfg)
    fake = FakeTaskRun(create_effects, result_effects)
    client._client = SimpleNamespace(task_run=fake)
    client._task_spec = lambda payload: None
    client._sleep = lambda seconds: None
    return client, fake


LEAD = {"Full_Name": "Ada Lovelace", "Source": "LINKEDIN"}
URL = "https://www.linkedin.com/in/ada"


def test_result_hiccups_re_poll_the_same_run_and_never_create_again():
    client, fake = _client(
        create_effects=["run_1"],
        result_effects=[FakeStatusError(408), ConnectionError("reset"), FakeStatusError(503), _done()],
    )
    assert client.enrich_profile(LEAD, URL) == {"headline": "Translator"}
    assert fake.create_calls == 1
    assert fake.result_run_ids == ["run_1"] * 4


def test_failed_run_raises_without_creating_a_second_run():
    client, fake = _client(create_effects=["run_1"], result_effects=[_done(status="failed")])
    with pytest.raises(ParallelError) as err:
        client.enrich_profile(LEAD, URL)
    assert not err.value.permanent
    assert fake.create_calls == 1


def test_rejected_input_is_permanent():
    client, fake = _client(create_effects=[FakeStatusError(422)], result_effects=[])
    with pytest.raises(ParallelError) as err:
        client.enrich_profile(LEAD, URL)
    assert err.value.permanent
    assert fake.create_calls == 1


def test_create_is_retried_only_while_no_run_exists():
    client, fake = _client(create_effects=[ConnectionError("refused"), "run_2"], result_effects=[_done()])
    assert client.enrich_profile(LEAD, URL) == {"headline": "Translator"}
    assert fake.create_calls == 2
    assert fake.result_run_ids == ["run_2"]


def test_deadline_is_honoured():
    client, fake = _client(create_effects=["run_1"], result_effects=[], deadline_seconds=0.0)
    with pytest.raises(ParallelError, match="not finished"):
        client.enrich_profile(LEAD, URL)
    assert fake.create_calls == 1
