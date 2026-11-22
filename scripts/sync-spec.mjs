#!/usr/bin/env node
/**
 * Generate mcp/openapi/tools.json from the published OpenAPI file.
 *   node mcp/scripts/sync-spec.mjs          # write
 *   node mcp/scripts/sync-spec.mjs --check  # exit 1 if stale
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { operationsFromSpec } from "../src/tools.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const specPath = join(root, "build/fetchproof.openapi.json");
const outPath = join(root, "mcp/openapi/tools.json");

const spec = JSON.parse(readFileSync(specPath, "utf8"));
const manifest = {
  source: "build/fetchproof.openapi.json",
  title: spec.info?.title || "Fetchproof API",
  version: spec.info?.version || "1.0.0",
  servers: spec.servers || [{ url: "https://api.fetchproof.com" }],
  operations: operationsFromSpec(spec),
};

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
const check = process.argv.includes("--check");
if (check) {
  let current = "";
  try { current = readFileSync(outPath, "utf8"); } catch { current = ""; }
  if (current !== serialized) {
    process.stderr.write("mcp/openapi/tools.json is stale. Run: node mcp/scripts/sync-spec.mjs\n");
    process.exit(1);
  }
  process.stdout.write(`mcp/openapi/tools.json is current (${manifest.operations.length} operations)\n`);
  process.exit(0);
}

writeFileSync(outPath, serialized);
process.stdout.write(`Wrote ${outPath} (${manifest.operations.length} operations)\n`);
