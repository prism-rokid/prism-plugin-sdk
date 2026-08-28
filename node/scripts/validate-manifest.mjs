import { readFile } from "node:fs/promises";
import Ajv from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

const path = process.argv[2];
if (!path) {
  throw new Error("usage: npm run validate-manifest -- <manifest.json>");
}
const schema = JSON.parse(await readFile(new URL("../../conformance/manifest.schema.json", import.meta.url)));
const text = await readFile(path, "utf8");
const manifest = path.endsWith(".json")
  ? JSON.parse(text)
  : parseDocument(text, { uniqueKeys: true }).toJS();
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
if (!validate(manifest)) {
  throw new Error(`invalid manifest: ${JSON.stringify(validate.errors)}`);
}
