/**
 * JSON-RPC MCP server. initialize and tools/list work without a key so
 * directories can introspect the tool list. tools/call requires FETCHPROOF_API_KEY.
 */

import { TERMS_BILLING, packsSentence } from "./billing.js";
import { apiKeyFromEnv, baseUrlFromEnv, callOperation, timeoutMsFromEnv } from "./rest.js";
import { findTool, publicTool, toolsFromManifest } from "./tools.js";

export const PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-03-26"]);
export const SERVER_INFO = { name: "fetchproof", version: "1.0.0" };
export const MAX_BATCH = 20;

export const INSTRUCTIONS = [
  "Each tool is one published Fetchproof operation. Pass that operation's parameters as arguments.",
  "The result is the API response, including credits_charged.",
  TERMS_BILLING,
  packsSentence(),
  "Set FETCHPROOF_API_KEY to your key from https://app.fetchproof.com. Optional FETCHPROOF_BASE_URL defaults to https://api.fetchproof.com.",
  "Docs: https://docs.fetchproof.com/mcp — free tools: https://fetchproof.com/tools",
].join(" ");

export async function handleMessage(message, options = {}) {
  if (Array.isArray(message)) {
    if (message.length === 0) return rpcError(null, -32600, "Invalid Request: empty batch");
    if (message.length > MAX_BATCH) return rpcError(null, -32600, `Invalid Request: a batch holds at most ${MAX_BATCH} messages`);
    const replies = [];
    for (const item of message) {
      if (Array.isArray(item)) { replies.push(rpcError(null, -32600, "Invalid Request")); continue; }
      const one = await handleMessage(item, options);
      if (one) replies.push(one);
    }
    return replies;
  }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(null, -32600, "Invalid Request");
  }
  const id = message.id;
  const notification = id === undefined;
  if (notification) return null;

  if (message.method === "initialize") {
    const asked = message.params?.protocolVersion;
    const protocolVersion = PROTOCOL_VERSIONS.has(asked) ? asked : "2025-03-26";
    return rpcResult(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
  }
  if (message.method === "notifications/initialized") return null;
  if (message.method === "ping") return rpcResult(id, {});

  if (message.method === "tools/list") {
    return rpcResult(id, { tools: toolsFromManifest().map(publicTool) });
  }
  if (message.method === "tools/call") {
    return callTool(id, message.params, options);
  }
  return rpcError(id, -32601, `Method not found: ${message.method}`);
}

async function callTool(id, params, options) {
  const name = params?.name;
  const tool = findTool(name);
  if (!tool) {
    return rpcResult(id, { content: [{ type: "text", text: `Unknown tool ${name}` }], isError: true });
  }
  const env = options.env || process.env;
  const apiKey = options.apiKey ?? apiKeyFromEnv(env);
  if (!apiKey) {
    return rpcResult(id, {
      content: [{ type: "text", text: "Missing FETCHPROOF_API_KEY. Get a key at https://app.fetchproof.com and set it in the MCP server environment. initialize and tools/list do not need a key." }],
      isError: true,
    });
  }
  let args = params?.arguments ?? {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  const result = await callOperation({
    base: options.baseUrl ?? baseUrlFromEnv(env),
    apiKey,
    method: tool.method,
    path: tool.path,
    params: stringifyArgs(args),
    timeoutMs: options.timeoutMs ?? timeoutMsFromEnv(env),
    fetchImpl: options.fetchImpl,
  });
  const text = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
  const isError = result.status >= 400 && result.body?.success !== true;
  return rpcResult(id, { content: [{ type: "text", text }], isError });
}

function stringifyArgs(args) {
  const params = {};
  if (!args || typeof args !== "object") return params;
  for (const [key, value] of Object.entries(args)) {
    if (value == null || value === "") continue;
    params[key] = typeof value === "string" ? value : String(value);
  }
  return params;
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
