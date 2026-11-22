import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TERMS_BILLING } from "../src/billing.js";
import { handleMessage, INSTRUCTIONS, MAX_BATCH } from "../src/server.js";
import { attachStdio, writeContentLength, writeNdjson } from "../src/stdio.js";
import { requestUrl } from "../src/rest.js";
import { findTool, loadManifest, toolName, toolsFromManifest } from "../src/tools.js";

const BIN = fileURLToPath(new URL("../bin.js", import.meta.url));
const BANNED = /scrape[\s_-]*creators?|scrapecreators|failures cost zero|a failure costs 0/i;

test("tools/list is the published manifest, names match the hosted server, and billing wording is Terms-accurate", async () => {
  const manifest = loadManifest();
  const tools = toolsFromManifest(manifest);
  assert.ok(tools.length >= 100, `expected a full catalog, got ${tools.length}`);
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length, "tool names are unique");
  assert.equal(toolName("GET", "/v1/youtube/channel"), "youtube_channel");
  assert.equal(toolName("POST", "/v1/reddit/post/comments"), "reddit_post_comments_post");
  assert.equal(toolName("GET", "/v3/tiktok/profile/videos"), "tiktok_profile_videos");
  assert.equal(toolName("GET", "/v2/instagram/user/posts"), "instagram_user_posts");
  assert.equal(toolName("GET", "/v1/races/results"), "races_results");

  const required = [
    "tiktok_profile",
    "tiktok_profile_videos",
    "instagram_profile",
    "instagram_user_posts",
    "facebook_adLibrary_search_companies",
    "facebook_adLibrary_company_ads",
    "facebook_profile",
    "youtube_video_transcript",
    "races_search",
    "races_events",
    "races_results",
  ];
  for (const name of required) {
    assert.ok(findTool(name), `missing tool ${name}`);
  }

  const channel = findTool("youtube_channel");
  assert.match(channel.description, /YouTube/i);
  assert.match(channel.description, /GET \/v1\/youtube\/channel/);
  assert.match(channel.description, /Costs 1 credit/);
  assert.match(channel.description, new RegExp(TERMS_BILLING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(channel.inputSchema.properties.handle.examples, ["NASA"]);

  const standard = new Set(["type", "description", "examples"]);
  for (const tool of tools) {
    assert.equal(BANNED.test(`${tool.name}\n${tool.description}\n${JSON.stringify(tool.inputSchema)}`), false, tool.name);
    assert.deepEqual(Object.keys(tool.inputSchema).filter((key) => !["type", "properties", "required", "additionalProperties"].includes(key)), [], tool.name);
    for (const [name, property] of Object.entries(tool.inputSchema.properties)) {
      assert.deepEqual(Object.keys(property).filter((key) => !standard.has(key)), [], `${tool.name}.${name}`);
      if (property.examples) assert.ok(Array.isArray(property.examples), `${tool.name}.${name} examples is an array`);
    }
  }

  assert.match(INSTRUCTIONS, new RegExp(TERMS_BILLING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(BANNED.test(INSTRUCTIONS), false);
  assert.match(INSTRUCTIONS, /\$27 for 25,000 credits/);
  assert.match(INSTRUCTIONS, /\$297 for 500,000 credits/);
});

test("initialize and tools/list work without a key; tools/call without a key does not hit the network", async () => {
  const init = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }, { env: {} });
  assert.equal(init.result.protocolVersion, "2024-11-05");
  assert.equal(init.result.serverInfo.name, "fetchproof");
  assert.match(init.result.instructions, /FETCHPROOF_API_KEY/);

  const listed = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { env: {} });
  assert.ok(listed.result.tools.length === toolsFromManifest().length);

  let fetches = 0;
  const called = await handleMessage(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "youtube_channel", arguments: { handle: "NASA" } } },
    { env: {}, fetchImpl: async () => { fetches += 1; throw new Error("should not fetch"); } },
  );
  assert.equal(fetches, 0);
  assert.equal(called.result.isError, true);
  assert.match(called.result.content[0].text, /FETCHPROOF_API_KEY/);
});

test("tools/call hits the matching REST path with the key in headers only", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers, method: init.method });
    return {
      status: 200,
      async text() { return JSON.stringify({ success: true, credits_charged: 1, handle: "nasa" }); },
    };
  };
  const out = await handleMessage(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "tiktok_profile_videos", arguments: { handle: "nasa" } } },
    { env: { FETCHPROOF_API_KEY: "test-key", FETCHPROOF_BASE_URL: "http://127.0.0.1:9" }, fetchImpl },
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, "GET");
  assert.equal(seen[0].url, "http://127.0.0.1:9/v3/tiktok/profile/videos?handle=nasa");
  assert.equal(seen[0].headers["x-api-key"], "test-key");
  assert.equal(seen[0].headers.authorization, "Bearer test-key");
  assert.equal(seen[0].url.includes("test-key"), false);
  const body = JSON.parse(out.result.content[0].text);
  assert.equal(out.result.isError, false);
  assert.equal(body.credits_charged, 1);
});

test("a blocked or timed-out tools/call reports isError and does not invent a charge", async () => {
  const blocked = await handleMessage(
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "youtube_channel", arguments: { handle: "x" } } },
    {
      env: { FETCHPROOF_API_KEY: "k" },
      fetchImpl: async () => ({
        status: 502,
        async text() { return JSON.stringify({ success: false, error: "blocked", credits_charged: 0 }); },
      }),
    },
  );
  assert.equal(blocked.result.isError, true);
  assert.equal(JSON.parse(blocked.result.content[0].text).credits_charged, 0);

  const timed = await handleMessage(
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "youtube_channel", arguments: { handle: "x" } } },
    {
      env: { FETCHPROOF_API_KEY: "k" },
      fetchImpl: async (_url, init) => {
        const err = new Error("aborted");
        err.name = "AbortError";
        // Honour the caller's signal if already aborted; otherwise still throw AbortError.
        if (init.signal?.aborted) throw err;
        throw err;
      },
    },
  );
  assert.equal(timed.result.isError, true);
  assert.equal(JSON.parse(timed.result.content[0].text).credits_charged, 0);
});

test("unknown tools, malformed messages, and oversized batches do not call the API", async () => {
  let fetches = 0;
  const fetchImpl = async () => { fetches += 1; throw new Error("no"); };
  const opts = { env: { FETCHPROOF_API_KEY: "k" }, fetchImpl };
  const unknown = await handleMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "not_a_tool", arguments: {} } }, opts);
  assert.equal(unknown.result.isError, true);
  const bad = await handleMessage({ jsonrpc: "1.0", id: 8, method: "tools/list" }, opts);
  assert.equal(bad.error.code, -32600);
  const huge = await handleMessage(Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" })), opts);
  assert.equal(huge.error.code, -32600);
  assert.equal(fetches, 0);
});

test("requestUrl substitutes path params and keeps the key out of the URL", () => {
  const url = requestUrl("https://api.fetchproof.com", "/v1/jobs/{id}", { id: "abc", wait: "1" });
  assert.equal(url.href, "https://api.fetchproof.com/v1/jobs/abc?wait=1");
  assert.throws(() => requestUrl("https://api.fetchproof.com", "/v1/jobs/{id}", {}), /Missing path parameter id/);
});

test("stdio NDJSON and Content-Length framing both work, including initialize without a key", async () => {
  // NDJSON in-process
  const ndjsonChunks = [];
  const ndIn = new (await import("node:stream")).PassThrough();
  const ndOut = new (await import("node:stream")).PassThrough();
  ndOut.on("data", (c) => ndjsonChunks.push(c));
  attachStdio({ stdin: ndIn, stdout: ndOut, stderr: process.stderr });
  writeNdjson({ jsonrpc: "2.0", id: 1, method: "ping" }, ndIn);
  const ndReply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ndjson timeout: ${Buffer.concat(ndjsonChunks)}`)), 2000);
    const check = () => {
      const text = Buffer.concat(ndjsonChunks).toString("utf8");
      if (!text.includes("\n")) return;
      clearTimeout(timer);
      resolve(JSON.parse(text.trim().split("\n")[0]));
    };
    ndOut.on("data", check);
    check();
  });
  assert.deepEqual(ndReply, { jsonrpc: "2.0", id: 1, result: {} });

  // Content-Length through the real bin, against a stub REST host (no /mcp forward).
  const hits = [];
  const stub = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: true, credits_charged: 1 }));
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const child = spawn(process.execPath, [BIN], {
    env: { ...process.env, FETCHPROOF_API_KEY: "stdio-key", FETCHPROOF_BASE_URL: `http://127.0.0.1:${stub.address().port}` },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    const message = Buffer.from(JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "youtube_channel", arguments: { handle: "NASA" } },
    }));
    child.stdin.write(`Content-Length: ${message.length}\r\n\r\n`);
    child.stdin.write(message);
    const reply = await new Promise((resolve, reject) => {
      let buf = Buffer.alloc(0);
      const timer = setTimeout(() => reject(new Error(`stdio timed out\n${buf.toString()}\nstderr=${stderrAcc}`)), 4000);
      let stderrAcc = "";
      child.stderr.on("data", (c) => { stderrAcc += c; });
      child.stdout.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const length = Number(/Content-Length:\s*(\d+)/i.exec(buf.slice(0, headerEnd).toString("utf8"))[1]);
        const start = headerEnd + 4;
        if (buf.length < start + length) return;
        clearTimeout(timer);
        resolve(JSON.parse(buf.slice(start, start + length).toString("utf8")));
      });
    });
    assert.equal(hits[0], "GET /v1/youtube/channel?handle=NASA");
    assert.equal(reply.result.isError, false);
    assert.equal(JSON.parse(reply.result.content[0].text).credits_charged, 1);
  } finally {
    child.kill();
    stub.closeAllConnections?.();
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("help and version flags print to stdout and exit 0", async () => {
  const help = spawn(process.execPath, [BIN, "--help"], { stdio: ["ignore", "pipe", "pipe"] });
  const helpOut = await readProc(help);
  assert.equal(helpOut.status, 0);
  assert.match(helpOut.stdout, /FETCHPROOF_API_KEY/);
  assert.equal(BANNED.test(helpOut.stdout + helpOut.stderr), false);
  const ver = spawn(process.execPath, [BIN, "--version"], { stdio: ["ignore", "pipe", "pipe"] });
  const verOut = await readProc(ver);
  assert.equal(verOut.status, 0);
  assert.match(verOut.stdout, /^0\.1\.0\n$/);
});

test("sync-spec --check in a standalone checkout skips the monorepo OpenAPI and lets prepack succeed", () => {
  const pkg = fileURLToPath(new URL("..", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "fp-mcp-pack-"));
  cpSync(join(pkg, "scripts"), join(dir, "scripts"), { recursive: true });
  cpSync(join(pkg, "src"), join(dir, "src"), { recursive: true });
  cpSync(join(pkg, "openapi"), join(dir, "openapi"), { recursive: true });
  writeFileSync(join(dir, "package.json"), readFileSync(join(pkg, "package.json")));
  const check = spawnSync(process.execPath, [join(dir, "scripts/sync-spec.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /standalone checkout/);
  const write = spawnSync(process.execPath, [join(dir, "scripts/sync-spec.mjs")], { encoding: "utf8" });
  assert.notEqual(write.status, 0);
  assert.match(write.stderr, /OpenAPI source not found/);
});

function readProc(child) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
