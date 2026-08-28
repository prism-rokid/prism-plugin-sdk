/**
 * Shared desktop-automation target model for Node plugins.
 *
 * The SDK ships both:
 * - this typed target/env model
 * - a CommonJS runtime helper at
 *   `@rokid/pluginbridge-plugin-sdk/desktop-automation-runtime`
 *
 * This keeps official plugins and future user plugins on the same
 * cross-platform bundle-id / executable / window-title conventions.
 */

export type DesktopPlatform = "darwin" | "win32" | "linux" | string;

export interface DesktopAutomationTarget {
  macBundleId?: string;
  macAppName?: string;
  macAppPath?: string;
  windowsExecutable?: string;
  windowsWindowTitle?: string;
  linuxCommand?: string;
  linuxWindowTitle?: string;
  appName?: string;
  windowTitle?: string;
}

export interface DesktopAutomationEnvDoc {
  key: string;
  meaning: string;
}

export function platformName(): DesktopPlatform {
  return process.platform;
}

export function desktopAutomationTargetTitle(target: DesktopAutomationTarget): string {
  return (
    target.windowTitle ||
    target.macAppName ||
    target.windowsWindowTitle ||
    target.linuxWindowTitle ||
    target.appName ||
    ""
  ).trim();
}

export function isDesktopAutomationPlatformSupported(platform: DesktopPlatform = platformName()): boolean {
  return platform === "darwin" || platform === "win32" || platform === "linux";
}

export const desktopAutomationEnvDocs: DesktopAutomationEnvDoc[] = [
  { key: "PRISM_SQLITE3_BIN", meaning: "Override sqlite3 executable used by desktop-automation plugins." },
  { key: "PRISM_CODEX_BUNDLE_ID", meaning: "Override Codex macOS bundle id." },
  { key: "PRISM_CODEX_APP_NAME", meaning: "Override Codex application/window name." },
  { key: "PRISM_CODEX_APP_PATH", meaning: "Override Codex executable/app path on non-default systems." },
  { key: "PRISM_CODEX_APP_COMMAND", meaning: "Override Codex Linux launch command." },
  { key: "PRISM_CODEX_WINDOW_TITLE", meaning: "Override Codex window title used for activation." },
];
