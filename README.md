# Prism Plugin SDK

The public, MIT-licensed PluginBridge v4 SDK for Prism plugins.

| Language | Distribution | Install |
| --- | --- | --- |
| Go | `github.com/Rokid-Prism/prism-plugin-sdk` | `go get github.com/Rokid-Prism/prism-plugin-sdk@v0.1.1` |
| Node.js | `@rokid-prism/pluginbridge-plugin-sdk` | `npm install @rokid-prism/pluginbridge-plugin-sdk@0.1.1` |
| Python | `rokid-pluginbridge-plugin-sdk` | `pip install rokid-pluginbridge-plugin-sdk==0.1.1` |

All SDKs expose the PluginBridge v4 JSON-lines stdio server. Plugin-facing
types use idiomatic language naming; the server converts them to the locked
snake_case wire protocol. See the language-specific READMEs and examples in
`example/`, `node/example/`, and `python/example/`.

```go
import pluginbridge "github.com/Rokid-Prism/prism-plugin-sdk"
```

```ts
import { serve } from "@rokid-prism/pluginbridge-plugin-sdk";
// CommonJS: const { serve } = require("@rokid-prism/pluginbridge-plugin-sdk");
```

```python
from pluginbridge import serve
```

## Node module formats

`@rokid-prism/pluginbridge-plugin-sdk` exports both ESM and CommonJS entry points.
Use `import` from ESM or `require` from CommonJS; TypeScript declarations are
shared. The `/desktop-automation-runtime` and `/cdp-runtime` subpaths remain
CommonJS for existing Codex and Hermes adapters.

## Manifest contract

[`conformance/manifest.schema.json`](conformance/manifest.schema.json) is the
strict JSON Schema for a PluginBridge v4 manifest. It permits legacy plugins
to omit icons, but official plugin release CI must require both `icon_url` and
`icon_svg_url`. The same official release check requires `schema_version: 1`
and `plugin_protocol_version: "4"`; the base schema leaves them optional only
for legacy and third-party compatibility.

- `icon_url`: optional absolute HTTPS bitmap URL (max 1024 characters).
- `icon_svg_url`: optional absolute HTTPS SVG URL (max 1024 characters).
- `runtime_dependencies.node`: optional semver range such as
  `>=22.0.0 <23.0.0`.
- `command`: can reference the Hub-managed Node binary only as
  `${runtime.node}`; it is never expanded by the SDK.

The SDK deliberately does not fetch, inline, inspect, or execute SVG files.

[`conformance/plugin-release.schema.json`](conformance/plugin-release.schema.json) defines the signed/checked release
metadata consumed by the Hub registry.

## Release

Tags of the form `v*` validate all three SDKs, build Go and Node artifacts,
and publish npm and PyPI through OIDC trusted publishing. Configure npm trusted
publisher and PyPI trusted publisher for this repository before tagging.

This repository's npm configuration defaults to the npmmirror registry for
dependency installation. The release workflow explicitly switches publishing
to the official npm registry, as required by npm Trusted Publishing.
