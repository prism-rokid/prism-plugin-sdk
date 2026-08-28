"use strict";

const DEFAULT_ACTION_TIMEOUT_MS = 8000;
const DEFAULT_COMMAND_TIMEOUT_MS = 8000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}

function extensionForMimeType(mimeType = "") {
  switch (String(mimeType || "").toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/heic":
      return ".heic";
    default:
      return ".bin";
  }
}

function parseDataUri(dataUri = "", defaultName = "attachment") {
  const value = String(dataUri || "").trim();
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(value);
  if (!match) {
    throw new Error("invalid data URI");
  }
  const mimeType = firstNonEmpty(match[1], "application/octet-stream").toLowerCase();
  return {
    mimeType,
    base64: match[2],
    name: `${defaultName}${extensionForMimeType(mimeType)}`,
  };
}

function modifiersMask(modifiers = []) {
  let mask = 0;
  for (const mod of modifiers) {
    switch (String(mod).toLowerCase()) {
      case "alt":
      case "option":
        mask |= 1;
        break;
      case "control":
      case "ctrl":
        mask |= 2;
        break;
      case "command":
      case "meta":
        mask |= 4;
        break;
      case "shift":
        mask |= 8;
        break;
      default:
        break;
    }
  }
  return mask;
}

function keyDefinition(key = "") {
  const raw = String(key || "");
  const upper = raw.length === 1 ? raw.toUpperCase() : raw;
  if (/^[A-Z]$/.test(upper)) {
    return {
      key: upper,
      code: `Key${upper}`,
      text: upper.toLowerCase(),
      windowsVirtualKeyCode: upper.charCodeAt(0),
    };
  }
  if (/^[0-9]$/.test(raw)) {
    return {
      key: raw,
      code: `Digit${raw}`,
      text: raw,
      windowsVirtualKeyCode: raw.charCodeAt(0),
    };
  }
  switch (raw.toLowerCase()) {
    case "enter":
      return { key: "Enter", code: "Enter", text: "", windowsVirtualKeyCode: 13 };
    case "escape":
    case "esc":
      return { key: "Escape", code: "Escape", text: "", windowsVirtualKeyCode: 27 };
    case "backspace":
      return { key: "Backspace", code: "Backspace", text: "", windowsVirtualKeyCode: 8 };
    case "period":
    case ".":
      return { key: ".", code: "Period", text: ".", windowsVirtualKeyCode: 190 };
    case "space":
      return { key: " ", code: "Space", text: " ", windowsVirtualKeyCode: 32 };
    default:
      throw new Error(`unsupported CDP key: ${raw || "unknown"}`);
  }
}

function visiblePointScript(elementExpr) {
  return `(() => {
    const target = (${elementExpr});
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height
    };
  })()`;
}

function visibleElementScript(elementExpr) {
  return `(() => {
    const target = (${elementExpr});
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  })()`;
}

class CdpPageClient {
  constructor(options = {}) {
    this.options = options;
    this.ws = null;
    this.connected = false;
    this.messageSeq = 0;
    this.pending = new Map();
  }

  async connectToPage(webSocketDebuggerUrl, enableDomains = ["Runtime.enable", "DOM.enable", "Page.enable"]) {
    await this.openWebSocket(webSocketDebuggerUrl);
    for (const method of enableDomains) {
      await this.send(method);
    }
    this.connected = true;
    return this;
  }

  async close() {
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    if (ws && typeof ws.close === "function") {
      try {
        ws.close();
      } catch {}
    }
    for (const entry of this.pending.values()) {
      entry.reject(new Error("CDP connection closed"));
    }
    this.pending.clear();
  }

  async openWebSocket(url) {
    const WebSocketCtor = globalThis.WebSocket;
    if (!WebSocketCtor) {
      throw new Error("当前 Node 运行时没有 WebSocket，CDP 控制至少需要 Node.js 22。");
    }
    const ws = new WebSocketCtor(url);
    this.ws = ws;
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) {
        return;
      }
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(`CDP ${entry.method} failed: ${message.error.message || "request failed"}`));
      } else {
        entry.resolve(message.result);
      }
    };
    ws.onclose = () => {
      // A delayed close event from a replaced socket must not tear down the
      // active connection or reject its requests.
      if (this.ws !== ws) {
        return;
      }
      this.ws = null;
      for (const entry of this.pending.values()) {
        entry.reject(new Error("CDP connection closed"));
      }
      this.pending.clear();
      this.connected = false;
    };
    const timeoutMs = this.options.commandTimeoutMs || DEFAULT_COMMAND_TIMEOUT_MS;
    await new Promise((resolve, reject) => {
      let opened = false;
      const timer = setTimeout(() => {
        void this.close();
        reject(new Error(`CDP WebSocket open timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      ws.onopen = () => {
        opened = true;
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = (error) => {
        clearTimeout(timer);
        if (!opened) {
          reject(error);
          return;
        }
        void this.close();
      };
    });
  }

  async send(method, params = {}) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) {
      throw new Error("CDP socket is not open");
    }
    const id = ++this.messageSeq;
    const timeoutMs = this.options.commandTimeoutMs || DEFAULT_COMMAND_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        void this.close();
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        method,
      });
      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`CDP ${method} send failed: ${error && error.message ? error.message : String(error)}`));
      }
    });
  }

  async evaluate(expression, opts = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: opts.awaitPromise !== false,
      returnByValue: opts.returnByValue !== false,
    });
    if (result && result.exceptionDetails) {
      const details = result.exceptionDetails;
      const description = firstNonEmpty(
        details.exception && details.exception.description,
        details.exception && details.exception.value,
        details.text,
        "unknown page exception",
      );
      throw new Error(`CDP Runtime.evaluate failed: ${description}`);
    }
    if (!result || !result.result) {
      throw new Error("CDP Runtime.evaluate returned no result");
    }
    return opts.returnByValue === false ? result.result : result.result.value;
  }

  async waitFor(expression, timeoutMs = this.options.actionTimeoutMs || DEFAULT_ACTION_TIMEOUT_MS, intervalMs = 120) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ready = await this.evaluate(expression);
      if (ready) return true;
      await sleep(intervalMs);
    }
    throw new Error("CDP wait timed out");
  }

  async clickPoint(point) {
    if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
      throw new Error("CDP click point required");
    }
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 0,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
  }

  async clickElement(elementExpr) {
    const point = await this.evaluate(visiblePointScript(elementExpr));
    if (!point) {
      throw new Error("CDP target element not found");
    }
    await this.clickPoint(point);
  }

  async keyPress(key, modifiers = []) {
    const def = keyDefinition(key);
    const mask = modifiersMask(modifiers);
    await this.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.windowsVirtualKeyCode,
      nativeVirtualKeyCode: def.windowsVirtualKeyCode,
      modifiers: mask,
    });
    if (!mask && def.text) {
      await this.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: def.key,
        code: def.code,
        text: mask ? "" : def.text,
        unmodifiedText: def.text,
        windowsVirtualKeyCode: def.windowsVirtualKeyCode,
        nativeVirtualKeyCode: def.windowsVirtualKeyCode,
        modifiers: mask,
      });
    }
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.windowsVirtualKeyCode,
      nativeVirtualKeyCode: def.windowsVirtualKeyCode,
      modifiers: mask,
    });
  }

  async insertText(text) {
    if (!text) return;
    await this.send("Input.insertText", { text: String(text) });
  }
}

module.exports = {
  CdpPageClient,
  DEFAULT_ACTION_TIMEOUT_MS,
  firstNonEmpty,
  parseDataUri,
  sleep,
  visibleElementScript,
  visiblePointScript,
};
