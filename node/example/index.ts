/**
 * Example: a minimal PluginBridge plugin using the Node/TS SDK.
 *
 * Run:   npx tsx ./example/index.ts
 * Test:  run the repository's direct Plugin conformance tests
 *
 * This echo adapter reports available + native-visible, echoes each inbound
 * message as a completed PluginEvent.
 */
import { randomUUID } from "crypto";
import {
  serve,
  type PluginAdapter,
  type PluginEvent,
  type Capability,
  type DiscoveryResult,
  type InboundMessage,
  type NativeSession,
  type SendReceipt,
  type StartSessionWithMessageRequest,
  type StartSessionWithMessageResult,
  type VisibilityResult,
} from "../src";

class EchoAdapter implements PluginAdapter {
  id(): string {
    return "echo";
  }

  probe(): Capability {
    return {
      PluginID: "echo",
      Available: true,
      NativeVisibleInput: true,
      NativeVisibleOutput: true,
      CanAttachSession: false,
		CanStartSessionWithMessage: true,
      CanListSessions: false,
      CanReadHistory: false,
      CanInterrupt: true,
      CanApproval: false,
      CanForwardSync: true,
      CanReverseSync: false,
      CanWaitRun: false,
      IntegrationMode: "protocol-native",
      VisibilitySurface: "echo",
      UnavailableReason: "",
    };
  }

  discover(): DiscoveryResult {
    return { PluginID: "echo", Surface: "echo", Endpoint: "", ProcessID: 0, SessionHints: {}, Verified: true, Detail: "" };
  }

  startSessionWithMessage(req: StartSessionWithMessageRequest): StartSessionWithMessageResult {
    if (req.Message.PrismMessageID === "" || req.Message.Text === "") {
      throw new Error("first message id and text required");
    }
    const id = `echo:${req.Message.PrismMessageID}`;
    const session: NativeSession = {
      PluginID: "echo",
      NativeSessionID: id,
      NativeThreadID: id,
      Surface: "echo",
      Endpoint: "",
      Cwd: req.Cwd,
      Visible: true,
    };
    return {
      Session: session,
      Receipt: { NativeMessageID: req.Message.PrismMessageID, Accepted: true, Visible: true, Detail: "echoed first message" },
      Visibility: { Visible: true, Marker: req.Message.Text, Evidence: "echo adapter", CheckedAt: new Date().toISOString(), FailureReason: "" },
    };
  }

  send(_session: NativeSession, msg: InboundMessage): SendReceipt {
    return {
      NativeMessageID: randomUUID(),
      Accepted: true,
      Visible: true,
      Detail: `echoed ${msg.Text.length} chars`,
    };
  }

  async *subscribe(_session: NativeSession): AsyncIterable<PluginEvent> {
    yield {
      ID: randomUUID(),
      Type: "completed",
      Status: "completed",
      Summary: "echo done",
      Payload: {},
      CreatedAt: new Date().toISOString(),
    };
  }

  interrupt(): void { /* no-op */ }

  verifyVisibility(_session: NativeSession, marker: string): VisibilityResult {
    return {
      Visible: true,
      Marker: marker,
      Evidence: "echo adapter always visible",
      CheckedAt: new Date().toISOString(),
      FailureReason: "",
    };
  }

  close(): void { /* no-op */ }
}

serve(new EchoAdapter()).catch((err) => {
  console.error(err);
  process.exit(1);
});
