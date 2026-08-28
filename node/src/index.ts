/** Public API of @rokid/pluginbridge-plugin-sdk. */
export { serve, createStdioServer, checkProtocolVersion } from "./stdioServer.js";
export type { StdioServerOptions } from "./stdioServer.js";
export {
  PROTOCOL_VERSION,
} from "./types.js";
export {
  platformName,
  desktopAutomationEnvDocs,
  desktopAutomationTargetTitle,
  isDesktopAutomationPlatformSupported,
} from "./desktopAutomation.js";
export type {
  PluginAdapter,
  PluginEvent,
  ApprovalResolutionRequest,
  ApprovalResolver,
  AttachSessionRequest,
  Capability,
  ControlSessionRequest,
  ControlSessionResult,
  DiscoveryResult,
  DraftControlRequest,
  DraftControlResult,
  DraftOpenRequest,
  DraftOpenResult,
  HistoryMessage,
  HistoryProgress,
  HistoryProgressStep,
  HistoryStreamEvent,
  HistoryStreamRequest,
  HistoryTurn,
  Attachment,
  InboundMessage,
  IntegrationMode,
  NativeSession,
  NativeSessionHint,
  RpcError,
  RpcEvent,
  RpcRequest,
  RpcResponse,
  RemoteConversationAdapter,
  RunStatus,
  RunWaiter,
  SendReceipt,
  StartSessionWithMessageRequest,
	StartSessionWithMessageResult,
	StartDraftWithMessageRequest,
  StatusReader,
  SessionController,
  VisibilityResult,
} from "./types.js";
export type {
  DesktopAutomationEnvDoc,
  DesktopAutomationTarget,
  DesktopPlatform,
} from "./desktopAutomation.js";
