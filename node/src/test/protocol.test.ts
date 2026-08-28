/**
 * Tests for the stdio protocol round-trip and locked field names.
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createStdioServer } from "../stdioServer.js";
import type { PluginAdapter, ApprovalResolutionRequest, AttachSessionRequest, Capability, ControlSessionRequest, ControlSessionResult, DraftControlRequest, DraftControlResult, HistoryStreamEvent, HistoryStreamRequest, NativeSession, NativeSessionHint, RpcResponse, RunStatus, StartSessionWithMessageRequest } from "../types.js";

const sharedFixture = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../conformance/v4-plugin-wide.json", import.meta.url)), "utf8")) as {
  control_session: { id: string; method: string; params: Record<string, unknown> };
  plugin_wide: { id: string; method: string; params: Record<string, unknown>; event: Record<string, unknown> };
  history_cancel: { id: string; method: string; params: Record<string, unknown> };
};

class StubAdapter implements PluginAdapter {
  id() { return "stub"; }
  probe(): Capability {
    return {
      PluginID: "stub",
      Available: true,
      NativeVisibleInput: true,
      NativeVisibleOutput: false,
      CanAttachSession: false,
      CanStartSessionWithMessage: false,
      CanListSessions: false,
      CanReadHistory: false,
      CanInterrupt: false,
      CanApproval: false,
      CanForwardSync: true,
      CanReverseSync: true,
      CanWaitRun: false,
      CanReadStatus: false,
      CanControlSession: false,
      IntegrationMode: "protocol-native",
      VisibilitySurface: "test",
      UnavailableReason: "",
    };
  }
  async discover() { return { PluginID: "stub", Surface: "", Endpoint: "", ProcessID: 0, SessionHints: {}, Verified: true, Detail: "" }; }
  async startSessionWithMessage(req: StartSessionWithMessageRequest) { return { Session: { PluginID: "stub", NativeSessionID: "s", NativeThreadID: "s", Surface: "", Endpoint: "", Cwd: req.Cwd, Visible: true }, Receipt: { NativeMessageID: req.Message.PrismMessageID, Accepted: true, Visible: true, Detail: "started" }, Visibility: { Visible: true, Marker: req.Message.Text, Evidence: "test", CheckedAt: new Date().toISOString(), FailureReason: "" } }; }
  async listSessions(): Promise<NativeSessionHint[]> {
    return [{ PluginID: "stub", NativeSessionID: "s", NativeThreadID: "", Surface: "test", Endpoint: "", Cwd: "", Title: "Stub Session", PrismConversationID: "", Active: true, Visible: true, LastActivityAt: new Date().toISOString(), Metadata: {} }];
  }
  async attachSession(req: AttachSessionRequest) { return { PluginID: "stub", NativeSessionID: req.NativeSessionID, NativeThreadID: "", Surface: "test", Endpoint: "", Cwd: req.Cwd, Visible: true }; }
  async resolveApproval(_req: ApprovalResolutionRequest) {}
  async send() { return { NativeMessageID: "r", Accepted: true, Visible: true, QueuePending: true, Detail: "" }; }
  async *subscribe() { /* no events */ }
  async interrupt() {}
  async verifyVisibility(_s: NativeSession, marker: string) { return { Visible: true, Marker: marker, Evidence: "", CheckedAt: new Date().toISOString(), FailureReason: "" }; }
  async readAgentUsage() { return { five_hour: { used_percent: 18, window_minutes: 300, resets_at: 1700003600000 }, weekly: { used_percent: 42, window_minutes: 10080, resets_at: 1700000000000 }, updated_at: 1700000000000 }; }
  async close() {}
}

function runRoundTrip(input: string, adapter: PluginAdapter = new StubAdapter()): Promise<string> {
  return new Promise((resolve) => {
    const readable = Readable.from([input]);
    let output = "";
    const writable = new Writable({
      write(chunk, _enc, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const server = createStdioServer(adapter, readable, writable);
    server.run().then(() => resolve(output));
  });
}

class ControlStatusAdapter extends StubAdapter {
  controlRequest?: ControlSessionRequest;

  async controlSession(req: ControlSessionRequest): Promise<ControlSessionResult> {
    this.controlRequest = req;
    return {
      ok: true,
      action: req.action,
      thread_id: req.session.NativeThreadID,
      message: "updated",
      details: { refreshed: true },
      details_confirmed: true,
    };
  }

  async readStatus(_session: NativeSession, _runID: string): Promise<RunStatus> {
    return {
      status: "running",
      phase: { id: "tool" },
      preview: "editing",
      steps: [{ kind: "tool" }],
      context: { available: true },
      model: { id: "gpt-5" },
      reasoning_mode: { id: "high" },
      interruptible: true,
      primary_action: "interrupt",
      approval_blocked: false,
      turn_id: "turn-1",
      started_at: "2026-07-26T00:00:00Z",
      completed_at: "",
      duration_ms: 10,
    };
  }
}

class ManagedTerminalAdapter extends StubAdapter {
  managedTerminalRequest?: import("../types.js").ManagedTerminalRequest;

  async openManagedTerminal(req: import("../types.js").ManagedTerminalRequest) {
    this.managedTerminalRequest = req;
    return { ok: true, message: "managed terminal opened" };
  }
}

class WaitRunAdapter extends StubAdapter {
  private readonly prefix = "bound:";

  async waitForRun(session: NativeSession, runID: string) {
    return { ID: `${this.prefix}${session.NativeSessionID}:${runID}`, Type: "run.completed", Status: "completed", Summary: "done", Payload: {}, CreatedAt: "2026-08-01T00:00:00Z" };
  }
}

class DraftControlAdapter extends StubAdapter {
  draftControlRequest?: DraftControlRequest;

  async controlDraft(req: DraftControlRequest): Promise<DraftControlResult> {
    this.draftControlRequest = req;
    return { DraftID: req.DraftID, Cwd: "/tmp", Controls: {} };
  }
}

class ClosingAdapter extends StubAdapter {
  closeCalls = 0;

  async close() {
    this.closeCalls++;
  }
}

test("stdio EOF closes the adapter exactly once", async () => {
  const adapter = new ClosingAdapter();
  await runRoundTrip(`{"id":"probe","method":"adapter.probe","params":{}}\n`, adapter);
  assert.equal(adapter.closeCalls, 1);
});

class HistoryStreamAdapter extends StubAdapter {
  async *readHistoryStream(_session: NativeSession, request: HistoryStreamRequest): AsyncIterable<HistoryStreamEvent> {
    yield {
      stream_id: request.stream_id,
      type: "turn",
      source: "initial",
      operation: "append",
      turn: {
        turn_id: "turn-1",
        order_key: "1",
        revision: 1,
        messages: [
          { ID: "user-1", Role: "user", Type: "text", Content: "hello", Status: "", CreatedAt: "", UpdatedAt: "" },
          {
            ID: "progress:user-1", Role: "assistant", Type: "progress", Content: "处理中", Status: "running", CreatedAt: "2026-07-28T00:00:00Z", UpdatedAt: "2026-07-28T00:00:01Z",
            Progress: {
              Status: "running", StartedAt: "2026-07-28T00:00:00Z",
              Steps: [{ ID: "step-1", Kind: "tool", CallID: "call-1", Title: "正在执行", Detail: "读取 src/main.js", Status: "running", CreatedAt: "2026-07-28T00:00:01Z" }],
            },
          },
        ],
      },
    };
    yield { stream_id: request.stream_id, type: "end", source: "initial", operation: "append" };
  }
}

class DurableDetailAdapter extends StubAdapter {
  async readDetail(session: NativeSession): Promise<Record<string, unknown>> {
    return {
      conversation_id: session.NativeSessionID,
      current_model: { option_id: "openai/gpt-5.6", label: "GPT-5.6" },
      current_reasoning: { option_id: "high", label: "High" },
      run: { status: "idle", primary_action: "send" },
    };
  }
}

test("probe round-trip returns correct response", async () => {
  const out = await runRoundTrip(JSON.stringify({ id: "req-1", method: "adapter.probe", params: {} }) + "\n");
  const resp = JSON.parse(out.trim()) as RpcResponse;
  assert.equal(resp.id, "req-1");
  assert.equal(resp.ok, true);
  const cap = resp.payload as Capability;
  const wire = cap as unknown as Record<string, unknown>;
  assert.equal(wire.plugin_id, "stub");
  assert.equal(wire.available, true);
  assert.equal(wire.native_visible_input, true);
  assert.equal(wire.can_reverse_sync, true);
  assert.equal(wire.integration_mode, "protocol-native");
  assert.equal(wire.visibility_surface, "test");
});

test("optional session methods return correct responses", async () => {
  const out = await runRoundTrip([
    JSON.stringify({ id: "req-list", method: "adapter.listSessions", params: {} }),
    JSON.stringify({ id: "req-attach", method: "adapter.attachSession", params: { native_session_id: "s", cwd: "/tmp" } }),
    "",
  ].join("\n"));
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 2);
  const listResp = JSON.parse(lines[0]) as RpcResponse;
  assert.equal(listResp.id, "req-list");
  assert.equal(listResp.ok, true);
  const hints = listResp.payload as NativeSessionHint[];
  assert.equal((hints[0] as unknown as Record<string, unknown>).native_session_id, "s");
  const attachResp = JSON.parse(lines[1]) as RpcResponse;
  assert.equal(attachResp.id, "req-attach");
  assert.equal(attachResp.ok, true);
  const session = attachResp.payload as NativeSession;
  assert.equal((session as unknown as Record<string, unknown>).native_session_id, "s");
  assert.equal((session as unknown as Record<string, unknown>).visible, true);
});

test("durable detail uses the direct snake_case wire projection", async () => {
  const out = await runRoundTrip(JSON.stringify({
    id: "detail-1",
    method: "adapter.readDetail",
    params: { session: { plugin_id: "stub", native_session_id: "session-1", native_thread_id: "thread-1", visible: true } },
  }) + "\n", new DurableDetailAdapter());
  const response = JSON.parse(out.trim()) as RpcResponse;
  const payload = response.payload as Record<string, unknown>;
  assert.equal(response.ok, true);
  assert.equal(payload.conversation_id, "session-1");
  assert.equal((payload.current_model as Record<string, unknown>).option_id, "openai/gpt-5.6");
  assert.equal((payload.current_reasoning as Record<string, unknown>).option_id, "high");
  assert.equal((payload.run as Record<string, unknown>).primary_action, "send");
});

test("resolve approval returns ok", async () => {
  const out = await runRoundTrip(JSON.stringify({
    id: "req-resolve",
    method: "adapter.resolveApproval",
    params: {
      prism_conversation_id: "conv-1",
      plugin_id: "stub",
      session: { plugin_id: "stub", native_session_id: "s", visible: true },
      approval_request_id: "approval-1",
      action_id: "approve_with_note",
      input: "current directory only",
      source_device: "glasses",
      metadata: { k: "v" },
    },
  }) + "\n");
  const resp = JSON.parse(out.trim()) as RpcResponse;
  assert.equal(resp.id, "req-resolve");
  assert.equal(resp.ok, true);
});

test("send receipt exposes queue_pending on the snake_case wire", async () => {
  const out = await runRoundTrip(JSON.stringify({
    id: "req-send",
    method: "adapter.send",
    params: {
      session: { plugin_id: "stub", native_session_id: "s", native_thread_id: "t", visible: true },
      message: { prism_message_id: "message-1", text: "queued", source_device: "mobile" },
    },
  }) + "\n");
  const payload = (JSON.parse(out.trim()) as RpcResponse).payload as Record<string, unknown>;
  assert.equal(payload.queue_pending, true);
  assert.equal(payload.QueuePending, undefined);
});

test("agent usage projection is returned with snake_case fields", async () => {
  const out = await runRoundTrip(JSON.stringify({ id: "req-usage", method: "adapter.readAgentUsage", params: {} }) + "\n");
  const payload = JSON.parse(out.trim()).payload as Record<string, unknown>;
  const fiveHour = payload.five_hour as Record<string, unknown>;
  const weekly = payload.weekly as Record<string, unknown>;
  assert.deepEqual(fiveHour, { used_percent: 18, window_minutes: 300, resets_at: 1700003600000 });
  assert.deepEqual(weekly, { used_percent: 42, window_minutes: 10080, resets_at: 1700000000000 });
  assert.equal(payload.updated_at, 1700000000000);
});

test("control session exposes only direct snake request fields and returns its standard result", async () => {
  const adapter = new ControlStatusAdapter();
  const out = await runRoundTrip(JSON.stringify(sharedFixture.control_session) + "\n", adapter);
  assert.deepEqual(Object.keys(adapter.controlRequest ?? {}).sort(), ["action", "metadata", "name", "session", "target"]);
  assert.equal(adapter.controlRequest?.action, "composer.control.apply");
  assert.equal(adapter.controlRequest?.session.NativeThreadID, "thread-1");
  assert.deepEqual(adapter.controlRequest?.target, sharedFixture.control_session.params.target);
  assert.deepEqual(adapter.controlRequest?.metadata, sharedFixture.control_session.params.metadata);
  const payload = JSON.parse(out.trim()).payload as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), ["action", "details", "details_confirmed", "message", "ok", "thread_id"]);
  assert.equal(payload.thread_id, "thread-1");
  assert.ok(!("conversation_id" in payload));
});

test("managed terminal uses the local-only snake_case protocol contract", async () => {
  const adapter = new ManagedTerminalAdapter();
  const out = await runRoundTrip(JSON.stringify({
    id: "managed-terminal-1",
    method: "adapter.openManagedTerminal",
    params: { plugin_id: "stub", cwd: "/tmp/prism-managed-terminal" },
  }) + "\n", adapter);
  const response = JSON.parse(out.trim()) as RpcResponse;
  assert.equal(response.ok, true);
  assert.deepEqual(adapter.managedTerminalRequest, { plugin_id: "stub", cwd: "/tmp/prism-managed-terminal" });
  assert.deepEqual(response.payload, { ok: true, message: "managed terminal opened" });
});

class PluginWideFixtureAdapter extends StubAdapter {
  async *subscribePlugin(): AsyncIterable<import("../types.js").PluginEvent> {
    const event = sharedFixture.plugin_wide.event;
    yield {
      ID: String(event.id), Type: String(event.type), Status: String(event.status), Summary: String(event.summary),
      Payload: event.payload as Record<string, unknown>, CreatedAt: String(event.created_at),
    };
  }
}

test("shared fixture routes plugin-wide watcher events and history cancellation", async () => {
  const input = new Readable({ read() {} });
  let output = "";
  const writable = new Writable({
    write(chunk, _enc, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const server = createStdioServer(new PluginWideFixtureAdapter(), input, writable);
  const running = server.run();
  input.push(JSON.stringify(sharedFixture.plugin_wide) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 10));
  input.push(JSON.stringify(sharedFixture.history_cancel) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 10));
  input.push(null);
  await running;
  const lines = output.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  const event = lines.find((line) => line.event === "plugin.event");
  assert.ok(event, `expected plugin-wide event in ${output}`);
  assert.equal((event?.payload as Record<string, unknown>).subscription_id, "wide-1");
  assert.equal((((event?.payload as Record<string, unknown>).event as Record<string, unknown>).type), "desktop.session.changed");
  const cancel = lines.find((line) => line.id === "fixture-history-cancel");
  assert.equal((cancel?.payload as Record<string, unknown>).ok, true);
});

test("draft control preserves opaque snake_case target fields", async () => {
  const adapter = new DraftControlAdapter();
  const out = await runRoundTrip(JSON.stringify({
    id: "req-draft-control",
    method: "adapter.controlDraft",
    params: {
      draft_id: "draft-1",
      plugin_id: "codex",
      action: "model.switch",
      target: { option_id: "5.5" },
      metadata: { request_id: "request-1" },
    },
  }) + "\n", adapter);

  assert.equal(adapter.draftControlRequest?.DraftID, "draft-1");
  assert.equal(adapter.draftControlRequest?.Action, "model.switch");
  assert.deepEqual(adapter.draftControlRequest?.Target, { option_id: "5.5" });
  assert.deepEqual(adapter.draftControlRequest?.Metadata, { request_id: "request-1" });
  const payload = JSON.parse(out.trim()).payload as Record<string, unknown>;
  assert.equal(payload.draft_id, "draft-1");
});

test("read status returns only direct snake status fields", async () => {
  const out = await runRoundTrip(JSON.stringify({
    id: "req-status",
    method: "adapter.readStatus",
    params: { session: { plugin_id: "stub", native_session_id: "session-1", native_thread_id: "thread-1", visible: true }, run_id: "run-1" },
  }) + "\n", new ControlStatusAdapter());
  const payload = JSON.parse(out.trim()).payload as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), ["approval_blocked", "completed_at", "context", "duration_ms", "interruptible", "model", "phase", "preview", "primary_action", "reasoning_mode", "started_at", "status", "steps", "turn_id"]);
  assert.equal(payload.reasoning_mode && (payload.reasoning_mode as { id: string }).id, "high");
  assert.ok(!("ReasoningMode" in payload));
});

test("history stream acknowledges then emits snake_case turn events", async () => {
  const input = new Readable({ read() {} });
  let output = "";
  const writable = new Writable({
    write(chunk, _enc, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const server = createStdioServer(new HistoryStreamAdapter(), input, writable);
  const running = server.run();
  input.push(JSON.stringify({
    id: "history-1",
    method: "adapter.readHistoryStream",
    params: { session: { plugin_id: "stub", native_session_id: "s", visible: true }, request: { stream_id: "body-1", limit: 21, live: false } },
  }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 10));
  input.push(null);
  await running;
  const lines = output.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal((lines[0] as { id: string }).id, "history-1");
  assert.equal(((lines[0].payload as Record<string, unknown>).stream_id), "body-1");
  const event = lines.find((line) => line.event === "history.stream");
  assert.ok(event, `expected history event in ${output}`);
  const payload = event?.payload as Record<string, unknown>;
  assert.equal(payload.stream_id, "body-1");
  assert.equal(payload.type, "turn");
  assert.equal(((payload.turn as Record<string, unknown>).turn_id), "turn-1");
  const messages = (payload.turn as Record<string, unknown>).messages as Record<string, unknown>[];
  const progress = messages[1].progress as Record<string, unknown>;
  assert.equal(messages[1].type, "progress");
  assert.equal(progress.status, "running");
  assert.equal((progress.steps as Record<string, unknown>[])[0].created_at, "2026-07-28T00:00:01Z");
  assert.equal((progress.steps as Record<string, unknown>[])[0].call_id, "call-1");
});

test("unknown method returns error", async () => {
  const out = await runRoundTrip(JSON.stringify({ id: "req-2", method: "adapter.bogus", params: {} }) + "\n");
  const resp = JSON.parse(out.trim()) as RpcResponse;
  assert.equal(resp.id, "req-2");
  assert.equal(resp.ok, false);
  assert.equal(resp.error?.code, "unknown_method");
});

test("waitForRun preserves the adapter instance", async () => {
  const out = await runRoundTrip(JSON.stringify({
    id: "wait-1",
    method: "adapter.waitForRun",
    params: {
      session: { plugin_id: "stub", native_session_id: "session-1", native_thread_id: "", surface: "test", endpoint: "", cwd: "", visible: false },
      run_id: "run-1",
    },
  }) + "\n", new WaitRunAdapter());
  const resp = JSON.parse(out.trim()) as RpcResponse;
  assert.equal(resp.ok, true);
  assert.equal((resp.payload as Record<string, unknown>).id, "bound:session-1:run-1");
});

test("PascalCase request is rejected", async () => {
  const out = await runRoundTrip(JSON.stringify({
    id: "req-legacy",
    method: "adapter.attachSession",
    params: { NativeSessionID: "s" },
  }) + "\n");
  const resp = JSON.parse(out.trim()) as RpcResponse;
  assert.equal(resp.ok, false);
  assert.equal(resp.error?.code, "adapter_error");
  assert.match(resp.error?.message ?? "", /snake_case/);
});

test("capability wire field names are snake_case", () => {
  const cap: Capability = {
    PluginID: "x", Available: true, NativeVisibleInput: true, NativeVisibleOutput: true,
    CanAttachSession: true, CanStartSessionWithMessage: true,
    CanListSessions: true, CanReadHistory: true,
    CanInterrupt: true, CanApproval: true, CanForwardSync: true, CanReverseSync: true, CanWaitRun: false,
    CanReadStatus: false, CanControlSession: false,
    IntegrationMode: "desktop-automation", VisibilitySurface: "gw", UnavailableReason: "",
  };
  const json = JSON.parse(JSON.stringify(cap)) as Record<string, unknown>;
  const wire = Object.fromEntries(Object.entries(json).map(([key, value]) => [key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase(), value])) as Record<string, unknown>;
  for (const key of ["plugin_id", "available", "native_visible_input", "native_visible_output", "can_list_sessions", "can_read_history", "can_reverse_sync", "can_read_status", "can_control_session", "integration_mode", "visibility_surface", "unavailable_reason"]) {
    assert.ok(key in wire, `expected snake_case key ${key} in wire capability`);
  }
});
