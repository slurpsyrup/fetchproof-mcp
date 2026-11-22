/**
 * One MCP tool per published Fetchproof operation, from the slim tools manifest
 * generated from build/fetchproof.openapi.json.
 */

import { readFileSync } from "node:fs";
import { costSentence } from "./billing.js";

const MANIFEST_URL = new URL("../openapi/tools.json", import.meta.url);
const METHODS = ["get", "post", "put", "patch", "delete"];

let cachedManifest;

export function loadManifest() {
  if (!cachedManifest) cachedManifest = JSON.parse(readFileSync(MANIFEST_URL, "utf8"));
  return cachedManifest;
}

/** For tests: drop the cached manifest. */
export function resetManifestCache() {
  cachedManifest = undefined;
}

/** Stable tool name. A non-GET method is part of the name so the POST twin is distinct. */
export function toolName(method, path) {
  const stem = path.replace(/^\/v\d+\//, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const suffix = String(method).toLowerCase() === "get" ? "" : `_${String(method).toLowerCase()}`;
  let name = `${stem}${suffix}`;
  if (!/^[A-Za-z]/.test(name)) name = `op_${name}`;
  return name.slice(0, 64);
}

export function toolsFromManifest(manifest = loadManifest()) {
  return (manifest.operations || []).map((op) => toolFor(op));
}

export function findTool(name, manifest = loadManifest()) {
  return toolsFromManifest(manifest).find((row) => row.name === name);
}

function toolFor(op) {
  const properties = {};
  const required = [];
  for (const param of op.parameters || []) {
    if (param.in === "header") continue;
    const example = param.example;
    properties[param.name] = {
      type: param.type || "string",
      description: param.description || `${param.name} (${param.required ? "required" : "optional"})`,
      ...(example !== undefined && example !== null && example !== "" ? { examples: [example] } : {}),
    };
    if (param.required) required.push(param.name);
  }
  const tag = (op.tags && op.tags[0]) || "fetchproof";
  return {
    name: toolName(op.method, op.path),
    method: String(op.method).toUpperCase(),
    path: op.path,
    description: describe(op, tag),
    inputSchema: {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    },
  };
}

function describe(op, tag) {
  const summary = (op.summary || op.path).replace(/\s+/g, " ").trim();
  const detail = (op.description || "").replace(/\s+/g, " ").trim().slice(0, 420);
  const cost = costSentence(op.creditCost);
  return `${tag}: ${summary}. ${String(op.method).toUpperCase()} ${op.path}. ${detail}${detail ? " " : ""}${cost}`;
}

export function publicTool(tool) {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

export function operationsFromSpec(spec) {
  const operations = [];
  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      operations.push(slimOperation(spec, method, path, op));
    }
  }
  return operations;
}

export function slimOperation(spec, method, path, op) {
  const params = (op.parameters || []).map((node) => resolve(spec, node)).filter((p) => p && p.in !== "header");
  return {
    method: method.toLowerCase(),
    path,
    operationId: op.operationId || null,
    tags: op.tags || [],
    summary: op.summary || "",
    description: op.description || "",
    creditCost: op["x-credit-cost"] || { unit: "credits", default: 1, rules: [] },
    parameters: params.map((param) => {
      const schema = resolve(spec, param.schema) || { type: "string" };
      const example = param.example ?? schema.example;
      return {
        name: param.name,
        in: param.in,
        required: Boolean(param.required),
        type: schema.type || "string",
        description: param.description || "",
        ...(example !== undefined ? { example } : {}),
      };
    }),
  };
}

export function resolve(spec, node) {
  if (!node || typeof node !== "object" || !node.$ref) return node;
  let cur = spec;
  for (const part of node.$ref.replace(/^#\//, "").split("/")) cur = cur?.[part];
  return cur;
}
