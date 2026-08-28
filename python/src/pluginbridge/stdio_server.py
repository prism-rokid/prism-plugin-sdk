"""Stdio server core for the PluginBridge plugin SDK.

Reads JSON-over-newline-stdio requests from stdin, dispatches them to the
wrapped PluginAdapter, and writes responses/events to stdout.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import uuid
from datetime import datetime, timezone
from dataclasses import asdict, is_dataclass
from typing import Any, TextIO

from .types import (
    PluginAdapter,
    PluginEvent,
    ApprovalResolutionRequest,
    ApprovalResolver,
    AttachSessionRequest,
    HistoryStreamEvent,
    HistoryStreamRequest,
    NativeSession,
    PROTOCOL_VERSION,
    StartSessionWithMessageRequest,
    DraftOpenRequest,
    DraftControlRequest,
    StartDraftWithMessageRequest,
)


def check_protocol_version() -> None:
    """Verify the protocol version the Hub expects matches this SDK.

    The Hub passes PRISM_PLUGIN_PROTOCOL_VERSION when spawning the plugin.
    A mismatch means Hub and plugin speak different on-wire schemas; fail fast
    rather than silently decode fields under the wrong names. An absent env var
    (standalone/debug) is allowed.
    """
    got = (os.environ.get("PRISM_PLUGIN_PROTOCOL_VERSION") or "").strip()
    if got and got != PROTOCOL_VERSION:
        raise RuntimeError(
            f"pluginbridge plugin protocol version mismatch: hub sent {got!r}, "
            f"SDK implements {PROTOCOL_VERSION!r}"
        )


def _serialize(obj: Any) -> Any:
    """Convert SDK values to the v4 snake_case wire representation."""
    if is_dataclass(obj) and not isinstance(obj, type):
        return _serialize(asdict(obj))
    if isinstance(obj, list):
        return [_serialize(item) for item in obj]
    if isinstance(obj, dict):
        return {_snake_case(key): _serialize(value) for key, value in obj.items()}
    return obj


def _snake_case(key: str) -> str:
    out: list[str] = []
    for index, char in enumerate(key):
        previous = key[index - 1] if index else ""
        following = key[index + 1] if index + 1 < len(key) else ""
        if char.isupper() and index and (previous.islower() or (previous.isupper() and following.islower())):
            out.append("_")
        out.append(char.lower())
    return "".join(out)


def _pascal_case(key: str) -> str:
    acronyms = {"id": "ID", "url": "URL", "uri": "URI", "pid": "PID", "ms": "MS", "api": "API", "cwd": "Cwd"}
    return "".join(acronyms.get(part, part[:1].upper() + part[1:]) for part in key.split("_"))


def _from_wire(value: Any) -> Any:
    if isinstance(value, list):
        return [_from_wire(item) for item in value]
    if isinstance(value, dict):
        output: dict[str, Any] = {}
        for key, item in value.items():
            if key != _snake_case(key):
                raise ValueError(f"pluginbridge v4 requires snake_case wire field {key}")
            output[_pascal_case(key)] = _from_wire(item)
        return output
    return value


class StdioServer:
    """Reads requests from ``input_stream``, dispatches to ``adapter``, writes
    responses to ``output_stream``."""

    def __init__(
        self,
        adapter: PluginAdapter,
        input_stream: TextIO | None = None,
        output_stream: TextIO | None = None,
    ):
        self.adapter = adapter
        self.input = input_stream or sys.stdin
        self.output = output_stream or sys.stdout
        self._subscriptions: dict[str, threading.Event] = {}
        self._history_streams: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def _send(self, obj: dict[str, Any]) -> None:
        with self._lock:
            self.output.write(json.dumps(_serialize(obj)) + "\n")
            self.output.flush()

    def _send_response(self, req_id: str, ok: bool, payload: Any = None, error: dict | None = None) -> None:
        resp: dict[str, Any] = {"id": req_id, "ok": ok}
        if ok:
            resp["payload"] = payload
        elif error:
            resp["error"] = error
        self._send(resp)

    def _send_event(self, subscription_id: str, event: PluginEvent) -> None:
        if not event.CreatedAt:
            event.CreatedAt = datetime.now(timezone.utc).isoformat()
        self._send({"event": "plugin.event", "payload": {"subscription_id": subscription_id, "event": event}})

    def _send_history_event(self, event: HistoryStreamEvent) -> None:
        self._send({"event": "history.stream", "payload": event})

    def _handle(self, req: dict[str, Any]) -> None:
        req_id = req.get("id", "")
        method = req.get("method", "")
        try:
            wire_params = req.get("params") or {}
            params = _from_wire(wire_params)
            if method == "adapter.probe":
                self._send_response(req_id, True, self.adapter.probe())
            elif method == "adapter.discover":
                self._send_response(req_id, True, self.adapter.discover())
            elif method == "adapter.startSessionWithMessage":
                message_params = params.get("Message", {}) or {}
                from .types import InboundMessage
                r = StartSessionWithMessageRequest(
                    PluginID=params.get("PluginID", ""),
                    Cwd=params.get("Cwd", ""),
                    Message=InboundMessage(**{k: message_params.get(k, "") for k in InboundMessage.__dataclass_fields__}),
                    SourceDevice=params.get("SourceDevice", ""),
                    Metadata=params.get("Metadata", {}) or {},
                )
                try:
                    self._send_response(req_id, True, self.adapter.start_session_with_message(r))
                except NotImplementedError as exc:
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": str(exc)})
            elif method == "adapter.openDraft":
                r = DraftOpenRequest(**{k: params.get(k, "") if k != "Metadata" else params.get(k, {}) or {} for k in DraftOpenRequest.__dataclass_fields__})
                try:
                    self._send_response(req_id, True, self.adapter.open_draft(r))
                except NotImplementedError as exc:
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": str(exc)})
            elif method == "adapter.controlDraft":
                r = DraftControlRequest(
                    DraftID=params.get("DraftID", ""),
                    PluginID=params.get("PluginID", ""),
                    Action=params.get("Action", ""),
                    # These maps are opaque Plugin-owned wire values. _from_wire
                    # validates them, but must not rename their nested keys.
                    Target=wire_params.get("target"),
                    Name=params.get("Name", ""),
                    Metadata=wire_params.get("metadata", {}) or {},
                )
                try:
                    self._send_response(req_id, True, self.adapter.control_draft(r))
                except NotImplementedError as exc:
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": str(exc)})
            elif method == "adapter.startDraftWithMessage":
                message_params = params.get("Message", {}) or {}
                from .types import InboundMessage
                r = StartDraftWithMessageRequest(
                    DraftID=params.get("DraftID", ""), PluginID=params.get("PluginID", ""), Cwd=params.get("Cwd", ""),
                    Message=InboundMessage(**{k: message_params.get(k, "") for k in InboundMessage.__dataclass_fields__}),
                    SourceDevice=params.get("SourceDevice", ""), Metadata=params.get("Metadata", {}) or {},
                )
                try:
                    self._send_response(req_id, True, self.adapter.start_draft_with_message(r))
                except NotImplementedError as exc:
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": str(exc)})
            elif method == "adapter.listSessions":
                try:
                    self._send_response(req_id, True, self.adapter.list_sessions())
                except NotImplementedError as exc:
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": str(exc)})
            elif method == "adapter.attachSession":
                r = AttachSessionRequest(**{k: params.get(k, "") for k in AttachSessionRequest.__dataclass_fields__})
                try:
                    self._send_response(req_id, True, self.adapter.attach_session(r))
                except NotImplementedError as exc:
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": str(exc)})
            elif method == "adapter.readHistory":
                session_params = params.get("Session", {})
                session = NativeSession(**{k: session_params.get(k, False if k == "Visible" else "") for k in NativeSession.__dataclass_fields__})
                try:
                    self._send_response(req_id, True, self.adapter.read_history(session, int(params.get("Limit", 0) or 0)))
                except NotImplementedError as exc:
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": str(exc)})
            elif method == "adapter.readAgentUsage":
                try:
                    self._send_response(req_id, True, self.adapter.read_agent_usage())
                except NotImplementedError as exc:
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": str(exc)})
            elif method == "adapter.readDetail":
                session_params = params.get("Session", {})
                session = NativeSession(**{k: session_params.get(k, False if k == "Visible" else "") for k in NativeSession.__dataclass_fields__})
                try:
                    self._send_response(req_id, True, self.adapter.read_detail(session))
                except NotImplementedError as exc:
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": str(exc)})
            elif method == "adapter.readHistoryStream":
                session_params = params.get("Session", {})
                session = NativeSession(**{k: session_params.get(k, False if k == "Visible" else "") for k in NativeSession.__dataclass_fields__})
                raw_request = (req.get("params") or {}).get("request") or {}
                stream_id = str(raw_request.get("stream_id") or uuid.uuid4())
                request = HistoryStreamRequest(
                    stream_id=stream_id,
                    limit=int(raw_request.get("limit") or 0),
                    live=raw_request.get("live") is True,
                )
                try:
                    stop_event = threading.Event()
                    with self._lock:
                        self._history_streams[stream_id] = stop_event
                    self._send_response(req_id, True, {"stream_id": stream_id})
                    thread = threading.Thread(target=self._pump_history, args=(session, request, stop_event), daemon=True)
                    thread.start()
                except NotImplementedError as exc:
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": str(exc)})
            elif method == "adapter.cancelHistoryStream":
                stream_id = str((req.get("params") or {}).get("stream_id") or "")
                with self._lock:
                    stop = self._history_streams.pop(stream_id, None)
                if stop:
                    stop.set()
                self._send_response(req_id, True, {"ok": True})
            elif method == "adapter.resolveApproval":
                if not isinstance(self.adapter, ApprovalResolver):
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": "adapter does not implement resolveApproval"})
                    return
                req = ApprovalResolutionRequest(
                    PrismConversationID=params.get("PrismConversationID", ""),
                    PluginID=params.get("PluginID", ""),
                    Session=NativeSession(**{
                        k: params.get("Session", {}).get(k, False if k == "Visible" else "")
                        for k in NativeSession.__dataclass_fields__
                    }),
                    ApprovalRequestID=params.get("ApprovalRequestID", ""),
                    ActionID=params.get("ActionID", ""),
                    Input=params.get("Input", ""),
                    SourceDevice=params.get("SourceDevice", ""),
                    Metadata=params.get("Metadata", {}) or {},
                )
                self.adapter.resolve_approval(req)
                self._send_response(req_id, True, {"ok": True})
            elif method == "adapter.send":
                session = NativeSession(**{k: params.get("Session", {}).get(k, "") if k != "Visible" else params.get("Session", {}).get(k, False) for k in NativeSession.__dataclass_fields__})
                from .types import InboundMessage
                msg_params = params.get("Message", {})
                msg = InboundMessage(**{k: msg_params.get(k, "") for k in InboundMessage.__dataclass_fields__})
                self._send_response(req_id, True, self.adapter.send(session, msg))
            elif method == "adapter.subscribe":
                subscription_id = params.get("SubscriptionID") or str(uuid.uuid4())
                session_params = params.get("Session", {})
                session = NativeSession(**{k: session_params.get(k, False if k == "Visible" else "") for k in NativeSession.__dataclass_fields__})
                stop_event = threading.Event()
                with self._lock:
                    self._subscriptions[subscription_id] = stop_event
                self._send_response(req_id, True, {"subscribed": True, "subscription_id": subscription_id})
                thread = threading.Thread(target=self._pump_events, args=(subscription_id, session, stop_event), daemon=True)
                thread.start()
            elif method == "adapter.unsubscribe":
                subscription_id = params.get("SubscriptionID", "")
                with self._lock:
                    stop = self._subscriptions.pop(subscription_id, None)
                if stop:
                    stop.set()
                self._send_response(req_id, True, {"ok": True})
            elif method == "adapter.interrupt":
                session_params = params.get("Session", {})
                session = NativeSession(**{k: session_params.get(k, False if k == "Visible" else "") for k in NativeSession.__dataclass_fields__})
                self.adapter.interrupt(session, params.get("TaskID", ""))
                self._send_response(req_id, True, {"ok": True})
            elif method == "adapter.verifyVisibility":
                session_params = params.get("Session", {})
                session = NativeSession(**{k: session_params.get(k, False if k == "Visible" else "") for k in NativeSession.__dataclass_fields__})
                self._send_response(req_id, True, self.adapter.verify_visibility(session, params.get("Marker", "")))
            elif method == "adapter.waitForRun":
                from .types import RunWaiter
                if not isinstance(self.adapter, RunWaiter):
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": "adapter does not implement waitForRun"})
                    return
                session_params = params.get("Session", {})
                session = NativeSession(**{k: session_params.get(k, False if k == "Visible" else "") for k in NativeSession.__dataclass_fields__})
                self._send_response(req_id, True, self.adapter.wait_for_run(session, params.get("RunID", "")))
            elif method == "adapter.readStatus":
                from .types import StatusReader
                if not isinstance(self.adapter, StatusReader):
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": "adapter does not implement readStatus"})
                    return
                session_params = params.get("Session", {})
                session = NativeSession(**{k: session_params.get(k, False if k == "Visible" else "") for k in NativeSession.__dataclass_fields__})
                self._send_response(req_id, True, self.adapter.read_status(session, params.get("RunID", "")))
            elif method == "adapter.controlSession":
                from .types import SessionController, ControlSessionRequest
                if not isinstance(self.adapter, SessionController):
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": "adapter does not implement controlSession"})
                    return
                req = ControlSessionRequest(
                    session=NativeSession(**{
                        k: params.get("Session", {}).get(k, False if k == "Visible" else "")
                        for k in NativeSession.__dataclass_fields__
                    }),
                    action=params.get("Action", ""),
                    target=wire_params.get("target"),
                    name=params.get("Name", ""),
                    metadata=wire_params.get("metadata", {}) or {},
                )
                self._send_response(req_id, True, self.adapter.control_session(req))
            elif method == "adapter.openManagedTerminal":
                from .types import ManagedTerminalLauncher, ManagedTerminalRequest
                if not isinstance(self.adapter, ManagedTerminalLauncher):
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": "adapter does not implement openManagedTerminal"})
                    return
                self._send_response(req_id, True, self.adapter.open_managed_terminal(ManagedTerminalRequest(
                    plugin_id=params.get("PluginID", ""),
                    cwd=params.get("Cwd", ""),
                )))
            elif method == "adapter.subscribePlugin":
                subscription_id = params.get("SubscriptionID") or str(uuid.uuid4())
                if type(self.adapter).subscribe_plugin is PluginAdapter.subscribe_plugin:
                    self._send_response(req_id, False, error={"code": "not_implemented", "message": "adapter does not implement subscribePlugin"})
                    return
                stop_event = threading.Event()
                with self._lock:
                    self._subscriptions[subscription_id] = stop_event
                self._send_response(req_id, True, {"subscribed": True, "subscription_id": subscription_id})
                thread = threading.Thread(target=self._pump_plugin_events, args=(subscription_id, self.adapter.subscribe_plugin, stop_event), daemon=True)
                thread.start()
            elif method == "adapter.close":
                with self._lock:
                    for stop in self._subscriptions.values():
                        stop.set()
                self._subscriptions.clear()
                with self._lock:
                    for stop in self._history_streams.values():
                        stop.set()
                self._history_streams.clear()
                try:
                    self.adapter.close()
                except Exception:
                    pass
                self._send_response(req_id, True, {"ok": True})
            else:
                self._send_response(req_id, False, error={"code": "unknown_method", "message": f"unknown adapter method {method}"})
        except Exception as exc:
            self._send_response(req_id, False, error={"code": "adapter_error", "message": str(exc)})

    def _pump_events(self, subscription_id: str, session: NativeSession, stop_event: threading.Event) -> None:
        try:
            for event in self.adapter.subscribe(session):
                if stop_event.is_set():
                    break
                self._send_event(subscription_id, event)
        except Exception:
            stop_event.set()
        finally:
            with self._lock:
                self._subscriptions.pop(subscription_id, None)

    def _pump_plugin_events(self, subscription_id: str, subscribe_plugin, stop_event: threading.Event) -> None:
        try:
            for event in subscribe_plugin(stop_event):
                if stop_event.is_set():
                    break
                self._send_event(subscription_id, event)
        except Exception:
            stop_event.set()
        finally:
            with self._lock:
                self._subscriptions.pop(subscription_id, None)

    def _pump_history(self, session: NativeSession, request: HistoryStreamRequest, stop_event: threading.Event) -> None:
        try:
            for event in self.adapter.read_history_stream(session, request, stop_event):
                if stop_event.is_set():
                    break
                event.stream_id = request.stream_id
                self._send_history_event(event)
                if event.type in ("end", "error"):
                    break
        except Exception as exc:
            if not stop_event.is_set():
                try:
                    self._send_history_event(HistoryStreamEvent(stream_id=request.stream_id, type="error", error=str(exc)))
                except Exception:
                    # stdout is gone, so the corresponding history pump must
                    # stop rather than continuing to consume native events.
                    stop_event.set()
        finally:
            with self._lock:
                self._history_streams.pop(request.stream_id, None)

    def run(self) -> None:
        """Block reading lines from input until EOF, dispatching each request."""
        check_protocol_version()
        workers: list[threading.Thread] = []
        for line in self.input:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except json.JSONDecodeError:
                continue
            # Handle in a thread so slow adapter calls don't block others.
            thread = threading.Thread(target=self._handle, args=(req,), daemon=True)
            thread.start()
            workers.append(thread)
        # Let already-read request handlers emit their acknowledgement before
        # EOF cancels subscriptions and history relays.
        for worker in workers:
            worker.join()
        with self._lock:
            for stop in self._subscriptions.values():
                stop.set()
        self._subscriptions.clear()
        with self._lock:
            for stop in self._history_streams.values():
                stop.set()
        self._history_streams.clear()


def serve(adapter: PluginAdapter) -> None:
    """Convenience entry point: serve an adapter on sys.stdin/stdout."""
    StdioServer(adapter).run()
