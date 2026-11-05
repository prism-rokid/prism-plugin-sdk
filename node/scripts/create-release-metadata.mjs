import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const artifacts = resolve(root, process.argv[2] || "release-artifacts");
const manifestPath = resolve(root, process.argv[3] || "pluginbridge-plugin.yaml");
const manifest = await readFile(manifestPath, "utf8");
const field = (name) => manifest.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^(?:"|')|(?:"|')$/g, "") || "";
const id = field("id");
const version = field("version");
if (!id || !version) throw new Error("manifest 必须声明 id 和 version");

const names = (await readdir(artifacts)).filter((name) => name.endsWith(".tar.gz")).sort();
if (names.length !== 4) throw new Error(`需要四个目标平台包，当前为 ${names.length}`);
const assets = await Promise.all(names.map(async (name) => {
  const match = name.match(new RegExp(`^${id}-${version}-(macos-arm64|macos-x64|windows-x64|linux-x64)\\.tar\\.gz$`));
  if (!match) throw new Error(`无效的插件包名：${name}`);
  const bytes = await readFile(resolve(artifacts, name));
  return {
    platform: match[1],
    filename: name,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size_bytes: bytes.length,
  };
}));

const metadata = {
  schema_version: 1,
  plugin_id: id,
  version,
  display_name: field("display_name"),
  description: field("description"),
  icon_url: field("icon_url"),
  icon_svg_url: field("icon_svg_url"),
  plugin_protocol_version: field("plugin_protocol_version"),
  min_hub_version: field("min_hub_version"),
  channel: field("channel") || "stable",
  supported_platforms: assets.map((asset) => asset.platform),
  assets,
};
await writeFile(resolve(artifacts, "plugin-release.json"), JSON.stringify(metadata, null, 2) + "\n");
console.log(`已生成发布元数据：${resolve(artifacts, "plugin-release.json")}`);
