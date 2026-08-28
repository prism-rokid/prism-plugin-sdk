/**
 * @rokid-prism/pluginbridge-plugin-sdk — TypeScript type definitions.
 *
 * SDK-facing fields stay aligned with the Go SDK (sdk/go/types.go) and Prism
 * runtime types. stdioServer converts them to the v4 snake_case wire format.
 */

/** Protocol version this SDK speaks. */
export const PROTOCOL_VERSION = "4";

export type IntegrationMode = "protocol-native" | "desktop-automation";

export interface Capability {
  PluginID: string;
  Available: boolean;
  NativeVisibleInput: boolean;
  NativeVisibleOutput: boolean;
  CanAttachSession: boolean;
  CanStartSessionWithMessage: boolean;
  /** Optional for existing plugins; required before Hub routes draft commands. */
  CanOpenDraft?: boolean;
  /** Plugin can enumerate real native sessions for remote selection. */
  CanListSessions: boolean;
  /** Plugin can read native conversation history/body for a chosen session. */
  CanReadHistory: boolean;
  CanInterrupt: boolean;
  CanApproval: boolean;
  /** Forward path (Prism -> native application) supported. */
  CanForwardSync: boolean;
  /** Reverse path (native application -> Prism) supported. Not mandatory for every full remote plugin. */
  CanReverseSync: boolean;
  /** Reverse sync is one Plugin-wide watcher rather than one watcher per native session. */
  CanPluginWideWatch?: boolean;
  /** Adapter implements waitForRun. For mobile/glasses remote plugins this is effectively required. */
  CanWaitRun: boolean;
  /** Adapter implements readStatus (run-process view: phase/steps/preview/context). See docs/06 §5.4. */
  CanReadStatus: boolean;
  /** Adapter implements controlSession (writable half of unified contract). See docs/06 §5.5. */
  CanControlSession: boolean;
  /** Plugin can open a local TUI that shares its already-owned native transport. */
  CanOpenManagedTerminal?: boolean;
  /** How this plugin talks to the native application runtime. */
  IntegrationMode: IntegrationMode;
  VisibilitySurface: string;
  UnavailableReason: string;
}

export interface DiscoveryResult {
  PluginID: string;
  Surface: string;
  Endpoint: string;
  ProcessID: number;
  SessionHints: Record<string, string>;
  Verified: boolean;
  Detail: string;
}

export interface StartSessionWithMessageRequest {
  PluginID: string;
  Cwd: string;
  Message: InboundMessage;
  SourceDevice: string;
  Metadata: Record<string, string>;
}

export interface StartSessionWithMessageResult {
  Session: NativeSession;
  Receipt: SendReceipt;
  Visibility: VisibilityResult;
}

export interface DraftOpenRequest {
  DraftID: string;
  PluginID: string;
  Cwd: string;
  SourceDevice: string;
  Metadata: Record<string, string>;
}

export interface DraftOpenResult {
  DraftID: string;
  Cwd: string;
  Controls: Record<string, unknown>;
  DraftFingerprint: string;
}

export interface DraftControlRequest {
  DraftID: string;
  PluginID: string;
  Action: string;
  Target?: unknown;
  Name?: string;
  Metadata?: Record<string, unknown>;
}

export interface DraftControlResult {
  DraftID: string;
  Cwd: string;
  Controls: Record<string, unknown>;
}

export interface StartDraftWithMessageRequest {
  DraftID: string;
  PluginID: string;
  Cwd: string;
  Message: InboundMessage;
  SourceDevice: string;
  Metadata: Record<string, string>;
}

export interface AttachSessionRequest {
  PrismConversationID: string;
  PluginID: string;
  NativeSessionID: string;
  NativeThreadID: string;
  Cwd: string;
  SourceDevice: string;
  Metadata: Record<string, string>;
}

export interface ApprovalResolutionRequest {
  PrismConversationID: string;
  PluginID: string;
  Session: NativeSession;
  ApprovalRequestID: string;
  ActionID: string;
  Input?: string;
  SourceDevice: string;
  Metadata: Record<string, string>;
}

/**
 * One session-level control action. Action is case-insensitive and accepts
 * both "model.switch" and "model_switch". See docs/06 §5.5 for the standard
 * action-key table.
 */
export interface ControlSessionRequest {
  session: NativeSession;
  action: string;
  target?: unknown;
  name?: string;
  metadata: Record<string, unknown>;
}

/**
 * Refreshed detail after a control action. `Details` carries the full
 * detail_snapshot (same shape as a desktop.state.changed payload). Unconfirmed
 * asynchronous UI results must converge through subscribe.
 */
export interface ControlSessionResult {
  ok: boolean;
  action: string;
  thread_id?: string;
  message?: string;
  details?: Record<string, unknown>;
  /** Per-result assertion, not a manifest capability. Native mutations require a successful write. */
  details_confirmed?: boolean;
}

export interface ManagedTerminalRequest {
  plugin_id: string;
  cwd?: string;
}

export interface ManagedTerminalResult {
  ok: boolean;
  message?: string;
}

/**
 * Run-process view returned by readStatus. Carries fields detail_snapshot
 * deliberately omits (phase, steps, preview). See docs/06 §5.4.
 */
export interface RunStatus {
  status: string;
  phase?: Record<string, unknown>;
  preview?: string;
  steps?: Record<string, unknown>[];
  context?: Record<string, unknown>;
  model?: unknown;
  reasoning_mode?: unknown;
  interruptible: boolean;
  primary_action?: string;
  approval_blocked: boolean;
  turn_id?: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
}

export interface NativeSession {
  PluginID: string;
  NativeSessionID: string;
  NativeThreadID: string;
  Surface: string;
  Endpoint: string;
  Cwd: string;
  Visible: boolean;
}

export interface NativeSessionHint {
  PluginID: string;
  NativeSessionID: string;
  NativeThreadID: string;
  Surface: string;
  Endpoint: string;
  Cwd: string;
  Title: string;
  PrismConversationID: string;
  Active: boolean;
  Visible: boolean;
  /** RFC 3339 timestamp string. */
  LastActivityAt: string;
  Metadata: Record<string, string>;
}

export interface InboundMessage {
  PrismMessageID: string;
  Text: string;
  Attachments?: Attachment[];
  SourceDevice: string;
  /** RFC 3339 timestamp string. */
  Timestamp: string;
  Metadata: Record<string, string>;
}

/** Command-only local attachment input materialized by Hub. */
export interface Attachment {
  Name: string;
  MIMEType: string;
  LocalPath: string;
}

export interface SendReceipt {
  NativeMessageID: string;
  CanonicalNativeSessionID?: string;
  CanonicalNativeThreadID?: string;
  Accepted: boolean;
  Visible: boolean;
  PendingConfirmation?: boolean;
  /** Native queue submit clicked; the watcher has not observed its row yet. */
  QueuePending?: boolean;
  Detail: string;
}

export interface VisibilityResult {
  Visible: boolean;
  Marker: string;
  Evidence: string;
  /** RFC 3339 timestamp string. */
  CheckedAt: string;
  FailureReason: string;
}

export interface PluginEvent {
  ID: string;
  Type: string;
  Status: string;
  Summary: string;
  /**
   * Attachment-bearing events should prefer lightweight metadata in Payload,
   * for example `attachments[].name`. Remote clients currently only require
   * attachment/file-name visibility, not binary image sync.
   */
  Payload: Record<string, unknown>;
  /** RFC 3339 timestamp string. */
  CreatedAt: string;
}

export interface HistoryMessage {
  ID: string;
  Role: string;
  Type: string;
  Content: string;
  Status: string;
  /** RFC 3339 timestamp string. */
  CreatedAt: string;
  /** RFC 3339 timestamp string. */
  UpdatedAt: string;
  /**
   * The single structured assistant execution unit for this message. This is
   * part of the body wire contract, not opaque metadata.
   */
  Progress?: HistoryProgress;
  /**
   * Attachments should be exposed here as metadata (for example
   * `attachments[].name`, `mime_type`, `kind`). Remote/mobile clients only
   * receive file metadata, never a local path, URI, or binary image data.
   */
  Metadata?: Record<string, unknown>;
}

export interface HistoryProgress {
  Status: "running" | "completed" | "failed" | string;
  /** RFC 3339 timestamp string. */
  StartedAt: string;
  /** RFC 3339 timestamp string. */
  CompletedAt?: string;
  Steps: HistoryProgressStep[];
}

export interface HistoryProgressStep {
  ID: string;
  Kind: "assistant_text" | "tool" | "tool_result" | "status" | string;
  /** Stable native tool-call identity shared by tool and tool_result steps. */
  CallID?: string;
  Title: string;
  Detail: string;
  Status: "running" | "completed" | "failed" | string;
  /** RFC 3339 timestamp string. */
  CreatedAt: string;
}

export interface HistoryStreamRequest {
  stream_id: string;
  limit: number;
  live?: boolean;
}

export interface HistoryTurn {
  turn_id: string;
  order_key: string;
  revision: number;
  messages: HistoryMessage[];
}

export interface HistoryStreamEvent {
  stream_id: string;
  type: "turn" | "page_end" | "end" | "error";
  source?: "initial" | "live";
  operation?: "append" | "replace";
  turn?: HistoryTurn;
  error?: string;
  retryable?: boolean;
}

/**
 * Raw protocol surface every plugin speaks over stdio.
 * Finished mobile/glasses remote-conversation plugins should satisfy the
 * stricter RemoteConversationAdapter contract below.
 */
export interface PluginAdapter {
  id(): string;
  probe(): Capability | Promise<Capability>;
  discover(): DiscoveryResult | Promise<DiscoveryResult>;
  startSessionWithMessage?(req: StartSessionWithMessageRequest): StartSessionWithMessageResult | Promise<StartSessionWithMessageResult>;
  openDraft?(req: DraftOpenRequest): DraftOpenResult | Promise<DraftOpenResult>;
  controlDraft?(req: DraftControlRequest): DraftControlResult | Promise<DraftControlResult>;
  startDraftWithMessage?(req: StartDraftWithMessageRequest): StartSessionWithMessageResult | Promise<StartSessionWithMessageResult>;
  /** Required for any plugin that wants to support mobile/glasses remote session browsing. */
  listSessions?(): NativeSessionHint[] | Promise<NativeSessionHint[]>;
  /** Required for any plugin that wants to support mobile/glasses continue-chat on an existing session. */
  attachSession?(req: AttachSessionRequest): NativeSession | Promise<NativeSession>;
  /** Required for full remote-conversation plugins. Emits complete turns. */
  readHistoryStream?(session: NativeSession, request: HistoryStreamRequest, signal?: AbortSignal): AsyncIterable<HistoryStreamEvent> | Promise<AsyncIterable<HistoryStreamEvent>>;
  /** @deprecated Compatibility-only pre-stream body route. */
  readHistory?(session: NativeSession, limit: number): HistoryMessage[] | Promise<HistoryMessage[]>;
  /** Optional durable detail projection. Must not select or resume Desktop state. */
  readDetail?(session: NativeSession): Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Optional run-process projection. Required when CanReadStatus is true. */
  readStatus?(session: NativeSession, runID: string): RunStatus | Promise<RunStatus>;
  /** Optional session control entry point. Required when CanControlSession is true. */
  controlSession?(req: ControlSessionRequest): ControlSessionResult | Promise<ControlSessionResult>;
  /** Optional local-only action. Never expose the returned transport URL or token. */
  openManagedTerminal?(req: ManagedTerminalRequest): ManagedTerminalResult | Promise<ManagedTerminalResult>;
  send(session: NativeSession, msg: InboundMessage): SendReceipt | Promise<SendReceipt>;
  subscribe(session: NativeSession, signal?: AbortSignal): AsyncIterable<PluginEvent> | Promise<AsyncIterable<PluginEvent>>;
  /** Optional Plugin-wide reverse watcher. Events must carry the real native session in Payload.native_session. */
  subscribePlugin?(signal?: AbortSignal): AsyncIterable<PluginEvent> | Promise<AsyncIterable<PluginEvent>>;
  /** Optional account-level display projection for the Agent card. */
  readAgentUsage?(): AgentUsage | null | Promise<AgentUsage | null>;
  interrupt(session: NativeSession, taskID: string): void | Promise<void>;
  verifyVisibility(session: NativeSession, marker: string): VisibilityResult | Promise<VisibilityResult>;
  close(): void | Promise<void>;
}

export interface AgentUsage {
  five_hour?: { used_percent: number; window_minutes: number; resets_at: number };
  weekly?: { used_percent: number; window_minutes: number; resets_at: number };
  account_summary?: { lifetime_tokens: number; peak_daily_tokens: number; current_streak_days: number; longest_streak_days: number };
  updated_at: number;
}

/** Optional only at protocol level. Full remote-conversation plugins should implement it. */
export interface RunWaiter {
  waitForRun(session: NativeSession, runID: string): PluginEvent | Promise<PluginEvent>;
}

export interface ApprovalResolver {
  resolveApproval(req: ApprovalResolutionRequest): void | Promise<void>;
}

/**
 * Exposes the run-process view of a session (phase, steps, preview, context).
 * Complements detail_snapshot, which only carries the control-console view
 * (model/options/approval). See docs/06 §5.4.
 */
export interface StatusReader {
  readStatus(session: NativeSession, runID: string): RunStatus | Promise<RunStatus>;
}

/**
 * Executes a session-level control action (switch model / reasoning /
 * permission, compact, rename, pin, archive, ...) and returns the refreshed
 * detail. The writable half of the unified capability contract;
 * detail_snapshot is the readable half. See docs/06 §5.5.
 */
export interface SessionController {
  controlSession(req: ControlSessionRequest): ControlSessionResult | Promise<ControlSessionResult>;
}

/**
 * A finished remote-conversation plugin for mobile/glasses style clients.
 *
 * This is stricter than the raw protocol surface: besides the base adapter
 * methods, it must list sessions, attach to an existing session, and wait for
 * the terminal result of one run.
 *
 * Approval handling is also required at the product level whenever the native
 * application has approval semantics; it is represented by ApprovalResolver.
 */
export type RemoteConversationAdapter =
  PluginAdapter &
  RunWaiter & {
    listSessions(): NativeSessionHint[] | Promise<NativeSessionHint[]>;
    attachSession(req: AttachSessionRequest): NativeSession | Promise<NativeSession>;
    startSessionWithMessage(req: StartSessionWithMessageRequest): StartSessionWithMessageResult | Promise<StartSessionWithMessageResult>;
    readHistoryStream(session: NativeSession, request: HistoryStreamRequest, signal?: AbortSignal): AsyncIterable<HistoryStreamEvent> | Promise<AsyncIterable<HistoryStreamEvent>>;
  } & Partial<ApprovalResolver>;

// --- Wire-protocol envelope types (internal) ---

export interface RpcRequest {
  id: string;
  method: string;
  params?: unknown;
}

export interface RpcError {
  code?: string;
  message?: string;
}

export interface RpcResponse {
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: RpcError;
}

export interface RpcEvent {
  event: string;
  payload?: unknown;
}
