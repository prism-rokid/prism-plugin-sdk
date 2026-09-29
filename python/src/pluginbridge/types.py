"""Protocol data types for the PluginBridge plugin SDK.

SDK dataclass names are language-facing. The stdio server serializes every
wire field as snake_case.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from abc import ABC, abstractmethod

PROTOCOL_VERSION = "4"

IntegrationMode = str


@dataclass
class Capability:
    PluginID: str = ""
    Available: bool = False
    NativeVisibleInput: bool = False
    NativeVisibleOutput: bool = False
    CanAttachSession: bool = False
    CanStartSessionWithMessage: bool = False
    CanOpenDraft: bool = False
    # Plugin can enumerate real native sessions for remote selection.
    CanListSessions: bool = False
    # Plugin can read native conversation history/body for a chosen session.
    CanReadHistory: bool = False
    CanInterrupt: bool = False
    CanApproval: bool = False
    # Forward path (Prism -> native application) supported.
    CanForwardSync: bool = False
    # Reverse path (native application -> Prism) supported. Useful but not the hard
    # requirement for a full remote-conversation plugin.
    CanReverseSync: bool = False
    # Reverse sync is one Plugin-wide watcher rather than one independent
    # subscription for every native session.
    CanPluginWideWatch: bool = False
    # Adapter implements wait_for_run. For mobile/glasses remote plugins this
    # is effectively required.
    CanWaitRun: bool = False
    # Adapter implements read_status (run-process view: phase/steps/preview/
    # context) that complements detail_snapshot. See docs/06 §5.4.
    CanReadStatus: bool = False
    # Adapter implements control_session (writable half of unified contract).
    # See docs/06 §5.5.
    CanControlSession: bool = False
    # Plugin can launch a local TUI that shares its already-owned transport.
    CanOpenManagedTerminal: bool = False
    # How this plugin talks to the native application runtime.
    IntegrationMode: IntegrationMode = "protocol-native"
    VisibilitySurface: str = ""
    UnavailableReason: str = ""


@dataclass
class DiscoveryResult:
    PluginID: str = ""
    Surface: str = ""
    Endpoint: str = ""
    ProcessID: int = 0
    SessionHints: dict[str, str] = field(default_factory=dict)
    Verified: bool = False
    Detail: str = ""


@dataclass
class StartSessionWithMessageRequest:
    PluginID: str = ""
    Cwd: str = ""
    Message: "InboundMessage" = field(default_factory=lambda: InboundMessage())
    SourceDevice: str = ""
    Metadata: dict[str, str] = field(default_factory=dict)


@dataclass
class StartSessionWithMessageResult:
    Session: "NativeSession" = field(default_factory=lambda: NativeSession())
    Receipt: "SendReceipt" = field(default_factory=lambda: SendReceipt())
    Visibility: "VisibilityResult" = field(default_factory=lambda: VisibilityResult())


@dataclass
class DraftOpenRequest:
    DraftID: str = ""
    PluginID: str = ""
    Cwd: str = ""
    SourceDevice: str = ""
    Metadata: dict[str, str] = field(default_factory=dict)


@dataclass
class DraftOpenResult:
    DraftID: str = ""
    Cwd: str = ""
    Controls: dict[str, Any] = field(default_factory=dict)
    DraftFingerprint: str = ""


@dataclass
class DraftControlRequest:
    DraftID: str = ""
    PluginID: str = ""
    Action: str = ""
    Target: Any = None
    Name: str = ""
    Metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class DraftControlResult:
    DraftID: str = ""
    Cwd: str = ""
    Controls: dict[str, Any] = field(default_factory=dict)


@dataclass
class StartDraftWithMessageRequest:
    DraftID: str = ""
    PluginID: str = ""
    Cwd: str = ""
    Message: "InboundMessage" = field(default_factory=lambda: InboundMessage())
    SourceDevice: str = ""
    Metadata: dict[str, str] = field(default_factory=dict)


@dataclass
class AttachSessionRequest:
    PrismConversationID: str = ""
    PluginID: str = ""
    NativeSessionID: str = ""
    NativeThreadID: str = ""
    Cwd: str = ""
    SourceDevice: str = ""
    Metadata: dict[str, str] = field(default_factory=dict)


@dataclass
class ApprovalResolutionRequest:
    PrismConversationID: str = ""
    PluginID: str = ""
    Session: "NativeSession" = field(default_factory=lambda: NativeSession())
    ApprovalRequestID: str = ""
    ActionID: str = ""
    Input: str = ""
    SourceDevice: str = ""
    Metadata: dict[str, str] = field(default_factory=dict)


@dataclass
class ControlSessionRequest:
    """One session-level control action. Action is case-insensitive and accepts
    both "model.switch" and "model_switch". See docs/06 §5.5."""

    session: "NativeSession" = field(default_factory=lambda: NativeSession())
    action: str = ""
    target: object = None
    name: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ControlSessionResult:
    """Refreshed detail after a control action. `details` carries the full
    detail_snapshot. `details_confirmed` is a per-result native authority
    assertion, not a manifest capability. Unconfirmed asynchronous UI results
    converge through subscribe. See docs/06 section 5.5.1."""

    ok: bool = False
    action: str = ""
    thread_id: str = ""
    message: str = ""
    details: dict[str, object] = field(default_factory=dict)
    details_confirmed: bool = False


@dataclass
class ManagedTerminalRequest:
    plugin_id: str = ""
    cwd: str = ""
    native_session_id: str = ""
    native_thread_id: str = ""


@dataclass
class ManagedTerminalResult:
    ok: bool = False
    message: str = ""


@dataclass
class RunStatus:
    """Run-process view returned by read_status. Carries fields detail_snapshot
    deliberately omits (phase, steps, preview). See docs/06 §5.4."""

    status: str = ""
    phase: dict[str, object] = field(default_factory=dict)
    preview: str = ""
    steps: list[dict[str, object]] = field(default_factory=list)
    context: dict[str, object] = field(default_factory=dict)
    model: object = None
    reasoning_mode: object = None
    interruptible: bool = False
    primary_action: str = ""
    approval_blocked: bool = False
    turn_id: str = ""
    started_at: str = ""
    completed_at: str = ""
    duration_ms: int = 0


@dataclass
class NativeSession:
    PluginID: str = ""
    NativeSessionID: str = ""
    NativeThreadID: str = ""
    Surface: str = ""
    Endpoint: str = ""
    Cwd: str = ""
    Visible: bool = False


@dataclass
class NativeSessionHint:
    PluginID: str = ""
    NativeSessionID: str = ""
    NativeThreadID: str = ""
    Surface: str = ""
    Endpoint: str = ""
    Cwd: str = ""
    Title: str = ""
    PrismConversationID: str = ""
    Active: bool = False
    Visible: bool = False
    LastActivityAt: str = ""  # RFC 3339
    Metadata: dict[str, str] = field(default_factory=dict)


@dataclass
class InboundMessage:
    PrismMessageID: str = ""
    Text: str = ""
    Attachments: list["Attachment"] = field(default_factory=list)
    SourceDevice: str = ""
    Timestamp: str = ""  # RFC 3339
    Metadata: dict[str, str] = field(default_factory=dict)


@dataclass
class Attachment:
    Name: str = ""
    MIMEType: str = ""
    LocalPath: str = ""


@dataclass
class SendReceipt:
    NativeMessageID: str = ""
    CanonicalNativeSessionID: str = ""
    CanonicalNativeThreadID: str = ""
    Accepted: bool = False
    Visible: bool = False
    PendingConfirmation: bool = False
    QueuePending: bool = False
    Detail: str = ""


@dataclass
class VisibilityResult:
    Visible: bool = False
    Marker: str = ""
    Evidence: str = ""
    CheckedAt: str = ""  # RFC 3339
    FailureReason: str = ""


@dataclass
class PluginEvent:
    ID: str = ""
    Type: str = ""
    Status: str = ""
    Summary: str = ""
    # Attachment-bearing events should prefer lightweight metadata in Payload,
    # for example attachments[].name. Remote clients currently require file-name
    # visibility, not binary image sync.
    Payload: dict[str, Any] = field(default_factory=dict)
    CreatedAt: str = ""  # RFC 3339


@dataclass
class HistoryMessage:
    ID: str = ""
    Role: str = ""
    Type: str = ""
    Content: str = ""
    Status: str = ""
    CreatedAt: str = ""  # RFC 3339
    UpdatedAt: str = ""  # RFC 3339
    # The structured assistant execution unit is part of the body wire
    # contract, not opaque metadata.
    Progress: "HistoryProgress | None" = None
    # Attachments should be exposed here as metadata, for example
    # attachments[].name, mime_type, and kind. Remote/mobile clients never
    # receive a local path, URI, preview URL, or binary image data.
    Metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class HistoryProgressStep:
    ID: str = ""
    Kind: str = ""
    CallID: str = ""
    Title: str = ""
    Detail: str = ""
    Status: str = ""
    CreatedAt: str = ""  # RFC 3339


@dataclass
class HistoryProgress:
    Status: str = ""
    StartedAt: str = ""  # RFC 3339
    CompletedAt: str = ""  # RFC 3339
    Steps: list[HistoryProgressStep] = field(default_factory=list)


@dataclass
class HistoryStreamRequest:
    stream_id: str = ""
    limit: int = 0
    live: bool = False


@dataclass
class HistoryTurn:
    turn_id: str = ""
    order_key: str = ""
    revision: int = 0
    messages: list[HistoryMessage] = field(default_factory=list)


@dataclass
class HistoryStreamEvent:
    stream_id: str = ""
    type: str = ""
    source: str = ""
    operation: str = ""
    turn: HistoryTurn | None = None
    error: str = ""
    retryable: bool = False


@dataclass
class AgentUsageFiveHour:
    UsedPercent: int = 0
    WindowMinutes: int = 0
    ResetsAt: int = 0


@dataclass
class AgentUsageWeekly:
    UsedPercent: int = 0
    WindowMinutes: int = 0
    ResetsAt: int = 0


@dataclass
class AccountUsageSummary:
    LifetimeTokens: int = 0
    PeakDailyTokens: int = 0
    CurrentStreakDays: int = 0
    LongestStreakDays: int = 0


@dataclass
class AgentUsage:
    FiveHour: AgentUsageFiveHour | None = None
    Weekly: AgentUsageWeekly | None = None
    AccountSummary: AccountUsageSummary | None = None
    UpdatedAt: int = 0


class PluginAdapter(ABC):
    """Raw protocol surface every plugin speaks over stdio.

    Finished mobile/glasses remote-conversation plugins should satisfy the
    stricter RemoteConversationAdapter contract below.
    """

    @abstractmethod
    def id(self) -> str: ...

    @abstractmethod
    def probe(self) -> Capability: ...

    @abstractmethod
    def discover(self) -> DiscoveryResult: ...

    def start_session_with_message(self, req: StartSessionWithMessageRequest) -> StartSessionWithMessageResult:
        raise NotImplementedError("adapter does not implement startSessionWithMessage")

    def open_draft(self, req: DraftOpenRequest) -> DraftOpenResult:
        raise NotImplementedError("adapter does not implement openDraft")

    def control_draft(self, req: DraftControlRequest) -> DraftControlResult:
        raise NotImplementedError("adapter does not implement controlDraft")

    def start_draft_with_message(self, req: StartDraftWithMessageRequest) -> StartSessionWithMessageResult:
        raise NotImplementedError("adapter does not implement startDraftWithMessage")

    def list_sessions(self):
        """Optional only for partial/local-only plugins."""
        raise NotImplementedError("adapter does not implement listSessions")

    def attach_session(self, req: AttachSessionRequest) -> NativeSession:
        """Optional only for partial/local-only plugins."""
        raise NotImplementedError("adapter does not implement attachSession")

    def read_history_stream(self, session: NativeSession, request: HistoryStreamRequest, stop_event=None):
        """Optional only for partial/local-only plugins."""
        raise NotImplementedError("adapter does not implement readHistoryStream")

    def read_detail(self, session: NativeSession) -> dict:
        """Return the current canonical detail snapshot without selecting it."""
        raise NotImplementedError("adapter does not implement readDetail")

    def read_history(self, session: NativeSession, limit: int):
        """Deprecated compatibility route while pre-stream API clients exist."""
        raise NotImplementedError("adapter does not implement readHistory")

    def read_agent_usage(self) -> AgentUsage | None:
        """Optional transient account usage projection for an Agent card."""
        raise NotImplementedError("adapter does not implement readAgentUsage")

    @abstractmethod
    def send(self, session: NativeSession, msg: InboundMessage) -> SendReceipt: ...

    @abstractmethod
    def subscribe(self, session: NativeSession):
        """Return an iterable (generator, list, etc.) of PluginEvent."""

    def subscribe_plugin(self, stop_event=None):
        """Optional Plugin-wide watcher for index and foreground changes."""
        raise NotImplementedError("adapter does not implement subscribePlugin")

    @abstractmethod
    def interrupt(self, session: NativeSession, task_id: str) -> None: ...

    @abstractmethod
    def verify_visibility(self, session: NativeSession, marker: str) -> VisibilityResult: ...

    @abstractmethod
    def close(self) -> None: ...


class RunWaiter(ABC):
    """Optional only at protocol level. Full remote-conversation plugins should implement it."""

    @abstractmethod
    def wait_for_run(self, session: NativeSession, run_id: str) -> PluginEvent: ...


class ApprovalResolver(ABC):
    @abstractmethod
    def resolve_approval(self, req: ApprovalResolutionRequest) -> None: ...


class StatusReader(ABC):
    """Exposes the run-process view (phase/steps/preview/context) that
    complements detail_snapshot. See docs/06 §5.4."""

    @abstractmethod
    def read_status(self, session: NativeSession, run_id: str) -> RunStatus: ...


class SessionController(ABC):
    """Executes a session-level control action (switch model / reasoning /
    permission, compact, rename, pin, archive, ...) and returns the refreshed
    detail. The writable half of the unified capability contract. See docs/06
    §5.5."""

    @abstractmethod
    def control_session(self, req: ControlSessionRequest) -> ControlSessionResult: ...


class ManagedTerminalLauncher(ABC):
    """Opens a local TUI backed by the adapter's existing native transport."""

    @abstractmethod
    def open_managed_terminal(self, req: ManagedTerminalRequest) -> ManagedTerminalResult: ...


class RemoteConversationAdapter(PluginAdapter, RunWaiter):
    """A finished remote-conversation plugin for mobile/glasses style clients.

    This is stricter than the raw protocol surface: besides the base adapter
    methods, it must list sessions, attach to an existing session, and wait for
    the terminal result of one run.

    Approval handling is also required at the product level whenever the native
    application has approval semantics; it is represented by ApprovalResolver.
    """

    @abstractmethod
    def list_sessions(self): ...

    @abstractmethod
    def attach_session(self, req: AttachSessionRequest) -> NativeSession: ...

    @abstractmethod
    def start_session_with_message(self, req: StartSessionWithMessageRequest) -> StartSessionWithMessageResult: ...

    @abstractmethod
    def read_history_stream(self, session: NativeSession, request: HistoryStreamRequest, stop_event=None): ...

    @abstractmethod
    def read_history(self, session: NativeSession, limit: int): ...
