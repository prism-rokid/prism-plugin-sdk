#!/usr/bin/env python3
"""Example: a minimal PluginBridge plugin using the Python SDK.

Run:   python example/echo_adapter.py
Test:  run the repository's direct Plugin conformance tests.

This echo adapter reports available + native-visible, echoes each inbound
message as a completed PluginEvent.
"""

import uuid
from datetime import datetime, timezone

from pluginbridge import (
    PluginAdapter,
    PluginEvent,
    Capability,
    DiscoveryResult,
    InboundMessage,
    NativeSession,
    SendReceipt,
    StartSessionWithMessageRequest,
    StartSessionWithMessageResult,
    VisibilityResult,
    serve,
)


class EchoAdapter(PluginAdapter):
    def id(self) -> str:
        return "echo"

    def probe(self) -> Capability:
        return Capability(
            PluginID="echo",
            Available=True,
            NativeVisibleInput=True,
            NativeVisibleOutput=True,
            CanStartSessionWithMessage=True,
            CanListSessions=False,
            CanReadHistory=False,
            CanInterrupt=True,
            CanForwardSync=True,
            CanReverseSync=False,
            CanWaitRun=False,
            IntegrationMode="protocol-native",
            VisibilitySurface="echo",
        )

    def discover(self) -> DiscoveryResult:
        return DiscoveryResult(PluginID="echo", Surface="echo", Verified=True)

    def start_session_with_message(self, req: StartSessionWithMessageRequest) -> StartSessionWithMessageResult:
        if not req.Message.PrismMessageID or not req.Message.Text:
            raise ValueError("first message id and text required")
        session_id = f"echo:{req.Message.PrismMessageID}"
        return StartSessionWithMessageResult(
            Session=NativeSession(PluginID="echo", NativeSessionID=session_id, NativeThreadID=session_id, Surface="echo", Cwd=req.Cwd, Visible=True),
            Receipt=SendReceipt(NativeMessageID=req.Message.PrismMessageID, Accepted=True, Visible=True, Detail="echoed first message"),
            Visibility=VisibilityResult(Visible=True, Marker=req.Message.Text, Evidence="echo adapter", CheckedAt=datetime.now(timezone.utc).isoformat()),
        )

    def send(self, session: NativeSession, msg: InboundMessage) -> SendReceipt:
        return SendReceipt(
            NativeMessageID=str(uuid.uuid4()),
            Accepted=True,
            Visible=True,
            Detail=f"echoed {len(msg.Text)} chars",
        )

    def subscribe(self, session: NativeSession):
        yield PluginEvent(
            ID=str(uuid.uuid4()),
            Type="completed",
            Status="completed",
            Summary="echo done",
            CreatedAt=datetime.now(timezone.utc).isoformat(),
        )

    def interrupt(self, session: NativeSession, task_id: str) -> None:
        pass

    def verify_visibility(self, session: NativeSession, marker: str) -> VisibilityResult:
        return VisibilityResult(
            Visible=True,
            Marker=marker,
            Evidence="echo adapter always visible",
            CheckedAt=datetime.now(timezone.utc).isoformat(),
        )

    def close(self) -> None:
        pass


if __name__ == "__main__":
    serve(EchoAdapter())
