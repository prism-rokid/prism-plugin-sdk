/**
 * @rokid/pluginbridge-plugin-sdk — stdio server core.
 *
 * Reads JSON-over-newline-stdio requests from stdin, dispatches them to the
 * wrapped PluginAdapter, and writes responses/events to stdout. Plugin authors
 * call `serve(adapter)` from their entry point and implement only the adapter.
 */
import * as readline from "readline";
import { randomUUID } from "crypto";
import type {
  PluginAdapter,
  PluginEvent,
  ApprovalResolutionRequest,
  AttachSessionRequest,
  ControlSessionRequest,
  NativeSession,
  HistoryStreamRequest,
  HistoryStreamEvent,
  RpcEvent,
  RpcRequest,
  RpcResponse,
  StartSessionWithMessageRequest,
  DraftOpenRequest,
  DraftControlRequest,
  StartDraftWithMessageRequest,
} from "./types.js";
import { PROTOCOL_VERSION } from "./types.js";

/**
 * Verify the protocol version the Hub expects (passed via the
 * PRISM_PLUGIN_PROTOCOL_VERSION env var) matches this SDK. A mismatch
 * means Hub and plugin speak different on-wire schemas; fail fast rather than
 * silently decode fields under the wrong names. Absent env (standalone/debug)
 * is allowed.
 */
export function checkProtocolVersion(): void {
  const got = (process.env.PRISM_PLUGIN_PROTOCOL_VERSION ?? "").trim();
  if (got === "" || got === PROTOCOL_VERSION) {
    return;
  }
  throw new Error(
    `pluginbridge plugin protocol version mismatch: hub sent ${got}, SDK implements ${PROTOCOL_VERSION}`,
  );
}

/** Convenience entry point: serve an adapter on process.stdin/stdout. */
export function serve(adapter: PluginAdapter): Promise<void> {
  return createStdioServer(adapter, process.stdin, process.stdout).run();
}

export interface StdioServerOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

function snakeCaseKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase();
}

function pascalCaseKey(key: string): string {
  const acronyms: Record<string, string> = { id: "ID", url: "URL", uri: "URI", pid: "PID", ms: "MS", api: "API", cwd: "Cwd" };
  return key.split("_").map((part) => acronyms[part] ?? (part ? part[0].toUpperCase() + part.slice(1) : "")).join("");
}

function toWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toWire);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [snakeCaseKey(key), toWire(item)]));
  }
  return value;
}

function fromWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromWire);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (key !== snakeCaseKey(key)) throw new Error(`pluginbridge v4 requires snake_case wire field ${key}`);
      return [pascalCaseKey(key), fromWire(item)];
    }));
  }
  return value;
}

export function createStdioServer(
  adapter: PluginAdapter,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
) {
  const subscriptions = new Map<string, AbortController>();
  const historyStreams = new Map<string, AbortController>();
  let outputFailure: Error | null = null;
  let closePromise: Promise<void> | null = null;

  function closeAdapter(): Promise<void> {
    if (!closePromise) {
      closePromise = Promise.resolve(adapter.close()).catch(() => {});
    }
    return closePromise;
  }

  output.on("error", (error) => {
    outputFailure = error instanceof Error ? error : new Error(String(error));
    for (const controller of subscriptions.values()) controller.abort();
    for (const controller of historyStreams.values()) controller.abort();
  });

  function send(obj: unknown): void {
    if (outputFailure) throw outputFailure;
    output.write(JSON.stringify(toWire(obj)) + "\n");
  }

  function sendResponse(id: string, ok: boolean, payload?: unknown, error?: RpcResponse["error"]): void {
    const resp: RpcResponse = { id, ok };
    if (ok) resp.payload = payload;
    else if (error) resp.error = error;
    send(resp);
  }

  function sendEvent(subscriptionId: string, event: PluginEvent): void {
    const evt: RpcEvent = {
      event: "plugin.event",
      payload: { subscription_id: subscriptionId, event },
    };
    send(evt);
  }

  function sendHistoryEvent(event: HistoryStreamEvent): void {
    send({ event: "history.stream", payload: event });
  }

  async function handle(req: RpcRequest): Promise<void> {
    try {
      const wireParams = (req.params ?? {}) as Record<string, unknown>;
      const params = fromWire(wireParams) as Record<string, unknown>;
      switch (req.method) {
        case "adapter.probe":
          sendResponse(req.id, true, await adapter.probe());
          break;
        case "adapter.discover":
          sendResponse(req.id, true, await adapter.discover());
          break;
        case "adapter.startSessionWithMessage": {
          if (typeof adapter.startSessionWithMessage !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement startSessionWithMessage" });
            break;
          }
          const r = params as unknown as StartSessionWithMessageRequest;
          sendResponse(req.id, true, await adapter.startSessionWithMessage(r));
          break;
        }
        case "adapter.openDraft": {
          if (typeof adapter.openDraft !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement openDraft" });
            break;
          }
          sendResponse(req.id, true, await adapter.openDraft(params as unknown as DraftOpenRequest));
          break;
        }
        case "adapter.controlDraft": {
          if (typeof adapter.controlDraft !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement controlDraft" });
            break;
          }
          // Target and metadata are extensible Plugin contracts. Preserve their
          // snake_case wire keys instead of recursively converting option_id
          // to OptionID before the adapter can consume the opaque target.
          const r: DraftControlRequest = {
            DraftID: params.DraftID as string,
            PluginID: params.PluginID as string,
            Action: params.Action as string,
            Target: wireParams.target,
            Name: (params.Name as string) || "",
            Metadata: (wireParams.metadata as Record<string, string>) || {},
          };
          sendResponse(req.id, true, await adapter.controlDraft(r));
          break;
        }
        case "adapter.startDraftWithMessage": {
          if (typeof adapter.startDraftWithMessage !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement startDraftWithMessage" });
            break;
          }
          sendResponse(req.id, true, await adapter.startDraftWithMessage(params as unknown as StartDraftWithMessageRequest));
          break;
        }
        case "adapter.listSessions": {
          if (typeof adapter.listSessions !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement listSessions" });
            break;
          }
          sendResponse(req.id, true, await adapter.listSessions());
          break;
        }
        case "adapter.attachSession": {
          if (typeof adapter.attachSession !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement attachSession" });
            break;
          }
          const r = params as unknown as AttachSessionRequest;
          sendResponse(req.id, true, await adapter.attachSession(r));
          break;
        }
        case "adapter.readHistory": {
          if (typeof adapter.readHistory !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement readHistory" });
            break;
          }
          const session = params.Session as NativeSession;
          sendResponse(req.id, true, await adapter.readHistory(session, Number(params.Limit ?? 0)));
          break;
        }
        case "adapter.readDetail": {
          if (typeof adapter.readDetail !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement readDetail" });
            break;
          }
          const session = params.Session as NativeSession;
          sendResponse(req.id, true, await adapter.readDetail(session));
          break;
        }
        case "adapter.readHistoryStream": {
          if (typeof adapter.readHistoryStream !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement readHistoryStream" });
            break;
          }
          const session = params.Session as NativeSession;
          const rawRequest = (wireParams.request ?? {}) as Record<string, unknown>;
          const request: HistoryStreamRequest = {
            stream_id: String(rawRequest.stream_id ?? randomUUID()),
            limit: Number(rawRequest.limit ?? 0),
            live: rawRequest.live === true,
          };
          const controller = new AbortController();
          historyStreams.set(request.stream_id, controller);
          sendResponse(req.id, true, { stream_id: request.stream_id });
          pumpHistory(request, session, controller.signal).catch(() => {});
          break;
        }
        case "adapter.cancelHistoryStream": {
          const streamID = String(wireParams.stream_id ?? "");
          historyStreams.get(streamID)?.abort();
          historyStreams.delete(streamID);
          sendResponse(req.id, true, { ok: true });
          break;
        }
        case "adapter.resolveApproval": {
          const resolve = (adapter as { resolveApproval?: (r: ApprovalResolutionRequest) => unknown }).resolveApproval;
          if (typeof resolve !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement resolveApproval" });
            break;
          }
          const r = params as unknown as ApprovalResolutionRequest;
          await resolve(r);
          sendResponse(req.id, true, { ok: true });
          break;
        }
        case "adapter.readStatus": {
          const read = adapter.readStatus;
          if (typeof read !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement readStatus" });
            break;
          }
          const session = params.Session as NativeSession;
          const runID = (params.RunID as string) || "";
          sendResponse(req.id, true, await read(session, runID));
          break;
        }
        case "adapter.controlSession": {
          const control = adapter.controlSession;
          if (typeof control !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement controlSession" });
            break;
          }
          const r: ControlSessionRequest = {
            session: params.Session as NativeSession,
            action: (params.Action as string) || "",
            // target and metadata are extensible Plugin contracts. They must
            // retain their snake_case wire keys rather than becoming PascalCase.
            target: wireParams.target,
            name: (params.Name as string) || "",
            metadata: (wireParams.metadata as Record<string, unknown>) || {},
          };
          sendResponse(req.id, true, await control.call(adapter, r));
          break;
        }
        case "adapter.openManagedTerminal": {
          const open = adapter.openManagedTerminal;
          if (typeof open !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement openManagedTerminal" });
            break;
          }
          sendResponse(req.id, true, await open.call(adapter, {
            plugin_id: (params.PluginID as string) || "",
            cwd: (params.Cwd as string) || "",
          }));
          break;
        }
        case "adapter.send": {
          const session = params.Session as NativeSession;
          const message = params.Message as Parameters<PluginAdapter["send"]>[1];
          sendResponse(req.id, true, await adapter.send(session, message));
          break;
        }
        case "adapter.subscribe": {
          const subscriptionId = (params.SubscriptionID as string) || randomUUID();
          const session = params.Session as NativeSession;
          const controller = new AbortController();
          subscriptions.set(subscriptionId, controller);
          sendResponse(req.id, true, { subscribed: true, subscription_id: subscriptionId });
          pumpEvents(subscriptionId, session, controller.signal).catch(() => {});
          break;
        }
        case "adapter.subscribePlugin": {
          if (typeof adapter.subscribePlugin !== "function") {
            throw new Error("adapter does not implement subscribePlugin");
          }
          const subscriptionId = (params.SubscriptionID as string) || randomUUID();
          const controller = new AbortController();
          subscriptions.set(subscriptionId, controller);
          sendResponse(req.id, true, { subscribed: true, subscription_id: subscriptionId });
          pumpPluginEvents(subscriptionId, controller.signal).catch(() => {});
          break;
        }
        case "adapter.readAgentUsage": {
          const read = adapter.readAgentUsage;
          if (typeof read !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement readAgentUsage" });
            break;
          }
          sendResponse(req.id, true, await read.call(adapter));
          break;
        }
        case "adapter.unsubscribe": {
          const subscriptionId = params.SubscriptionID as string;
          subscriptions.get(subscriptionId)?.abort();
          subscriptions.delete(subscriptionId);
          sendResponse(req.id, true, { ok: true });
          break;
        }
        case "adapter.interrupt": {
          const session = params.Session as NativeSession;
          const taskID = params.TaskID as string;
          await adapter.interrupt(session, taskID);
          sendResponse(req.id, true, { ok: true });
          break;
        }
        case "adapter.verifyVisibility": {
          const session = params.Session as NativeSession;
          const marker = params.Marker as string;
          sendResponse(req.id, true, await adapter.verifyVisibility(session, marker));
          break;
        }
        case "adapter.waitForRun": {
          const wait = (adapter as { waitForRun?: (s: NativeSession, r: string) => unknown }).waitForRun;
          if (typeof wait !== "function") {
            sendResponse(req.id, false, undefined, { code: "not_implemented", message: "adapter does not implement waitForRun" });
            break;
          }
          const session = params.Session as NativeSession;
          const runID = params.RunID as string;
          // `waitForRun` is normally an adapter instance method and relies on
          // its session map. Calling the extracted function loses `this` and
          // turns every asynchronous run into a false failure.
          sendResponse(req.id, true, await wait.call(adapter, session, runID));
          break;
        }
        case "adapter.close":
          for (const ctrl of subscriptions.values()) ctrl.abort();
          subscriptions.clear();
          for (const ctrl of historyStreams.values()) ctrl.abort();
          historyStreams.clear();
          await closeAdapter();
          sendResponse(req.id, true, { ok: true });
          break;
        default:
          sendResponse(req.id, false, undefined, { code: "unknown_method", message: `unknown adapter method ${req.method}` });
      }
    } catch (err) {
      sendResponse(req.id, false, undefined, {
        code: "adapter_error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function pumpEvents(subscriptionId: string, session: NativeSession, signal: AbortSignal): Promise<void> {
    try {
      const iter = await adapter.subscribe(session, signal);
      for await (const event of iter) {
        if (signal.aborted) break;
        if (!event.CreatedAt) event.CreatedAt = new Date().toISOString();
        sendEvent(subscriptionId, event);
      }
    } catch {
      /* subscription stream ended */
    } finally {
      subscriptions.delete(subscriptionId);
    }
  }

  async function pumpPluginEvents(subscriptionId: string, signal: AbortSignal): Promise<void> {
    if (typeof adapter.subscribePlugin !== "function") return;
    const iter = await adapter.subscribePlugin(signal);
    try {
      for await (const event of iter) {
        if (signal.aborted) break;
        sendEvent(subscriptionId, event);
      }
    } finally {
      subscriptions.delete(subscriptionId);
    }
  }

  async function pumpHistory(request: HistoryStreamRequest, session: NativeSession, signal: AbortSignal): Promise<void> {
    if (typeof adapter.readHistoryStream !== "function") return;
    try {
      const iter = await adapter.readHistoryStream(session, request, signal);
      for await (const event of iter) {
        if (signal.aborted) break;
        sendHistoryEvent({ ...event, stream_id: request.stream_id });
        if (event.type === "end" || event.type === "error") break;
      }
    } catch (err) {
      if (!signal.aborted) {
        try {
          sendHistoryEvent({ stream_id: request.stream_id, type: "error", error: err instanceof Error ? err.message : String(err) });
        } catch {
          // stdout is gone; finally below tears down this pump.
        }
      }
    } finally {
      historyStreams.delete(request.stream_id);
    }
  }

  return {
    async run(): Promise<void> {
      checkProtocolVersion();
      const rl = readline.createInterface({ input, crlfDelay: Infinity });
      const pending = new Set<Promise<void>>();
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let req: RpcRequest;
        try {
          req = JSON.parse(trimmed);
        } catch {
          continue; // ignore malformed lines
        }
        // Handle each request concurrently so slow adapter calls don't block others.
        const request = handle(req).catch(() => {});
        pending.add(request);
        void request.finally(() => pending.delete(request));
      }
      await Promise.allSettled(Array.from(pending));
      for (const ctrl of subscriptions.values()) ctrl.abort();
      subscriptions.clear();
      for (const ctrl of historyStreams.values()) ctrl.abort();
      historyStreams.clear();
      await closeAdapter();
    },
  };
}
