# @rokid/pluginbridge-plugin-sdk (Node/TypeScript)

Official Node/TypeScript SDK for building PluginBridge plugins.

The package name is fixed as `@rokid/pluginbridge-plugin-sdk`.
Install the published package from npm (the repository development path is
`node/`).

## Quick start

```sh
npm install @rokid/pluginbridge-plugin-sdk
```

```typescript
import { serve, type PluginAdapter } from "@rokid/pluginbridge-plugin-sdk";

class MyAdapter implements PluginAdapter {
  id() { return "acme.tool"; }
  async probe() {
    return {
      PluginID: "acme.tool",
      Available: true,
      NativeVisibleInput: true,
      CanForwardSync: true,
      CanReverseSync: false,
      CanWaitRun: false,
      IntegrationMode: "protocol-native",
      VisibilitySurface: "acme.tool",
      UnavailableReason: "",
    };
  }
  // ... implement the rest
}

serve(new MyAdapter());
```

See `example/index.ts` for a complete echo adapter.

That example is intentionally minimal and is not a finished mobile/glasses
remote-conversation plugin by itself.

Important product rule:

- If your plugin is meant to appear in the mobile / glasses app, it must do
  more than "accept one prompt".
- In practice that means `listSessions`, `attachSession`, `subscribe`, and
  `waitForRun` are required, and approval handling is required whenever the
  native application has approval semantics.

Step-by-step plugin development guide:

- [Manifest 与 conformance 契约](../conformance/manifest.schema.json)

## Manifest

```yaml
id: acme.tool
integration_mode: protocol-native
transport: process
runtime_modes: [native]
default_runtime_mode: native
runtime_controls:
  native: {}
command: ["node", "./dist/index.js"]
capabilities:
  native_visible_input: true
```

## Integration modes

- `protocol-native`: 走正式 gateway / app-server / 本地 API / 协议入口。
- `desktop-automation`: 走桌面 UI 自动化、CDP、深链、辅助功能。

manifest 与 `probe()` 返回的 `IntegrationMode` 应保持一致。

标准模型、推理或权限控件必须在每个 runtime 的 `runtime_controls` 中选择唯一实现：
`stable` 使用 `current_*` / `*_options`，`interactive` 使用带 `semantic_kinds[]` 的动态控件。
不能同时发布两种表示；完整规则见 SDK 指南 2 和 5.6。

## Control detail confirmation

`ControlSessionResult.details_confirmed` 不是 manifest 配置或 capability，而是每次
`controlSession` 返回对完整 detail 的权威性断言。稳定 Native RPC 可在只读结果已确认，
或变更 RPC 已成功后设置 `true`；Desktop/CDP、异步 UI 和仅 accepted 的命令必须保持
`false`，由 `subscribe` 后续收敛。多运行模式 Plugin 按本次实际路径判断，不能为整个
Plugin 或 mode 静态开启。判定表与误用风险见
[SDK README](../README.md)。

## Desktop Automation Platform Model

桌面自动化插件不要把平台差异散落在业务逻辑里。

Node SDK 现在导出了统一的平台目标模型：

- `DesktopAutomationTarget`
- `platformName()`
- `desktopAutomationTargetTitle()`
- `desktopAutomationEnvDocs`

并且提供了可直接复用的 CommonJS 运行时：

```js
const desktopAutomation = require("@rokid/pluginbridge-plugin-sdk/desktop-automation-runtime");
```

如果插件要对接 Electron / Chromium 桌面端，SDK 提供的是通用 CDP 运行时：

```js
const { CdpPageClient } = require("@rokid/pluginbridge-plugin-sdk/cdp-runtime");
```

约定是：

- SDK 只放通用 CDP / 桌面自动化能力，不放某个产品的 DOM 选择器、菜单语义、启动参数
- 像 Codex 这种产品语义，应该收口在各自插件里
- 这也意味着 Go / Python 插件后续同样可以实现对应 CDP 客户端；当前仓库只是先提供 Node 版通用 helper

建议约定：

- macOS 使用 bundle id / app name
- Windows 使用 executable path + window title
- Linux 使用 launch command + window title

官方插件当前共用的环境变量约定包括：

- `PRISM_SQLITE3_BIN`
- `PRISM_CODEX_BUNDLE_ID`
- `PRISM_CODEX_APP_NAME`
- `PRISM_CODEX_APP_PATH`
- `PRISM_CODEX_APP_COMMAND`
- `PRISM_CODEX_WINDOW_TITLE`

产品级 CDP 插件如果自己定义了额外环境变量，例如 Codex 的
`PRISM_CODEX_CDP_URL` / `PRISM_CODEX_CDP_PORT` / `PRISM_CODEX_DEVTOOLS_FILE` /
`PRISM_CODEX_USER_DATA_DIR` / `PRISM_PLUGIN_MANAGED_LAUNCH`，
这些约定也应该保留在插件文档里，而不是做成 SDK 对某个产品的内建语义。

如果插件要进入手机 / 眼镜正式链路，平台差异必须在插件内部或共享平台层里收口，不能把“只支持某个系统”当成协议级能力。

## Protocol

The SDK speaks JSON-over-newline-stdio. See the repository
[README](../README.md) and [`conformance/`](../conformance/) for the current contract.
JSON wire field names use `snake_case` and are locked. SDK-facing TypeScript
field names remain idiomatic; conversion occurs only at the stdio boundary.

This SDK implements PluginBridge v4. Legacy PascalCase wire payloads are
rejected.
