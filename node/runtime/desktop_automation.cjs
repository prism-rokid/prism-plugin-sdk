"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const crypto = require("crypto");

const execFileAsync = promisify(execFile);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function platformName() {
  return process.platform;
}

function isMac() {
  return process.platform === "darwin";
}

function isWindows() {
  return process.platform === "win32";
}

function isLinux() {
  return process.platform === "linux";
}

function appSpecTitle(spec = {}) {
  return String(
    spec.windowTitle ||
    spec.macAppName ||
    spec.windowsWindowTitle ||
    spec.linuxWindowTitle ||
    spec.appName ||
    "",
  ).trim();
}

function asAppleScriptString(value) {
  return JSON.stringify(String(value));
}

async function runPowerShell(script, args = [], opts = {}) {
  return execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script, ...args],
    {
      timeout: opts.timeout || 15000,
      maxBuffer: opts.maxBuffer || 4 * 1024 * 1024,
      cwd: opts.cwd || undefined,
      env: process.env,
    },
  );
}

async function commandExists(command) {
  if (!command) return false;
  if (isWindows()) {
    try {
      await execFileAsync("where.exe", [command], {
        timeout: 3000,
        maxBuffer: 256 * 1024,
      });
      return true;
    } catch {
      return false;
    }
  }
  try {
    await execFileAsync("/bin/sh", ["-lc", `command -v ${shellEscape(command)} >/dev/null 2>&1`], {
      timeout: 3000,
      maxBuffer: 256 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

function shellEscape(value) {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

async function openExternal(target) {
  const normalized = String(target || "").trim();
  if (!normalized) {
    throw new Error("openExternal target required");
  }
  if (isMac()) {
    await execFileAsync("/usr/bin/open", [normalized], { timeout: 15000 });
    return;
  }
  if (isWindows()) {
    await runPowerShell("Start-Process -FilePath $args[0]", [normalized], { timeout: 15000 });
    return;
  }
  if (isLinux()) {
    await execFileAsync("xdg-open", [normalized], { timeout: 15000, maxBuffer: 256 * 1024 });
    return;
  }
  throw new Error(`unsupported desktop automation platform: ${platformName()}`);
}

async function openApplication(spec = {}) {
  if (isMac()) {
    if (spec.macBundleId) {
      await execFileAsync("/usr/bin/open", ["-b", String(spec.macBundleId)], { timeout: 15000 });
      return;
    }
    if (spec.macAppName) {
      await execFileAsync("/usr/bin/open", ["-a", String(spec.macAppName)], { timeout: 15000 });
      return;
    }
    if (spec.macAppPath) {
      await execFileAsync("/usr/bin/open", [String(spec.macAppPath)], { timeout: 15000 });
      return;
    }
    throw new Error("mac desktop automation target missing bundle id / app name / app path");
  }
  if (isWindows()) {
    const executable = String(spec.windowsExecutable || "").trim();
    if (!executable) {
      throw new Error("windows desktop automation target missing executable path");
    }
    await runPowerShell("Start-Process -FilePath $args[0]", [executable], { timeout: 15000 });
    return;
  }
  if (isLinux()) {
    const command = String(spec.linuxCommand || "").trim();
    if (!command) {
      throw new Error("linux desktop automation target missing command");
    }
    await execFileAsync("/bin/sh", ["-lc", command], { timeout: 15000, maxBuffer: 1024 * 1024 });
    return;
  }
  throw new Error(`unsupported desktop automation platform: ${platformName()}`);
}

async function activateApplication(spec = {}) {
  const title = appSpecTitle(spec);
  if (isMac()) {
    if (spec.macBundleId) {
      await execFileAsync("/usr/bin/osascript", ["-e", `tell application id ${asAppleScriptString(spec.macBundleId)} to activate`], {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      return;
    }
    if (spec.macAppName || title) {
      await execFileAsync("/usr/bin/osascript", ["-e", `tell application ${asAppleScriptString(spec.macAppName || title)} to activate`], {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      return;
    }
    throw new Error("mac desktop automation target missing app name");
  }
  if (isWindows()) {
    if (!title) {
      throw new Error("windows desktop automation target missing window title");
    }
    await runPowerShell(
      "$wshell = New-Object -ComObject WScript.Shell; if (-not $wshell.AppActivate($args[0])) { throw \"window not found\" }",
      [title],
      { timeout: 15000 },
    );
    return;
  }
  if (isLinux()) {
    if (title) {
      if (await commandExists("xdotool")) {
        await execFileAsync("xdotool", ["search", "--name", title, "windowactivate", "--sync"], {
          timeout: 15000,
          maxBuffer: 1024 * 1024,
        });
        return;
      }
      if (await commandExists("wmctrl")) {
        await execFileAsync("wmctrl", ["-a", title], {
          timeout: 15000,
          maxBuffer: 1024 * 1024,
        });
        return;
      }
      throw new Error("linux desktop automation requires xdotool or wmctrl to activate a window");
    }
    throw new Error("linux desktop automation target missing window title");
  }
  throw new Error(`unsupported desktop automation platform: ${platformName()}`);
}

async function bestEffortOpenAndActivate(spec = {}, settleMs = 200) {
  await openApplication(spec).catch(() => {});
  await sleep(settleMs);
  await activateApplication(spec);
}

async function setClipboardText(text) {
  const value = String(text || "");
  if (isMac()) {
    const filePath = path.join(os.tmpdir(), `prism-clipboard-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.txt`);
    fs.writeFileSync(filePath, value, "utf8");
    try {
      await execFileAsync("/usr/bin/osascript", [
        "-e",
        `set the clipboard to (read (POSIX file ${asAppleScriptString(filePath)}) as «class utf8»)`
      ], {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
    } finally {
      fs.rmSync(filePath, { force: true });
    }
    return;
  }
  if (isWindows()) {
    const filePath = path.join(os.tmpdir(), `prism-clipboard-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.txt`);
    fs.writeFileSync(filePath, value, "utf8");
    try {
      await runPowerShell("Get-Content -Raw -LiteralPath $args[0] | Set-Clipboard", [filePath], {
        timeout: 15000,
      });
    } finally {
      fs.rmSync(filePath, { force: true });
    }
    return;
  }
  if (isLinux()) {
    const filePath = path.join(os.tmpdir(), `prism-clipboard-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.txt`);
    fs.writeFileSync(filePath, value, "utf8");
    if (await commandExists("wl-copy")) {
      try {
        await execFileAsync("/bin/sh", ["-lc", `cat ${shellEscape(filePath)} | wl-copy`], {
          timeout: 15000,
          maxBuffer: 1024 * 1024,
        });
        return;
      } finally {
        fs.rmSync(filePath, { force: true });
      }
    }
    if (await commandExists("xclip")) {
      try {
        await execFileAsync("/bin/sh", ["-lc", `cat ${shellEscape(filePath)} | xclip -selection clipboard`], {
          timeout: 15000,
          maxBuffer: 1024 * 1024,
        });
        return;
      } finally {
        fs.rmSync(filePath, { force: true });
      }
    }
    if (await commandExists("xsel")) {
      try {
        await execFileAsync("/bin/sh", ["-lc", `cat ${shellEscape(filePath)} | xsel --clipboard --input`], {
          timeout: 15000,
          maxBuffer: 1024 * 1024,
        });
        return;
      } finally {
        fs.rmSync(filePath, { force: true });
      }
    }
    fs.rmSync(filePath, { force: true });
    throw new Error("linux desktop automation requires wl-copy, xclip, or xsel for clipboard support");
  }
  throw new Error(`unsupported desktop automation platform: ${platformName()}`);
}

function normalizeShortcutKey(key) {
  const normalized = String(key || "").trim();
  if (!normalized) {
    throw new Error("shortcut key required");
  }
  return normalized;
}

function windowsSendKeys(key, modifiers = []) {
  const normalizedKey = normalizeShortcutKey(key).toLowerCase();
  const normalizedModifiers = modifiers.map((item) => String(item || "").trim().toLowerCase());
  const modifierPrefix = normalizedModifiers.map((item) => {
    if (item === "command" || item === "cmd" || item === "control" || item === "ctrl") return "^";
    if (item === "shift") return "+";
    if (item === "option" || item === "alt") return "%";
    return "";
  }).join("");
  const specialKeys = {
    enter: "~",
    return: "~",
    escape: "{ESC}",
    esc: "{ESC}",
    tab: "{TAB}",
    up: "{UP}",
    down: "{DOWN}",
    left: "{LEFT}",
    right: "{RIGHT}",
    delete: "{DEL}",
    backspace: "{BACKSPACE}",
    space: " ",
  };
  const body = specialKeys[normalizedKey] || key;
  return `${modifierPrefix}${body}`;
}

function linuxShortcut(key, modifiers = []) {
  const normalizedKey = normalizeShortcutKey(key).toLowerCase();
  const normalizedModifiers = modifiers.map((item) => String(item || "").trim().toLowerCase());
  const mapped = normalizedModifiers.map((item) => {
    if (item === "command" || item === "cmd") return "ctrl";
    if (item === "control" || item === "ctrl") return "ctrl";
    if (item === "option" || item === "alt") return "alt";
    return item;
  }).filter(Boolean);
  const specialKeys = {
    enter: "Return",
    return: "Return",
    escape: "Escape",
    esc: "Escape",
    space: "space",
  };
  return [...mapped, specialKeys[normalizedKey] || key].join("+");
}

async function sendShortcut(key, modifiers = []) {
  const normalizedKey = normalizeShortcutKey(key);
  if (isMac()) {
    const specialKeyCodes = {
      enter: 36,
      return: 36,
      escape: 53,
      esc: 53,
      tab: 48,
      space: 49,
      up: 126,
      down: 125,
      left: 123,
      right: 124,
      delete: 51,
      backspace: 51,
    };
    const normalizedModifiers = modifiers
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    const specialKeyCode = specialKeyCodes[normalizedKey.toLowerCase()];
    if (specialKeyCode) {
      const modifierExpr = normalizedModifiers.length
        ? ` using {${normalizedModifiers.map((item) => `${item} down`).join(", ")}}`
        : "";
      await execFileAsync("/usr/bin/osascript", [
        "-e",
        `tell application "System Events" to key code ${specialKeyCode}${modifierExpr}`,
      ], {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      return;
    }
    const modifierExpr = normalizedModifiers.length
      ? ` using {${normalizedModifiers.map((item) => `${item} down`).join(", ")}}`
      : "";
    await execFileAsync("/usr/bin/osascript", [
      "-e",
      `tell application "System Events" to keystroke ${asAppleScriptString(normalizedKey)}${modifierExpr}`,
    ], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    return;
  }
  if (isWindows()) {
    await runPowerShell(
      "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys($args[0])",
      [windowsSendKeys(normalizedKey, modifiers)],
      { timeout: 15000 },
    );
    return;
  }
  if (isLinux()) {
    if (!(await commandExists("xdotool"))) {
      throw new Error("linux desktop automation requires xdotool for keyboard input");
    }
    await execFileAsync("xdotool", ["key", linuxShortcut(normalizedKey, modifiers)], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    return;
  }
  throw new Error(`unsupported desktop automation platform: ${platformName()}`);
}

async function sendEnter() {
  if (isMac()) {
    await execFileAsync("/usr/bin/osascript", ["-e", 'tell application "System Events" to key code 36'], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    return;
  }
  await sendShortcut("enter");
}

async function sendPaste() {
  if (isMac()) {
    await sendShortcut("v", ["command"]);
    return;
  }
  await sendShortcut("v", ["control"]);
}

async function sendPasteAndEnter(settleMs = 140) {
  await sendPaste();
  await sleep(settleMs);
  await sendEnter();
}

async function clickPoint(point, options = {}) {
  const normalized = String(point || "").trim();
  const match = /^(-?\d+),(-?\d+)$/.exec(normalized);
  if (!match) {
    throw new Error(`invalid click point: ${normalized}`);
  }
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (isMac()) {
    const macClickBinary = String(options.macClickBinary || "").trim();
    if (macClickBinary) {
      await execFileAsync(macClickBinary, [normalized], {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      return;
    }
    const candidateTools = ["/opt/homebrew/bin/cliclick", "/usr/local/bin/cliclick"];
    for (const tool of candidateTools) {
      if (fs.existsSync(tool)) {
        const absolutePoint = normalized
          .split(",")
          .map((part) => (part.startsWith("-") ? `=${part}` : part))
          .join(",");
        await execFileAsync(tool, [`c:${absolutePoint}`], {
          timeout: 15000,
          maxBuffer: 1024 * 1024,
        });
        return;
      }
    }
    await execFileAsync("/usr/bin/osascript", ["-e", `tell application "System Events" to click at {${normalized}}`], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    return;
  }
  if (isWindows()) {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
[NativeInput]::SetCursorPos([int]$args[0], [int]$args[1]) | Out-Null
[NativeInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[NativeInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`;
    await runPowerShell(script, [String(x), String(y)], { timeout: 15000 });
    return;
  }
  if (isLinux()) {
    if (!(await commandExists("xdotool"))) {
      throw new Error("linux desktop automation requires xdotool for mouse input");
    }
    await execFileAsync("xdotool", ["mousemove", String(x), String(y), "click", "1"], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    return;
  }
  throw new Error(`unsupported desktop automation platform: ${platformName()}`);
}

async function clickActiveWindowBottomCenter(options = {}) {
  const bottomOffset = Number(options.bottomOffset || 88);
  if (isMac()) {
    const macPointBinary = String(options.macPointBinary || "").trim();
    if (!macPointBinary) {
      throw new Error("mac desktop automation requires a window point helper");
    }
    const { stdout } = await execFileAsync(macPointBinary, [], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    await clickPoint(String(stdout || "").trim(), { macClickBinary: options.macClickBinary });
    return;
  }
  if (isWindows()) {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public static class NativeInput {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@
$hwnd = [NativeInput]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { throw "no foreground window" }
$rect = New-Object RECT
if (-not [NativeInput]::GetWindowRect($hwnd, [ref]$rect)) { throw "failed to get window rect" }
$x = [int](($rect.Left + $rect.Right) / 2)
$y = [int]($rect.Bottom - [int]$args[0])
Write-Output "$x,$y"
`;
    const { stdout } = await runPowerShell(script, [String(bottomOffset)], { timeout: 15000 });
    await clickPoint(String(stdout || "").trim());
    return;
  }
  if (isLinux()) {
    if (!(await commandExists("xdotool"))) {
      throw new Error("linux desktop automation requires xdotool for window-relative mouse input");
    }
    const { stdout } = await execFileAsync("xdotool", ["getactivewindow", "getwindowgeometry", "--shell"], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    const values = Object.fromEntries(
      String(stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split("=", 2)),
    );
    const x = Number(values.X || 0) + Math.round(Number(values.WIDTH || 0) / 2);
    const y = Number(values.Y || 0) + Number(values.HEIGHT || 0) - bottomOffset;
    await clickPoint(`${x},${y}`);
    return;
  }
  throw new Error(`unsupported desktop automation platform: ${platformName()}`);
}

module.exports = {
  sleep,
  platformName,
  isMac,
  isWindows,
  isLinux,
  commandExists,
  openExternal,
  openApplication,
  activateApplication,
  bestEffortOpenAndActivate,
  setClipboardText,
  sendShortcut,
  sendEnter,
  sendPaste,
  sendPasteAndEnter,
  clickPoint,
  clickActiveWindowBottomCenter,
};
