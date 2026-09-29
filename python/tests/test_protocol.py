"""Tests for the v4 snake_case stdio protocol."""

from __future__ import annotations

import io
import json
import time
from pathlib import Path

from pluginbridge import (
    PluginAdapter,
    ApprovalResolver,
    ApprovalResolutionRequest,
    AttachSessionRequest,
    Capability,
    ControlSessionRequest,
    ControlSessionResult,
    DiscoveryResult,
    HistoryStreamEvent,
    ManagedTerminalRequest,
    ManagedTerminalLauncher,
    NativeSessionHint,
    NativeSession,
    SendReceipt,
    RunStatus,
    SessionController,
    StatusReader,
    VisibilityResult,
)
from pluginbridge.stdio_server import StdioServer


SHARED_FIXTURE = json.loads((Path(__file__).resolve().parents[2] / "conformance" / "v4-plugin-wide.json").read_text())


class StubAdapter(PluginAdapter, ApprovalResolver):
    def id(self) -> str:
        return "stub"

    def probe(self) -> Capability:
        return Capability(
            PluginID="stub",
            Available=True,
            NativeVisibleInput=True,
            IntegrationMode="protocol-native",
            VisibilitySurface="test",
            CanListSessions=True,
            CanReadHistory=True,
            CanApproval=True,
            CanReverseSync=True,
        )

    def discover(self) -> DiscoveryResult:
        return DiscoveryResult(PluginID="stub", Verified=True)

    def list_sessions(self):
        return [
            NativeSessionHint(
                PluginID="stub",
                NativeSessionID="s",
                Surface="test",
                Title="Stub Session",
                Active=True,
                Visible=True,
            )
        ]

    def attach_session(self, req: AttachSessionRequest) -> NativeSession:
        return NativeSession(PluginID="stub", NativeSessionID=req.NativeSessionID, Cwd=req.Cwd, Visible=True)

    def resolve_approval(self, req: ApprovalResolutionRequest) -> None:
        pass

    def send(self, session, msg) -> SendReceipt:
        return SendReceipt(NativeMessageID="r", Accepted=True, Visible=True, QueuePending=True)

    def subscribe(self, session):
        yield from []  # no events

    def interrupt(self, session, task_id) -> None:
        pass

    def verify_visibility(self, session, marker) -> VisibilityResult:
        return VisibilityResult(Visible=True, Marker=marker)

    def close(self) -> None:
        pass


class ControlStatusAdapter(StubAdapter, StatusReader, SessionController):
    control_request: ControlSessionRequest | None = None

    def control_session(self, req: ControlSessionRequest) -> ControlSessionResult:
        self.control_request = req
        return ControlSessionResult(
            ok=True,
            action=req.action,
            thread_id=req.session.NativeThreadID,
            message="updated",
            details={"refreshed": True},
            details_confirmed=True,
        )

    def read_status(self, session: NativeSession, run_id: str) -> RunStatus:
        return RunStatus(
            status="running",
            phase={"id": "tool"},
            preview="editing",
            steps=[{"kind": "tool"}],
            context={"available": True},
            model={"id": "gpt-5"},
            reasoning_mode={"id": "high"},
            interruptible=True,
            primary_action="interrupt",
            approval_blocked=False,
            turn_id="turn-1",
            started_at="2026-07-26T00:00:00Z",
            completed_at="",
            duration_ms=10,
        )

    def read_detail(self, session: NativeSession) -> dict:
        return {
            "conversation_id": session.NativeSessionID,
            "current_model": {"key": "gpt-test", "label": "GPT Test"},
        }


class ManagedTerminalAdapter(StubAdapter, ManagedTerminalLauncher):
    managed_request: ManagedTerminalRequest | None = None

    def open_managed_terminal(self, req: ManagedTerminalRequest):
        self.managed_request = req
        return {"ok": True, "message": "attached"}


class PluginWideFixtureAdapter(StubAdapter):
    def subscribe_plugin(self, stop_event=None):
        event = SHARED_FIXTURE["plugin_wide"]["event"]
        from pluginbridge import PluginEvent

        yield PluginEvent(
            ID=event["id"], Type=event["type"], Status=event["status"],
            Summary=event["summary"], Payload=event["payload"], CreatedAt=event["created_at"],
        )

def _run_round_trip(input_text: str, adapter: PluginAdapter | None = None) -> str:
    """Feed input_text to a StdioServer, return all stdout output."""
    stdin = io.StringIO(input_text)
    stdout = io.StringIO()
    server = StdioServer(adapter or StubAdapter(), input_stream=stdin, output_stream=stdout)
    server.run()
    # Give handler threads time to finish writing.
    time.sleep(0.05)
    return stdout.getvalue()


def test_probe_round_trip():
    req = json.dumps({"id": "req-1", "method": "adapter.probe", "params": {}}) + "\n"
    output = _run_round_trip(req)
    lines = [l for l in output.strip().split("\n") if l]
    assert len(lines) == 1
    resp = json.loads(lines[0])
    assert resp["id"] == "req-1"
    assert resp["ok"] is True
    cap = resp["payload"]
    assert cap["plugin_id"] == "stub"
    assert cap["available"] is True
    assert cap["native_visible_input"] is True
    assert cap["can_reverse_sync"] is True
    assert cap["integration_mode"] == "protocol-native"
    assert cap["visibility_surface"] == "test"


def test_optional_session_methods_round_trip():
    req = "\n".join([
        json.dumps({"id": "req-list", "method": "adapter.listSessions", "params": {}}),
        json.dumps({"id": "req-attach", "method": "adapter.attachSession", "params": {"native_session_id": "s", "cwd": "/tmp"}}),
        "",
    ])
    output = _run_round_trip(req)
    lines = [l for l in output.strip().split("\n") if l]
    assert len(lines) == 2
    list_resp = json.loads(lines[0])
    assert list_resp["id"] == "req-list"
    assert list_resp["ok"] is True
    assert list_resp["payload"][0]["native_session_id"] == "s"
    attach_resp = json.loads(lines[1])
    assert attach_resp["id"] == "req-attach"
    assert attach_resp["ok"] is True
    assert attach_resp["payload"]["native_session_id"] == "s"
    assert attach_resp["payload"]["visible"] is True


def test_send_receipt_uses_queue_pending_snake_case():
    req = json.dumps({
        "id": "req-send",
        "method": "adapter.send",
        "params": {
            "session": {"plugin_id": "stub", "native_session_id": "s", "native_thread_id": "t", "visible": True},
            "message": {"prism_message_id": "message-1", "text": "queued", "source_device": "mobile"},
        },
    }) + "\n"
    output = _run_round_trip(req)
    payload = json.loads(output.strip())["payload"]
    assert payload["queue_pending"] is True
    assert "QueuePending" not in payload


def test_unknown_method_returns_error():
    req = json.dumps({"id": "req-2", "method": "adapter.bogus", "params": {}}) + "\n"
    output = _run_round_trip(req)
    lines = [l for l in output.strip().split("\n") if l]
    resp = json.loads(lines[0])
    assert resp["id"] == "req-2"
    assert resp["ok"] is False
    assert resp["error"]["code"] == "unknown_method"


def test_pascal_case_request_is_rejected():
    req = json.dumps({
        "id": "req-legacy",
        "method": "adapter.attachSession",
        "params": {"NativeSessionID": "s"},
    }) + "\n"
    output = _run_round_trip(req)
    resp = json.loads(output.strip())
    assert resp["ok"] is False
    assert resp["error"]["code"] == "adapter_error"
    assert "snake_case" in resp["error"]["message"]


def test_resolve_approval_round_trip():
    req = json.dumps({
        "id": "req-resolve",
        "method": "adapter.resolveApproval",
        "params": {
            "prism_conversation_id": "conv-1",
            "plugin_id": "stub",
            "session": {"plugin_id": "stub", "native_session_id": "s", "visible": True},
            "approval_request_id": "approval-1",
            "action_id": "approve_with_note",
            "input": "current directory only",
            "source_device": "glasses",
            "metadata": {"k": "v"},
        },
    }) + "\n"
    output = _run_round_trip(req)
    lines = [l for l in output.strip().split("\n") if l]
    resp = json.loads(lines[0])
    assert resp["id"] == "req-resolve"
    assert resp["ok"] is True


def test_control_session_exposes_only_direct_snake_request_fields_and_returns_standard_result():
    adapter = ControlStatusAdapter()
    req = json.dumps(SHARED_FIXTURE["control_session"]) + "\n"
    output = _run_round_trip(req, adapter)
    assert adapter.control_request is not None
    assert sorted(adapter.control_request.__dict__) == ["action", "metadata", "name", "session", "target"]
    assert adapter.control_request.action == "composer.control.apply"
    assert adapter.control_request.session.NativeThreadID == "thread-1"
    assert adapter.control_request.target == SHARED_FIXTURE["control_session"]["params"]["target"]
    assert adapter.control_request.metadata == SHARED_FIXTURE["control_session"]["params"]["metadata"]
    payload = json.loads(output.strip())["payload"]
    assert sorted(payload) == ["action", "details", "details_confirmed", "message", "ok", "thread_id"]
    assert payload["thread_id"] == "thread-1"
    assert "conversation_id" not in payload


def test_shared_fixture_routes_plugin_wide_watch_and_history_cancel():
    stdout = io.StringIO()
    server = StdioServer(PluginWideFixtureAdapter(), input_stream=io.StringIO(), output_stream=stdout)
    server._handle(SHARED_FIXTURE["plugin_wide"])
    time.sleep(0.05)
    server._handle(SHARED_FIXTURE["history_cancel"])
    lines = [json.loads(line) for line in stdout.getvalue().strip().split("\n") if line]
    event = next(item for item in lines if item.get("event") == "plugin.event")
    assert event["payload"]["subscription_id"] == "wide-1"
    assert event["payload"]["event"]["type"] == "desktop.session.changed"
    cancel = next(item for item in lines if item.get("id") == "fixture-history-cancel")
    assert cancel["payload"] == {"ok": True}


def test_read_status_returns_only_direct_snake_status_fields():
    req = json.dumps({
        "id": "req-status",
        "method": "adapter.readStatus",
        "params": {"session": {"plugin_id": "stub", "native_session_id": "session-1", "native_thread_id": "thread-1", "visible": True}, "run_id": "run-1"},
    }) + "\n"
    output = _run_round_trip(req, ControlStatusAdapter())
    payload = json.loads(output.strip())["payload"]
    assert sorted(payload) == ["approval_blocked", "completed_at", "context", "duration_ms", "interruptible", "model", "phase", "preview", "primary_action", "reasoning_mode", "started_at", "status", "steps", "turn_id"]
    assert payload["reasoning_mode"]["id"] == "high"
    assert "ReasoningMode" not in payload


def test_read_detail_preserves_session_and_dynamic_snapshot_keys():
    req = json.dumps({
        "id": "req-detail",
        "method": "adapter.readDetail",
        "params": {"session": {"plugin_id": "stub", "native_session_id": "session-1", "visible": True}},
    }) + "\n"
    output = _run_round_trip(req, ControlStatusAdapter())
    payload = json.loads(output.strip())["payload"]
    assert payload["conversation_id"] == "session-1"
    assert payload["current_model"] == {"key": "gpt-test", "label": "GPT Test"}


def test_managed_terminal_passes_existing_native_session_identity():
    adapter = ManagedTerminalAdapter()
    req = json.dumps({
        "id": "req-terminal", "method": "adapter.openManagedTerminal",
        "params": {
            "plugin_id": "stub", "cwd": "/tmp/project",
            "native_session_id": "session-1", "native_thread_id": "thread-1",
        },
    }) + "\n"
    output = _run_round_trip(req, adapter)
    assert json.loads(output.strip())["payload"]["ok"] is True
    assert adapter.managed_request is not None
    assert adapter.managed_request.native_session_id == "session-1"
    assert adapter.managed_request.native_thread_id == "thread-1"


def test_history_stream_error_serializes_retryable():
    stdout = io.StringIO()
    server = StdioServer(StubAdapter(), input_stream=io.StringIO(), output_stream=stdout)
    server._send_history_event(HistoryStreamEvent(
        stream_id="body-1", type="error", error="native stream lost", retryable=True,
    ))
    payload = json.loads(stdout.getvalue().strip())["payload"]
    assert payload["stream_id"] == "body-1"
    assert payload["retryable"] is True


def test_capability_wire_field_names_are_snake_case():
    """SDK dataclass names are internal; stdio output is snake_case."""
    cap = Capability(PluginID="x", Available=True, NativeVisibleInput=True, IntegrationMode="desktop-automation", VisibilitySurface="gw")
    from dataclasses import asdict

    d = asdict(cap)
    assert "PluginID" in d  # Language-facing dataclass shape remains unchanged.
    output = _run_round_trip(json.dumps({"id": "cap", "method": "adapter.probe", "params": {}}) + "\n")
    raw = json.loads(output.strip())["payload"]
    assert "plugin_id" in raw
    assert "native_visible_input" in raw


def test_check_protocol_version():
    """check_protocol_version matches/raises against the hub-provided env var."""
    import os

    from pluginbridge import PROTOCOL_VERSION, check_protocol_version

    # Absent env: allowed (standalone/debug).
    os.environ.pop("PRISM_PLUGIN_PROTOCOL_VERSION", None)
    check_protocol_version()
    # Matching version: allowed.
    os.environ["PRISM_PLUGIN_PROTOCOL_VERSION"] = PROTOCOL_VERSION
    check_protocol_version()
    # Mismatch: raises.
    os.environ["PRISM_PLUGIN_PROTOCOL_VERSION"] = "999"
    try:
        check_protocol_version()
        raise AssertionError("expected protocol version mismatch")
    except RuntimeError as exc:
        assert "mismatch" in str(exc)
    os.environ.pop("PRISM_PLUGIN_PROTOCOL_VERSION", None)
