# rokid-pluginbridge-plugin-sdk (Python)

Official Python SDK for building PluginBridge plugins.

The package name is fixed as `rokid-pluginbridge-plugin-sdk`.
Install the published package from PyPI (the repository development path is
`python/`).

## Quick start

```sh
pip install rokid-pluginbridge-plugin-sdk
```

```python
from pluginbridge import serve, PluginAdapter, Capability

class MyAdapter(PluginAdapter):
    def id(self) -> str:
        return "acme.tool"

    def probe(self) -> Capability:
        return Capability(
            PluginID="acme.tool",
            Available=True,
            NativeVisibleInput=True,
            CanForwardSync=True,
            CanReverseSync=False,
            CanWaitRun=False,
            IntegrationMode="protocol-native",
            VisibilitySurface="acme.tool",
        )

    # ... implement the rest

serve(MyAdapter())
```

See `example/echo_adapter.py` for a complete echo adapter.

That example is intentionally minimal and is not a finished mobile/glasses
remote-conversation plugin by itself.

Important product rule:

- If your plugin is meant to appear in the mobile / glasses app, it must do
  more than "accept one prompt".
- In practice that means `list_sessions`, `attach_session`, `subscribe`, and
  `wait_for_run` are required, and approval handling is required whenever the
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
command: ["python3", "echo_adapter.py"]
capabilities:
  native_visible_input: true
```

## Integration modes

- `protocol-native`: 通过正式 gateway / app-server / 本地 API / CLI 协议接入。
- `desktop-automation`: 通过桌面 UI 自动化、CDP、深链、辅助功能接入。

manifest 里的 `integration_mode` 应和 `probe()` 返回的 `integration_mode` 保持一致。

每个 runtime 必须在 `runtime_controls` 中为模型、推理和权限选择唯一的 `stable` 或
`interactive` 实现；动态标准控件必须携带 `semantic_kinds[]`，不能与稳定字段同时作为 owner。

## Control detail confirmation

`ControlSessionResult.details_confirmed` 不是 manifest 配置或 capability，而是每次
`control_session` 返回对完整 detail 的权威性断言。稳定 Native RPC 可在只读结果已确认，
或变更 RPC 已成功后设置 `True`；Desktop/UI 自动化和仅 accepted 的异步命令保持
`False`，由 `subscribe` 后续收敛。多运行模式 Plugin 必须按本次执行路径判断。判定表与
误用风险见
[SDK README](../README.md)。

## Protocol

The SDK speaks JSON-over-newline-stdio. See the repository
[README](../README.md) and [`conformance/`](../conformance/) for the current contract.
JSON wire field names use `snake_case` and are locked. SDK-facing Python
dataclass field names remain idiomatic; conversion occurs only at the stdio boundary.

This SDK implements PluginBridge v4. Legacy PascalCase wire payloads are
rejected.
