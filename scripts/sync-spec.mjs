#!/usr/bin/env node
/**
 * Generate openapi/tools.json from the published OpenAPI file.
 * Run from the fetchproof-api monorepo (`mcp/scripts/sync-spec.mjs`).
 *
 *   node mcp/scripts/sync-spec.mjs          # write
 *   node mcp/scripts/sync-spec.mjs --check  # exit 1 if stale
 *
 * In the standalone @fetchproof/mcp checkout there is no monorepo OpenAPI
 * source. `--check` (used by prepack) exits 0 and leaves the published
 * openapi/tools.json alone so `npm pack` / `npm publish` work.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { operationsFromSpec } from "../src/tools.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = join(packageRoot, "../build/fetchproof.openapi.json");
const outPath = join(packageRoot, "openapi/tools.json");
const check = process.argv.includes("--check");

if (!existsSync(specPath)) {
  if (check) {
    if (!existsSync(outPath)) {
      process.stderr.write("openapi/tools.json is missing in this standalone checkout\n");
      process.exit(1);
    }
    process.stdout.write("standalone checkout: skipping OpenAPI sync check; using published openapi/tools.json\n");
    process.exit(0);
  }
  process.stderr.write("OpenAPI source not found (expected build/fetchproof.openapi.json). Run this script from the fetchproof-api monorepo.\n");
  process.exit(1);
}

const spec = JSON.parse(readFileSync(specPath, "utf8"));
const manifest = {
  source: "build/fetchproof.openapi.json",
  title: spec.info?.title || "Fetchproof API",
  version: spec.info?.version || "1.0.0",
  servers: spec.servers || [{ url: "https://api.fetchproof.com" }],
  operations: operationsFromSpec(spec),
};

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
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
