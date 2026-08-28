import { readFile } from "node:fs/promises";
import Ajv from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

const path = process.argv[2];
if (!path) throw new Error("usage: validate-official-manifest <pluginbridge-plugin.yaml>");

const schema = JSON.parse(await readFile(new URL("../../conformance/manifest.schema.json", import.meta.url)));
const source = await readFile(path, "utf8");
const manifest = path.endsWith(".json") ? JSON.parse(source) : parseDocument(source, { uniqueKeys: true }).toJS();
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
if (!validate(manifest)) throw new Error(`manifest schema failure: ${JSON.stringify(validate.errors)}`);
if (manifest.schema_version !== 1) {
  throw new Error("official plugin manifest requires schema_version: 1");
}
for (const field of ["plugin_protocol_version", "icon_url", "icon_svg_url"]) {
  if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
    throw new Error(`official plugin manifest requires ${field}`);
  }
}
